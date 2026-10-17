-- RUNTIME front end. Same engine as the edit-mode authoring scene, but bound to
-- the LIVE PLAYER CHARACTER instead of a stage of anchor Parts.
--
-- This is the half that ships. engine.lua is spliced in verbatim, so an effect
-- tuned in Studio and an effect fired in game cannot drift apart.
--
-- The only real work here is ANCHOR RESOLUTION. A composition says "A_Hand" or
-- "put it 6.5 studs that way"; on a stage those were Parts at fixed world
-- coordinates, and in game they have to follow a character who is standing
-- anywhere and facing any direction. So:
--
--   named anchors  -> resolved off the character's own parts / ground point
--   literal {x,y,z} -> read as CHARACTER SPACE: x right, y up, -z forward,
--                      measured from the point on the floor under the character
--
-- The stage dummy was built unrotated with its front facing -Z, which is why a
-- stage-authored z of -7 means "7 studs in front" and maps to fwd * 7.

local RunService = game:GetService("RunService")
local Players = game:GetService("Players")

--#include engine

local M = {}
local DATA = HttpService:JSONDecode(SCENE_DATA)
M.names = {}
for _, c in ipairs(DATA.order) do table.insert(M.names, c) end
M.titles = DATA.titles

local root = workspace:FindFirstChild("__VFX")
if not root then
	root = Instance.new("Folder"); root.Name = "__VFX"; root.Parent = workspace
end

local current = nil          -- {engine=, folder=, restore={}}

-- Put a character back exactly as it was. A fade or a hide left un-restored
-- means the player stays half-invisible for the rest of the round, which is a
-- far worse bug than the effect looking wrong.
local function snapshotCharacter(char)
	local snap = {}
	for _, d in ipairs(char:GetDescendants()) do
		if d:IsA("BasePart") then snap[d] = d.Transparency
		elseif d:IsA("Decal") or d:IsA("Texture") then snap[d] = d.Transparency end
	end
	return snap
end

local function restore(snap)
	for inst, t in pairs(snap) do
		if inst.Parent then pcall(function() inst.Transparency = t end) end
	end
end

function M.stop()
	if not current then return end
	current.engine.stop()
	restore(current.restore)
	if current.folder and current.folder.Parent then current.folder:Destroy() end
	current = nil
end

function M.play(name, char)
	char = char or (Players.LocalPlayer and Players.LocalPlayer.Character)
	if not char then return false, "no character" end
	local hrp = char:FindFirstChild("HumanoidRootPart")
	if not hrp then return false, "no HumanoidRootPart" end
	local comp = DATA.comps[name]
	if not comp then return false, "no composition '" .. tostring(name) .. "'" end
	comp.recipes = DATA.recipes

	M.stop()

	local cf = hrp.CFrame
	local right, fwd = cf.RightVector, cf.LookVector
	local up = Vector3.new(0, 1, 0)
	local hum = char:FindFirstChildOfClass("Humanoid")

	-- The floor under the character. Raycast so the effect sits on whatever is
	-- actually there rather than on an assumed hip height; fall back to the
	-- humanoid's own numbers when the ray finds nothing (mid-air, void).
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { char, root }
	local hit = workspace:Raycast(hrp.Position, Vector3.new(0, -60, 0), params)
	local groundY = hit and hit.Position.Y
		or (hrp.Position.Y - hrp.Size.Y / 2 - (hum and hum.HipHeight or 2))
	local ground = Vector3.new(hrp.Position.X, groundY, hrp.Position.Z)

	local function findPart(...)
		for _, n in ipairs({ ... }) do
			local p = char:FindFirstChild(n)
			if p and p:IsA("BasePart") then return p end
		end
	end
	-- R15 and R6 name these differently; a demo that only works on one rig type
	-- is a demo that breaks the first time the avatar changes.
	local hand = findPart("RightHand", "Right Arm", "RightLowerArm")
	local head = findPart("Head")

	local NAMED = {
		A_Ground = ground + up * 0.12,
		A_Feet   = ground + up * 0.12,
		A_Waist  = hrp.Position - up * 1.0,
		A_Chest  = hrp.Position + up * 0.3,
		A_Head   = head and (head.Position + up * 0.8) or (ground + up * 5.2),
		A_Air    = ground + up * 4.5,
		A_Sky    = ground + up * 52,
		A_Hand   = hand and (hand.Position + fwd * 0.4)
			or (ground + right * 1.6 + up * 3.6 + fwd * 0.8),
		A_Far    = ground + right * 6 + up * 3 + fwd * 16,
	}

	local function anchorPos(a)
		if type(a) == "table" then
			-- CHARACTER SPACE, not world. x right, y up, -z forward.
			return ground + right * a[1] + up * a[2] + fwd * (-a[3])
		end
		local v = NAMED[a]
		if not v then error("no anchor '" .. tostring(a) .. "'") end
		return v
	end

	local folder = Instance.new("Folder")
	folder.Name = comp.name
	folder.Parent = root

	local snap = snapshotCharacter(char)
	-- The caster's frame, flattened to yaw. Offsets and part rotations go
	-- through THIS, not the world axes: the edit stage's rig faces -Z so the two
	-- coincide there, and a player facing anywhere else used to get every
	-- sideways offset pointing toward world -Z. See the header of engine.lua.
	local flatR = Vector3.new(right.X, 0, right.Z)
	flatR = flatR.Magnitude > 1e-3 and flatR.Unit or Vector3.new(1, 0, 0)
	local flatF = Vector3.new(fwd.X, 0, fwd.Z)
	flatF = flatF.Magnitude > 1e-3 and flatF.Unit or Vector3.new(0, 0, -1)
	local basis = CFrame.fromMatrix(Vector3.new(), flatR, up, -flatF)

	local engine = makeEngine(comp, {
		anchorPos = anchorPos,
		folder = folder,
		sourceModel = function() return char end,
		report = function() end,
		offset = function(o)
			o = o or { 0, 0, 0 }
			return flatR * o[1] + up * o[2] + flatF * (-o[3])
		end,
		basis = basis,
	})

	current = { engine = engine, folder = folder, restore = snap, name = name }
	engine.play(-1)

	-- Tear down after the timeline AND the longest particle tail. Destroying the
	-- folder the instant the timeline ends cuts live particles off mid-flight;
	-- Explosion-01's smoke alone lives up to 4 seconds.
	local mine = current
	task.delay((comp.duration or 3) + (DATA.tail or 4.5), function()
		if current == mine then M.stop() end
	end)
	return true
end

return M
