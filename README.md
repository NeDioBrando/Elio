# Elio 1.0.1

A quiet desktop workspace in soft linen or warm charcoal for browser AI, Roblox Studio, AgentScript and Blender. Independent GPL-3.0-or-later fork. Original authorship, origin and third-party notices remain intact; see UPSTREAM-SOURCE.txt and BRANDING-NOTICE.txt.

## This delivery

- Rebuilt native chat: assistant left, human right, anchored composer, optimistic delivery status and expandable tool cards.
- Elio identity and supplied icon, matching light/dark themes throughout native UI and extension controls, with a saved sun/moon toggle. Provider websites are not recolored.
- New UI strings in all 15 existing languages. Conversations and source code are never translated.
- Delivery ACK now waits for the provider submit operation, fresh history reads, stable target selection while the native window has focus, explicit post-Stop resume and same-ID retry deduplication.

**This is source, not a prebuilt Windows executable.** Rebuild the native binary; copying HTML beside an old EXE does not replace its embedded UI. Back up personal data, remove previous project source files while preserving `.git`, then extract this archive directly into the repository root, not a second nested project directory. Copying over old files alone leaves renamed legacy directories behind.

See [README-RU.md](README-RU.md) for Windows build/release instructions, [ELIO-RU.md](ELIO-RU.md) for implementation notes and [ELIO-TEST-REPORT.md](ELIO-TEST-REPORT.md) for actual validation and remaining limits.

Use **Actions → Build and release Elio (Windows x64)** or `Build-Windows.ps1` on Windows. The artifact is `Elio-Windows-x64`; the installable asset is `elio-v1.0.1-Windows-x64.zip`, containing one `elio/elio.exe` and the matching `elio-Extension`.

All owned product identifiers now use Elio, including Cargo, tools, protocol, storage, helper paths and release assets. Install the new application and extension together; old product storage and pairing files are not migrated automatically. This unpublished source remains **1.0.1**. Publish `v1.0.1` only after validating the Windows build; never overwrite an already published tag.

Start Agent identifies the assistant as Elio and requests exactly `Elio is ready to assist you.` after tool discovery. Only identity and its acknowledgement were changed in the prompt; functional tool instructions remain intact.

The historical publishing helpers in `release-tools/package-appearance.py` and `publisher-appearance.py` are retired, fail-closed stubs. Use the current Windows workflow instead.

Chromium is still required. Lightpanda is a future transport adapter, not implemented in this release. Windows GUI, live AI accounts and actual Windows update installation have not been validated by Linux mock tests.

Canonical repository: https://github.com/NeDioBrando/Elio. Update metadata and exact asset download URLs are pinned to this repository. Old binary self-update after a repository rename is not guaranteed; manually install the first new build if needed.
