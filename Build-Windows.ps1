$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
foreach ($Tool in @('cargo', 'python', 'node')) {
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "Install $Tool first. See README-RU.md." }
}
# Compile .NET Framework fixture EXEs under Windows PowerShell 5.1, not pwsh 7.
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\test-updater-helper.ps1
if ($LASTEXITCODE -ne 0) { throw 'Windows updater helper tests failed.' }
node .\test-elio-identity.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio identity tests failed.' }
node .\test-elio-rename.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio rename contracts failed.' }
node .\test-elio-audit.cjs
if ($LASTEXITCODE -ne 0) { throw 'Fork audit failed.' }
node .\test-desktop-chat.cjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop chat tests failed.' }
node .\test-elio.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio regression tests failed.' }
node .\test-elio-theme.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio theme tests failed.' }
node .\test-updates.cjs
if ($LASTEXITCODE -ne 0) { throw 'Update UI tests failed.' }
python tools/test_package_windows.py
if ($LASTEXITCODE -ne 0) { throw 'Package contract tests failed.' }
cargo test --locked --manifest-path agent/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Native security tests failed.' }
cargo build --release --locked --manifest-path agent/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed. No EXE package was created.' }
python tools/package_windows.py
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
Write-Host 'Created versioned Windows ZIP in dist. Upload it unchanged to the matching GitHub Release.'
