# Elio 1.0.1 maintenance

Use README-RU.md, Build-Windows.ps1 and .github/workflows/build-windows.yml.
The opt-in updater is pinned to NeDioBrando/Elio and exact elio-vX.Y.Z-Windows-x64.zip assets.
Run test-elio-rename.cjs, test-elio-identity.cjs, test-elio-audit.cjs and cargo test --locked --manifest-path agent/Cargo.toml.
Install matching elio.exe and elio-Extension together. Original product storage/pairing is not automatically migrated.
Historical appearance publishing helpers are retired. Future versions require synchronized package versions and a new tested build.
