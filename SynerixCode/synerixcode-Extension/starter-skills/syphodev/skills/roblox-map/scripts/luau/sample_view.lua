--[[
sample_view.lua - read RENDERED colours back as numbers, so a lighting change
is measured instead of judged off a screenshot.

Same capture route the MCP plugin uses (CaptureService -> EditableImage ->
ReadPixelsBuffer), but instead of returning a PNG it projects named world points
through the edit camera and averages a small pixel box at each. Compare runs
before and after a change (one lighting value at a time), or against colours
you sampled from your own rendered reference frames, so the comparison is like
for like.

EVERY FRAME MUST PROVE IT IS FRESH, WITH A CODE THAT CANNOT COLLIDE.
Measured 2026-09-15:
  1. CaptureScreenshot hands back STALE frames: lighting settings returned the
     exact numbers of different settings sampled in earlier runs.
  2. A 3-colour witness did not catch it - an old frame carries a matching
     colour one time in three, and it passed.
So the witness is a row of 6 neon cubes, each on (white) or off (black), set to
a code unique to this capture (64 states, counter kept on a workspace attribute).
The frame is rejected unless all 6 bits read back. Captures are spaced 2 s,
because captures 0.1 s apart timed out.
Studio probably does not redraw the edit viewport while it is not the
foreground window; if every attempt is rejected, bring Studio to the front.

Edit POINTS and WITNESS_ORIGIN for the scene being judged.
]]

local POINTS = {
	{ "pavers", Vector3.new(10, 8, 10) },
	{ "stone_wall", Vector3.new(20, 14, -34.9) },
	{ "cliff_rock", Vector3.new(-60, 20, -32.9) },
	{ "grass_ground", Vector3.new(-50, 8, -25) },
	{ "sand", Vector3.new(-30, 8.1, 22) },
	{ "planks", Vector3.new(56, 7.6, -10) },
}
local WITNESS_ORIGIN = Vector3.new(4, 9.5, 24) -- bits run along +X, 2.5 studs apart
local BITS = 6
local BOX = 12
local ATTEMPTS = 5

local CaptureService = game:GetService("CaptureService")
local AssetService = game:GetService("AssetService")
local cam = workspace.CurrentCamera

local function witnessBits()
	local folder = workspace:FindFirstChild("SampleWitness")
	if folder and not folder:IsA("Folder") then folder:Destroy() folder = nil end
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "SampleWitness"
		folder.Parent = workspace
	end
	local bits = {}
	for i = 1, BITS do
		local p = folder:FindFirstChild("Bit" .. i)
		if not p then
			p = Instance.new("Part")
			p.Name = "Bit" .. i
			p.Anchored = true
			p.CanCollide = false
			p.CastShadow = false
			p.Size = Vector3.new(1.6, 1.6, 1.6)
			p.Parent = folder
		end
		p.Position = WITNESS_ORIGIN + Vector3.new((i - 1) * 2.5, 0, 0)
		bits[i] = p
	end
	return bits
end

local function boxMean(img, sx, sy, world, box)
	box = box or BOX
	local v, on = cam:WorldToViewportPoint(world)
	local px, py = math.floor(v.X * sx), math.floor(v.Y * sy)
	if not on or v.Z <= 0 or px < box or py < box or px > img.Size.X - box or py > img.Size.Y - box then
		return nil
	end
	local buf = img:ReadPixelsBuffer(Vector2.new(px - box / 2, py - box / 2), Vector2.new(box, box))
	local r, g, b, n = 0, 0, 0, box * box
	for i = 0, n - 1 do
		r += buffer.readu8(buf, i * 4)
		g += buffer.readu8(buf, i * 4 + 1)
		b += buffer.readu8(buf, i * 4 + 2)
	end
	return r / n, g / n, b / n
end

local bits = witnessBits()
local code = ((workspace:GetAttribute("SampleCode") or 0) + 1) % (2 ^ BITS)
workspace:SetAttribute("SampleCode", code)
for i = 1, BITS do
	local on = math.floor(code / 2 ^ (i - 1)) % 2 == 1
	bits[i].Material = on and Enum.Material.Neon or Enum.Material.SmoothPlastic
	bits[i].Color = on and Color3.new(1, 1, 1) or Color3.new(0, 0, 0)
end

for attempt = 1, ATTEMPTS do
	task.wait(2.0)
	local cid
	CaptureService:CaptureScreenshot(function(id) cid = id end)
	local waited = 0
	while not cid and waited < 20 do
		waited += task.wait(0.2)
	end
	if cid then
		local img = AssetService:CreateEditableImageAsync(Content.fromUri(cid))
		local sx, sy = img.Size.X / cam.ViewportSize.X, img.Size.Y / cam.ViewportSize.Y
		-- Each bit is judged from a small WINDOW, not one projected pixel. A single
		-- pixel at the projected centre rejected a genuinely fresh frame on
		-- 2026-09-15: a manual capture moments later showed the witness exactly
		-- where it should be, and the pixel had landed just off its edge.
		local read = 0
		local ok = true
		for i = 1, BITS do
			local r, g, b = boxMean(img, sx, sy, bits[i].Position, 6)
			if not r then ok = false break end
			if (r + g + b) / 3 > 128 then read += 2 ^ (i - 1) end
		end
		if ok and read == code then
			local lines = { ("fresh frame: code %d read back on attempt %d"):format(code, attempt) }
			for _, pt in ipairs(POINTS) do
				local r, g, b = boxMean(img, sx, sy, pt[2])
				table.insert(lines, r and ("%s #%02x%02x%02x"):format(pt[1], r, g, b) or (pt[1] .. " OFFSCREEN"))
			end
			img:Destroy()
			return table.concat(lines, "\n")
		end
		img:Destroy()
	end
end
return ("NO FRESH FRAME in %d attempts (wanted code %d). Is Studio the foreground window?"):format(ATTEMPTS, code)
