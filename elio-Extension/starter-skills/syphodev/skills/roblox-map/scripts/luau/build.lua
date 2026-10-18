--!nonstrict
-- roblox-map: build a served map into Workspace.
--
-- THIS FILE IS THE BUILDER. For most of this skill's life it was not a file at
-- all - it was typed inline into execute_luau, so the version committed to
-- serve_map.py was a stale stub that could not place a mesh, fill water, or
-- make a folder. A skill whose real builder lives only in a chat transcript is
-- not a skill. Everything the map needs is now here.
--
-- Reads http://127.0.0.1:{port}/map.json, which carries the geometry, the theme
-- palette and the asset ids, so nothing is hardcoded per map.
--
-- FOUR TRAPS, each of which shipped a broken map before it was understood:
--
--  1. A Model's pivot is its bounding-box centre ONLY while PrimaryPart is nil.
--     Setting one moved 176 props by up to 16 studs with nothing erroring. So
--     every asset gets PrimaryPart cleared, and placement measures the box
--     rather than trusting the pivot.
--  2. Terrain quantises to a 4-STUD VOXEL GRID, so a small lift is rounded away
--     and water lands back on the y=0 editor grid. LIFT must exceed 4.
--  3. FillCylinder aligns to CFrame UP - so it needs NO rotation for a flat
--     pond - while a Part of Shape Cylinder aligns to its X axis and needs a
--     90 degree roll. They disagree, and applying the Part fix to the terrain
--     call stands the lake on its edge. A Ball takes the SMALLEST extent as
--     its diameter.
--  4. Role names contain underscores (stone_light). Matching "__(%a+)" stops
--     at the underscore, the palette lookup misses SILENTLY, and the mesh keeps
--     Roblox default grey. That shipped 361 grey parts.

local HttpService = game:GetService("HttpService")
local InsertService = game:GetService("InsertService")
local MaterialService = game:GetService("MaterialService")
local ServerStorage = game:GetService("ServerStorage")
local T = workspace.Terrain

local data = HttpService:JSONDecode(HttpService:GetAsync("http://127.0.0.1:{port}/map.json"))
local LIFT = data.lift or 8.0
if LIFT <= 4.0 then
	warn("[build] lift " .. LIFT .. " is inside one terrain voxel - water will "
		.. "land on the y=0 grid. Use a multiple of 4 above 4.")
end

-- ---------------------------------------------------------------- palette ---
local PAL, MAT = {}, {}
for role, v in pairs(data.palette or {}) do
	PAL[role] = Color3.fromRGB(v.r, v.g, v.b)
	MAT[role] = Enum.Material[v.material] or Enum.Material.SmoothPlastic
end

-- role from a Blender object name like cottage_mesh__stone_light.
-- The character class MUST include underscore. See trap 4.
local function roleOf(name)
	return string.match(name, "__([%a_]+)")
end

-- ------------------------------------------------------------- collision ---
-- MESH PROPS MUST COLLIDE. Every asset was cached with CanCollide = false -
-- correct for the ground clutter it was written for, catastrophic for
-- everything else - so a player walked through trees, houses, market stalls
-- and the entire boundary cliff. Nothing errored and nothing looked wrong;
-- it is only discoverable by walking into something.
--
-- This is a HARD RULE, not a spec option: a mesh collides unless it is one of
-- the flat or fragile things a player is meant to walk over. Getting this
-- wrong in the permissive direction makes a map unplayable, and getting it
-- wrong in the strict direction makes a player trip on a lilypad, so the
-- default is ON and the exceptions are named.
local WALK_THROUGH = {
	lilypad = true,     -- floats; walking over it is the point
	veg_patch = true,   -- ankle height, and players farm on top of it
	crop = true,
	grass = true,
	flower = true,
}

local function collidesFor(asset)
	return not WALK_THROUGH[asset]
end

-- ----------------------------------------------------------------- assets ---
-- The asset set names both the cache folder and the MaterialVariant prefix.
-- These were hardcoded to "farm", which quietly made the builder single-genre.
local SET = data.assetSet or "map"
local FOLDER = string.upper(string.sub(SET, 1, 1)) .. string.sub(SET, 2) .. "Assets"
local assets = ServerStorage:FindFirstChild(FOLDER)
if not assets then
	assets = Instance.new("Folder")
	assets.Name = FOLDER
	assets.Parent = ServerStorage
end
local nLoaded, unresolved = 0, {}
for name, id in pairs(data.assetIds or {}) do
	local have = assets:FindFirstChild(name)
	-- Reloading costs seconds per asset, so the cache is keyed on the exact id.
	-- Regenerating a mesh gives it a NEW id, which is what invalidates this.
	if not (have and have:GetAttribute("AssetId") == id) then
		if have then have:Destroy() end
		local ok, res = pcall(function() return InsertService:LoadAsset(id) end)
		if ok and res and res:GetChildren()[1] then
			local m = res:GetChildren()[1]
			m.Name = name
			m:SetAttribute("AssetId", id)
			for _, d in ipairs(m:GetDescendants()) do
				if d:IsA("BasePart") then
					d.Anchored = true
					-- Collision is set PER INSTANCE below, not here. The cache
					-- used to bake CanCollide = false onto every asset, which
					-- meant a player walked straight through every tree, house
					-- and cliff in the map.
					d.CanCollide = false
					local role = roleOf(d.Name)
					if role and PAL[role] then
						d.Color = PAL[role]
						d.Material = MAT[role]
					elseif role then
						table.insert(unresolved, name .. "." .. d.Name)
					end
				end
			end
			m.Parent = assets
			res:Destroy()
			nLoaded = nLoaded + 1
		else
			table.insert(unresolved, "LOAD FAILED " .. name)
		end
	end
end
-- trap 1: never let an asset carry a PrimaryPart.
for _, m in ipairs(assets:GetChildren()) do
	if m:IsA("Model") then m.PrimaryPart = nil end
end

-- --------------------------------------------------------------- the tree ---
-- A TERRAIN MAP'S GROUND IS BUILT BY build_terrain.lua, not here. Clearing it
-- here would wipe voxels that took minutes to write, so only a part map clears.
if not data.terrain then
	T:Clear()
end
local old = workspace:FindFirstChild(data.name)
if old then old:Destroy() end
local root = Instance.new("Model")
root.Name = data.name

local origin = Instance.new("Part")
origin.Name = "Origin"
origin.Size = Vector3.new(1, 1, 1)
origin.CFrame = CFrame.new(0, LIFT, 0)
origin.Anchored = true
origin.CanCollide = false
origin.Transparency = 1
origin.Parent = root

local folders = {}
local function folderFor(path)
	if folders[path] then return folders[path] end
	local parent = root
	for seg in string.gmatch(path, "[^/]+") do
		local nxt = parent:FindFirstChild(seg)
		if not nxt then
			nxt = Instance.new("Folder")
			nxt.Name = seg
			nxt.Parent = parent
		end
		parent = nxt
	end
	folders[path] = parent
	return parent
end

local nPart, nMesh, nRound, nWater, missing = 0, 0, 0, 0, {}
local nCollide = 0

for _, p in ipairs(data.parts) do
	local shape = p[22] or "block"
	if p[21] == 1 then
		-- ------------------------------------------------- terrain water ---
		local surf = LIFT - 0.15
		local rx, rz = p[2] / 2, p[4] / 2
		if p[23] == 1 then
			-- A single FillBlock is a rectangle, and a rectangle never reads as
			-- a lake. Ring of overlapping cylinders on a lobed outline, plus a
			-- filled centre.
			--
			-- NO ROTATION HERE, EVER. FillCylinder fills along the CFrame's UP
			-- vector, so an identity CFrame already gives the flat disc a pond
			-- needs. Adding CFrame.Angles(rad(90),0,0) - which is what a Part of
			-- Shape Cylinder would need - lays the pond on its side and builds a
			-- 60-stud vertical WALL of water. It looks almost right from above,
			-- which is why it survived; the terrain voxel scan is what caught it,
			-- reporting a water surface at y=32 instead of y=8.
			local lobes = math.max(3, p[24] or 7)
			local N = 26
			-- THE POND'S YAW MUST BE HONOURED HERE. This ignored p[8] while the
			-- kit that dresses the bank applied it, so on a 12 degree pond the
			-- two rings were rotated 12 degrees apart - and because the outline
			-- is lobed rather than circular, that put 35 rocks and bushes in the
			-- water and left the opposite bank bare. Both sides fill the same
			-- outline; both sides must use the same frame.
			local yr = math.rad(p[8])
			local yc, ys = math.cos(yr), math.sin(yr)
			local function frame(ox, oz)
				return p[5] + ox * yc + oz * ys, p[7] - ox * ys + oz * yc
			end
			for i = 0, N - 1 do
				local a = (i / N) * math.pi * 2
				local wob = 1.0 + 0.17 * math.sin(a * lobes + 0.7)
					+ 0.09 * math.sin(a * (lobes + 2) + 2.1)
				local cx, cz = frame(math.cos(a) * rx * 0.62 * wob,
					math.sin(a) * rz * 0.62 * wob)
				local rad = math.min(rx, rz) * 0.40 * wob
				T:FillCylinder(CFrame.new(cx, surf - 10.0, cz),
					9, rad + 5, Enum.Material.Rock)
				T:FillCylinder(CFrame.new(cx, surf - 2.6, cz),
					5.6, rad, Enum.Material.Water)
				nWater = nWater + 1
			end
			T:FillCylinder(CFrame.new(p[5], surf - 10.0, p[7]),
				9, math.min(rx, rz) * 0.95, Enum.Material.Rock)
			T:FillCylinder(CFrame.new(p[5], surf - 2.6, p[7]),
				5.6, math.min(rx, rz) * 0.80, Enum.Material.Water)
		else
			T:FillBlock(CFrame.new(p[5], surf - 10.0, p[7]),
				Vector3.new(p[2] + 14, 9, p[4] + 14), Enum.Material.Rock)
			T:FillBlock(CFrame.new(p[5], surf - 2.6, p[7]),
				Vector3.new(p[2], 5.6, p[4]), Enum.Material.Water)
			nWater = nWater + 1
		end

	elseif p[19] ~= "" then
		-- -------------------------------------------------------- a mesh ---
		local src = assets:FindFirstChild(p[19])
		if src then
			local inst = src:Clone()
			if (p[20] or 1) ~= 1 then inst:ScaleTo(p[20]) end
			inst:PivotTo(CFrame.Angles(0, math.rad(p[8]), 0))
			-- trap 1: measure, do not trust the pivot.
			local cf, size = inst:GetBoundingBox()
			inst:PivotTo(inst:GetPivot()
				+ (Vector3.new(p[5], p[6] - p[3] / 2 + LIFT + size.Y / 2, p[7]) - cf.Position))
			-- p[14] is the kit's own `solid` flag; WALK_THROUGH is the hard
			-- floor under it. A prop is collidable unless BOTH say otherwise.
			local collide = collidesFor(p[19]) and p[14] == 1
			for _, d in ipairs(inst:GetDescendants()) do
				if d:IsA("BasePart") then
					d.CanCollide = collide
					if collide and d:IsA("MeshPart") then
						-- Box is the cheap fidelity and is right for solid
						-- masses: cliffs, trunks, walls. Nothing here is a
						-- shape a player needs to walk inside.
						pcall(function()
							d.CollisionFidelity = Enum.CollisionFidelity.Box
						end)
					end
					if collide then nCollide = nCollide + 1 end
				end
			end
			inst.Name = p[1]
			inst.Parent = folderFor(p[17])
			nMesh = nMesh + 1
		else
			missing[p[19]] = (missing[p[19]] or 0) + 1
		end

	else
		-- -------------------------------------------------------- a part ---
		local inst = Instance.new(p[13] == 1 and "WedgePart" or "Part")
		inst.Name = p[1]
		local cf = CFrame.new(p[5], p[6] + LIFT, p[7]) * CFrame.Angles(0, math.rad(p[8]), 0)
		if shape == "cylinder" then
			-- trap 3: a Part cylinder runs along X, so roll it upright and swap.
			inst.Shape = Enum.PartType.Cylinder
			inst.Size = Vector3.new(p[3], p[2], p[4])
			inst.CFrame = cf * CFrame.Angles(0, 0, math.rad(90))
			nRound = nRound + 1
		elseif shape == "ball" then
			inst.Shape = Enum.PartType.Ball
			inst.Size = Vector3.new(p[2], p[3], p[4])
			inst.CFrame = cf
			nRound = nRound + 1
		else
			inst.Size = Vector3.new(p[2], p[3], p[4])
			inst.CFrame = cf
		end
		inst.Anchored = true
		inst.CanCollide = p[14] == 1
		inst.Transparency = p[15] == 1 and 0 or 1
		inst.Color = Color3.fromRGB(p[9], p[10], p[11])
		inst.Material = Enum.Material[p[12]]
		inst.CastShadow = p[16] == 1
		inst.TopSurface = Enum.SurfaceType.Smooth
		inst.BottomSurface = Enum.SurfaceType.Smooth
		inst:SetAttribute("ThemeRole", p[18])
		local variant = SET .. "_" .. tostring(p[18])
		if p[18] ~= "" and MaterialService:FindFirstChild(variant) then
			inst.Material = MAT[p[18]] or inst.Material
			inst.MaterialVariant = variant
		end
		inst.Parent = folderFor(p[17])
		nPart = nPart + 1
	end
end

local spawns = folderFor("Spawns")
for i, s in ipairs(data.spawns) do
	local sp = Instance.new("SpawnLocation")
	sp.Name = "Spawn" .. i
	sp.Size = Vector3.new(6, 1, 6)
	sp.CFrame = CFrame.new(s[1], s[2] + 0.5 + LIFT, s[3])
	sp.Anchored = true
	sp.CanCollide = false
	sp.Transparency = 1
	sp.Neutral = true
	sp.Parent = spawns
end

local kp = Instance.new("Part")
kp.Name = "KillPlane"
kp.Size = Vector3.new(data.killSize[1], 1, data.killSize[2])
kp.CFrame = CFrame.new(0, data.killPlane + LIFT, 0)
kp.Anchored = true
kp.CanCollide = false
kp.Transparency = 1
kp:SetAttribute("RingOutOffset", data.ringOutOffset)
game:GetService("CollectionService"):AddTag(kp, "KillPlane")
kp.Parent = root

-- Stamp the palette's role list on the map. verify_build.lua needs to know
-- which roles are legitimate, and its first attempt inferred them from the
-- ThemeRole attributes on PARTS - which reported 216 false positives, because
-- meshes use roles (foliage, thatch) that no part happens to carry. The palette
-- is the authority, so the builder records it rather than leaving the verifier
-- to guess.
do
	local roles = {}
	for role in pairs(PAL) do table.insert(roles, role) end
	table.sort(roles)
	root:SetAttribute("ThemeRoles", table.concat(roles, ","))
end

root.PrimaryPart = origin
root.Parent = workspace

-- THE PLACE'S OWN TEMPLATE SPAWN AND BASEPLATE GO. A new place ships a
-- SpawnLocation at (0, 0.5, 0) and a Baseplate whose top face is y=0. On an
-- island map that template spawn sat 85 studs inside the ground and was the only
-- spawn after the whole map was built; the Baseplate z-fights any surface at
-- y=0. A generated map brings its own ground and its own spawns.
local nRemoved = 0
for _, d in ipairs(workspace:GetDescendants()) do
	if d:IsA("SpawnLocation") and not d:IsDescendantOf(root) and d.Parent then
		d:Destroy()
		nRemoved = nRemoved + 1
	end
end
local baseplate = workspace:FindFirstChild("Baseplate")
if baseplate and baseplate:IsA("BasePart") then
	baseplate:Destroy()
	nRemoved = nRemoved + 1
end

T.WaterColor = Color3.fromRGB(58, 128, 122)
T.WaterTransparency = 0.62
T.WaterReflectance = 0.28
T.WaterWaveSize = 0.06
T.WaterWaveSpeed = 6

-- ------------------------------------------------------ ambient wiring ---
-- ambient.lua was written, committed, and then never installed, so for several
-- rounds the map had a motion system and no motion. Tagging is part of the
-- BUILD, not a separate step someone has to remember.
--
-- Restraint is deliberate. Swaying 300 trees is 300 Heartbeat connections for
-- an effect nobody looks at; a turning windmill is one connection and is the
-- first thing anybody notices. Motion goes on the landmark, not on the grass.
local CollectionService = game:GetService("CollectionService")
local nTag = 0

-- A windmill's sails are separate parts, so they are grouped into a rotor
-- Model first - ambient.spin welds a Model to its PrimaryPart and turns that.
-- The rotor spans X and Y and is thin in Z, so the spin axis is Z (the default).
for _, folder in ipairs(root:GetDescendants()) do
	if folder:IsA("Folder") then
		local hub, moving = nil, {}
		for _, d in ipairs(folder:GetChildren()) do
			if d:IsA("BasePart") then
				local n = string.lower(d.Name)
				if string.find(n, "_hub") then
					hub = d
					table.insert(moving, d)
				elseif string.find(n, "_sail") or string.find(n, "_arm") then
					table.insert(moving, d)
				end
			end
		end
		if hub and #moving > 2 then
			local rotor = Instance.new("Model")
			rotor.Name = folder.Name .. "_Rotor"
			rotor.Parent = folder
			for _, d in ipairs(moving) do d.Parent = rotor end
			rotor.PrimaryPart = hub
			rotor:SetAttribute("SpinSpeed", 11)
			CollectionService:AddTag(rotor, "AmbientSpin")
			nTag = nTag + 1
		end
	end
end

-- Only the OUTERMOST match. A mesh asset is a Model containing Models, so a
-- naive name match tagged 18 lilypads for 9 pads and would have tweened a model
-- inside an already-tweened model.
local function taggedAncestor(inst)
	local p = inst.Parent
	while p and p ~= root do
		if CollectionService:HasTag(p, "AmbientBob")
			or CollectionService:HasTag(p, "AmbientSpin") then return true end
		p = p.Parent
	end
	return false
end

for _, d in ipairs(root:GetDescendants()) do
	if d:IsA("Model") and string.find(string.lower(d.Name), "lilypad")
		and not taggedAncestor(d) then
		d:SetAttribute("BobAmplitude", 0.18)
		d:SetAttribute("BobPeriod", 5.2)
		CollectionService:AddTag(d, "AmbientBob")
		nTag = nTag + 1
	elseif d:IsA("BasePart") and d.Material == Enum.Material.Neon then
		CollectionService:AddTag(d, "AmbientPulse")
		nTag = nTag + 1
	end
end

-- and install the runtime, so a built map is an ANIMATED map with no follow-up.
do
	local sss = game:GetService("ServerScriptService")
	local prev = sss:FindFirstChild("MapAmbient")
	if prev then prev:Destroy() end
	local src = HttpService:GetAsync("http://127.0.0.1:{port}/ambient.lua")
	local sc = Instance.new("Script")
	sc.Name = "MapAmbient"
	sc.Source = src
	sc.Parent = sss
end

local miss = {}
for k, v in pairs(missing) do table.insert(miss, k .. " x" .. v) end
return string.format(
	"%s | %d parts (%d round) + %d meshes (%d collidable parts) | %d water cells | %d assets loaded"
		.. " | %d template spawn/baseplate removed"
		.. "\n  unresolved mesh roles: %d%s\n  MISSING ASSETS: %s",
	data.name, nPart, nRound, nMesh, nCollide, nWater, nLoaded, nRemoved,
	#unresolved,
	#unresolved > 0 and (" -> " .. table.concat(unresolved, ", ", 1, math.min(6, #unresolved))) or "",
	#miss > 0 and table.concat(miss, ", ") or "none")
