"""Run D12 prescription schema checks and backend regression with Java 21 and local Docker MySQL 8.4."""

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


def main(d13=False):
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    if branch != 'feature/quynh':
        raise RuntimeError('Expected feature/quynh; no branch changes allowed')

    hashes = migration_hashes()
    expected_versions = [f'V{i}' for i in range(1, 13 if d13 else 12)]
    actual_versions = [p.split('__', 1)[0] for p in hashes]
    if actual_versions != expected_versions:
        raise RuntimeError(f'Expected migrations V1–V11, got: {actual_versions}')

    baseline = {n: hashlib.sha256(subprocess.check_output(
        ['git', 'show', 'HEAD:backend/src/main/resources/db/migration/' + n], cwd=ROOT)).hexdigest()
        for n in hashes}
    if any(hashes[n] != h for n, h in baseline.items()):
        raise RuntimeError('A migration V1–V11 differs from HEAD')

    suffix = uuid.uuid4().hex[:12]
    name = ('clinic-d13-qa-' if d13 else 'clinic-d12-qa-') + suffix
    schema_keys = ('regression', 'd10_fresh', 'd10_upgrade', 'd11_fresh', 'd11_upgrade', 'd11_api_upgrade', 'fresh', 'upgrade')
    if d13:
        schema_keys += ('d13_fresh', 'd13_upgrade', 'dashboard')
    schemas = {key: f'clinic_d02_be_it_d{13 if d13 else 12}_{key}_{suffix}' for key in schema_keys}

    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    if port in (3306, 3307):
        raise RuntimeError('Refusing shared ports')

    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('DB_', 'D10_', 'D11_', 'D12_', 'D13_', 'SPRING_', 'JWT_', 'MYSQL_', 'COMPOSE_', 'CLINIC_', 'CORS_'))}
    env.update(
        MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32),
        MYSQL_PASSWORD=secrets.token_urlsafe(32),
        MYSQL_USER='clinic_app',
        MYSQL_TEST_MIGRATIONS_LOCATION='classpath:db/migration'
    )
    env['DB_PASSWORD'] = env['MYSQL_PASSWORD']
    env['DB_USERNAME'] = env['MYSQL_USER']
    env['DB_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["regression"]}?connectionTimeZone=UTC'
    env['D10_FRESH_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["d10_fresh"]}?connectionTimeZone=UTC'
    env['D10_UPGRADE_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["d10_upgrade"]}?connectionTimeZone=UTC'
    env['D11_FRESH_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["d11_fresh"]}?connectionTimeZone=UTC'
    env['D11_UPGRADE_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["d11_upgrade"]}?connectionTimeZone=UTC'
    env['D11_API_UPGRADE_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["d11_api_upgrade"]}?connectionTimeZone=UTC'
    env['D12_FRESH_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["fresh"]}?connectionTimeZone=UTC'
    env['D12_UPGRADE_URL'] = f'jdbc:mysql://127.0.0.1:{port}/{schemas["upgrade"]}?connectionTimeZone=UTC'

    if d13:
        for variable, key in [('D13_FRESH_URL','d13_fresh'),('D13_UPGRADE_URL','d13_upgrade'),('D13_DASHBOARD_URL','dashboard')]:
            env[variable] = f'jdbc:mysql://127.0.0.1:{port}/{schemas[key]}?connectionTimeZone=UTC'

    gradle = ['cmd', '/c', str(BACKEND / 'gradlew.bat')] if os.name == 'nt' else ['sh', str(BACKEND / 'gradlew')]
    started = False

    def run(args, **options):
        return subprocess.run(args, cwd=BACKEND, env=env, capture_output=True, encoding='utf-8',
                              errors='replace', timeout=420, **options)

    try:
        print('1. Running H2 fixture and backend regression (test)', flush=True)
        res_test = run(gradle + ['--no-daemon', '--rerun-tasks', 'test'])
        h2_results = junit('test')
        print(f"H2 & Unit regression: {json.dumps(h2_results)}", flush=True)
        if res_test.returncode != 0:
            raise RuntimeError('Backend default test failed')

        print('2. Launching isolated MySQL 8.4 container', flush=True)
        res_docker = run(['docker', 'run', '-d', '--pull=never', '--name', name, '--label', f'clinic.qa.task=CL-D{13 if d13 else 12}-DB',
                          '-p', f'127.0.0.1:{port}:3306', '-v', name + '-data:/var/lib/mysql',
                          '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_PASSWORD', '-e', 'MYSQL_USER',
                          '-e', f"MYSQL_DATABASE={schemas['regression']}", 'mysql:8.4', '--default-time-zone=+00:00'])
        if res_docker.returncode != 0:
            raise RuntimeError('MySQL container launch failed')
        started = True

        root_sql = ['docker', 'exec', '-i', name, 'sh', '-c',
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h 127.0.0.1 -uroot -NB']

        for _ in range(60):
            ready = run(root_sql, input='SELECT VERSION()')
            if ready.returncode == 0 and ready.stdout.strip().startswith('8.4.11'):
                print(f"MySQL version ready: {ready.stdout.strip()}", flush=True)
                break
            time.sleep(2)
        else:
            raise RuntimeError('MySQL 8.4 readiness check timed out')

        sql_provision = '\n'.join(f"CREATE DATABASE {s}; GRANT ALL ON {s}.* TO 'clinic_app'@'%';"
                                  for key, s in schemas.items() if key != 'regression')
        if run(root_sql, input=sql_provision).returncode != 0:
            raise RuntimeError('Provisioning isolated databases failed')

        print('3. Running MySQL fresh, upgrade, schema constraints and regression (mysqlTest)', flush=True)
        res_mysql = run(gradle + ['--no-daemon', '--rerun-tasks', 'mysqlTest'])
        mysql_results = junit('mysqlTest')
        print(f"MySQL integration results: {json.dumps(mysql_results)}", flush=True)
        if res_mysql.returncode != 0:
            raise RuntimeError('MySQL integration test failed. Check JUnit test reports.')

        report_d12 = BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.PrescriptionSchemaTest.xml'
        if report_d12.is_file():
            stdout = ET.parse(report_d12).getroot().findtext('system-out', '')
            checksums = dict(re.findall(r'D12_(FRESH|UPGRADE)_FLYWAY_CHECKSUM=(-?\d+)', stdout))
            print(f"V11 Flyway Checksums: {checksums}", flush=True)
            if set(checksums.keys()) != {'FRESH', 'UPGRADE'} or set(checksums.values()) != {'1308329671'}:
                raise RuntimeError(f"Flyway checksum mismatch between FRESH and UPGRADE: {checksums}")
        else:
            raise RuntimeError('Missing PrescriptionSchemaTest JUnit report')

        if d13:
            report = BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.NotificationSchemaTest.xml'
            output = ET.parse(report).getroot().findtext('system-out', '')
            v12_checksums = dict(re.findall(r'D13_(FRESH|UPGRADE)_FLYWAY_CHECKSUM=(-?\d+)', output))
            if set(v12_checksums) != {'FRESH','UPGRADE'} or set(v12_checksums.values()) != {'-1847747136'}:
                raise RuntimeError('V12 fresh/upgrade checksum mismatch')
            print(f'V12 Flyway checksums: {v12_checksums}', flush=True)
            api = ET.parse(BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.MySqlAppointmentIntegrationTest.xml').getroot()
            required = {
                'd13DashboardPermissionsEmptyDatesAndDefaultVietnamDay',
                'd13DashboardUsesVietnamBoundariesStatusTotalsDistinctPatientsAndDoctorScope',
                'd13DashboardMonthYearResponsesMatchIndependentSql',
                'd13NotificationEventsPaginationOwnershipReadAndRetry',
                'd13ConcurrentBookingAndConfirmationDoNotDuplicateNotifications',
                'd13NotificationWriteFailuresRollbackEveryAppointmentMutation',
                'd13NotificationsSkipDisabledAndUnlinkedPatientAccounts'}
            executed = {case.get('name', '').split('(')[0] for case in api.findall('testcase')
                        if case.find('skipped') is None and case.find('failure') is None and case.find('error') is None}
            if not required.issubset(executed):
                raise RuntimeError('D13 real HTTP acceptance groups missing or not passing')
            print('D13 real Spring Boot/MySQL HTTP groups: 7 PASS (QA01-QA15)', flush=True)

        # These tests launch the actual Spring Boot server on a random loopback port,
        # send java.net.http requests, use MySQL V11 and keep ddl-auto=validate.
        api_report = BACKEND / 'build/test-results/mysqlTest/TEST-com.clinicmanagement.MySqlPrescriptionIntegrationTest.xml'
        if not api_report.is_file():
            raise RuntimeError('Missing real HTTP prescription integration report')
        api_suite = ET.parse(api_report).getroot()
        if int(api_suite.get('tests', 0)) < 20 or any(int(api_suite.get(k, 0)) for k in ('failures', 'errors', 'skipped')):
            raise RuntimeError('Prescription HTTP cases failed, skipped or were not fully executed')
        print(f'Real HTTP prescription integration cases: {api_suite.get("tests")} PASS; Hibernate validate startup PASS', flush=True)

        def sql(statement):
            result = run(root_sql, input=statement)
            if result.returncode:
                raise RuntimeError('Owned QA persistence SQL failed (details suppressed)')
            return result.stdout.strip()

        def snapshot():
            snapshots = {key: sql(f'USE {schemas[key]}; SELECT * FROM prescriptions ORDER BY id; '
                             'SELECT * FROM prescription_items ORDER BY id; '
                             'SELECT * FROM medical_records ORDER BY id; '
                             'SELECT * FROM flyway_schema_history ORDER BY installed_rank;')
                    for key in ('fresh', 'upgrade')}
            if d13:
                for key in ('d13_fresh','d13_upgrade','dashboard'):
                    snapshots[key] = sql(f'USE {schemas[key]}; SELECT * FROM notifications ORDER BY id; SELECT * FROM appointments ORDER BY id; SELECT * FROM medical_records ORDER BY id; SELECT * FROM prescriptions ORDER BY id; SELECT * FROM prescription_items ORDER BY id; SELECT * FROM flyway_schema_history ORDER BY installed_rank;')
            return snapshots

        if int(sql(f'SELECT COUNT(*) FROM {schemas["fresh"]}.prescription_items;')) == 0:
            raise RuntimeError('Persistence check requires nonempty prescription items')
        before_restart = snapshot()

        print('4. Verifying post-restart MySQL container data persistence', flush=True)
        if run(['docker', 'stop', '--timeout', '60', name]).returncode:
            raise RuntimeError('Owned QA stop failed')
        if run(['docker', 'start', name]).returncode:
            raise RuntimeError('Owned QA restart failed')
        for _ in range(60):
            ready = run(root_sql, input='SELECT VERSION()')
            if ready.returncode == 0 and ready.stdout.strip().startswith('8.4.'):
                break
            time.sleep(2)
        else:
            raise RuntimeError('Post-restart readiness check timed out')

        flyway_v11_fresh = sql(f"SELECT checksum FROM {schemas['fresh']}.flyway_schema_history WHERE version='11';")
        flyway_v11_upg = sql(f"SELECT checksum FROM {schemas['upgrade']}.flyway_schema_history WHERE version='11';")
        if flyway_v11_fresh != '1308329671' or flyway_v11_upg != '1308329671' or snapshot() != before_restart:
            raise RuntimeError('Post-restart checksum or prescription/record persistence mismatch')
        print(f"Post-restart checksums verified: fresh={flyway_v11_fresh}, upgrade={flyway_v11_upg}", flush=True)

        print('5. D12 FR-11 real HTTP QA01–QA15 covered by prescription and existing regression tests: PASS', flush=True)

        if d13:
            for key in ('d13_fresh','d13_upgrade'):
                if sql(f"SELECT checksum FROM {schemas[key]}.flyway_schema_history WHERE version='12';") != v12_checksums['FRESH']:
                    raise RuntimeError('V12 checksum changed after restart')
            print('D13 schema, real HTTP acceptance QA01-QA15 and restart persistence: PASS', flush=True)

        print('ALL D12 DATABASE QA CHECKS PASSED SUCCESSFULLY.', flush=True)
    finally:
        if started:
            if run(['docker', 'stop', '--timeout', '60', name]).returncode:
                raise RuntimeError('Owned QA final stop failed')
            print('Isolated MySQL container stopped cleanly.', flush=True)
        if migration_hashes() != hashes:
            raise RuntimeError('Migration bytes changed during QA')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--d13', action='store_true', help='Also validate V12 notifications and Dashboard SQL on extra isolated schemas')
    main(parser.parse_args().d13)
