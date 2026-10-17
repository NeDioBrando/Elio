--!nonstrict
-- ul-map-builder runtime: the tide. Server Script, installed by the map build.
--
-- The water rises and falls between Terrain attributes TideLow and TideHigh
-- (written by build_terrain.lua), one 4-stud voxel band at a time, over
-- TidePeriod seconds. A band is flooded with ReplaceMaterial(Air -> Water) and
-- drained with ReplaceMaterial(Water -> Air), chunk by chunk across a few frames
-- so the server never hitches on one giant region.
--
-- TIDE GATES make "only reachable at low tide" true for swimmers too, not just
-- walkers. Every Part tagged "TideGate" is an invisible, non-colliding volume;
-- at high tide it becomes an undertow that shoves anyone in it back out along
-- the gate's LookVector. checks_terrain.py T4 proves the map with exactly this
-- rule: at high tide nobody can ENTER a gate cell from outside it.
--
-- State is published for clients and gameplay: workspace attribute TideState
-- ("low" / "rising" / "high" / "falling") and TideLevel (studs, lift excluded).

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local T = workspace.Terrain

local V = 4
local low = T:GetAttribute("TideLow")
local high = T:GetAttribute("TideHigh")
local lift = T:GetAttribute("Lift") or 8
if not (low and high) then
	warn("[tide] TideLow/TideHigh missing on Terrain - was the terrain built?")
	return
end
local period = workspace:GetAttribute("TidePeriod") or 480
local hold = period * 0.25 -- seconds spent at slack water each end
local CH = 256

local extent = workspace:GetAttribute("TerrainExtent") or 2048
local level = T:GetAttribute("TideLevel") or high

local function band(y0, from, to)
	local half = extent / 2
	for z = -half, half - 1, CH do
		for x = -half, half - 1, CH do
			local r = Region3.new(Vector3.new(x, y0, z), Vector3.new(x + CH, y0 + V, z + CH))
			T:ReplaceMaterial(r:ExpandToGrid(V), V, from, to)
		end
		task.wait()
	end
end

local function setState(s)
	workspace:SetAttribute("TideState", s)
	workspace:SetAttribute("TideLevel", level)
	-- the horizon ocean (horizon_ocean.lua) follows the terrain water
	for _, p in ipairs(CollectionService:GetTagged("HorizonOcean")) do
		local pos = p.Position
		p.Position = Vector3.new(pos.X, level + lift + (p:GetAttribute("SurfaceOffset") or -0.6), pos.Z)
	end
end

-- undertow at high tide.
-- A gate is a DISC (a cylinder Part, axis up): anyone inside it is pushed
-- radially OUTWARD from its centre, which is what "you cannot get in at high
-- tide" means for a temple islet ringed by water. The first version pushed
-- along one fixed LookVector, which on a ring gate would have dragged a swimmer
-- on the far side straight INTO the gated zone. A gate may instead set the
-- attribute Directional=true to push along its LookVector (a channel).
local UNDERTOW = 60
RunService.Heartbeat:Connect(function()
	if workspace:GetAttribute("TideState") ~= "high" then
		return
	end
	for _, gate in ipairs(CollectionService:GetTagged("TideGate")) do
		local c = gate.Position
		local radius = math.max(gate.Size.X, gate.Size.Z) / 2
		local halfH = gate.Size.Y / 2
		for _, plr in ipairs(Players:GetPlayers()) do
			local root = plr.Character and plr.Character:FindFirstChild("HumanoidRootPart")
			if root then
				local d = root.Position - c
				local flat = Vector3.new(d.X, 0, d.Z)
				if flat.Magnitude <= radius and math.abs(d.Y) <= halfH then
					local dir
					if gate:GetAttribute("Directional") then
						dir = gate.CFrame.LookVector
					else
						dir = flat.Magnitude > 0.1 and flat.Unit or Vector3.new(1, 0, 0)
					end
					root.AssemblyLinearVelocity = dir * UNDERTOW + Vector3.new(0, 4, 0)
				end
			end
		end
	end
end)

setState(level >= high and "high" or "low")
local steps = math.floor((high - low) / V)
local stepTime = (period / 2 - hold) / math.max(steps, 1)
while true do
	task.wait(hold)
	setState("falling")
	for _ = 1, steps do
		level -= V
		band(level + lift, Enum.Material.Water, Enum.Material.Air)
		setState("falling")
		task.wait(stepTime)
	end
	setState("low")
	task.wait(hold)
	setState("rising")
	for _ = 1, steps do
		band(level + lift, Enum.Material.Air, Enum.Material.Water)
		level += V
		setState("rising")
		task.wait(stepTime)
	end
	setState("high")
end
