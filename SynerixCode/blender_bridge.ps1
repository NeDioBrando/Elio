# HTTP shim: Chrome (127.0.0.1:17617) -> blender-mcp addon TCP 9876.
# Used when Python is not on PATH. Windows always has PowerShell.
$ErrorActionPreference = "Stop"
$HttpHost = "127.0.0.1"
$HttpPort = 17617
$BlendHost = "127.0.0.1"
$BlendPort = 9876

function Test-ShimUp {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://$HttpHost`:$HttpPort/health"
    return $r.StatusCode -ge 200
  } catch { return $false }
}

if (Test-ShimUp) { Write-Output "or blender shim already up"; exit 0 }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $HttpPort)
try { $listener.Start() } catch {
  if (Test-ShimUp) { Write-Output "or blender shim already up"; exit 0 }
  Write-Error $_
  exit 1
}

function Send-Blender([string]$json) {
  $client = New-Object System.Net.Sockets.TcpClient
  $client.ReceiveTimeout = 180000
  $client.SendTimeout = 15000
  $client.Connect($BlendHost, $BlendPort)
  $stream = $client.GetStream()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $stream.Write($bytes, 0, $bytes.Length)
  $buf = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  while ($true) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
    $txt = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
    try { $null = ConvertFrom-Json -InputObject $txt; break } catch { }
  }
  $stream.Close(); $client.Close()
  return [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
}

function Probe-Blender {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.ReceiveTimeout = 1200
    $c.Connect($BlendHost, $BlendPort)
    $c.Close()
    return $true
  } catch { return $false }
}

function Read-HttpRequest($stream) {
  $sb = New-Object System.Text.StringBuilder
  $buf = New-Object byte[] 1
  while ($true) {
    $n = $stream.Read($buf, 0, 1)
    if ($n -le 0) { break }
    [void]$sb.Append([char]$buf[0])
    if ($sb.ToString().EndsWith("`r`n`r`n")) { break }
  }
  $head = $sb.ToString()
  $len = 0
  foreach ($line in $head -split "`r`n") {
    if ($line -match '^(?i)Content-Length:\s*(\d+)') { $len = [int]$Matches[1] }
  }
  $body = ""
  if ($len -gt 0) {
    $bb = New-Object byte[] $len
    $got = 0
    while ($got -lt $len) {
      $n = $stream.Read($bb, $got, $len - $got)
      if ($n -le 0) { break }
      $got += $n
    }
    $body = [System.Text.Encoding]::UTF8.GetString($bb, 0, $got)
  }
  $first = ($head -split "`r`n")[0]
  $parts = $first -split " "
  return @{ Method = $parts[0]; Path = $parts[1]; Body = $body }
}

function Write-Http($stream, [int]$code, [string]$json) {
  $payload = [System.Text.Encoding]::UTF8.GetBytes($json)
  $status = switch ($code) { 200 { "OK" } 204 { "No Content" } 400 { "Bad Request" } default { "OK" } }
  $hdr = "HTTP/1.1 $code $status`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($payload.Length)`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($hdr)
  $stream.Write($hb, 0, $hb.Length)
  if ($payload.Length -gt 0) { $stream.Write($payload, 0, $payload.Length) }
}

Write-Output "or blender shim http://$HttpHost`:$HttpPort -> $BlendHost`:$BlendPort"
while ($true) {
  $tcp = $listener.AcceptTcpClient()
  try {
    $stream = $tcp.GetStream()
    $req = Read-HttpRequest $stream
    $path = ($req.Path -split "\?")[0]
    if ($req.Method -eq "OPTIONS") {
      Write-Http $stream 204 ""
    } elseif ($req.Method -eq "GET" -and ($path -eq "/" -or $path -eq "/health" -or $path -eq "/status")) {
      $live = Probe-Blender
      $err = if ($live) { "null" } else { '"addon not listening — in Blender: N → MCP for Blender → Start MCP Server"' }
      $b = if ($live) { "true" } else { "false" }
      Write-Http $stream 200 "{`"ok`":true,`"shim`":true,`"blender`":$b,`"host`":`"$BlendHost`",`"port`":$BlendPort,`"http`":$HttpPort,`"error`":$err}"
    } elseif ($req.Method -eq "POST") {
      try {
        $obj = $req.Body | ConvertFrom-Json
        if ($path -eq "/command" -or $path -eq "/cmd") {
          $ctype = [string]$obj.type
          if (-not $ctype) { $ctype = [string]$obj.command }
          $params = $obj.params
          if (-not $params) { $params = @{} }
          $payload = @{ type = $ctype; params = $params } | ConvertTo-Json -Compress -Depth 20
          $raw = Send-Blender $payload
          $parsed = $raw | ConvertFrom-Json
          if ($parsed.status -eq "error") { throw [string]$parsed.message }
          $result = $parsed.result
          if ($null -eq $result) { $result = $parsed }
          $wrap = @{ ok = $true; result = $result } | ConvertTo-Json -Compress -Depth 20
          Write-Http $stream 200 $wrap
        } elseif ($path -eq "/tool" -or $path -eq "/call") {
          $name = [string]$obj.name
          if (-not $name) { $name = [string]$obj.tool }
          $args = $obj.arguments
          if (-not $args) { $args = $obj.params }
          if (-not $args) { $args = @{} }
          $bare = ($name -split "/")[-1]
          $ctype = $bare
          $params = @{}
          if ($bare -eq "get_scene_info" -or $bare -eq "blender_get_scene_info") { $ctype = "get_scene_info"; $params = @{} }
          elseif ($bare -eq "get_object_info" -or $bare -eq "blender_get_object_info") { $ctype = "get_object_info"; $params = @{ name = $args.name }; if (-not $params.name) { $params.name = $args.object_name } }
          elseif ($bare -eq "execute_blender_code" -or $bare -eq "execute_code" -or $bare -eq "blender_execute_code") { $ctype = "execute_code"; $params = @{ code = $args.code } }
          elseif ($bare -eq "get_viewport_screenshot" -or $bare -eq "blender_screenshot") {
            $ctype = "get_viewport_screenshot"
            $tmp = Join-Path $env:TEMP ("synerixcode_blender_shot_" + [System.Diagnostics.Process]::GetCurrentProcess().Id + ".png")
            $ms = 1000
            try { $ms = [int]$args.max_size } catch {}
            $params = @{ max_size = $ms; filepath = $tmp; format = "png" }
          } else { $params = $args }
          $payload = @{ type = $ctype; params = $params } | ConvertTo-Json -Compress -Depth 20
          $raw = Send-Blender $payload
          $parsed = $raw | ConvertFrom-Json
          if ($parsed.status -eq "error") { throw [string]$parsed.message }
          $result = $parsed.result
          if ($null -eq $result) { $result = $parsed }
          $wrap = @{ ok = $true; result = $result } | ConvertTo-Json -Compress -Depth 20
          Write-Http $stream 200 $wrap
        } else {
          Write-Http $stream 404 "{`"ok`":false,`"error`":`"not found`"}"
        }
      } catch {
        $msg = ($_ | Out-String).Trim()
        $esc = $msg.Replace("\", "\\").Replace('"', '\"').Replace("`r", " ").Replace("`n", " ")
        Write-Http $stream 200 "{`"ok`":false,`"error`":`"$esc`"}"
      }
    } else {
      Write-Http $stream 404 "{`"ok`":false,`"error`":`"not found`"}"
    }
  } catch { } finally { try { $tcp.Close() } catch {} }
}
