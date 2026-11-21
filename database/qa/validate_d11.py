"""Run D11 release-schema checks and backend regression with Java 21 and local Docker MySQL 8.4."""

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
MIGRATIONS = BACKEND / 'src/main/resources/db/migration'


def migration_hashes():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(MIGRATIONS.glob('V*.sql'), key=lambda p: int(p.name.split('__')[0][1:]))}


def junit(task):
    suites = [ET.parse(p).getroot() for p in (BACKEND / 'build/test-results' / task).glob('TEST-*.xml')]
    total = sum(int(s.get('tests', 0)) for s in suites)
    failed = sum(int(s.get('failures', 0)) + int(s.get('errors', 0)) for s in suites)
    skipped = sum(int(s.get('skipped', 0)) for s in suites)
    if not total:
        raise RuntimeError(f'Missing JUnit results for {task}')
    return {'pass': total - failed - skipped, 'fail': failed, 'skipped': skipped}


def main():
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    if branch != 'feature/quynh':
        raise RuntimeError('Expected feature/quynh; no branch changes allowed')
    hashes = migration_hashes()
    if [p.split('__', 1)[0] for p in hashes] != [f'V{i}' for i in range(1, 11)]:
        raise RuntimeError('Expected exactly V1–V10')
    suffix = uuid.uuid4().hex[:12]
    name = 'clinic-d11-qa-' + suffix
    schemas = {key: f'clinic_d02_be_it_d11_{key}_{suffix}' for key in ('regression', 'd10_fresh', 'd10_upgrade', 'fresh', 'upgrade')}
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared ports')
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('DB_', 'D10_', 'D11_', 'SPRING_', 'JWT_', 'MYSQL_', 'COMPOSE_', 'CLINIC_', 'CORS_'))}
    env.update(MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32), MYSQL_PASSWORD=secrets.token_urlsafe(32),
               MYSQL_USER='clinic_app', MYSQL_TEST_MIGRATIONS_LOCATION='classpath:db/migration')
    env['DB_PASSWORD'] = env['MYSQL_PASSWORD']
    env['DB_USERNAME'] = env['MYSQL_USER']
    for variable, schema in zip(('DB_URL', 'D10_FRESH_URL', 'D10_UPGRADE_URL', 'D11_FRESH_URL', 'D11_UPGRADE_URL'), schemas.values()):
        env[variable] = f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC'
    gradle = ['cmd', '/c', str(BACKEND / 'gradlew.bat')] if os.name == 'nt' else ['sh', str(BACKEND / 'gradlew')]
    baseline = {n: hashlib.sha256(subprocess.check_output(
        ['git', 'show', 'HEAD:backend/src/main/resources/db/migration/' + n], cwd=ROOT)).hexdigest()
        for n in hashes if not n.startswith('V10__')}
    if any(hashes[n] != h for n,h in baseline.items()):
        raise RuntimeError('A historical migration differs from HEAD')
    evidence = {'task': 'CL-D11-DB', 'migration_sha256': hashes, 'isolated_container': name,
                'branch': branch, 'baseline_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'v1_v9_sha256_matches_head': True,
                'policy_confirmation': 'User approved legacy backfill and separate assigned-doctor release on 2026-11-22',
                'api_d11': {'status': 'PENDING_BE', 'reason': 'FR-10 proposed; no release/history service or DTO in available Backend'}}
    started = False

    def run(args, **options):
        return subprocess.run(args, cwd=BACKEND, env=env, capture_output=True, encoding='utf-8',
                              errors='replace', timeout=420, **options)

    try:
        print('Running H2 fixture and backend regression', flush=True)
        result = run(gradle + ['--no-daemon', '--rerun-tasks', 'test'])
        evidence['h2_and_unit'] = junit('test')
        print(json.dumps(evidence['h2_and_unit']), flush=True)
        if result.returncode:
            raise RuntimeError('Backend default test failed. See local JUnit report.')
        result = run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', 'clinic.qa.task=CL-D11-DB',
                      '-p', f'127.0.0.1:{port}:3306', '-v', name + '-data:/var/lib/mysql',
                      '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_PASSWORD', '-e', 'MYSQL_USER',
                      '-e', f"MYSQL_DATABASE={schemas['regression']}", 'mysql:8.4', '--default-time-zone=+00:00'])
        if result.returncode:
            raise RuntimeError('New QA MySQL container launch failed')
        started = True
        root_sql = ['docker', 'exec', '-i', name, 'sh', '-c',
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h 127.0.0.1 -uroot -NB']
        for _ in range(60):
            ready = run(root_sql, input='SELECT VERSION()')
            if ready.returncode == 0 and ready.stdout.strip().startswith('8.4.'):
                evidence['mysql_version'] = ready.stdout.strip()
                break
            time.sleep(2)
        else:
            raise RuntimeError('MySQL 8.4 readiness failed')
        sql = '\n'.join(f"CREATE DATABASE {schema}; GRANT ALL ON {schema}.* TO 'clinic_app'@'%';"
                        for key, schema in schemas.items() if key != 'regression')
        if run(root_sql, input=sql).returncode:
            raise RuntimeError('Provisioning isolated schemas failed')
        print('Running MySQL fresh, upgrade, concurrency and backend regression', flush=True)
        result = run(gradle + ['--no-daemon', '--rerun-tasks', 'mysqlTest', 'bootJar'])
        evidence['mysql'] = junit('mysqlTest')
        print(json.dumps(evidence['mysql']), flush=True)
        report = BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.MedicalHistorySchemaTest.xml'
        if report.is_file():
            stdout = ET.parse(report).getroot().findtext('system-out', '')
            evidence['v10_flyway_checksums'] = dict(re.findall(r'D11_(FRESH|UPGRADE)_FLYWAY_CHECKSUM=(-?\d+)', stdout))
        if result.returncode:
            raise RuntimeError('MySQL test failed. See local JUnit report.')
        checksums = evidence.get('v10_flyway_checksums', {})
        if set(checksums) != {'FRESH', 'UPGRADE'} or checksums['FRESH'] != checksums['UPGRADE']:
            raise RuntimeError('Missing or mismatched V10 Flyway checksums')
        print('Checking real Backend startup with ddl-auto=validate on upgraded V10 schema', flush=True)
        validation_env = dict(env, DB_URL=env['D11_UPGRADE_URL'], SPRING_PROFILES_ACTIVE='mysql-validation',
                              SPRING_JPA_HIBERNATE_DDL_AUTO='validate', SERVER_PORT='0', SERVER_ADDRESS='127.0.0.1',
                              JWT_SECRET=__import__('base64').b64encode(secrets.token_bytes(48)).decode())
        runtime = ROOT / '.qa-runtime/d11' / suffix
        runtime.mkdir(parents=True, exist_ok=True)
        log_path = runtime / 'hibernate-validation.log'
        jar = next(p for p in (BACKEND / 'build/libs').glob('*.jar') if not p.name.endswith('-plain.jar'))
        with log_path.open('w', encoding='utf-8') as log:
            app = subprocess.Popen(['java', '-jar', str(jar)], cwd=BACKEND, env=validation_env,
                                   stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(90):
                output = log_path.read_text(encoding='utf-8', errors='replace')
                if re.search(r'Started \w+Application in', output):
                    evidence['hibernate_validate'] = {'status': 'PASS', 'scope': 'Existing D10 entities on V10; release-field Entity mapping pending Backend'}
                    break
                if app.poll() is not None:
                    raise RuntimeError('Hibernate validation startup failed; inspect ignored runtime log')
                time.sleep(1)
            else:
                raise RuntimeError('Hibernate validation startup timed out')
        finally:
            if app.poll() is None:
                app.terminate()
                app.wait(timeout=20)
        evidence['result'] = 'PASS'
    except RuntimeError as error:
        evidence.update(result='FAIL', blocker=str(error))
        raise
    finally:
        if started:
            stopped = run(['docker', 'stop', '--timeout', '60', name])
            evidence['container_stopped'] = stopped.returncode == 0
        evidence['migration_bytes_preserved'] = migration_hashes() == hashes
        (ROOT / 'docs/qa/evidence/CL-D11-DB.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        if not evidence['migration_bytes_preserved'] or evidence.get('container_stopped') is False:
            raise RuntimeError('Migration file changed or isolated container stop failed')


if __name__ == '__main__':
    main()
