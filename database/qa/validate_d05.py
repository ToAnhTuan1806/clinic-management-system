"""D05 real MySQL regression. Requires Java 21, Docker Linux/mysql:8.4 and Gradle.

Run from any directory: python database/qa/validate_d05.py
Optional: --newman-module <directory containing installed newman package>.
Only a newly created container/volume is used. No shared database connection,
Flyway clean/repair/baseline, or volume deletion. Sanitized logs stay in .qa-runtime.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--newman-module', type=Path)
    args = parser.parse_args()
    run_id = uuid.uuid4().hex[:12]
    work = ROOT / '.qa-runtime' / 'd05' / run_id
    work.mkdir(parents=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(
        ('DB_', 'SPRING_', 'JWT_', 'CORS_', 'CLINIC_', 'MYSQL_TEST_', 'COMPOSE_'))}
    env.update(D05_ROOT_PASSWORD=secrets.token_urlsafe(32),
               MYSQL_PASSWORD=secrets.token_urlsafe(32), MYSQL_USER='clinic_qa',
               MYSQL_DATABASE='clinic_management_db')
    env['MYSQL_ROOT_PASSWORD'] = env['D05_ROOT_PASSWORD']
    env['DB_USERNAME'] = env['MYSQL_USER']
    env['DB_PASSWORD'] = env['MYSQL_PASSWORD']
    env['JWT_SECRET'] = base64.b64encode(secrets.token_bytes(32)).decode()
    env['CLINIC_QA_ACK'] = 'NEW_D04_INSTANCE_ONLY'
    name = 'clinic-d05-qa-' + run_id
    volume = name + '-data'
    schemas = ['clinic_d02_be_it_d04v4_' + run_id,
               'clinic_d02_be_it_d05_' + run_id,
               'clinic_d02_be_it_d05_postman_' + run_id,
               'clinic_d02_be_it_d05_preserve_' + run_id]
    migrations = ROOT / 'backend/src/main/resources/db/migration'
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations.glob('V*.sql')}
    result = {'run_id': run_id, 'container': name, 'volume': volume,
              'migration_sha256': hashes, 'synthetic_only': True, 'phases': {}}
    gradle = ['cmd', '/c', str(ROOT / 'backend/gradlew.bat')] if os.name == 'nt' else ['sh', './gradlew']
    docker = shutil.which('docker')
    started = False
    app = None
    app_log = None

    def sanitize(value):
        for key in ('MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET'):
            value = value.replace(env[key], '<redacted>')
        return re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', '<redacted-token>', value)

    def run(command, phase, cwd=ROOT, input=None, timeout=600, required=True):
        completed = subprocess.run(command, cwd=cwd, env=env, input=input,
                                   capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
        (work / (phase + '.log')).write_text(sanitize(completed.stdout + completed.stderr), encoding='utf-8')
        result['phases'][phase] = {'exit_code': completed.returncode}
        if required and completed.returncode:
            raise RuntimeError(phase + ' failed; see sanitized local log')
        return completed

    def jdbc(schema, port):
        return f'jdbc:mysql://127.0.0.1:{port}/{schema}?connectionTimeZone=UTC'

    try:
        if not docker:
            raise RuntimeError('Docker CLI missing')
        engine = run([docker, 'info', '--format', '{{.OSType}}'], 'docker_engine').stdout.strip()
        if engine != 'linux':
            raise RuntimeError('Docker Linux engine required')
        run([docker, 'image', 'inspect', 'mysql:8.4', '--format', '{{.Id}}'], 'mysql_image')
        run(gradle + ['--no-daemon', 'bootJar'], 'bootjar', ROOT / 'backend')
        jars = list((ROOT / 'backend/build/libs').glob('*.jar'))
        jars = [p for p in jars if not p.name.endswith('-plain.jar')]
        if len(jars) != 1:
            raise RuntimeError('Expected exactly one boot JAR')
        libs = work / 'libs'
        classes = work / 'classes'
        libs.mkdir()
        classes.mkdir()
        with zipfile.ZipFile(jars[0]) as archive:
            for member in archive.namelist():
                if member.startswith('BOOT-INF/lib/') and member.endswith('.jar'):
                    (libs / Path(member).name).write_bytes(archive.read(member))
        print('Starting new isolated D05 MySQL container', flush=True)
        # Refuse collisions before Docker can reuse any existing resource.
        for resource, command in [('container', ['ps', '-aq', '--filter', 'name=^/' + name + '$']),
                                  ('volume', ['volume', 'ls', '-q', '--filter', 'name=^' + volume + '$'])]:
            if run([docker] + command, resource + '_collision').stdout.strip():
                raise RuntimeError('QA resource collision')
        run([docker, 'run', '-d', '--pull=never', '--name', name,
             '--label', 'clinic.qa.task=CL-D05-DB', '-p', '127.0.0.1::3306',
             '-v', volume + ':/var/lib/mysql', '-e', 'MYSQL_ROOT_PASSWORD',
             '-e', 'MYSQL_PASSWORD', '-e', 'MYSQL_USER', '-e', 'MYSQL_DATABASE',
             'mysql:8.4', '--character-set-server=utf8mb4',
             '--collation-server=utf8mb4_0900_ai_ci', '--default-time-zone=+00:00'], 'mysql_start')
        started = True
        binding = json.loads(run([docker, 'inspect', '--format', '{{json .NetworkSettings.Ports}}', name], 'ports').stdout)['3306/tcp']
        if len(binding) != 1 or binding[0]['HostIp'] != '127.0.0.1':
            raise RuntimeError('Unexpected port binding')
        port = int(binding[0]['HostPort'])
        if port in (3306, 3307):
            raise RuntimeError('Refusing shared ports')
        result['port'] = port
        root_sql = [docker, 'exec', '-i', name, 'sh', '-c',
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch --skip-column-names']
        for _ in range(90):
            probe = run(root_sql, 'mysql_ready', input='SELECT VERSION();', timeout=10, required=False)
            if probe.returncode == 0:
                break
            time.sleep(2)
        else:
            raise RuntimeError('MySQL startup timeout')
        result['mysql_version'] = probe.stdout.strip()
        if not result['mysql_version'].startswith('8.4.'):
            raise RuntimeError('MySQL 8.4 required')
        sql = '\n'.join(f"CREATE DATABASE {s} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; "
                        f"GRANT ALL ON {s}.* TO 'clinic_qa'@'%';" for s in schemas)
        run(root_sql, 'provision_new_schemas', input=sql)
        env.update(DB_URL=jdbc('clinic_management_db', port), DB_FRESH_URL=jdbc(schemas[0], port),
                   DB_PRESERVE_URL=jdbc(schemas[3], port))
        sources = [str(ROOT / 'database/qa' / f'{day}DatabaseValidation.java') for day in ('D03', 'D04', 'D05')]
        run(['javac', '-encoding', 'UTF-8', '-cp', str(libs / '*'), '-d', str(classes)] + sources, 'compile_sql_checks')
        checks = run(['java', '-cp', str(classes) + os.pathsep + str(libs / '*'),
                      'D05DatabaseValidation', str(migrations)], 'database_checks')
        result['sql_summary'] = next(line for line in checks.stdout.splitlines() if line.startswith('D05_SUMMARY'))
        print(result['sql_summary'], flush=True)
        # A different empty schema prevents HTTP test cleanup touching preservation fixtures.
        env['DB_URL'] = jdbc(schemas[1], port)
        print('Running existing MySQL HTTP integration suite', flush=True)
        test_started = time.time()
        run(gradle + ['--no-daemon', '--rerun-tasks', 'mysqlTest'], 'mysql_http', ROOT / 'backend', required=False)
        reports = [p for p in (ROOT / 'backend/build/test-results/mysqlTest').glob('TEST-*.xml')
                   if p.stat().st_mtime >= test_started - 2]
        result['mysql_http'] = {k: 0 for k in ('tests', 'failures', 'errors', 'skipped')}
        result['mysql_http']['classes'] = {}
        for report in reports:
            suite = ET.parse(report).getroot()
            counts = {k: int(suite.get(k, 0)) for k in ('tests', 'failures', 'errors', 'skipped')}
            result['mysql_http']['classes'][suite.get('name')] = counts
            for key, count in counts.items():
                result['mysql_http'][key] += count
        if not reports:
            raise RuntimeError('MySQL JUnit reports missing')
        if args.newman_module:
            env['DB_URL'] = jdbc(schemas[2], port)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                app_port = sock.getsockname()[1]
            env.update(SERVER_ADDRESS='127.0.0.1', SERVER_PORT=str(app_port))
            app_log = (work / 'backend-postman.log').open('w', encoding='utf-8')
            app = subprocess.Popen(['java', '-jar', str(jars[0])], cwd=ROOT, env=env, stdout=app_log, stderr=subprocess.STDOUT)
            url = f'http://127.0.0.1:{app_port}'
            for _ in range(90):
                if app.poll() is not None:
                    raise RuntimeError('Postman backend stopped before health ready')
                try:
                    with urllib.request.urlopen(url + '/api/v1/health', timeout=2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                time.sleep(1)
            else:
                raise RuntimeError('Postman backend readiness timeout')
            script = """const newman=require(process.argv[1]);
const collection=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
collection.variable.find(v=>v.key==='runAuthTests').value='true';
const planned=collection.item.flatMap(folder=>folder.item.map(item=>item.name));
newman.run({collection, reporters:[], envVar:[
{key:'baseUrl',value:process.argv[3]}]},(err,s)=>{
if(err){process.exitCode=1;return;}
console.log(JSON.stringify({stats:s.run.stats, failures:s.run.failures.map(f=>({
request:f.source?.name,test:f.error?.test,message:f.error?.message})),
executed:s.run.executions.map(e=>e.item.name),
skipped:planned.filter(name=>!s.run.executions.some(e=>e.item.name===name))}));
process.exitCode=s.run.failures.length?1:0;});"""
            completed = run(['node', '-e', script, str(args.newman_module.resolve()),
                             str(ROOT / 'docs/qa/postman/CL-D02-Auth.postman_collection.json'), url], 'postman', required=False)
            result['postman'] = json.loads(completed.stdout)
        http = result['mysql_http']
        all_passed = (http['tests'] > 0 and not any(http[k] for k in ('failures', 'errors', 'skipped'))
                      and all(p['exit_code'] == 0 for p in result['phases'].values()))
        result['result'] = 'PASS' if all_passed else 'FAIL'
    except Exception as error:
        result.update(result='BLOCKED', blocker=sanitize(str(error)))
    finally:
        if app is not None:
            app.terminate()
            try:
                app.wait(timeout=20)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait(timeout=10)
        if app_log is not None:
            app_log.close()
            log_path = work / 'backend-postman.log'
            log_path.write_text(sanitize(log_path.read_text(encoding='utf-8')), encoding='utf-8')
        if started:
            stopped = run([docker, 'stop', name], 'stop_own_container', required=False, timeout=60)
            result['resource_disposition'] = 'Own QA container stopped; volume retained' if stopped.returncode == 0 else 'Own QA stop failed'
            if stopped.returncode:
                result.update(result='BLOCKED', blocker='Unable to stop own QA container')
        result['migrations_preserved'] = hashes == {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations.glob('V*.sql')}
        if not result['migrations_preserved']:
            result.update(result='BLOCKED', blocker='Migration preservation check failed')
        (work / 'summary.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print('D05 result:', result.get('result'), '; sanitized evidence:', work / 'summary.json', flush=True)
    return 0 if result.get('result') == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
