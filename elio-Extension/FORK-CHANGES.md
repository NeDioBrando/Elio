# elio v1 — modified distribution

Modified for boneka on 2026-10-18. Based on Elio 1.24.20.

- Independent elio product identity, executable/resources, local paths, storage identifiers and blue default palette.
- Original blue S-link icon replaces publisher artwork in first-party application surfaces.
- Removed native updater module, feed/configuration, installers, launch checks, HTTP endpoint, desktop page, update notices, update preferences and extension release-status polling.
- Display version v1; required machine-readable Cargo/Chromium version 1.0.0.
- Added HTTPS vani.ai, www.vani.ai and c.vani.ai content scripts and registration. Imported the supplied Vani provider into the current shared infrastructure.
- Vani send acknowledgements never trigger an automatic resubmission; failed image attachment is not silently ignored.
- Removed inherited donation/ad offers rather than presenting someone else's payment destinations as this fork's.
- Retained GPL and upstream/third-party attribution. No claim of upstream endorsement.

Full per-file changes: elio-v1.patch.gz (against the upstream source archive; included under development/).
Runtime/MCP dependency installation is distinct from product self-updating and remains available.
