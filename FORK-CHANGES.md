# elio v1 — modified distribution

Modified for boneka on 2026-10-18. Original source and authorship are recorded in UPSTREAM-SOURCE.txt.

- Independent elio product identity, executable/resources, local paths, storage identifiers and blue default palette.
- Original blue S-link icon replaces publisher artwork in first-party application surfaces.
- Removed native updater module, feed/configuration, installers, launch checks, HTTP endpoint, desktop page, update notices, update preferences and extension release-status polling.
- Display version v1; required machine-readable Cargo/Chromium version 1.0.0.
- Added HTTPS vani.ai, www.vani.ai and c.vani.ai content scripts and registration. Imported the supplied Vani provider into the current shared infrastructure.
- Vani send acknowledgements never trigger an automatic resubmission; failed image attachment is not silently ignored.
- Removed inherited donation/ad offers rather than presenting someone else's payment destinations as this fork's.
- Retained GPL and upstream/third-party attribution. No claim of upstream endorsement.

Earlier generated patch archives are superseded by this complete editable source distribution.
Runtime/MCP dependency installation is distinct from product self-updating and remains available.

## Desktop Chat addition (2026-10-18)

- Added native Chat workspace, bounded live transcript snapshots, existing-agent send/start/stop controls, and browser-session tab pinning.
- Added destination validation at native/background/content boundaries, inert message rendering, per-chat in-memory drafts, and no automatic send retries.
- Separated UI transport contract for a future browser-runtime adapter; Lightpanda runtime is not implemented.
- Both extension source trees remain synchronized. Existing GPL notices and tool-execution paths are preserved.
- See DESKTOP-CHAT-RU.md and DESKTOP-CHAT-TEST-REPORT.md for scope and actual validation.

## 1.0.0 — own opt-in update channel

The earlier removal above describes the initial fork only. This revision adds a new updater bound to NeDioBrando/Elio, not the former publisher. Shared Outdated/Update UI appears in native Chat, on AI websites and in the extension popup. Native authenticated routes own version checking/download; a local Windows helper validates/stages/backups/restarts with best-effort rollback. See UPDATES-RU.md and UPDATES-TEST-REPORT.md.

## Elio 1.0.1

Rebranded user-facing product and icon; redesigned native chat and product surfaces in warm paper tones; compact extension settings; localized new chat/update strings across all 15 supported languages. Added safe expandable command/result cards, optimistic message display, real provider-delivery ACK, fresh history capture, last valid native-target selection and explicit post-Stop resume. Preserved upstream functionality, copyright/licenses, protocol/storage identifiers and updater feed compatibility. See ELIO-RU.md and ELIO-TEST-REPORT.md. Windows runtime validation remains required.

### Unpublished 1.0.1 source refresh — light/dark mode

Added shared sun/moon controls to native topbar, extension popup and on-page bar; soft linen light and warm charcoal dark semantic palettes; saved/synced `rsColorMode`, 15-language action labels, failure rollback, pending-save guard and focused theme regression/contrast tests. Version remains 1.0.1 because this source refresh precedes the user’s first build. No release was published.

### Repository rename to NeDioBrando/Elio

Pinned the update API and exact release-asset URL validation to the renamed repository; refreshed repository links, updater User-Agent, build/release display labels and remaining popup launch hint. Kept compatibility archive/process/storage identifiers and upstream notices. Added a regression rejecting former/foreign repository asset URLs. No release was published by this source refresh.

### Full unpublished rename and startup identity — 1.0.1

Supersedes earlier compatibility notes: owned identifiers now use Elio throughout native code, extension, Cargo/bin/icon paths, MCP tool names, protocol/storage/pairing, Windows packaging, helper and exact release assets. One elio.exe, no duplicate case-only alias. New and old product components must not be mixed; no automatic old-storage migration is claimed. Original authorship and legal notices remain unchanged.

Added only a short Elio identity and exact startup acknowledgement: `Elio is ready to assist you.` Functional prompt rules are retained; focused hash/handshake tests guard the scope. Retired obsolete publishing helpers rather than presenting upstream hashes as current release metadata. Version remains 1.0.1; nothing was pushed or published.

## Elio 1.0.1 — live chat and dark-default follow-up

- Explicit provider-list invalidation on desktop snapshots; live work state included on unchanged revisions.
- Presentation-only hiding of startup/control turns; raw archive and command handshake unchanged.
- Animated Elio E/tongue/dot and localized neutral shimmer status, reduced-motion support, read recovery and stable message DOM.
- Removed retired cool-blue/purple styles from extension stylesheets and generated panels; preserved semantic result colors and host page styling.
- First launch defaults to dark without overriding saved light mode. Product version remains 1.0.1.
- Added live export/Notion DOM regressions and expanded native/extension UI checks. See CHAT-FIX-1.0.1-RU.md for validation scope and installation.


## Oriveo browser provider (1.0.1)

Added the app.oriveoai.com text-chat adapter, supported-AI links, scoped single-send acknowledgement, stable message IDs, paragraph/code extraction and regression fixtures. Image/file upload is explicitly unsupported. Existing Figma and project vault are retained. See ORIVEO-RU.md and ORIVEO-TEST-RESULTS.json for verification boundaries.


## Eclipse Animator built-in skill (1.0.1)

User-provided Eclipse reference with preserved originals, Elio-specific tool/permission adaptation, safe AnimSaves authoring helpers, Blender-aware task selection, paginated read-only resources and a normal-effort Skills card. Original paid plugin is not bundled. No live Eclipse UI success is claimed by the fixture tests. See ECLIPSE-ANIMATOR-RU.md.

## Unpublished 1.0.1 — selected PlazCode 1.24.21–25 recommendations

Added lean startup/on-demand help and budgeted optional context without truncating retained command results; DeepSeek's minimum service-send interval; CSP-safe canvas screenshots; deterministic extension/native build identity and mismatch warnings; native read-only/allowed-folder policy with explicit single-use opaque/destructive command approvals; reused checkpoint history and Undo. Kept Elio's memory backend while adding revisioned evidence verification, stale-context exclusion, observed dependencies/audit, bounded local reference images, Obsidian snapshots, and graph interaction improvements. PowerShell helper fallback uses RemoteSigned. See UPSTREAM-21-25-RU.md and UPSTREAM-21-25-TEST-RESULTS.json for implemented limits and actual tests. No product version bump or Windows executable is included.
