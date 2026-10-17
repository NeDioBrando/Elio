$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
foreach ($Tool in @('cargo', 'python', 'node')) {
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "Install $Tool first. See README-RU.md." }
}
node .\test-synerixcode.cjs
if ($LASTEXITCODE -ne 0) { throw 'Fork audit failed.' }
cargo test --locked --manifest-path agent/Cargo.toml --lib
if ($LASTEXITCODE -ne 0) { throw 'Native security tests failed.' }
cargo build --release --locked --manifest-path agent/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed. No EXE package was created.' }
python tools/package_windows.py
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
Write-Host 'Created dist\synerixcode-v1-Windows-x64.zip'
