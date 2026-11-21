param([ValidateSet('VerifySource','StartClone','Inject','Verify','Audit','Cleanup')][string]$Action='VerifySource')
# D10 real QA on a separate copy. Never write the handed-off source database.
# Approved V3–V9 run only on the newly owned copy; source remains V1/V2 untouched.
# Only runtime metadata is persisted; credentials/dump/JWT keys remain in memory.
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$frontend=Join-Path $workspace 'frontend'
$artifacts=Join-Path $frontend 'test-results/d10-acceptance'
$stateFile=Join-Path $artifacts 'state.json'
$frontOrigin='http://127.0.0.1:5192'
$target='ClinicManagement/QA/D03Catalog/fe-acceptance'
$stage='INITIALIZE'
$jar='F:/RikkeiEdu/clinic-management-system/backend/build/libs/clinic-management-backend-0.0.1-SNAPSHOT.jar'
$jarHash=(Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Staff-Acceptance-Host.ps1'),[ref]$null,[ref]$null)
foreach($fn in $ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Docker-Capture','Invoke-Cdp')},$false)){. ([scriptblock]::Create($fn.Extent.Text))}
function Read-Bundle {
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class D03AcceptanceVault {
 [StructLayout(LayoutKind.Sequential)] public struct Credential {
  public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
  public long LastWritten; public uint BlobSize; public IntPtr Blob; public uint Persist;
  public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
 }
 [DllImport("Advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern bool CredRead(string target,uint type,uint flags,out IntPtr value);
 [DllImport("Advapi32.dll")] public static extern void CredFree(IntPtr value);
}
'@
 $pointer=[IntPtr]::Zero;$bytes=$null
 if(-not [D03AcceptanceVault]::CredRead($target,1,0,[ref]$pointer)){throw 'HOST_VAULT_UNAVAILABLE'}
 try{
  $credential=[Runtime.InteropServices.Marshal]::PtrToStructure($pointer,[type][D03AcceptanceVault+Credential])
  $bytes=New-Object byte[] $credential.BlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.Blob,$bytes,0,$bytes.Length)
  if($bytes.Length -lt 11 -or $bytes[0] -ne 67 -or $bytes[1] -ne 81 -or $bytes[2] -ne 51 -or $bytes[3] -ne 0){throw 'UNEXPECTED_VAULT_FORMAT'}
  $stream=[IO.MemoryStream]::new($bytes,6,$bytes.Length-10)
  $deflate=[IO.Compression.DeflateStream]::new($stream,[IO.Compression.CompressionMode]::Decompress)
  $reader=[IO.StreamReader]::new($deflate,[Text.Encoding]::UTF8)
  try{$bundle=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$deflate.Dispose();$stream.Dispose()}
 }finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};[D03AcceptanceVault]::CredFree($pointer)}
 if($bundle.recipe -ne 'CL_D03_CATALOG_V1' -or $bundle.fixture_id -notmatch '^[a-f0-9]{12}$' -or $bundle.project -ne ('clinic-d03-fixtures-'+$bundle.fixture_id) -or -not $bundle.ready){throw 'SOURCE_FIXTURE_IDENTITY_MISMATCH'}
 if(([uri]$bundle.api_base_url).Host -ne '127.0.0.1'){throw 'NON_LOOPBACK_SOURCE_REFUSED'}
 return $bundle
}
function Inspect([string]$Name){return @(Docker-Capture -Arguments @('inspect',$Name)|ConvertFrom-Json)[0]}
function Sql-Read([string]$Name,[string]$Sql){
 $command='export MYSQL_PWD=$MYSQL_PASSWORD; exec mysql --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --database=clinic_management_db --batch --skip-column-names'
 return Docker-Capture -Arguments @('exec','-i',$Name,'sh','-c',$command) -InputScript $Sql
}
function Snapshot([string]$Name,[switch]$Full){
 $catalog=Sql-Read $Name 'SELECT id,code,name,description,is_active,created_at,updated_at FROM specialties ORDER BY id; SELECT id,user_id,specialty_id,doctor_code,license_number,biography,is_active,created_at,updated_at FROM doctors ORDER BY id;'
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$fingerprint=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($catalog))).Replace('-','')}finally{$sha.Dispose()}
 $counts=(Sql-Read $Name 'SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM specialties),(SELECT COUNT(*) FROM doctors);').Trim() -split "`t"
 $eligible=(Sql-Read $Name "SELECT COALESCE(GROUP_CONCAT(u.id ORDER BY u.id),'') FROM users u WHERE u.role='DOCTOR' AND u.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.user_id=u.id);").Trim()
 $history=(Sql-Read $Name 'SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank;').Trim()
 if($Full){$versions=@($history -split "`n");if($versions.Count -ne 9 -or @($versions|Where-Object{$_ -notmatch '\s1$'}).Count -ne 0){throw 'D10_MIGRATION_HISTORY_MISMATCH'}}elseif($history -notmatch '^1\s+1116148885\s+1\s+2\s+196944325\s+1$'){throw 'MIGRATION_HISTORY_MISMATCH'}
 $patients=if($Full){[int](Sql-Read $Name 'SELECT COUNT(*) FROM patients;')}else{$null}
 return @{fingerprint=$fingerprint;users=[int]$counts[0];specialties=[int]$counts[1];doctors=[int]$counts[2];patients=$patients;eligible=$eligible;history=$history}
}
function Verify-Source($bundle){
 $mysql=Inspect ($bundle.project+'-mysql-1');$backend=Inspect ($bundle.project+'-backend')
 if(-not $mysql.State.Running -or $mysql.State.Health.Status -ne 'healthy' -or $mysql.Config.Labels.'com.docker.compose.project' -ne $bundle.project -or -not @($mysql.Mounts|Where-Object{$_.Name -eq ($bundle.project+'_clinic_mysql_data')}).Count){throw 'SOURCE_DATABASE_SCOPE_MISMATCH'}
 if(-not $backend.State.Running -or $backend.Config.Labels.'clinic.qa.d03.fixture_id' -ne $bundle.fixture_id -or -not $backend.NetworkSettings.Networks.PSObject.Properties[($bundle.project+'_default')]){throw 'SOURCE_BACKEND_SCOPE_MISMATCH'}
 $hash=((Docker-Capture -Arguments @('exec',($bundle.project+'-backend'),'sha256sum','/app/backend.jar')) -split '\s+')[0]
 if($hash -ne $bundle.jar_sha256){throw 'SOURCE_ARTIFACT_MISMATCH'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead($bundle.jar_path)
 try{foreach($migration in @('V1__create_users.sql','V2__create_specialties_and_doctors.sql')){
  $local=[IO.File]::ReadAllText((Join-Path $workspace ('backend/src/main/resources/db/migration/'+$migration))).Replace("`r`n","`n")
  $entry=$archive.GetEntry('BOOT-INF/classes/db/migration/'+$migration)
  if(-not $entry){throw 'SOURCE_MIGRATION_MISSING'}
  $reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8)
  try{$packaged=$reader.ReadToEnd().Replace("`r`n","`n")}finally{$reader.Dispose()}
  if($local -cne $packaged){throw 'SOURCE_MIGRATION_MISMATCH'}
 }}finally{$archive.Dispose()}
 $meta=Snapshot ($bundle.project+'-mysql-1')
 if($meta.users -ne 7 -or $meta.specialties -ne 4 -or $meta.doctors -ne 3 -or $meta.eligible -ne '5' -or $bundle.fixture_ids.users.DOCTOR_ELIGIBLE -ne '5'){throw 'SOURCE_BASELINE_NOT_READY'}
 return $meta
}
function Random-Key {
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($bytes);return [Convert]::ToBase64String($bytes)}finally{[Array]::Clear($bytes,0,$bytes.Length);$rng.Dispose()}
}
function Free-Port {$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop();return $port}
function Save-State($state){$state|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $stateFile -Encoding UTF8}
function Verify-Clone($state){
 $mysql=Inspect $state.mysql;$backend=Inspect $state.backend
 foreach($item in @($mysql,$backend)){if($item.Config.Labels.'clinic.qa.fe.d10.acceptance' -ne $state.cloneId){throw 'CLONE_SCOPE_MISMATCH'}}
 if(-not @($mysql.Mounts|Where-Object{$_.Name -eq $state.volume -and $_.Destination -eq '/var/lib/mysql'}).Count){throw 'CLONE_VOLUME_MISMATCH'}
 $runtimeHash=((Docker-Capture -Arguments @('exec',$state.backend,'sha256sum','/app/backend.jar')) -split '\s+')[0]
 if($runtimeHash -ne $state.jarHash){throw 'CLONE_ARTIFACT_MISMATCH'}
 return Snapshot $state.mysql -Full
}
try{
 $stage='VAULT_READ';$bundle=Read-Bundle
 $stage='VERIFY_SOURCE';$source=Verify-Source $bundle
 if($Action -eq 'VerifySource'){
  @{status='PASS';sourceProtected=$true;sourceFixtureId=$bundle.fixture_id;users=$source.users;specialties=$source.specialties;doctors=$source.doctors;eligibleId=$source.eligible;jarSha256=$bundle.jar_sha256;backendCommit=$bundle.backend_commit;mysqlVersion=(Sql-Read ($bundle.project+'-mysql-1') 'SELECT VERSION();');history=$source.history}|ConvertTo-Json -Compress;exit 0
 }
 if($Action -eq 'StartClone'){
  New-Item -ItemType Directory -Force -Path $artifacts|Out-Null
  if(Test-Path -LiteralPath $stateFile){$previous=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json;foreach($name in @($previous.mysql,$previous.backend)){if($name -and (Docker-Capture -Arguments @('ps','-a','-q','--filter',('name=^'+$name+'$'))).Trim()){$existing=Inspect $name;if($existing.State.Running){throw 'CLEANUP_PREVIOUS_CLONE_FIRST'}}}}
  if(Get-NetTCPConnection -State Listen -LocalPort 5192 -ErrorAction SilentlyContinue){throw 'FRONTEND_PORT_BUSY'}
  $id=[Guid]::NewGuid().ToString('N').Substring(0,12);$project='clinic-fe-d10-acceptance-'+$id
  $state=@{cloneId=$id;project=$project;mysql=$project+'-mysql';backend=$project+'-backend';volume=$project+'_mysql_data';network=$project+'_default';sourceFixtureId=$bundle.fixture_id;sourceFingerprint=$source.fingerprint;frontendOrigin=$frontOrigin;vitePid=0;chromePid=0;debugPort=0}
  Save-State $state
  $stage='CREATE_ISOLATED_COPY'
  Docker-Capture -Arguments @('volume','create','--label',('clinic.qa.fe.d10.acceptance='+$id),$state.volume)|Out-Null
  # The default Docker address pool can be exhausted by retained QA networks.
  # Docker itself rejects overlap; never remove a network to free an address.
  $networks=@(Docker-Capture -Arguments (@('network','inspect')+@((Docker-Capture -Arguments @('network','ls','-q')) -split "`n"))|ConvertFrom-Json)
  $usedSubnets=@($networks|ForEach-Object{$_.IPAM.Config}|ForEach-Object{$_.Subnet})
  $subnet=$null
  for($octet=238;$octet -ge 200;$octet--){$candidate='10.254.'+$octet+'.0/24';if($candidate -notin $usedSubnets){$subnet=$candidate;break}}
  if(-not $subnet){throw 'QA_SUBNET_POOL_EXHAUSTED'}
  Docker-Capture -Arguments @('network','create','--subnet',$subnet,'--label',('clinic.qa.fe.d10.acceptance='+$id),$state.network)|Out-Null
  $env:MYSQL_ROOT_PASSWORD=Random-Key;$env:MYSQL_PASSWORD=Random-Key;$env:MYSQL_DATABASE='clinic_management_db';$env:MYSQL_USER='clinic_app'
  $dbPort=Free-Port
  Docker-Capture -Arguments @('run','-d','--pull','never','--name',$state.mysql,'--label',('clinic.qa.fe.d10.acceptance='+$id),'--network',$state.network,'--network-alias','mysql','--mount',('type=volume,source='+$state.volume+',target=/var/lib/mysql'),'-p',('127.0.0.1:'+$dbPort+':3306'),'--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_PASSWORD','--env','MYSQL_DATABASE','--env','MYSQL_USER','--health-cmd','mysqladmin ping -h127.0.0.1 --silent','--health-interval','2s','--health-retries','60','mysql:8.4')|Out-Null
  for($attempt=0;$attempt -lt 100;$attempt++){if((Inspect $state.mysql).State.Health.Status -eq 'healthy'){break};Start-Sleep -Milliseconds 500}
  if((Inspect $state.mysql).State.Health.Status -ne 'healthy'){throw 'CLONE_MYSQL_NOT_HEALTHY'}
  $stage='COPY_IN_MEMORY'
  $dumpCommand='export MYSQL_PWD=$MYSQL_PASSWORD; exec mysqldump --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --single-transaction --skip-lock-tables --skip-add-drop-table --skip-add-locks --skip-comments --no-tablespaces --set-gtid-purged=OFF clinic_management_db'
  $dump=Docker-Capture -Arguments @('exec',($bundle.project+'-mysql-1'),'sh','-c',$dumpCommand)
  $OutputEncoding=[Text.UTF8Encoding]::new($false)
  $import='export MYSQL_PWD=$MYSQL_PASSWORD; exec mysql --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --database=clinic_management_db'
  Docker-Capture -Arguments @('exec','-i',$state.mysql,'sh','-c',$import) -InputScript $dump|Out-Null
  $dump=$null
  $copy=Snapshot $state.mysql
  if($copy.fingerprint -ne $source.fingerprint -or $copy.eligible -ne '5' -or $copy.users -ne 7){throw 'CLONE_COPY_MISMATCH'}
  $stage='VERIFY_D04_ARTIFACT'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($jar)
  try{foreach($class in @('ProfileController','PatientController','DoctorController','MedicalRecordController')){if(-not $archive.GetEntry('BOOT-INF/classes/com/clinicmanagement/controller/'+$class+'.class')){throw 'D04_CONTROLLER_REQUIRED'}}
   foreach($migration in Get-ChildItem -LiteralPath (Join-Path $workspace 'backend/src/main/resources/db/migration') -Filter 'V[1-4]__*.sql'){
    $entry=$archive.GetEntry('BOOT-INF/classes/db/migration/'+$migration.Name);if(-not $entry){throw 'D04_MIGRATION_REQUIRED'}
    $reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8)
    try{$packaged=$reader.ReadToEnd().Replace("`r`n","`n")}finally{$reader.Dispose()}
    if([IO.File]::ReadAllText($migration.FullName).Replace("`r`n","`n") -cne $packaged){throw 'D04_MIGRATION_ARTIFACT_MISMATCH'}
   }
  }finally{$archive.Dispose()}
  $stage='START_CLONE_BACKEND'
  $env:DB_URL='jdbc:mysql://mysql:3306/clinic_management_db?connectionTimeZone=UTC';$env:DB_USERNAME='clinic_app';$env:DB_PASSWORD=$env:MYSQL_PASSWORD
  $env:JWT_SECRET=Random-Key;$env:JWT_ISSUER='clinic-fe-d10-'+$id;$env:CORS_ALLOWED_ORIGINS=$frontOrigin;$env:SPRING_PROFILES_ACTIVE='default';$env:LOGGING_LEVEL_ROOT='WARN'
  $apiPort=Free-Port;$state.apiURL='http://127.0.0.1:'+$apiPort;$state.jarHash=$jarHash;Save-State $state
  $args=@('run','-d','--pull','never','--name',$state.backend,'--label',('clinic.qa.fe.d10.acceptance='+$id),'--network',$state.network,'-p',('127.0.0.1:'+$apiPort+':8080'),'--mount',('type=bind,source='+$jar+',target=/app/backend.jar,readonly'))
  foreach($name in @('DB_URL','DB_USERNAME','DB_PASSWORD','JWT_SECRET','JWT_ISSUER','CORS_ALLOWED_ORIGINS','SPRING_PROFILES_ACTIVE','LOGGING_LEVEL_ROOT')){$args+=@('--env',$name)}
  Docker-Capture -Arguments ($args+@('eclipse-temurin:21-jre-alpine','java','-jar','/app/backend.jar'))|Out-Null
  foreach($name in @('MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','DB_PASSWORD','JWT_SECRET')){Remove-Item -LiteralPath ('Env:'+$name)}
  for($attempt=0;$attempt -lt 100;$attempt++){try{if((Invoke-RestMethod -Uri ($state.apiURL+'/api/v1/health') -TimeoutSec 2).data.status -eq 'UP'){break}}catch{};Start-Sleep -Milliseconds 500}
  if((Invoke-RestMethod -Uri ($state.apiURL+'/api/v1/health') -TimeoutSec 3).data.status -ne 'UP'){throw 'CLONE_BACKEND_NOT_READY'}
  $upgraded=Snapshot $state.mysql -Full
  if($upgraded.fingerprint -ne $source.fingerprint){throw 'COPY_CATALOG_CHANGED_BY_UPGRADE'}
  $stage='START_FE_AND_CHROME'
  $env:VITE_API_BASE_URL=$state.apiURL;$env:VITE_AUTH_MOCK='false';$env:VITE_DIRECTORY_MOCK='false';$env:VITE_PROFILE_MOCK='false';$env:VITE_PATIENT_MOCK='false';$env:VITE_BOOKING_MOCK='false';$env:VITE_EXAMINATION_MOCK='false';$env:DEBUG=''
  $viteScript=Join-Path $frontend 'node_modules/vite/bin/vite.js'
  $vite=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"'+$viteScript+'"'),'--host','127.0.0.1','--port','5192','--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'vite.stdout.log') -RedirectStandardError (Join-Path $artifacts 'vite.stderr.log')
  $state.vitePid=$vite.Id;Save-State $state
  $profile=Join-Path $artifacts ('chrome-'+$id)
  New-Item -ItemType Directory -Force -Path $profile|Out-Null
  $chrome=Start-Process -FilePath 'C:/Program Files/Google/Chrome/Application/chrome.exe' -ArgumentList @('--headless=new','--incognito','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',('--user-data-dir="'+$profile+'"'),'--no-first-run','--no-default-browser-check','--disable-save-password-bubble','--disable-logging','--log-level=3',($frontOrigin+'/login')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'chrome.stdout.log') -RedirectStandardError (Join-Path $artifacts 'chrome.stderr.log')
  $state.chromePid=$chrome.Id;Save-State $state
  $portFile=Join-Path $profile 'DevToolsActivePort'
  for($attempt=0;$attempt -lt 80 -and -not(Test-Path -LiteralPath $portFile);$attempt++){Start-Sleep -Milliseconds 250}
  $state.debugPort=[int](Get-Content -LiteralPath $portFile -TotalCount 1);Save-State $state
 }else{$state=Get-Content -LiteralPath $stateFile -Raw|ConvertFrom-Json}
 if($source.fingerprint -ne $state.sourceFingerprint){throw 'SOURCE_CATALOG_CHANGED'}
 if($Action -in @('Verify','Audit','Cleanup')){
  $copy=Verify-Clone $state
  if($Action -eq 'Audit'){
   $texts=@(Docker-Capture -Arguments @('logs',$state.backend))
   foreach($file in Get-ChildItem -LiteralPath $artifacts -Filter '*.log' -File){$s=[IO.File]::Open($file.FullName,'Open','Read','ReadWrite');$r=[IO.StreamReader]::new($s);try{$texts+=$r.ReadToEnd()}finally{$r.Dispose();$s.Dispose()}}
   foreach($text in $texts){foreach($account in $bundle.accounts.PSObject.Properties){if($text.Contains($account.Value.password)-or$text.Contains($account.Value.email)){throw 'CREDENTIAL_IN_QA_LOG'}};if($text -match '\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}'){throw 'TOKEN_OR_HASH_IN_QA_LOG'}}
  }
  if($Action -eq 'Cleanup'){
   foreach($item in @(@{id=$state.vitePid;match=(Join-Path $frontend 'node_modules/vite/bin/vite.js')},@{id=$state.chromePid;match=(Join-Path $artifacts ('chrome-'+$state.cloneId))})){$process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.id);if($process -and $process.CommandLine.Contains($item.match)){Stop-Process -Id $item.id}}
   Docker-Capture -Arguments @('stop',$state.backend,$state.mysql)|Out-Null
  }
  @{status='PASS';sourceUnchanged=$true;sourceEligibleId='5';cloneId=$state.cloneId;cloneUsers=$copy.users;cloneSpecialties=$copy.specialties;cloneDoctors=$copy.doctors;clonePatients=$copy.patients;cloneEligibleIds=$copy.eligible;history=$copy.history;logsAudited=($Action -eq 'Audit');cloneStopped=($Action -eq 'Cleanup');volumesPreserved=$true}|ConvertTo-Json -Compress;exit 0
 }
 $stage='PRIVATE_HANDOFF'
 $backendMetadata=Inspect $state.backend;$privateEnv=@{};foreach($entry in $backendMetadata.Config.Env){$pair=$entry -split '=',2;$privateEnv[$pair[0]]=$pair[1]}
 function Url64([byte[]]$value){return [Convert]::ToBase64String($value).TrimEnd('=').Replace('+','-').Replace('/','_')}
 $header=Url64 ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
 $now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
 $claims=@{iss=$privateEnv.JWT_ISSUER;sub=[string]$bundle.fixture_ids.users.ADMIN;iat=($now-7200);exp=($now-3600);jti=[Guid]::NewGuid().ToString();role='ADMIN'}|ConvertTo-Json -Compress
 $unsigned=$header+'.'+(Url64 ([Text.Encoding]::UTF8.GetBytes($claims)))
 $hmac=[Security.Cryptography.HMACSHA256]::new();try{$hmac.Key=[Convert]::FromBase64String($privateEnv.JWT_SECRET);$expired=$unsigned+'.'+(Url64 ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($unsigned))))}finally{$hmac.Dispose()}
 $payload=@{apiURL=$state.apiURL;accounts=$bundle.accounts;fixtureIds=$bundle.fixture_ids;sourceProtected=$true;scopeVerified=$true;cloneId=$state.cloneId;expiredToken=$expired}

 $json=$payload|ConvertTo-Json -Depth 12 -Compress
 $expression='(()=>{if(location.origin!=="'+$frontOrigin+'")return false;Object.defineProperty(window,"__d03Acceptance",{value:'+$json+',configurable:true});return true;})()'
 for($attempt=0;$attempt -lt 60;$attempt++){try{Invoke-Cdp $state.debugPort $expression;break}catch{if($_.Exception.Message -ne 'QA_CDP_ORIGIN_NOT_READY' -or $attempt -eq 59){throw};Start-Sleep -Milliseconds 250}}
 @{status='PASS';sourceProtected=$true;sourceEligibleId='5';cloneId=$state.cloneId;debugPort=$state.debugPort;frontendOrigin=$frontOrigin;credentialsRecorded=$false}|ConvertTo-Json -Compress
}catch{
 $safe=if($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]+$'){$_.Exception.Message}else{$_.Exception.GetType().Name}
 @{status='BLOCKED';stage=$stage;code=$safe;line=$_.InvocationInfo.ScriptLineNumber;errorId=$_.FullyQualifiedErrorId;credentialsRecorded=$false}|ConvertTo-Json -Compress;exit 1
}
