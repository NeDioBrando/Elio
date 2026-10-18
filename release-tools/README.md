elio release source

This archive contains the preferred editable GPL-3.0-or-later source. Production ZIPs use conservative JavaScript minification; names, properties, statement order and parsed structure are preserved. This reduces exposed development material and download size; it does not prevent copying or reverse engineering.

Build the desktop with `cargo build --release --locked` in `agent`. Windows requires the normal Rust Windows build tools. macOS universal builds require both `x86_64-apple-darwin` and `aarch64-apple-darwin` targets, lipo and `build-macos-bundle.py`. See the included release workflow for exact platform build, runtime and regression checks.

For extension production files, install the pinned tools with `npm install --prefix release-tools terser@5.44.0 acorn@8.15.0`, then run `node release-tools/minify.mjs PATH_TO_A_COPY_OF_THE_SOURCE`. Minification overwrites JavaScript in that copy. Its AST check ignores only source locations, literal spelling and equivalent object-key/shorthand spelling. Scripts with any other structural difference retain their original source. Load the root or `elio-Extension` manifest in the browser's extension developer page. No downloaded executable code, anti-debugging checks or runtime unpacker is used.

Official release archives and update feeds have GitHub build provenance attestations. Verify a downloaded archive with `gh attestation verify ARCHIVE --repo stoveez/elio`. Attestation is separate from Windows Authenticode and Apple notarization. The desktop updater cross-checks the feed checksum against the published GitHub release asset, then verifies downloaded bytes before installation. Explicit custom feeds retain their existing behavior.
