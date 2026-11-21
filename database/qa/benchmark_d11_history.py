"""Measure candidate history queries on a new, network-isolated synthetic MySQL 8.4.

Compares unchanged V1–V9 with V10. This is query-plan evidence, not FR-10 API approval.
No existing container/database is used; the owned container is stopped, volume retained.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    name = 'clinic-d11-index-' + uuid.uuid4().hex[:12]
    env = dict(os.environ, MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32))
    migrations = sorted((ROOT / 'backend/src/main/resources/db/migration').glob('V*.sql'))
    migrations = [p for p in migrations if int(p.name.split('__')[0][1:]) <= 9]
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in migrations}
    if len(hashes) != 9:
        raise RuntimeError('Expected immutable baseline V1–V9')
    evidence = {'task': 'CL-D11-DB INDEX BASELINE', 'container': name,
                'migration_sha256': hashes, 'synthetic_only': True, 'added_indexes': []}
    started = False

    def run(args, **kwargs):
        return subprocess.run(args, env=env, capture_output=True, encoding='utf-8',
                              errors='replace', timeout=180, **kwargs)

    def sql(statement):
        result = run(['docker', 'exec', '-i', name, 'sh', '-c',
                      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot -NB --raw'], input=statement)
        if result.returncode:
            raise RuntimeError('Owned benchmark SQL failed; details suppressed')
        return result.stdout.strip()

    def query(statement):
        return sql('USE clinic_d11_history_benchmark; ' + statement)

    try:
        launch = run(['docker', 'run', '-d', '--pull=never', '--network', 'none', '--name', name,
                      '--label', 'clinic.qa.task=CL-D11-DB', '-e', 'MYSQL_ROOT_PASSWORD',
                      '-v', name + '-data:/var/lib/mysql', 'mysql:8.4', '--default-time-zone=+00:00'])
        if launch.returncode:
            raise RuntimeError('Owned benchmark MySQL launch failed')
        started = True
        for _ in range(90):
            try:
                evidence['mysql_version'] = sql('SELECT VERSION()')
                break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('Benchmark MySQL readiness failed')
        if not evidence['mysql_version'].startswith('8.4.'):
            raise RuntimeError('Expected MySQL 8.4')
        sql('CREATE DATABASE clinic_d11_history_benchmark; USE clinic_d11_history_benchmark;\n'
            + '\n'.join(p.read_text(encoding='utf-8') for p in migrations))
        statements = []
        for i in range(1, 313):
            role = 'DOCTOR' if i <= 12 else 'PATIENT'
            statements.append(f"INSERT INTO users(id,email,password_hash,full_name,role,status,created_at,updated_at) VALUES({i},'synthetic-{i}@example.test','synthetic-not-login','Synthetic {i}','{role}','ACTIVE','2026-01-01','2026-01-01');")
        statements.append("INSERT INTO specialties(id,code,name,created_at,updated_at) VALUES(1,'D11QA','Synthetic History','2026-01-01','2026-01-01');")
        for i in range(1, 13):
            statements.append(f"INSERT INTO doctors(id,user_id,specialty_id,doctor_code,created_at,updated_at) VALUES({i},{i},1,'D11DOC{i}','2026-01-01','2026-01-01');")
            statements.append(f"INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,created_at,updated_at) VALUES({i},{i},'2026-01-01','2026-01-01 01:00:00','2026-01-01 10:00:00','2026-01-01','2026-01-01');")
        for i in range(1, 301):
            statements.append(f"INSERT INTO patients(id,user_id,patient_code,full_name,created_at,updated_at) VALUES({i},{i+12},'D11PAT{i}','Synthetic Patient {i}','2026-01-01','2026-01-01');")
        for i in range(1, 12001):
            patient = (i - 1) % 300 + 1
            doctor = ((i - 1) // 300 + patient) % 12 + 1
            start = f"TIMESTAMPADD(MINUTE,{i * 30},'2026-01-01 01:00:00')"
            end = f"TIMESTAMPADD(MINUTE,{i * 30 + 30},'2026-01-01 01:00:00')"
            statements.append(f"INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at) VALUES({i},'D11QA{i}',{patient},{doctor},{doctor},{doctor},{start},{end},'COMPLETED','d11-{i}','{'a'*64}','2026-01-01','2026-01-01');")
            statements.append(f"INSERT INTO medical_records(id,appointment_id,created_by,completed_by,completed_at,created_at,updated_at) VALUES({i},{i},{doctor},{doctor},{end},'2026-01-01',{end});")
        query('START TRANSACTION;\n' + '\n'.join(statements) + '\nCOMMIT;')
        query('ANALYZE TABLE appointments, medical_records;')
        select = 'SELECT a.id,a.start_at_utc,m.id FROM appointments a JOIN medical_records m ON m.appointment_id=a.id '
        queries = {
            'patient_history': select + "WHERE a.patient_id=42 AND a.status='COMPLETED' AND m.completed_at IS NOT NULL ORDER BY a.start_at_utc DESC,a.id DESC LIMIT 20",
            'doctor_history': select + "WHERE a.doctor_id=7 AND a.status='COMPLETED' AND m.completed_at IS NOT NULL ORDER BY a.start_at_utc DESC,a.id DESC LIMIT 20",
            'patient_doctor_time': select + "WHERE a.patient_id=42 AND a.doctor_id=7 AND a.start_at_utc >= '2026-02-01' AND a.start_at_utc < '2026-10-01' AND m.completed_at IS NOT NULL ORDER BY a.start_at_utc DESC,a.id DESC LIMIT 20"}
        evidence['fixture_counts'] = {'patients': 300, 'doctors': 12, 'appointments': 12000, 'medical_records': 12000}
        evidence['baseline_v9_plans'] = {key: {'sql': value, 'explain_analyze': query('EXPLAIN ANALYZE ' + value),
                                  'explain_json': json.loads(query('EXPLAIN FORMAT=JSON ' + value))}
                             for key, value in queries.items()}
        v10 = ROOT / 'backend/src/main/resources/db/migration/V10__add_medical_record_release.sql'
        evidence['v10_sha256'] = hashlib.sha256(v10.read_bytes()).hexdigest()
        query(v10.read_text(encoding='utf-8'))
        query('ANALYZE TABLE appointments, medical_records;')
        queries = {key: value.replace('m.completed_at IS NOT NULL', 'm.released_at IS NOT NULL')
                   for key, value in queries.items()}
        evidence['v10_plans'] = {key: {'sql': value, 'explain_analyze': query('EXPLAIN ANALYZE ' + value),
                                      'explain_json': json.loads(query('EXPLAIN FORMAT=JSON ' + value))}
                                 for key, value in queries.items()}
        evidence['released_rows_after_backfill'] = int(query('SELECT COUNT(*) FROM medical_records WHERE released_at IS NOT NULL'))
        if evidence['released_rows_after_backfill'] != 12000:
            raise RuntimeError('Benchmark legacy backfill count mismatch')
        evidence['fk_support_index'] = 'ix_medical_records_released_by (structural FK support, not a history-query optimization)'
        evidence['result'] = 'PASS'
        print('D11 candidate history EXPLAIN ANALYZE: PASS (12,000 synthetic visits)', flush=True)
    except Exception as error:
        evidence['result'] = 'FAIL'
        evidence['blocker'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise RuntimeError(evidence['blocker']) from None
    finally:
        if started:
            evidence['owned_container_stopped'] = run(['docker', 'stop', '--timeout', '60', name]).returncode == 0
        evidence['volume_retained'] = started
        evidence['migration_bytes_preserved'] = all(hashlib.sha256(p.read_bytes()).hexdigest() == hashes[p.name] for p in migrations)
        (ROOT / 'docs/qa/evidence/CL-D11-INDEX.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
