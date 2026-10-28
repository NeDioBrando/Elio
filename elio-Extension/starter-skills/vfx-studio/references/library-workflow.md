# Library acquisition and reuse
## Before UI actions
Read the exact user goal: texture/mesh selection, full preset, flipbook, preview or runtime integration. Do not turn a library request into a new game system. Confirm connected studio_id, actual DataModel and safe destination. Inspect existing project ownership and controllers. Use current schemas; ordinary native properties are usually faster than manipulating sliders.

Use fresh screenshots/desktop inspection to locate the installed VFX Studio library. Tutorial chapter names are feature evidence, not guaranteed current UI labels. No toolbar coordinates are supplied here. A paid control, login, permission prompt, asset license or publishing action requires the relevant user authorization; do not bypass it.

## Discover current surfaces, not old paths
Run plugin_list and inspect its surfaces/warnings. Call plugin_inspect using exact returned path_segments; optional query matches current names, titles, labels and image IDs, not private catalog items. Re-discover after a reload or missing path. A missing/denied UI tree is not proof that VFX Studio is disabled. Hidden controls can appear in the read tree; inspect Visible/Enabled and real screenshots before UI input. When truncated, inspect a narrower exact subtree; do not report a complete search.
These commands are read-only: they do not activate search, click buttons, import effects, or invoke internal plugin modules. Library acquisition still requires observed authorized Studio UI tools or the user's explicit insert/select step. Do not replace Studio UI input with in-game mouse input.

## Acquisition evidence
Before inserting through UI, inventory the intended destination. Observe the selection and any selected object properties that may be changed in place. Insert only a bounded selection under the requested scope. Compare exact roots, asset properties and attachments after the UI action. If the plugin modifies an unrelated selected object, stop and report it rather than attempting broad cleanup. Do not delete user objects based merely on timestamps or similar names.

If no desktop tools are advertised/authorized, ask for one concrete manual step: open VFX Studio and insert/select the desired preset or export it into an agreed container. Continue with exact materialized paths. Already exported assets can be reused without reopening the plugin. Asset search outside the plugin is an explicit alternative, not evidence of library access.

## Inspection
Prepend SPEC to scripts/inspect_asset.luau, e.g. local SPEC={paths={"game.ReplicatedStorage.MyEffect"},max_nodes=160}. Or use local SPEC={use_selection=true,max_nodes=160} only when selection inspection is intended. max_nodes is bounded to 400, roots to 8. Output is root-inclusive, may be truncated, and is not a full serialization/fingerprint. No inferred plugin provenance.

Then use motion_scan action read_vfx or motion_bundle_scan action read_vfx with the exact root path; preserve the returned cursor and scan limits. Inspect full output before copying. No direct access to private plugin files/library is provided. Scripts/modules require separate review; never require a library module to discover its API. Unexpected external attachment references must be resolved without rewiring unrelated objects.

## Owned reuse
motion_bundle_copy kind vfx copies a verified source_path, not a marketplace asset_id. Let the existing guard enforce allowed destinations and script safety. Stable ownership and unique action receipts prevent accidental replacement/replay. Preserve originals. Read before revision-checked changes. Use vfx_build for native template edits; do not introduce an alternate copy engine.

Preview and runtime changes need their own verification. Check spawn direction, scale, attachments, delayed emission, flipbook layout, cleanup and cancellation. Attributes named EmitCount/EmitDelay/EmitDuration are only hints until a real controller proves semantics. Do not label a successful receipt as a successful visual result. Do not publish raw catalog assets or include them in exported Elio distributions.


## Same-name plugin windows
Read fresh plugin_list output. Pass both exact path_segments and its surface_title to plugin_inspect when provided. Several widgets can share Name=PluginGui; name segments alone do not distinguish them. Titles are exact and case-sensitive, not fuzzy search. Stale or still-duplicate titles must fail closed: rediscover, never choose the first sibling, rename user/plugin objects, or assume a missing path means uninstalled. Nested same-name controls remain ambiguous; use a narrower unambiguous parent. No click/import is performed.
