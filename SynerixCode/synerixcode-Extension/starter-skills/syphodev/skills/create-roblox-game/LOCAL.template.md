# LOCAL.md for create-roblox-game

Copy this file to `LOCAL.md` and fill it in. `LOCAL.md` is yours and is never shared.
Never write a key or token here; record only the NAME of the environment variable that holds it.

## Folders

- Games folder (where every game you make lives; section mode records its games
  here in `.section-games.json`). Scripts read the `ROBLOX_GAMES_HOME`
  environment variable and default to `~/Projects/Roblox-Games`:
- Skills folder, only if you did not install into `~/.claude/skills`
  (scripts read `ROBLOX_SKILLS_DIR`):

## Tools (preflight.py checks these live)

- Blender, only needed for the mesh, animation and render stages. Full path to the
  executable, or leave empty if it is on PATH (scripts also read the `BLENDER`
  environment variable):
- Rojo, Wally, Selene, StyLua and Lune must be on PATH (a toolchain manager such
  as Rokit or Aftman installs them). Note how you installed them:

## Roblox Studio MCP

- Which server is connected (use the built-in Studio MCP, and only one server
  at a time; see `references/mcp.md`):

## Accounts and keys (names only, never values)

- Open Cloud key, for upload and publish (environment variable name, normally
  `ROBLOX_API_KEY`):
- Kaggle, only for the GPU mesh step (environment variable names, normally
  `KAGGLE_USERNAME` and `KAGGLE_KEY`, or a `~/.kaggle` credentials file):
- Default place id for `place_state.py` (environment variable `ROBLOX_PLACE_ID`,
  optional; each game also records its own ids in `design/game.json` under `publish`):

## My preferences

(optional: art style, genres you like, things you never want)
