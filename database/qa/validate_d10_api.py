"""Real D10 Postman/HTTP QA on a newly owned MySQL 8.4 container.

Requires Java 21, Docker, Node, and Newman installed outside tracked files.
Never reads .env. Never connects to an existing database. Credentials stay in memory.
Source is copied into ignored runtime storage; the Backend checkout is read only.
"""
import argparse
import base64
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, required=True)
    parser.add_argument('--newman', type=Path, required=True, help='Newman module directory')
    parser.add_argument('--validated-build', type=Path,
                        help='Reuse a previous owned snapshot only when source, JAR and passing regression evidence match')
    args = parser.parse_args()
    source = args.backend.resolve()
    if not (source / 'src/main/java/com/clinicmanagement/controller/MedicalRecordController.java').is_file():
        raise RuntimeError('D10 Backend source missing')
    hashes = {p.name: digest(p) for p in (ROOT / 'backend/src/main/resources/db/migration').glob('V*.sql')}
    if len(hashes) != 9:
        raise RuntimeError('Expected V1Ã¢â‚¬â€œV9')
    eol_only = []
    for name, sha in hashes.items():
        original = ROOT / 'backend/src/main/resources/db/migration' / name
        counterpart = source / 'src/main/resources/db/migration' / name
        if original.read_text(encoding='utf-8') != counterpart.read_text(encoding='utf-8'):
            raise RuntimeError('Backend migration mismatch: ' + name)
        if digest(counterpart) != sha:
            if name.startswith('V9__'):
                raise RuntimeError('Backend V9 byte mismatch')
            eol_only.append(name)
    suffix = uuid.uuid4().hex[:12]
    runtime = ROOT / '.qa-runtime/d10-api' / suffix
    runtime.mkdir(parents=True)
    ignored = subprocess.run(['git', 'check-ignore', '-q', str(runtime)], cwd=ROOT)
    if ignored.returncode:
        raise RuntimeError('Runtime directory must be Git ignored')
    backend = runtime / 'backend'
    backend.mkdir()
    # Explicit source/build inputs only: excludes .env, build outputs and Git metadata.
    for relative in ('build.gradle', 'settings.gradle', 'gradlew', 'gradlew.bat'):
        if (source / relative).is_file():
            shutil.copy2(source / relative, backend / relative)
    for directory in ('src', 'gradle/wrapper'):
        for path in (source / directory).rglob('*'):
            if path.is_file() and path.suffix in ('.java', '.sql', '.yml', '.yaml', '.properties', '.jar'):
                destination = backend / path.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
    provenance = hashlib.sha256()
    for path in sorted(backend.rglob('*')):
        if path.is_file():
            provenance.update(path.relative_to(backend).as_posix().encode())
            provenance.update(path.read_bytes())
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('DB_', 'D10_', 'SPRING_', 'JWT_', 'MYSQL_', 'COMPOSE_', 'CLINIC_', 'CORS_'))}
    mysql_port, api_port = port(), port()
    if mysql_port in (3306, 3307) or mysql_port == api_port:
        raise RuntimeError('Unsafe port allocation')
    name = 'clinic-d10-api-' + suffix
    schema = 'clinic_d02_be_it_d10_api_' + suffix
    regression = 'clinic_d02_be_it_d10_regression_' + suffix
    env.update(MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32), MYSQL_PASSWORD=secrets.token_urlsafe(32),
               MYSQL_USER='clinic_app', DB_USERNAME='clinic_app', JWT_SECRET=base64.b64encode(secrets.token_bytes(48)).decode(),
               JWT_ISSUER='clinic-management', SERVER_PORT=str(api_port),
               MYSQL_TEST_MIGRATIONS_LOCATION='classpath:db/migration')
    env['DB_PASSWORD'] = env['MYSQL_PASSWORD']
    env['DB_URL'] = f'jdbc:mysql://127.0.0.1:{mysql_port}/{regression}?connectionTimeZone=UTC'
    evidence = {'task': 'CL-D10-LOOKUP-API-REGRESSION', 'migration_sha256': hashes,
                'backend_v9_bytes_identical': True, 'backend_v1_v9_sql_identical': True,
                'backend_older_migrations_eol_only_difference': eol_only,
                'backend_source_sha256': provenance.hexdigest(),
                'container': name, 'database': schema, 'synthetic_only': True}
    evidence['branch'] = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    if evidence['branch'] != 'feature/quynh':
        raise RuntimeError('Expected feature/quynh; no branch changes allowed')
    evidence['backend_contract_sha256'] = digest(source.parent / 'docs/API_CONTRACT.md')
    process = None
    started = False

    def run(command, **kwargs):
        return subprocess.run(command, cwd=backend, env=env, capture_output=True,
                              encoding='utf-8', errors='replace', timeout=600, **kwargs)

    def sql(statement):
        result = run(['docker', 'exec', '-i', name, 'sh', '-c',
                      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot -NB'], input=statement)
        if result.returncode:
            raise RuntimeError('Isolated SQL operation failed (details suppressed)')
        return result.stdout.strip()

    def query(statement):
        return sql(f'USE {schema}; ' + statement)

    base = f'http://127.0.0.1:{api_port}'

    def http(method, path, token=None, body=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(base + '/api/v1' + path,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers, method=method)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read().decode()
        return response.status, json.loads(raw) if raw else {}

    def expect(method, path, token, body, status):
        actual, data = http(method, path, token, body)
        if actual != status:
            raise RuntimeError(f'HTTP assertion failed: {method} {path} expected {status}, actual {actual}')
        return data.get('data', data)

    def junit(task, directory=backend):
        suites = [ET.parse(p).getroot() for p in (directory / 'build/test-results' / task).glob('TEST-*.xml')]
        total = sum(int(s.get('tests', 0)) for s in suites)
        failed = sum(int(s.get('failures', 0)) + int(s.get('errors', 0)) for s in suites)
        skipped = sum(int(s.get('skipped', 0)) for s in suites)
        if not total:
            raise RuntimeError('Missing regression reports')
        return {'pass': total - failed - skipped, 'fail': failed, 'skipped': skipped}

    try:
        launch = run(['docker', 'run', '-d', '--pull=never', '--name', name,
                      '--label', 'clinic.qa.task=CL-D10-FINAL-API-QA',
                      '-p', f'127.0.0.1:{mysql_port}:3306', '-v', name + '-data:/var/lib/mysql',
                      '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_PASSWORD', '-e', 'MYSQL_USER',
                      '-e', f'MYSQL_DATABASE={regression}', 'mysql:8.4', '--default-time-zone=+00:00'])
        if launch.returncode:
            raise RuntimeError('New isolated MySQL launch failed')
        started = True
        for _ in range(90):
            try:
                version = sql('SELECT VERSION()')
                if version.startswith('8.4.'):
                    evidence['mysql_version'] = version
                    break
            except RuntimeError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('MySQL readiness failed')
        sql(f"CREATE DATABASE {schema}; GRANT ALL ON {schema}.* TO 'clinic_app'@'%';")
        build_directory = backend
        if args.validated_build:
            build_directory = args.validated_build.resolve()
            build_directory.relative_to(ROOT / '.qa-runtime/d10-api')
            prior = json.loads((build_directory.parent / 'evidence.json').read_text(encoding='utf-8'))
            if prior['backend_source_sha256'] != evidence['backend_source_sha256']:
                raise RuntimeError('Validated build source fingerprint mismatch')
            for path in backend.rglob('*'):
                if path.is_file() and digest(path) != digest(build_directory / path.relative_to(backend)):
                    raise RuntimeError('Validated build input mismatch')
            for task in ('test', 'mysqlTest'):
                evidence[task] = junit(task, build_directory)
                if evidence[task] != prior[task] or evidence[task]['fail'] or evidence[task]['skipped']:
                    raise RuntimeError('Validated regression report mismatch or nonpassing tests')
            evidence['regression_reused_from_owned_container'] = prior['container']
            print('Reusing verified identical-source passing regression and JAR', flush=True)
        else:
            print('Running real Backend D10 H2/unit and MySQL regression plus bootJar', flush=True)
            result = run(['cmd', '/c', str(backend / 'gradlew.bat'), '--no-daemon', '--rerun-tasks', '--continue', 'test', 'mysqlTest', 'bootJar'])
            (runtime / 'gradle.log').write_text(result.stdout + result.stderr, encoding='utf-8')
            for task in ('test', 'mysqlTest'):
                evidence[task] = junit(task)
                print(task + ': ' + json.dumps(evidence[task]), flush=True)
            if result.returncode:
                raise RuntimeError('Backend regression/build failed; see isolated local JUnit reports')
        jar = next(p for p in (build_directory / 'build/libs').glob('*.jar') if not p.name.endswith('-plain.jar'))
        if args.validated_build and digest(jar) != prior['backend_jar_sha256']:
            raise RuntimeError('Validated JAR fingerprint mismatch')
        evidence['backend_jar_sha256'] = digest(jar)
        # Hash a generated password with the exact Spring Security BCrypt dependency.
        libraries = runtime / 'lib'
        libraries.mkdir()
        with zipfile.ZipFile(jar) as archive:
            for entry in archive.namelist():
                if entry.startswith('BOOT-INF/lib/') and entry.endswith('.jar'):
                    (libraries / Path(entry).name).write_bytes(archive.read(entry))
            if hashlib.sha256(archive.read('BOOT-INF/classes/db/migration/V9__create_medical_records.sql')).hexdigest() != hashes['V9__create_medical_records.sql']:
                raise RuntimeError('Packaged V9 mismatch')
        helper = runtime / 'Hash.java'
        helper.write_text('import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder; class Hash { public static void main(String[] args) throws Exception { var p = new java.io.BufferedReader(new java.io.InputStreamReader(System.in)).readLine(); System.out.print(new BCryptPasswordEncoder(12).encode(p)); }}', encoding='utf-8')
        password = secrets.token_urlsafe(28)
        encoded = run(['java', '-cp', str(libraries / '*'), str(helper)], input=password + '\n')
        if encoded.returncode or not encoded.stdout.startswith('$2'):
            raise RuntimeError('BCrypt generation failed')
        password_hash = encoded.stdout.strip()
        env['DB_URL'] = f'jdbc:mysql://127.0.0.1:{mysql_port}/{schema}?connectionTimeZone=UTC'
        # Fresh schema gets migrated by the real application; Hibernate always validates.
        env['SPRING_JPA_HIBERNATE_DDL_AUTO'] = 'validate'
        env['SERVER_ADDRESS'] = '127.0.0.1'
        with (runtime / 'backend.log').open('w', encoding='utf-8') as output:
            process = subprocess.Popen(['java', '-jar', str(jar)], cwd=backend, env=env,
                                       stdout=output, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(120):
            if process.poll() is not None:
                raise RuntimeError('Backend startup failed; inspect isolated startup log')
            try:
                if http('GET', '/auth/me')[0] == 401:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Backend readiness timeout')
        evidence['hibernate_validate'] = 'PASS'
        history = query('SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank;')
        evidence['flyway_history'] = [line.split('\t') for line in history.splitlines()]
        if len(evidence['flyway_history']) != 9:
            raise RuntimeError('Expected nine applied migrations')
        roles = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'DOCTOR', 'PATIENT', 'PATIENT']
        for index, role in enumerate(roles, 1):
            query(f"INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at) VALUES({index},'d10-{index}@example.test','{password_hash}','Synthetic D10 {index}','{role}','ACTIVE',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6));")
        now = 'UTC_TIMESTAMP(6)'
        query(f"INSERT INTO specialties(id,code,name,is_active,created_at,updated_at) VALUES(1,'D10QA','Synthetic D10 Specialty',1,{now},{now}); "
              f"INSERT INTO doctors(id,user_id,specialty_id,doctor_code,is_active,created_at,updated_at) VALUES(1,3,1,'D10DOC1',1,{now},{now}),(2,4,1,'D10DOC2',1,{now},{now}); "
              f"INSERT INTO patients(id,user_id,patient_code,full_name,is_active,created_at,updated_at) VALUES(1,5,'D10PAT1','Synthetic D10 Patient',1,{now},{now}),(2,6,'D10PAT2','Synthetic Other Patient',1,{now},{now}); "
              f"INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,slot_minutes,status,created_at,updated_at) VALUES(1,1,'2026-11-25','2026-11-25 01:00:00','2026-11-25 10:00:00',30,'ACTIVE',{now},{now});")
        # Dedicated appointments for collection, failure injection, and concurrent requests.
        for index in range(1, 9):
            status = {2: 'PENDING', 3: 'CONFIRMED'}.get(index, 'CHECKED_IN')
            start = f'2026-11-25 {index:02d}:00:00'
            end = f'2026-11-25 {index:02d}:30:00'
            query(f"INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at) VALUES({index},'D10QA-{index}',1,1,1,2,'{start}','{end}','{status}','d10-{index}','{'a' * 64}',{now},{now});")
        tokens = []
        for index, role in enumerate(roles, 1):
            login = expect('POST', '/auth/login', None, {'email': f'd10-{index}@example.test', 'password': password}, 200)
            token = login['accessToken']
            if expect('GET', '/auth/me', token, None, 200)['role'] != role:
                raise RuntimeError('ME role mismatch')
            tokens.append(token)
        admin, receptionist, doctor, other_doctor, patient, other_patient = tokens
        draft = expect('POST', '/medical-records', doctor, {'appointmentId': '4'}, 201)
        collection = ROOT / 'docs/qa/postman/CL-D10-Medical-Records.postman_collection.json'
        variables = dict(zip(('adminToken', 'receptionistToken', 'assignedDoctorToken', 'otherDoctorToken', 'ownerPatientToken', 'otherPatientToken'), tokens))
        variables.update(baseUrl=base, enableD10='true', checkedInAppointmentId='1', pendingAppointmentId='2',
                         confirmedAppointmentId='3', uncompletedRecordId=draft['id'])
        # Newman receives secrets through stdin; only allowlisted status/counts leave the process.
        node = runtime / 'run-newman.cjs'
        node.write_text("""const fs = require('fs'); const input = JSON.parse(fs.readFileSync(0,'utf8'));
const newman = require(input.module);
newman.run({collection: input.collection, environment: {values: Object.entries(input.variables).map(([key,value]) => ({key,value,enabled:true}))}, reporters: [], timeoutRequest:30000}, (err, s) => {
 if (err || !s) { console.log(JSON.stringify({error:'Newman execution failed'})); process.exitCode=1; return; }
 const cases=s.run.executions.map(e=>({name:e.item.name,status:e.response && e.response.code,assertions:(e.assertions||[]).length,failures:(e.assertions||[]).filter(a=>a.error).map(a=>a.assertion)}));
 console.log(JSON.stringify({cases, assertions:s.run.stats.assertions, requestCount:s.run.stats.requests.total, failures:s.run.failures.length}));
 process.exitCode=s.run.failures.length?1:0;
});""", encoding='utf-8')
        result = run(['node', str(node)], input=json.dumps({'module': str(args.newman.resolve()),
                     'collection': str(collection), 'variables': variables}))
        evidence['postman'] = json.loads(result.stdout)
        evidence['postman_collection_sha256'] = digest(collection)
        print('Postman: ' + json.dumps(evidence['postman']), flush=True)
        if result.returncode or evidence['postman'].get('requestCount') != 15:
            raise RuntimeError('Postman assertions failed or not all 15 requests executed')
        # Check lifecycle/negative effects independently in SQL after HTTP requests.
        if query("SELECT CONCAT(a.status,':',m.version,':',m.notes) FROM appointments a JOIN medical_records m ON m.appointment_id=a.id WHERE a.id=1") != 'COMPLETED:2:Synthetic notes D10':
            raise RuntimeError('Completed lifecycle or nonmutation assertion failed')
        if query('SELECT COUNT(*) FROM medical_records WHERE appointment_id IN (2,3)') != '0':
            raise RuntimeError('Invalid-state request persisted a record')
        evidence['lifecycle_sql'] = 'PASS'
        # A populated draft makes accidental metadata disclosure observable.
        expect('PATCH', '/medical-records/' + draft['id'], doctor,
               {'expectedVersion': 0, **{key: 'Synthetic lookup ' + key
                 for key in ('symptoms', 'diagnosis', 'notes', 'conclusion')}}, 200)
        variables.update(lookupDraftAppointmentId='4', lookupDraftRecordId=draft['id'],
                         lookupCompletedAppointmentId='1',
                         lookupCompletedRecordId=query('SELECT id FROM medical_records WHERE appointment_id=1'),
                         lookupMissingAppointmentId='7')
        if query('SELECT COUNT(*) FROM appointments WHERE id=7') != '1' or query('SELECT COUNT(*) FROM medical_records WHERE appointment_id=7') != '0':
            raise RuntimeError('Missing-record lookup fixture must reference an existing appointment')
        tables = ('users', 'specialties', 'doctors', 'patients', 'doctor_schedules',
                  'appointments', 'medical_records')
        # Entire rows include version, clinical content, ownership, timestamps and lifecycle metadata.
        before_get = {table: query(f'SELECT * FROM {table} ORDER BY id') for table in tables}
        lookup_collection = ROOT / 'docs/qa/postman/CL-D10-Lookup.postman_collection.json'
        result = run(['node', str(node)], input=json.dumps({'module': str(args.newman.resolve()),
                     'collection': str(lookup_collection), 'variables': variables}))
        evidence['lookup_postman'] = json.loads(result.stdout)
        evidence['lookup_collection_sha256'] = digest(lookup_collection)
        print('Lookup Postman: ' + json.dumps(evidence['lookup_postman']), flush=True)
        after_get = {table: query(f'SELECT * FROM {table} ORDER BY id') for table in tables}
        evidence['lookup_get_nonmutation'] = {
            'tables': list(tables), 'all_columns_compared': True,
            'unchanged': before_get == after_get,
            'row_counts': {table: int(query(f'SELECT COUNT(*) FROM {table}')) for table in tables}}
        if result.returncode or evidence['lookup_postman'].get('requestCount') != 10:
            raise RuntimeError('Lookup regression failed or not all 10 GET requests executed')
        if before_get != after_get:
            raise RuntimeError('Lookup GET requests changed persisted data')
        record_path = '/medical-records/' + draft['id']
        for token in (admin, receptionist, patient):
            expect('POST', '/medical-records', token, {'appointmentId': '5'}, 403)
            expect('PATCH', record_path, token, {'expectedVersion': 0, 'notes': 'Denied synthetic'}, 403)
            expect('POST', record_path + '/completion', token, {'expectedVersion': 0}, 403)
        expect('POST', '/medical-records', other_doctor, {'appointmentId': '5'}, 404)
        expect('PATCH', record_path, other_doctor, {'expectedVersion': 0, 'notes': 'Denied synthetic'}, 404)
        evidence['write_rbac'] = {'pass': 11, 'fail': 0}
        # Failure injection is restricted to the new owned API schema and always removed.
        query("CREATE TRIGGER d10_reject_create BEFORE INSERT ON medical_records FOR EACH ROW SIGNAL SQLSTATE '23000' SET MYSQL_ERRNO=1062, MESSAGE_TEXT='QA synthetic rejected insert'")
        try:
            expect('POST', '/medical-records', doctor, {'appointmentId': '5'}, 409)
            if query('SELECT status FROM appointments WHERE id=5') != 'CHECKED_IN' or query('SELECT COUNT(*) FROM medical_records WHERE appointment_id=5') != '0':
                raise RuntimeError('Create failure rollback failed')
        finally:
            query('DROP TRIGGER d10_reject_create')
        failure = expect('POST', '/medical-records', doctor, {'appointmentId': '5'}, 201)
        failure_path = '/medical-records/' + failure['id']
        content = {'expectedVersion': 0, 'symptoms': 'Synthetic failure symptoms', 'diagnosis': 'Synthetic failure diagnosis', 'notes': 'Synthetic failure note', 'conclusion': 'Synthetic failure conclusion'}
        expect('PATCH', failure_path, doctor, content, 200)
        query("CREATE TRIGGER d10_reject_complete BEFORE UPDATE ON medical_records FOR EACH ROW SIGNAL SQLSTATE '23000' SET MYSQL_ERRNO=1062, MESSAGE_TEXT='QA synthetic rejected completion'")
        try:
            expect('POST', failure_path + '/completion', doctor, {'expectedVersion': 1}, 409)
            if query("SELECT CONCAT(a.status,':',m.version,':',m.completed_at IS NULL,':',m.completed_by IS NULL) FROM appointments a JOIN medical_records m ON m.appointment_id=a.id WHERE a.id=5") != 'IN_PROGRESS:1:1:1':
                raise RuntimeError('Completion failure rollback failed')
        finally:
            query('DROP TRIGGER d10_reject_complete')
        evidence['real_http_database_failure_rollback'] = {'pass': 2, 'fail': 0}
        def race(method, path, body, expected):
            import threading
            barrier = threading.Barrier(2)
            def contender():
                barrier.wait(timeout=10)
                return http(method, path, doctor, body)[0]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                statuses = sorted([f.result() for f in [pool.submit(contender), pool.submit(contender)]])
            if statuses != sorted(expected):
                raise RuntimeError('Concurrent HTTP outcome mismatch')
            return statuses
        evidence['concurrency'] = {'create': race('POST', '/medical-records', {'appointmentId': '6'}, [201,409])}
        concurrent_id = query('SELECT id FROM medical_records WHERE appointment_id=6')
        concurrent_path = '/medical-records/' + concurrent_id
        evidence['concurrency']['patch'] = race('PATCH', concurrent_path, content, [200,409])
        evidence['concurrency']['complete'] = race('POST', concurrent_path + '/completion', {'expectedVersion': 1}, [200,409])
        evidence['concurrency']['final_consistency'] = query("SELECT CONCAT(a.status,':',m.version) FROM appointments a JOIN medical_records m ON m.appointment_id=a.id WHERE a.id=6") == 'COMPLETED:2'
        if not evidence['concurrency']['final_consistency']:
            raise RuntimeError('Concurrent final consistency failed')
        # Synthetic clinical markers and actual generated secrets must not reach app logs.
        log = (runtime / 'backend.log').read_text(encoding='utf-8', errors='replace')
        if any(value in log for value in [password, password_hash, *tokens, env['MYSQL_PASSWORD'], env['JWT_SECRET'], 'Synthetic notes D10', 'Synthetic failure symptoms', 'Synthetic lookup']):
            raise RuntimeError('Sensitive content appeared in Backend log')
        evidence['log_redaction'] = 'PASS'
        evidence['result'] = 'PASS'
        for key in ('postman', 'lookup_postman'):
            evidence[key]['case_counts'] = {'pass': evidence[key]['requestCount'], 'fail': 0, 'skipped': 0}
        evidence['current_backend_and_postman_case_counts'] = {
            'pass': evidence['test']['pass'] + evidence['mysqlTest']['pass'] + 25, 'fail': 0, 'skipped': 0}
        print('Real HTTP RBAC, lifecycle, rollback and concurrency: PASS', flush=True)
    except Exception as error:
        # No raw HTTP response, subprocess output, SQL or secret-bearing exceptions in evidence.
        evidence['result'] = 'FAIL'
        evidence['blocker'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('QA stopped: ' + evidence['blocker'], flush=True)
        raise RuntimeError(evidence['blocker']) from None
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if started:
            evidence['owned_container_stopped'] = run(['docker', 'stop', name]).returncode == 0
        evidence['volume_retained'] = started
        evidence['recorded_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        evidence['migration_bytes_preserved'] = all(digest(ROOT / 'backend/src/main/resources/db/migration' / n) == h for n,h in hashes.items())
        report = json.dumps(evidence, indent=2) + '\n'
        (runtime / 'evidence.json').write_text(report, encoding='utf-8')
        (ROOT / 'docs/qa/evidence/CL-D10-API.json').write_text(report, encoding='utf-8')


if __name__ == '__main__':
    main()
