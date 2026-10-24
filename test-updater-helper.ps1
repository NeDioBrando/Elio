# SPDX-License-Identifier: GPL-3.0-or-later
# Windows-only isolated integration tests. No production folder or account used.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=Join-Path ([IO.Path]::GetTempPath()) ('elio-update-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$helper=Join-Path $PSScriptRoot 'updater\apply-update.ps1'
function Assert($Condition,[string]$Message){if(!$Condition){throw $Message}}
function Fixture([string]$Name,[string]$Version,[bool]$Fail){
 $exe=Join-Path $root ($Name+'.exe')
 $body=if($Fail){'return 7;'}elseif($Version -eq '1.0.1'){'File.WriteAllText(Path.Combine(home,"restarted.txt"),"1.0.1"); return 0;'}else{'for(int i=0;i<args.Length-1;i++) if(args[i]=="--update-receipt") File.WriteAllText(args[i+1],"1.0.2"); System.Threading.Thread.Sleep(30000); return 0;'}
 $code=@"
using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
public class $Name {
 public static int Main(string[] args) {
  if(args.Length>0 && args[0]=="--version") { Console.WriteLine("elio-agent $Version");return 0; }
  var home=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
  File.WriteAllText(Path.Combine(home,"fixture.pid"),Process.GetCurrentProcess().Id.ToString());
  $body
 }
}
"@
 Add-Type -TypeDefinition $code -OutputAssembly $exe -OutputType ConsoleApplication
 return $exe
}
function Run-Case([string]$Name,[string]$NewExe,[string]$ManifestVersion,[string]$Mode,[bool]$Success){
 $case=Join-Path $root $Name;$install=Join-Path $case 'install';$bundle=Join-Path $case 'bundle\elio';$stage=Join-Path $case 'stage'
 New-Item -ItemType Directory -Path $install,(Join-Path $bundle 'elio-Extension'),$stage -Force|Out-Null
 Copy-Item -LiteralPath $old -Destination (Join-Path $install 'elio.exe')
 [IO.File]::WriteAllText((Join-Path $install 'config.json'),'user-config')
 Copy-Item -LiteralPath $NewExe -Destination (Join-Path $bundle 'elio.exe')
 [IO.File]::WriteAllText((Join-Path $bundle 'elio-Extension\manifest.json'),('{"version":"'+$ManifestVersion+'"}'))
 [IO.File]::WriteAllText((Join-Path $bundle 'WebView2Loader.dll'),'fixture-only')
 [IO.File]::WriteAllText((Join-Path $bundle 'config.json'),'do-not-overwrite-user')
 New-Item -ItemType Directory -Path (Join-Path $bundle 'runtime\engram'),(Join-Path $install 'runtime\engram') -Force|Out-Null
 [IO.File]::WriteAllText((Join-Path $install 'runtime\engram\engram-windows-amd64.exe'),'old-sidecar-fixture-not-executable')
 [IO.File]::WriteAllText((Join-Path $bundle 'runtime\engram\engram-windows-amd64.exe'),'new-sidecar-fixture-not-executable')
 [IO.File]::WriteAllText((Join-Path $bundle 'runtime\engram\untrusted.exe'),'must-not-install')
 $zip=Join-Path $stage 'release.zip';[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $case 'bundle'),$zip)
 if($Mode -eq 'traversal'){
  $z=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
  try{$e=$z.CreateEntry('elio/../escape.txt');$stream=$e.Open();$bytes=[Text.Encoding]::UTF8.GetBytes('bad');$stream.Write($bytes,0,$bytes.Length);$stream.Dispose()}finally{$z.Dispose()}
 }
 $sha=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant();if($Mode -eq 'bad-hash'){$sha='0'*64}
 $receipt=Join-Path $stage 'ready-fixture'
 & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $helper -InstallDir $install -ZipPath $zip -ExpectedSha256 $sha -ExpectedVersion 1.0.2 -ParentPid 2147483647 -Receipt $receipt -NoDialog
 $exit=$LASTEXITCODE
 Assert (($exit -eq 0) -eq $Success) "$Name returned unexpected exit code $exit"
 Assert ((Get-Content -LiteralPath (Join-Path $install 'config.json') -Raw) -eq 'user-config') "$Name overwrote user config"
 $actual=& (Join-Path $install 'elio.exe') --version
 Assert ($actual -eq $(if($Success){'elio-agent 1.0.2'}else{'elio-agent 1.0.1'})) "$Name did not preserve expected executable"
 Assert (!(Test-Path -LiteralPath (Join-Path $case 'escape.txt'))) "$Name escaped ZIP staging"
 Assert ((Get-Content -LiteralPath (Join-Path $install 'runtime\engram\engram-windows-amd64.exe') -Raw) -eq $(if($Success){'new-sidecar-fixture-not-executable'}else{'old-sidecar-fixture-not-executable'})) "$Name failed sidecar install/rollback"
 Assert (!(Test-Path -LiteralPath (Join-Path $install 'runtime\engram\untrusted.exe'))) "$Name installed an unallowlisted runtime"
 $pidFile=Join-Path $install 'fixture.pid'
 if(Test-Path -LiteralPath $pidFile){$fixturePid=[int](Get-Content -LiteralPath $pidFile -Raw);Stop-Process -Id $fixturePid -Force -ErrorAction SilentlyContinue}
 Write-Host "PASS Windows updater helper: $Name"
}
try{
 $old=Fixture 'FixtureOld101' '1.0.1' $false
 $new=Fixture 'FixtureNew102' '1.0.2' $false
 $bad=Fixture 'FixtureFail102' '1.0.2' $true
 Run-Case 'success' $new '1.0.2' 'normal' $true
 Run-Case 'hash-refused' $new '1.0.2' 'bad-hash' $false
 Run-Case 'manifest-refused' $new '1.0.3' 'normal' $false
 Run-Case 'traversal-refused' $new '1.0.2' 'traversal' $false
 Run-Case 'startup-rollback' $bad '1.0.2' 'normal' $false
}finally{
 Get-ChildItem -LiteralPath $root -Filter fixture.pid -Recurse -ErrorAction SilentlyContinue|ForEach-Object{try{Stop-Process -Id ([int](Get-Content -LiteralPath $_.FullName -Raw)) -Force -ErrorAction SilentlyContinue}catch{}}
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

$global:LASTEXITCODE=0
