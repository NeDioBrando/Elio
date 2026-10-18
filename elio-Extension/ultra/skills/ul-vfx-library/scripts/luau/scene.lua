-- SCENE body. EDIT-MODE front end for the composition engine.
--
-- Everything that is actually shared with the shipped, in-game runtime lives in
-- engine.lua and is spliced in below. This file is only the parts that are
-- specific to authoring in Studio: a stage of named anchor Parts, a freeze time
-- so a burst can be photographed at an exact phase, and a camera.
local COMP_JSON = [==[%COMP_JSON%]==]
local STAGE_PATH = "%TARGET_PATH%"

local comp = HttpService:JSONDecode(COMP_JSON)
local ws = workspace

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

local stage, missing = resolve(STAGE_PATH)
if not stage then error("SCENE_ERROR missing stage segment: " .. tostring(missing)) end

local root = ws:FindFirstChild("__VFX")
if not root then root = Instance.new("Folder"); root.Name = "__VFX"; root.Parent = ws end
-- Clear OTHER compositions too, not just this one. Each scene lands in its own
-- folder, so without this every effect built in a session stays in the shot -
-- and a frozen bolt from the previous effect photographs as part of this one.
-- keep_others is there for deliberately combining two.
for _, c in ipairs(root:GetChildren()) do
	if c.Name == comp.name or not comp.keep_others then c:Destroy() end
end
-- A model element FADES the stage rig and a warp MOVES it; the next composition
-- must not inherit a half-invisible character standing in the wrong place.
local dummy = stage:FindFirstChild("Dummy")
if dummy then
	for _, d in ipairs(dummy:GetDescendants()) do
		if d:IsA("BasePart") and d.Name ~= "HumanoidRootPart" then d.Transparency = 0 end
	end
	local home = dummy:GetAttribute("__home")
	if home then dummy:PivotTo(CFrame.new(home)) else dummy:SetAttribute("__home", dummy:GetPivot().Position) end
end
local fx = Instance.new("Folder"); fx.Name = comp.name; fx.Parent = root

local progress = ws:FindFirstChild("__VFXProgress") or Instance.new("StringValue")
progress.Name = "__VFXProgress"; progress.Parent = ws

--#include engine

local function off(o) o = o or {0, 0, 0}; return Vector3.new(o[1], o[2], o[3]) end

-- In edit mode an anchor is a named BasePart under the stage, or a literal
-- world position. (The in-game runtime resolves the same names against the
-- player's character instead - that is the whole reason for the ctx split.)
local function anchorPos(a)
	if type(a) == "table" then return Vector3.new(a[1], a[2], a[3]) end
	local p = stage:FindFirstChild(a)
	if not p then error("SCENE_ERROR no anchor '" .. tostring(a) .. "' under " .. stage:GetFullName()) end
	return p.Position
end

local engine = makeEngine(comp, {
	anchorPos = anchorPos,
	folder = fx,
	sourceModel = function(n) return stage:FindFirstChild(n or "Dummy") end,
	report = function(s) progress.Value = s end,
})

-- A hand-scale charge and a 27-stud sky bolt cannot share a framing, so each
-- composition carries its own. THE EDIT CAMERA IS AIMABLE, contrary to "camera
-- writes do not stick": Studio re-derives the look direction from Camera.Focus
-- every frame, so a CFrame write ALONE moves the eye and then re-points it at
-- the STALE focus (measured: resulting LookVector == (Focus-Position).Unit,
-- dot 1.0000, which is how it ends up staring at the sky). Write BOTH.
if comp.camera then
	local at = anchorPos(comp.camera.look or "A_Chest") + off(comp.camera.look_offset)
	local eye = at + off(comp.camera.offset or {-12, 6, -18})
	local cam = ws.CurrentCamera
	cam.CFrame = CFrame.lookAt(eye, at)
	cam.Focus = CFrame.new(at)
	if comp.camera.fov then cam.FieldOfView = comp.camera.fov end
end

-- play() is kept in _G so the next phase can be shot with a one-line call
-- instead of recomposing and re-uploading a 60KB payload. Sampling early / mid
-- / late is the whole verify loop, so it has to be cheap.
--
-- PLAY AND CAPTURE MUST BE SEPARATE execute_luau CALLS. A task.spawn'd playback
-- loop does not reliably progress while the calling script sits in a task.wait()
-- loop; between MCP calls the scheduler runs freely. Waiting a fixed duration in
-- the same call and then reading produced a confident measurement of "invisible
-- at every phase" for an effect that was fading perfectly.
_G.__VFXScene = engine
engine.play(tonumber("%FREEZE_AT%"))

print("SCENE_OK " .. comp.name .. " freeze=" .. tostring("%FREEZE_AT%"))
print("SCENE_ELEMENTS " .. table.concat(engine.built, ", "))
return "scene " .. comp.name
