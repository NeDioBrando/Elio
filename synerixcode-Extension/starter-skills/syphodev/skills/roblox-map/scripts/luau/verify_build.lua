--!nonstrict
-- roblox-map: verify what actually LANDED in Studio.
--
-- prove.py checks the SPEC. This checks the place. They are different
-- questions, and only this one catches a build that half-succeeded, a folder
-- that never got created, or a spawn hanging over the void.
--
-- WHY MAP IS AUTO-DETECTED. It used to be a constant at the top, set to
-- the name of one map. A later map had a different name, so every run of this file
-- returned "not found in Workspace" and was quietly skipped - while 361 mesh
-- parts sat in the map wearing Roblox default grey. The check for that defect
-- was already written, right here, and could not fire because the file was
-- aimed at a map that no longer existed.
--
-- A verifier that has to be configured before it works is a verifier that will
-- one day be run unconfigured. It now finds the map itself.

local FORCE = nil        -- set only to disambiguate several maps in Workspace

local function findMap()
	if FORCE then return workspace:FindFirstChild(FORCE) end
	local best, bestN = nil, -1
	for _, c in ipairs(workspace:GetChildren()) do
		if c:IsA("Model") and c:FindFirstChild("Origin") then
			local n = #c:GetDescendants()
			if n > bestN then best, bestN = c, n end
		end
	end
	return best
end

local root = findMap()
if not root then
	return "[ERROR] no map in Workspace (looked for a Model containing an Origin part)"
end
local MAP = root.Name

local errors, warns, parts, meshParts = 0, 0, 0, 0
local msgs = {}
local function err(s) errors = errors + 1 if #msgs < 24 then table.insert(msgs, "[ERROR] " .. s) end end
local function warn(s) warns = warns + 1 if #msgs < 24 then table.insert(msgs, "[WARN] " .. s) end end

local DEFAULT = Color3.fromRGB(163, 162, 165)
local minY, maxY = math.huge, -math.huge
local flat, grey, unresolved = 0, 0, 0
local greyEg, unresolvedEg = {}, {}

-- The theme roles a mesh may legitimately name. The builder stamps the
-- palette's own role list on the map root.
--
-- The first version of this inferred the list from the ThemeRole attributes on
-- PARTS and reported 216 false positives: meshes use roles (foliage, thatch)
-- that no part in this map happens to carry. A check that invents its own
-- reference data will eventually disagree with the real thing.
local known = {}
local stamped = root:GetAttribute("ThemeRoles")
if type(stamped) == "string" and stamped ~= "" then
	for role in string.gmatch(stamped, "[^,]+") do known[role] = true end
else
	warn("map has no ThemeRoles attribute - falling back to part attributes, "
		.. "which under-reports the palette")
	for _, d in ipairs(root:GetDescendants()) do
		local r = d:GetAttribute("ThemeRole")
		if type(r) == "string" and r ~= "" then known[r] = true end
	end
end

for _, d in ipairs(root:GetDescendants()) do
	if d:IsA("BasePart") then
		parts = parts + 1
		if not d.Anchored and d.Parent and not d.Parent:IsA("Model") then
			err(d:GetFullName() .. " is not Anchored")
		end
		if d.Parent == root and d.Name ~= "Origin" and d.Name ~= "KillPlane" then
			flat = flat + 1
		end

		-- INVISIBLE MARKERS ARE EXEMPT. The first run of this check reported 14
		-- warnings, every one a transparent Origin/KillPlane/SpawnLocation being
		-- told off for its colour. A default colour on something nobody can see
		-- is not a defect, and 14 false warnings hide the one real one.
		if d.Transparency < 1 then
			local isMesh = string.find(d.Name, "__") ~= nil
			if isMesh then meshParts = meshParts + 1 end

			-- GREY IS AN ERROR, NOT A WARNING, once it is more than a stray part.
			-- 361 grey parts was the defect a human found by looking; a warning
			-- buried in a list is not how that should surface.
			if d.Color == DEFAULT then
				grey = grey + 1
				if #greyEg < 4 then table.insert(greyEg, d.Name) end
			end

			-- A mesh part names its role in its own name (`cottage__stone_light`).
			-- If that role is not one the builder painted, the palette lookup
			-- missed and the part is wearing whatever Blender gave it.
			if isMesh then
				local role = string.match(d.Name, "__([%a_]+)")
				if role and not known[role] then
					unresolved = unresolved + 1
					if #unresolvedEg < 4 then table.insert(unresolvedEg, d.Name) end
				end
			elseif d:GetAttribute("ThemeRole") == nil then
				warn(d.Name .. " has no ThemeRole attribute")
			end

			minY = math.min(minY, d.Position.Y - d.Size.Y / 2)
			maxY = math.max(maxY, d.Position.Y + d.Size.Y / 2)
		end
	end
end

-- COLLISION. Every mesh asset was cached with CanCollide = false, so a player
-- walked through every tree, house, stall and cliff in the map. Nothing errored
-- and nothing looked wrong - it is only discoverable by walking into something,
-- which is exactly the kind of defect a check has to carry.
local WALK_THROUGH = {lilypad = true, veg_patch = true, crop = true,
                      grass = true, flower = true}
local ghost = {}
for _, d in ipairs(root:GetDescendants()) do
	if d:IsA("BasePart") and d.Transparency < 1 and not d.CanCollide then
		local asset = string.match(d.Name, "^([%a_]-)__")
		if asset and not WALK_THROUGH[asset] then
			ghost[asset] = (ghost[asset] or 0) + 1
		end
	end
end
local gn, gl = 0, {}
for k, v in pairs(ghost) do gn = gn + v table.insert(gl, k .. " x" .. v) end
if gn > 0 then
	err(gn .. " mesh part(s) have collision OFF and are not walk-through "
		.. "assets - a player passes straight through them (" .. table.concat(gl, ", ") .. ")")
end

if grey > 0 then
	local f = string.format("%d visible part(s) are Roblox default grey (%s)",
		grey, table.concat(greyEg, ", "))
	if grey > 2 then err(f .. " - the palette lookup is missing them") else warn(f) end
end
if unresolved > 0 then
	err(string.format("%d mesh part(s) name a role the builder never painted (%s)",
		unresolved, table.concat(unresolvedEg, ", ")))
end

for _, want in ipairs({"Origin", "Terrain", "Structures", "Landmarks", "Props", "Spawns"}) do
	if not root:FindFirstChild(want) then err("missing top-level folder: " .. want) end
end
if flat > 0 then
	err(flat .. " part(s) sit flat under the root instead of inside a zone folder")
end

local spawns = root:FindFirstChild("Spawns")
local nspawn = 0
if spawns then
	for _, s in ipairs(spawns:GetChildren()) do
		if s:IsA("SpawnLocation") then
			nspawn = nspawn + 1
			local rp = RaycastParams.new()
			rp.FilterDescendantsInstances = {root}
			rp.FilterType = Enum.RaycastFilterType.Include
			if not workspace:Raycast(s.Position + Vector3.new(0, 2, 0), Vector3.new(0, -12, 0), rp) then
				err(s.Name .. " has no ground beneath it")
			end
		end
	end
end
if nspawn == 0 then err("no SpawnLocation anywhere in the map") end

-- Lighting is part of the build and was silently skipped once, which is hard to
-- see in a screenshot because a lit-looking scene and a default-lit scene are
-- only a little different at midday.
local L = game:GetService("Lighting")
local nSky, nAtm = 0, 0
for _, e in ipairs(L:GetChildren()) do
	if e:IsA("Sky") then nSky = nSky + 1 elseif e:IsA("Atmosphere") then nAtm = nAtm + 1 end
end
if nSky == 0 then err("no Sky in Lighting - Atmosphere does nothing without one") end
if nSky > 1 then err(nSky .. " Skies in Lighting - they fight; clear by CLASS, not by name") end
if nAtm > 1 then err(nAtm .. " Atmospheres in Lighting") end

-- Ambient motion was written, committed, and never installed for several
-- rounds. A map with a motion system and no motion should say so.
local CS = game:GetService("CollectionService")
local nAmb = #CS:GetTagged("AmbientSpin") + #CS:GetTagged("AmbientBob")
	+ #CS:GetTagged("AmbientSway") + #CS:GetTagged("AmbientPulse")
if nAmb == 0 then
	warn("nothing is tagged for ambient motion")
elseif not game:GetService("ServerScriptService"):FindFirstChild("MapAmbient") then
	err(nAmb .. " instance(s) tagged for ambient motion but MapAmbient is not "
		.. "installed in ServerScriptService - nothing will move")
end

return string.format(
	"%s | parts=%d (mesh=%d) spawns=%d y=[%.0f,%.0f] grey=%d unresolvedRoles=%d\n"
		.. "  sky=%d atmosphere=%d ambientTagged=%d\n"
		.. "  errors=%d warnings=%d\n%s",
	MAP, parts, meshParts, nspawn, minY, maxY, grey, unresolved,
	nSky, nAtm, nAmb, errors, warns,
	#msgs > 0 and table.concat(msgs, "\n") or "  clean")
