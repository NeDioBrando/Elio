--[[
	inspect_pose.luau — reports where each limb is pointing on a rig RIGHT NOW,
	in the character's own frame. Use it after scrubbing Eclipse to a frame
	(Eclipse previews by moving the joints, so world positions are live).

	Usage (execute_luau, Edit datamodel): prepend `local RIG = "Workspace.MyRig"`.

	Output per limb: a direction as forward/right/up components (-1..1)
	relative to the rig's root part (HumanoidRootPart, or Torso on R6), plus
	a plain-words summary — e.g. "RightArm: forward 0.98 right 0.05 up 0.10
	(forward)". Compare this with what the pose was SUPPOSED to be.
]]

local RIG = RIG :: any
local rig: Model = workspace
for seg in string.gmatch(RIG, "[^%.]+") do
	if seg ~= "Workspace" then
		rig = (rig :: any)[seg]
	end
end

local rootPart = rig:FindFirstChild("HumanoidRootPart") or rig:FindFirstChild("Torso") or rig.PrimaryPart
assert(rootPart and rootPart:IsA("BasePart"), "rig has no root part")
local rootCf = rootPart.CFrame

local function p(name: string): BasePart?
	local x = rig:FindFirstChild(name)
	return (x and x:IsA("BasePart")) and x or nil
end

-- limb = from part -> to part (direction of the segment)
local isR15 = p("UpperTorso") ~= nil
local limbs = isR15
		and {
			{ "RightArm", "RightUpperArm", "RightHand" },
			{ "LeftArm", "LeftUpperArm", "LeftHand" },
			{ "RightForearm", "RightLowerArm", "RightHand" },
			{ "LeftForearm", "LeftLowerArm", "LeftHand" },
			{ "RightLeg", "RightUpperLeg", "RightFoot" },
			{ "LeftLeg", "LeftUpperLeg", "LeftFoot" },
			{ "RightShin", "RightLowerLeg", "RightFoot" },
			{ "LeftShin", "LeftLowerLeg", "LeftFoot" },
			{ "Spine", "LowerTorso", "Head" },
		}
	or {
		{ "RightArm", "Right Arm", nil },
		{ "LeftArm", "Left Arm", nil },
		{ "RightLeg", "Right Leg", nil },
		{ "LeftLeg", "Left Leg", nil },
	}

local function words(f: number, r: number, u: number): string
	local parts = {}
	if f > 0.5 then table.insert(parts, "forward") elseif f < -0.5 then table.insert(parts, "back") end
	if r > 0.5 then table.insert(parts, "right") elseif r < -0.5 then table.insert(parts, "left") end
	if u > 0.5 then table.insert(parts, "up") elseif u < -0.5 then table.insert(parts, "down") end
	return #parts > 0 and table.concat(parts, "+") or "diagonal"
end

local out = {}
for _, limb in ipairs(limbs) do
	local a, b = p(limb[2]), limb[3] and p(limb[3])
	if a then
		-- R6 limbs are single parts: use the part's own down axis
		local dir = b and (b.Position - a.Position).Unit or -a.CFrame.UpVector
		local f, r, u = dir:Dot(rootCf.LookVector), dir:Dot(rootCf.RightVector), dir:Dot(rootCf.UpVector)
		table.insert(out, ("%-13s forward %5.2f  right %5.2f  up %5.2f  (%s)"):format(limb[1], f, r, u, words(f, r, u)))
	end
end

local head = p("Head")
if head then
	local look = head.CFrame.LookVector
	table.insert(out, ("%-13s looks: forward %5.2f  right %5.2f  up %5.2f"):format(
		"Head", look:Dot(rootCf.LookVector), look:Dot(rootCf.RightVector), look:Dot(rootCf.UpVector)))
end
local hips = p("LowerTorso") or p("Torso")
if hips then
	local off = rootCf:PointToObjectSpace(hips.Position)
	table.insert(out, ("Hips offset from root (studs): x %.2f  y %.2f  z %.2f"):format(off.X, off.Y, off.Z))
end
return table.concat(out, "\n")
