--!strict
-- CharacterVFX - wires YOUR roblox-vfx recipes to gameplay. A worked example:
--   AURA_RECIPE    constant, on every spawned character
--   IMPACT_RECIPE  burst at the feet whenever the character lands
-- Set the two names below to recipes that exist in YOUR emitted VFXKit (no
-- recipes ship with the skill; harvest a pack, curate, then emit_luau.py).
--
-- Placement: ServerScriptService, with VFXKit (ModuleScript) as a sibling or in
-- ReplicatedStorage. Server-built effects live inside the character model, so
-- they replicate to every client with no RemoteEvent involved.

local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local kitModule = ServerScriptService:FindFirstChild("VFXKit")
	or ReplicatedStorage:FindFirstChild("VFXKit")
assert(kitModule, "CharacterVFX: VFXKit ModuleScript not found")
local VFXKit = require(kitModule)

-- Landing bursts scale with impact speed, so a hop is not the same event as a
-- long drop. Below MIN_LAND_SPEED nothing fires at all, otherwise every step off
-- a kerb throws sparks.
local AURA_RECIPE = "MyAura"
local IMPACT_RECIPE = "MyImpact"

local MIN_LAND_SPEED = 24
local FULL_LAND_SPEED = 90
local MIN_MULT, MAX_MULT = 0.55, 1.6
local RETRIGGER_COOLDOWN = 0.12

local AURA_COLOUR = nil -- e.g. Color3.fromRGB(255, 120, 40) to recolour the aura

local function feetOffset(humanoid: Humanoid, root: BasePart): Vector3
	-- HipHeight is the distance from the root's centre to the ground for R15;
	-- R6 reports 0, so fall back to half the root height plus a leg.
	local hip = humanoid.HipHeight
	if hip <= 0 then hip = root.Size.Y * 0.5 + 1 end
	return Vector3.new(0, -(hip + root.Size.Y * 0.5), 0)
end

local function setupCharacter(character: Model)
	local humanoid = character:WaitForChild("Humanoid", 10) :: Humanoid?
	local root = character:WaitForChild("HumanoidRootPart", 10) :: BasePart?
	if not humanoid or not root then
		warn("CharacterVFX: character missing Humanoid or HumanoidRootPart")
		return
	end

	local aura = VFXKit.build(AURA_RECIPE, root, {
		tint = AURA_COLOUR,
	})
	aura.setEnabled(true)

	local impact = VFXKit.build(IMPACT_RECIPE, root, {
		offset = feetOffset(humanoid, root),
	})

	-- Peak downward speed seen during the fall. Humanoid.StateChanged(Landed)
	-- fires AFTER the engine has already begun arresting the fall, so reading
	-- velocity at that moment under-reports the impact badly.
	local fallSpeed = 0
	local lastBurst = 0

	local conn
	conn = humanoid.StateChanged:Connect(function(_old, new)
		if new == Enum.HumanoidStateType.Freefall or new == Enum.HumanoidStateType.Jumping then
			fallSpeed = 0
		elseif new == Enum.HumanoidStateType.Landed then
			local now = os.clock()
			if now - lastBurst < RETRIGGER_COOLDOWN then return end
			if fallSpeed < MIN_LAND_SPEED then return end
			lastBurst = now

			local t = math.clamp(
				(fallSpeed - MIN_LAND_SPEED) / (FULL_LAND_SPEED - MIN_LAND_SPEED), 0, 1)
			impact.emit(MIN_MULT + (MAX_MULT - MIN_MULT) * t)
		end
	end)

	local track
	track = game:GetService("RunService").Heartbeat:Connect(function()
		if not root.Parent then
			track:Disconnect()
			return
		end
		local state = humanoid:GetState()
		if state == Enum.HumanoidStateType.Freefall or state == Enum.HumanoidStateType.Jumping then
			fallSpeed = math.max(fallSpeed, -root.AssemblyLinearVelocity.Y)
		end
	end)

	character.AncestryChanged:Connect(function(_, parent)
		if not parent then
			conn:Disconnect()
			if track.Connected then track:Disconnect() end
		end
	end)
end

local function onPlayer(player: Player)
	if player.Character then
		task.spawn(setupCharacter, player.Character)
	end
	player.CharacterAdded:Connect(setupCharacter)
end

for _, p in ipairs(Players:GetPlayers()) do
	onPlayer(p)
end
Players.PlayerAdded:Connect(onPlayer)
