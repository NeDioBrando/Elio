# roblox-vfx local settings (copy to LOCAL.md and fill in)

- ROBLOX_VFX_LIB (a folder path; also settable as an environment variable of the same name): your VFX library folder. It holds `harvested/`, `recipes/`, `compositions/`, `index.json` and `.cache/`. Pick a folder OUTSIDE this skill folder, ideally not inside a cloud-synced folder. Every script reads it when `--lib` is not given. Value:
- Studio bridge: which MCP server runs `execute_luau` and `capture_screenshot` for you (Roblox's built-in Studio MCP, or the third-party `robloxstudio-mcp`). Value:
- Sink port: the localhost port `recipe_server.py` listens on (default 48752; change it only if it clashes). Value:
- Studio window: you need Studio maximised and in the foreground for screenshots (see trap 5). Nothing to fill in.
