# Install the Roblox skills into Claude Code (Windows).
#   Right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File install.ps1
# Copies skills\* to %USERPROFILE%\.claude\skills and agents\* to %USERPROFILE%\.claude\agents.
# A skill folder that already exists is backed up first, and your LOCAL.md is carried over.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$claude = Join-Path $env:USERPROFILE ".claude"
$skillsDst = Join-Path $claude "skills"
$agentsDst = Join-Path $claude "agents"
New-Item -ItemType Directory -Force $skillsDst, $agentsDst | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Get-ChildItem (Join-Path $here "skills") -Directory | ForEach-Object {
    $dst = Join-Path $skillsDst $_.Name
    $local = $null
    if (Test-Path $dst) {
        $old = Join-Path $dst "LOCAL.md"
        if (Test-Path $old) { $local = Get-Content $old -Raw }
        $backup = Join-Path $claude ("skills-backup-" + $stamp)
        New-Item -ItemType Directory -Force $backup | Out-Null
        Move-Item $dst (Join-Path $backup $_.Name)
        Write-Host "  backed up existing $($_.Name) to $backup"
    }
    Copy-Item $_.FullName $dst -Recurse
    if ($local) { Set-Content (Join-Path $dst "LOCAL.md") $local -Encoding utf8 -NoNewline }
    Write-Host "  installed skill $($_.Name)"
}
Get-ChildItem (Join-Path $here "agents") -Filter *.md | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $agentsDst $_.Name) -Force
    Write-Host "  installed agent $($_.BaseName)"
}
Write-Host ""
Write-Host "Done. Restart Claude Code, then type:  /roblox-skills-setup"
