# Patterns

The shapes to copy. Each one exists because the alternative broke something.

---

## Layout

```
src/shared/Core/        pure Luau, headless-tested   - no Instances, no yielding
src/shared/Config/      every design tunable         - data only
src/shared/Net.luau     the one networking module    - plain RemoteEvents
src/server/Services/    server-authoritative logic   - Knit Services
src/client/Controllers/ input, camera, rendering     - Knit Controllers
tests/                  *.spec.luau                  - `lune run test`
lune/test.luau          the runner
```

Rojo maps `src/shared` to `ReplicatedStorage.Shared`, `src/server` to
`ServerScriptService.Server`, `src/client` to `StarterPlayerScripts.Client`.
`init.server.luau` and `init.client.luau` turn their folder into the Script
itself, which is why the boot files sit at the top of each folder.

**ServerScriptService is never replicated to clients. ReplicatedStorage always
is.** A secret in `Shared/` is not a secret. Server-only data belongs in
`ServerStorage` or `ServerScriptService`.

---

## Knit Service (server)

```lua
--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)
local Net = require(ReplicatedStorage.Shared.Net)
local Config = require(ReplicatedStorage.Shared.Config.GameConfig)

local FlockService = Knit.CreateService({
	Name = "FlockService",
	-- Plain fields for state. Note the leading underscore convention: it is a
	-- reminder that nothing outside this file may touch them.
	_sheep = {} :: { [number]: Sheep },
})

function FlockService:KnitInit()
	-- Init: create things other code will look for. Remotes go here so they
	-- exist before any client asks.
	self._lost = Net.server("SheepLost")
end

function FlockService:KnitStart()
	-- Start: everything is constructed, other services may be used now.
	local WolfService = Knit.GetService("WolfService")
	WolfService.Killed:Connect(function(sheepId: number)
		self:_remove(sheepId)
	end)
end

function FlockService:_remove(sheepId: number)
	self._sheep[sheepId] = nil
	self._lost:FireAllClients(sheepId)
end

return FlockService
```

`KnitInit` runs for every service before any `KnitStart`. That ordering is the
whole reason the two exist: reach for another service in `Start`, never in
`Init`, or you will get a half-built one.

---

## Knit Controller (client)

```lua
--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Knit = require(ReplicatedStorage.Packages.Knit)
local Net = require(ReplicatedStorage.Shared.Net)

local FlockController = Knit.CreateController({ Name = "FlockController" })

function FlockController:KnitStart()
	local lost = Net.client("SheepLost")
	if not lost then
		-- Fail inert. One dead feature, not a dead client.
		return
	end
	lost.OnClientEvent:Connect(function(sheepId: number)
		-- Display only. The sheep is already gone on the server; this just
		-- makes it look like it.
		self:_playLossFeedback(sheepId)
	end)
end

return FlockController
```

---

## Net

One module, every remote name declared as a union type, created on the server
and awaited on the client with a timeout that returns nil rather than erroring.
The scaffold ships a working copy; add one line per remote with a comment saying
**who sends it, who receives it, and why it is separate from its neighbours**.

That comment is not decoration. On a real project, "server to the killer only"
and "server to all clients" ended up as two remotes precisely because writing
the comment surfaced that they were different audiences with different payloads.

```lua
export type EventName =
	-- client -> server: "I pulled the trigger", origin + direction. The server
	-- decides what was hit; this is a request, not a result.
	"Fire"
	-- server -> ONE client: apply this knockback to your own character.
	| "Impulse"
```

### RemoteEvent or RemoteFunction

Default to RemoteEvent. A RemoteFunction yields the caller until the other side
returns, and if it never returns the thread hangs forever.

| Case | Use |
|---|---|
| Player acts (fires, clicks, jumps) | RemoteEvent |
| Server tells everyone something happened | RemoteEvent, `FireAllClients` |
| Server tells one player something private | RemoteEvent, `FireClient` |
| Client genuinely needs an answer before continuing | RemoteFunction, with a timeout |

Never let a client invoke a RemoteFunction the server implements without
rate-limiting it: one client in a loop stalls the thread for everyone.

---

## Core module and spec

**Core takes plain numbers.** `Vector3` and `CFrame` are not globals in Lune
(measured: `attempt to index nil with 'new'`), so a Core module that uses them
cannot be required by a spec. Pass `(x, y, z)` scalars and construct the
datatype at the edge, in the Service or Controller that owns the Instance.

```lua
--!strict
-- src/shared/Core/Stamina.luau
local Stamina = {}

--- Drain per second while sprinting, refill per second otherwise. Returns the
--- new value, clamped. Pure: no Instances, no services, no yielding.
function Stamina.step(current: number, dt: number, sprinting: boolean, cfg: Cfg): number
	local delta = if sprinting then -cfg.DrainPerSecond else cfg.RefillPerSecond
	return math.clamp(current + delta * dt, 0, cfg.Max)
end

return Stamina
```

```lua
--!strict
-- tests/Stamina.spec.luau
local Stamina = require("../src/shared/Core/Stamina")

local CFG = { Max = 100, DrainPerSecond = 25, RefillPerSecond = 10 }

return {
	["sprinting cannot drive stamina negative"] = function()
		assert(Stamina.step(5, 1, true, CFG) == 0, "expected a floor at 0")
	end,

	["a full bar does not overfill"] = function()
		assert(Stamina.step(100, 1, false, CFG) == 100)
	end,

	["the shipped numbers give roughly four seconds of sprint"] = function()
		-- Pinning the DESIGN, not the code: if someone retunes DrainPerSecond
		-- this test fails and forces the conversation.
		local t, v = 0, CFG.Max
		while v > 0 and t < 60 do
			v = Stamina.step(v, 1 / 60, true, CFG)
			t += 1 / 60
		end
		assert(math.abs(t - 4) < 0.2, `expected ~4s of sprint, got {t}`)
	end,
}
```

Tests return a table of named functions and pass unless they error. Names are
read as prose in the output, so write them as claims.

---

## Cleanup with Trove

Every connection made must be destroyable, or a rejoining player leaks one of
everything.

```lua
local Trove = require(ReplicatedStorage.Packages.Trove)

function WolfService:_spawn(cfg)
	local trove = Trove.new()
	local wolf = trove:Add(WOLF_TEMPLATE:Clone())
	trove:Connect(RunService.Heartbeat, function(dt) self:_hunt(wolf, dt) end)
	trove:Add(function() self._active[wolf] = nil end)
	return trove -- caller calls :Destroy() and everything above unwinds
end
```

---

## Performance

- Per-frame work goes on `RunService.Heartbeat`, never a `task.wait(0)` loop.
- `CollectionService` tags instead of walking the whole tree looking for things.
- `Debris:AddItem` for temporary instances in hot paths.
- Batch replication: one remote carrying twenty sheep positions beats twenty
  remotes, by a lot.
- Profile with the MicroProfiler (Ctrl+F6) before optimising. Every guess about
  Roblox performance made without it has a good chance of being backwards.
