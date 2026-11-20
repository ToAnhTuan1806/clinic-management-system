"""Real D03 fixtures; repeat 'provision' to verify/reuse the SAME scoped QA stack.

Host Windows PowerShell: python database/qa/provision_d03_catalog.py provision
Private GUI: python database/qa/provision_d03_catalog.py access
Requires Java 21, Docker Linux/Compose, cached mysql:8.4 and eclipse-temurin:21-jre-alpine,
and the local committed BE ref (default feature/tuan). No fetch or branch mutation.
No dependency on D02's uncommitted vault/helper files. No .env secret file is read.
Never use this utility to point at an arbitrary database: endpoints come only from
the current-user Windows vault for its generated, labelled QA scope.
"""
import argparse
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from d03_catalog_vault import PREFIX, read, view, write

ROOT = Path(__file__).resolve().parents[2]
ACTORS = ('ADMIN', 'RECEPTIONIST', 'PATIENT', 'DOCTOR_LINKED', 'DOCTOR_ELIGIBLE', 'DOCTOR_INACTIVE', 'DOCTOR_CRUD')
RECIPE = 'CL_D03_CATALOG_V1'
MIGRATIONS = ('V1__create_users.sql', 'V2__create_specialties_and_doctors.sql')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    return free_port() if port in (3306, 3307, 8080) else port


def clean_environment():
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('DB_', 'CLINIC_', 'SPRING_', 'JWT_', 'CORS_', 'COMPOSE_', 'QA_')):
            del env[key]
    return env


def run(command, operation, env=None, cwd=ROOT, timeout=300):
    r = subprocess.run(command, cwd=cwd, env=env or clean_environment(), capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if r.returncode:
        # No command, response body or process environment is printed.
        raise RuntimeError(operation + ' failed (exit ' + str(r.returncode) + ')')
    return r.stdout.strip()


def build_snapshot(ref):
    commit = run(['git', 'rev-parse', ref], 'Resolve committed BE ref')
    controller = run(['git', 'show', commit + ':backend/src/main/java/com/clinicmanagement/controller/DoctorController.java'], 'Read D03 controller')
    contract = run(['git', 'show', commit + ':docs/API_CONTRACT.md'], 'Read D03 contract')
    if 'eligible-users' not in controller or 'IMPLEMENTED D03' not in contract:
        raise RuntimeError('Committed D03 eligible-users implementation/contract is missing')
    for name in MIGRATIONS:
        data = subprocess.check_output(['git', 'show', commit + ':backend/src/main/resources/db/migration/' + name], cwd=ROOT)
        if (ROOT / 'backend/src/main/resources/db/migration' / name).read_bytes().replace(b'\r\n', b'\n') != data.replace(b'\r\n', b'\n'):
            raise RuntimeError('BE and QA migration differ; no provisioning attempted')
    cache = ROOT / '.qa-runtime/d03-catalog-build.json'
    if cache.exists():
        context = json.loads(cache.read_text(encoding='utf-8'))
        if context.get('backend_commit') == commit:
            jars = list((Path(context['source']) / 'build/libs').glob('*.jar'))
            if len(jars) == 1:
                return context, jars[0]
    work = ROOT / '.qa-runtime/d03-catalog' / uuid.uuid4().hex[:12]
    source = work / 'source'; source.mkdir(parents=True)
    data = subprocess.check_output(['git', 'archive', '--format=tar', commit, 'backend', 'docs/API_CONTRACT.md'], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        if any(Path(m.name).name == '.env' or (Path(m.name).name.startswith('.env.') and Path(m.name).name != '.env.example') for m in archive.getmembers()):
            raise RuntimeError('Refusing an archive containing environment files')
        archive.extractall(source, filter='data')
    print('Building a frozen committed D03 BE snapshot, without changing branches', flush=True)
    run(['cmd', '/c', str(source / 'backend/gradlew.bat'), '--no-daemon', 'bootJar'], 'Build committed BE snapshot', cwd=source / 'backend', timeout=420)
    jars = [p for p in (source / 'backend/build/libs').glob('*.jar') if not p.name.endswith('-plain.jar')]
    if len(jars) != 1:
        raise RuntimeError('Expected one D03 boot JAR')
    context = {'backend_commit': commit, 'work': str(work), 'source': str(source / 'backend'),
               'contract_sha256': sha(source / 'docs/API_CONTRACT.md')}
    cache.write_text(json.dumps(context, indent=2) + '\n', encoding='utf-8')
    return context, jars[0]


def new_bundle(ref):
    context, jar = build_snapshot(ref)
    fixture_id = uuid.uuid4().hex[:12]
    port, api_port = free_port(), free_port()
    while api_port == port:
        api_port = free_port()
    return {'recipe': RECIPE, 'fixture_id': fixture_id, 'project': 'clinic-d03-fixtures-' + fixture_id,
            'backend_commit': context['backend_commit'], 'contract_sha256': context['contract_sha256'],
            'jar_path': str(jar), 'jar_sha256': sha(jar), 'source': context['source'],
            'api_base_url': f'http://127.0.0.1:{api_port}',
            'db_url': f'jdbc:mysql://127.0.0.1:{port}/clinic_management_db?connectionTimeZone=UTC',
            'db_password': secrets.token_urlsafe(32), 'db_root_password': secrets.token_urlsafe(32),
            'jwt_secret': base64.b64encode(secrets.token_bytes(48)).decode(),
            'jwt_issuer': 'clinic-d03-fixtures-' + fixture_id,
            'cors_origins': ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
            'accounts': {actor: {'email': f'd03-{fixture_id}-{actor.lower()}@example.test',
                         'password': 'Qa!' + secrets.token_urlsafe(30),
                         'role': 'DOCTOR' if actor.startswith('DOCTOR_') else actor, 'status': 'ACTIVE'} for actor in ACTORS},
            'migration_sha256': {name: sha(ROOT / 'backend/src/main/resources/db/migration' / name) for name in MIGRATIONS}}


class Stack:
    def __init__(self, bundle):
        self.b = bundle
        if bundle.get('recipe') != RECIPE or not re.fullmatch('[a-f0-9]{12}', bundle['fixture_id']) or bundle['project'] != 'clinic-d03-fixtures-' + bundle['fixture_id']:
            raise RuntimeError('Unrelated/unidentified QA scope')
        self.project = bundle['project']
        self.mysql = self.project + '-mysql-1'
        self.backend = self.project + '-backend'
        self.work = ROOT / '.qa-runtime/d03-catalog-runtime' / bundle['fixture_id']
        self.work.mkdir(parents=True, exist_ok=True)
        docker = Path(shutil.which('docker') or '')
        config = self.work / 'docker'; config.mkdir(exist_ok=True)
        (config / 'config.json').write_text(json.dumps({'cliPluginsExtraDirs': [str(docker.parent.parent / 'cli-plugins')]}), encoding='utf-8')
        self.d = [str(docker), '--config', str(config)]
        self.env = clean_environment()
        port = urllib.parse.urlsplit(bundle['db_url'].removeprefix('jdbc:')).port
        if port in (3306, 3307) or urllib.parse.urlsplit(bundle['api_base_url']).hostname != '127.0.0.1':
            raise RuntimeError('Shared/nonloopback connection is not allowed')
        self.env.update(CLINIC_MYSQL_ROOT_PASSWORD=bundle['db_root_password'], CLINIC_MYSQL_PASSWORD=bundle['db_password'],
                        CLINIC_MYSQL_PORT=str(port), DB_URL=bundle['db_url'], DB_USERNAME='clinic_app',
                        DB_PASSWORD=bundle['db_password'], QA_SCOPE='OWN_NEW_D03_CATALOG_STACK')
        for actor, user in bundle['accounts'].items():
            self.env['QA_' + actor + '_EMAIL'] = user['email']; self.env['QA_' + actor + '_PASSWORD'] = user['password']
        self.c = ['compose', '-p', self.project, '-f', str(ROOT / 'docker-compose.yml'), '--env-file', str(ROOT / '.env.example')]
        self.jar = Path(bundle['jar_path'])
        if not self.jar.resolve().is_relative_to((ROOT / '.qa-runtime').resolve()) or sha(self.jar) != bundle['jar_sha256']:
            raise RuntimeError('QA artifact is missing or has changed')
        for name, value in bundle['migration_sha256'].items():
            if sha(ROOT / 'backend/src/main/resources/db/migration' / name) != value:
                raise RuntimeError('Migration changed; refusing to alter fixture stack')
        self.libs = self.work / 'libs'; self.libs.mkdir(exist_ok=True)
        with zipfile.ZipFile(self.jar) as archive:
            data = archive.read('BOOT-INF/classes/com/clinicmanagement/controller/DoctorController.class')
            if b'eligible-users' not in data:
                raise RuntimeError('The BE artifact lacks eligible-users')
            for name in archive.namelist():
                if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):
                    destination = self.libs / Path(name).name
                    if not destination.exists():
                        destination.write_bytes(archive.read(name))

    def docker(self, args, operation, timeout=240, env=None):
        return run(self.d + args, operation, env=env or self.env, timeout=timeout)

    def inspect(self, name):
        r = subprocess.run(self.d + ['inspect', '--format', '{{json .}}', name], capture_output=True,
                           text=True, encoding='utf-8', errors='replace')
        return json.loads(r.stdout) if r.returncode == 0 else None  # Never print raw Docker config/environment.

    def start(self, fresh):
        self.docker(['info', '--format', '{{.OSType}}'], 'Docker Engine')
        current = self.inspect(self.mysql)
        if current is None:
            volume = self.docker(['volume', 'ls', '-q', '--filter', 'name=^' + self.project + '_clinic_mysql_data$'], 'Volume identity')
            if volume or not fresh:
                raise RuntimeError('Missing owned container or unidentified existing volume; refusing recreation')
            self.docker(self.c + ['config', '--quiet'], 'Compose validation')
            self.docker(self.c + ['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '180', 'mysql'], 'New QA MySQL startup')
            current = self.inspect(self.mysql)
        labels = current['Config'].get('Labels', {})
        if labels.get('com.docker.compose.project') != self.project or labels.get('com.docker.compose.service') != 'mysql' or not any(m.get('Name') == self.project + '_clinic_mysql_data' and m['Destination'] == '/var/lib/mysql' for m in current['Mounts']):
            raise RuntimeError('MySQL scope identity mismatch')
        if current['State']['Status'] != 'running':
            self.docker(['start', self.mysql], 'Start owned QA MySQL')
        for _ in range(90):
            if self.inspect(self.mysql)['State'].get('Health', {}).get('Status') == 'healthy':
                return
            time.sleep(1)
        raise RuntimeError('Owned QA MySQL health timeout')

    def helper(self, action):
        output = run(['java', '--class-path', str(self.libs / '*'), str(ROOT / 'database/qa/D03CatalogFixtures.java'), action,
                      str(Path(self.b['source']) / 'src/main/resources/db/migration')], 'Scoped fixture JDBC action', env=self.env)
        lines = [line for line in output.splitlines() if line.startswith('D03_FIXTURE_RESULT=')]
        if len(lines) != 1:
            raise RuntimeError('Fixture helper did not return safe metadata')
        return json.loads(lines[0].split('=', 1)[1])

    def start_backend(self):
        current = self.inspect(self.backend)
        if current is None:
            env = self.env.copy()
            env.update(DB_URL='jdbc:mysql://mysql:3306/clinic_management_db?connectionTimeZone=UTC', JWT_SECRET=self.b['jwt_secret'],
                       JWT_ISSUER=self.b['jwt_issuer'], CORS_ALLOWED_ORIGINS=','.join(self.b['cors_origins']),
                       SERVER_PORT='8080', SPRING_PROFILES_ACTIVE='mysql-validation')
            port = urllib.parse.urlsplit(self.b['api_base_url']).port
            command = ['run', '-d', '--pull', 'never', '--name', self.backend, '--network', self.project + '_default',
                       '--label', 'clinic.qa.d03.fixture_id=' + self.b['fixture_id'], '--restart', 'unless-stopped',
                       '-p', f'127.0.0.1:{port}:8080', '--mount', f'type=bind,source={self.jar},target=/app/backend.jar,readonly']
            for key in ('DB_URL', 'DB_USERNAME', 'DB_PASSWORD', 'JWT_SECRET', 'JWT_ISSUER', 'CORS_ALLOWED_ORIGINS', 'SERVER_PORT', 'SPRING_PROFILES_ACTIVE'):
                command += ['--env', key]
            self.docker(command + ['eclipse-temurin:21-jre-alpine', 'java', '-jar', '/app/backend.jar'], 'New QA Backend startup', env=env)
            current = self.inspect(self.backend)
        if current['Config'].get('Labels', {}).get('clinic.qa.d03.fixture_id') != self.b['fixture_id']:
            raise RuntimeError('Backend identity mismatch')
        configured = dict(item.split('=', 1) for item in current['Config']['Env'] if '=' in item)
        if configured.get('DB_URL') != 'jdbc:mysql://mysql:3306/clinic_management_db?connectionTimeZone=UTC' or configured.get('DB_PASSWORD') != self.b['db_password'] or configured.get('SPRING_PROFILES_ACTIVE') != 'mysql-validation' or self.project + '_default' not in current['NetworkSettings']['Networks']:
            raise RuntimeError('Backend is not configured for this exact QA MySQL stack')
        if current['State']['Status'] != 'running':
            self.docker(['start', self.backend], 'Start owned QA Backend')
        for _ in range(180):
            try:
                if self.request('/api/v1/health')[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.5)
        raise RuntimeError('Hibernate validation / Backend startup did not become healthy')

    def request(self, path, method='GET', body=None, token=None, origin=None):
        headers = {'Accept': 'application/json'}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if origin:
            headers.update(Origin=origin)
            if method == 'OPTIONS':
                headers.update({'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type'})
        req = urllib.request.Request(self.b['api_base_url'] + path, method=method,
                  data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}, dict(response.headers)
        except urllib.error.HTTPError as error:
            raw = error.read()
            return error.code, json.loads(raw) if raw else {}, dict(error.headers)


def verify(stack, first_snapshot):
    tokens, results = {}, []
    b = stack.b
    def record(label, ok, status=None):
        results.append({'case': label, 'result': 'PASS' if ok else 'FAIL', **({'http': status} if status else {})})
        if not ok:
            raise RuntimeError('Verification failed: ' + label)
    def no_secret_fields(value):
        if isinstance(value, dict):
            return all(k.replace('_', '').lower() not in ('password', 'passwordhash') and no_secret_fields(v) for k, v in value.items())
        return not isinstance(value, list) or all(no_secret_fields(v) for v in value)
    def api(label, path, actor='ADMIN', method='GET', body=None, expected=200, code=None):
        status, response, headers = stack.request(path, method, body, tokens.get(actor) if actor else None)
        record(label, status == expected and (code is None or response.get('code') == code) and no_secret_fields(response), status)
        return response.get('data'), headers
    for actor, account in b['accounts'].items():
        status, response, _ = stack.request('/api/v1/auth/login', 'POST', {'email': account['email'], 'password': account['password']})
        record(actor + '_LOGIN', status == 200 and no_secret_fields(response), status)
        data = response['data']; token = data['accessToken']; parts = token.split('.')
        decode = lambda part: base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))
        claims, header = json.loads(decode(parts[1])), json.loads(decode(parts[0]))
        sig = hmac.new(base64.b64decode(b['jwt_secret']), (parts[0] + '.' + parts[1]).encode(), hashlib.sha256).digest()
        record(actor + '_JWT', header['alg'] == 'HS256' and hmac.compare_digest(sig, decode(parts[2])) and claims['iss'] == b['jwt_issuer']
               and claims['sub'] == first_snapshot['users'][actor] and claims['iat'] <= time.time() < claims['exp'] and claims['exp'] - claims['iat'] == 1800)
        tokens[actor] = token
        me, headers = api(actor + '_ME', '/api/v1/auth/me', actor)
        record(actor + '_ROLE_ACTIVE', me['role'] == account['role'] and me['status'] == 'ACTIVE' and me['id'] == claims['sub'] and 'no-store' in headers.get('Cache-Control', ''))
    users, specialties, doctors = first_snapshot['users'], first_snapshot['specialties'], first_snapshot['doctors']
    s1, s2, s3 = [specialties[k] for k in ('D03_QA_S1_ACTIVE', 'D03_QA_S2_ACTIVE', 'D03_QA_S3_INACTIVE')]
    d1, d2 = doctors['D03_QA_DOC_ACTIVE'], doctors['D03_QA_DOC_INACTIVE']
    eligible, _ = api('ADMIN_ELIGIBLE_LIST', '/api/v1/doctors/eligible-users?size=100')
    ids = {item['id'] for item in eligible['items']}
    record('ELIGIBLE_UNLINKED_INCLUDED', users['DOCTOR_ELIGIBLE'] in ids)
    record('ELIGIBLE_LINKED_AND_INACTIVE_LINKED_EXCLUDED', not {users['DOCTOR_LINKED'], users['DOCTOR_INACTIVE']} & ids)
    record('ELIGIBLE_PROJECTION_ONLY', all(set(item) == {'id', 'fullName', 'email'} for item in eligible['items']))
    api('ADMIN_SPECIALTY_GET', '/api/v1/specialties/' + s1)
    api('ADMIN_DOCTOR_GET', '/api/v1/doctors/' + d1)
    page, _ = api('ADMIN_SPECIALTY_SEARCH', '/api/v1/specialties?q=D03_QA_S1_ACTIVE&size=1')
    record('SPECIALTY_SEARCH_MATCH', page['totalElements'] == 1 and page['items'][0]['id'] == s1)
    page, _ = api('ADMIN_DOCTOR_FILTER', '/api/v1/doctors?specialtyId=' + s1 + '&size=1')
    record('DOCTOR_SPECIALTY_FILTER_MATCH', any(item['id'] == d1 for item in page['items']))
    probe_page, _ = api('FIND_API_SPECIALTY_PROBE', '/api/v1/specialties?q=D03_QA_API_PROBE&size=100')
    matches = [x for x in probe_page['items'] if x['code'] == 'D03_QA_API_PROBE']
    if not matches:
        probe, _ = api('ADMIN_POST_SPECIALTY', '/api/v1/specialties', method='POST', expected=201,
                       body={'code': 'D03_QA_API_PROBE', 'name': 'QA D03 API CRUD Specialty', 'isActive': True})
    else:
        probe = matches[0]; record('ADMIN_POST_SPECIALTY_REUSED_NO_DUPLICATE', True)
    sp = probe['id']
    api('ADMIN_PATCH_SPECIALTY', '/api/v1/specialties/' + sp, method='PATCH', body={'isActive': True, 'description': 'Synthetic API CRUD verification'})
    probe_page, _ = api('FIND_API_DOCTOR_PROBE', '/api/v1/doctors?q=D03_QA_DOC_CRUD&size=100')
    matches = [x for x in probe_page['items'] if x['doctorCode'] == 'D03_QA_DOC_CRUD']
    if not matches:
        doctor, _ = api('ADMIN_POST_DOCTOR', '/api/v1/doctors', method='POST', expected=201,
                        body={'userId': users['DOCTOR_CRUD'], 'specialtyId': sp, 'doctorCode': 'D03_QA_DOC_CRUD', 'isActive': True})
    else:
        doctor = matches[0]; record('ADMIN_POST_DOCTOR_REUSED_NO_DUPLICATE', True)
    dp = doctor['id']
    api('ADMIN_PATCH_DOCTOR_ACTIVE', '/api/v1/doctors/' + dp, method='PATCH', body={'isActive': True, 'biography': 'Synthetic API CRUD verification'})
    api('ADMIN_PATCH_DOCTOR_INACTIVE', '/api/v1/doctors/' + dp, method='PATCH', body={'isActive': False})
    api('ADMIN_PATCH_SPECIALTY_INACTIVE', '/api/v1/specialties/' + sp, method='PATCH', body={'isActive': False})
    checkpoint = stack.helper('snapshot')['fingerprint']
    api('DUPLICATE_SPECIALTY_409', '/api/v1/specialties', method='POST', expected=409,
        body={'code': 'D03_QA_S1_ACTIVE', 'name': 'QA D03 duplicate forbidden'})
    api('DUPLICATE_LINKED_USER_409', '/api/v1/doctors', method='POST', expected=409, code='USER_ALREADY_LINKED',
        body={'userId': users['DOCTOR_LINKED'], 'specialtyId': s1, 'doctorCode': 'D03_QA_REJECTED'})
    api('DUPLICATE_DOCTOR_CODE_409', '/api/v1/doctors', method='POST', expected=409, code='DOCTOR_CODE_EXISTS',
        body={'userId': users['DOCTOR_ELIGIBLE'], 'specialtyId': s1, 'doctorCode': 'D03_QA_DOC_ACTIVE'})
    api('INACTIVE_SPECIALTY_409', '/api/v1/doctors', method='POST', expected=409, code='SPECIALTY_INACTIVE',
        body={'userId': users['DOCTOR_ELIGIBLE'], 'specialtyId': s3, 'doctorCode': 'D03_QA_REJECTED'})
    api('NON_DOCTOR_USER_409', '/api/v1/doctors', method='POST', expected=409, code='USER_NOT_ELIGIBLE',
        body={'userId': users['ADMIN'], 'specialtyId': s1, 'doctorCode': 'D03_QA_REJECTED'})
    api('SPECIALTY_WITH_ACTIVE_DOCTOR_409', '/api/v1/specialties/' + s1, method='PATCH', expected=409, code='SPECIALTY_HAS_ACTIVE_DOCTORS', body={'isActive': False})
    api('FAILED_PATCH_ROLLBACK_409', '/api/v1/doctors/' + dp, method='PATCH', expected=409, code='DOCTOR_CODE_EXISTS',
        body={'doctorCode': 'D03_QA_DOC_ACTIVE', 'biography': 'Must not persist'})
    api('MISSING_FK_404', '/api/v1/doctors', method='POST', expected=404,
        body={'userId': users['DOCTOR_ELIGIBLE'], 'specialtyId': '9223372036854775806', 'doctorCode': 'D03_QA_REJECTED'})
    api('INVALID_SPECIALTY_400', '/api/v1/specialties', method='POST', expected=400, body={'code': '', 'name': ''})
    record('FAILED_WRITES_LEAVE_CATALOG_UNCHANGED', stack.helper('snapshot')['fingerprint'] == checkpoint)
    record('TRANSACTION_ROLLBACK_AFTER_PARTIAL_DML', stack.helper('rollback-probe')['fingerprint'] == checkpoint)
    for actor in ('RECEPTIONIST', 'DOCTOR_LINKED', 'PATIENT'):
        api(actor + '_SPECIALTY_LIST', '/api/v1/specialties?size=100', actor)
        page, _ = api(actor + '_DOCTOR_LIST', '/api/v1/doctors?size=100', actor)
        if actor == 'RECEPTIONIST':
            record('RECEPTIONIST_SEES_INACTIVE', {d1, d2, dp}.issubset({x['id'] for x in page['items']}))
            record('RECEPTIONIST_FIELDS_MINIMIZED', all(not {'userId', 'licenseNumber', 'email'} & set(x) for x in page['items']))
        elif actor == 'DOCTOR_LINKED':
            record('DOCTOR_ONLY_SELF', {x['id'] for x in page['items']} == {d1})
        else:
            record('PATIENT_ONLY_ACTIVE_DOCTOR', {x['id'] for x in page['items']} == {d1})
            record('PATIENT_FIELDS_MINIMIZED', all(not {'userId', 'licenseNumber', 'userStatus', 'email'} & set(x) for x in page['items']))
        api(actor + '_NO_SPECIALTY_CREATE', '/api/v1/specialties', actor, 'POST', {'code': 'D03_QA_REJECTED', 'name': 'Forbidden'}, 403)
        api(actor + '_NO_SPECIALTY_PATCH', '/api/v1/specialties/' + sp, actor, 'PATCH', {'isActive': True}, 403)
        api(actor + '_NO_DOCTOR_CREATE', '/api/v1/doctors', actor, 'POST', {'userId': users['DOCTOR_ELIGIBLE'], 'specialtyId': s1, 'doctorCode': 'D03_QA_REJECTED'}, 403)
        api(actor + '_NO_DOCTOR_PATCH', '/api/v1/doctors/' + dp, actor, 'PATCH', {'isActive': True}, 403)
        api(actor + '_NO_ELIGIBLE_USERS', '/api/v1/doctors/eligible-users', actor, expected=403)
    page, _ = api('PATIENT_SPECIALTY_VISIBILITY', '/api/v1/specialties?size=100', 'PATIENT')
    record('PATIENT_ONLY_ACTIVE_SPECIALTIES', {x['id'] for x in page['items']} == {s1, s2})
    api('PATIENT_NO_INACTIVE_FILTER', '/api/v1/doctors?isActive=false', 'PATIENT', expected=403)
    api('PATIENT_INACTIVE_SPECIALTY_404', '/api/v1/specialties/' + s3, 'PATIENT', expected=404)
    api('PATIENT_INACTIVE_DOCTOR_404', '/api/v1/doctors/' + d2, 'PATIENT', expected=404)
    api('DOCTOR_OTHER_PROFILE_404', '/api/v1/doctors/' + d2, 'DOCTOR_LINKED', expected=404)
    page, _ = api('DOCTOR_INACTIVE_OWN_PROFILE', '/api/v1/doctors?size=100', 'DOCTOR_INACTIVE')
    record('INACTIVE_DOCTOR_OWN_SCOPE', {x['id'] for x in page['items']} == {d2})
    page, _ = api('ELIGIBLE_DOCTOR_HAS_NO_PROFILE', '/api/v1/doctors', 'DOCTOR_ELIGIBLE')
    record('ELIGIBLE_DOCTOR_EMPTY_SCOPE', page['totalElements'] == 0)
    api('ANONYMOUS_401', '/api/v1/doctors', actor=None, expected=401)
    api('ANONYMOUS_ELIGIBLE_401', '/api/v1/doctors/eligible-users', actor=None, expected=401)
    api('MISSING_RESOURCE_404', '/api/v1/doctors/9223372036854775806', expected=404)
    eligible, _ = api('FINAL_ELIGIBLE_USERS', '/api/v1/doctors/eligible-users?size=100')
    record('FINAL_ELIGIBLE_REMAINS_UNLINKED', {x['id'] for x in eligible['items']} == {users['DOCTOR_ELIGIBLE']})
    status, _, headers = stack.request('/api/v1/doctors', 'OPTIONS', origin=b['cors_origins'][0])
    record('FE_CORS_PATCH_PREFLIGHT', status == 200 and headers.get('Access-Control-Allow-Origin') == b['cors_origins'][0], status)
    final = stack.helper('verify')
    record('API_WRITES_CONFIRMED_IN_SAME_QA_DATABASE', final['specialties']['D03_QA_API_PROBE'] == sp and final['doctors']['D03_QA_DOC_CRUD'] == dp)
    return results, final


def execute(args):
    if not re.fullmatch('[a-z0-9-]{1,40}', args.name):
        raise RuntimeError('Invalid fixture bundle name')
    target = PREFIX + args.name
    if args.action == 'access':
        view(target); return
    if run(['git', 'branch', '--show-current'], 'Branch check') != 'feature/quynh':
        raise RuntimeError('Unexpected QA branch')
    baseline_paths = set(run(['git', 'diff', '--name-only'], 'Read modified paths').splitlines() +
                         run(['git', 'ls-files', '--others', '--exclude-standard'], 'Read untracked paths').splitlines())
    own = {'database/qa/d03_catalog_vault.py', 'database/qa/provision_d03_catalog.py', 'database/qa/D03CatalogFixtures.java', 'docs/qa/evidence/CL-D03-CATALOG-FIXTURES.json'}
    baseline = {p: sha(ROOT / p) for p in baseline_paths - own}
    baseline.update({str(Path('backend/src/main/resources/db/migration') / name): sha(ROOT / 'backend/src/main/resources/db/migration' / name) for name in MIGRATIONS})
    try:
        bundle = read(target); fresh = False
    except KeyError:
        if args.action != 'provision':
            raise RuntimeError('Fixture bundle not found; provision it on the Windows host first') from None
        bundle = new_bundle(args.be_ref); write(target, bundle, create=True); fresh = True
    stack = Stack(bundle)
    evidence = {'task': 'CL-D03-DB-QA FIXTURES', 'utc': datetime.now(timezone.utc).isoformat(),
                'backend_commit': bundle['backend_commit'], 'contract_sha256': bundle['contract_sha256'],
                'backend_jar_sha256': bundle['jar_sha256'], 'migration_sha256': bundle['migration_sha256'],
                'vault_target': target, 'scope': 'Dedicated new D03 QA stack; no shared Clinic/production/SmartExpense database accessed',
                'public_register_used': False, 'production_security_modified': False, 'fresh_scope_created': fresh}
    previous_path = ROOT / 'docs/qa/evidence/CL-D03-CATALOG-FIXTURES.json'
    if not fresh and previous_path.is_file():
        previous = json.loads(previous_path.read_text(encoding='utf-8'))
        if previous.get('result') == 'READY FOR FE TEST' and previous.get('vault_target') == target:
            evidence['previous_successful_run'] = previous.get('previous_successful_run') or {
                'utc': previous['utc'], 'counts': previous['counts'], 'assertions': len(previous['cases']),
                'post_create_cases': [c for c in previous['cases'] if c['case'] in ('ADMIN_POST_SPECIALTY', 'ADMIN_POST_DOCTOR')]}
    try:
        print('Starting/verifying only the owned D03 QA scope; no credentials printed', flush=True)
        stack.start(fresh)
        first = stack.helper('ensure' if args.action == 'provision' else 'snapshot')
        evidence['flyway'] = {'versions': ['1', '2'], 'validate': 'PASS', 'migrations_executed_this_run': first['migrations_executed']}
        stack.start_backend()
        evidence['hibernate_validate'] = 'PASS: real D03 Entity startup with ddl-auto=validate'
        print('Real D03 Backend ready; verifying login/ME, CRUD, eligibility, role scope and rollback', flush=True)
        results, final = verify(stack, first)
        # Re-run the idempotent initializer and compare rows/IDs/catalog contents.
        repeated = stack.helper('ensure')
        if repeated['counts'] != final['counts'] or repeated['users'] != final['users'] or repeated['fingerprint'] != final['fingerprint']:
            raise RuntimeError('Idempotent repeat changed fixture data')
        ids = {k: final[k] for k in ('users', 'specialties', 'doctors')}
        bundle['fixture_ids'] = ids
        bundle['ready'] = True
        write(target, bundle)
        evidence.update(result='READY FOR FE TEST', cases=results, counts=final['counts'], fixture_ids=ids,
                        mysql_version=final['mysql_version'], database_name=final['database'],
                        backend_database_verified=True, initializer_repeat_without_duplicates='PASS',
                        vault_readback_verified=read(target) == bundle,
                        runtime_disposition='QA MySQL and real D03 Backend remain running; no data/database/volume deleted')
        print('PASS: ' + str(len(results)) + ' API/integrity assertions; idempotent repeat preserved IDs/counts', flush=True)
    except Exception as error:
        evidence.update(result='BLOCKED', blocker=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        raise RuntimeError('D03 fixture preparation blocked; see sanitized D03 evidence') from None
    finally:
        evidence['existing_files_and_migrations_preserved'] = all((ROOT / p).is_file() and sha(ROOT / p) == h for p, h in baseline.items())
        if not evidence['existing_files_and_migrations_preserved']:
            evidence.update(result='BLOCKED', blocker='Preexisting source changed during fixture work')
        path = ROOT / 'docs/qa/evidence/CL-D03-CATALOG-FIXTURES.json'; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
        if evidence.get('result') != 'READY FOR FE TEST':
            raise RuntimeError('D03 fixtures are not ready; see sanitized evidence') from None
    print('READY FOR FE TEST; private Windows credential target: ' + target, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('provision', 'verify', 'access'))
    parser.add_argument('--name', default='fe-acceptance')
    parser.add_argument('--be-ref', default='feature/tuan', help='Read-only local committed BE ref; never fetched/checked out')
    try:
        execute(parser.parse_args())
    except KeyError:
        raise SystemExit('QA credentials are unavailable in this logon context; use the same Windows desktop user outside the agent sandbox.') from None
