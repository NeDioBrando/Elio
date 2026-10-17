-- VFXSelfTest - TEMPORARY LocalScript, installed only to verify a playtest.
--
-- capture_screenshot is EDIT MODE ONLY and execute_luau reaches only the edit
-- DataModel, so the running game cannot be inspected or photographed from the
-- MCP at all. LogService output is the one channel that does come back. So this
-- fires every effect in turn and prints what actually got built - which checks
-- the things most likely to be wrong in game and were never exercised on the
-- stage: anchors resolving against a real (R15) character, the warp moving the
-- player, and the character being put back afterwards.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local char = player.Character or player.CharacterAdded:Wait()
local hrp = char:WaitForChild("HumanoidRootPart", 10)
task.wait(2)

local ok, Scenes = pcall(require, ReplicatedStorage:WaitForChild("VFXScenes", 10))
if not ok then
	warn("VFXSELFTEST FAIL require: " .. tostring(Scenes))
	return
end
print(("VFXSELFTEST rig=%s effects=%d"):format(
	char:FindFirstChild("UpperTorso") and "R15" or "R6", #Scenes.names))

-- what the character looked like before anything touched it
local before = {}
for _, d in ipairs(char:GetDescendants()) do
	if d:IsA("BasePart") then before[d.Name] = d.Transparency end
end

local function census()
	local root = workspace:FindFirstChild("__VFX")
	local parts, emitters, lights, trails, beams = 0, 0, 0, 0, 0
	if root then
		for _, d in ipairs(root:GetDescendants()) do
			if d:IsA("BasePart") then parts = parts + 1
			elseif d:IsA("ParticleEmitter") then emitters = emitters + 1
			elseif d:IsA("PointLight") then lights = lights + 1
			elseif d:IsA("Trail") then trails = trails + 1
			elseif d:IsA("Beam") then beams = beams + 1 end
		end
	end
	return parts, emitters, lights, trails, beams
end

for i, name in ipairs(Scenes.names) do
	local posBefore = hrp.Position
	local okPlay, err = pcall(function() return Scenes.play(name) end)
	if not okPlay then
		warn(("VFXSELFTEST %d %-16s THREW: %s"):format(i, name, tostring(err)))
	else
		task.wait(0.7)
		local parts, emitters, lights, trails, beams = census()
		local moved = (hrp.Position - posBefore).Magnitude
		print(("VFXSELFTEST %d %-16s parts=%-4d emitters=%-3d lights=%d trails=%d beams=%d moved=%.1f")
			:format(i, name, parts, emitters, lights, trails, beams, moved))
		if parts + emitters == 0 then
			warn(("VFXSELFTEST %d %s BUILT NOTHING"):format(i, name))
		end
	end
	task.wait(2.2)
end

Scenes.stop()
task.wait(0.6)

-- The worst possible bug here is not an ugly effect, it is a player left
-- half-invisible for the rest of the round.
local bad = {}
for _, d in ipairs(char:GetDescendants()) do
	if d:IsA("BasePart") and before[d.Name] then
		if math.abs(d.Transparency - before[d.Name]) > 0.01 then
			table.insert(bad, ("%s %.2f->%.2f"):format(d.Name, before[d.Name], d.Transparency))
		end
	end
end
local parts, emitters = census()
if #bad > 0 then
	warn("VFXSELFTEST CHARACTER NOT RESTORED: " .. table.concat(bad, ", "))
else
	print("VFXSELFTEST character restored OK")
end
print(("VFXSELFTEST cleanup: %d parts %d emitters left behind"):format(parts, emitters))
print("VFXSELFTEST DONE")
