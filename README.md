# SynerixCode v1

Independent GPL-3.0-or-later fork of PlazCode 1.24.20, originally derived from ZeroScript-Free.
Blue identity, Vani AI provider, native desktop chat, and an opt-in product updater using this fork’s GitHub Releases.

**This source package does not contain a prebuilt Windows executable.**
See [README-RU.md](README-RU.md) for build, installation, limitations and Windows validation.
Build on Windows x64 using `Build-Windows.ps1` or the GitHub Actions build/release workflow.
Do not reuse the upstream EXE, because it still contains its original updater.

Upstream license/branding and third-party notices are preserved. This is not an official PlazCode release.

## Desktop chat

This working-tree update adds a native Chat page backed by the existing Chromium extension. See [DESKTOP-CHAT-RU.md](DESKTOP-CHAT-RU.md) for setup, architecture, limitations and the future Lightpanda adapter boundary. Rebuild the native executable and reload the updated extension together.

## Product updates

Both the desktop app and AI-site extension show **Версия устарела · Outdated** with an **Обновить** action. The native bridge owns checking, download verification and Windows installation. See [UPDATES-RU.md](UPDATES-RU.md) for first installation, release publishing, trust boundaries and limitations, and [UPDATES-TEST-REPORT.md](UPDATES-TEST-REPORT.md) for actual validation. Windows installation has not been executed in the Linux development environment.
