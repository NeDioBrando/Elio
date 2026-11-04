# Useful upstream-inspired improvements and asset expansion

## Included
- Bounded `read_scripts` batches over game-owned services, editor buffers, exact paths/folders, index-only mode, optional line labels, UTF-8-safe paging, change-sensitive continuation and explicit scan limits. No plugin/internal source roots and no code execution.
- DeepSeek complete DSML normalization into the existing guarded tool pipeline; malformed/incomplete input is not executed. Existing JSON/Luau envelopes retain priority when they contain DSML text as data.
- One DeepSeek send queue with 8–9.8 seconds measured after the preceding send finishes, Stop/chat ownership and user-draft guards; rejected sends do not poison later work. No automatic replay after uncertain delivery.
- Codex-specific semantic composer fallback excluding transcript/edit dialogs.
- Effort menu in browser top layer (fixed body portal fallback), viewport-aware height and keyboard navigation; cleanup on removal.
- Bridge closure code, clean flag, uptime, pending count and service-worker restart gap diagnostics. No server close-reason text, prompts, URLs or command arguments stored in these records. Mutations are not replayed.
- Fixed binary file-size conversion, with boundary tests through 16 GB and 1 TB.
- Update verifier process/pipe timeouts, limited file-lock retries, phase deadline checks, persisted error diagnostics on app startup and no blocking error dialog. Existing GitHub repository/digest, safe ZIP extraction, allowlist, configuration preservation and rollback checks remain enforced. A blocking OS filesystem call cannot be interrupted by the cooperative phase deadline.

## Library
6008 distinct typed asset IDs (620 raw meshes, 5388 images), up from 5515: +333 meshes and +160 textures. New records use explicit Roblox Creator Store `meshId`/`textureId`, not wrapper listing IDs. Sources, creator, exact listing, mapping evidence and original titles are retained. No remote scripts/models/images are shipped. `Unknown` layout is intentional; never guess a flipbook grid from its title.

Cursed Energy and Black Flash have dedicated categories and RU/EN aliases, including CursedEnergy, BlackFlash, Kokusen, проклятая энергия and чёрная вспышка. Existing OpenVFX cursed-energy records are retained and categorized as well.

Examples with official Image-type metadata:
- Cursed energy VFX 3: image 17863944368, listing 17863944410.
- Cursed Energy Flipbook FX: image 16142397363, listing 16142397412.
- Black flash effect: image 70610805232342, listing 86325147759876.
- BLACK FLASH lettering: image 17702987052, listing 17702987088; explicitly marked UI text, not an energy texture.

Public thumbnails were visually reviewed for the four examples above. The two cursed-energy sheets show 4x4 frames; Black flash effect is an actual radial impact texture, while BLACK FLASH is a text logo and is deprioritized in effect search. These are image references, not complete effect recipes. Anonymous asset delivery returned 401 for the selected spot checks; this does not establish availability for a user's Studio account. The catalogue records this without claiming a visual/load pass or bypassing access controls. Named impact frames are image references, not automatically a complete animated sequence.

## Not introduced
No account/cloud-profile subsystem, per-command approval gate, source obfuscation, unconditional startup vault dump, or bundled plugin engines. Existing headless Blender and Elio-specific fixes are preserved.

## Regression coverage
`test-useful-ports.cjs`, `test-provider-ports.cjs`, `tools/test_read_scripts.mjs`, expanded library and Chrome MV3 worker checks, Rust size tests, and Windows isolated updater timeout fixture are wired into the normal build. Existing full-audit/provider/Notion/skills tests remain required.
