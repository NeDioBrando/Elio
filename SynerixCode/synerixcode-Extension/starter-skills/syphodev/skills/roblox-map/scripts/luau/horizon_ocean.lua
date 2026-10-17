--!nonstrict
-- roblox-map: the HORIZON OCEAN beyond the terrain's edge.
--
-- Terrain water stops where the heightfield stops, and from any wide shot the
-- sea read as a floating square slab. Two fixes were tried, both measured on an
-- island map:
--
--   1. FOUR PART SLABS in the water colour, moved with the tide. REJECTED: a Part
--      never shades like terrain water (no fresnel, no waves, different haze), so
--      at the horizon they read as separate lighter panels floating above the sea
--      line with visible edges - and they were CanQuery=false, so the rendered-
--      colour classifier could not even see them to match them.
--   2. A RING OF TERRAIN WATER out to `OUTER`, only as deep as the tide range plus
--      a margin, over a thin dark Basalt floor so it reads as deep ocean rather
--      than a shallow lagoon. It IS water, so it matches by construction, and the
--      tide script moves it because TerrainExtent is widened to cover it.
--
-- It costs voxels, so the build reports TerrainVoxels memory before and after -
-- the map must stay optimised. Runs in the background; poll RingDone.

local T = workspace.Terrain
local Stats = game:GetService("Stats")
local INNER, OUTER, STEP = 1024, 2560, 512

local lift = T:GetAttribute("Lift") or 8
local low, high = T:GetAttribute("TideLow") or 28, T:GetAttribute("TideHigh") or 44
local before = Stats:GetMemoryUsageMbForTag(Enum.DeveloperMemoryTag.TerrainVoxels)
T:SetAttribute("RingRunning", true)
T:SetAttribute("RingDone", false)

task.spawn(function()
	local ok, err = pcall(function()
		local waterTop = high + lift
		local waterBottom = low + lift - 12
		local floorBottom = waterBottom - 8
		local n = 0
		for z = -OUTER, OUTER - 1, STEP do
			for x = -OUTER, OUTER - 1, STEP do
				if not (x >= -INNER and x + STEP <= INNER and z >= -INNER and z + STEP <= INNER) then
					local cx, cz = x + STEP / 2, z + STEP / 2
					T:FillBlock(CFrame.new(cx, (floorBottom + waterBottom) / 2, cz),
						Vector3.new(STEP, waterBottom - floorBottom, STEP), Enum.Material.Basalt)
					T:FillBlock(CFrame.new(cx, (waterBottom + waterTop) / 2, cz),
						Vector3.new(STEP, waterTop - waterBottom, STEP), Enum.Material.Water)
					n += 1
					task.wait()
				end
			end
		end
		T:SetAttribute("RingBlocks", n)
	end)
	T:SetAttribute("RingError", ok and "" or tostring(err))
	workspace:SetAttribute("TerrainExtent", OUTER * 2)
	T:SetAttribute("RingMemoryBefore", before)
	T:SetAttribute("RingMemoryAfter", Stats:GetMemoryUsageMbForTag(Enum.DeveloperMemoryTag.TerrainVoxels))
	T:SetAttribute("RingRunning", false)
	T:SetAttribute("RingDone", true)
end)

return ("water ring to %d studs started; terrain voxel memory before %.1f MB"):format(OUTER, before)
