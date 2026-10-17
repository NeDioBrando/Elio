-- SUPERSEDED 2026-08-26 by references/studio_import.lua, which is verified
-- working. This file predates it and was never run. Kept for reference only.

--!strict
-- Stage 6: turn uploaded asset ids into a placed, correctly configured MeshPart.
--
-- Run via the Studio MCP's execute_luau, or paste into the command bar. Fill in
-- the ids from upload_asset.py, which prints them as `assetId=...`.
--
-- Why this is a script and not a checklist: CollisionFidelity and RenderFidelity
-- are the two settings that cost performance silently, and the ones a human
-- forgets. A 10k-triangle mesh left on Precise is a physics trap that only shows
-- up at twenty instances, by which point nobody connects it to the import.

local InsertService = game:GetService("InsertService")
local Workspace = game:GetService("Workspace")

local CONFIG = {
	name = "GeneratedAsset",

	-- From upload_asset.py. The MODEL id is the mesh; the IMAGE ids are the maps.
	modelAssetId = 0,       -- required, uploaded as assetType Model
	normalMapId = 0,        -- optional
	colorMapId = 0,         -- optional, Hi3DGen does NOT produce one
	roughnessMapId = 0,     -- optional
	metalnessMapId = 0,     -- optional

	-- Box is cheapest and right for props. Hull for anything the player walks on
	-- or shoots around. Precise only if the shape genuinely matters to gameplay,
	-- and then only for a handful of instances.
	collisionFidelity = Enum.CollisionFidelity.Box,
	renderFidelity = Enum.RenderFidelity.Automatic,

	-- SurfaceAppearance replaces the whole surface. AlphaMode Overlay keeps the
	-- part's own Color visible through the maps, which is how one grey mesh
	-- becomes five colour variants without five uploads.
	alphaMode = Enum.AlphaMode.Overlay,

	position = Vector3.new(0, 5, 0),
	anchored = true,
}

local function findMeshPart(root: Instance): MeshPart?
	if root:IsA("MeshPart") then
		return root
	end
	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("MeshPart") then
			return descendant
		end
	end
	return nil
end

local function wire()
	assert(CONFIG.modelAssetId ~= 0, "set CONFIG.modelAssetId to the uploaded Model id")

	-- LoadAsset returns a Model container, not the MeshPart itself. Reaching
	-- straight for .MeshPart on the result is the usual first failure here.
	local container = InsertService:LoadAsset(CONFIG.modelAssetId)
	local mesh = findMeshPart(container)
	assert(mesh, "no MeshPart inside asset " .. tostring(CONFIG.modelAssetId))

	mesh.Name = CONFIG.name
	mesh.Anchored = CONFIG.anchored
	mesh.CollisionFidelity = CONFIG.collisionFidelity
	mesh.RenderFidelity = CONFIG.renderFidelity

	local anyMap = CONFIG.normalMapId ~= 0 or CONFIG.colorMapId ~= 0
		or CONFIG.roughnessMapId ~= 0 or CONFIG.metalnessMapId ~= 0

	if anyMap then
		local appearance = Instance.new("SurfaceAppearance")
		appearance.AlphaMode = CONFIG.alphaMode
		if CONFIG.colorMapId ~= 0 then
			appearance.ColorMap = "rbxassetid://" .. CONFIG.colorMapId
		end
		if CONFIG.normalMapId ~= 0 then
			appearance.NormalMap = "rbxassetid://" .. CONFIG.normalMapId
		end
		if CONFIG.roughnessMapId ~= 0 then
			appearance.RoughnessMap = "rbxassetid://" .. CONFIG.roughnessMapId
		end
		if CONFIG.metalnessMapId ~= 0 then
			appearance.MetalnessMap = "rbxassetid://" .. CONFIG.metalnessMapId
		end
		appearance.Parent = mesh
	end

	mesh.Parent = Workspace
	mesh:PivotTo(CFrame.new(CONFIG.position))
	container:Destroy()

	-- Report the numbers rather than "done", so a wrong-sized or wrong-facing
	-- import is visible immediately instead of at assembly time.
	local size = mesh.Size
	print(string.format(
		"[wire] %s placed. size = %.2f x %.2f x %.2f studs, collision = %s, maps = %s",
		mesh.Name, size.X, size.Y, size.Z,
		CONFIG.collisionFidelity.Name,
		anyMap and "yes" or "none"
	))
	print("[wire] CHECK: is that the size you asked for, and is it facing the camera?")

	return mesh
end

return wire()
