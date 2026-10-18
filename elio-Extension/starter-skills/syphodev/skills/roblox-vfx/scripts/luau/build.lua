-- BUILD body. Recipe JSON -> live instances, with the transform layer applied.
-- Retrieval alone is copy-paste; the transforms are what make it a skill.
local RECIPE_JSON = [==[%RECIPE_JSON%]==]
local TARGET_PATH = "%TARGET_PATH%"
local XFORM_JSON  = [==[%XFORM_JSON%]==]

local recipe = HttpService:JSONDecode(RECIPE_JSON)
local xf = HttpService:JSONDecode(XFORM_JSON)
local scale     = xf.scale or 1
local tint      = xf.tint            -- {r,g,b} 0-1, or nil to keep the original colour
local lifeMul   = xf.lifetime_mul or 1
local rateMul   = xf.rate_mul or 1
local nameSuffix= xf.name_suffix or ""

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

local target, missing = resolve(TARGET_PATH)
if not target then
	print("BUILD_ERROR missing segment: " .. tostring(missing))
	return "error"
end

-- TARGET MUST BE A BasePart. An Attachment parented to a Folder or Model has no
-- world position, so the emitters build silently at the origin and the effect
-- appears to work while sitting nowhere near the thing it belongs to.
if not target:IsA("BasePart") then
	print("BUILD_ERROR target is a " .. target.ClassName .. ", needs a BasePart")
	return "error"
end

local tag = recipe.name .. nameSuffix
for _, c in ipairs(target:GetChildren()) do
	if c:IsA("Attachment") and c:GetAttribute("VFXTag") == tag then c:Destroy() end
end

-- Scale a NumberSequence's values without touching its shape.
local function scaleSeq(seq, k)
	local kp = {}
	for _, p in ipairs(seq.Keypoints) do
		table.insert(kp, NumberSequenceKeypoint.new(p.Time, p.Value * k, p.Envelope * k))
	end
	return NumberSequence.new(kp)
end

-- Tint preserves the LUMINANCE ramp and replaces the hue. A flat colour swap
-- destroys the bright-core-to-dark-tail arc that reads as fire.
local function tintSeq(seq, rgb)
	local kp = {}
	for _, p in ipairs(seq.Keypoints) do
		local lum = 0.2126 * p.Value.R + 0.7152 * p.Value.G + 0.0722 * p.Value.B
		table.insert(kp, ColorSequenceKeypoint.new(p.Time,
			Color3.new(
				math.clamp(rgb[1] * lum * 1.6, 0, 1),
				math.clamp(rgb[2] * lum * 1.6, 0, 1),
				math.clamp(rgb[3] * lum * 1.6, 0, 1))))
	end
	return ColorSequence.new(kp)
end

local built = {}
for _, layer in ipairs(recipe.layers) do
	local att = Instance.new("Attachment")
	att.Name = tag .. "_" .. layer.name
	att:SetAttribute("VFXTag", tag)
	att.Position = Vector3.new(layer.offset[1] * scale, layer.offset[2] * scale, layer.offset[3] * scale)
	att.Parent = target

	local inst = Instance.new(layer.class)
	inst.Name = layer.name
	for p, v in pairs(layer.props) do
		if type(v) ~= "table" or not v.Ref then
			local ok, decoded = pcall(VFX.dec, v)
			if ok and decoded ~= nil then
				pcall(function() inst[p] = decoded end)
			end
		end
	end

	-- transforms, applied after the base properties land
	if scale ~= 1 then
		pcall(function() inst.Size = scaleSeq(inst.Size, scale) end)
		pcall(function() inst.Speed = NumberRange.new(inst.Speed.Min * scale, inst.Speed.Max * scale) end)
		pcall(function() inst.Acceleration = inst.Acceleration * scale end)
		pcall(function() inst.Range = inst.Range * scale end)
	end
	if tint then
		pcall(function() inst.Color = tintSeq(inst.Color, tint) end)
	end
	if lifeMul ~= 1 then
		pcall(function() inst.Lifetime = NumberRange.new(inst.Lifetime.Min * lifeMul, inst.Lifetime.Max * lifeMul) end)
	end
	if rateMul ~= 1 then
		pcall(function() inst.Rate = inst.Rate * rateMul end)
	end

	-- Emit metadata travels WITH the instance as attributes, so the runtime
	-- script needs no copy of the recipe to know what to fire and how.
	local em = layer.emit or {}
	inst:SetAttribute("EmitMode", em.mode or "continuous")
	if em.count then inst:SetAttribute("EmitCount", math.max(1, math.floor(em.count * scale))) end
	if em.seconds then inst:SetAttribute("PulseSeconds", em.seconds) end
	if em.from then inst:SetAttribute("PulseFrom", em.from * scale) end
	inst:SetAttribute("VFXTag", tag)

	-- A burst layer must not also stream. Rate>0 with a burst mode is the
	-- commonest authoring slip and it reads as "the effect never stops".
	if (em.mode == "burst") then
		pcall(function() inst.Rate = 0 end)
	end
	if inst:IsA("PointLight") and (em.mode == "pulse") then
		inst.Brightness = 0
	end

	-- A Beam/Trail needs TWO attachments wired to it. Without this it builds,
	-- reports success and draws absolutely nothing.
	if layer.endpoints then
		local made = {}
		for i, ep in ipairs(layer.endpoints) do
			local e = Instance.new("Attachment")
			e.Name = tag .. "_" .. layer.name .. "_A" .. (i - 1)
			e:SetAttribute("VFXTag", tag)
			e.Position = Vector3.new(ep.offset[1] * scale, ep.offset[2] * scale, ep.offset[3] * scale)
			e.Parent = target
			made[i] = e
		end
		pcall(function() inst.Attachment0 = made[1] end)
		pcall(function() inst.Attachment1 = made[2] end)
	end

	inst.Parent = att
	table.insert(built, layer.class .. ":" .. layer.name)
end

print("BUILD_OK target=" .. target:GetFullName() .. " tag=" .. tag .. " layers=" .. #built)
print("BUILD_LAYERS " .. table.concat(built, ", "))
return "built " .. #built
