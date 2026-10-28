$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
# Source/resources are UTF-8 regardless of the Windows system code page.
$env:PYTHONUTF8 = "1"
foreach ($Tool in @('cargo', 'python', 'node')) {
  if (-not (Get-Command $Tool -ErrorAction SilentlyContinue)) { throw "Install $Tool first. See README-RU.md." }
}
python tools/stamp_build.py
if ($LASTEXITCODE -ne 0) { throw 'Build identity generation failed.' }
npm ci --prefix release-tools --include=dev --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'Pinned test dependencies could not be installed.' }
$env:NODE_PATH = (Join-Path $PSScriptRoot 'release-tools/node_modules') + [IO.Path]::PathSeparator + $env:NODE_PATH
# Compile .NET Framework fixture EXEs under Windows PowerShell 5.1, not pwsh 7.
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\test-updater-helper.ps1
if ($LASTEXITCODE -ne 0) { throw 'Windows updater helper tests failed.' }
node .\test-tool-error-recovery.js
if ($LASTEXITCODE -ne 0) { throw 'Tool error recovery regression failed.' }
node .\test-stop.js
if ($LASTEXITCODE -ne 0) { throw 'Stop preservation regression failed.' }
foreach ($Test in @('test-message-error-preservation.js','test-notion-card-ownership.js','test-notion-tool-status.js','test-notion-block-transcript.js')) {
  node $Test
  if ($LASTEXITCODE -ne 0) { throw "Message card ownership regression failed: $Test" }
}
node .\test-upstream-merge.cjs
if ($LASTEXITCODE -ne 0) { throw 'Upstream port regression failed.' }
node .\test-elio-identity.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio identity tests failed.' }
node .\test-elio-rename.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio rename contracts failed.' }
node .\test-elio-audit.cjs
if ($LASTEXITCODE -ne 0) { throw 'Fork audit failed.' }
node .\test-elio-chat-live.cjs
if ($LASTEXITCODE -ne 0) { throw 'Live chat tests failed.' }
node .\test-desktop-chat.cjs
if ($LASTEXITCODE -ne 0) { throw 'Desktop chat tests failed.' }
node .\test-resource-lifecycle.cjs
if ($LASTEXITCODE -ne 0) { throw 'Resource lifecycle tests failed.' }
node .\test-emitter2d.cjs
if ($LASTEXITCODE -ne 0) { throw 'Emitter2D integration failed.' }
node tools/test_emitter2d_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'Emitter2D inspector failed.' }
node .\test-qp2.cjs
if ($LASTEXITCODE -ne 0) { throw 'QP2 integration tests failed.' }
node tools/test_qp2_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'QP2 export inspector tests failed.' }
node .\test-vfx-studio.cjs
if ($LASTEXITCODE -ne 0) { throw 'VFX Studio skill integration tests failed.' }
node tools/test_vfx_studio_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'VFX export inspector tests failed.' }
& powershell.exe -NoProfile -NonInteractive -File tools/test_studio_desktop.ps1
if ($LASTEXITCODE -ne 0) { throw 'Studio desktop PowerShell/C# tests failed.' }
python tools/test_studio_desktop_contract.py
if ($LASTEXITCODE -ne 0) { throw 'Studio desktop routing tests failed.' }
node tools/test_plugin_skills_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'Generated Studio/plugin Luau tests failed.' }
node .\test-eclipse.cjs
if ($LASTEXITCODE -ne 0) { throw 'Eclipse skill integration tests failed.' }
node tools/test_eclipse_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'Eclipse animation helper tests failed.' }
node .\test-oriveo.cjs
if ($LASTEXITCODE -ne 0) { throw 'Oriveo provider tests failed.' }
node .\test-figma.cjs
if ($LASTEXITCODE -ne 0) { throw 'Figma plugin and bridge contracts failed.' }
node .\test-vault-contract.cjs
if ($LASTEXITCODE -ne 0) { throw 'Project memory and paragraph contracts failed.' }
node .\test-elio.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio regression tests failed.' }
node .\test-elio-theme.cjs
if ($LASTEXITCODE -ne 0) { throw 'Elio theme tests failed.' }
node .\test-updates.cjs
if ($LASTEXITCODE -ne 0) { throw 'Update UI tests failed.' }
python tools/prepare_engram.py
if ($LASTEXITCODE -ne 0) { throw 'Verified Engram runtime preparation failed.' }
python tools/test_prepare_engram.py
if ($LASTEXITCODE -ne 0) { throw 'Engram runtime contract tests failed.' }
python tools/test_windows_text_encoding.py
if ($LASTEXITCODE -ne 0) { throw 'Windows UTF-8 source regression failed.' }
node .\test-live-audit-fixes.cjs
if ($LASTEXITCODE -ne 0) { throw 'Live audit regression tests failed.' }
foreach ($Test in @('test-auto-creator-enhancement.js','test-tool-guard-repair.js','test-motion.js','test-notion-protocol-file.js')) {
  node $Test
  if ($LASTEXITCODE -ne 0) { throw "Live audit regression failed: $Test" }
}
node tools/test_motion_luau.mjs
if ($LASTEXITCODE -ne 0) { throw 'Generated Motion Luau tests failed.' }
python tools/test_package_windows.py
if ($LASTEXITCODE -ne 0) { throw 'Package contract tests failed.' }
cargo test --locked --manifest-path agent/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Native security tests failed.' }
cargo build --release --locked --manifest-path agent/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed. No EXE package was created.' }
$env:ELIO_TEST_BINARY = Join-Path $PSScriptRoot 'agent/target/release/elio.exe'
node .\test-studio-desktop-native.cjs
if ($LASTEXITCODE -ne 0) { throw 'Studio desktop authenticated native route tests failed.' }
python tools/package_windows.py
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
Write-Host 'Created versioned Windows ZIP in dist. Upload it unchanged to the matching GitHub Release.'
