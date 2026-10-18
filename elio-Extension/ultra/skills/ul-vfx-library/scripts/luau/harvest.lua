-- HARVEST body. Reads every VFX emitter under ROOT_PATH and prints recipe JSON.
-- Groups by container, because a real effect is 3-4 layers and an emitter
-- harvested alone is a part with no memory of the thing it belonged to.
local ROOT_PATH = "%ROOT_PATH%"

local function resolve(path)
	local node = game
	for seg in string.gmatch(path, "[^%.]+") do
		if seg ~= "game" then
			node = node:FindFirstChild(seg)
			if not node then return nil, seg end
		end
	end
	return node
end

local root, missing = resolve(ROOT_PATH)
if not root then
	print("HARVEST_ERROR missing segment: " .. tostring(missing))
	return "error"
end

local VFX_CLASSES = { ParticleEmitter = true, Beam = true, Trail = true, PointLight = true }

-- The container is the atomic recipe: nearest ancestor that is a BasePart or a
-- Model, so relative attachment offsets stay meaningful.
-- MEASURED on a real 3100-emitter place: 61% of emitters sit under a container
-- called literally "Part" or "Model". Naming the recipe after the nearest
-- container therefore yields hundreds of files called Part.json - a bag of parts
-- with no memory of what they belonged to, which is the exact failure this skill
-- exists to avoid. So climb PAST generic names to the nearest ancestor a human
-- actually named, but never as far as the harvest root, or one pack collapses
-- into one recipe.
local GENERIC = {
	Part = true, Model = true, Union = true, MeshPart = true, Folder = true,
	Wedge = true, WedgePart = true, Handle = true, Attachment = true,
	TruePart = true, Baseplate = true, [""] = true,
}
local function isGeneric(name)
	return GENERIC[name] == true or string.match(name, "^%d+$") ~= nil
end

local function containerOf(inst, root)
	local n = inst.Parent
	local nearest = nil
	while n and n ~= game do
		if n:IsA("Model") or n:IsA("BasePart") then
			if nearest == nil then nearest = n end
			if n == root then break end
			if not isGeneric(n.Name) then return n end
		end
		if n == root then break end
		n = n.Parent
	end
	-- Everything up to the root was generic: keep the nearest real container
	-- rather than merging unrelated effects together.
	return nearest
end

-- MEASURED on Roblox's own "Particle Effects" (228304820): real packs ship
-- emitters parented DIRECTLY to a Model. Such an emitter has no world position
-- and does not render at all until it is re-parented under a BasePart or an
-- Attachment. It harvests fine; it just looks broken in the pack. Recorded via
-- parent_class so the rebuild does not have to guess.
local HOSTABLE = { Attachment = true, MeshPart = true, Part = true }
local function rendersInPlace(inst)
	local p = inst.Parent
	return p ~= nil and (p:IsA("Attachment") or p:IsA("BasePart"))
end

-- A pack ships an emitter Enabled=false with a live Rate when it means "turn me
-- on for a moment", which is a one-shot in everything but name. There is no
-- recorded burst window, so this is a GUESS, flagged as one. Curate it.
local BURST_WINDOW = 0.1
local function inferEmit(inst)
	if inst:IsA("PointLight") then
		return { mode = inst.Enabled and "constant" or "pulse",
		         from = (not inst.Enabled) and inst.Brightness or nil,
		         seconds = (not inst.Enabled) and 0.25 or nil,
		         inferred = true }
	end
	if inst:IsA("Beam") or inst:IsA("Trail") then
		-- Continuous is the ONLY mode these have, so nothing is being guessed.
		-- Flagging it as inferred just buries the real guesses in noise.
		return { mode = "continuous" }
	end
	local rate = 0
	pcall(function() rate = inst.Rate end)
	if inst.Enabled and rate > 0 then
		return { mode = "continuous", inferred = true }
	end
	local n = math.floor(rate * BURST_WINDOW + 0.5)
	return { mode = "burst", count = math.clamp(n, 1, 250), inferred = true,
	         burst_window = BURST_WINDOW }
end

-- MEASURED: GetFullName() IS NOT UNIQUE. Ten sibling Parts all called "Part"
-- under one Folder return the SAME string, so keying groups on it merges
-- unrelated effects into one giant recipe AND makes them overwrite each other on
-- write. On a real place that silently lost 366 of 583 recipes and produced
-- 40- and 55-layer "effects". Key on the INSTANCE, which is unique by identity,
-- and disambiguate the human-readable path afterwards.
local groups, order = {}, {}
for _, d in ipairs(root:GetDescendants()) do
	if VFX_CLASSES[d.ClassName] then
		local c = containerOf(d, root)
		local key = c or "<orphan>"
		if not groups[key] then
			groups[key] = { container = c, layers = {} }
			table.insert(order, key)
		end
		table.insert(groups[key].layers, d)
	end
end

-- MEASURED: a "VFX pack" is often a TEXTURE LIBRARY, not an effect pack -
-- Part '78' / Attachment / ParticleEmitter 'Images/Lightning', one emitter each.
-- The container is numbered junk and the ONLY human-meaningful name is on the
-- emitter. Naming recipes after the container gave 1660 of 1813 files names like
-- "78" and "Part": complete, verified, and impossible to search, which is the
-- same as not having harvested it.
local GENERIC_LAYER = {
	Texture = true, Emitter = true, ParticleEmitter = true, Beam = true,
	Trail = true, PointLight = true, Attachment = true, Particle = true,
	Effect = true, VFX = true, [""] = true,
}

local function recipeName(container, layers)
	local cname = container and container.Name or "orphan"
	if not isGeneric(cname) then return cname end

	-- Generic container. A single-layer recipe IS its layer, so use its name.
	if #layers == 1 then
		local ln = string.gsub(layers[1].Name, "^.*/", "")   -- "Images/Lightning" -> "Lightning"
		if not isGeneric(ln) and not GENERIC_LAYER[ln] then
			return ln
		end
		-- Nothing named anything. The texture id is at least unique and lets you
		-- find the same effect again, which a 47th file called "Part" does not.
		local ok, tex = pcall(function() return layers[1].Texture end)
		if ok and type(tex) == "string" then
			local id = string.match(tex, "(%d+)")
			if id then return cname .. "_tex" .. id end
		end
	end
	return cname
end

-- Now make the recorded path unique, so the sink can key files on it safely.
local pathSeen = {}
for _, key in ipairs(order) do
	local g = groups[key]
	local base = g.container and g.container:GetFullName() or "<orphan>"
	local n = (pathSeen[base] or 0) + 1
	pathSeen[base] = n
	g.sourcePath = (n == 1) and base or (base .. "#" .. n)
end

local out = { recipes = {}, scanned = #root:GetDescendants() }

for _, key in ipairs(order) do
	local g = groups[key]
	local rec = {
		name = recipeName(g.container, g.layers),
		container_name = g.container and g.container.Name or nil,
		siblings_share_name = (string.find(g.sourcePath, "#") ~= nil) or nil,
		source_path = g.sourcePath,
		layers = {},
		textures = {},
	}
	local maxLife = 0
	local originCF = nil
	if g.container then
		local ok, cf = pcall(function()
			return g.container:IsA("Model") and g.container:GetPivot() or g.container.CFrame
		end)
		if ok then originCF = cf end
	end

	for _, inst in ipairs(g.layers) do
		local props = {}
		for _, p in ipairs(VFX.PROPS[inst.ClassName] or {}) do
			local good, v = pcall(function() return inst[p] end)
			if good then
				local enc = VFX.enc(v)
				-- Instance refs (Beam/Trail Attachment0/1) cannot be a value;
				-- they are structure and are recorded as such, not faked.
				if type(enc) == "table" and enc.Unsupported then
					props[p] = { Ref = (typeof(v) == "Instance") and v:GetFullName() or nil }
				else
					props[p] = enc
				end
			end
		end

		local offset = { 0, 0, 0 }
		local parent = inst.Parent
		if parent and parent:IsA("Attachment") and originCF then
			local wp = parent.WorldCFrame.Position
			local lp = originCF:PointToObjectSpace(wp)
			offset = { lp.X, lp.Y, lp.Z }
		end

		local tex = props.Texture
		if type(tex) == "string" and tex ~= "" then
			table.insert(rec.textures, tex)
		end

		-- Beam/Trail are STRUCTURE, not values: Attachment0/1 are instance refs.
		-- Recorded as two named offsets from the container origin so the rebuild
		-- can recreate the attachments and wire them, instead of faking a value.
		local endpoints = nil
		if inst:IsA("Beam") or inst:IsA("Trail") then
			endpoints = {}
			for i, key in ipairs({ "Attachment0", "Attachment1" }) do
				local ok, att = pcall(function() return inst[key] end)
				if ok and att and originCF then
					local lp = originCF:PointToObjectSpace(att.WorldCFrame.Position)
					endpoints[i] = { name = att.Name, offset = { lp.X, lp.Y, lp.Z } }
				else
					endpoints[i] = { name = key, offset = { 0, (i == 1) and 0 or 4, 0 }, missing = true }
				end
			end
		end

		local emit = inferEmit(inst)
		-- build.lua forces Rate=0 on a burst layer; keep the harvested value so
		-- the original is never silently lost.
		if emit.mode == "burst" and type(props.Rate) == "number" then
			emit.harvested_rate = props.Rate
			props.Rate = 0
		end
		if emit.mode == "continuous" then props.Enabled = true end

		local life = props.Lifetime
		if type(life) == "table" and life.NumberRange then
			maxLife = math.max(maxLife, life.NumberRange[2])
		end

		table.insert(rec.layers, {
			name = inst.Name,
			class = inst.ClassName,
			parent_class = parent and parent.ClassName or nil,
			renders_in_place = rendersInPlace(inst),
			endpoints = endpoints,
			offset = offset,
			emit = emit,
			props = props,
		})
	end
	-- A Beam has no Lifetime, so maxLife stays 0. Writing duration = 0 states
	-- something false; omitting it states nothing, which is correct.
	if maxLife > 0 then
		rec.duration = math.floor(maxLife * 100 + 0.5) / 100
	end
	table.insert(out.recipes, rec)
end

-- MEASURED: a 1447-recipe pack encodes to ~2MB and PostAsync REFUSES it. The
-- pcall caught the throw, the code fell back to printing, and because the
-- harvest was running inside task.spawn those prints were dropped too - so the
-- biggest pack in the place reported "harvested 1447" and wrote NOTHING. Post in
-- batches, and make the count that comes back the count that reached disk.
local SINK = "%SINK_URL%"
local BATCH = 40

local function postBatch(recipes)
	local body = HttpService:JSONEncode({ recipes = recipes, scanned = out.scanned })
	local ok, res = pcall(function()
		return HttpService:PostAsync(SINK, body, Enum.HttpContentType.ApplicationJson)
	end)
	return ok, res, #body
end

if SINK ~= "" then
	local sent, failed, batches = 0, 0, 0
	local buf = {}
	local function flush()
		if #buf == 0 then return end
		batches = batches + 1
		local ok, res, n = postBatch(buf)
		if ok then
			sent = sent + #buf
		else
			failed = failed + #buf
			warn("HARVEST_BATCH_FAILED size=" .. #buf .. " bytes=" .. n .. " err=" .. tostring(res))
		end
		buf = {}
	end
	for _, rec in ipairs(out.recipes) do
		table.insert(buf, rec)
		if #buf >= BATCH then flush() end
	end
	flush()
	print(("HARVEST_POSTED written=%d failed=%d batches=%d of %d recipes")
		:format(sent, failed, batches, #out.recipes))
	-- Return the number that actually LANDED, never the number scanned.
	return ("written %d of %d"):format(sent, #out.recipes)
end

local json = HttpService:JSONEncode(out)
print("HARVEST_BEGIN len=" .. #json .. " recipes=" .. #out.recipes)
local CHUNK = 3000
for i = 1, #json, CHUNK do
	print("H:" .. string.sub(json, i, i + CHUNK - 1))
end
print("HARVEST_END")
return "printed " .. #out.recipes
