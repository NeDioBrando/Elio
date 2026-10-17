# Unattended recovery

The build must survive its own infrastructure without a human. This file is the
routine for that, and the MCP half of it was proven on 2026-08-30 against a real
dead connection: diagnosed, repaired and verified with no human input.

---

## The rule that governs all screen driving

**Never click a coordinate from a frame you have not just re-taken, and never
accept a screenshot as proof that something worked.**

Both halves were learned the expensive way in one session. A click aimed at a
dialog button landed on a template tile because the window had changed
underneath, and Studio began loading a Platformer place. Separately, the MCP
panel showed a green "Connected" indicator while `execute_luau` still timed out.

So every screen action is: **screenshot, act, then verify through a channel that
is not the screen.** For MCP that means a real `execute_luau` call. For Rojo it
means reading `.Source` of a file that only exists on disk.

Studio is not a web page. A stray click can load a place, move geometry, or
delete a selection, and there is no back button for most of it.

---

## MCP: why it dies, and the fix

`robloxstudio-mcp` is two halves that must agree on a port:

- a **node server**, spawned by the MCP client (Claude Code)
- the **Studio plugin**, which polls one port listed in its own panel

Every server instance binds **3002** plus one high port (48741-ish). With two
instances alive, the second loses 3002 and takes a different high port. The
plugin keeps polling whichever it saw first. Kill that one and the plugin polls a
dead port forever while the surviving server sits on a port nobody asks about.
Every call then returns `Studio plugin connection timeout`, which reads like a
broken plugin and is actually a stranded one.

**The plugin's `MCP Server` ribbon button spawns its own npx server.** That is
where the duplicate comes from. Never click it to "reconnect" - it deepens the
problem. Open its panel and use Connect.

### The routine

```bash
python ~/.claude/skills/create-roblox-game/scripts/recover_mcp.py
```

1. **Diagnose.** The script lists every server and its ports and returns a
   verdict: healthy, split-brain, or absent.
2. **If split-brain or stranded:** `recover_mcp.py --fix` kills every server.
3. **Make any MCP tool call.** The client respawns the server on demand, and with
   3002 free the new one takes both ports.
4. **Re-run the script** to read the port the plugin must use.
5. **In Studio:** Plugins ribbon, `MCP Server`, and in the panel confirm the port
   chip matches, then click **Connect**. The panel then shows HTTP server (OK),
   MCP bridge (OK), Commands (OK).
6. **Prove it** with a real `execute_luau`. Step 5's green dot is not evidence.

Measured: the whole loop took about four minutes, most of it diagnosis. Once the
verdict is known the repair is under a minute.

---

## Rojo

Rojo has the same two-halves shape - a `rojo serve` process and a Studio plugin
that must connect to it - and the same failure modes, plus one worse one.

Known from this project's own history:

- **Exactly one server and one plugin connection.** Two connections create every
  new file twice, `Knit.AddControllers` throws on the duplicate name, and every
  controller dies at once. The symptom is "all my systems stopped", not
  "duplicate file".
- **An established TCP connection is not a synced session.** An unaccepted
  "Would you like to connect?" prompt in Studio once blocked syncing for an
  entire session while everything looked connected from outside.
- Therefore: **verify Rojo by reading a script's `.Source` in Studio and checking
  it matches disk**, never by looking at the plugin's connection state.

The build stamp in the boot scripts exists for exactly this. If that exact line
is not in Output, Studio is not running the code on disk.

**Not yet driven by computer-use.** The MCP recovery is proven; the Rojo connect
click path is not, because it needs a live `rojo serve` and a project to sync.
Rehearse it on a practice run rather than discovering it mid-build.

---

## If Studio itself dies

This is the branch that decides whether "one prompt and walk away" survives, and
it has a prerequisite that has to be set up in advance.

Observed 2026-08-30: Studio had exited on its own some time earlier, and on the
next launch it showed an **Auto-Recovery modal** ("Studio was not shut down
properly"). A modal blocks everything, so an unattended run has to handle it.

1. Detect: MCP calls time out **and** no `RobloxStudioBeta` process exists.
2. Relaunch Studio.
3. Handle the Auto-Recovery modal. **Ignore** continues and leaves the files
   alone. Never **Delete**. Only choose **Open** if the run's place was unsaved,
   which it should never be.
4. Reopen the run's place **by file path**, not from the start page.
5. Reconnect MCP by the routine above, and Rojo if the run uses it.
6. Log it in the ledger as a stall, not an intervention - no human touched it.

### The prerequisite: save the place, and know which save

Measured 2026-08-30, all three of these the hard way:

- **`game:Save()` does not exist.** `Save is not a valid member of DataModel`.
  Saving is a screen action, not a script action.
- **`Ctrl+S` is NOT a local save.** It opens **Save Experience**, which publishes
  to the Roblox account and mints a new experience, with Team Create and Data
  Sharing defaulting on. That is the user's decision and a run must never take
  it. The local save is **File > Save to File As (`Ctrl+Shift+S`)**, and
  **File > Save to File** silently re-saves afterwards.
- **The DataModel cannot tell you whether the place is saved.** After saving to
  `SavedPlaceTest.rbxl`, `game.Name` still returned `Place1` and `game.PlaceId`
  was still `0`. Studio's **window title** carries the full path, and that is the
  only reliable signal from outside.

```bash
python ~/.claude/skills/create-roblox-game/scripts/place_state.py
```

Returns `SAVED <path>` or `UNSAVED`, exits non-zero on unsaved, and warns if more
than one Studio window is open. It is a required row in `preflight.py`.

**Save before the run starts and re-save at every stage boundary.** An unsaved
`Place1` at `placeId 0` cannot be reopened after a crash and everything in it is
gone. On 2026-08-30 that cost a test sound bank, regenerable in thirty seconds;
at hour six of a long build it costs the build.

---

## What still needs a human

Nothing during the build, once the above is in place. The two remaining
touchpoints sit outside it:

- **Minting the universe and place**, once, before the run starts. The Universes
  API cannot create one.
- **Publishing and inviting players**, at the end.

Both are free interventions under the pipeline's rules, and both happen when
you are at the machine anyway.
