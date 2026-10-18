--!strict
-- Stages 5 and 6 with NO UPLOAD: rebuild a generated MeshPart inside Studio.
--
-- Run through the Studio MCP's execute_luau, in EDIT MODE, after
--   1. blender --background --python scripts/export_for_studio.py -- \
--        --mesh out/low.glb --color out/color.png --outdir serve --name pig
--   2. python scripts/serve_assets.py --dir serve        (localhost only)
--
-- VERIFIED WORKING 2026-08-26 in Studio 0.735.639: 5,998 triangles and a
-- 1024x1024 texture rebuilt in 0.05s, into a place with placeId 0 and no
-- credentials of any kind set.
--
-- WHY THIS EXISTS. The Open Cloud upload needs ROBLOX_API_KEY and the MCP's
-- upload_decal needs that or a ROBLOSECURITY cookie. With neither set there is
-- still a complete path: AssetService can build an EditableMesh and an
-- EditableImage from raw data and hand back a real MeshPart, all in process.
--
-- MEASURED FACTS worth keeping:
--   * HttpService:GetAsync WORKS FROM PLUGIN CONTEXT even with
--     HttpService.HttpEnabled = false. That setting governs game scripts.
--   * GetAsync is BYTE-EXACT on binary bodies. A 251,532 byte blob arrived
--     intact, so buffer.fromstring(body) needs no base64 and no JSON.
--   * CreateMeshPartAsync IS permitted from plugin context in edit mode. That
--     was an open question in this skill for weeks.
--
-- THE LIMIT, and it is real: MeshContent and TextureContent both come back as
-- Enum.ContentSourceType.Object with a nil Uri. They are SESSION-LOCAL objects,
-- not asset URIs, so they will not survive saving or publishing the place. This
-- route is for building, iterating and looking. To make an asset permanent you
-- still need an upload, or Studio's own right-click "Save to Roblox" on the
-- resulting MeshPart.

local HttpService = game:GetService("HttpService")
local AssetService = game:GetService("AssetService")

local BASE = "http://127.0.0.1:48900/"
local FOLDER_NAME = "GeneratedAssets"

local function u32(b: buffer, o: number): number
	return buffer.readu32(b, o)
end

local function buildMesh(name: string): (Instance, number)
	local b = buffer.fromstring(HttpService:GetAsync(BASE .. name .. ".mesh.bin"))
	assert(buffer.readstring(b, 0, 4) == "RMSH", "bad mesh magic for " .. name)

	local nv, nuv, nt = u32(b, 8), u32(b, 12), u32(b, 16)
	local pOff = 20
	local uOff = pOff + nv * 12
	local tOff = uOff + nuv * 8
	local qOff = tOff + nt * 12

	local em = AssetService:CreateEditableMesh()
	local vid, uid = table.create(nv), table.create(nuv)

	for i = 0, nv - 1 do
		local o = pOff + i * 12
		vid[i + 1] = em:AddVertex(Vector3.new(
			buffer.readf32(b, o), buffer.readf32(b, o + 4), buffer.readf32(b, o + 8)))
	end
	for i = 0, nuv - 1 do
		local o = uOff + i * 8
		uid[i + 1] = em:AddUV(Vector2.new(buffer.readf32(b, o), buffer.readf32(b, o + 4)))
	end
	for i = 0, nt - 1 do
		local o, q = tOff + i * 12, qOff + i * 12
		local f = em:AddTriangle(vid[u32(b, o) + 1], vid[u32(b, o + 4) + 1], vid[u32(b, o + 8) + 1])
		em:SetFaceUVs(f, { uid[u32(b, q) + 1], uid[u32(b, q + 4) + 1], uid[u32(b, q + 8) + 1] })
	end

	local part = AssetService:CreateMeshPartAsync(
		Content.fromObject(em),
		{ CollisionFidelity = Enum.CollisionFidelity.Hull }
	)
	return part, nt
end

local function applyTexture(part: MeshPart, name: string): number
	local raw = buffer.fromstring(HttpService:GetAsync(BASE .. name .. ".tex.bin"))
	assert(buffer.readstring(raw, 0, 4) == "RTEX", "bad texture magic for " .. name)
	local n = u32(raw, 4)
	local px = buffer.create(n * n * 4)
	buffer.copy(px, 0, raw, 8, n * n * 4)

	local ei = AssetService:CreateEditableImage({ Size = Vector2.new(n, n) })
	ei:WritePixelsBuffer(Vector2.zero, Vector2.new(n, n), px)
	part.TextureContent = Content.fromObject(ei)
	return n
end

local function groundY(): number
	local bp = workspace:FindFirstChild("Baseplate")
	if bp and bp:IsA("BasePart") then
		return bp.Position.Y + bp.Size.Y / 2
	end
	return 0
end

local ASSETS = { "pig" }   -- edit this line, then paste the whole file into execute_luau

local function importAll(names: { string }): string
	local folder = workspace:FindFirstChild(FOLDER_NAME)
	if folder then
		folder:Destroy()
	end
	folder = Instance.new("Folder")
	folder.Name = FOLDER_NAME
	folder.Parent = workspace

	local y = groundY()
	local report, x = {}, 0
	for _, name in ipairs(names) do
		local part, tris = buildMesh(name)
		local n = applyTexture(part, name)
		part.Name = name:sub(1, 1):upper() .. name:sub(2)
		part.Anchored = true
		-- Sit it ON the ground. Placing at y = size/2 assumes the baseplate top
		-- is at 0, which it is in a default place and is not in general.
		part.CFrame = CFrame.new(x, y + part.Size.Y / 2, 0)
		part.Parent = folder
		x += part.Size.X + 2
		table.insert(report, string.format("%s: %d tris, %dx%d tex, %s studs",
			part.Name, tris, n, n, tostring(part.Size)))
	end
	return table.concat(report, " | ")
end

return importAll(ASSETS)
