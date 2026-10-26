--[[
	build_sequence.luau — writes a KeyframeSequence into <rig>.AnimSaves so
	Eclipse Animator lists it under "Animations" for that rig.

	Usage (execute_luau, Edit datamodel): prepend a SPEC table, then this file.

	local SPEC = {
		rig = "Workspace.MyRig",      -- full path to the rig Model
		name = "Punch",               -- KeyframeSequence name (overwrites same name)
		fps = 60,                     -- frames per second for `frame` values
		loop = false,
		priority = "Action",          -- Core | Idle | Movement | Action | Action2..4
		keys = {
			{ frame = 0, poses = {
				RightUpperArm = { rot = {0, 0, 0} },
			}},
			{ frame = 12, poses = {
				-- rot = degrees about the joint's X, Y, Z (CFrame.fromEulerAnglesXYZ)
				-- pos = studs offset in joint space (optional)
				-- ease = Linear | Constant | Cubic | Elastic | Bounce (default Cubic)
				-- dir  = TWEEN-STYLE feel: "Out" = fast start, soft landing;
				--        "In" = slow start, fast end; "InOut". Default "Out".
				RightUpperArm = { rot = {90, 0, 20}, ease = "Cubic", dir = "Out" },
			}},
		},
	}

	Notes
	- Pose names are part names; the Pose hierarchy is derived from the rig's
	  Motor6D tree, so R6, R15 and custom rigs all work.
	- A key applies to the segment that STARTS at that key (Roblox semantics).
	- Roblox's PoseEasingDirection is inverted relative to TweenService; this
	  script flips it so `dir` reads like a tween. Verified in Eclipse: a key
	  written with PoseEasingDirection.In bakes as a fast start.
	- Parent parts that are not keyed at a keyframe get a Weight-0 placeholder
	  Pose (needed for the hierarchy).
]]

local SPEC = SPEC :: any
assert(type(SPEC) == "table", "define `local SPEC = {...}` above this script")

local function resolve(path: string): Instance
	local inst: Instance = game
	for seg in string.gmatch(path, "[^%.]+") do
		if inst == game and seg ~= "Workspace" then
			inst = game:GetService(seg)
		elseif inst == game then
			inst = workspace
		else
			local nextInst = inst:FindFirstChild(seg)
			assert(nextInst, ("'%s' not found under %s"):format(seg, inst:GetFullName()))
			inst = nextInst
		end
	end
	return inst
end

local rig = resolve(SPEC.rig)
assert(rig:IsA("Model"), "rig must be a Model")

-- Build child -> parent part map from the animatable joints (Part1 is the child).
-- Rigs use Motor6D (classic) or AnimationConstraint (newer avatar rigs, e.g.
-- Players:CreateHumanoidModelFromDescription); support both.
local function jointParts(j: Instance): (BasePart?, BasePart?)
	if j:IsA("Motor6D") then
		return j.Part0, j.Part1
	elseif j:IsA("AnimationConstraint") then
		local a0, a1 = (j :: any).Attachment0, (j :: any).Attachment1
		local p0 = a0 and a0.Parent
		local p1 = a1 and a1.Parent
		return (p0 and p0:IsA("BasePart")) and p0 or nil, (p1 and p1:IsA("BasePart")) and p1 or nil
	end
	return nil, nil
end

local parentOf: { [string]: string } = {}
local root: string? = nil
for _, j in ipairs(rig:GetDescendants()) do
	local p0, p1 = jointParts(j)
	if p0 and p1 then
		parentOf[p1.Name] = p0.Name
	end
end
for child, parent in pairs(parentOf) do
	if parentOf[parent] == nil then
		root = parent
	end
end
assert(root, "no Motor6D/AnimationConstraint joint tree found in rig")

local styleMap = {
	Linear = Enum.PoseEasingStyle.Linear,
	Constant = Enum.PoseEasingStyle.Constant,
	Cubic = Enum.PoseEasingStyle.Cubic,
	Elastic = Enum.PoseEasingStyle.Elastic,
	Bounce = Enum.PoseEasingStyle.Bounce,
}
-- tween-style feel -> Roblox PoseEasingDirection (inverted)
local dirMap = {
	Out = Enum.PoseEasingDirection.In,
	In = Enum.PoseEasingDirection.Out,
	InOut = Enum.PoseEasingDirection.InOut,
}

local fps = SPEC.fps or 60
local ks = Instance.new("KeyframeSequence")
ks.Name = SPEC.name
ks.Loop = SPEC.loop == true
ks.Priority = Enum.AnimationPriority[SPEC.priority or "Action"]

local warnings = {}
local lastFrame = 0
for _, key in ipairs(SPEC.keys) do
	lastFrame = math.max(lastFrame, key.frame)
	local kf = Instance.new("Keyframe")
	kf.Time = key.frame / fps
	if key.marker then
		local marker = Instance.new("KeyframeMarker")
		marker.Name = key.marker
		marker.Parent = kf
	end
	if key.name then
		kf.Name = key.name
	end
	local made: { [string]: Pose } = {}
	local function getPose(partName: string): Pose
		if made[partName] then
			return made[partName]
		end
		local p = Instance.new("Pose")
		p.Name = partName
		p.Weight = 0 -- placeholder until keyed
		local parentName = parentOf[partName]
		p.Parent = parentName and getPose(parentName) or kf
		made[partName] = p
		return p
	end
	for partName, data in pairs(key.poses or {}) do
		if partName ~= root and parentOf[partName] == nil then
			table.insert(warnings, ("frame %d: '%s' is not a jointed part of the rig, skipped"):format(key.frame, partName))
			continue
		end
		local pose = getPose(partName)
		local r = data.rot or { 0, 0, 0 }
		local t = data.pos or { 0, 0, 0 }
		pose.CFrame = CFrame.new(t[1], t[2], t[3])
			* CFrame.fromEulerAnglesXYZ(math.rad(r[1]), math.rad(r[2]), math.rad(r[3]))
		pose.Weight = 1
		pose.EasingStyle = styleMap[data.ease or "Cubic"] or Enum.PoseEasingStyle.Cubic
		pose.EasingDirection = dirMap[data.dir or "Out"] or Enum.PoseEasingDirection.In
	end
	kf.Parent = ks
end

local saves = rig:FindFirstChild("AnimSaves")
if not saves then
	saves = Instance.new("Model")
	saves.Name = "AnimSaves"
	saves.Parent = rig
end
local old = saves:FindFirstChild(SPEC.name)
if old then
	old:Destroy()
end
ks.Parent = saves
game:GetService("Selection"):Set({ rig })

return ("Wrote %s.AnimSaves.%s: %d keyframes, %d frames (%.2fs @ %d fps). Rig selected.%s"):format(
	rig:GetFullName(), ks.Name, #SPEC.keys, lastFrame, lastFrame / fps, fps,
	#warnings > 0 and ("\nWARN: " .. table.concat(warnings, "\nWARN: ")) or ""
)
