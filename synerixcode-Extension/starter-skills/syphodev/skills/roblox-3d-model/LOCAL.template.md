# LOCAL.md for roblox-3d-model

Copy this file to `LOCAL.md` and fill it in. `LOCAL.md` is yours and is never shared.
Never write a key or token value into any file: set them as environment variables
(or, for Kaggle, in `~/.kaggle/kaggle.json`), and record only whether they are set.

## Tools

- BLENDER (env var): full path to your Blender 4.x executable. Not needed if `blender` is on PATH; `batch.py` also searches the standard install folders.
  Value:
- KILN_HOME (env var): the folder where you ran `npm install` for Kiln (hard-surface route only). It must contain `node_modules/@gltf-transform`.
  Value:
- Work folder: where batches write their per-asset folders (`--outdir`). Any folder outside the skill; avoid a cloud-synced one if you can.
  Value:
- Studio MCP server name: which MCP server runs `execute_luau` for the Studio wiring step (check with `/mcp`).
  Value:

## Credentials (env var NAMES only)

- HF_TOKEN: free HuggingFace token. Stages 1 and 3. Raises the ZeroGPU quota. Set: yes / no
- CF_ACCOUNT_ID, CF_API_TOKEN: Cloudflare Workers AI (Account > Workers AI > Read). Stage 1 only, optional. Set: yes / no
- KAGGLE_API_TOKEN, or `~/.kaggle/kaggle.json` (plus KAGGLE_USERNAME if the config file is absent): your own phone-verified Kaggle account, for the GPU stage. Set: yes / no
- ROBLOX_API_KEY: Open Cloud key with Assets write, for the permanent upload route only. Set: yes / no
- ROBLOX_USER_ID or ROBLOX_GROUP_ID: who uploaded assets are created under. Set: yes / no
- POLLINATIONS_TOKEN: optional, only for the Pollinations fallback. Set: yes / no
