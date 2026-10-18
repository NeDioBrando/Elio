# UltraLab v2

One Roblox prompt for code, interfaces, effects, animation, maps, models, sound and build pipelines.
Works with any AI model.

## What is here

| Path | What it is |
|---|---|
| `ultralab.py` | Builds the prompts. Run `python ultralab.py --out ultralab_prompt.txt` |
| `ultralab_prompt.txt` | Full prompt for models with a large context. Paste into the Custom prompt box |
| `ultralab_deepseek_prompt.txt` | Shorter prompt for DeepSeek-style models |
| `skills/` | Full text of every SyphoDev skill, renamed `ul-*`, with its references and scripts |
| `agents/` | Full text of the seven SyphoDev agents, renamed `ul-agent-*` |
| `references/` | Check-UI modules, button art, hat art, the GUI verifier and the syntax checker |
| `LICENSE-SyphoDev.txt` | The SyphoDev licence. Keep it with any copy |
| `ONLINE-SOURCES.md` | Tools and references taken from online, with links |

## Using it

- **Prompt only (any chat AI):** paste the prompt file into the custom-instructions box.
- **Prompt plus files (AI tools that can read files):** keep the folder together. The prompt points to
  `skills/` and `agents/`. Ask the AI to read a skill's SKILL.md before that kind of work.
- **Scripts:** the Python and Lua files in `skills/*/scripts` run on your own computer. They need the tools
  each skill names (Python 3.11+, Rojo, Blender and so on). Run `ul-setup-check` first.

## Names

The SyphoDev skills were renamed to `ul-*`. Old to new:

| Old | New |
|---|---|
| create-roblox-game | ul-game-pipeline |
| roblox-build-orchestrator | ul-build-orchestrator |
| roblox-code | ul-luau-code |
| roblox-ui | ul-ui-builder |
| roblox-map | ul-map-builder |
| roblox-3d-model | ul-3d-model |
| roblox-texture-gen | ul-texture-gen |
| roblox-vfx | ul-vfx-library |
| roblox-sfx | ul-sfx-finder |
| roblox-animation | ul-animation |
| roblox-skills-setup | ul-setup-check |
| roblox-asset-anim / -map / -mesh / -sfx / -ui / -vfx | ul-agent-animation / -map / -mesh / -sfx / -ui / -vfx |
| roblox-market-scout | ul-agent-market-scout |

## Changes from the original pack

- Claude-specific wording is replaced with neutral wording, so the skills work with any AI.
- Claude-only agent settings (tools, model, disallowed tools) were removed from agent files. The steps stay.
- The installers (install.sh, install.ps1) were left out. Copy the folders yourself.
- `kiln-route.md` still shows `--harness claude`, because that is a real option of the kiln tool. Keep it or change it to your tool.

## Licence and credit

The SyphoDev skills are under the SyphoDev free licence (LICENSE-SyphoDev.txt). In short:
- You may use them and change them for your own projects, including commercial games.
- You may not sell them, a changed copy of them, or put them in a paid bundle.
- If you share them for free, link back to the SyphoDev YouTube channel as the source.
- The Fredoka fonts are under the SIL Open Font License 1.1.
- Third-party tools and AI models have their own terms. Read the licence of every model and asset you use.

Source: SyphoDev Roblox Skills, free edition (the pack uploaded as roblox-ai-skills-main).
Credit the SyphoDev channel whenever you share this pack or a copy of it.
