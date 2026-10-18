# SyphoDev Roblox Skills (free)

A set of Claude Code skills and agents for making Roblox games with AI: code,
UI, maps, 3D models, textures, VFX, SFX, animation, and a front door that
takes one game idea through research, design, build and playtest.

Free, as promised at 1,000 subscribers. Thank you for watching.

## What is in the pack

| Skill | What it does |
|---|---|
| `create-roblox-game` | The front door. One design file to a playable game, stage by stage |
| `roblox-build-orchestrator` | Runs the asset stages in parallel with sub-agents and logs the build |
| `roblox-code` | Scaffolds a Rojo + Knit project and proves code with 4 no-Studio gates |
| `roblox-ui` | Builds GUI from a JSON spec: PNG mockup, Rojo model file and Luau builder |
| `roblox-map` | Lays out maps from a spec and PROVES they are playable (reach, falls, sightlines) |
| `roblox-3d-model` | Text or image to a game-ready MeshPart, through Blender |
| `roblox-texture-gen` | Generates textures for your meshes and parts |
| `roblox-vfx` | Harvests particle effects from packs you own into a searchable library |
| `roblox-sfx` | Finds and wires sound effects |
| `roblox-animation` | Authors R15/R6 animations headlessly in Blender from a pose spec |
| `roblox-skills-setup` | Sets everything up on YOUR machine. Run this first |

Plus 7 agents (`agents/`) the orchestrator hands work to.

## Install

1. Install [Claude Code](https://claude.com/claude-code) and Roblox Studio.
2. Unzip this folder anywhere.
3. Windows: right-click `install.ps1` > Run with PowerShell.
   macOS / Linux: `bash install.sh`
   (Or copy `skills/*` into `~/.claude/skills/` and `agents/*` into
   `~/.claude/agents/` yourself.)
4. Restart Claude Code and type `/roblox-skills-setup`.

The setup skill checks what you have installed, tells you what each missing
tool is for, and writes a `LOCAL.md` inside each skill with YOUR folders and
tool paths. You never have to edit a skill by hand. Run it again any time you
move things or install something new.

Then start a game: `/create-roblox-game make me a tycoon game`, or call any
single skill by name ("use roblox-ui to make a shop screen").

## What you need

Not everything is needed for everything. The setup skill only asks about the
parts you want.

- **Always:** Claude Code, Roblox Studio with its official MCP enabled, Python 3.11+.
- **Code:** Rojo, Wally, Lune, Selene, StyLua (all free).
- **3D models and animation:** Blender 4.x, and a free Kaggle or Hugging Face
  account for the mesh-generation step.
- **Permanent uploads (optional):** a free Roblox Open Cloud API key.

## Things to know

- **Your keys stay yours.** Skills read API keys from environment variables.
  Nothing in this pack asks you to paste a key into a file or a chat.
- **VFX ships empty on purpose.** `roblox-vfx` is a harvester. You take free
  VFX packs into your own Roblox account and it builds your library from
  them. The setup skill walks you through it. Check each pack's terms before
  publishing a game with its effects.
- **Model licences matter.** Read `skills/roblox-3d-model/references/licences.md`
  before generating models; some AI model licences exclude some regions or uses.
- **`LOCAL.md` is personal.** If you share your own version of a skill, leave
  it out.

## Licence

See `LICENSE.txt`.
