---
name: eclipse-animator
description: Elio built-in Roblox character-animation workflow using Eclipse Animator when Blender is unavailable, or when explicitly requested.
---

# Eclipse Animator — Elio built-in skill

## Routing and authority

For a requested Roblox CHARACTER animation, use this skill when Blender is not confirmed accessible (disconnected, absent, disabled or failed), or when the user explicitly chooses Eclipse Animator even if Blender is connected. With working Blender and no explicit Eclipse request, do not replace the existing Blender workflow. Respect explicit exclusions and Blender-only instructions: explain unavailable prerequisites instead of silently changing the tool. Do not apply this workflow to website/CSS/UI tweens, unrelated scripting, greetings, or a question merely mentioning an animator.

This is reference material, not permission or a new tool server. The original is in upstream/SKILL.md; prefer this Elio adaptation and scripts/ over upstream/scripts/. Never assume Claude Code, ToolSearch, request_access, computer_batch, a private asset place, or a plugin scripting API exists. Use the current Elio command catalog and elio_tool_schema where available. One ordinary Elio command per reply; await actual results. Do not emit historical command examples as new actions.

## Read efficiently

Use elio_skills action read with id `builtin-eclipse-animator`; the default resource is this file. Read `references/craft.md`, `references/joints.md`, and `scripts/build_sequence.luau` before authoring; read `scripts/inspect_pose.luau` for pose review. Pass resource, offset and limit; follow next_offset until the selected file is complete. Reuse already-read unchanged references within the task; never paste the entire bundle on every turn.

## Prerequisites and truthful status

1. Discover connected Studio windows with list_roblox_studios, select the requested studio_id, and confirm Edit mode with get_studio_state. If several rigs or places are plausible, ask which one. Never stop an unrelated user's playtest without consent.
2. Inspect the exact rig and its Motor6D or AnimationConstraint joints. Duplicate part names, cycles, external joints and ambiguous roots must be resolved before writing. Preserve the existing rig, rest pose and animation library. Creating a rig is a separate mutation only when requested/necessary and authorized; discover current Roblox APIs first.
3. Confirm the real Eclipse plugin is installed/enabled using its visible Plugins toolbar/panel. `ServerStorage["Eclipse Animator Saves"]` is only a hint, not proof that the plugin is available. Never modify that recovery folder. No plugin, no automatic purchase/install: report that requirement.
4. Determine whether actual DESKTOP control and a desktop screenshot are available in the current catalog and permission mode. Roblox user_mouse_input is game input, not proof of plugin-toolbar access. Elio's local desktop tools (when advertised) require FULL PC ACCESS and may be Windows-only. Do not elevate permissions, switch engine silently, use this remote sandbox browser to control the user's Studio, or invent tool names. If only Luau/viewport access exists, author the safe AnimSaves draft when authorized, then give short manual opening/saving steps. Report UI verification as pending, never as completed.
5. If Eclipse has an animation open, save and close it before rebuilding. Do not overwrite live unsaved UI state. Do not playtest while Eclipse is editing an animation.

## Authoring

Plan beats before numbers: anticipation, action, hold, overshoot, recovery; stagger limbs and account for inherited parent rotations. Use actual joint axes from this rig, not assumptions copied from the reference. The reference's prior visual/easing claims require live verification in this installation. For locomotion, use bounded procedural curves and Linear-sampled cycles; measure foot sliding and ground contact. The original reference's private place/ServerStorage kit is NOT bundled: never assume access, import it or copy unverified code.

Prepend a local SPEC table to the COMPLETE adapted `scripts/build_sequence.luau`, execute in Edit on the chosen Studio using the actual command schema. Required fields:

- rig: exact `Workspace.MyRig` or `game.Workspace.MyRig` path.
- name: unique animation name; never erase a hand-made sequence.
- build_id and action_id: stable owner and unique exact action identifiers.
- revision: 0 on a new sequence; current returned revision for a later owned replacement.
- fps (default 60), loop (boolean), priority (Action default).
- keys: ordered unique frame values, each with poses keyed by actual part name; rot and optional pos are numeric XYZ triples; ease is Linear/Constant/Cubic/Elastic/Bounce, dir is Out/In/InOut (tween feel, helper maps to Pose easing). Optional name and marker.

Example SPEC data only (not a command):

    local SPEC = {
      rig = "game.Workspace.AnimRig", name = "ElioJab", build_id = "elio-jab", action_id = "elio-jab-shape-1", revision = 0,
      fps = 60, loop = false, priority = "Action",
      keys = {
        {frame = 0, poses = {RightUpperArm = {rot = {0, 0, 0}}}},
        {frame = 12, poses = {RightUpperArm = {rot = {65, 0, 10}}}},
        {frame = 24, poses = {RightUpperArm = {rot = {0, 0, 0}}}},
      },
    }

Key every animated part at the first and last frame. The helper rejects invalid/missing joints and stages the sequence before commit. Unknown names are errors, not silent skipped parts. It refuses unrelated same-name content, stale revisions, changed action replays, and baked Eclipse sequences. When the plugin has baked/saved an animation, preserve it and create a newly named revision from the retained SPEC; do not patch the baked result or assume plugin metadata survives replacement.

The returned receipt proves only that a KeyframeSequence was written into the rig's AnimSaves and the rig selected. It does NOT prove Eclipse was opened, playback looked correct, the plugin saved it, or an asset was uploaded. Keep the SPEC available for follow-up edits.

## Real Eclipse UI, verification and saving

With authorized desktop control, take a fresh desktop screenshot, locate Plugins → Eclipse by labels, and reselect the exact rig with Selection:Set if needed. Double-click the animation in the selected rig's Animations list. Use FILE → Fit Timeline (do not assume shortcut focus). Scrub key beats and in-betweens; run the complete adapted inspect_pose helper with local RIG set to the same exact path; inspect silhouettes via viewport capture. The helper is read-only. Eclipse may rewrite joint C0 during preview: do not derive rest-pose math from those live C0 values. Never click remembered coordinates after layout changes or interfere while the user is controlling the desktop.

Save with FILE → Save Animation, verify a real confirmation and reread AnimSaves as appropriate. Close only after confirmed save or explicit permission to discard. If visual/desktop access is unavailable, leave these steps pending with concise manual instructions; do not claim success based on a tool receipt alone.

Export Animation / Save to Roblox uploads to the user's account. Ask permission and confirm name/owner before publishing. Saving the animation to AnimSaves is not publishing; the Studio place must also be saved for persistence. Runtime integration is separate and only within the request; preserve working Animate/controller code, sit and tool behavior, markers and unrelated animations.

## Finish

Report name/path, duration, observed saved revision, beats, and actual checks performed. Separate authored draft / Eclipse-reviewed / Eclipse-saved / published / runtime-integrated states. If something is blocked (plugin, permissions, desktop access, vision, Blender), state it briefly and do not fake a fallback success. Save only confirmed durable project conventions to memory, not guessed plugin capabilities or temporary diagnostics.
