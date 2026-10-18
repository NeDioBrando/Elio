# roblox-ui local settings (copy to LOCAL.md and fill in)

- Icons project folder: where your generated icons, `icons.json` and mockups live (any folder you own, ideally NOT inside a cloud-synced folder). Value:
- CF_ACCOUNT_ID (env var name only, never the value): Cloudflare account id for `gen_icons_cf.py`; on the Cloudflare dashboard, Workers AI page. Needed only if you generate icons. Value of the variable is set in your shell, not here.
- CF_API_TOKEN (env var name only): Cloudflare API token with Account > Workers AI > Read. Needed only if you generate icons.
- ROBLOX_API_KEY, ROBLOX_USER_ID or ROBLOX_GROUP_ID (env var names only): Open Cloud key and owner id used by `upload_icons.py` through roblox-3d-model's `upload_asset.py`. Needed only to upload icons. Set them in your shell, not here.
- Studio MCP server: which MCP server runs `execute_luau` for you. Value:
