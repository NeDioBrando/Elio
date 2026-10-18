--[[
install_dressing.lua - put a map's generated meshes INTO THE PLACE, in edit mode.

    python create-roblox-game/scripts/studio_mcp.py luau --file <this file>

Then SAVE the place. Run it again whenever MapDressing is regenerated; it
replaces the folder wholesale, so it is idempotent.

THE DEFECT THIS EXISTS FOR. A tower-defense map's 336 meshes (objective,
landmarks, bush ring, scatter) were cloned by a server service at boot. It
worked and every gate was green, but the world was EMPTY in edit mode: nothing
to see or select in Studio, nothing in the saved place, and the static scenery
depended on a script running. The review was blunt: why build every mesh at
runtime when it should be in the place itself? Static scenery belongs in the place. Only things that SPAWN (towers,
enemies, pickups) are cloned at runtime, from templates that also live in the
place.

Why this cannot go through Rojo: MeshPart.MeshId is not writable by
property assignment, so Rojo cannot sync a mesh. The folder is parented to
Workspace BESIDE the Rojo-mounted Workspace.Map (a Rojo node with no $path keeps
unknown children), never inside it (Rojo deletes runtime children of its own
subtree on reconnect, and MapQuery searches Workspace.Map by folder name).

Inputs, edit the CONFIG block if a game differs:
  - rows: a ModuleScript returning { {mesh, pos={x,y,z} (BASE centre), yaw, studs, collide} }
    (your own placement list, for example Config/MapDressing.luau)
  - templates: a folder of textured MeshPart templates by name
    (roblox-3d-model mesh_bank.py's installer builds ReplicatedStorage.MeshTemplates)
Returns JSON {placed, missing, folder}.
]]
local CONFIG = {
	rows = game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"):WaitForChild("MapDressing"),
	templates = game:GetService("ReplicatedStorage"):WaitForChild("MeshTemplates"),
	folderName = "MapDressing",
}

local HttpService = game:GetService("HttpService")
-- clone the module so an edited file is read fresh (require is cached per session)
local rows = require(CONFIG.rows:Clone())
local old = workspace:FindFirstChild(CONFIG.folderName)
if old then
	old:Destroy()
end
local folder = Instance.new("Folder")
folder.Name = CONFIG.folderName
local placed, missing = 0, {}
for _, r in rows do
	local t = CONFIG.templates:FindFirstChild(r.mesh)
	if not t then
		missing[r.mesh] = (missing[r.mesh] or 0) + 1
		continue
	end
	local p = t:Clone()
	local s = p.Size
	if r.studs then
		p.Size = s * (r.studs / math.max(s.X, s.Y, s.Z))
	end
	p.CFrame = CFrame.new(r.pos[1], r.pos[2] + p.Size.Y / 2, r.pos[3]) * CFrame.Angles(0, math.rad(r.yaw or 0), 0)
	p.Anchored = true
	if r.collide ~= nil then
		p.CanCollide = r.collide
	end
	p.CanQuery = false
	p.CanTouch = false
	p.Locked = true -- scenery: not selectable by a stray click in Studio
	p.Parent = folder
	placed += 1
end
folder.Parent = workspace
return HttpService:JSONEncode({ placed = placed, missing = missing, folder = folder:GetFullName() })
