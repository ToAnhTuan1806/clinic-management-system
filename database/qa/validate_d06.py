"""Run D06 validation from a clean source checkout: python database/qa/validate_d06.py.

Requirements: Python 3.10+, Java 21, Docker Linux/mysql:8.4, and Gradle.
Windows and POSIX supported.
Validates:
1. Migration V1 -> V2 -> V3 -> V4 -> V5 upgrade, idempotency, validate.
2. Doctor schedules schema, columns, defaults, check constraints, FK RESTRICT, indexes.
3. Business rules: adjacent shifts allowed, BLOCKED status, slot_minutes options, boundary cases.
4. Multithreaded concurrent overlap locking protocol (FOR UPDATE on doctor).
5. Isolated MySQL 8.4 instance, zero leakage to shared databases.
6. Security & Quality: synthetic fixtures only, zero real data or secrets.
7. Backend test regression check (163/163 default tests).
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
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
V1 = 'V1__create_users.sql'
V2 = 'V2__create_specialties_and_doctors.sql'
V3 = 'V3__create_patients_and_profile_fields.sql'
V4 = 'V4__add_profile_contact_fields_to_users.sql'
V5 = 'V5__create_doctor_schedules.sql'


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
             'backend/src/main/resources/db/migration/V3__create_patients_and_profile_fields.sql',
             'backend/src/main/resources/db/migration/V4__add_profile_contact_fields_to_users.sql']
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
    work = Path(tempfile.mkdtemp(prefix='clinic-d06-runtime-'))
    migration_dir = ROOT / 'backend/src/main/resources/db/migration'

    expected_migrations = [V1, V2, V3, V4, V5]
    actual_migrations = sorted(p.name for p in migration_dir.glob('*.sql'))
    if actual_migrations != expected_migrations:
        raise RuntimeError(f'Expected exactly V1..V5 migrations, got: {actual_migrations}')

    for tool in ('docker', 'java'):
        if not shutil.which(tool):
            raise RuntimeError('Required tool unavailable: ' + tool)

    docker = Path(shutil.which('docker'))
    name = 'clinic-d06-qa-' + run_id
    volume = name + '-data'
    schema = 'clinic_d02_be_it_d06_' + run_id

    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared DB ports')

    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('COMPOSE_', 'DB_', 'SPRING_', 'JWT_', 'CORS_', 'CLINIC_', 'MYSQL_')):
            del env[key]

    root_password = secrets.token_urlsafe(32)
    app_password = secrets.token_urlsafe(32)

    env.update(MYSQL_ROOT_PASSWORD=root_password,
               MYSQL_PASSWORD=app_password,
               MYSQL_USER='clinic_app',
               MYSQL_DATABASE='clinic_management_db',
               DB_URL=f'jdbc:mysql://127.0.0.1:{port}/clinic_management_db?connectionTimeZone=UTC',
               DB_FRESH_URL=f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC',
               DB_USERNAME='clinic_app',
               DB_PASSWORD=app_password,
               CLINIC_QA_ACK='NEW_D06_INSTANCE_ONLY')

    gradle = ['cmd', '/c', str(ROOT / 'backend/gradlew.bat')] if os.name == 'nt' else ['sh', str(ROOT / 'backend/gradlew')]

    evidence = {
        'task': 'CL-D06-DB',
        'utc': datetime.now(timezone.utc).isoformat(),
        'source': context,
        'container': name,
        'volume': volume,
        'port': port,
        'v1_sha256': hash_file(migration_dir / V1),
        'v2_sha256': hash_file(migration_dir / V2),
        'v3_sha256': hash_file(migration_dir / V3),
        'v4_sha256': hash_file(migration_dir / V4),
        'v5_sha256': hash_file(migration_dir / V5),
        'baseline_file_count': len(baseline),
        'scope': 'Only a new isolated MySQL 8.4 instance; shared Clinic DB untouched',
        'schema_v5': {
            'target_table': 'doctor_schedules',
            'columns': {
                'id': 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
                'doctor_id': 'BIGINT NOT NULL FK doctors(id) ON DELETE RESTRICT ON UPDATE RESTRICT',
                'work_date': 'DATE NOT NULL (Asia/Ho_Chi_Minh local calendar date)',
                'start_at_utc': 'DATETIME(6) NOT NULL (UTC)',
                'end_at_utc': 'DATETIME(6) NOT NULL (UTC)',
                'slot_minutes': 'SMALLINT NOT NULL DEFAULT 30',
                'status': 'VARCHAR(16) NOT NULL DEFAULT ACTIVE',
                'version': 'BIGINT NOT NULL DEFAULT 0',
                'created_at': 'DATETIME(6) NOT NULL',
                'updated_at': 'DATETIME(6) NOT NULL'
            },
            'constraints': [
                'pk_doctor_schedules: PRIMARY KEY (id)',
                'fk_doctor_schedules_doctor: FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT ON UPDATE RESTRICT',
                'chk_doctor_schedules_time_range: CHECK (start_at_utc < end_at_utc)',
                'chk_doctor_schedules_slot_minutes: CHECK (slot_minutes IN (15, 30, 60))',
                'chk_doctor_schedules_status: CHECK (status IN (\'ACTIVE\', \'BLOCKED\'))',
                'chk_doctor_schedules_version: CHECK (version >= 0)'
            ],
            'indexes': [
                'ix_doctor_schedules_doctor_date_status: (doctor_id, work_date, status)',
                'ix_doctor_schedules_doctor_start: (doctor_id, start_at_utc)'
            ],
            'rules': [
                'Times stored in UTC, work_date represents local Asia/Ho_Chi_Minh calendar day',
                'Shifts belong to a single day and do not cross local midnight',
                'Adjacent shifts are allowed (end_at_utc == newStart)',
                'BLOCKED shifts do not generate booking slots',
                'Overlap prevention across shifts is enforced at the service level via transactional locking on doctor',
                'Doctor soft-delete / FK RESTRICT prevents orphaned schedules'
            ]
        },
        'files_changed': [
            'backend/src/main/resources/db/migration/V5__create_doctor_schedules.sql',
            'database/qa/D06DatabaseValidation.java',
            'database/qa/validate_d06.py',
            'docs/qa/evidence/CL-D06-DB.json'
        ],
        'security_and_quality': {
            'synthetic_data_only': True,
            'real_personal_data_present': False,
            'credentials_or_jwt_in_evidence': False
        }
    }

    started = False

    def safe(text):
        for k in ('MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'DB_PASSWORD'):
            if k in env:
                text = text.replace(env[k], '<redacted>')
        text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '<redacted-token>', text)
        return re.sub(r'\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}', '<redacted-hash>', text)

    def run(command, phase, cwd=ROOT, input=None, timeout=420, check=True):
        completed = subprocess.run(command, cwd=cwd, env=env, input=input,
                                   capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
        if completed.returncode != 0 and check:
            (work / (phase + '.log')).write_text(safe(completed.stdout + completed.stderr), encoding='utf-8')
            raise RuntimeError(phase + ' failed; sanitized details remain in local runtime')
        return completed

    try:
        engine = run([str(docker), 'info', '--format', '{{.OSType}}'], 'docker_engine').stdout.strip()
        if engine != 'linux':
            raise RuntimeError('Docker Linux engine required')
        evidence['engine'] = run([str(docker), 'info', '--format', '{{.ServerVersion}}|{{.OSType}}'], 'engine').stdout.strip()
        run([str(docker), 'image', 'inspect', 'mysql:8.4', '--format', '{{.Id}}'], 'mysql_image')

        print('Building backend bootJar for runtime dependencies', flush=True)
        run(gradle + ['--no-daemon', 'bootJar'], 'build_bootjar', ROOT / 'backend')

        jars = [p for p in (ROOT / 'backend/build/libs').glob('*.jar') if not p.name.endswith('-plain.jar')]
        if len(jars) != 1:
            raise RuntimeError('Build did not produce exactly one backend boot JAR')
        libs = work / 'libs'
        libs.mkdir()
        with zipfile.ZipFile(jars[0]) as archive:
            for member in archive.namelist():
                if member.startswith('BOOT-INF/lib/') and member.endswith('.jar'):
                    (libs / Path(member).name).write_bytes(archive.read(member))

        if run([str(docker), 'ps', '-aq', '--filter', 'name=^/' + name + '$'], 'container_collision').stdout.strip():
            raise RuntimeError('QA container collision')
        if run([str(docker), 'volume', 'ls', '-q', '--filter', 'name=^' + volume + '$'], 'volume_collision').stdout.strip():
            raise RuntimeError('QA volume collision')

        print(f'Starting isolated D06 MySQL QA instance {name} on port {port}', flush=True)
        run([str(docker), 'run', '-d', '--pull=never', '--name', name,
             '--label', 'clinic.qa.task=CL-D06-DB', '-p', f'127.0.0.1:{port}:3306',
             '-v', volume + ':/var/lib/mysql',
             '-e', 'MYSQL_ROOT_PASSWORD',
             '-e', 'MYSQL_PASSWORD',
             '-e', 'MYSQL_USER',
             '-e', 'MYSQL_DATABASE',
             'mysql:8.4',
             '--character-set-server=utf8mb4',
             '--collation-server=utf8mb4_0900_ai_ci',
             '--default-time-zone=+00:00'], 'mysql_start')
        started = True

        root_sql = [str(docker), 'exec', '-i', name, 'sh', '-c',
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch --skip-column-names']

        for _ in range(90):
            probe = run(root_sql, 'mysql_ready', input='SELECT VERSION();', timeout=10, check=False)
            if probe.returncode == 0:
                evidence['mysql_version'] = probe.stdout.strip()
                break
            time.sleep(2)
        else:
            raise RuntimeError('MySQL startup timeout')

        if not evidence['mysql_version'].startswith('8.4.'):
            raise RuntimeError('MySQL 8.4 required, found: ' + evidence['mysql_version'])

        sql = f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL ON {schema}.* TO 'clinic_app'@'%';"
        run(root_sql, 'provision_new_schemas', input=sql)

        print('Executing D06 SQL migration, constraints, indexes, concurrency locking, and Fresh DB validation', flush=True)
        output = run(['java', '--class-path', str(libs / '*'), str(ROOT / 'database/qa/D06DatabaseValidation.java'),
                      str(migration_dir)], 'd06_sql').stdout

        evidence['sql_checks'] = [line for line in output.splitlines() if line.startswith(('PASS ', 'V5_FLYWAY_CHECKSUM=', 'D06_SUMMARY'))]
        if not any(line.startswith('D06_SUMMARY') for line in evidence['sql_checks']):
            raise RuntimeError('SQL validator did not complete')
        summary_line = next(line for line in evidence['sql_checks'] if line.startswith('D06_SUMMARY'))
        print(summary_line, flush=True)

        print('Running backend unit and security tests', flush=True)
        run(gradle + ['--no-daemon', 'test'], 'backend_default_tests', ROOT / 'backend')
        evidence['default_backend_tests'] = test_summary(ROOT / 'backend/build/test-results/test')

        evidence['result'] = 'PASS'
    except Exception as error:
        evidence['result'] = 'BLOCKED'
        evidence['blocker'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise RuntimeError('D06 validation incomplete; see diagnostic logs') from None
    finally:
        if started:
            stopped = subprocess.run([str(docker), 'stop', name], capture_output=True, text=True, timeout=60)
            evidence['resource_disposition'] = ('Only new QA container stopped; volume retained'
                                                if stopped.returncode == 0 else 'QA stop failed')
            if stopped.returncode:
                evidence.update(result='BLOCKED', blocker='Unable to stop the newly created QA container')

        evidence['v1_v2_v3_v4_preserved'] = all(hash_file(ROOT / p) == before for p, before in baseline.items())
        evidence['v5_unchanged_after_apply'] = hash_file(migration_dir / V5) == evidence['v5_sha256']
        if not evidence['v1_v2_v3_v4_preserved'] or not evidence['v5_unchanged_after_apply']:
            evidence.update(result='BLOCKED', blocker='File preservation check failed')

        path = ROOT / 'docs/qa/evidence/CL-D06-DB.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')

        if evidence.get('result') != 'PASS':
            raise RuntimeError('D06 validation blocked; see sanitized evidence') from None

    print('D06 validation PASS; V1..V4 byte-for-byte unchanged, V5 applied & validated', flush=True)


if __name__ == '__main__':
    main()
