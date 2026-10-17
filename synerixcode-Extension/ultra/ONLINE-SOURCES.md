# Online sources used in UltraLab v2

## Official Roblox Studio MCP tools
Source: https://create.roblox.com/docs/studio/mcp (Roblox Creator Docs)
The tool map in the prompt (TOOL_MAP) is taken from this page: script_read, multi_edit, script_search,
script_grep, generate_mesh, generate_material, generate_procedural_model, wait_job_finished, search_asset,
insert_asset, upload_image, store_image, subagent, search_game_tree, inspect_instance, execute_luau,
get_studio_state, start_stop_play, get_console_output, screen_capture, character_navigation,
user_keyboard_input, user_mouse_input, http_get, skill, list_roblox_studios.
Setup: enable "Enable Studio as MCP server" under Manage MCP Servers in Studio's Assistant menu.

## Other references found online (not copied into the prompt)
These came up in search. Read them before relying on them; they are third-party.
- Community Roblox Studio MCP servers: https://github.com/Chrrxs/robloxstudio-mcp
  and https://glama.ai/mcp/servers/jundayoo/roblox-studio-ultimate-mcp
- Roblox Luau best-practice skill listings: https://claudemarketplaces.com/skills/dig1t/skills/luau-best-practices
  and https://claudskills.com/skills/roblox-best-practices/SKILL.md
- Roblox tooling overview (Rojo, Wally, Lune, Selene, StyLua): https://mintlify.wiki/brockmartin/roblox-game-skill/reference/tooling-ecosystem

## Notes
- Community skill pages are not verified by this pack. Treat their rules as suggestions until a docs page or
  a Studio run confirms them.
- Docs for every API still come from the Roblox Creator Docs (create.roblox.com/docs), through the docs tool.

## Competitors and similar tools (found online, Oct 2026)
Read these as the pages describe them. Several are written by a competitor, so treat their claims as unverified.
- Lemonade (Roblox AI agent, chat-style): compared at https://ropilot.ai/blog/lemonade-vs-superbullet-vs-ropilot.
  The page does not say whether Lemonade works inside Studio or what it does for GUI.
- SuperbulletAI (one-prompt game builder claiming UI, VFX, animation, 3D): same comparison page.
- Ropilot (Studio-native coding agent that reads the project, applies Luau changes and playtests them):
  same comparison page. Its own blog lists the competitor tools: https://ropilot.ai/blog/best-ai-game-builders
- Obby (plain-English game builder with generated GUIs): https://www.obby.fun/blog/roblox-studio-ai
- ForgeGUI (web tool; makes GUI and HUD images, not code; subscription pricing): https://creati.ai/ai-tools/forgegui/
  and https://topai.tools/t/forgegui-net
- Studio's own Assistant (writes and explains scripts): covered by the obby.fun article above.
- Other lists: https://www.obby.fun/blog/roblox-competitors and https://userebirth.com/blog/best-ai-tools-for-roblox-studio
- Roblox UI kits and libraries found in search (not reviewed, licences unknown): https://atleticoking.itch.io/robloxstudio-ui
  and https://corallab.gumroad.com/l/fnitx

## Where UltraLab stands against these (from the sources above, not tested)
- It is Studio-native through the official MCP tools: it can screen_capture, run play and read the console.
  Ropilot makes the same claim; Lemonade and ForgeGUI do not say the same.
- It has a written UI standard (Check-UI) with a checklist, and a gate that asks for a pass table before a UI
  is called done. No competitor above publishes such a gate.
- Its mockup side (ul-ui-builder) makes PNG previews from a spec. ForgeGUI makes images. UltraLab has no image
  generator of its own yet.
