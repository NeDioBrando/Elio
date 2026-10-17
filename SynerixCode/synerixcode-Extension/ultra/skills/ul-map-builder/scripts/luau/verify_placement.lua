--!nonstrict
-- ul-map-builder: prove every instance is where the spec says it is.
--
-- prove.py checks the SPEC. verify_build.lua checks the place is well formed.
-- Neither compares the two. This does: it re-fetches the payload the map was
-- built from and diffs every instance against it, so a placement bug cannot
-- hide behind a screenshot taken from a flattering angle.
--
-- MESHES ARE THE REASON THIS EXISTS. A Part is placed by CFrame and is either
-- right or catastrophically wrong. A Model is placed by its PIVOT, and a
-- Model's pivot is its bounding-box centre ONLY while it has no PrimaryPart -
-- set one and the pivot silently becomes that part's centre instead, so every
-- placement shifts by however far that part sits from the middle. Nothing
-- errors. The props just sit wrong.
--
-- Set PORT to the serve_map.py port the map was built from. The map is found
-- by the name in the payload it was built from, so this cannot be aimed at a
-- map that no longer exists (see verify_build.lua). MAP overrides it.

local PORT = "8787"
local MAP = nil           -- set only to override the payload's map name
local TOL = 0.06          -- studs; anything under this is float noise

local HttpService = game:GetService("HttpService")
local ok, body = pcall(function()
	return HttpService:GetAsync("http://127.0.0.1:" .. PORT .. "/map.json")
end)
if not ok then return "[ERROR] cannot reach the map server on " .. PORT end
local data = HttpService:JSONDecode(body)
MAP = MAP or data.name
local root = workspace:FindFirstChild(MAP)
if not root then return "[ERROR] " .. tostring(MAP) .. " not in Workspace" end
local LIFT = data.lift or 0

-- index every instance by name once
local byName = {}
for _, d in ipairs(root:GetDescendants()) do
	if d:IsA("BasePart") or d:IsA("Model") then byName[d.Name] = d end
end

local checked, missing, bad = 0, 0, 0
local worst = {}

local function record(name, kind, dp, ds)
	table.insert(worst, {name = name, kind = kind, dp = dp, ds = ds})
end

for _, p in ipairs(data.parts) do
	local name = p[1]
	local inst = byName[name]
	if not inst then
		missing = missing + 1
		if missing <= 6 then record(name, "MISSING", 0, 0) end
	else
		checked = checked + 1
		local isMesh = p[19] ~= ""
		local wantPos, gotPos, wantSize, gotSize

		if isMesh then
			-- compare the BOUNDING BOX, not the pivot: the spec places a prop by
			-- its footprint on the ground, which is what a player sees.
			local cf, size = inst:GetBoundingBox()
			local groundY = p[6] - p[3] / 2 + LIFT
			wantPos = Vector3.new(p[5], groundY + size.Y / 2, p[7])
			gotPos = cf.Position
			local s = p[20] or 1
			wantSize = Vector3.new(p[2], p[3], p[4])
			gotSize = size
		else
			wantPos = Vector3.new(p[5], p[6] + LIFT, p[7])
			gotPos = inst.Position
			wantSize = Vector3.new(p[2], p[3], p[4])
			gotSize = inst.Size
		end

		local dp = (wantPos - gotPos).Magnitude
		local ds = isMesh and 0 or (wantSize - gotSize).Magnitude
		if dp > TOL or ds > TOL then
			bad = bad + 1
			record(name, isMesh and "mesh" or "part", dp, ds)
		end
	end
end

table.sort(worst, function(a, b) return a.dp > b.dp end)
local lines = {}
for i = 1, math.min(#worst, 10) do
	local w = worst[i]
	table.insert(lines, string.format("  %-34s %-7s dPos=%.2f dSize=%.2f",
		w.name, w.kind, w.dp, w.ds))
end

return string.format(
	"%s | expected=%d checked=%d missing=%d MISPLACED=%d (tolerance %.2f studs)\n%s",
	MAP, #data.parts, checked, missing, bad, TOL,
	#lines > 0 and table.concat(lines, "\n") or "  all instances within tolerance")
