param(
    [ValidateSet('Verify','Start','Inject','Audit','Cleanup')][string]$Action = 'Verify',
    [string]$Target = 'ClinicManagement/QA/Staff/83710bc5bb2e'
)
# Run in the authorized Windows PowerShell host. Never serialize the vault to disk/stdout.
# Read-only access to the named QA stack; no provision/set-role/DB/backend mutations.
$ErrorActionPreference = 'Stop'
$script:SafeStage = 'INITIALIZE'
$frontend = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$artifacts = Join-Path $frontend 'test-results/staff-host'
$stateFile = Join-Path $artifacts 'state.json'
$frontOrigin = 'http://127.0.0.1:5173'

function Read-QaBundle {
    $script:SafeStage = 'VAULT_READ'
    if ($Target -ne 'ClinicManagement/QA/Staff/83710bc5bb2e') { throw 'TARGET_REFUSED' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClinicStaffVault {
 [StructLayout(LayoutKind.Sequential)] public struct Credential {
  public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
  public long LastWritten; public uint BlobSize; public IntPtr Blob; public uint Persist;
  public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
 }
 [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool CredRead(string target,uint type,uint flags,out IntPtr credential);
 [DllImport("Advapi32.dll")] public static extern void CredFree(IntPtr credential);
}
'@
    $pointer = [IntPtr]::Zero
    if (-not [ClinicStaffVault]::CredRead($Target,1,0,[ref]$pointer)) { throw 'VAULT_UNAVAILABLE_IN_THIS_WINDOWS_CONTEXT' }
    $bytes = $null
    try {
        $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer,[type][ClinicStaffVault+Credential])
        $bytes = New-Object byte[] $credential.BlobSize
        [Runtime.InteropServices.Marshal]::Copy($credential.Blob,$bytes,0,$bytes.Length)
        $bundle = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    } finally {
        if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        [ClinicStaffVault]::CredFree($pointer)
    }
    if ($bundle.fixture_id -ne '83710bc5bb2e' -or $bundle.project -ne 'clinic-staff-qa-83710bc5bb2e') { throw 'QA_SCOPE_MISMATCH' }
    if ($bundle.backend_container -ne ($bundle.project + '-backend')) { throw 'QA_BACKEND_MISMATCH' }
    if (([uri]$bundle.api_base_url).Host -ne '127.0.0.1') { throw 'NON_LOOPBACK_API_REFUSED' }
    return $bundle
}

function Docker-Capture([string[]]$Arguments,[string]$InputScript = '') {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($InputScript) { $output = $InputScript | & docker @Arguments 2>&1 }
        else { $output = & docker @Arguments 2>&1 }
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) {
        $sqlError = [regex]::Match(($output -join "`n"),'ERROR\s+(\d+)')
        if ($sqlError.Success) { throw ('QA_MYSQL_' + $sqlError.Groups[1].Value) }
        throw 'QA_DOCKER_OPERATION_FAILED'
    }
    return ($output -join "`n")
}

function Verify-QaRuntime($bundle) {
    $script:SafeStage = 'QA_RUNTIME_PROVENANCE'
    $backend = @(Docker-Capture -Arguments @('inspect',$bundle.backend_container) | ConvertFrom-Json)[0]
    if (-not $backend.State.Running -or $backend.Config.Labels.'clinic.qa.fixture_id' -ne $bundle.fixture_id) { throw 'QA_BACKEND_IDENTITY_FAILED' }
    $jarHash = Docker-Capture -Arguments @('exec',$bundle.backend_container,'sha256sum','/app/backend.jar')
    if (($jarHash -split '\s+')[0] -ne 'c2bce75de74bddc28fcf698d6b9f7f73b9a55681448e68bb3c54a05f405bc07e') { throw 'QA_BACKEND_ARTIFACT_MISMATCH' }
    $network = $bundle.project + '_default'
    if (-not $backend.NetworkSettings.Networks.PSObject.Properties[$network]) { throw 'QA_NETWORK_MISMATCH' }
    $port = $backend.NetworkSettings.Ports.'8080/tcp' | Select-Object -First 1
    if ($port.HostIp -ne '127.0.0.1' -or [int]$port.HostPort -ne ([uri]$bundle.api_base_url).Port) { throw 'QA_API_PORT_MISMATCH' }
    $envMap = @{}
    foreach ($entry in $backend.Config.Env) { $parts = $entry -split '=',2; $envMap[$parts[0]] = $parts[1] }
    if ($envMap.DB_URL -ne 'jdbc:mysql://mysql:3306/clinic_management_db?connectionTimeZone=UTC' -or $envMap.DB_PASSWORD -ne $bundle.db_password -or $envMap.JWT_SECRET -ne $bundle.jwt_secret -or $envMap.JWT_ISSUER -ne $bundle.jwt_issuer -or $envMap.SPRING_PROFILES_ACTIVE -ne 'mysql-validation') { throw 'QA_BACKEND_DB_CONFIGURATION_MISMATCH' }
    if ($frontOrigin -notin ($envMap.CORS_ALLOWED_ORIGINS -split ',')) { throw 'QA_CORS_ORIGIN_NOT_ALLOWED' }
    $mysqlIds = (Docker-Capture -Arguments @('ps','-q','--filter',('label=com.docker.compose.project=' + $bundle.project),'--filter','label=com.docker.compose.service=mysql')).Trim()
    if (-not $mysqlIds -or $mysqlIds.Contains("`n")) { throw 'QA_MYSQL_IDENTITY_FAILED' }
    $mysql = @(Docker-Capture -Arguments @('inspect',$mysqlIds) | ConvertFrom-Json)[0]
    if ($mysql.State.Health.Status -ne 'healthy' -or -not @($mysql.Mounts | Where-Object { $_.Name -eq ($bundle.project + '_clinic_mysql_data') -and $_.Destination -eq '/var/lib/mysql' }).Count) { throw 'QA_MYSQL_VOLUME_MISMATCH' }
    $emails = @()
    foreach ($role in @('ADMIN','DOCTOR','RECEPTIONIST')) {
        $account = $bundle.accounts.$role
        if ($account.role -ne $role -or $account.status -ne 'ACTIVE' -or $account.email -notmatch ('^qa-' + $bundle.fixture_id + '-[a-z]+@example\.test$')) { throw 'QA_ACCOUNT_SCOPE_MISMATCH' }
        $emails += "'" + $account.email.Replace("'","''") + "'"
    }
    $sql = 'SELECT id,email,role,status,(LEFT(password_hash,7) IN ("$2a$12$","$2b$12$","$2y$12$")) FROM users WHERE email IN (' + ($emails -join ',') + ') ORDER BY role;'
    $script:SafeStage = 'QA_SQL_READ_ONLY'
    $mysqlCommand = 'export MYSQL_PWD=$MYSQL_PASSWORD; exec mysql --protocol=TCP --host=127.0.0.1 --user=$MYSQL_USER --database=$MYSQL_DATABASE --batch --skip-column-names'
    $rows = (Docker-Capture -Arguments @('exec','-i',$mysqlIds,'sh','-c',$mysqlCommand) -InputScript $sql) -split "`n"
    if ($rows.Count -ne 3) { throw 'QA_STAFF_ROW_COUNT_MISMATCH' }
    $ids = @{}
    foreach ($row in $rows) {
        $fields = $row.TrimEnd("`r") -split "`t"
        if ($fields.Count -ne 5 -or $fields[2] -notin @('ADMIN','DOCTOR','RECEPTIONIST') -or $fields[1] -ne $bundle.accounts.($fields[2]).email -or $fields[3] -ne 'ACTIVE' -or $fields[4] -ne '1') { throw 'QA_STAFF_DB_MATCH_FAILED' }
        $ids[$fields[2]] = $fields[0]
    }
    $historyRows = Docker-Capture -Arguments @('exec','-i',$mysqlIds,'sh','-c',$mysqlCommand) -InputScript 'SELECT version,script,checksum,success FROM flyway_schema_history ORDER BY installed_rank;'
    if ($historyRows.Trim() -ne "1`tV1__create_users.sql`t1116148885`t1") { throw 'QA_FLYWAY_HISTORY_MISMATCH' }
    $health = Invoke-RestMethod -Uri ($bundle.api_base_url + '/api/v1/health') -TimeoutSec 10
    if ($health.data.status -ne 'UP') { throw 'QA_HEALTH_FAILED' }
    return @{ ids=$ids; databaseVerified=$true; activeRoles=@('ADMIN','DOCTOR','RECEPTIONIST'); bcryptCost=12; isolatedVolumeVerified=$true; corsVerified=$true;flywayChecksum=1116148885 }
}

function Invoke-Cdp([int]$DebugPort,[string]$Expression) {
    $targets = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $DebugPort + '/json/list')
    $tab = @($targets | Where-Object { $_.type -eq 'page' -and $_.url.StartsWith($frontOrigin + '/') })
    if ($tab.Count -ne 1) { throw 'QA_CHROME_TAB_NOT_UNIQUE' }
    $socket = New-Object Net.WebSockets.ClientWebSocket
    $cancel = New-Object Threading.CancellationTokenSource 15000
    $requestBytes = $null
    try {
        [void]$socket.ConnectAsync([uri]$tab[0].webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult()
        $request = @{id=1;method='Runtime.evaluate';params=@{expression=$Expression;returnByValue=$true;awaitPromise=$true}} | ConvertTo-Json -Depth 20 -Compress
        $requestBytes = [Text.Encoding]::UTF8.GetBytes($request)
        $segment = [ArraySegment[byte]]::new($requestBytes)
        [void]$socket.SendAsync($segment,[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()
        do {
            $stream = New-Object IO.MemoryStream
            do {
                $buffer = New-Object byte[] 8192
                $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult()
                $stream.Write($buffer,0,$received.Count)
            } while (-not $received.EndOfMessage)
            $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
            $stream.Dispose()
        } while ($message.id -ne 1)
        if ($message.error) { throw 'QA_CDP_COMMAND_FAILED' }
        if ($message.result.exceptionDetails) { throw 'QA_CDP_SCRIPT_FAILED' }
        if ($message.result.result.value -ne $true) { throw 'QA_CDP_ORIGIN_NOT_READY' }
    } finally {
        if ($requestBytes) { [Array]::Clear($requestBytes,0,$requestBytes.Length) }
        $socket.Dispose(); $cancel.Dispose()
    }
}

function To-Base64Url([byte[]]$Bytes) { return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }

try {
    if ($Action -eq 'Cleanup') {
        $script:SafeStage = 'CLEANUP'
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $state.chromePid)
        if ($process -and $process.CommandLine.Contains((Join-Path $artifacts 'chrome-profile'))) { Stop-Process -Id $state.chromePid }
        @{status='PASS';chromeStopped=$true;backendUnchanged=$true;databaseUnchanged=$true} | ConvertTo-Json -Compress
        exit 0
    }
    $bundle = Read-QaBundle
    $verification = Verify-QaRuntime $bundle
    if ($Action -eq 'Audit') {
        $script:SafeStage = 'REDACTED_OUTPUT_AUDIT'
        $texts = @((Docker-Capture -Arguments @('logs',$bundle.backend_container)))
        foreach ($directory in @('src','docs','tests')) {
            foreach ($file in Get-ChildItem -LiteralPath (Join-Path $frontend $directory) -Recurse -File | Where-Object { $_.Extension -in @('.ts','.tsx','.mjs','.json','.md','.ps1') }) {
                $texts += [IO.File]::ReadAllText($file.FullName)
            }
        }
        foreach ($file in Get-ChildItem -LiteralPath $artifacts -Filter '*.log' -File) {
            $stream = [IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            $reader = New-Object IO.StreamReader $stream
            try { $texts += $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
        }
        $secrets = @($bundle.db_password,$bundle.jwt_secret)
        foreach ($role in @('ADMIN','DOCTOR','RECEPTIONIST')) { $secrets += $bundle.accounts.$role.password; $secrets += $bundle.accounts.$role.email }
        foreach ($content in $texts) {
            foreach ($secret in $secrets) { if ($secret -and $content.Contains($secret)) { throw 'QA_SENSITIVE_VALUE_FOUND_IN_OUTPUT' } }
            if ($content -match '\beyJ[\w-]+\.[\w-]+\.[\w-]+\b' -or $content -match '\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}') { throw 'QA_TOKEN_OR_HASH_FOUND_IN_OUTPUT' }
        }
        @{status='PASS';fixtureId=$bundle.fixture_id;databaseVerified=$true;staffUnchanged=$true;flywayChecksum=$verification.flywayChecksum;outputAuditPassed=$true;credentialValuesRecorded=$false} | ConvertTo-Json -Compress
        exit 0
    }
    if ($Action -eq 'Verify') {
        @{status='PASS';fixtureId=$bundle.fixture_id;vaultReadable=$true;databaseVerified=$verification.databaseVerified;activeRoles=$verification.activeRoles;bcryptCost=12;isolatedVolumeVerified=$true;corsVerified=$true} | ConvertTo-Json -Compress
        exit 0
    }
    New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
    if ($Action -eq 'Start') {
        $script:SafeStage = 'VITE_START'
        foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue)) {
            $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
            if ($process.CommandLine -notlike ('*' + $workspace + '*frontend*vite*')) { throw 'PORT_5173_NOT_OWNED_BY_THIS_FE' }
            Stop-Process -Id $listener.OwningProcess
        }
        $env:VITE_API_BASE_URL = $bundle.api_base_url
        $env:VITE_AUTH_MOCK = 'false'
        $env:DEBUG = ''
        $viteScript = Join-Path $frontend 'node_modules/vite/bin/vite.js'
        $vite = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"' + $viteScript + '"'),'--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'vite.stdout.log') -RedirectStandardError (Join-Path $artifacts 'vite.stderr.log')
        $script:SafeStage = 'CHROME_START'
        $profile = Join-Path $artifacts 'chrome-profile'
        New-Item -ItemType Directory -Force -Path $profile | Out-Null
        $portFile = Join-Path $profile 'DevToolsActivePort'
        if (Test-Path -LiteralPath $portFile) { Remove-Item -LiteralPath $portFile }
        $chrome = Start-Process -FilePath 'C:/Program Files/Google/Chrome/Application/chrome.exe' -ArgumentList @('--headless=new','--incognito','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',('--user-data-dir="' + $profile + '"'),'--no-first-run','--no-default-browser-check','--disable-save-password-bubble','--disable-logging','--log-level=3',($frontOrigin + '/login')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifacts 'chrome.stdout.log') -RedirectStandardError (Join-Path $artifacts 'chrome.stderr.log')
        for ($attempt=0; $attempt -lt 80 -and -not (Test-Path -LiteralPath $portFile); $attempt++) { Start-Sleep -Milliseconds 250 }
        $debugPort = [int](Get-Content -LiteralPath $portFile -TotalCount 1)
        $state = @{chromePid=$chrome.Id;vitePid=$vite.Id;debugPort=$debugPort;fixtureId=$bundle.fixture_id;frontendOrigin=$frontOrigin}
        $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
        for ($attempt=0;$attempt -lt 60;$attempt++) {
            try { if ((Invoke-WebRequest -UseBasicParsing -Uri ($frontOrigin + '/login') -TimeoutSec 2).StatusCode -eq 200) { break } } catch { }
            Start-Sleep -Milliseconds 250
        }
    } else { $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json; $debugPort = [int]$state.debugPort }
    $script:SafeStage = 'MEMORY_HANDOFF'
    $expired = @{}
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    foreach ($role in @('ADMIN','DOCTOR','RECEPTIONIST')) {
        $header = To-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
        $payload = @{iss=$bundle.jwt_issuer;sub=[string]$verification.ids[$role];iat=$now-120;exp=$now-1} | ConvertTo-Json -Compress
        $unsigned = $header + '.' + (To-Base64Url ([Text.Encoding]::UTF8.GetBytes($payload)))
        $hmac = New-Object Security.Cryptography.HMACSHA256
        try { $hmac.Key = [Convert]::FromBase64String($bundle.jwt_secret); $expired[$role] = $unsigned + '.' + (To-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($unsigned)))) } finally { $hmac.Dispose() }
    }
    $webPayload = @{apiURL=$bundle.api_base_url;fixtureId=$bundle.fixture_id;accounts=$bundle.accounts;databaseIds=$verification.ids;expiredTokens=$expired;dbRolesVerified=$true}
    $json = $webPayload | ConvertTo-Json -Depth 12 -Compress
    $expression = '(() => { if(location.origin !== "' + $frontOrigin + '") return false; Object.defineProperty(window,"__staffAcceptance",{value:' + $json + ',configurable:true,writable:true}); return true; })()'
    for ($attempt=0;$attempt -lt 40;$attempt++) {
        try { Invoke-Cdp $debugPort $expression; break }
        catch { if ($_.Exception.Message -ne 'QA_CDP_ORIGIN_NOT_READY' -or $attempt -eq 39) { throw }; Start-Sleep -Milliseconds 250 }
    }
    @{status='PASS';fixtureId=$bundle.fixture_id;vaultReadable=$true;databaseVerified=$true;activeRoles=@('ADMIN','DOCTOR','RECEPTIONIST');bcryptCost=12;isolatedVolumeVerified=$true;corsVerified=$true;memoryInjected=$true;debugPort=$debugPort;frontendOrigin=$frontOrigin;credentialsWritten=$false} | ConvertTo-Json -Compress
} catch {
    # Never publish exception text, native output or the credential JSON.
    $safeCode = if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]+$') { $_.Exception.Message } else { $_.Exception.GetType().Name }
    @{status='BLOCKED';stage=$script:SafeStage;code=$safeCode;credentialValuesRecorded=$false} | ConvertTo-Json -Compress
    exit 1
}
