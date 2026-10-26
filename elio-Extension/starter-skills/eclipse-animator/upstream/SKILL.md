---
name: eclipse-animator
description: Make Roblox character animations with the Eclipse Animator plugin in Roblox Studio. Claude writes the keyframes with Luau, then opens, checks, polishes and saves them in the real Eclipse UI. Use this whenever the user wants an animation made, fixed or polished in Studio (punch, sword swing, emote, idle, walk, run, jump, death, tool or cutscene animation), mentions Eclipse or "the animator plugin", or asks for KeyframeSequences, AnimSaves, rigs or posing. Use it even if they just say "animate this" or "make my character do X" and Studio is connected.
---

# Eclipse Animator

Eclipse Animator is a paid Roblox Studio plugin (by @riftkuro). It has no
scripting API, but it reads and writes ordinary `KeyframeSequence`s in a
rig's `AnimSaves`. So the workflow is:

1. **Author** the keyframes as a spec and write them with
   `scripts/build_sequence.luau` (via `execute_luau`). This is precise,
   repeatable and fast.
2. **Open** the animation in the real Eclipse UI (computer use) so the user
   gets a normal, editable Eclipse animation.
3. **Verify** by scrubbing Eclipse to key frames and measuring the pose
   (`scripts/inspect_pose.luau`) plus a viewport capture.
4. **Save** from Eclipse. That bakes it and adds Eclipse's own data. Then
   iterate.

Doing it this way, not by dragging gizmos in the UI, is what makes the
animations good: every angle and timing is deliberate and easy to adjust.
Use the UI for what only the plugin can do: opening, previewing, saving,
exporting, and anything the user asks for by name (IK, the graph editor,
face controls).

## Tools

- Roblox Studio MCP: `list_roblox_studios` (get the `studio_id`),
  `execute_luau`, `screen_capture`, `search_game_tree`. Load them with
  ToolSearch if they're deferred.
- Computer use for the Eclipse UI: `request_access` with `["Roblox Studio"]`,
  then `screenshot` and `computer_batch`. Load all computer-use tools with
  one ToolSearch query (`computer-use`, max_results 30).

## Step 0: Check the setup

- Studio is connected (`list_roblox_studios`) and in Edit mode, not playtesting.
- Eclipse is installed: there is an **Eclipse** button in the Plugins
  toolbar, and/or a `ServerStorage["Eclipse Animator Saves"]` folder. Don't
  modify or delete that folder; it holds Eclipse's projects and recovery.
- Find the rig to animate. Ask the user which one if it's ambiguous. If
  there's no rig, make one:

```lua
local rig = game:GetService("Players"):CreateHumanoidModelFromDescription(
	Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R15)
rig.Name = "AnimRig"; rig:PivotTo(CFrame.new(0, 5, 0))
rig.HumanoidRootPart.Anchored = true; rig.Parent = workspace
```

Rigs made like this use **AnimationConstraint** joints instead of Motor6D.
Both work with the scripts here and with Eclipse.

## Step 1: Design the animation, then write the spec

Before writing numbers, read `references/craft.md` (timing tables, easing,
anticipation, overshoot, offsets) and `references/joints.md` (which axis
does what on R15 and R6). A few minutes of design here is the difference
between a stiff animation and a good one.

Plan in beats, for example for a punch: *guard → wind-up (torso twists
away, fist pulls back) → strike (fast, hips lead) → hold → recover with
overshoot*. Give each beat a frame number at 60 fps, then fill in the
parts.

Spec format (all angles in degrees):

```lua
local SPEC = {
	rig = "Workspace.AnimRig",
	name = "Jab",
	fps = 60,
	loop = false,
	priority = "Action",
	keys = {
		{ frame = 0, poses = {
			LowerTorso    = { rot = {0, 0, 0} },
			UpperTorso    = { rot = {0, 0, 0} },
			RightUpperArm = { rot = {0, 0, 0} },
		}},
		{ frame = 6, poses = {
			UpperTorso    = { rot = {0, -25, 0}, ease = "Cubic", dir = "Out" },
			RightUpperArm = { rot = {60, 0, 10}, ease = "Cubic", dir = "Out" },
		}},
		-- ...
	},
}
```

- `rot` is the rotation, `pos` an optional offset in studs (mostly for
  LowerTorso). `ease` is Linear, Constant, Cubic, Elastic or Bounce
  (default Cubic). `dir` is the **tween-style feel** (default `"Out"`): the
  script handles Roblox's inverted PoseEasingDirection for you.
- A key's ease shapes the motion **leaving** that key.
- Parts only need to appear on frames where they're keyed. Unkeyed parents
  get Weight-0 placeholders, and Eclipse ignores those (verified).
- Key every animated part on frame 0 and on the last frame, so the
  animation starts and ends cleanly.
- `name` replaces any existing sequence with the same name in that rig's
  AnimSaves. If the user has a hand-made version they want to keep, use a
  new name.

## Step 2: Build it

Read `scripts/build_sequence.luau` and send **your SPEC followed by the
script's full contents** as one `execute_luau` call (Edit datamodel). It
writes `<rig>.AnimSaves.<name>`, selects the rig, and returns a summary.
Any `WARN:` lines mean a part name didn't match the rig: fix them.

If the animation is currently **open in Eclipse**, close it there first.
Otherwise Eclipse's next save overwrites your rebuilt version.

## Step 3: Open it in Eclipse

Take a screenshot first. Eclipse's panel can be docked or floating
anywhere, and it **moves** when Studio's layout changes, so find things by
their labels, not by remembered coordinates. Take a new screenshot before
clicking anything after the layout may have changed.

1. If the Eclipse home panel isn't showing, open the **Plugins** tab and
   click the **Eclipse** button.
2. With the rig selected (the builder selects it), the home panel shows
   the rig name and an **Animations** list with your sequence. If it says
   "Select rigs in Explorer", the selection was lost (clicking the empty
   viewport clears it). Re-select with
   `game:GetService("Selection"):Set({rig})` instead of clicking around.
3. **Double-click** the animation name; a single click only highlights it.
   The timeline opens and a Face Controls panel may appear beside it.
4. Use **FILE → Fit Timeline** so the ruler spans exactly your animation
   (otherwise it shows a default length such as 0–270). Use the menu, not
   Ctrl+Shift+F: if Eclipse doesn't have keyboard focus, that shortcut
   opens Studio's "Find in Place" panel instead.

What you'll see in the editor:
- Tabs: TIMELINE, FILE, ITEM, EDIT, RIG, VIEW, SETTINGS.
- FILE menu: Save Animation (Ctrl+S), Save Animation As…, Save Animation
  and Close, Recovery…, Import to Rig, Export Results, Module Exporter,
  Fit Timeline, Animation Settings, Hide.
- Top-right icons: Dock Eclipse, Save Animation, **Export Animation**
  (uploads to Roblox), Close Animation.
- The header shows the animation name, current time and FPS. The frame
  ruler is above the tracks, and clicking the ruler moves the playhead.

## Step 4: Verify

Check the keyed beats and the frames in between:

1. Click the frame ruler at the frame you want (estimate x from the ruler's
   tick labels, then zoom into the ruler to read the playhead number).
2. Run `scripts/inspect_pose.luau` (prepend `local RIG = "Workspace.AnimRig"`).
   Eclipse previews by moving the joints, so world positions are live. It
   reports each limb's direction relative to the character, e.g.
   `RightArm forward 0.98 … (forward)`. Compare with what that beat was
   supposed to look like.
3. `screen_capture` with the camera aimed at the rig (for example 6 studs
   in front and to the side, 2 studs above the hips) to judge the
   silhouette. Show the user key poses when that helps.

If something is off, fix the SPEC: **close the animation in Eclipse →
rebuild → reopen**. Keep the SPEC in the conversation so a fix is a small
edit. Don't patch it in the UI unless the user wants manual edits.

The most common mistake is **inherited rotation**: limbs inherit every
parent's turn. Twisting the hips 15° and the chest 35° swings a "forward"
punch 50° off to the side. Check strikes and aims with `inspect_pose`,
and compensate at the shoulder (on R15, +Z on RightUpperArm moves an arm
that's already forward back toward the right) or twist the torso less.
In the test run, a cross went from 50° off-target to dead center with
torso 12°+24° and shoulder Z +36.

## Step 5: Save, close, export

- **Save** with FILE → Save Animation (or the save icon). A toast confirms
  "saved to <Rig> > AnimSaves". The saved sequence is *baked* (one keyframe
  per half-frame) and carries Eclipse's data (EclipseKeyframeData and
  similar), so reopening it in Eclipse restores the original editable keys
  and easing.
- **Close** with the Close Animation icon. If it asks "Unsaved changes will
  be lost", choose Cancel and save first, unless you know the only change
  was view-only (for example Fit Timeline after a save). Closing restores
  the rig's rest pose.
- **Export / upload** (Export Animation icon, or right-clicking the
  KeyframeSequence → Save to Roblox) publishes an asset to the user's Roblox
  account. **Ask the user before doing it**, and let them choose the
  name and owner. Afterwards they get an animation ID for
  `Animator:LoadAnimation`.
- Remind the user to **save the Studio place**. AnimSaves only lives in the
  place file.

## Gotchas

- Eclipse keeps the *authored* easing (it showed Cubic in its key data). The
  baked keyframes say "Linear" only because they're sampled every
  half-frame. That's expected.
- PoseEasingDirection is inverted relative to TweenService (a key with
  PoseEasingDirection.In bakes as a fast start). The builder's `dir` already
  accounts for this. If you write Poses by hand, remember it.
- While an animation is open, **Eclipse previews by rewriting each joint's
  C0** (Transform stays at identity). Never read C0s for pose math while
  Eclipse has an animation open: use the rig's standard constants, or close
  it first. Part world positions are still correct for `inspect_pose`.
- Plan poses **offline before opening Eclipse**: compose
  `parent * C0 * poseCFrame * C1:Inverse()` down the chain in one
  `execute_luau` and print hand and tip positions for each beat. That's
  much faster than UI round trips, and the numbers matched Eclipse exactly.
- A key's `name` overwrite in AnimSaves is safe only before Eclipse has
  saved it. After a save the sequence is baked (`EclipseBaked` attribute),
  so rebuild from the SPEC instead of patching Poses.
- If the user is using the screen (a dialog or another app in front),
  don't click around them. Do the Luau-side work and continue the UI steps
  once the screen is free.
- **Locomotion sets (walk, run, idle, swim and so on):** don't hand-key cycles. Generate them from
  curves, sample every 2 frames with Linear easing (Cubic eases into every key and
  stutters a cycle), ground-fit the lowest foot corner each sample, and measure the
  stance foot's speed to get each gait's natural speed (the controller plays at
  speed ÷ natural speed, so feet don't slide). A working kit (FK, gait generator,
  ground fit, bake, preview) lives in place 124901669247946 at
  `ServerStorage.R6AnimAuthoring`. Copy it rather than starting over.
- **Fast visual review without Eclipse:** clone the rig, multiply each Motor6D's C0
  by the pose transform, and line the clones up for one `screen_capture` (a
  contact sheet). Place clones by **HumanoidRootPart**, not `PivotTo` alone: the
  model pivot isn't the root part, and the clones sink 1.5 studs.
- **Game-wide R6:** Avatar tab → Settings → the **⋯** menu (top right) → *R6 Only*
  → Save changes → Save and Restart (this restarts running servers, so say so). The
  "Standard R6" animation pack option does **not** change the body. Confirm with a
  play test (`humanoid.RigType`).
- A custom controller named `Animate` in StarterCharacterScripts replaces Roblox's
  default. Keep sit and tool holding alive with Roblox's own R6 ids (sit
  178130996, toolnone 182393478, slash 129967390, lunge 129967478).
- Eclipse lists only sequences in the **selected rig's** AnimSaves. If the
  list is empty, check the selection.
- Don't run playtests while an animation is open in Eclipse. Close it first.
- Several Studio windows: pick the right `studio_id`, and confirm with the
  user before editing their game.

## Report back

Tell the user: the animation's name and where it's saved, its length (frames
and seconds), the beats you designed, what you verified and how (which
frames you inspected), and what's left (for example: export/upload, saving
the place, and any wiring in game code). If the user keeps game notes (for
example an Obsidian vault), follow their instructions for recording the work.
