-- STAGE body. The place an effect is judged in. Run once per session.
--
-- Two things here are not cosmetic:
--
-- 1. THE FLOOR IS OURS. Two pads, a light one and a dark one, because dark smoke
--    on a dark backdrop is invisible and that is staging, not a defect in the
--    effect. The default Baseplate is moved out rather than built on: its top
--    face is at y=0, and a pad sharing that plane z-fights and renders as
--    NOTHING - which looks exactly like a pad that was never created.
--
-- 2. THE RIG PRESENTS ITSELF TO THE DEFAULT VIEW. The camera sits at -X/-Z, so
--    anything on the rig's +X/+Z faces is photographed through the torso. The
--    near arm is raised out to -X so a hand effect clears the body on screen.
--    Screen-right here is world (0.81, 0, -0.55), so separation has to come from
--    -X; offsetting in -Z moves the effect ACROSS the body, not away from it.
local ws = workspace
local old = ws:FindFirstChild("__VFXStage"); if old then old:Destroy() end
local vfx = ws:FindFirstChild("__VFX"); if vfx then vfx:Destroy() end
-- Keep a spawn, do not delete it: the same place is used to AUTHOR effects in
-- edit mode and to PLAY them. Park it clear of the effect radius (~20 studs) so
-- a shockwave does not go off under the player the moment they load in.
local sl = ws:FindFirstChild("SpawnLocation") or game:GetService("ServerStorage"):FindFirstChild("SpawnLocation")
if not sl then sl = Instance.new("SpawnLocation") end
sl.Parent = ws
sl.Anchored = true; sl.CanCollide = true; sl.Size = Vector3.new(8, 1, 8)
sl.CFrame = CFrame.new(0, 0.5, 30)
sl.Transparency = 0.45; sl.Color = Color3.fromRGB(88, 128, 88)
sl.TopSurface = Enum.SurfaceType.Smooth
local bp = ws:FindFirstChild("Baseplate"); if bp then bp.Parent = game.ServerStorage end

local stage = Instance.new("Folder"); stage.Name = "__VFXStage"; stage.Parent = ws

local function part(name, size, cf, colour, mat, parent)
	local p = Instance.new("Part")
	p.Name = name; p.Size = size; p.Anchored = true; p.CanCollide = false
	p.CanQuery = false; p.CanTouch = false
	p.CFrame = cf; p.Color = colour; p.Material = mat
	p.TopSurface = Enum.SurfaceType.Smooth; p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent or stage
	return p
end

part("PadLight", Vector3.new(46, 3, 60), CFrame.new(-23, -1.5, 4),
	Color3.fromRGB(203, 203, 207), Enum.Material.SmoothPlastic)
part("PadDark",  Vector3.new(46, 3, 60), CFrame.new( 23, -1.5, 4),
	Color3.fromRGB(17, 17, 21), Enum.Material.SmoothPlastic)

local rig = Instance.new("Model"); rig.Name = "Dummy"; rig.Parent = stage
local skin  = Color3.fromRGB(215, 197, 154)
local shirt = Color3.fromRGB(52, 100, 164)
local pants = Color3.fromRGB(38, 40, 46)
local function rp(n, s, cf, c) return part(n, s, cf, c, Enum.Material.SmoothPlastic, rig) end
local hrp = rp("HumanoidRootPart", Vector3.new(2, 2, 1), CFrame.new(0, 3, 0), shirt)
hrp.Transparency = 1
rp("Torso",     Vector3.new(2, 2, 1), CFrame.new(0, 3, 0), shirt)
rp("Head",      Vector3.new(2, 1, 1), CFrame.new(0, 4.5, 0), skin)
rp("Right Arm", Vector3.new(1, 2, 1), CFrame.new(1.5, 3, 0), skin)
rp("Left Leg",  Vector3.new(1, 2, 1), CFrame.new(-0.5, 1, 0), pants)
rp("Right Leg", Vector3.new(1, 2, 1), CFrame.new( 0.5, 1, 0), pants)
-- near arm raised out to -X: screen-left, clear of the torso
rp("Left Arm",  Vector3.new(1, 2, 1), CFrame.new(-2.35, 3.65, -0.25) * CFrame.Angles(0, 0, math.rad(72)), skin)
rig.PrimaryPart = hrp

-- Every build target must be a BasePart: an Attachment under a Model or Folder
-- has no world position and the emitters build silently at the world origin.
local anchors = {
	A_Hand   = Vector3.new(-3.5, 4.05, -0.45),   -- end of the raised arm
	A_Chest  = Vector3.new(0, 3.3, -0.7),
	A_Feet   = Vector3.new(0, 0.12, 0),
	A_Ground = Vector3.new(0, 0.12, 0),
	A_Waist  = Vector3.new(0, 2.0, 0),
	A_Head   = Vector3.new(0, 5.2, 0),
	A_Air    = Vector3.new(0, 4.5, 0),
	A_Sky    = Vector3.new(0, 52, 0),
	A_Far    = Vector3.new(6, 3.0, -16),          -- projectile / blink destination
}
for n, p in pairs(anchors) do
	local a = part(n, Vector3.new(0.2, 0.2, 0.2), CFrame.new(p), Color3.new(1, 0, 1), Enum.Material.Neon)
	a.Transparency = 1
end

local L = game:GetService("Lighting")
L.ClockTime = 14; L.Brightness = 2.3; L.EnvironmentDiffuseScale = 0.35
L.Ambient = Color3.fromRGB(70, 70, 76); L.OutdoorAmbient = Color3.fromRGB(110, 110, 118)
L.GlobalShadows = true; L.FogEnd = 100000

local cam = ws.CurrentCamera
local at = Vector3.new(-1.0, 3.4, -0.6)
cam.CFrame = CFrame.lookAt(at + Vector3.new(-7, 2.4, -11), at)
cam.Focus = CFrame.new(at)
cam.FieldOfView = 70
game:GetService("Selection"):Set({})

print("STAGE_OK anchors=" .. tostring(#stage:GetChildren()))
return "staged"
