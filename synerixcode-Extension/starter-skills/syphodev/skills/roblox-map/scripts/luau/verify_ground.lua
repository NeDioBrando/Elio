--!nonstrict
-- roblox-map: prove nothing is sitting on or under the y=0 plane.
--
-- THIS CHECK EXISTS BECAUSE THE SAME BUG SHIPPED TWICE.
--
-- Studio draws its editor grid at exactly y=0. Anything whose surface lands
-- there gets the grid painted across it, which reads as a "weird square
-- pattern" in every screenshot. It is editor-only and never appears in a
-- published game, but it makes finished work look broken.
--
-- The first time, a 470-stud ground slab had its top at y=0. Fixed by lifting
-- the whole map 0.5 studs.
--
-- The second time, every PART was correctly above zero and the LAKE was not,
-- because TERRAIN QUANTISES TO A 4-STUD VOXEL GRID and rounded the 0.5 stud
-- lift away entirely. A part-only check would have passed. This one reads the
-- terrain voxels too.
--
-- RULE: volume.lift must exceed one terrain voxel (4 studs). Default is 6.
--
-- Run after every build. Set MAP, and give REGION a box around any water.

-- A VERIFIER MUST FIND ITS OWN TARGET.
--
-- This file used to open with a hardcoded map name. Every run against
-- any other map returned "not in Workspace" and was skipped - which is exactly
-- the failure the sibling file verify_build.lua was already fixed for, and the
-- one that let 361 default-grey parts ship underneath a green check. A verifier
-- that has to be configured before it works is one that will one day be run
-- unconfigured.
--
-- So it locates the map itself: the Workspace Model holding the most BaseParts.
-- That is the map on every layout this skill emits, and "no candidate at all"
-- is a FAILURE result rather than a quiet skip.
local T = workspace.Terrain

local root, rootCount = nil, 0
for _, child in ipairs(workspace:GetChildren()) do
	if child:IsA("Model") and not child:FindFirstChildOfClass("Humanoid") then
		local n = 0
		for _, d in ipairs(child:GetDescendants()) do
			if d:IsA("BasePart") then
				n += 1
			end
		end
		if n > rootCount then
			root, rootCount = child, n
		end
	end
end
if not root or rootCount < 10 then
	return "[ERROR] no map Model found in Workspace - nothing to verify, which is a FAILURE, not a pass"
end
local MAP = root.Name

local errors, msgs = 0, {}
local function err(s)
	errors = errors + 1
	if #msgs < 10 then table.insert(msgs, "[ERROR] " .. s) end
end

-- 1. visible parts
local lowest, lowestName = math.huge, ""
for _, d in ipairs(root:GetDescendants()) do
	if d:IsA("BasePart") and d.Transparency < 1 then
		local bottom = d.Position.Y - d.Size.Y / 2
		local top = d.Position.Y + d.Size.Y / 2
		if bottom < lowest then lowest, lowestName = bottom, d.Name end
		-- a SURFACE landing on the grid plane is the defect; something whose
		-- body passes through on its way down (a plinth, a post) is fine.
		if math.abs(top) < 0.25 then
			err(d.Name .. " has its top surface at y=" .. string.format("%.2f", top))
		end
	end
end

-- 2. terrain, which is where the second occurrence hid
local reg = Region3.new(Vector3.new(-260, -40, -260), Vector3.new(260, 40, 260)):ExpandToGrid(4)
local mats, occ = T:ReadVoxels(reg, 4)
local sz = mats.Size
local baseY = reg.CFrame.Position.Y - reg.Size.Y / 2
local topSolid, topWater = -math.huge, -math.huge
local lowWater = math.huge
for x = 1, sz.X do
	for y = 1, sz.Y do
		for z = 1, sz.Z do
			local m = mats[x][y][z]
			if m ~= Enum.Material.Air and occ[x][y][z] > 0.1 then
				local wy = baseY + y * 4          -- top of this voxel
				if m == Enum.Material.Water then
					if wy > topWater then topWater = wy end
				elseif wy > topSolid then topSolid = wy end
			end
		end
	end
end
-- A pond is a FLAT disc a few studs deep. If its voxels span more than about
-- 12 studs vertically it is not a pond, it is a cylinder standing on its edge -
-- which is what FillCylinder does the moment you rotate it, because it fills
-- along the CFrame UP vector and needs no rotation at all. That shipped a
-- 60-stud vertical wall of water that read as "roughly right" from above.
if topWater > -math.huge and (topWater - lowWater) > 12 then
	err(string.format("terrain water spans y=%.0f..%.0f (%.0f studs tall) - a "
		.. "pond is flat. FillCylinder fills along CFrame UP; do NOT rotate it.",
		lowWater, topWater, topWater - lowWater))
end
if topWater > -math.huge and topWater <= 0.25 then
	err(string.format("terrain WATER surface is at y=%.2f - on or under the "
		.. "editor grid. Terrain rounds to 4 studs, so lift must exceed 4.", topWater))
end
if topSolid > -math.huge and math.abs(topSolid) < 0.25 then
	err(string.format("terrain SOLID surface is at y=%.2f", topSolid))
end

return string.format(
	"%s | lowest visible part = %.2f (%s) | terrain water top = %s | terrain solid top = %s | errors = %d\n%s",
	MAP, lowest, lowestName,
	topWater > -math.huge and string.format("%.2f", topWater) or "none",
	topSolid > -math.huge and string.format("%.2f", topSolid) or "none",
	errors,
	#msgs > 0 and table.concat(msgs, "\n") or "  nothing sits on the y=0 plane")
