param(
    [Parameter(Mandatory=$true)][ValidateSet('npx', 'uvx')][string]$Runtime
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable.' }
$Base = Join-Path $env:LOCALAPPDATA 'elio\runtimes'
if ($Runtime -eq 'npx') {
    $Name = 'node-22.22.0'
    $Url = 'https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip'
    $Hash = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'
    $Files = @('node.exe', 'node_modules\npm\bin\npx-cli.js')
} else {
    $Name = 'uv-0.12.21'
    $Url = 'https://files.pythonhosted.org/packages/2a/06/bda383b338dd21bcd74c9b4ba47301315573fdb5aba46fe40835f8299482/uv-0.12.21-py3-none-win_amd64.whl'
    $Hash = '8c7c3eb32d84c711906dedd09df7379cf4d9f5bb84b8e58a1244ca0a8a1209d4'
    $Files = @('uv.exe', 'uvx.exe')
}
$Destination = Join-Path $Base $Name
$Identity = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Destination))).Replace('-', '')
$Mutex = New-Object Threading.Mutex($false, "Local\elioRuntime-$Identity")
$Locked = $false
$Stage = $null
try {
    try { $Locked = $Mutex.WaitOne(240000) } catch [Threading.AbandonedMutexException] { $Locked = $true }
    if (-not $Locked) { throw 'Another elio runtime setup is still running. Retry shortly.' }
    $Marker = Join-Path $Destination '.complete'
    $Ready = (Test-Path -LiteralPath $Marker -PathType Leaf)
    foreach ($File in $Files) { $Ready = $Ready -and (Test-Path -LiteralPath (Join-Path $Destination $File) -PathType Leaf) }
    if ($Ready -and ((Get-Content -LiteralPath $Marker -Raw).Trim() -eq $Hash)) { exit 0 }
    New-Item -ItemType Directory -Path $Base -Force | Out-Null
    $Stage = Join-Path $Base ('.setup-' + $Name + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Stage | Out-Null
    $Archive = Join-Path $Stage 'runtime.zip'
    $Client = New-Object Net.WebClient
    try { $Client.DownloadFile($Url, $Archive) } finally { $Client.Dispose() }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw 'Runtime checksum mismatch. The download was not installed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Extracted = Join-Path $Stage 'extracted'
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Extracted)
    if ($Runtime -eq 'npx') {
        $Payload = Join-Path $Extracted 'node-v22.22.0-win-x64'
    } else {
        $Payload = Join-Path $Stage 'payload'
        New-Item -ItemType Directory -Path $Payload | Out-Null
        $Scripts = Join-Path $Extracted 'uv-0.12.21.data\scripts'
        Copy-Item -LiteralPath (Join-Path $Scripts 'uv.exe'), (Join-Path $Scripts 'uvx.exe') -Destination $Payload
        Copy-Item -LiteralPath (Join-Path $Extracted 'uv-0.12.21.dist-info\licenses') -Destination $Payload -Recurse
    }
    foreach ($File in $Files) {
        if (-not (Test-Path -LiteralPath (Join-Path $Payload $File) -PathType Leaf)) { throw "Downloaded runtime is missing $File" }
    }
    Set-Content -LiteralPath (Join-Path $Payload '.complete') -Value $Hash -Encoding ASCII
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    [IO.Directory]::Move($Payload, $Destination)
} catch {
    [Console]::Error.WriteLine('Unable to prepare ' + $Runtime + ': ' + $_.Exception.Message + ' Check internet access, then disable and enable the MCP server to retry.')
    exit 1
} finally {
    if ($Stage -and (Test-Path -LiteralPath $Stage)) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
    if ($Locked) { $Mutex.ReleaseMutex() }
    $Mutex.Dispose()
}
