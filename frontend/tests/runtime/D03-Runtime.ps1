param([ValidateSet('Start','Verify','Cleanup')][string]$Action='Verify')
# QA runtime only. No provisioning, SQL DML/DDL, migration or credential changes.
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$frontend=Join-Path $workspace 'frontend'
$artifacts=Join-Path $frontend 'test-results/d03-runtime'
$stateFile=Join-Path $artifacts 'state.json'
$container='clinic-d03-db-5ebc96b8be-mysql-1'
$project='clinic-d03-db-5ebc96b8be'
$schema='clinic_d02_be_it_d03_5ebc96b8be'
$jar=Join-Path $artifacts 'backend-build/libs/clinic-management-backend-0.0.1-SNAPSHOT.jar'
$origin='http://127.0.0.1:5178'
$stage='INITIALIZE'
# Reuse the existing capture function only; never execute the D02 helper main body.
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Staff-Acceptance-Host.ps1'),[ref]$null,[ref]$null)
$definition=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Docker-Capture'},$false)[0]
. ([scriptblock]::Create($definition.Extent.Text))
function Inspect-Qa {
 $value=@(Docker-Capture -Arguments @('inspect',$container)|ConvertFrom-Json)[0]
 if($value.Config.Labels.'com.docker.compose.project' -ne $project -or -not @($value.Mounts|Where-Object{$_.Name -eq ($project+'_clinic_mysql_data') -and $_.Destination -eq '/var/lib/mysql'}).Count){throw 'QA_SCOPE_MISMATCH'}
 return $value
}
function Sql-Read([string]$Query) {
 $command='export MYSQL_PWD=$MYSQL_PASSWORD; exec mysql --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --database='+$schema+' --batch --skip-column-names'
 return Docker-Capture -Arguments @('exec','-i',$container,'sh','-c',$command) -InputScript $Query
}
function Metadata {
 $history=Sql-Read 'SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank;'
 if($history -notmatch '^1\s+1116148885\s+1\s+2\s+-?\d+\s+1\s*$'){throw 'QA_V1_V2_REQUIRED'}
 $eligible=Sql-Read "SELECT COUNT(*) FROM users u WHERE u.role='DOCTOR' AND u.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.user_id=u.id);"
 $roles=Sql-Read 'SELECT role,status,COUNT(*) FROM users GROUP BY role,status ORDER BY role,status;'
 return @{history=$history;eligibleCount=[int]$eligible;roleCounts=$roles;mysqlVersion=(Sql-Read 'SELECT VERSION();')}
}
try {
 $stage='SCOPE'
 $mysql=Inspect-Qa
 if($Action -eq 'Cleanup'){
  $state=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json
  $beforeStop=Metadata
  foreach($item in @(@{id=$state.vitePid;fragment=(Join-Path $frontend 'node_modules/vite/bin/vite.js')},@{id=$state.backendPid;fragment=$jar})){
   $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.id)
   if($process -and $process.CommandLine.Contains($item.fragment)){Stop-Process -Id $item.id}
  }
  if(-not $state.mysqlWasRunning){Docker-Capture -Arguments @('stop',$container)|Out-Null}
  @{status='PASS';runtimeStopped=$true;volumePreserved=$true;migrationHistory=$beforeStop.history}|ConvertTo-Json -Compress
  exit 0
 }
 if($Action -eq 'Verify'){
  $meta=Metadata
  @{status='PASS';scopeVerified=$true;schema=$schema;mysqlVersion=$meta.mysqlVersion;migrationHistory=$meta.history;eligibleCount=$meta.eligibleCount;roleCounts=$meta.roleCounts}|ConvertTo-Json -Compress
  exit 0
 }
 New-Item -ItemType Directory -Force -Path $artifacts|Out-Null
 $stage='ARTIFACT'
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead($jar)
 try {
  foreach($entry in @('com/clinicmanagement/controller/DoctorController.class','com/clinicmanagement/dto/EligibleDoctorUserResponse.class','com/clinicmanagement/config/MySqlValidationConfig.class','db/migration/V1__create_users.sql','db/migration/V2__create_specialties_and_doctors.sql')){
   if(-not $archive.GetEntry('BOOT-INF/classes/'+$entry)){throw 'D03_ARTIFACT_REQUIRED'}
  }
 }finally{$archive.Dispose()}
 $stage='MYSQL_START'
 $wasRunning=$mysql.State.Running
 if(Test-Path -LiteralPath $stateFile){$prior=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json;if($prior.backendPid -eq 0){$wasRunning=$prior.mysqlWasRunning}}
 $state=@{mysqlWasRunning=$wasRunning;backendPid=0;vitePid=0;frontendOrigin=$origin}
 $state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding UTF8
 if(-not $wasRunning){Docker-Capture -Arguments @('start',$container)|Out-Null}
 for($attempt=0;$attempt -lt 60;$attempt++){
  $mysql=Inspect-Qa
  if($mysql.State.Health.Status -eq 'healthy'){break}
  Start-Sleep -Milliseconds 500
 }
 if($mysql.State.Health.Status -ne 'healthy'){throw 'MYSQL_NOT_HEALTHY'}
 $stage='V1_V2_VALIDATE'
 $meta=Metadata
 $port=@($mysql.NetworkSettings.Ports.'3306/tcp')[0]
 if($port.HostIp -ne '127.0.0.1'){throw 'NON_LOOPBACK_MYSQL_REFUSED'}
 $private=@{}
 foreach($entry in $mysql.Config.Env){$parts=$entry -split '=',2;$private[$parts[0]]=$parts[1]}
 if($private.MYSQL_USER -ne 'clinic_app'){throw 'QA_DB_USER_MISMATCH'}
 foreach($entry in @(Get-ChildItem Env:|Where-Object{$_.Name -match '^(DB_|SPRING_|JWT_|CORS_|LOGGING_)' -or $_.Name -eq 'DEBUG'})){Remove-Item -LiteralPath ('Env:'+ $entry.Name)}
 $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
 $listener.Start();$apiPort=$listener.LocalEndpoint.Port;$listener.Stop()
 $env:DB_URL='jdbc:mysql://127.0.0.1:'+$port.HostPort+'/'+$schema+'?connectionTimeZone=UTC'
 $env:DB_USERNAME=$private.MYSQL_USER
 $env:DB_PASSWORD=$private.MYSQL_PASSWORD
 $key=New-Object byte[] 32
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($key)}finally{$rng.Dispose()}
 $env:JWT_SECRET=[Convert]::ToBase64String($key)
 [Array]::Clear($key,0,$key.Length)
 $env:JWT_ISSUER='clinic-d03-fe-acceptance'
 $env:SPRING_PROFILES_ACTIVE='mysql-validation'
 $env:SPRING_JPA_HIBERNATE_DDL_AUTO='validate'
 $env:SPRING_FLYWAY_ENABLED='true'
 $env:SERVER_ADDRESS='127.0.0.1'
 $env:SERVER_PORT=[string]$apiPort
 $env:CORS_ALLOWED_ORIGINS=$origin
 $env:LOGGING_LEVEL_ROOT='WARN'
 $env:LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_SECURITY='WARN'
 $env:LOGGING_LEVEL_ORG_HIBERNATE_SQL='OFF'
 $env:LOGGING_LEVEL_ORG_HIBERNATE_ORM_JDBC_BIND='OFF'
 $env:SPRING_MVC_LOG_REQUEST_DETAILS='false'
 $stage='BACKEND_START'
 $backend=Start-Process -FilePath 'C:/Program Files/Java/latest/jdk-21/bin/java.exe' -ArgumentList @('-jar',('"'+$jar+'"')) -WorkingDirectory $artifacts -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'backend.stdout.log') -RedirectStandardError (Join-Path $artifacts 'backend.stderr.log')
 $state.backendPid=$backend.Id;$state.apiURL='http://127.0.0.1:'+$apiPort
 $state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding UTF8
 foreach($name in @('DB_PASSWORD','DB_URL','DB_USERNAME','JWT_SECRET','JWT_ISSUER')){Remove-Item -LiteralPath ('Env:'+$name)}
 for($attempt=0;$attempt -lt 80;$attempt++){
  try{$health=Invoke-RestMethod -Uri ($state.apiURL+'/api/v1/health') -TimeoutSec 2;if($health.data.status -eq 'UP'){break}}catch{}
  if($backend.HasExited){throw 'BACKEND_START_FAILED'}
  Start-Sleep -Milliseconds 500
 }
 if($health.data.status -ne 'UP'){throw 'BACKEND_NOT_READY'}
 $stage='VITE_START'
 if(Get-NetTCPConnection -State Listen -LocalPort 5178 -ErrorAction SilentlyContinue){throw 'FE_PORT_IN_USE'}
 $env:VITE_API_BASE_URL=$state.apiURL;$env:VITE_AUTH_MOCK='false';$env:VITE_DIRECTORY_MOCK='false'
 $viteScript=Join-Path $frontend 'node_modules/vite/bin/vite.js'
 $vite=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"'+$viteScript+'"'),'--host','127.0.0.1','--port','5178','--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'vite.stdout.log') -RedirectStandardError (Join-Path $artifacts 'vite.stderr.log')
 $state.vitePid=$vite.Id;$state|ConvertTo-Json|Set-Content -LiteralPath $stateFile -Encoding UTF8
 @{status='PASS';frontendOrigin=$origin;apiPort=$apiPort;backendPid=$backend.Id;vitePid=$vite.Id;scopeVerified=$true;migrationHistory=$meta.history;eligibleCount=$meta.eligibleCount;roleCounts=$meta.roleCounts;mysqlVersion=$meta.mysqlVersion;jarSha256=(Get-FileHash -LiteralPath $jar).Hash;credentialsRecorded=$false}|ConvertTo-Json -Compress
}catch{
 $safeCode=if($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]+$'){$_.Exception.Message}else{$_.Exception.GetType().Name}
 @{status='BLOCKED';stage=$stage;code=$safeCode;errorId=$_.FullyQualifiedErrorId;line=$_.InvocationInfo.ScriptLineNumber;stack=$_.ScriptStackTrace;credentialsRecorded=$false}|ConvertTo-Json -Compress
 exit 1
}
