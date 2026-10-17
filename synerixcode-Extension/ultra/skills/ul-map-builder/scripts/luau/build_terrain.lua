--!nonstrict
-- ul-map-builder: build ORGANIC TERRAIN from a served heightfield.
--
-- Reads http://127.0.0.1:{port}/terrain/meta.json and one binary chunk per
-- 64x64 voxel columns from /terrain/chunk/<cx>_<cz>.bin (3 bytes per column:
-- uint16 height as (h + 512) * 8, then uint8 material index). Writes SMOOTH
-- voxel terrain with WriteVoxels: the top voxel of every column gets a partial
-- occupancy, which is what makes Roblox terrain smooth instead of stepped.
--
-- RUNS IN THE BACKGROUND. A 512x512-column map is tens of millions of voxel
-- writes, far longer than an execute_luau call is allowed to block (a long
-- capture sweep already timed the MCP out). So this spawns a worker and returns
-- at once; progress is on workspace.Terrain attributes BuildProgress / BuildDone
-- / BuildError. Poll those - never re-run the builder while one is going.
--
-- ORDER MATTERS: ground, then caves (Air), then water (Air -> Water only below
-- the tide line), so a carved cave below the tide floods and one above stays dry.
--
-- Terrain quantises to a 4-stud grid. Tide levels and the lift are multiples of
-- 4 by construction (terrain.py refuses anything else).

local HttpService = game:GetService("HttpService")
local T = workspace.Terrain
local BASE = "http://127.0.0.1:{port}"

if T:GetAttribute("BuildRunning") then
	return "a terrain build is already running - poll workspace.Terrain BuildProgress"
end

local meta = HttpService:JSONDecode(HttpService:GetAsync(BASE .. "/terrain/meta.json"))
local V = 4
local LIFT = meta.lift or 8
local g = meta.grid
local CH = meta.chunk
local MATS = {}
for i, name in ipairs(meta.materials) do
	MATS[i - 1] = Enum.Material[name]
end
local DEEP = Enum.Material[meta.deepMaterial or "Rock"]

T:SetAttribute("BuildRunning", true)
T:SetAttribute("BuildDone", false)
T:SetAttribute("BuildError", "")
T:SetAttribute("BuildProgress", 0)

task.spawn(function()
	local ok, err = pcall(function()
		if meta.clear then
			T:Clear()
		end
		local floorY = math.floor((meta.seaFloorMin + LIFT - 8) / V) * V
		local nChunks = meta.chunksX * meta.chunksZ
		local done = 0
		for cz = 0, meta.chunksZ - 1 do
			for cx = 0, meta.chunksX - 1 do
				local raw = HttpService:GetAsync(("%s/terrain/chunk/%d_%d.bin"):format(BASE, cx, cz))
				local buf = buffer.fromstring(raw)
				local nx = math.min(CH, g.nx - cx * CH)
				local nz = math.min(CH, g.nz - cz * CH)
				local heights, mats = table.create(nx * nz), table.create(nx * nz)
				local top = floorY
				for i = 0, nx * nz - 1 do
					local hv = buffer.readu16(buf, i * 3) / 8 - 512 + LIFT
					heights[i + 1] = hv
					mats[i + 1] = buffer.readu8(buf, i * 3 + 2)
					if hv > top then
						top = hv
					end
				end
				local ny = math.ceil((top - floorY) / V) + 1
				local occ, mat = table.create(nx), table.create(nx)
				for ix = 1, nx do
					local ocol, mcol = table.create(ny), table.create(ny)
					for iy = 1, ny do
						ocol[iy] = table.create(nz, 0)
						mcol[iy] = table.create(nz, Enum.Material.Air)
					end
					for iz = 1, nz do
						local k = (iz - 1) * nx + ix
						local hv = heights[k]
						local surface = MATS[mats[k]] or Enum.Material.Grass
						for iy = 1, ny do
							local y0 = floorY + (iy - 1) * V
							local o = (hv - y0) / V
							if o > 0 then
								if o > 1 then o = 1 end
								ocol[iy][iz] = o
								-- the top two voxels wear the surface; deeper is rock, so a
								-- carved cave has stone walls rather than grass
								mcol[iy][iz] = (hv - y0 <= V * 2) and surface or DEEP
							end
						end
					end
					occ[ix], mat[ix] = ocol, mcol
				end
				local x0 = g.x0 + cx * CH * V
				local z0 = g.z0 + cz * CH * V
				local region = Region3.new(Vector3.new(x0, floorY, z0),
					Vector3.new(x0 + nx * V, floorY + ny * V, z0 + nz * V))
				T:WriteVoxels(region, V, mat, occ)
				done += 1
				T:SetAttribute("BuildProgress", math.floor(done / nChunks * 80))
				task.wait()
			end
		end

		-- caves: carve with Air along each polyline
		for _, c in ipairs(meta.caves or {}) do
			local pts = c.points
			for i = 1, #pts - 1 do
				local a = Vector3.new(pts[i][1], pts[i][2] + LIFT, pts[i][3])
				local b = Vector3.new(pts[i + 1][1], pts[i + 1][2] + LIFT, pts[i + 1][3])
				local steps = math.max(1, math.ceil((b - a).Magnitude / (c.radius * 0.5)))
				for s = 0, steps do
					T:FillBall(a:Lerp(b, s / steps), c.radius, Enum.Material.Air)
				end
			end
			task.wait()
		end
		T:SetAttribute("BuildProgress", 88)

		-- water: fill EMPTY voxels below the current tide line, chunk by chunk
		local level = (meta.startTide == "low" and meta.tide.low or meta.tide.high) + LIFT
		local span = CH * V
		-- AN INLAND MAP HAS NO WATER. An inland arena map put the tide below every
		-- column, so floorY (from the lowest ground) sat ABOVE the tide line and the inverted
		-- region failed with "Region is too large" after the ground was already built.
		T:SetAttribute("WaterSkipped", level <= floorY)
		if level > floorY then
			for z = g.z0, g.z0 + g.nz * V - 1, span do
				for x = g.x0, g.x0 + g.nx * V - 1, span do
					local region = Region3.new(Vector3.new(x, floorY, z), Vector3.new(x + span, level, z + span))
					T:ReplaceMaterial(region:ExpandToGrid(V), V, Enum.Material.Air, Enum.Material.Water)
				end
				task.wait()
			end
		end
		T:SetAttribute("TideLevel", level - LIFT)
		T:SetAttribute("TideLow", meta.tide.low)
		T:SetAttribute("TideHigh", meta.tide.high)
		T:SetAttribute("Lift", LIFT)
		T:SetAttribute("BuildProgress", 100)
	end)
	if not ok then
		T:SetAttribute("BuildError", tostring(err))
	end
	T:SetAttribute("BuildDone", true)
	T:SetAttribute("BuildRunning", false)
end)

return ("terrain build started: %dx%d columns in %d chunks, tide %s-%s, lift %d. Poll workspace.Terrain BuildProgress."):format(
	g.nx, g.nz, meta.chunksX * meta.chunksZ, tostring(meta.tide.low), tostring(meta.tide.high), LIFT)
