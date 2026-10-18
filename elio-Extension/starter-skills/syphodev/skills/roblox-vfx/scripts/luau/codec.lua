-- roblox-vfx codec: typed round-trip between Roblox property values and plain JSON.
-- Prepended to every payload by scripts/payload.py. Never edit one copy only.
local HttpService = game:GetService("HttpService")

local VFX = {}

-- Roblox value -> JSON-safe table. Explicit type tags, same convention as Rojo
-- .model.json, so a reader never has to guess what a bare array meant.
function VFX.enc(v)
	local t = typeof(v)
	if t == "number" or t == "string" or t == "boolean" then
		return v
	elseif t == "EnumItem" then
		return { Enum = tostring(v):gsub("^Enum%.", "") }
	elseif t == "Vector3" then
		return { Vector3 = { v.X, v.Y, v.Z } }
	elseif t == "Vector2" then
		return { Vector2 = { v.X, v.Y } }
	elseif t == "Color3" then
		return { Color3 = { v.R, v.G, v.B } }
	elseif t == "NumberRange" then
		return { NumberRange = { v.Min, v.Max } }
	elseif t == "NumberSequence" then
		local kp = {}
		for _, k in ipairs(v.Keypoints) do
			table.insert(kp, { k.Time, k.Value, k.Envelope })
		end
		return { NumberSequence = kp }
	elseif t == "ColorSequence" then
		local kp = {}
		for _, k in ipairs(v.Keypoints) do
			table.insert(kp, { k.Time, { k.Value.R, k.Value.G, k.Value.B } })
		end
		return { ColorSequence = kp }
	end
	return { Unsupported = t }
end

-- JSON-safe table -> Roblox value.
function VFX.dec(v)
	local t = type(v)
	if t == "number" or t == "string" or t == "boolean" then
		return v
	end
	if t ~= "table" then
		return nil
	end
	if v.Enum then
		local cls, item = string.match(v.Enum, "^([%w_]+)%.([%w_]+)$")
		return Enum[cls][item]
	elseif v.Vector3 then
		return Vector3.new(v.Vector3[1], v.Vector3[2], v.Vector3[3])
	elseif v.Vector2 then
		return Vector2.new(v.Vector2[1], v.Vector2[2])
	elseif v.Color3 then
		return Color3.new(v.Color3[1], v.Color3[2], v.Color3[3])
	elseif v.NumberRange then
		return NumberRange.new(v.NumberRange[1], v.NumberRange[2])
	elseif v.NumberSequence then
		local kp = {}
		for _, k in ipairs(v.NumberSequence) do
			table.insert(kp, NumberSequenceKeypoint.new(k[1], k[2], k[3] or 0))
		end
		return NumberSequence.new(kp)
	elseif v.ColorSequence then
		local kp = {}
		for _, k in ipairs(v.ColorSequence) do
			table.insert(kp, ColorSequenceKeypoint.new(k[1], Color3.new(k[2][1], k[2][2], k[2][3])))
		end
		return ColorSequence.new(kp)
	end
	return nil
end

-- MEASURED 2026-08-26, not copied from docs. The MCP's generic property reader
-- returns 6 of these 33, so harvesting through it loses 82% of the effect.
VFX.PROPS = {
	ParticleEmitter = {
		"Acceleration","Brightness","Color","Drag","EmissionDirection","Enabled",
		"FlipbookFramerate","FlipbookLayout","FlipbookMode","FlipbookStartRandom",
		"Lifetime","LightEmission","LightInfluence","LockedToPart","Orientation",
		"Rate","RotSpeed","Rotation","Shape","ShapeInOut","ShapeStyle","Size",
		"SpreadAngle","Speed","Squash","Texture","TimeScale","Transparency",
		"VelocityInheritance","ZOffset","WindAffectsDrag",
	},
	Beam = {
		"Attachment0","Attachment1","Brightness","Color","CurveSize0","CurveSize1",
		"Enabled","FaceCamera","LightEmission","LightInfluence","Segments","Texture",
		"TextureLength","TextureMode","TextureSpeed","Transparency","Width0","Width1","ZOffset",
	},
	Trail = {
		"Attachment0","Attachment1","Brightness","Color","Enabled","FaceCamera",
		"Lifetime","LightEmission","LightInfluence","MaxLength","MinLength","Texture",
		"TextureLength","TextureMode","Transparency","WidthScale",
	},
	PointLight = { "Brightness","Color","Enabled","Range","Shadows" },
}

return VFX
