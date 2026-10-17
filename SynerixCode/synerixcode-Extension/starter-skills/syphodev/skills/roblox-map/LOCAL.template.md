# roblox-map local settings (copy to LOCAL.md and fill in)

`LOCAL.md` is yours and is never shared.

- Python: the interpreter that has `numpy`, `scipy` and `Pillow` installed (check with `python -c "import numpy, scipy, PIL"`). Value:
- Studio MCP server: which MCP server runs `execute_luau` for you (the Roblox Studio MCP), used for every Studio step. Value:
- Map work folder: where `build_map.py --out` writes reports, plans and terrain for your maps (any folder you own, for example `<your game>/work/map`). Value:
- Asset ids file (optional): your own JSON `{"meshName": assetId}` for the models your specs place, passed as `--asset-ids` or named in a spec's `assetIdsFile`. Only needed once a map places meshes. Value:
- serve_map port (optional): the localhost port `serve_map.py` serves on and `verify_placement.lua` reads from. Default 8787. Value:
- ROBLOX_API_KEY (env var name only, never the value): Open Cloud key used to upload your meshes through the roblox-3d-model skill's `upload_asset.py`. Needed only to upload. Set it in your shell, not here.
