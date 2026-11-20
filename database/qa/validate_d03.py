"""Run D03 validation from a clean source checkout: python database/qa/validate_d03.py.

Requirements: Python 3.10+, Java 21, Docker Linux Engine/Compose, cached mysql:8.4,
and Gradle-wrapper dependency access (network or cache). Windows and POSIX supported.
Tracked prerequisites: docker-compose.yml, .env.example, backend/build.gradle,
backend/settings.gradle, backend/gradlew[.bat], backend/gradle/wrapper/*,
backend/src/main/** and backend/src/test/**. D03 additionally supplies this runner,
D03DatabaseValidation.java, V2, and the V2-aware MySqlMigrationTest.java.

No D02 uncommitted helper, preexisting build/test report, .env secret, or .qa-runtime
file is required. Build/test outputs are regenerated. Runtime diagnostics live in a
new OS temporary directory. Only sanitized docs/qa/evidence/CL-D03-DB.json is written
as the public test artifact. No external BE worktree is read by these core checks.
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
V2 = 'V2__create_specialties_and_doctors.sql'


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
    """A Git archive/source export is valid; Git metadata is not a test dependency."""
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
    """Capture public D02 files if present, in memory; missing optional files are fine."""
    paths = ['.gitignore', 'database/README.md', 'docs/qa/TEST_PLAN.md',
             'database/qa/D02DatabaseValidation.java', 'database/qa/D02StaffFixtures.java',
             'database/qa/staff_fixture_vault.py', 'database/qa/staff_role_fixtures.py',
             'database/qa/validate_d02.py', 'docs/qa/STAFF_ROLE_FIXTURES.md',
             'docs/qa/evidence/CL-D02-STAFF-FIXTURES.json',
             'backend/src/main/resources/db/migration/V1__create_users.sql']
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
    work = Path(tempfile.mkdtemp(prefix='clinic-d03-runtime-'))
    migration_dir = ROOT / 'backend/src/main/resources/db/migration'
    if sorted(p.name for p in migration_dir.glob('*.sql')) != ['V1__create_users.sql', V2]:
        raise RuntimeError('Expected exactly V1 and one V2 migration')
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
    project = 'clinic-d03-db-' + run_id
    schema = 'clinic_d02_be_it_d03_' + run_id
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared DB ports')
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('COMPOSE_', 'DB_', 'SPRING_', 'JWT_', 'CORS_', 'CLINIC_')) or key == 'MYSQL_TEST_MIGRATIONS_LOCATION':
            del env[key]
    env.update(CLINIC_MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32),
               CLINIC_MYSQL_PASSWORD=secrets.token_urlsafe(32), CLINIC_MYSQL_PORT=str(port),
               DB_URL=f'jdbc:mysql://127.0.0.1:{port}/clinic_management_db?connectionTimeZone=UTC',
               DB_FRESH_URL=f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC',
               DB_USERNAME='clinic_app', CLINIC_QA_ACK='NEW_D03_INSTANCE_ONLY')
    env['DB_PASSWORD'] = env['CLINIC_MYSQL_PASSWORD']
    c = ['compose', '-p', project, '-f', str(ROOT / 'docker-compose.yml'), '--env-file', str(ROOT / '.env.example')]
    gradle = ['cmd', '/c', str(ROOT / 'backend/gradlew.bat')] if os.name == 'nt' else ['sh', str(ROOT / 'backend/gradlew')]
    evidence = {'task': 'CL-D03-DB', 'utc': datetime.now(timezone.utc).isoformat(), 'source': context,
                'project': project, 'v1_sha256': hash_file(migration_dir / 'V1__create_users.sql'),
                'v2_sha256': hash_file(migration_dir / V2), 'baseline_file_count': len(baseline),
                'scope': 'Only a new MySQL instance; shared Clinic, staff fixtures and SmartExpense untouched',
                'schema_service_boundary': 'Role/status/active-specialty/ownership and regex validation require BE service checks; not implied by FK',
                'dependencies': {'required_tracked_paths': ['docker-compose.yml', '.env.example', 'backend/build.gradle',
                    'backend/settings.gradle', 'backend/gradlew', 'backend/gradlew.bat', 'backend/gradle/wrapper/',
                    'backend/src/main/', 'backend/src/test/', 'database/qa/D03DatabaseValidation.java',
                    'database/qa/validate_d03.py'],
                    'tools': ['Python 3.10+', 'Java 21', 'Docker Linux Engine with Compose', 'mysql:8.4 image',
                              'Gradle wrapper distribution/dependencies via network or cache'],
                    'requires_uncommitted_d02_files': False, 'requires_existing_qa_runtime': False,
                    'requires_external_be_worktree': False, 'requires_preexisting_build_or_test_results': False},
                'be_d03_catalog_tests': {'status': 'NOT_RUN',
                    'reason': 'D03 BE source is not in this source checkout; earlier 31 external-snapshot tests are not counted as clean-checkout evidence'}}
    started = False

    def safe(text):
        for key in ('CLINIC_MYSQL_ROOT_PASSWORD', 'CLINIC_MYSQL_PASSWORD'):
            text = text.replace(env[key], '<redacted>')
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
        print('Building backend and rerunning default tests from current source', flush=True)
        run(gradle + ['--no-daemon', '--rerun-tasks', 'bootJar', 'test'], 'build_and_default_tests', ROOT / 'backend')
        evidence['default_backend_tests'] = test_summary(ROOT / 'backend/build/test-results/test')
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
        print('Starting NEW D03 MySQL QA instance', flush=True)
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
        print('Testing V1-to-V2 upgrade, fresh install, constraints and rollback', flush=True)
        output = run(['java', '--class-path', str(libs / '*'), str(ROOT / 'database/qa/D03DatabaseValidation.java'),
                      str(migration_dir)], 'd03_sql')
        evidence['sql_checks'] = [line for line in output.splitlines() if line.startswith(('PASS ', 'V2_FLYWAY_CHECKSUM=', 'D03_SUMMARY'))]
        if not any(line.startswith('D03_SUMMARY') for line in evidence['sql_checks']):
            raise RuntimeError('SQL validator did not complete')
        print(next(line for line in evidence['sql_checks'] if line.startswith('D03_SUMMARY')), flush=True)
        env['DB_URL'] = env['DB_FRESH_URL']
        print('Running existing BE MySQL migration/Auth/startup regression with V2', flush=True)
        run(gradle + ['--no-daemon', '--rerun-tasks', 'mysqlTest'], 'qa_mysql_regression', ROOT / 'backend')
        evidence['be_mysql_regression'] = test_summary(ROOT / 'backend/build/test-results/mysqlTest')
        evidence['result'] = 'PASS'
    except Exception as error:
        evidence['result'] = 'BLOCKED'
        evidence['blocker'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise RuntimeError('D03 validation incomplete; see D03-only evidence and OS-temp diagnostic logs') from None
    finally:
        if started:
            stopped = subprocess.run(d + c + ['stop', 'mysql'], cwd=ROOT, env=env, capture_output=True, text=True)
            evidence['resource_disposition'] = ('Only new QA container stopped; all databases/volumes retained'
                                                if stopped.returncode == 0 else 'QA stop failed; all databases/volumes retained')
            if stopped.returncode:
                evidence.update(result='BLOCKED', blocker='Unable to stop the newly created QA container')
        evidence['d02_files_and_v1_preserved'] = all(hash_file(ROOT / p) == before for p, before in baseline.items())
        evidence['v2_unchanged_after_apply'] = hash_file(migration_dir / V2) == evidence['v2_sha256']
        if not evidence['d02_files_and_v1_preserved'] or not evidence['v2_unchanged_after_apply']:
            evidence.update(result='BLOCKED', blocker='File preservation check failed')
        path = ROOT / 'docs/qa/evidence/CL-D03-DB.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        if evidence.get('result') != 'PASS':
            raise RuntimeError('D03 validation blocked; see sanitized evidence') from None
    print('D03 validation PASS; D02 files and V1 byte-for-byte unchanged', flush=True)


if __name__ == '__main__':
    main()
