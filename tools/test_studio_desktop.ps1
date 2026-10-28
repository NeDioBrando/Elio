# SPDX-License-Identifier: GPL-3.0-or-later
# Syntax and C# interop layout tests. No desktop input is sent.
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '../agent/src/studio_desktop.ps1'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $path),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors -join "`n")}
$code=Get-Content -LiteralPath $path -Raw
$match=[regex]::Match($code,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if(-not $match.Success){throw 'Embedded C# not found'}
Add-Type -TypeDefinition $match.Groups[1].Value
$size=[Runtime.InteropServices.Marshal]::SizeOf([type][ElioStudioInput+INPUT])
$expected=if([IntPtr]::Size -eq 8){40}else{28}
if($size -ne $expected){throw "Wrong SendInput layout: $size != $expected"}
if($code -match 'Invoke-Expression|Start-Process|ExecutionPolicy|Set-Clipboard|Get-Clipboard'){throw 'Unexpected execution/clipboard bypass'}
if(-not $code.Contains('CopyFromScreen') -or -not $code.Contains('WindowFromPoint')){throw 'Missing real screen/hit-test guards'}
Write-Output "PASS PowerShell AST, complete embedded C# compilation, INPUT=$size, no input executed"
