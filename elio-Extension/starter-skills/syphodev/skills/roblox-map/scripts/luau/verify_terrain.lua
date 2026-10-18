--!nonstrict
-- roblox-map: verify BUILT terrain against the served heightfield, by numbers.
--
-- Needs no screenshot, so it works while Studio is a background window (edit
-- viewport captures are stale then - measured 2026-09-15). Samples a grid of
-- columns across the map, reads the voxels, recovers the surface height from
-- occupancy, and compares it with the heightfield chunk the builder was fed.
-- Also checks: sea columns hold water below the tide line, and each cave's
-- midpoint is Air (i.e. the carve happened).
--
-- Run AFTER build_terrain.lua reports BuildDone. {port} is the serve_map port.

local HttpService = game:GetService("HttpService")
local T = workspace.Terrain
local BASE = "http://127.0.0.1:{port}"
local V = 4

if T:GetAttribute("BuildRunning") then
	return "build still running (" .. tostring(T:GetAttribute("BuildProgress")) .. "%)"
end
if (T:GetAttribute("BuildError") or "") ~= "" then
	return "BUILD FAILED: " .. T:GetAttribute("BuildError")
end

local meta = HttpService:JSONDecode(HttpService:GetAsync(BASE .. "/terrain/meta.json"))
local g, CH, LIFT = meta.grid, meta.chunk, meta.lift
local cache = {}
local function served(ix, iz)
	local cx, cz = ix // CH, iz // CH
	local key = cx .. "_" .. cz
	if not cache[key] then
		cache[key] = buffer.fromstring(HttpService:GetAsync(("%s/terrain/chunk/%s.bin"):format(BASE, key)))
	end
	local nx = math.min(CH, g.nx - cx * CH)
	local i = (iz - cz * CH) * nx + (ix - cx * CH)
	return buffer.readu16(cache[key], i * 3) / 8 - 512
end

local function builtSurface(x, z)
	local lo, hi = meta.seaFloorMin + LIFT - 12, 460
	local region = Region3.new(Vector3.new(x, lo, z), Vector3.new(x + V, hi, z + V)):ExpandToGrid(V)
	local mats, occs = T:ReadVoxels(region, V)
	local col = occs[1]
	local top, water = nil, false
	local y0 = region.CFrame.Position.Y - region.Size.Y / 2
	for iy = #col, 1, -1 do
		local m = mats[1][iy][1]
		local o = col[iy][1]
		if m == Enum.Material.Water then
			water = true
		elseif m ~= Enum.Material.Air and o > 0 then
			top = y0 + (iy - 1) * V + o * V
			break
		end
	end
	return top, water
end

local STEP = 24 -- sample every 24th column each way
local n, bad, worst, worstAt = 0, 0, 0, ""
local seaDry = 0
local low = T:GetAttribute("TideLevel") or meta.tide.high
for iz = 0, g.nz - 1, STEP do
	for ix = 0, g.nx - 1, STEP do
		local x = g.x0 + ix * V
		local z = g.z0 + iz * V
		local want = served(ix, iz)
		local got, water = builtSurface(x, z)
		if got then
			n += 1
			local err = math.abs((got - LIFT) - want)
			if err > worst then
				worst = err
				worstAt = ("(%d, %d) served %.1f built %.1f"):format(x, z, want, got - LIFT)
			end
			if err > 2.5 then
				bad += 1
			end
			if want < low - 4 and not water then
				seaDry += 1
			end
		end
	end
	task.wait()
end

local caveRows = {}
for _, c in ipairs(meta.caves or {}) do
	local mid = c.points[math.max(1, #c.points // 2)]
	local p = Vector3.new(mid[1], mid[2] + LIFT, mid[3])
	local r = Region3.new(p - Vector3.new(2, 2, 2), p + Vector3.new(2, 2, 2)):ExpandToGrid(V)
	local mats = T:ReadVoxels(r, V)
	local m = mats[1][1][1]
	table.insert(caveRows, ("%s midpoint %s"):format(c.name,
		(m == Enum.Material.Air or m == Enum.Material.Water) and "carved (" .. m.Name .. ")" or "SOLID " .. m.Name))
end

return ("%d columns sampled: %d off by more than 2.5 studs, worst %.2f at %s | %d deep-sea columns with no water | caves: %s"):format(
	n, bad, worst, worstAt, seaDry, table.concat(caveRows, "; "))
