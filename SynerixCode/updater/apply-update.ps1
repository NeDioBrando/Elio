# SPDX-License-Identifier: GPL-3.0-or-later
# This helper is embedded in the currently installed EXE, not fetched as code.
param(
 [Parameter(Mandatory=$true)][string]$InstallDir,
 [Parameter(Mandatory=$true)][string]$ZipPath,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
 [Parameter(Mandatory=$true)][int]$ParentPid,
 [Parameter(Mandatory=$true)][string]$Receipt,
 [switch]$NoDialog
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage=Split-Path -Parent $ZipPath
$backup=Join-Path $stage 'backup'
$payload=Join-Path $stage 'payload'
$log=Join-Path $stage 'update.log'
$changed=New-Object 'System.Collections.Generic.List[object]'
$stopped=$false
$newProcess=$null
function Note([string]$Text){Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$Text)}
function Assert-NoReparse([string]$Path){
 $p=$Path
 while($p){
  if(Test-Path -LiteralPath $p){if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Reparse point refused: $p"}}
  $next=Split-Path -Parent $p;if($next -eq $p){break};$p=$next
 }
}
function Is-PackageFile([string]$Relative){
 # Never replace user data, config.json, MCP config, history, logs or workspace.
 if($Relative -match '^synerixcode-Extension[\\/]'){return $true}
 return @('synerixcode.exe','WebView2Loader.dll','bridge-pairing.cjs','Setup-Mcp-Runtime.ps1','Start-synerixcode-Agent.cmd','launch_studio_mcp.py','launch_blender_mcp.py','blender_bridge.ps1','blender_once.ps1','blender_once.py','blender_ops.py','blender_fbx.py','README-RU.md','README.md','SOURCE.txt','UPSTREAM-SOURCE.txt','FORK-CHANGES.md','LICENSE','BRANDING-NOTICE.txt','THIRD-PARTY-NOTICES.txt','THIRD_PARTY_TEMPLATE_LICENSES.txt','TEST-REPORT.md','DESKTOP-CHAT-RU.md','DESKTOP-CHAT-TEST-REPORT.md','UPDATES-RU.md','UPDATES-TEST-REPORT.md','WINDOWS-RUNTIME-NOTICE.txt','SHA256SUMS.txt') -contains $Relative
}
try {
 Note "Validating release $ExpectedVersion"
 Assert-NoReparse $InstallDir
 if((Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'ZIP digest changed. No installed files were changed.'}
 $install=[IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
 if(!(Test-Path -LiteralPath (Join-Path $install 'synerixcode.exe'))){throw 'Installation EXE not found'}
 New-Item -ItemType Directory -Path $payload -Force | Out-Null
 New-Item -ItemType Directory -Path $backup -Force | Out-Null
 $archive=[IO.Compression.ZipFile]::OpenRead($ZipPath)
 $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 $total=0L
 $count=0
 try {
  foreach($entry in $archive.Entries){
   $name=$entry.FullName.Replace('\','/')
   if(!$name.StartsWith('synerixcode/',[StringComparison]::Ordinal)){throw 'Unexpected ZIP root'}
   $relative=$name.Substring('synerixcode/'.Length)
   if(!$relative){continue}
   $segments=$relative.Split('/')
   if($relative.Contains(':') -or $relative.StartsWith('/') -or ($segments | Where-Object {$_ -eq '..' -or $_ -eq '.' -or $_ -match '[\. ]$' -or $_ -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)'})){throw "Unsafe ZIP path: $name"}
   if($name.EndsWith('/')){continue}
   if(!$seen.Add($relative)){throw 'Duplicate ZIP file'}
   if((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'Symbolic links are not allowed'}
   $total+=$entry.Length;$count++
   if($total -gt 1073741824 -or $count -gt 20000){throw 'ZIP exceeds extraction limits'}
   $target=[IO.Path]::GetFullPath((Join-Path $payload $relative))
   if(!$target.StartsWith($payload.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP path escapes staging'}
   New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
  }
 }finally{$archive.Dispose()}
 $exe=Join-Path $payload 'synerixcode.exe'
 $manifest=Join-Path $payload 'synerixcode-Extension\manifest.json'
 if(!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $manifest) -or !(Test-Path -LiteralPath (Join-Path $payload 'WebView2Loader.dll'))){throw 'Incomplete application package'}
 if((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version -ne $ExpectedVersion){throw 'Extension version mismatch'}
 $versionOutput=& $exe --version
 if($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('^synerixcode-agent '+[regex]::Escape($ExpectedVersion)+'$')){throw 'Native version mismatch'}
 $files=@(Get-ChildItem -LiteralPath $payload -Recurse -File | Where-Object {Is-PackageFile $_.FullName.Substring($payload.Length+1)})
 # Prepare backup and write probe before asking an app to exit. Neither Studio
 # nor Blender is ever killed. Config is intentionally excluded from updates.
 foreach($file in $files){
  $relative=$file.FullName.Substring($payload.Length+1);$target=Join-Path $install $relative
  Assert-NoReparse $target
  if(Test-Path -LiteralPath $target){$saved=Join-Path $backup $relative;New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force|Out-Null;Copy-Item -LiteralPath $target -Destination $saved -Force}
 }
 $probe=Join-Path $install ('.update-probe-'+[guid]::NewGuid().ToString('N'));[IO.File]::WriteAllText($probe,'probe');Remove-Item -LiteralPath $probe
 [IO.File]::WriteAllText((Join-Path $stage 'prepared'),'ready')
 Note 'Waiting for the application to close'
 if(Get-Process -Id $ParentPid -ErrorAction SilentlyContinue){Wait-Process -Id $ParentPid -Timeout 45 -ErrorAction Stop}
 $stopped=$true
 foreach($file in $files){
  $relative=$file.FullName.Substring($payload.Length+1);$target=Join-Path $install $relative
  Assert-NoReparse $target
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  $changed.Add([pscustomobject]@{Relative=$relative;Existed=(Test-Path -LiteralPath (Join-Path $backup $relative))})
  $copied=$false
  for($try=0;$try -lt 15;$try++){try{Copy-Item -LiteralPath $file.FullName -Destination $target -Force;$copied=$true;break}catch{Start-Sleep -Milliseconds 400}}
  if(!$copied){throw "Cannot replace $relative"}
 }
 Note 'Starting the updated application'
 # Receipt path is random, lives under the per-user staging root, and is
 # acknowledged by the new executable only after all bridge ports are bound.
 $quotedReceipt='"'+$Receipt.Replace('"','')+'"'
 $newProcess=Start-Process -FilePath (Join-Path $install 'synerixcode.exe') -ArgumentList @('--update-receipt',$quotedReceipt) -WorkingDirectory $install -PassThru
 $ready=$false
 for($try=0;$try -lt 90;$try++){
  Start-Sleep -Milliseconds 500
  if($newProcess.HasExited){throw 'New executable exited before readiness'}
  if((Test-Path -LiteralPath $Receipt) -and (Get-Content -LiteralPath $Receipt -Raw) -eq $ExpectedVersion){$ready=$true;break}
 }
 if(!$ready){throw 'Updated application did not acknowledge startup'}
 Start-Sleep -Seconds 3
 if($newProcess.HasExited){throw 'Updated application crashed immediately'}
 Note 'Update complete. Reload the extension, then refresh AI chat tabs. Backup retained.'
 [IO.File]::WriteAllText((Join-Path $stage 'result.txt'),'success '+$ExpectedVersion)
}catch{
 $failure=$_.Exception.Message;Note ('FAILED: '+$failure)
 # Stop only the new process that this helper started; never kill by image name.
 if($newProcess -and !$newProcess.HasExited){Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 700}
 for($index=$changed.Count-1;$index -ge 0;$index--){
  $item=$changed[$index];$target=Join-Path $InstallDir $item.Relative
  try{if($item.Existed){Copy-Item -LiteralPath (Join-Path $backup $item.Relative) -Destination $target -Force}else{Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue}}catch{Note ('ROLLBACK FAILED: '+$item.Relative)}
 }
 if($stopped){Start-Process -FilePath (Join-Path $InstallDir 'synerixcode.exe') -WorkingDirectory $InstallDir -ErrorAction SilentlyContinue|Out-Null}
 [IO.File]::WriteAllText((Join-Path $stage 'result.txt'),'failed '+$failure)
 # The helper is hidden, so surface failure with the OS message dialog.
 if(!$NoDialog){try{Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show("Update failed. Previous files were restored where possible. Log: $log`n$failure",'SynerixCode update')|Out-Null}catch{}}
 exit 1
}
