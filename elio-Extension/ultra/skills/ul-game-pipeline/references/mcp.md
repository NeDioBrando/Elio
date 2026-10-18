# Which Studio MCP, and how to keep it up

Researched 2026-08-30 against Roblox Creator Docs, the Roblox devforum bug
category, and the server repos. Every claim below is sourced; the strength of
each is marked.

---

## The finding that matters

**Use Studio's built-in MCP server for a build. Not the third-party one.**

The play-mode gap this pipeline was designing around belongs to the
third-party server, not to Studio. Two different things were being confused:

| | third-party `robloxstudio-mcp` (boshyxd) | **built-in Studio MCP** |
|---|---|---|
| `execute_luau` during Play | **Never reaches it.** Reports `IsEdit=true, IsRunning=false` (measured here 2026-08-27) | Documented and expected to work; see below |
| Screenshots during Play | Edit mode only (measured here) | `screen_capture` is a documented playtest tool |
| Input simulation | `VirtualInputManager` unavailable from plugin context (measured here) | `user_keyboard_input`, `user_mouse_input`, `character_navigation` |
| Console during Play | `get_playtest_output` only | `get_console_output` |
| Generation tools | none | `generate_mesh`, `generate_material`, `generate_procedural_model` |

**Evidence that the built-in server's play-mode tools work** (strength: strong,
primary): a devforum Studio Bugs report of 22 May 2026 says that on Studio
`0.722.0.7221024`, `execute_luau`, `screen_capture`, `search_game_tree`,
`inspect_instance`, `user_mouse_input`, `user_keyboard_input`,
`character_navigation`, `script_grep` and `script_search` all failed **during Play**
with "Target is not reachable", while `start_stop_play`, `get_console_output`,
`list_roblox_studios` and `set_active_studio` kept working. Version
`0.721.0.7211107` was unaffected. Roblox staff (NotANumeral) deployed a fix on
27 May 2026.

That report is only coherent if those tools are *supposed* to work in Play. A
regression against a working baseline is much better evidence than a docs page,
because someone had to notice the loss.

**The caveat, and it is the important one** (strength: documented, not tested
here): `execute_luau` runs in the **plugin's** DataModel, and the plugin's
DataModel is isolated from the running game. So "works during Play" means the
call succeeds, not that it can read the running game's server state. That is the
same wall measured here with the third-party server, and it is structural rather
than a bug.

**If a run genuinely needs live server or client state**, the specialist is
`Chrrxs/robloxstudio-mcp` (MIT, actively maintained, v3.0.3). Its README states
`eval_server_runtime` and `eval_client_runtime` "execute in a live server or
client context and use the same `require` cache as your game scripts", plus
`solo_playtest` / `multiplayer_playtest`, per-peer `get_runtime_logs`, and
non-pausing breakpoints. It solves exactly the problem the other two do not.
Untested here.

---

## The tool surface of the built-in server

From the Creator Docs page, verbatim groupings:

- **Scripts:** `script_read`, `multi_edit`, `script_search`, `script_grep`
- **Generation:** `generate_mesh`, `generate_material`, `generate_procedural_model`,
  `wait_job_finished`, `search_asset`, `insert_asset`, `upload_image`, `store_image`
- **Data model:** `subagent`, `search_game_tree`, `inspect_instance`
- **Luau:** `execute_luau`
- **Playtesting:** `get_studio_state`, `start_stop_play`, `get_console_output`, `screen_capture`
- **Input:** `character_navigation`, `user_keyboard_input`, `user_mouse_input`
- **Docs:** `http_get`, `skill`
- **Session:** `list_roblox_studios`

`get_studio_state` returns play status, so a run can *ask* whether it is in Play
rather than inferring it. Use it at every stage boundary.

Enable it: Assistant, then the `...` menu, then **Manage MCP Servers**, then
**Enable Studio as MCP server**. A green indicator confirms a client connected.

---

## Known failure modes, with dates

These are real, reported, and mostly recent. Treat this as a pre-run checklist
rather than trivia.

| Failure | Status | What to do |
|---|---|---|
| **The "Enable Studio as MCP server" setting turns itself off after a Studio update** (reported 4 Jun 2026, no staff reply) | **Open** | Check the toggle after every Studio update. The reporter lost 20 minutes to it |
| **Connection drops every 5 to 15 minutes** (reported 4-9 Jul 2026, no staff fix) | **Open** | The only reported fix is to disable and re-enable the MCP server. Budget for it |
| Play-mode tools return "Target is not reachable" (22 May 2026) | **Fixed** 27 May | Update Studio |
| `get_console_output` returned Studio and plugin logs instead of game output (30 May 2026) | **Fixed** 1 Jun | Update Studio |
| MCP cannot start any run mode (20 Aug 2026) | **Fixed** 24 Aug | Update Studio |
| `list_roblox_studios` reports one instance or none | Intermittent | Close and reopen Studio and the client |

**The pattern across all of them:** most Studio MCP breakage is a version
regression that Roblox fixes within days. So the single most effective
reliability measure is to **update Studio before a build and check the
toggle**, and the second is to **not be on the bleeding edge during it**.

---

## The rules that make a run survive

1. **Exactly one MCP server connected. Never two.** Two long-polling plugins is
   the duplicate-server deadlock already seen in practice, and it is the same
   failure shape as the Rojo double-connection that killed every Knit controller.
2. **Check the toggle after any Studio update.** Known open bug, no fix.
3. **Expect a disconnect every 5 to 15 minutes and treat it as routine.** Under
   the pipeline's rules, restarting a stuck MCP server is a free intervention
   and does not touch the counter. It still costs wall-clock, so it belongs in
   the time budget rather than in the surprise budget.
4. **Call `get_studio_state` at stage boundaries** rather than assuming which
   mode Studio is in.
5. **Never assume `execute_luau` sees the running game.** It runs in the plugin
   DataModel. To read live state, print from game code and collect it with
   `get_console_output`, or bring in the specialist server.
6. **A "not reachable" error immediately after a Studio update is a regression,
   not your code.** Check the devforum Studio Bugs category before spending the
   stall budget on it.

---

## Sources

- [Connect to the Roblox Studio MCP server](https://create.roblox.com/docs/studio/mcp) - tool surface, setup, security note
- [Studio MCP Play Mode tools fail with Target is not reachable](https://devforum.roblox.com/t/studio-mcp-play-mode-tools-fail-with-target-is-not-reachable-on-vscode/4648112) - which tools work in Play, and the fix
- [MCP keeps disconnecting](https://devforum.roblox.com/t/mcp-keeps-disconnecting/4717243) - the open disconnect bug
- [MCP Server get_console_output broken](https://devforum.roblox.com/t/mcp-server-getconsoleoutput-broken/4659928) - fixed 1 Jun 2026
- [Studio MCP turning off after update](https://devforum.roblox.com/t/studio-mcp-turning-off-after-update/4668418) - open, no staff reply
- [MCP can't start Run Mode](https://devforum.roblox.com/t/mcp-cant-start-run-mode/4822020) - fixed 24 Aug 2026
- [Roblox/studio-rust-mcp-server](https://github.com/Roblox/studio-rust-mcp-server) - the standalone server, no longer developed, superseded by the built-in one
- [Chrrxs/robloxstudio-mcp](https://github.com/Chrrxs/robloxstudio-mcp) - MIT, live server/client eval, per-peer logs
