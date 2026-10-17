--!nonstrict
-- roblox-map: PROVE A PLAYER CAN SPAWN, in a real playtest. Paste as a Script in
-- ServerScriptService, start_playtest, then read the output.
--
-- An edit-mode check can say the spawn is on dry, flat, reachable ground and a player
-- can still fall through the world: the template SpawnLocation at (0, 0.5, 0) sat 85
-- studs inside an island map's ground with every terrain check green.
-- Only a character standing still on something, a few seconds after
-- spawning, is evidence.
--
-- Prints one line per character:
--   SPAWN_PROBE ok   pos=(x,y,z) floor=<Material> state=<HumanoidState> spawn=<name> drop=<studs>
--   SPAWN_PROBE FAIL <reason> ...
-- FAIL when: no floor after 6 s, falling, y below the spawn by more than 8 studs,
-- or more than 12 studs from every map spawn.

local Players = game:GetService("Players")

local function nearestSpawn(pos)
	local best, bestD
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("SpawnLocation") and d.Enabled then
			local dist = (Vector3.new(d.Position.X, 0, d.Position.Z) - Vector3.new(pos.X, 0, pos.Z)).Magnitude
			if not bestD or dist < bestD then best, bestD = d, dist end
		end
	end
	return best, bestD
end

local function probe(player, character)
	local hum = character:WaitForChild("Humanoid", 10)
	local root = character:WaitForChild("HumanoidRootPart", 10)
	if not (hum and root) then
		print("SPAWN_PROBE FAIL no humanoid/root for " .. player.Name)
		return
	end
	task.wait(6)
	local pos = root.Position
	local floor = hum.FloorMaterial
	local state = hum:GetState()
	local sp, dist = nearestSpawn(pos)
	local drop = sp and (sp.Position.Y - pos.Y) or 0
	local reasons = {}
	if floor == Enum.Material.Air then table.insert(reasons, "no floor") end
	if state == Enum.HumanoidStateType.Freefall or state == Enum.HumanoidStateType.FallingDown then
		table.insert(reasons, "falling")
	end
	if not sp then table.insert(reasons, "no enabled SpawnLocation")
	elseif dist > 12 then table.insert(reasons, ("%.0f studs from nearest spawn %s"):format(dist, sp:GetFullName())) end
	if drop > 8 then table.insert(reasons, ("%.1f studs below the spawn"):format(drop)) end
	local line = ("pos=(%.1f,%.1f,%.1f) floor=%s state=%s spawn=%s drop=%.1f"):format(
		pos.X, pos.Y, pos.Z, floor.Name, state.Name, sp and sp:GetFullName() or "none", drop)
	if #reasons == 0 then
		print("SPAWN_PROBE ok   " .. line)
	else
		print("SPAWN_PROBE FAIL " .. table.concat(reasons, "; ") .. " " .. line)
	end
end

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(c) probe(player, c) end)
	if player.Character then probe(player, player.Character) end
end)
for _, p in ipairs(Players:GetPlayers()) do
	if p.Character then task.spawn(probe, p, p.Character) end
	p.CharacterAdded:Connect(function(c) probe(p, c) end)
end
