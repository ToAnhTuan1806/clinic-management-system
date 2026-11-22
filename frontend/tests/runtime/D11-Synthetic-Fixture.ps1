$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$state=Get-Content (Join-Path $workspace 'frontend/test-results/d11-acceptance/state.json') -Raw|ConvertFrom-Json
$metadata=@(docker inspect $state.mysql|ConvertFrom-Json)[0]
if($metadata.Config.Labels.'clinic.qa.fe.d11.acceptance' -ne $state.cloneId -or -not $metadata.State.Running){throw 'COPY_SCOPE_MISMATCH'}
$command='export MYSQL_PWD=$MYSQL_PASSWORD; exec mysql --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --database=clinic_management_db --batch --skip-column-names'
$existing='SELECT COUNT(*) FROM appointments;'|docker exec -i $state.mysql sh -c $command
if($LASTEXITCODE -ne 0 -or [int]$existing -ne 0){throw 'EMPTY_COPY_REQUIRED'}
$sql=[Collections.Generic.List[string]]::new()
$sql.Add('START TRANSACTION;')
$sql.Add("INSERT INTO patients(id,user_id,patient_code,full_name,is_active,created_at,updated_at) VALUES (1,3,'D11_SELF','Synthetic patient self',1,'2026-01-01','2026-01-01'),(2,NULL,'D11_LAST','Synthetic last patient',1,'2026-01-01','2026-01-01'),(3,NULL,'D11_OTHER','Synthetic other patient',1,'2026-01-01','2026-01-01');")
for($index=1;$index -le 103;$index++){
 $day=[datetime]::new(2026,6,1).AddDays($index)
 $workDate=$day.ToString('yyyy-MM-dd')
 $start=$day.AddHours(2).ToString('yyyy-MM-dd HH:mm:ss')
 $end=$day.AddHours(3).ToString('yyyy-MM-dd HH:mm:ss')
 $patient=if($index -le 101){1}elseif($index -eq 102){2}else{3}
 $doctor=if($index -le 102){1}else{2}
 $actor=if($doctor -eq 1){4}else{6}
 $release=if($index -in @(1,101,103)){'NULL,NULL'}else{"'$end',$actor"}
 $sql.Add("INSERT INTO doctor_schedules(id,doctor_id,work_date,start_at_utc,end_at_utc,slot_minutes,status,created_at,updated_at) VALUES ($index,$doctor,'$workDate','$start','$end',30,'ACTIVE','2026-01-01','2026-01-01');")
 $sql.Add("INSERT INTO appointments(id,appointment_code,patient_id,doctor_id,schedule_id,created_by,start_at_utc,end_at_utc,status,request_key,request_fingerprint,created_at,updated_at) VALUES ($index,'D11_APT_$index',$patient,$doctor,$index,2,'$start','$end','COMPLETED','D11_KEY_$index',REPEAT('a',64),'2026-01-01','$end');")
 $sql.Add("INSERT INTO medical_records(id,appointment_id,symptoms,diagnosis,notes,conclusion,created_by,completed_at,completed_by,created_at,updated_at,released_at,released_by) VALUES ($index,$index,'Synthetic symptoms','Synthetic diagnosis','Synthetic notes','Synthetic conclusion',$actor,'$end',$actor,'$start','$end',$release);")
}
$sql.Add('COMMIT;')
($sql -join "`n")|docker exec -i $state.mysql sh -c $command
if($LASTEXITCODE -ne 0){throw 'SYNTHETIC_SETUP_FAILED'}
'PASS OWNED QA COPY: 103 appointments, 103 records, 3 synthetic patients'
