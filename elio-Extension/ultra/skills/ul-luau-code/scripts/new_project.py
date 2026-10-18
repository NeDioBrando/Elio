#!/usr/bin/env python3
"""Scaffold a Roblox game project that is green on the first commit.

Emits the layout, the pinned toolchain, the Knit boot pair, the Net transport,
a Config module, one pure Core module with a passing spec, and the headless test
runner. `check.py` passes on a freshly scaffolded project, which is the point:
step 0 of any build order is "the gates are green with nothing in the game yet",
and a scaffold that cannot clear its own gates hides the first real failure.

    new_project.py "Coin Dash" --dir ~/Projects/CoinDash
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

AFTMAN = """# {title} - pinned toolchain (run `aftman install`)
[tools]
rojo = "rojo-rbx/rojo@7.4.1"
wally = "UpliftGames/wally@0.3.2"
selene = "Kampfkarren/selene@0.28.0"
stylua = "JohnnyMorganz/StyLua@0.20.0"
lune = "lune-org/lune@0.8.9"
"""

WALLY = """[package]
name = "{scope}/{pkg}"
version = "0.1.0"
registry = "https://github.com/UpliftGames/wally-index"
realm = "shared"

[dependencies]
Knit = "sleitnick/knit@1.7.0"
Promise = "evaera/promise@4.0.0"
Signal = "sleitnick/signal@2.0.3"
Trove = "sleitnick/trove@1.8.0"
"""

SELENE = """std = "roblox"

[rules]
unused_variable = "warn"
deprecated = "deny"
shadowing = "warn"
"""

STYLUA = """column_width = 100
indent_type = "Tabs"
quote_style = "AutoPreferDouble"
"""

LUAURC = """{
  "languageMode": "strict"
}
"""

GITIGNORE = """Packages/
ServerPackages/
DevPackages/
*.rbxlx.lock
sourcemap.json
"""

PROJECT = {
    "name": "",
    "tree": {
        "$className": "DataModel",
        "ReplicatedStorage": {
            "Packages": {"$path": "Packages"},
            "Shared": {"$path": "src/shared"},
        },
        "ServerScriptService": {"Server": {"$path": "src/server"}},
        "StarterPlayer": {
            "StarterPlayerScripts": {"Client": {"$path": "src/client"}}
        },
        "Workspace": {"$properties": {"FilteringEnabled": True}},
        "Lighting": {"$properties": {"Technology": "Future"}},
    },
}

SERVER_BOOT = '''--!strict
-- {title} - server entry point.
-- Boots Knit (Services). Keep this file to the boot only; logic lives in Services.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)

Knit.AddServices(script.Services)

Knit.Start()
\t:andThen(function()
\t\t-- BUILD STAMP. If this exact line is not in Output on Play, Studio is NOT
\t\t-- running the code on disk. Check the Rojo plugin is actually CONNECTED
\t\t-- and syncing before debugging anything else - an established connection
\t\t-- is not the same as an accepted one.
\t\tprint("[{title}] Server started - BUILD scaffold-1")
\tend)
\t:catch(warn)
'''

CLIENT_BOOT = '''--!strict
-- {title} - client entry point.
-- Boots Knit (Controllers). Keep this file to the boot only; logic lives in Controllers.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)

Knit.AddControllers(script.Controllers)

Knit.Start()
\t:andThen(function()
\t\t-- BUILD STAMP - see the note in the server boot.
\t\tprint("[{title}] Client started - BUILD scaffold-1")
\tend)
\t:catch(warn)
'''

NET = '''--!strict
-- Net - the ONLY networking transport for gameplay and cross-client paths.
--
-- Knit's auto-generated remotes are deliberately NOT used here. When play-mode
-- introspection is unreachable, the most primitive debuggable transport wins:
-- one folder of plain RemoteEvents, created server-side, awaited client-side,
-- every name declared in this file and nowhere else.
--
-- Server: Net.server("EventName") -> RemoteEvent (creates on first use)
-- Client: Net.client("EventName") -> RemoteEvent? (nil on timeout - callers
--         must fail inert, never error)

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local FOLDER_NAME = "{slug}Net"
local CLIENT_WAIT_TIMEOUT = 10

-- Every remote in the game is declared here. A name not on this list is a bug.
export type EventName = "Ping" -- replace: one entry per remote, each commented

local Net = {{}}

local function serverFolder(): Folder
\tassert(RunService:IsServer(), "Net.server is server-only")
\tlocal folder = ReplicatedStorage:FindFirstChild(FOLDER_NAME)
\tif not folder then
\t\tfolder = Instance.new("Folder")
\t\tfolder.Name = FOLDER_NAME
\t\tfolder.Parent = ReplicatedStorage
\tend
\treturn folder :: Folder
end

--- Server side: get (or create) the RemoteEvent for `name`.
function Net.server(name: EventName): RemoteEvent
\tlocal folder = serverFolder()
\tlocal existing = folder:FindFirstChild(name)
\tif existing and existing:IsA("RemoteEvent") then
\t\treturn existing
\tend
\tlocal remote = Instance.new("RemoteEvent")
\tremote.Name = name
\tremote.Parent = folder
\treturn remote
end

--- Client side: wait for the RemoteEvent for `name`. Returns nil rather than
--- erroring, so a missing remote degrades one feature instead of the client.
function Net.client(name: EventName): RemoteEvent?
\tlocal folder = ReplicatedStorage:WaitForChild(FOLDER_NAME, CLIENT_WAIT_TIMEOUT)
\tif not folder then
\t\twarn(`[Net] no {{FOLDER_NAME}} folder after {{CLIENT_WAIT_TIMEOUT}}s`)
\t\treturn nil
\tend
\tlocal remote = folder:WaitForChild(name, CLIENT_WAIT_TIMEOUT)
\tif not remote or not remote:IsA("RemoteEvent") then
\t\twarn(`[Net] remote {{name}} never arrived`)
\t\treturn nil
\tend
\treturn remote
end

return Net
'''

CONFIG = '''--!strict
-- GameConfig - every tunable in the game, in one place.
--
-- A number that a designer might want to change must live here, never inline in
-- a Service or Controller. This is what makes a balance pass a data edit.

export type Config = {{
\tRespawnSeconds: number,
\tMaxPlayers: number,
}}

local GameConfig: Config = {{
\tRespawnSeconds = 3,
\tMaxPlayers = 4,
}}

return GameConfig
'''

CORE = '''--!strict
-- Health - a worked example of what belongs in Core: pure functions over
-- numbers and tables, no Instances, no services, no yielding.
--
-- If a rule can be written without touching an Instance, it MUST be, because
-- that is what makes it testable when play-mode introspection is unreachable.
-- Delete this module once the game has real ones - but keep the shape.

local Health = {{}}

--- Clamp a damage application. Returns the new health, never below zero.
function Health.applyDamage(current: number, amount: number, max: number): number
\tif amount <= 0 then
\t\treturn math.clamp(current, 0, max)
\tend
\treturn math.clamp(current - amount, 0, max)
end

--- Fraction of maximum, for a health bar. Guards a zero max rather than
--- returning inf, because a UI reading inf is a crash and a UI reading 0 is a
--- visible bug.
function Health.fraction(current: number, max: number): number
\tif max <= 0 then
\t\treturn 0
\tend
\treturn math.clamp(current / max, 0, 1)
end

return Health
'''

SPEC = '''--!strict
-- Spec files are required BY the runner, so this path is relative to tests/.
local Health = require("../src/shared/Core/Health")

return {{
\t["damage never drops below zero"] = function()
\t\tassert(Health.applyDamage(10, 999, 100) == 0, "expected a floor at 0")
\tend,

\t["negative damage cannot heal"] = function()
\t\tassert(Health.applyDamage(50, -25, 100) == 50, "negative damage must be inert")
\tend,

\t["fraction guards a zero maximum"] = function()
\t\t-- The interesting case: 0/0 is nan and nan silently poisons every UI it
\t\t-- reaches, so this must be 0 and not merely "not an error".
\t\tassert(Health.fraction(0, 0) == 0, "expected 0, not nan")
\tend,
}}
'''

SERVICE = '''--!strict
-- ExampleService - the shape every server Service takes.
--
-- The server owns game state. Anything a client sends is a REQUEST, validated
-- here before it changes anything.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)
local Net = require(ReplicatedStorage.Shared.Net)

local ExampleService = Knit.CreateService({{
\tName = "ExampleService",
}})

function ExampleService:KnitInit()
\t-- Create remotes in Init so they exist before any client asks for them.
\tself._ping = Net.server("Ping")
end

function ExampleService:KnitStart()
\tself._ping.OnServerEvent:Connect(function(player: Player, payload: unknown)
\t\t-- Validate every client input. Type first, then range, then ownership.
\t\tif type(payload) ~= "string" or #payload > 64 then
\t\t\treturn
\t\tend
\t\tprint(`[ExampleService] {{player.Name}} says {{payload}}`)
\tend)
end

return ExampleService
'''

CONTROLLER = '''--!strict
-- ExampleController - the shape every client Controller takes.
--
-- Clients own input and display. They ask; they never decide.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)
local Net = require(ReplicatedStorage.Shared.Net)

local ExampleController = Knit.CreateController({{
\tName = "ExampleController",
}})

function ExampleController:KnitStart()
\tlocal ping = Net.client("Ping")
\tif not ping then
\t\t-- Fail inert: one dead feature, not a dead client.
\t\treturn
\tend
\tping:FireServer("hello")
end

return ExampleController
'''

RUNNER = '''--!strict
-- Headless test runner: `lune run test`
--
-- Runs every tests/*.spec.luau as a plain Luau module returning
-- {{ [testName]: () -> () }}. A test passes unless it errors (use assert).
-- Pure modules in src/shared/Core are required directly - no Roblox engine, no
-- Studio, no play mode.

local fs = require("@lune/fs")
local process = require("@lune/process")

local TESTS_DIR = "tests"

local passed, failed = 0, 0

if not fs.isDir(TESTS_DIR) then
\tprint("No tests/ directory - nothing to run.")
\tprocess.exit(0)
end

for _, fileName in fs.readDir(TESTS_DIR) do
\tif not fileName:match("%.spec%.luau$") then
\t\tcontinue
\tend
\tlocal specPath = `{{TESTS_DIR}}/{{fileName}}`
\t-- Lune's require appends .luau itself and resolves relative to the CWD,
\t-- so this must be run from the project root.
\tlocal requirePath = `{{TESTS_DIR}}/{{fileName:gsub("%.luau$", "")}}`
\tlocal ok, specOrErr = pcall(require, requirePath)
\tif not ok then
\t\tfailed += 1
\t\tprint(`FAIL {{specPath}} (could not load): {{specOrErr}}`)
\t\tcontinue
\tend
\tfor testName, testFn in specOrErr :: {{ [string]: () -> () }} do
\t\tlocal testOk, err = pcall(testFn)
\t\tif testOk then
\t\t\tpassed += 1
\t\t\tprint(`PASS {{fileName}} :: {{testName}}`)
\t\telse
\t\t\tfailed += 1
\t\t\tprint(`FAIL {{fileName}} :: {{testName}}\\n     {{err}}`)
\t\tend
\tend
end

print(`\\n{{passed}} passed, {{failed}} failed`)
process.exit(if failed > 0 then 1 else 0)
'''

README = """# {title}

## The five standing rules

1. **Disk is the only source of truth.** Studio connects via `rojo serve`. Never
   edit scripts inside Studio, never `set_script_source` over MCP. MCP is for
   building geometry, inspection and screenshots only.
2. **Pure logic lives in `src/shared/Core/`, Instances live at the edges.** If a
   function can be written without touching an Instance, it must be. That is
   what makes it testable when play mode cannot be inspected.
3. **Gameplay and cross-client paths use `src/shared/Net.luau`** (plain
   RemoteEvents). Knit is lifecycle and DI scaffolding, not transport.
4. **Cosmetics can never break gameplay.** Effects resolve async, fail inert,
   and every one is pcall-isolated.
5. **Every tunable lives in `src/shared/Config/`.** Never hardcode a number in a
   Service or Controller.

## Layout

```
src/shared/Core/        pure Luau, headless-tested   - no Instances
src/shared/Config/      every design tunable         - data only
src/shared/Net.luau     the one networking module    - plain RemoteEvents
src/server/Services/    server-authoritative logic   - Knit Services
src/client/Controllers/ input, camera, rendering     - Knit Controllers
tests/                  *.spec.luau, headless        - `lune run test`
```

## Commands

```sh
aftman install                 # pinned tools
wally install                  # Knit, Promise, Signal, Trove -> Packages/
rojo serve                     # live-sync to Studio (the ONLY sync path)
lune run test                  # headless test suite
selene src                     # lint
stylua src lune                # format
python check.py                # all gates in order
```
"""


def slugify(name: str) -> str:
    """PascalCase, for Luau identifiers and instance names."""
    return re.sub(r"[^A-Za-z0-9]", "", name.title()) or "Game"


def packagename(name: str) -> str:
    """Wally is strict: lowercase, digits and hyphens only."""
    kebab = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return kebab or "game"


def write(path: Path, text: str) -> None:
    # newline="" stops Python translating line endings on Windows. StyLua
    # normalises to LF, so without this every generated file comes back as
    # entirely unformatted - a confusing thing for a first gate to report.
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("title", help='game name, e.g. "Coin Dash"')
    ap.add_argument("--dir", required=True, help="target directory (created if absent)")
    ap.add_argument("--scope", default="joncodea", help="wally package scope")
    ap.add_argument("--force", action="store_true", help="write into a non-empty directory")
    a = ap.parse_args()

    root = Path(a.dir).expanduser()
    if root.exists() and any(root.iterdir()) and not a.force:
        raise SystemExit(f"{root} is not empty. Pass --force if you meant to write into it.")

    title = a.title
    slug = slugify(title)
    fmt = {"title": title, "slug": slug, "pkg": packagename(title), "scope": a.scope}

    project = json.loads(json.dumps(PROJECT))
    project["name"] = title

    write(root / "aftman.toml", AFTMAN.format(**fmt))
    write(root / "wally.toml", WALLY.format(**fmt))
    write(root / "selene.toml", SELENE)
    write(root / "stylua.toml", STYLUA)
    write(root / ".luaurc", LUAURC)
    write(root / ".gitignore", GITIGNORE)
    write(root / "README.md", README.format(**fmt))
    write(root / "default.project.json", json.dumps(project, indent=2) + "\n")

    write(root / "lune" / "test.luau", RUNNER.format(**fmt))
    write(root / "src" / "shared" / "Net.luau", NET.format(**fmt))
    write(root / "src" / "shared" / "Config" / "GameConfig.luau", CONFIG.format(**fmt))
    write(root / "src" / "shared" / "Core" / "Health.luau", CORE.format(**fmt))
    write(root / "tests" / "Health.spec.luau", SPEC.format(**fmt))
    write(root / "src" / "server" / "init.server.luau", SERVER_BOOT.format(**fmt))
    write(root / "src" / "server" / "Services" / "ExampleService.luau", SERVICE.format(**fmt))
    write(root / "src" / "client" / "init.client.luau", CLIENT_BOOT.format(**fmt))
    write(root / "src" / "client" / "Controllers" / "ExampleController.luau", CONTROLLER.format(**fmt))

    print(f"scaffolded {title} -> {root}")
    print("\nnext, from that directory:")
    print("  aftman install")
    print("  wally install")
    print("  python ~/.claude/skills/ul-luau-code/scripts/check.py")
    print("\nthe scaffold is green on all gates before you write a line of game code.")
    print("if it is not, the toolchain is broken and nothing after this is trustworthy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
