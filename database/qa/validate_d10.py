"""Run D10 schema checks and backend regression with Java 21 and local Docker MySQL 8.4."""

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
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(MIGRATIONS.glob('V*.sql'))}


def junit(task):
    suites = [ET.parse(p).getroot() for p in (BACKEND / 'build/test-results' / task).glob('TEST-*.xml')]
    total = sum(int(s.get('tests', 0)) for s in suites)
    failed = sum(int(s.get('failures', 0)) + int(s.get('errors', 0)) for s in suites)
    skipped = sum(int(s.get('skipped', 0)) for s in suites)
    if not total:
        raise RuntimeError(f'Missing JUnit results for {task}')
    return {'pass': total - failed - skipped, 'fail': failed, 'skipped': skipped}


def main():
    hashes = migration_hashes()
    if [p.split('__', 1)[0] for p in hashes] != [f'V{i}' for i in range(1, 10)]:
        raise RuntimeError('Expected exactly V1–V9')
    suffix = uuid.uuid4().hex[:12]
    name = 'clinic-d10-qa-' + suffix
    schemas = {key: f'clinic_d02_be_it_d10_{key}_{suffix}' for key in ('regression', 'fresh', 'upgrade')}
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared ports')
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('DB_', 'D10_', 'SPRING_', 'JWT_', 'MYSQL_', 'COMPOSE_', 'CLINIC_', 'CORS_'))}
    env.update(MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32), MYSQL_PASSWORD=secrets.token_urlsafe(32),
               MYSQL_USER='clinic_app', MYSQL_TEST_MIGRATIONS_LOCATION='classpath:db/migration')
    env['DB_PASSWORD'] = env['MYSQL_PASSWORD']
    env['DB_USERNAME'] = env['MYSQL_USER']
    for variable, schema in zip(('DB_URL', 'D10_FRESH_URL', 'D10_UPGRADE_URL'), schemas.values()):
        env[variable] = f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC'
    gradle = ['cmd', '/c', str(BACKEND / 'gradlew.bat')] if os.name == 'nt' else ['sh', str(BACKEND / 'gradlew')]
    evidence = {'task': 'CL-D10-DB', 'migration_sha256': hashes, 'isolated_container': name}
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
        result = run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', 'clinic.qa.task=CL-D10-DB',
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
        result = run(gradle + ['--no-daemon', '--rerun-tasks', 'mysqlTest'])
        evidence['mysql'] = junit('mysqlTest')
        print(json.dumps(evidence['mysql']), flush=True)
        report = BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.MedicalRecordSchemaTest.xml'
        if report.is_file():
            stdout = ET.parse(report).getroot().findtext('system-out', '')
            evidence['v9_flyway_checksums'] = dict(re.findall(r'D10_(FRESH|UPGRADE)_FLYWAY_CHECKSUM=(-?\d+)', stdout))
        if result.returncode:
            raise RuntimeError('MySQL test failed. See local JUnit report.')
        checksums = evidence.get('v9_flyway_checksums', {})
        if set(checksums) != {'FRESH', 'UPGRADE'} or checksums['FRESH'] != checksums['UPGRADE']:
            raise RuntimeError('Missing or mismatched V9 Flyway checksums')
        evidence['result'] = 'PASS'
    except RuntimeError as error:
        evidence.update(result='FAIL', blocker=str(error))
        raise
    finally:
        if started:
            stopped = run(['docker', 'stop', name])
            evidence['container_stopped'] = stopped.returncode == 0
        evidence['migration_bytes_preserved'] = migration_hashes() == hashes
        (ROOT / 'docs/qa/evidence/CL-D10-DB.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        if not evidence['migration_bytes_preserved'] or evidence.get('container_stopped') is False:
            raise RuntimeError('Migration file changed or isolated container stop failed')


if __name__ == '__main__':
    main()
