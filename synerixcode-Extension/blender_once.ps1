# One-shot JSON round-trip to the blender-mcp addon (TCP 9876).
#   powershell -File blender_once.ps1 -Probe
#   powershell -File blender_once.ps1 synerixcode_blender_in.json synerixcode_blender_out.json
param(
  [Parameter(Position = 0)] [string]$InFile = "",
  [Parameter(Position = 1)] [string]$OutFile = "",
  [switch]$Probe
)

$ErrorActionPreference = "Stop"
$HostName = "127.0.0.1"
$Port = 9876

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

if ($Probe -or $InFile -eq "--probe") {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.ReceiveTimeout = 2500
    $c.Connect($HostName, $Port)
    $c.Close()
    Write-Output "BLENDER_UP"
    exit 0
  } catch {
    Write-Output "BLENDER_DOWN"
    exit 1
  }
}

if (-not $InFile -or -not $OutFile) {
  Write-Output "usage: blender_once.ps1 -Probe | IN.json OUT.json"
  exit 2
}

function Recv-Json($stream) {
  $buf = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  while ($true) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
    $txt = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
    try {
      $null = ConvertFrom-Json -InputObject $txt
      return $txt
    } catch { }
  }
  throw "incomplete JSON from Blender"
}

try {
  $rawIn = [System.IO.File]::ReadAllText((Resolve-Path $InFile))
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($rawIn)
  $client = New-Object System.Net.Sockets.TcpClient
  $client.ReceiveTimeout = 180000
  $client.SendTimeout = 15000
  $client.Connect($HostName, $Port)
  $stream = $client.GetStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $rawOut = Recv-Json $stream
  $stream.Close(); $client.Close()
  Write-Utf8NoBom $OutFile $rawOut
  Write-Output "SYNERIXCODE_BLENDER_OK"
  exit 0
} catch {
  $msg = [string]$_.Exception.Message
  $err = (@{ status = "error"; message = $msg } | ConvertTo-Json -Compress)
  try { Write-Utf8NoBom $OutFile $err } catch {}
  Write-Output ("SYNERIXCODE_BLENDER_ERR " + $msg)
  exit 1
}
