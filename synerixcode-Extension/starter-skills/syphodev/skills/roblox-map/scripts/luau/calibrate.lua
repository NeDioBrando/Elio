--!nonstrict
-- roblox-map: movement calibration harness.
--
-- WHY THIS EXISTS. The prover checks a map against numbers, so a wrong number
-- makes every check confidently wrong. Most of a movement profile can be
-- derived from config, but the values that decide whether a map is WALKABLE -
-- real jump apex, real jump distance, the auto-step height, how long a ragdoll
-- takes to recover - are properties of the running character controller, not of
-- a config file. A game with custom movement (one that disables the default
-- Animate script and drives its own locomotion) can differ from the textbook
-- figures without anyone noticing.
--
-- Edit mode cannot answer this: there is no Humanoid simulation, and
-- PathfindingService was measured returning Success for a 12-stud unclimbable
-- wall. So this runs in PLAY MODE and reports back through LogService, which is
-- the only channel out of a running game that the MCP can read
-- (get_playtest_output).
--
-- HOW TO RUN
--   1. Put this in StarterPlayer > StarterPlayerScripts as a LocalScript.
--   2. Press Play.
--   3. Wait for the "CALIBRATION COMPLETE" line, then read the JSON after
--      MAPCAL| and paste those values into profiles/<name>.json, changing each
--      field's "src" to "measured".
--   4. Delete the script.
--
-- It builds its own test rig in a clear patch of sky and puts the character
-- back where it found them.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local RIG_ORIGIN = Vector3.new(0, 500, 0)
local STEP_HEIGHTS = { 1.0, 1.5, 2.0, 2.5, 3.0, 4.0 }

local function log(msg)
	print("[mapcal] " .. msg)
end

local function waitForCharacter()
	local char = player.Character or player.CharacterAdded:Wait()
	local hum = char:WaitForChild("Humanoid", 10)
	local root = char:WaitForChild("HumanoidRootPart", 10)
	return char, hum, root
end

local function makePart(name, size, pos, parent)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Position = pos
	p.Anchored = true
	p.CanCollide = true
	p.Material = Enum.Material.SmoothPlastic
	p.Parent = parent
	return p
end

-- Sample the character every frame for `duration`, returning the samples.
local function sample(root, duration)
	local out = {}
	local t0 = os.clock()
	local conn
	conn = RunService.Heartbeat:Connect(function()
		table.insert(out, { t = os.clock() - t0, p = root.Position, v = root.AssemblyLinearVelocity })
	end)
	while os.clock() - t0 < duration do
		task.wait()
	end
	conn:Disconnect()
	return out
end

local function measureJump(hum, root, pad, speed)
	-- Land first, so jump fatigue is not being measured by accident.
	root.CFrame = CFrame.new(pad.Position + Vector3.new(0, 5, 0))
	task.wait(1.0)
	hum.WalkSpeed = speed
	if speed > 0 then
		hum:Move(Vector3.new(0, 0, -1), false)
	end
	task.wait(0.6)          -- reach steady speed before leaving the ground
	local y0 = root.Position.Y
	local p0 = root.Position
	hum.Jump = true
	local s = sample(root, 2.0)
	hum:Move(Vector3.zero, false)

	local apex, airtime, landed = 0, 0, nil
	local left = nil
	for _, k in ipairs(s) do
		local rise = k.p.Y - y0
		if rise > apex then apex = rise end
		if left == nil and rise > 0.35 then left = k.t end
		if left and landed == nil and k.t > left + 0.15 and math.abs(rise) < 0.35 then
			landed = k.t
		end
	end
	if left and landed then airtime = landed - left end
	local dist = 0
	if landed then
		for _, k in ipairs(s) do
			if k.t <= landed then
				local flat = (Vector3.new(k.p.X, 0, k.p.Z) - Vector3.new(p0.X, 0, p0.Z)).Magnitude
				if flat > dist then dist = flat end
			end
		end
	end
	return apex, airtime, dist
end

local function measureAutoStep(hum, root, steps)
	local best = 0
	for _, entry in ipairs(steps) do
		local h, part = entry.h, entry.part
		root.CFrame = CFrame.new(part.Position - Vector3.new(0, 0, 12) + Vector3.new(0, 4, 0))
		task.wait(0.8)
		local before = root.Position.Y
		hum.WalkSpeed = 16
		hum:Move(Vector3.new(0, 0, 1), false)
		task.wait(1.6)
		hum:Move(Vector3.zero, false)
		local climbed = root.Position.Y - before
		-- Did we actually end up ON the step rather than nudged up against it?
		if climbed > h * 0.6 then
			best = math.max(best, h)
			log(string.format("step %.1f: CLIMBED (+%.2f)", h, climbed))
		else
			log(string.format("step %.1f: blocked (+%.2f)", h, climbed))
		end
	end
	return best
end

task.wait(2)
local char, hum, root = waitForCharacter()
if not hum then
	warn("[mapcal] no Humanoid, aborting")
	return
end

log("building rig")
local rig = Instance.new("Folder")
rig.Name = "__MapCalRig"
rig.Parent = workspace

local pad = makePart("Pad", Vector3.new(120, 4, 120), RIG_ORIGIN, rig)
local steps = {}
local sx = -50
for _, h in ipairs(STEP_HEIGHTS) do
	local p = makePart(string.format("Step%.1f", h), Vector3.new(14, h, 14),
		RIG_ORIGIN + Vector3.new(sx, 2 + h / 2, 20), rig)
	table.insert(steps, { h = h, part = p })
	sx = sx + 18
end

local home = root.CFrame
local oldSpeed, oldAuto = hum.WalkSpeed, hum.AutoRotate
hum.AutoRotate = false

log("measuring jumps")
local apexStill, airStill = measureJump(hum, root, pad, 0)
local _, _, distWalk = measureJump(hum, root, pad, 16)
local _, _, distSprint = measureJump(hum, root, pad, 24)

log("measuring auto-step")
local autoStep = measureAutoStep(hum, root, steps)

local head = char:FindFirstChild("Head")
local hrp = root
local charHeight = 0
for _, p in ipairs(char:GetDescendants()) do
	if p:IsA("BasePart") then
		charHeight = math.max(charHeight, (p.Position.Y - root.Position.Y) + p.Size.Y / 2)
	end
end
charHeight = charHeight + hum.HipHeight + root.Size.Y / 2

local result = {
	gravity = workspace.Gravity,
	jumpPower = hum.UseJumpPower and hum.JumpPower or nil,
	jumpHeight = (not hum.UseJumpPower) and hum.JumpHeight or nil,
	walkSpeed = oldSpeed,
	maxWalkSlope = hum.MaxSlopeAngle,
	hipHeight = hum.HipHeight,
	measuredJumpApex = apexStill,
	measuredJumpAirtime = airStill,
	measuredJumpDistanceWalk = distWalk,
	measuredJumpDistanceSprint = distSprint,
	measuredAutoStep = autoStep,
	charHeight = charHeight,
	eyeHeight = head and (head.Position.Y - root.Position.Y + root.Size.Y / 2 + hum.HipHeight) or nil,
}

-- restore
hum.WalkSpeed = oldSpeed
hum.AutoRotate = oldAuto
root.CFrame = home
rig:Destroy()

local parts = {}
for k, v in pairs(result) do
	table.insert(parts, string.format('"%s":%s', k, tostring(v)))
end
table.sort(parts)
print("MAPCAL|{" .. table.concat(parts, ",") .. "}")
log("CALIBRATION COMPLETE")
log("ragdollRecovery is NOT measured here: it belongs to this game's own")
log("ragdoll code, so time it by hand (punt yourself off an edge and measure")
log("from the hit to the frame you regain control) and set it in the profile.")
