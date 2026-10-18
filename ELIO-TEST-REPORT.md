# Elio 1.0.1 — verification and limitations

## Scope

Source refresh based on public origin/main `2d1a4b0928a62268f8bee70a3f88aa2a3715108d` plus the Elio changes in this archive. Nothing was pushed or published to GitHub. This is a source distribution, not a Windows binary distribution.

## Automated checks completed

- Rust `cargo test`: **132 passed, 0 failed, 1 ignored**, on Linux (3 library + 129 binary tests). This is not a Windows release build.
- `node test-elio-audit.cjs`: identity/version consistency, root/nested-extension parity, provider/channel checks, JavaScript syntax.
- `node test-desktop-chat.cjs`: snapshots/revisions, target guards, bounds, request IDs, pinning.
- `node test-elio.cjs`: presentation parser, partial/quoted JSON, tool/result pairing, preservation of ordinary prose/code; actual core action handler in a VM with delayed provider submission, request deduplication, post-stop submission, fresh history reads; new translation-key coverage in all 15 locales.
- `node test-updates.cjs`: shared update-state contracts and helper safety contracts.
- `node test-popup-appearance.js`: legacy appearance compatibility (new independent light/dark mode is tested separately).
- `node test-elio-theme.cjs`: storage initialization and cross-tab updates, SVG/ARIA labels, pending save, failed-save rollback, 15 locales, root/nested parity, native embeds and representative AA text contrast. Included in the Windows build gate.
- `node test-elio-theme-ui.cjs`: actual native shell against a mock bridge; all ten routes in both modes, expanded tool cards, 390px, Russian action labels, delayed save guard, persistence across reload and rejected-save rollback.
- `node test-elio-ui.cjs`: actual native HTML/JS in Chromium with a mocked local bridge; all ten workspace routes; left/right conversation layout, expandable tools, inert model HTML, optimistic delivery while submission is pending, confirmed messages/replies, follow-up sends, uncertain delivery preserving draft and retry ID, Start/Stop, English/Russian/Japanese/Arabic, 390px width, update notice.
- `node test-elio-extension-ui.cjs`: actual popup HTML/scripts with mocked Chrome APIs; English/Russian including language-change status refresh, effort picker keyboard operation, no horizontal overflow; saved popup light/dark toggle, real on-page bar template plus representative tool-state fixtures in both modes and scoped styles without host recoloring.
- `node test-desktop-chat-ui.cjs`: earlier chat UI regression suite adapted to the current shell.
- `node test-update-ui.cjs`: native update notice/progress/error and browser extension-reload notice, including narrow viewport.
- PowerShell 7 syntax parsing of build script, update helper and helper test script: passed. Windows PowerShell 5.1 helper integration tests **not run here**.
- `git diff --check origin/main`: passed.

UI suites require Playwright and an installed Chromium; `CHROMIUM_PATH` can select a local Chromium. They are development tests, not runtime dependencies. Test fixtures do not contain credentials or require signed-in accounts.

## Visual review

Individually inspected native empty/conversation/tool-details/delivery-error/update states, Home, Explorer, Tools, Toolkit, MCP, Skills, Templates, Terminal and Settings, plus Russian/Japanese/Arabic and narrow chat. Individually inspected extension collapsed popup, expanded settings, reasoning dropdown, Russian layout, and on-page bar/tool fixtures. Iterations corrected clipped option cards, legacy color specificity, low-contrast active states and RTL sender positioning.

Current palette representative text contrast (light / dark): main text on canvas **10.74 / 11.86:1**; secondary text on surface **5.84 / 7.06:1**; CTA **7.00 / 7.57:1**; green status **5.94 / 7.01:1**; error **5.68 / 6.97:1**; warning **5.32 / 6.70:1**. These checks meet AA for these text pairs, not a complete WCAG audit of every legacy widget. Disabled controls are intentionally subdued. Individually reviewed all ten native routes in both themes, expanded tools, narrow chat, popup settings and on-page fixtures.

## Important unverified areas

- No Windows EXE was built in this Linux environment. Use the supplied Windows workflow or Build-Windows.ps1, then test the freshly built binary and extension together.
- No end-to-end session against a signed-in ChatGPT/Claude/DeepSeek account, Roblox Studio, Blender, or Windows WebView2 was run. Provider DOM changes can still require adapter fixes. Mock success does not certify all providers.
- No real downloaded update was installed over an existing Windows installation, no Windows file-lock/rollback scenario was exercised, and no GitHub Release was published. Windows-only helper fixture tests remain part of the Windows build gate.
- All 15 locale files include the newly introduced interface strings; representative UI rendering was checked in EN/RU/JA/AR, not every populated legacy screen in all languages. User messages, model replies, raw logs, code, tool names/arguments and external error details are intentionally not translated.
- The on-page bar test is a template/CSS fixture, not a complete extension/provider lifecycle test. Populated legacy menus, import flows and every modal were not exhaustively exercised.
- Draft recovery is maintained per chat in the current application session; this report does not claim restart-persistent drafts.
- Lightpanda support is not implemented. Presentation/transport boundaries reduce future coupling, but Chromium extension APIs still need a replacement adapter.
- The full rename below supersedes earlier compatibility notes. Install the new elio.exe and matching elio-Extension together; original product storage/pairing is not automatically migrated.
- Updates use HTTPS and GitHub-provided SHA-256, not independent release signing or an Authenticode guarantee.

See ELIO-RU.md for changes and the Windows smoke checklist. Other older test reports describe their historical source versions, not a broader certification of this release.

## Repository rename refresh

The canonical source and native update authority are now `NeDioBrando/Elio`. Re-ran the source/parity/syntax audit, update/chat/Elio/theme unit suites and full Linux Rust suite for this source refresh. A new Rust regression accepts the exact Elio release URL and rejects former/foreign repository URLs. UI appearance is unchanged from the reviewed theme refresh. No GitHub push, Windows build or release installation was performed. The older UI verification above refers to the preceding theme refresh, not a fresh live-provider test.

## Full rename and identity — current unpublished 1.0.1

The checks below were run after the complete internal rename, not just the previous display/theme refresh:

- Linux Rust suite: **132 passed, 0 failed, 1 ignored**. Native `cargo build --locked` succeeded; the newly compiled Linux binary reports `elio-agent 1.0.1`. This is not a Windows EXE.
- `test-elio-rename.cjs`: Cargo/bin/version/icons; owned runtime identifiers; recursive canonical/extension parity; one executable; new archive/root/helper/update authority/workflow contracts.
- `test-elio-identity.cjs`: Roblox/local/full-access/compact/Notion identity; exact acknowledgement; the real startup acceptance block accepts the requested phrase and rejects commands appended to it. A baseline SHA-256 verifies that config.js has no unrelated prompt edits beyond mechanical branding, the short identity sentence and startup acknowledgement.
- Re-ran audit (67 JavaScript syntax checks), Elio, theme, updates and desktop-chat unit suites; all passed. Python AST syntax: **245 scripts passed**.
- Actual Start bootstrap fixture passed with `Elio is ready to assist you.`. The Notion small-paste suite passed all nine scenarios. Bridge no-replay and hung-connection tests passed. Full manifest content-script bootstrap passed for ChatGPT, DeepSeek, Claude and Notion in DOM fixtures.
- All five Chromium fixture suites passed: Elio native UI, desktop chat UI, update UI, extension UI and light/dark UI. The theme suite covers ten routes in both modes, expanded tools and 390px. Re-inspected representative dark chat and light popup screenshots. These tests use mock transports, not live accounts.
- Actual Windows packager exercised using a clearly marked non-executable fixture with a mocked version probe: new asset/root, one elio.exe, matching extension version, every packaged SHA-256, rejection of wrong-product and non-MZ input. This does not validate a real PE executable.
- PowerShell 7 parsed Build-Windows.ps1, updater/apply-update.ps1 and test-updater-helper.ps1. Windows PowerShell 5.1 integration/rollback tests remain unrun here and are required by the Windows build gate.

Original product names remain only where required for source origin, copyright and license attribution. Retired upstream release metadata/publishing records are not a live Elio release feed. The final source ZIP omits inactive historical provenance duplicates, build caches and binaries. Root original-source/legal notices are retained.

No Windows EXE, macOS app, signed-in provider/Studio session or actual Windows update installation was tested. Nothing was pushed to GitHub or published. Version remains **1.0.1**.
