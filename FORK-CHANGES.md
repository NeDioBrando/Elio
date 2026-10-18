# synerixcode v1 — modified distribution

Modified for boneka on 2026-10-18. Based on PlazCode 1.24.20.

- Independent synerixcode product identity, executable/resources, local paths, storage identifiers and blue default palette.
- Original blue S-link icon replaces publisher artwork in first-party application surfaces.
- Removed native updater module, feed/configuration, installers, launch checks, HTTP endpoint, desktop page, update notices, update preferences and extension release-status polling.
- Display version v1; required machine-readable Cargo/Chromium version 1.0.0.
- Added HTTPS vani.ai, www.vani.ai and c.vani.ai content scripts and registration. Imported the supplied Vani provider into the current shared infrastructure.
- Vani send acknowledgements never trigger an automatic resubmission; failed image attachment is not silently ignored.
- Removed inherited donation/ad offers rather than presenting someone else's payment destinations as this fork's.
- Retained GPL and upstream/third-party attribution. No claim of upstream endorsement.

Full per-file changes: synerixcode-v1.patch.gz (against the upstream source archive; included under development/).
Runtime/MCP dependency installation is distinct from product self-updating and remains available.

## Desktop Chat addition (2026-10-18)

- Added native Chat workspace, bounded live transcript snapshots, existing-agent send/start/stop controls, and browser-session tab pinning.
- Added destination validation at native/background/content boundaries, inert message rendering, per-chat in-memory drafts, and no automatic send retries.
- Separated UI transport contract for a future browser-runtime adapter; Lightpanda runtime is not implemented.
- Both extension source trees remain synchronized. Existing GPL notices and tool-execution paths are preserved.
- See DESKTOP-CHAT-RU.md and DESKTOP-CHAT-TEST-REPORT.md for scope and actual validation.

## 1.0.0 — own opt-in update channel

The earlier removal above describes the initial fork only. This revision adds a new updater bound to NeDioBrando/SynerixCode, not the former publisher. Shared Outdated/Update UI appears in native Chat, on AI websites and in the extension popup. Native authenticated routes own version checking/download; a local Windows helper validates/stages/backups/restarts with best-effort rollback. See UPDATES-RU.md and UPDATES-TEST-REPORT.md.
