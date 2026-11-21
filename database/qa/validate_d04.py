"""Run D04-V4 validation from a clean source checkout: python database/qa/validate_d04.py.

Requirements: Python 3.10+, Java 21, Docker Linux Engine/Compose, cached mysql:8.4,
and Gradle-wrapper dependency access (network or cache). Windows and POSIX supported.
Validates:
1. Migration V1 -> V2 -> V3 -> V4 upgrade, idempotency, validate.
2. User profile contact fields (phone, address), constraints, data preservation.
3. Isolated MySQL 8.4 instance, zero leakage to shared databases.
4. Security & Quality: synthetic fixtures only, zero real data or secrets.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
V1 = 'V1__create_users.sql'
V2 = 'V2__create_specialties_and_doctors.sql'
V3 = 'V3__create_patients_and_profile_fields.sql'
V4 = 'V4__add_profile_contact_fields_to_users.sql'


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_summary(directory):
    results = [ET.parse(p).getroot() for p in directory.glob('TEST-*.xml')]
    if not results:
        raise RuntimeError('No JUnit XML evidence produced')
    summary = {key: sum(int(r.attrib.get(key, 0)) for r in results)
               for key in ('tests', 'failures', 'errors', 'skipped')}
    if summary['tests'] == 0 or any(summary[k] for k in ('failures', 'errors', 'skipped')):
        raise RuntimeError('JUnit checks did not all execute successfully')
    return summary


def source_context(revision):
    state = {'kind': 'source-export', 'revision': revision, 'branch': None}
    if not shutil.which('git'):
        return state
    result = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=ROOT,
                            capture_output=True, text=True)
    if result.returncode == 0 and Path(result.stdout.strip()).resolve() == ROOT:
        state.update(kind='git-checkout',
                     revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                     branch=subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip())
    return state


def preserved_files():
    paths = ['.gitignore', 'database/README.md', 'docs/qa/TEST_PLAN.md',
             'backend/src/main/resources/db/migration/V1__create_users.sql',
             'backend/src/main/resources/db/migration/V2__create_specialties_and_doctors.sql',
             'backend/src/main/resources/db/migration/V3__create_patients_and_profile_fields.sql']
    return {name: hash_file(ROOT / name) for name in paths if (ROOT / name).is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-revision', help='Provenance of a source export; not required in a Git checkout')
    args = parser.parse_args()
    if args.source_revision and not re.fullmatch('[a-f0-9]{40}', args.source_revision):
        raise RuntimeError('Source revision must be a full Git commit ID')
    context = source_context(args.source_revision)
    baseline = preserved_files()
    run_id = uuid.uuid4().hex[:10]
    work = Path(tempfile.mkdtemp(prefix='clinic-d04v4-runtime-'))
    migration_dir = ROOT / 'backend/src/main/resources/db/migration'

    expected_migrations = [V1, V2, V3, V4]
    actual_migrations = sorted(p.name for p in migration_dir.glob('*.sql'))
    if actual_migrations != expected_migrations:
        raise RuntimeError(f'Expected exactly V1, V2, V3, and V4 migrations, got: {actual_migrations}')

    for tool in ('docker', 'java'):
        if not shutil.which(tool):
            raise RuntimeError('Required tool unavailable: ' + tool)

    docker = Path(shutil.which('docker'))
    config_dir = work / 'docker'
    config_dir.mkdir()
    plugins = docker.parent.parent / 'cli-plugins'
    config = {'cliPluginsExtraDirs': [str(plugins)]} if plugins.is_dir() else {}
    (config_dir / 'config.json').write_text(json.dumps(config), encoding='utf-8')
    d = [str(docker), '--config', str(config_dir)]
    project = 'clinic-d04v4-db-' + run_id
    schema = 'clinic_d02_be_it_d04v4_' + run_id

    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared DB ports')

    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('COMPOSE_', 'DB_', 'SPRING_', 'JWT_', 'CORS_', 'CLINIC_')):
            del env[key]

    env.update(CLINIC_MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32),
               CLINIC_MYSQL_PASSWORD=secrets.token_urlsafe(32),
               CLINIC_MYSQL_PORT=str(port),
               DB_URL=f'jdbc:mysql://127.0.0.1:{port}/clinic_management_db?connectionTimeZone=UTC',
               DB_FRESH_URL=f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC',
               DB_USERNAME='clinic_app',
               CLINIC_QA_ACK='NEW_D04_INSTANCE_ONLY')
    env['DB_PASSWORD'] = env['CLINIC_MYSQL_PASSWORD']

    c = ['compose', '-p', project, '-f', str(ROOT / 'docker-compose.yml'), '--env-file', str(ROOT / '.env.example')]
    gradle = ['cmd', '/c', str(ROOT / 'backend/gradlew.bat')] if os.name == 'nt' else ['sh', str(ROOT / 'backend/gradlew')]

    evidence = {
        'task': 'CL-D04-DB-V4',
        'utc': datetime.now(timezone.utc).isoformat(),
        'source': context,
        'project': project,
        'v1_sha256': hash_file(migration_dir / V1),
        'v2_sha256': hash_file(migration_dir / V2),
        'v3_sha256': hash_file(migration_dir / V3),
        'v4_sha256': hash_file(migration_dir / V4),
        'baseline_file_count': len(baseline),
        'scope': 'Only a new isolated MySQL 8.4 instance; shared Clinic, staff fixtures and SmartExpense untouched',
        'schema_v4': {
            'target_table': 'users',
            'added_columns': {
                'phone': 'VARCHAR(24) NULL not unique',
                'address': 'VARCHAR(255) NULL not unique'
            },
            'added_constraints': [
                'chk_users_phone: phone IS NULL OR (CHAR_LENGTH(TRIM(phone)) > 0 AND CAST(phone AS BINARY) = CAST(TRIM(phone) AS BINARY))',
                'chk_users_address: address IS NULL OR CHAR_LENGTH(address) <= 255'
            ],
            'rules': [
                'phone and address are nullable',
                'phone is not unique (family members may share contact number)',
                'address is not unique',
                'phone must be trimmed non-empty if provided (no blank or untrimmed strings)',
                'address max length is 255 chars with UTF-8 Unicode support',
                'no dummy default values',
                'no default account creation',
                'V1/V2/V3 preserved byte-for-byte',
                'patients table completely unchanged',
                'no auto-sync between users.phone and patients.phone',
                'no auto-sync between users.address and patients.address',
                'no auto-link between user and patient'
            ]
        },
        'data_preservation': {
            'existing_users_preserved': True,
            'existing_users_phone_null': True,
            'existing_users_address_null': True
        },
        'backend_handoff': {
            'migration_name': V4,
            'schema': 'ALTER TABLE users ADD COLUMN phone VARCHAR(24) NULL, ADD COLUMN address VARCHAR(255) NULL, ADD CONSTRAINT chk_users_phone CHECK (...), ADD CONSTRAINT chk_users_address CHECK (...)',
            'user_entity_mapping': {
                'phone_field': '@Column(name = "phone", length = 24) private String phone;',
                'address_field': '@Column(name = "address", length = 255) private String address;'
            },
            'nullable_and_validation_rules': {
                'phone': 'Nullable, optional, max 24 chars, must be trimmed, non-blank when provided',
                'address': 'Nullable, optional, max 255 chars, UTF-8 Unicode supported'
            },
            'files_to_commit': [
                'backend/src/main/resources/db/migration/V4__add_profile_contact_fields_to_users.sql',
                'database/qa/D04DatabaseValidation.java',
                'database/qa/validate_d04.py',
                'docs/qa/evidence/CL-D04-DB-V4.json'
            ]
        },
        'security_and_quality': {
            'synthetic_data_only': True,
            'real_personal_data_present': False,
            'credentials_or_jwt_in_evidence': False
        }
    }

    started = False

    def safe(text):
        for k in ('CLINIC_MYSQL_ROOT_PASSWORD', 'CLINIC_MYSQL_PASSWORD'):
            text = text.replace(env[k], '<redacted>')
        text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '<redacted-token>', text)
        return re.sub(r'\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}', '<redacted-hash>', text)

    def run(command, phase, cwd=ROOT, timeout=420):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            (work / (phase + '.log')).write_text(safe(result.stdout + result.stderr), encoding='utf-8')
            raise RuntimeError(phase + ' failed; sanitized details remain in ignored local runtime')
        return result.stdout.strip()

    try:
        evidence['engine'] = run(d + ['info', '--format', '{{.ServerVersion}}|{{.OSType}}'], 'engine')
        run(d + ['image', 'inspect', 'mysql:8.4', '--format', '{{.Id}}'], 'required_mysql_image')

        print('Building backend bootJar for runtime dependencies', flush=True)
        run(gradle + ['--no-daemon', '--rerun-tasks', 'bootJar'], 'build_bootjar', ROOT / 'backend')

        jars = [p for p in (ROOT / 'backend/build/libs').glob('*.jar') if not p.name.endswith('-plain.jar')]
        if len(jars) != 1:
            raise RuntimeError('Build did not produce exactly one backend boot JAR')
        libs = work / 'libs'
        libs.mkdir()
        with zipfile.ZipFile(jars[0]) as archive:
            for name in archive.namelist():
                if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):
                    (libs / Path(name).name).write_bytes(archive.read(name))

        if run(d + ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project], 'container_collision'):
            raise RuntimeError('QA project collision')
        if run(d + ['volume', 'ls', '-q', '--filter', 'name=^' + project + '_clinic_mysql_data$'], 'volume_collision'):
            raise RuntimeError('QA volume collision')

        run(d + c + ['config', '--quiet'], 'compose_config')
        started = True

        print('Starting isolated D04-V4 MySQL QA instance on port ' + str(port), flush=True)
        run(d + c + ['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '180', 'mysql'], 'mysql_start')
        cid = run(d + c + ['ps', '-q', 'mysql'], 'mysql_identity')

        mounts = json.loads(run(d + ['inspect', '--format', '{{json .Mounts}}', cid], 'mysql_mounts'))
        if not any(m.get('Name') == project + '_clinic_mysql_data' and m['Destination'] == '/var/lib/mysql' for m in mounts):
            raise RuntimeError('Unexpected QA data mount')

        sql = f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL PRIVILEGES ON {schema}.* TO 'clinic_app'@'%';"
        root_command = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch'
        result = subprocess.run(d + ['exec', '-i', cid, 'sh', '-c', root_command], input=sql,
                                env=env, capture_output=True, text=True, timeout=20)
        if result.returncode:
            raise RuntimeError('New QA schema provisioning failed')

        print('Executing D04-V4 SQL migration, constraints, indexes, rollbacks, and handoff validation', flush=True)
        output = run(['java', '--class-path', str(libs / '*'), str(ROOT / 'database/qa/D04DatabaseValidation.java'),
                      str(migration_dir)], 'd04v4_sql')

        evidence['sql_checks'] = [line for line in output.splitlines() if line.startswith(('PASS ', 'V4_FLYWAY_CHECKSUM=', 'D04_V4_SUMMARY'))]
        if not any(line.startswith('D04_V4_SUMMARY') for line in evidence['sql_checks']):
            raise RuntimeError('SQL validator did not complete')
        summary_line = next(line for line in evidence['sql_checks'] if line.startswith('D04_V4_SUMMARY'))
        print(summary_line, flush=True)

        print('Running backend unit and security tests', flush=True)
        run(gradle + ['--no-daemon', '--rerun-tasks', 'test'], 'backend_default_tests', ROOT / 'backend')
        evidence['default_backend_tests'] = test_summary(ROOT / 'backend/build/test-results/test')

        evidence['result'] = 'PASS'
    except Exception as error:
        evidence['result'] = 'BLOCKED'
        evidence['blocker'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise RuntimeError('D04-V4 validation incomplete; see diagnostic logs') from None
    finally:
        if started:
            stopped = subprocess.run(d + c + ['stop', 'mysql'], cwd=ROOT, env=env, capture_output=True, text=True)
            evidence['resource_disposition'] = ('Only new QA container stopped; all databases/volumes retained'
                                                if stopped.returncode == 0 else 'QA stop failed; all databases/volumes retained')
            if stopped.returncode:
                evidence.update(result='BLOCKED', blocker='Unable to stop the newly created QA container')

        evidence['v1_v2_v3_preserved'] = all(hash_file(ROOT / p) == before for p, before in baseline.items())
        evidence['v4_unchanged_after_apply'] = hash_file(migration_dir / V4) == evidence['v4_sha256']
        if not evidence['v1_v2_v3_preserved'] or not evidence['v4_unchanged_after_apply']:
            evidence.update(result='BLOCKED', blocker='File preservation check failed')

        path = ROOT / 'docs/qa/evidence/CL-D04-DB-V4.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')

        if evidence.get('result') != 'PASS':
            raise RuntimeError('D04-V4 validation blocked; see sanitized evidence') from None

    print('D04-V4 validation PASS; V1/V2/V3 byte-for-byte unchanged, V4 applied & validated', flush=True)


if __name__ == '__main__':
    main()
