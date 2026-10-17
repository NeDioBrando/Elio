-- ENGINE. The element + timeline machine, shared by BOTH front ends:
--
--   scene.lua    edit mode - a stage of anchor Parts, a freeze time, a camera
--   runtime.lua  play mode - the live player character, no freeze, cleanup
--
-- It lives in one file ON PURPOSE. The whole premise of this skill is that what
-- you tuned and what ships cannot disagree; two copies of a 400-line engine is
-- exactly how they start to.
--
-- Everything animates off ONE hand-written stepper rather than TweenService, so
-- a scene can be frozen mid-flight at an exact time and photographed. A
-- TweenService tween cannot be frozen, only cancelled, and cancelling loses the
-- pose - which would make phase-frozen capture impossible for anything but the
-- particles.
--
-- Expects VFX (the codec) already in scope. ctx supplies everything that is
-- NOT the same between the two front ends:
--   ctx.anchorPos(a)      name or {x,y,z} -> Vector3
--   ctx.folder            Instance to build into
--   ctx.sourceModel(n)    Model for clone/model elements
--   ctx.report(str)       progress sink
--   ctx.onFinish(freeze)  optional, called once playback ends
--   ctx.offset(o)         optional, composition offset {x,y,z} -> world Vector3
--   ctx.basis             optional, CFrame rotation applied to every part
--
-- OFFSETS ARE IN COMPOSITION SPACE, NOT WORLD SPACE. Fixed 2026-09-10. Before
-- this, every positional offset went through a plain Vector3.new, which is
-- correct in the edit stage (the stage rig faces -Z, so composition space and
-- world space coincide) and WRONG IN GAME, where a player can face anywhere:
-- "three studs in front of the caster" landed three studs toward world -Z
-- whatever the caster was looking at. It never showed because the first
-- effects only ever offset vertically. The runtime now supplies ctx.offset to
-- map x right / y up / -z forward through the character's own frame, and
-- ctx.basis so a wall or a beam turns WITH the caster instead of staying locked
-- to the world grid. Edit mode passes neither and behaves exactly as before.
local function makeEngine(comp, ctx)
	local anchorPos = ctx.anchorPos
	local fx = ctx.folder
	local ws = workspace

	local function vec(o) o = o or {0, 0, 0}; return Vector3.new(o[1], o[2], o[3]) end
	-- POSITIONAL offsets only. Sizes, accelerations and a layer's attachment
	-- offset on its own host part stay plain vectors via vec().
	local off = ctx.offset or vec
	local basis = ctx.basis or CFrame.new()
	local function c3(t, d) if not t then return d end return Color3.new(t[1], t[2], t[3]) end
	local function mat(n) return n and Enum.Material[n] or Enum.Material.Neon end

	-- ---------------------------------------------------------------- easing
	local E = {}
	E.linear  = function(a) return a end
	E.quadOut = function(a) return 1 - (1 - a) ^ 2 end
	E.quadIn  = function(a) return a * a end
	E.cubeOut = function(a) return 1 - (1 - a) ^ 3 end
	E.cubeIn  = function(a) return a * a * a end
	E.expoOut = function(a) return a >= 1 and 1 or 1 - 2 ^ (-10 * a) end
	E.backOut = function(a) local c = 1.70158; return 1 + (c + 1) * (a - 1) ^ 3 + c * (a - 1) ^ 2 end
	E.pulse   = function(a) return math.sin(a * math.pi) end
	local function ease(n) return E[n or "linear"] or E.linear end

	-- ---------------------------------------------------------------- elements
	local EL = {}
	local ALL_EMITTERS = {}
	local INITIAL = {}      -- closures restoring each element's authored look

	local function newPart(name, parent)
		local p = Instance.new("Part")
		p.Name = name; p.Anchored = true; p.CanCollide = false; p.CanQuery = false
		p.CanTouch = false; p.CastShadow = false
		p.TopSurface = Enum.SurfaceType.Smooth; p.BottomSurface = Enum.SurfaceType.Smooth
		p.Parent = parent
		return p
	end

	-- Tint keeps the LUMINANCE ramp and swaps hue. A flat colour replacement
	-- destroys the bright-core-to-dark-tail arc that is the thing reading as fire.
	local function tintSeq(seq, rgb)
		local kp = {}
		for _, p in ipairs(seq.Keypoints) do
			local lum = 0.2126 * p.Value.R + 0.7152 * p.Value.G + 0.0722 * p.Value.B
			table.insert(kp, ColorSequenceKeypoint.new(p.Time, Color3.new(
				math.clamp(rgb[1] * lum * 1.6, 0, 1),
				math.clamp(rgb[2] * lum * 1.6, 0, 1),
				math.clamp(rgb[3] * lum * 1.6, 0, 1))))
		end
		return ColorSequence.new(kp)
	end
	local function scaleSeq(seq, k)
		local kp = {}
		for _, p in ipairs(seq.Keypoints) do
			table.insert(kp, NumberSequenceKeypoint.new(p.Time, p.Value * k, p.Envelope * k))
		end
		return NumberSequence.new(kp)
	end

	-- Build particle layers out of an inlined recipe.
	-- LAYER SUBSETTING IS NOT OPTIONAL. Plenty of "multi-layer" harvested recipes
	-- are VARIANT SHEETS, not layered effects: Lightning_2 ships ToonLightning,
	-- ToonLightningContrast, ToonLightningDupe and PixelLightning, which are four
	-- art styles of ONE bolt meant to be used one at a time. Build all four and you
	-- get four styles stacked on each other.
	local function buildRecipe(e, host)
		local rec = comp.recipes[e.recipe]
		if not rec then error("SCENE_ERROR recipe not inlined: " .. tostring(e.recipe)) end
		-- Selection is BY NAME, with "#n" for by-index. They must not share a
		-- namespace: pack layers are routinely NAMED "1".."9" (Hit1 is), so a plain
		-- "3" matching both the third layer and every layer called "3" quietly
		-- selects more than was asked for - measured, 7 layers built for a list of 5.
		local wantName, wantIdx = nil, nil
		if e.layers then
			wantName, wantIdx = {}, {}
			for _, v in ipairs(e.layers) do
				local s = tostring(v)
				local n = string.match(s, "^#(%d+)$")
				if n then wantIdx[tonumber(n)] = true else wantName[s] = true end
			end
		end
		local scale = e.scale or 1
		local emitters = {}
		local total = 0
		local skipped = 0
		for i, layer in ipairs(rec.layers) do
			total = total + 1
			local keep = true
			if wantName then keep = (wantIdx[i] or wantName[layer.name]) and true or false end
			-- A harvested Beam/Trail records Attachment0/1 as {"Ref": "<full name>"},
			-- which is STRUCTURE, not a value. Rebuilt without an endpoints block it
			-- is a Beam wired to nothing: it builds, reports success and draws
			-- absolutely nothing. Skip it loudly rather than shipping a dead layer.
			if keep and (layer.class == "Beam" or layer.class == "Trail") and not layer.endpoints then
				keep = false
				skipped = skipped + 1
			end
			if keep then
				local att = Instance.new("Attachment")
				att.Name = e.id .. "_" .. layer.name .. "_" .. i
				-- The element offset goes on the ATTACHMENT only when the host is a
				-- parent part. An unparented recipe's host was already placed at
				-- anchor + offset, and adding it here as well put every such
				-- emitter at TWICE its authored offset. That shipped unnoticed
				-- because every effect had been tuned by eye against the doubled
				-- position. Authored offsets are now the true position. On a parent part
				-- the offset is in the part's LOCAL frame, so it turns with it.
				-- e.centred drops the LAYER's harvested offset. A pack records where
				-- each emitter's attachment sat, and some of those are STRUCTURE:
				-- Lava-01 is a beam effect whose layer #1 sits on the far end, 6.25
				-- studs out, and Lighting-01's Lightning layer hangs 9.9 up. Scaled
				-- with the effect, those put a stream's embers 15-27 studs from its
				-- own body. Opt-in, so every existing composition builds unchanged.
				local lo = e.centred and {0, 0, 0} or layer.offset
				att.Position = (e.parent and vec(e.offset) or Vector3.new()) + Vector3.new(
					(lo[1] or 0) * scale,
					(lo[2] or 0) * scale,
					(lo[3] or 0) * scale)
				att.Parent = host
				local inst = Instance.new(layer.class)
				inst.Name = layer.name
				for p, v in pairs(layer.props) do
					if type(v) ~= "table" or not v.Ref then
						local ok, dec = pcall(VFX.dec, v)
						if ok and dec ~= nil then pcall(function() inst[p] = dec end) end
					end
				end
				if scale ~= 1 then
					pcall(function() inst.Size = scaleSeq(inst.Size, scale) end)
					pcall(function() inst.Speed = NumberRange.new(inst.Speed.Min * scale, inst.Speed.Max * scale) end)
					pcall(function() inst.Acceleration = inst.Acceleration * scale end)
				end
				if e.tint then pcall(function() inst.Color = tintSeq(inst.Color, e.tint) end) end
				if e.lifetime_mul then pcall(function()
					inst.Lifetime = NumberRange.new(inst.Lifetime.Min * e.lifetime_mul, inst.Lifetime.Max * e.lifetime_mul)
				end) end
				if e.speed then pcall(function() inst.Speed = NumberRange.new(e.speed[1], e.speed[2]) end) end
				if e.spread then pcall(function() inst.SpreadAngle = Vector2.new(e.spread, e.spread) end) end
				if e.drag then pcall(function() inst.Drag = e.drag end) end
				if e.accel then pcall(function() inst.Acceleration = vec(e.accel) end) end
				if e.emission_dir then pcall(function() inst.EmissionDirection = Enum.NormalId[e.emission_dir] end) end
				if e.locked ~= nil then pcall(function() inst.LockedToPart = e.locked end) end
				if e.zoffset then pcall(function() inst.ZOffset = e.zoffset end) end
				-- The harvested count is a GUESS (Rate * 0.1). Overriding it per USE
				-- is most of the point of a composition: same recipe, right density.
				if inst:IsA("ParticleEmitter") then
					local em = layer.emit or {}
					local count = e.count or em.count or 20
					inst:SetAttribute("EmitCount", math.max(1, math.floor(count * (e.count_mul or 1))))
					-- A burst layer that also streams reads as "the effect never stops".
					if e.mode == "continuous" then
						-- rate_mul scales the rate the PACK used (harvested_rate survives
						-- a burst-mode harvest that zeroed Rate), so a streamed harvested
						-- effect keeps its authored density instead of a flat 20.
						local native = (em.harvested_rate and em.harvested_rate > 0 and em.harvested_rate)
							or ((inst.Rate and inst.Rate > 0) and inst.Rate) or 20
						inst.Rate = e.rate or (e.rate_mul and native * e.rate_mul) or native
						-- A harvested BURST streamed at its pack rate can be 1000/s.
						if e.rate_cap then inst.Rate = math.min(inst.Rate, e.rate_cap) end
						inst.Enabled = (e.start_enabled == true)
					else
						inst.Rate = 0
						inst.Enabled = false
					end
					inst.Parent = att
					table.insert(emitters, inst)
					table.insert(ALL_EMITTERS, inst)
				elseif inst:IsA("Beam") and layer.endpoints and #layer.endpoints >= 2 then
					-- A Beam INSIDE a recipe, wired from the endpoint offsets the harvester
					-- recorded (the aura rigs: a floor emitter with beams rising off it).
					-- Positions scale with the effect like every other offset; the width
					-- scales too or a shrunk aura keeps full-width beams.
					local base = e.parent and vec(e.offset) or Vector3.new()
					local ends = {}
					for k = 1, 2 do
						local o = layer.endpoints[k].offset or {0, 0, 0}
						local a = Instance.new("Attachment")
						a.Name = e.id .. "_" .. layer.name .. "_" .. i .. "_E" .. k
						a.Position = base + Vector3.new((o[1] or 0) * scale, (o[2] or 0) * scale, (o[3] or 0) * scale)
						a.Parent = host
						ends[k] = a
					end
					att:Destroy()
					inst.Attachment0 = ends[1]; inst.Attachment1 = ends[2]
					pcall(function() inst.Width0 = inst.Width0 * scale; inst.Width1 = inst.Width1 * scale end)
					inst.Enabled = false
					inst.Parent = host
					-- in el.emitters so enable/fade/hide reach it; NOT in ALL_EMITTERS,
					-- which the freeze walks setting TimeScale (a Beam has none)
					table.insert(emitters, inst)
				else
					att:Destroy()
					inst:Destroy()
					skipped = skipped + 1
				end
			end
		end
		return emitters, total, skipped
	end

	local function makeRing(el, e, host)
		local segs = {}
		local n = e.segments or 48
		for i = 1, n do
			local p = newPart("seg" .. i, host)
			p.Shape = Enum.PartType.Block
			p.Material = mat(e.material)
			p.Color = c3(e.color, Color3.new(1, 1, 1))
			p.Transparency = e.transparency or 0
			table.insert(segs, p)
		end
		el.segs = segs
		el.n = n
		el.thick = e.thickness or 0.35
		el.height = e.height or 0.35
		el.center = anchorPos(e.anchor) + off(e.offset)
		el.tilt = e.tilt or 0
		el.spin = 0
		el.lastR = e.radius or 3
		el.setRadius = function(r, squash)
			el.lastR = r
			squash = squash or 1
			local arc = (2 * math.pi * r) / el.n
			for i, p in ipairs(el.segs) do
				local a = (i - 1) / el.n * math.pi * 2 + el.spin
				local dir = Vector3.new(math.cos(a), 0, math.sin(a))
				p.Size = Vector3.new(math.max(arc * 1.08, 0.05), el.height * squash, el.thick)
				local pos = el.center + dir * r
				p.CFrame = CFrame.lookAt(pos, pos + dir) * CFrame.Angles(math.rad(el.tilt), 0, 0)
			end
		end
		el.setRadius(el.lastR)
	end

	local function build(e)
		local el = { id = e.id, kind = e.kind, emitters = {} }
		-- An emitter on a MOVING host has to be parented to it. A fireball whose
		-- flames are pinned to the launch anchor is a fireball that leaves its own
		-- fire behind at the hand.
		local attachTo = nil
		if e.parent then
			local pe = EL[e.parent]
			if not pe then error("SCENE_ERROR element '" .. e.id .. "' parents to unbuilt '" .. tostring(e.parent) .. "'") end
			attachTo = pe.inst
			if not attachTo:IsA("BasePart") then
				error("SCENE_ERROR '" .. e.id .. "' parents to a " .. attachTo.ClassName .. ", needs a BasePart")
			end
		end
		if e.kind == "part" then
			local p = newPart(e.id, fx)
			p.Shape = Enum.PartType[e.shape or "Ball"]
			p.Size = vec(e.size or {1, 1, 1})
			p.Color = c3(e.color, Color3.new(1, 1, 1))
			p.Material = mat(e.material)
			p.Transparency = e.transparency or 0
			local r = e.rot or {0, 0, 0}
			p.CFrame = CFrame.new(anchorPos(e.anchor) + off(e.offset)) * basis
				* CFrame.Angles(math.rad(r[1]), math.rad(r[2]), math.rad(r[3]))
			el.inst = p
			el.home = p.CFrame
			el.baseSize = p.Size
			if e.grow_from_bottom then el.bottom = p.Position.Y - p.Size.Y / 2 end
		elseif e.kind == "ring" then
			local m = Instance.new("Model"); m.Name = e.id; m.Parent = fx
			el.inst = m
			makeRing(el, e, m)
		elseif e.kind == "light" then
			local p = attachTo or newPart(e.id, fx)
			if not attachTo then
				p.Size = Vector3.new(0.2, 0.2, 0.2); p.Transparency = 1
				p.CFrame = CFrame.new(anchorPos(e.anchor) + off(e.offset))
			end
			local l = Instance.new("PointLight")
			l.Color = c3(e.color, Color3.new(1, 1, 1))
			l.Range = e.range or 24
			l.Brightness = e.brightness or 0
			l.Shadows = false
			l.Parent = p
			el.inst = p; el.light = l; el.home = p.CFrame
		elseif e.kind == "recipe" then
			local p = attachTo or newPart(e.id, fx)
			if not attachTo then
				p.Size = Vector3.new(0.2, 0.2, 0.2); p.Transparency = 1
				p.CFrame = CFrame.new(anchorPos(e.anchor) + off(e.offset))
			end
			el.inst = p; el.home = p.CFrame
			local ems, total, skipped = buildRecipe(e, p)
			el.emitters = ems
			el.layerTotal = total
			el.skipped = skipped
		elseif e.kind == "group" then
			local m = Instance.new("Model"); m.Name = e.id; m.Parent = fx
			el.inst = m
			el.items = {}
			el.tangent = (e.orient == "tangent")
			local centre = anchorPos(e.anchor) + off(e.offset)
			el.centre = centre
			local n = e.count or 8
			local seed = Random.new(e.seed or 1234)
			local sz = e.size or {1, 1, 1}
			for i = 1, n do
				local p = newPart("i" .. i, m)
				p.Shape = Enum.PartType[e.shape or "Block"]
				p.Material = mat(e.material)
				p.Color = c3(e.color, Color3.new(1, 1, 1))
				p.Transparency = e.transparency or 0
				local k = 1 + seed:NextNumber(-(e.size_jitter or 0), (e.size_jitter or 0))
				p.Size = Vector3.new(sz[1] * k, sz[2] * k, sz[3] * k)
				local a = (i - 1) / n * math.pi * 2 + (e.phase or 0)
				local rr = (e.radius or 4) * (1 + seed:NextNumber(-(e.radius_jitter or 0), (e.radius_jitter or 0)))
				-- y_ramp ties HEIGHT to the stagger order, which is what makes ice
				-- climb a body from the feet instead of appearing everywhere at once.
				local y
				if e.y_ramp then
					y = (e.y_min or 0) + ((e.y_max or 0) - (e.y_min or 0)) * ((i - 1) / math.max(n - 1, 1))
				else
					y = seed:NextNumber(e.y_min or 0, e.y_max or 0)
				end
				local tilt = e.tilt_jitter or 0
				-- local Z is the member's LONG axis; aim it radially OUTWARD so a
				-- long thin member reads as a crack running away from the centre.
				-- CFrame.Angles(0,-a,0) aims it tangentially - cracks then ran
				-- AROUND the circle instead of out of it.
				local yaw = (e.orient == "tangent") and -a or (math.pi / 2 - a)
				p.CFrame = CFrame.new(centre + Vector3.new(math.cos(a) * rr, y, math.sin(a) * rr))
					* CFrame.Angles(seed:NextNumber(-tilt, tilt), yaw, seed:NextNumber(-tilt, tilt))
				table.insert(el.items, {
					p = p, a0 = a, r0 = rr, y0 = y,
					rot = Vector3.new(seed:NextNumber(-4, 4), seed:NextNumber(-4, 4), seed:NextNumber(-4, 4)),
					vel = Vector3.new(seed:NextNumber(-1, 1), seed:NextNumber(0.3, 1.3), seed:NextNumber(-1, 1)).Unit,
					home = p.CFrame, size = p.Size, delay = (i - 1) / n,
				})
			end
		elseif e.kind == "bolt" then
			local m = Instance.new("Model"); m.Name = e.id; m.Parent = fx
			el.inst = m
			el.a = anchorPos(e.from) + off(e.from_offset)
			el.b = anchorPos(e.to) + off(e.to_offset)
			el.width = e.width or 0.6
			el.jitter = e.jitter or 3
			el.segments = e.segments or 14
			el.branches = e.branches or 4
			el.colour = c3(e.color, Color3.new(0.75, 0.85, 1))
			el.parts = {}
			el.regen = function(seed)
				for _, p in ipairs(el.parts) do p:Destroy() end
				el.parts = {}
				local rnd = Random.new(seed or 1)
				local function strand(a, b, w, jit, segs)
					local pts = { a }
					for i = 1, segs - 1 do
						local t = i / segs
						-- taper the wander to zero at both ends, or the bolt does not
						-- start and finish where it was aimed
						local envelope = math.sin(t * math.pi)
						table.insert(pts, a:Lerp(b, t) + Vector3.new(
							rnd:NextNumber(-jit, jit),
							rnd:NextNumber(-jit, jit) * 0.35,
							rnd:NextNumber(-jit, jit)) * envelope)
					end
					table.insert(pts, b)
					for i = 1, #pts - 1 do
						local p0, p1 = pts[i], pts[i + 1]
						local seg = newPart("b", m)
						seg.Shape = Enum.PartType.Block
						seg.Material = Enum.Material.Neon
						seg.Color = el.colour
						seg.Size = Vector3.new(w, w, (p1 - p0).Magnitude + w * 0.6)
						seg.CFrame = CFrame.lookAt((p0 + p1) / 2, p1)
						table.insert(el.parts, seg)
					end
					return pts
				end
				local main = strand(el.a, el.b, el.width, el.jitter, el.segments)
				local dir = (el.b - el.a).Unit
				-- Branch length is scaled to the BOLT, not fixed. Fixed-length
				-- branches on a 27-stud bolt sprawled 15 studs wide - wider than the
				-- main channel was tall on screen - and the strike point stopped
				-- being readable. A branch that outgrows its parent is a shrub.
				local span = (el.b - el.a).Magnitude
				local bmax = math.clamp(span * (el.branch_len or 0.16), 1.5, 9)
				for _ = 1, el.branches do
					local k = rnd:NextInteger(2, math.max(3, #main - 2))
					local from = main[k]
					-- taper: branches near the ground are shorter, like a real strike
					local taper = 0.35 + 0.65 * (1 - (k / #main))
					local tip = from + dir * rnd:NextNumber(bmax * 0.3, bmax * 0.8) * taper
						+ Vector3.new(rnd:NextNumber(-1, 1), rnd:NextNumber(-0.35, 0.1), rnd:NextNumber(-1, 1)).Unit
						* rnd:NextNumber(bmax * 0.35, bmax) * taper
					strand(from, tip, el.width * 0.45, el.jitter * 0.4, 4)
				end
			end
			el.regen(e.seed or 7)
			el.setTransparency = function(v)
				for _, p in ipairs(el.parts) do p.Transparency = v end
			end
		elseif e.kind == "trail" then
			-- A Trail is STRUCTURE, not values: it needs two live Attachments on the
			-- part it follows. This is the same reason a harvested Beam/Trail cannot
			-- be rebuilt from its recipe alone.
			if not attachTo then error("SCENE_ERROR trail '" .. e.id .. "' needs parent: <a part element>") end
			local a0 = Instance.new("Attachment"); a0.Name = e.id .. "_A0"
			local a1 = Instance.new("Attachment"); a1.Name = e.id .. "_A1"
			local w = (e.width or 1) * 0.5
			a0.Position = Vector3.new(0, w, 0); a1.Position = Vector3.new(0, -w, 0)
			a0.Parent = attachTo; a1.Parent = attachTo
			local tr = Instance.new("Trail")
			tr.Attachment0 = a0; tr.Attachment1 = a1
			tr.Lifetime = e.lifetime or 0.45
			tr.MinLength = 0
			tr.LightEmission = e.light_emission or 1
			tr.LightInfluence = 0
			tr.FaceCamera = true
			tr.Color = ColorSequence.new(c3(e.color, Color3.new(1, 0.6, 0.2)), c3(e.color2, c3(e.color, Color3.new(1, 0.2, 0))))
			tr.Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, e.transparency or 0.1),
				NumberSequenceKeypoint.new(1, 1) })
			if e.texture then tr.Texture = e.texture end
			tr.Enabled = false
			tr.Parent = attachTo
			el.inst = attachTo; el.trail = tr
		elseif e.kind == "chain" then
			-- ONE harvested recipe strung at `points` hosts between two anchors, so
			-- a line (a lightning bolt, a crackling tether) is drawn by the harvest's
			-- own effects instead of Neon segments. Positions come from the engine's
			-- anchors, so the line is right in game as well as on the edit stage.
			local a = anchorPos(e.from) + off(e.from_offset)
			local b = anchorPos(e.to) + off(e.to_offset)
			local m = Instance.new("Model"); m.Name = e.id; m.Parent = fx
			el.inst = m
			local rnd = Random.new(e.seed or 3)
			local n = math.max(1, e.points or 5)
			local j = e.jitter or 0
			for k = 1, n do
				local tt = (n == 1) and 0.5 or (k - 1) / (n - 1)
				local p = newPart(e.id .. "_" .. k, m)
				p.Size = Vector3.new(0.2, 0.2, 0.2); p.Transparency = 1
				local jit = Vector3.new(rnd:NextNumber(-j, j), rnd:NextNumber(-j, j) * 0.5, rnd:NextNumber(-j, j))
				if k == 1 or k == n then jit = Vector3.new() end
				local pos = a:Lerp(b, tt) + jit
				p.CFrame = (b - a).Magnitude > 1e-3 and CFrame.lookAt(pos, b) or CFrame.new(pos)
				local ems = buildRecipe(e, p)
				for _, em in ipairs(ems) do table.insert(el.emitters, em) end
			end
		elseif e.kind == "beam" then
			-- A HARVESTED Beam layer stretched between two points. A pack's Beam
			-- records Attachment0/1 as {"Ref"}, which is structure, so buildRecipe
			-- skips it (a Beam wired to nothing draws nothing). This kind supplies
			-- the structure: one layer, two attachments, each on an anchor or on a
			-- moving part element (parent / to_parent), so a beam can follow a
			-- projectile. Until 2026-09-10 no Beam in any harvested pack could be
			-- used at all - the wind, lava, waterfall and aura beams were dead weight.
			local rec = comp.recipes[e.recipe]
			if not rec then error("SCENE_ERROR recipe not inlined: " .. tostring(e.recipe)) end
			local want = tostring(e.layer or "#1")
			local idx = string.match(want, "^#(%d+)$")
			local layer
			for i, l in ipairs(rec.layers) do
				if (idx and i == tonumber(idx)) or (not idx and l.name == want) then layer = l; break end
			end
			if not layer or layer.class ~= "Beam" then
				error("SCENE_ERROR beam '" .. e.id .. "': layer " .. want .. " of " .. e.recipe .. " is not a Beam")
			end
			local function endPart(anchor, o, parentId, tag)
				if parentId then
					local pe = EL[parentId]
					if not pe or not pe.inst:IsA("BasePart") then
						error("SCENE_ERROR beam '" .. e.id .. "' end parents to unbuilt/non-part '" .. tostring(parentId) .. "'")
					end
					return pe.inst
				end
				local p = newPart(e.id .. tag, fx)
				p.Size = Vector3.new(0.2, 0.2, 0.2); p.Transparency = 1
				p.CFrame = CFrame.new(anchorPos(anchor) + off(o)) * basis
				return p
			end
			local pa = endPart(e.from, e.from_offset, e.parent, "_A")
			local pb = endPart(e.to, e.to_offset, e.to_parent, "_B")
			local a0 = Instance.new("Attachment"); a0.Name = e.id .. "_A0"; a0.Parent = pa
			local a1 = Instance.new("Attachment"); a1.Name = e.id .. "_A1"; a1.Parent = pb
			local b = Instance.new("Beam")
			for p, v in pairs(layer.props) do
				if type(v) ~= "table" or not v.Ref then
					local ok, dec = pcall(VFX.dec, v)
					if ok and dec ~= nil then pcall(function() b[p] = dec end) end
				end
			end
			b.Attachment0 = a0; b.Attachment1 = a1
			local wm = e.width_mul or 1
			pcall(function() b.Width0 = b.Width0 * wm; b.Width1 = b.Width1 * wm end)
			if e.tint then pcall(function() b.Color = tintSeq(b.Color, e.tint) end) end
			if e.segments then b.Segments = e.segments end
			b.Enabled = false
			b.Name = e.id
			b.Parent = pa
			el.inst = pa; el.home = pa.CFrame; el.beam = b
		elseif e.kind == "clone" or e.kind == "model" then
			-- clone: a frozen copy of a stage model, recoloured (the blink afterimage)
			-- model: the LIVE stage model, so the character itself can be faded out
			local src = ctx.sourceModel(e.source)
			if not src then error("SCENE_ERROR no source model '" .. tostring(e.source) .. "'") end
			local m = src
			if e.kind == "clone" then
				-- COPY THE PARTS, DO NOT Clone() THE MODEL. Against a stage dummy a
				-- whole-model Clone is fine; against a LIVE PLAYER CHARACTER it is
				-- not. Clone() returns NIL for a non-archivable instance, and the
				-- very next line indexes it, so the error killed the entire
				-- composition and the effect showed nothing at all - while every
				-- effect that does not clone kept working. A whole-model clone also
				-- drags in a second Humanoid, the Animate script and every
				-- accessory, none of which a silhouette wants.
				--
				-- A silhouette is SHAPE ONLY, so copy the BaseParts and keep just
				-- their meshes.
				m = Instance.new("Model"); m.Name = e.id; m.Parent = fx
				local shift = e.offset and off(e.offset) or Vector3.new()
				for _, d in ipairs(src:GetDescendants()) do
					if d:IsA("BasePart") and d.Transparency < 1 then
						d.Archivable = true
						local okc, c = pcall(function() return d:Clone() end)
						if okc and c then
							for _, ch in ipairs(c:GetChildren()) do
								if not ch:IsA("DataModelMesh") then ch:Destroy() end
							end
							c.Anchored = true; c.CanCollide = false; c.CanQuery = false
							c.CanTouch = false; c.CastShadow = false; c.Massless = true
							c.CFrame = d.CFrame + shift
							c.Parent = m
						end
					end
				end
				if #m:GetChildren() == 0 then
					error("SCENE_ERROR clone '" .. e.id .. "' copied no parts from " .. src:GetFullName())
				end
			end
			el.inst = m
			el.parts = {}
			for _, d in ipairs(m:GetDescendants()) do
				if d:IsA("BasePart") then
					-- base is what the part looked like BEFORE this element touched
					-- it. Capturing it afterwards means a clone authored as
					-- transparency 1 records base=1, the "keep genuinely invisible
					-- parts invisible" guard then rejects every part, and the clone
					-- can NEVER be faded back in. The ghost was unrenderable.
					local base = d.Transparency
					if e.kind == "clone" then
						d.Anchored = true; d.CanCollide = false; d.CanQuery = false
						-- Recolour ONLY when asked. A clone with its own look is the
						-- arriving character; a recoloured one is the afterimage.
						if e.material then d.Material = mat(e.material) end
						if e.color then d.Color = c3(e.color) end
						if e.transparency and base < 1 then d.Transparency = e.transparency end
					end
					table.insert(el.parts, { p = d, base = base })
				end
			end
			el.setTransparency = function(v)
				for _, r in ipairs(el.parts) do
					-- an already-invisible part (HumanoidRootPart) must STAY invisible
					if r.base < 1 then r.p.Transparency = v end
				end
			end
		else
			error("SCENE_ERROR unknown element kind '" .. tostring(e.kind) .. "'")
		end
		EL[e.id] = el
		return el
	end

	-- Build each element in its own pcall. One bad element used to throw out of
	-- the loop and take the WHOLE composition with it, so a single unbuildable
	-- piece read as "that effect does nothing" with no clue which piece. Report
	-- and carry on: a partial effect is debuggable, an absent one is not.
	local buildErrors = {}
	for _, e in ipairs(comp.elements) do
		local okb, errb = pcall(build, e)
		if not okb then
			table.insert(buildErrors, e.id .. ": " .. tostring(errb))
			warn("[VFX] " .. comp.name .. " element '" .. e.id .. "' FAILED: " .. tostring(errb))
		end
	end

	-- Snapshot AFTER every element exists, so replaying a scene starts from the
	-- authored look rather than from wherever the previous run left it.
	for _, e in ipairs(comp.elements) do
		local el = EL[e.id] or { kind = "__failed" }   -- its build error was already reported
		local t = e.transparency or 0
		if el.kind == "ring" then
			local r = el.lastR
			table.insert(INITIAL, function()
				el.spin = 0; el.setRadius(r)
				for _, p in ipairs(el.segs) do p.Transparency = t end
			end)
		elseif el.kind == "group" then
			local snap = {}
			for i, it in ipairs(el.items) do snap[i] = { cf = it.p.CFrame, sz = it.p.Size } end
			table.insert(INITIAL, function()
				for i, it in ipairs(el.items) do
					it.p.CFrame = snap[i].cf; it.p.Size = snap[i].sz; it.p.Transparency = t
				end
			end)
		elseif el.kind == "part" then
			local cf, sz = el.home, el.baseSize
			table.insert(INITIAL, function() el.inst.CFrame = cf; el.inst.Size = sz; el.inst.Transparency = t end)
		elseif el.kind == "light" then
			table.insert(INITIAL, function() el.light.Brightness = e.brightness or 0 end)
		elseif el.kind == "bolt" or el.kind == "clone" or el.kind == "model" then
			table.insert(INITIAL, function() el.setTransparency(t) end)
		elseif el.kind == "trail" then
			table.insert(INITIAL, function() el.trail.Enabled = false end)
		elseif el.kind == "beam" then
			local cf = el.home
			table.insert(INITIAL, function() el.beam.Enabled = false; el.inst.CFrame = cf end)
		end
	end

	local function setAlpha(el, v)
		if el.kind == "ring" then for _, p in ipairs(el.segs) do p.Transparency = v end
		elseif el.kind == "bolt" or el.kind == "clone" or el.kind == "model" then el.setTransparency(v)
		elseif el.kind == "group" then for _, it in ipairs(el.items) do it.p.Transparency = v end
		elseif el.kind == "trail" then el.trail.Enabled = v < 0.99
		elseif el.kind == "beam" then el.beam.Enabled = v < 0.99
		elseif el.kind == "recipe" or el.kind == "chain" then
			for _, em in ipairs(el.emitters) do pcall(function() em.Enabled = v < 0.99 end) end
		else el.inst.Transparency = v end
	end

	-- ---------------------------------------------------------------- timeline
	-- Every cue is either an INSTANT (emit/enable/destroy/regen/hide/show) or a
	-- TRACK with a start, a duration and an apply(alpha). Nothing uses TweenService:
	-- a tween cannot be frozen mid-flight, only cancelled, and cancelling loses the
	-- pose - which would make phase-frozen capture impossible for everything except
	-- the particles.
	local tracks, cues = {}, {}
	for _, c in ipairs(comp.timeline) do
		local el = EL[c.id]
		if not el then
			-- its element failed to build; skip the cue rather than compounding
			warn("[VFX] " .. comp.name .. " cue skipped, no element '" .. tostring(c.id) .. "'")
			el = nil
		end
		if el then
		local a = c.act
		if a == "emit" or a == "enable" or a == "destroy" or a == "regen" or a == "hide"
			or a == "show" or a == "warp" then
			table.insert(cues, c)
		else
			local f = ease(c.style)
			local t0, dur = c.t or 0, c.time or 0.5
			local apply
			if a == "scale" then
				local from, to = c.from or 0.01, c.to or 1
				apply = function(al)
					local k = from + (to - from) * f(al)
					local p = el.inst
					p.Size = el.baseSize * k
					if el.bottom then
						p.CFrame = CFrame.new(el.home.Position.X, el.bottom + p.Size.Y / 2, el.home.Position.Z)
							* (el.home - el.home.Position)
					end
				end
			elseif a == "radius" then
				local from, to = c.from or 0.5, c.to or 10
				apply = function(al)
					local k = f(al)
					el.setRadius(from + (to - from) * k, c.squash_to and (1 + (c.squash_to - 1) * k) or 1)
				end
			elseif a == "fade" then
				local from, to = c.from or 0, c.to or 1
				apply = function(al) setAlpha(el, from + (to - from) * f(al)) end
			elseif a == "light" then
				local from, to = c.from or 0, c.to or 0
				apply = function(al) el.light.Brightness = from + (to - from) * f(al) end
			elseif a == "spin" then
				local dps = c.deg_per_sec or 90
				apply = function(al)
					local ang = math.rad(dps * dur * al)
					if el.kind == "ring" then
						el.spin = ang; el.setRadius(el.lastR)
					elseif el.kind == "group" then
						for _, it in ipairs(el.items) do
							local a2 = it.a0 + ang
							it.p.CFrame = CFrame.new(el.centre
								+ Vector3.new(math.cos(a2) * it.r0, it.y0, math.sin(a2) * it.r0))
								* CFrame.Angles(0, el.tangent and -a2 or (math.pi / 2 - a2), 0)
						end
					else
						el.inst.CFrame = el.home * CFrame.Angles(0, ang, 0)
					end
				end
			elseif a == "fly" then
				local to = anchorPos(c.to) + off(c.to_offset)
				local arc = c.arc or 0
				apply = function(al)
					local k = f(al)
					local pos = el.home.Position:Lerp(to, k) + Vector3.new(0, math.sin(k * math.pi) * arc, 0)
					el.inst.CFrame = CFrame.new(pos) * (el.home - el.home.Position)
				end
			elseif a == "spiral" then
				local r1 = c.to_radius or 0
				local turns = c.turns or 2
				apply = function(al)
					local k = f(al)
					for _, it in ipairs(el.items) do
						local r = it.r0 + (r1 - it.r0) * k
						local ang = it.a0 + turns * math.pi * 2 * k
						it.p.CFrame = CFrame.new(el.centre + Vector3.new(math.cos(ang) * r, it.y0 * (1 - k), math.sin(ang) * r))
							* CFrame.Angles(it.rot.X * k * 6, it.rot.Y * k * 6, it.rot.Z * k * 6)
						if c.shrink then it.p.Size = it.size * math.max(1 - k * c.shrink, 0.02) end
					end
				end
			elseif a == "burst" then
				local speed = c.speed or 20
				local g = c.gravity or 60
				apply = function(al)
					local tt = al * dur
					for _, it in ipairs(el.items) do
						local d = it.vel * speed * tt - Vector3.new(0, 0.5 * g * tt * tt, 0)
						it.p.CFrame = CFrame.new(it.home.Position + d)
							* CFrame.Angles(it.rot.X * tt * 3, it.rot.Y * tt * 3, it.rot.Z * tt * 3)
					end
				end
			elseif a == "stagger" then
				-- every member runs the SAME sub-animation, offset in time. This is
				-- what makes ice climb a body and rune symbols light in sequence.
				local spread = c.spread or 0.5
				local from, to = c.from or 0.01, c.to or 1
				apply = function(al)
					for _, it in ipairs(el.items) do
						local la = math.clamp((al * dur - it.delay * spread) / math.max(dur - spread, 0.05), 0, 1)
						local k = from + (to - from) * f(la)
						it.p.Size = it.size * k
						if c.from_bottom then
							it.p.CFrame = CFrame.new(it.home.Position.X,
								it.home.Position.Y - it.size.Y / 2 + it.p.Size.Y / 2,
								it.home.Position.Z) * (it.home - it.home.Position)
						end
					end
				end
			elseif a == "move" then
				local to = anchorPos(c.to) + off(c.to_offset)
				apply = function(al)
					local k = f(al)
					if el.kind == "ring" then el.center = el.center:Lerp(to, 0); el.center = (el.homeCentre or el.center)
					else el.inst.CFrame = CFrame.new(el.home.Position:Lerp(to, k)) * (el.home - el.home.Position) end
				end
			end
			if apply then
				-- Park at frame zero ONLY for tracks that start at t=0. Applying a
				-- LATER track's alpha-0 state at build time overwrites the element's
				-- authored state: the fireball's impact ring has a fade track
				-- starting at t=1.02 with from=0.1, so apply(0) made it visible on
				-- the ground from the first frame, a third of the flight before the
				-- fireball arrived.
				table.insert(tracks, { t0 = t0, dur = dur, apply = apply, done = false, park = t0 <= 0 })
				if t0 <= 0 then apply(0) end
			end
		end
		end
	end
	table.sort(cues, function(x, y) return (x.t or 0) < (y.t or 0) end)

	local function fireCue(c)
		local el = EL[c.id]
		if c.act == "emit" then
			for _, em in ipairs(el.emitters) do
				if em:IsA("ParticleEmitter") then
					em:Emit(math.max(1, math.floor((em:GetAttribute("EmitCount") or 20) * (c.mult or 1))))
				elseif em:IsA("Beam") then
					-- a burst's beam has no count; it shows for the element's beam_hold
					em.Enabled = true
						task.delay(c.beam_hold or 0.35, function() if em.Parent then em.Enabled = false end end)
				end
			end
		elseif c.act == "enable" then
			if el.trail then el.trail.Enabled = c.on ~= false end
			if el.beam then el.beam.Enabled = c.on ~= false end
			for _, em in ipairs(el.emitters) do pcall(function() em.Enabled = c.on ~= false end) end
		elseif c.act == "regen" then
			el.regen(c.seed or math.random(1, 99999))
		elseif c.act == "hide" then
			setAlpha(el, 1)
		elseif c.act == "show" then
			setAlpha(el, c.to or 0)
		elseif c.act == "warp" then
			-- Move a model outright. A blink that leaves you standing where you
			-- started is not a blink; in game this is the act that actually
			-- relocates the player. Keep the pivot's height ABOVE THE MODEL'S
			-- BASE, not the pivot's absolute Y - a character's pivot sits at the
			-- HumanoidRootPart, so warping to a ground point would bury it.
			local m = el.inst
			if m and m:IsA("Model") then
				local to = anchorPos(c.to) + off(c.to_offset)
				local pivot = m:GetPivot()
				local bcf, bsize = m:GetBoundingBox()
				local lift = pivot.Position.Y - (bcf.Position.Y - bsize.Y / 2)
				m:PivotTo(CFrame.new(to.X, to.Y + lift, to.Z) * (pivot - pivot.Position))
			end
		elseif c.act == "destroy" then
			el.inst:Destroy()
		end
	end

	-- Generation guard. Without it a second play() runs CONCURRENTLY with the first
	-- and they fight over every property: the payload builds and plays through, you
	-- then ask for a frozen phase, and the still-running first loop keeps stepping
	-- the tracks to the end. It reports FROZEN at the time you asked for while the
	-- scene on screen is the end state - a green message over a wrong picture.
	local generation = 0

	local function play(freeze)
		generation = generation + 1
		local mine = generation
		-- Restore every element's AUTHORED look first, then park only the t=0
		-- tracks. Replaying without this leaves the previous run's end state on any
		-- element whose tracks all start late.
		for _, r in ipairs(INITIAL) do pcall(r) end
		for _, tr in ipairs(tracks) do
			tr.done = false
			if tr.park then pcall(tr.apply, 0) end
		end
		for _, em in ipairs(ALL_EMITTERS) do
			pcall(function() em.TimeScale = 1; em:Clear(); em.Enabled = false end)
		end
		task.spawn(function()
			local fired = {}
			local t0 = os.clock()
			while generation == mine do
				local now = os.clock() - t0
				local tt = (freeze >= 0) and math.min(now, freeze) or now
				for i, c in ipairs(cues) do
					if not fired[i] and (c.t or 0) <= tt then fired[i] = true; pcall(fireCue, c) end
				end
				for _, tr in ipairs(tracks) do
					if tt >= tr.t0 then
						local al = (tr.dur <= 0) and 1 or math.clamp((tt - tr.t0) / tr.dur, 0, 1)
						if al < 1 or not tr.done then pcall(tr.apply, al) end
						if al >= 1 then tr.done = true end
					end
				end
				if freeze >= 0 and now >= freeze then break end
				if now > (comp.duration or 4) + 0.6 then break end
				task.wait()
			end
			if generation ~= mine then return end   -- superseded; do not touch anything
			-- Phase freeze: a burst lasts under a second, so an unfrozen screenshot
			-- is a coin flip. TimeScale = 0 holds the exact phase until it is reset.
			if freeze >= 0 then
				for _, em in ipairs(ALL_EMITTERS) do pcall(function() em.TimeScale = 0 end) end
			end
			ctx.report(string.format("FROZEN %s t=%.2f gen=%d emitters=%d tracks=%d cues=%d",
				comp.name, freeze, mine, #ALL_EMITTERS, #tracks, #cues))
			if ctx.onFinish then pcall(ctx.onFinish, freeze) end
		end)
	end

	local built = {}
	for _, e in ipairs(comp.elements) do
		local el = EL[e.id]
		local d = e.kind
		if el.emitters and #el.emitters > 0 then
			d = d .. "(" .. #el.emitters .. "/" .. (el.layerTotal or 0) .. "L"
				.. ((el.skipped or 0) > 0 and (" -" .. el.skipped .. "unwirable") or "") .. ")"
		end
		table.insert(built, e.id .. ":" .. d)
	end
	ctx.report("built " .. comp.name .. " :: " .. table.concat(built, ", "))

	return {
		name = comp.name,
		duration = comp.duration or 3,
		play = play,
		stop = function() generation = generation + 1 end,
		built = built,
		elements = EL,
		emitters = ALL_EMITTERS,
	}
end
