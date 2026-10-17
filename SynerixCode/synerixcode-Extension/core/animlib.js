// SPDX-License-Identifier: GPL-3.0-or-later
// core/animlib.js - RobloxScript animation tools (virtual commands).
//
// HOW IT WORKS: Roblox Studio's MCP server (StudioMCP) only advertises its own
// fixed tool list - we cannot add tools to it. But execute_luau can run
// ARBITRARY Lua in Studio, and Roblox's animation data model (KeyframeSequence
// -> Keyframe -> Pose tree, pose.CFrame per bone) is fully creatable and
// editable from an ordinary script. So every animation_* command is resolved
// HERE (in the extension) into a small execute_luau call that drives a shared
// Luau library kept in ServerStorage.RobloxScript.AnimLib. Animation state
// (rig + keyframe data) lives on Studio instances, so it survives across calls
// for the whole place session.
//
// All commands return a JSON string from Luau: {"ok":true,"data":...} or
// {"ok":false,"error":...}. Nothing is ever faked - unsupported operations
// fail loudly.

// The Luau library, embedded verbatim into every animation_* execute_luau call
// (the same self-contained source, so a stale copy in ServerStorage can never
// diverge). __ARGS_JSON__ is replaced by the specific call's arguments.
const ANIM_LIB_LUA = `local HttpService = game:GetService("HttpService")
local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")

local function jenc(x) return HttpService:JSONEncode(x) end
local function jdec(s) return HttpService:JSONDecode(s) end
local function fail(msg) return jenc({ ok = false, error = msg }) end
local function okdata(d, text) return jenc({ ok = true, data = d, text = text or "" }) end

-- AnimScript owns a distinct folder. Migrate a previous RobloxScript library in
-- place so existing animations and memory are retained rather than copied.
local RSROOT = ServerStorage:FindFirstChild("RobloxScript") or ServerStorage:FindFirstChild("AnimScript")
if not RSROOT then
	local legacy = ServerStorage:FindFirstChild("RobloxScript")
	if legacy then
		legacy.Name = "AnimScript"
		RSROOT = legacy
	else
		RSROOT = Instance.new("Folder"); RSROOT.Name = "RobloxScript"; RSROOT.Parent = ServerStorage
	end
end
local LIB = RSROOT:FindFirstChild("AnimLib")
if not LIB then LIB = Instance.new("Folder"); LIB.Name = "AnimLib"; LIB.Parent = RSROOT end
local ACTIVE = LIB:FindFirstChild("Active")
if not ACTIVE then ACTIVE = Instance.new("StringValue"); ACTIVE.Name = "Active"; ACTIVE.Parent = LIB end
local RIGREF = LIB:FindFirstChild("Rig")
if not RIGREF then RIGREF = Instance.new("StringValue"); RIGREF.Name = "Rig"; RIGREF.Parent = LIB end
local LENGTH = LIB:FindFirstChild("Length")
if not LENGTH then LENGTH = Instance.new("NumberValue"); LENGTH.Name = "Length"; LENGTH.Parent = LIB; LENGTH.Value = 1 end
-- Preview state has to outlive a single execute_luau call. A local flag is
-- recreated for every command, which made stop_preview unable to stop a run.
local PREVIEW_TOKEN = LIB:FindFirstChild("PreviewToken")
if not PREVIEW_TOKEN then PREVIEW_TOKEN = Instance.new("IntValue"); PREVIEW_TOKEN.Name = "PreviewToken"; PREVIEW_TOKEN.Parent = LIB end
local PREVIEW_RIG = LIB:FindFirstChild("PreviewRig")
if not PREVIEW_RIG then PREVIEW_RIG = Instance.new("StringValue"); PREVIEW_RIG.Name = "PreviewRig"; PREVIEW_RIG.Parent = LIB end
-- An intentional rig choice guides NEW animations. Pinned animations retain
-- their own rig, and automatic discovery is still fresh when this is empty.
local SELECTED_RIG = LIB:FindFirstChild("SelectedRig")
if not SELECTED_RIG then SELECTED_RIG = Instance.new("StringValue"); SELECTED_RIG.Name = "SelectedRig"; SELECTED_RIG.Parent = LIB end

local function resolvePath(p)
	if p == nil or p == "" then return nil end
	local node = game
	for _, s in ipairs(string.split(p, ".")) do
		node = node:FindFirstChild(s)
		if not node then return nil end
	end
	return node
end

local function pathOf(inst)
	local parts = {}
	local cur = inst
	while cur and cur ~= game do
		parts[#parts + 1] = cur.Name
		cur = cur.Parent
	end
	local rev = {}
	for i = 1, #parts do rev[i] = parts[#parts - i + 1] end
	return table.concat(rev, ".")
end

-- Rig discovery: ALWAYS scan the workspace fresh. No caching - a cached rig
-- path stored in ServerStorage survives across Studio sessions and can keep
-- pointing at an old R6 dummy forever, which is exactly how a stale "7-bone
-- rig" kept winning. The rig with the most joint-connected bones wins.
local function findRig()
	local selected = resolvePath(SELECTED_RIG.Value)
	if selected and selected:IsA("Model") and selected:FindFirstChildOfClass("Humanoid") and
		(selected:FindFirstChild("HumanoidRootPart") or selected.PrimaryPart or selected:FindFirstChild("Torso") or selected:FindFirstChild("UpperTorso")) then
		return selected
	end
	local best = nil
	local bestScore = -1
	for _, m in ipairs(workspace:GetDescendants()) do
		if m:IsA("Model") then
			local h = m:FindFirstChildOfClass("Humanoid")
			local root = m:FindFirstChild("HumanoidRootPart") or m.PrimaryPart
			if h and root and #m:GetDescendants() > 10 then
				local score = 0
				for _, d in ipairs(m:GetDescendants()) do
					if d:IsA("Motor6D") or d:IsA("AnimationConstraint") or d:IsA("BallSocketConstraint") then score = score + 1 end
				end
				if score > bestScore then bestScore = score; best = m end
			end
		end
	end
	return best
end

-- The rig an animation is PINNED to (stored as a path attribute on the
-- KeyframeSequence). When multiple rigs exist in the workspace - e.g. an R6
-- blocky dummy next to the real R15 Avatar-Joint-Upgrade character - the
-- pinned rig guarantees keyframes, preview and apply all drive the SAME rig
-- the animation was built on.
local function pinOf(anim)
	local p = anim and anim:GetAttribute("RS_RigPath")
	if typeof(p) ~= "string" or p == "" then return nil end
	local rig = resolvePath(p)
	if rig and rig:IsA("Model") and rig:FindFirstChildOfClass("Humanoid") then return rig end
	return nil
end

local function activeRig(anim)
	local pinned = pinOf(anim)
	if pinned then return pinned end
	return findRig()
end

local function rigRoot(rig)
	for _, p in ipairs(rig:GetDescendants()) do
		if p.Name == "HumanoidRootPart" and p:IsA("BasePart") then return p end
	end
	return rig.PrimaryPart or rig:FindFirstChild("Torso") or rig:FindFirstChild("UpperTorso")
end

-- All constraint-based joints that replace Motor6D: AnimationConstraint
-- (drives animation transforms) and BallSocketConstraint (rotational joint)
-- are used in Avatar Joint Upgrade rigs. Both expose Attachment0/Attachment1;
-- the bone parts are the ATTACHMENT PARENTS (Part0/Part1 aliases only exist
-- on AnimationConstraint).
local function collectConstraints(rig)
	local out = {}
	for _, d in ipairs(rig:GetDescendants()) do
		if (d:IsA("AnimationConstraint") or d:IsA("BallSocketConstraint")) and d.Attachment0 and d.Attachment1 then
			local a, b = d.Attachment0.Parent, d.Attachment1.Parent
			if a and b and a:IsA("BasePart") and b:IsA("BasePart") then
				out[#out + 1] = { a = a, b = b, path = pathOf(d), kind = d:IsA("AnimationConstraint") and "AnimationConstraint" or "BallSocketConstraint", j = d }
			end
		end
	end
	return out
end

-- Bones: every joint-connected part reachable from the root. Supports
-- Motor6D rigs (classic R6/R15) and constraint rigs (Avatar Joint Upgrade -
-- the default for new places since 2026). A joint's "bone" is its child
-- (Part1/B) part, e.g. LeftUpperArm. Each entry carries the joint offset
-- frames (C0/C1; for constraints the Attachment0/Attachment1 CFrames) so the
-- chain can be re-evaluated PURELY MATHEMATICALLY - constraint joints are
-- NOT evaluated by the Edit-mode viewport, so they must be posed by writing
-- the child part's CFrame directly:
--  childWorld = parentWorld * c0 * pose * c1:Inverse().
local function buildBones(rig, root)
	local joints = {}
	local visited = { [root] = true }
	local constraints = collectConstraints(rig)
	local function walk(part, parentIdx)
		for _, joint in ipairs(part:GetJoints()) do
			if joint:IsA("Motor6D") then
				local other = joint.Part0 == part and joint.Part1 or (joint.Part1 == part and joint.Part0)
				if other and not visited[other] then
					visited[other] = true
					joints[#joints + 1] = {
						index = #joints + 1, parentIdx = parentIdx, name = other.Name, part1 = other,
						jointPath = pathOf(joint), kind = "Motor6D", c0 = joint.C0, c1 = joint.C1,
					}
					walk(other, #joints)
				end
			end
		end
		for _, c in ipairs(constraints) do
			if c.a == part and not visited[c.b] then
				visited[c.b] = true
				joints[#joints + 1] = {
					index = #joints + 1, parentIdx = parentIdx, name = c.b.Name, part1 = c.b,
					jointPath = c.path, kind = c.kind, c0 = c.j.Attachment0.CFrame, c1 = c.j.Attachment1.CFrame,
				}
				walk(c.b, #joints)
			end
		end
	end
	walk(root, 0)
	return joints
end

-- Build/merge the pose tree of a keyframe from the rig's bones. Existing
-- poses whose bone still exists are KEPT (CFrame values untouched - imported
-- animation data is never lost); poses that are not on the rig are removed;
-- missing bones are added as identity poses. Returns (rootPose, createdCount).
local function buildPoseTree(pkf, rig, root)
	local existing = {}
	local function collect(p)
		existing[p.Name] = p
		for _, sub in ipairs(p:GetSubPoses()) do collect(sub) end
	end
	for _, p in ipairs(pkf:GetPoses()) do collect(p) end
	local bones = buildBones(rig, root)
	local created = 0
	local function ensure(name)
		local p = existing[name]
		if p then existing[name] = nil; return p end
		created = created + 1
		p = Instance.new("Pose")
		p.Name = name
		return p
	end
	local rootPose = ensure(root.Name)
	local poseByIndex = { [0] = rootPose }
	for _, b in ipairs(bones) do
		local p = ensure(b.name)
		poseByIndex[b.index] = p
		if not p.Parent and poseByIndex[b.parentIdx] then poseByIndex[b.parentIdx]:AddSubPose(p) end
	end
	for _, leftover in pairs(existing) do leftover:Destroy() end
	if not rootPose.Parent then pkf:AddPose(rootPose) end
	return rootPose, created
end

local function getAnims()
	return LIB:GetChildren()
end

local function findAnim(name)
	for _, child in ipairs(getAnims()) do
		if child:IsA("KeyframeSequence") and child.Name == name then return child end
	end
	return nil
end

local function activeAnim()
	if ACTIVE.Value == "" then return nil end
	return findAnim(ACTIVE.Value)
end

local function sortedKeyframes(anim)
	local list = {}
	for _, kf in ipairs(anim:GetKeyframes()) do
		list[#list + 1] = kf
	end
	table.sort(list, function(a, b) return a.Time < b.Time end)
	return list
end

local function findKeyframe(anim, t)
	local best = nil
	for _, kf in ipairs(anim:GetKeyframes()) do
		if math.abs(kf.Time - t) < 0.01 then best = kf end
	end
	return best
end

local function findPose(pkf, boneName)
	local found = nil
	local function scan(p)
		if p.Name == boneName then found = p; return end
		for _, sub in ipairs(p:GetSubPoses()) do scan(sub) end
	end
	for _, p in ipairs(pkf:GetPoses()) do scan(p) end
	return found
end

local function newKeyframe(anim, t)
	local kf = Instance.new("Keyframe")
	kf.Time = t
	kf.Parent = anim
	return kf
end

local function poseToTable(pose)
	local sx, sy, sz = pose.CFrame:ToEulerAnglesYXZ()
	local p = pose.CFrame.Position
	return {
		pos = { math.round(p.X * 100) / 100, math.round(p.Y * 100) / 100, math.round(p.Z * 100) / 100 },
		rot = { math.round(math.deg(sx) * 100) / 100, math.round(math.deg(sy) * 100) / 100, math.round(math.deg(sz) * 100) / 100 },
		easingStyle = pose.EasingStyle.Name,
		easingDirection = pose.EasingDirection.Name,
	}
end

local function inspectAnim(anim)
	local kfs = sortedKeyframes(anim)
	local bones = {}
	if #kfs > 0 then
		for _, p in ipairs(kfs[1]:GetPoses()) do
			local function collect(p)
				bones[#bones + 1] = p.Name
				for _, sub in ipairs(p:GetSubPoses()) do collect(sub) end
			end
			collect(p)
		end
		table.sort(bones)
	end
	local out = {}
	local shown = math.min(#kfs, 40)
	for i = 1, shown do
		local kf = kfs[i]
		local bonesOut = {}
		local markersOut = {}
		local function collect(p)
			bonesOut[p.Name] = poseToTable(p)
			for _, sub in ipairs(p:GetSubPoses()) do collect(sub) end
		end
		for _, p in ipairs(kf:GetPoses()) do collect(p) end
		for _, marker in ipairs(kf:GetMarkers()) do markersOut[#markersOut + 1] = { name = marker.Name, value = marker.Value } end
		out[#out + 1] = { t = math.round(kf.Time * 1000) / 1000, bones = bonesOut, markers = markersOut }
	end
	return {
		name = anim.Name,
		duration = math.max(LENGTH.Value, kfs[#kfs] and kfs[#kfs].Time or 0),
		loop = anim.Loop,
		priority = anim.Priority.Name,
		bones = bones,
		keyframeCount = #kfs,
		keyframes = out,
		truncated = #kfs > shown,
		rig = pinOf(anim) and pinOf(anim).Name or "auto",
	}
end

-- Pose easing applies from this keyframe toward the next. Pose easing names
-- are reversed relative to TweenService direction names, so map explicitly.
local function easedAlpha(pose, alpha)
	if not pose or pose.EasingStyle == Enum.PoseEasingStyle.Linear then return alpha end
	if pose.EasingStyle == Enum.PoseEasingStyle.Constant then return alpha >= 0.999999 and 1 or 0 end
	local styleMap = {
		[Enum.PoseEasingStyle.Elastic] = Enum.EasingStyle.Elastic,
		[Enum.PoseEasingStyle.Cubic] = Enum.EasingStyle.Cubic,
		[Enum.PoseEasingStyle.CubicV2] = Enum.EasingStyle.Cubic,
		[Enum.PoseEasingStyle.Bounce] = Enum.EasingStyle.Bounce,
	}
	local directionMap = {
		[Enum.PoseEasingDirection.In] = Enum.EasingDirection.Out,
		[Enum.PoseEasingDirection.Out] = Enum.EasingDirection.In,
		[Enum.PoseEasingDirection.InOut] = Enum.EasingDirection.InOut,
	}
	local style, direction = styleMap[pose.EasingStyle], directionMap[pose.EasingDirection]
	if not style or not direction then return alpha end
	local ok, value = pcall(TweenService.GetValue, TweenService, alpha, style, direction)
	return ok and value or alpha
end

-- Sample the active animation's local pose CFrame for one bone at time t.
local function samplePoseLocal(anim, t, boneName)
	local kfs = sortedKeyframes(anim)
	if #kfs == 0 then return CFrame.new() end
	local before, after = kfs[1], kfs[#kfs]
	local alpha = 0
	if t < kfs[1].Time - 0.001 then
		before, after = kfs[1], kfs[1]
	elseif t > kfs[#kfs].Time + 0.001 then
		before, after = kfs[#kfs], kfs[#kfs]
	else
		for i = 1, #kfs - 1 do
			if t >= kfs[i].Time - 0.001 and t <= kfs[i + 1].Time + 0.001 then
				before, after = kfs[i], kfs[i + 1]
				local span = after.Time - before.Time
				alpha = span > 0 and (t - before.Time) / span or 0
				break
			end
		end
	end
	local pA = findPose(before, boneName)
	local pB = findPose(after, boneName)
	local cA = pA and pA.CFrame or CFrame.new()
	local cB = pB and pB.CFrame or CFrame.new()
	return cA:Lerp(cB, easedAlpha(pA, alpha))
end

-- Re-evaluate the whole joint chain from the root to WORLD CFrames for every
-- bone at time t, purely mathematically (no reliance on the engine evaluating
-- joint transforms - AnimationConstraint joints do NOT evaluate in Studio's
-- Edit viewport). childWorld = parentWorld * c0 * poseLocal * c1:Inverse().
local function computeWorldPoses(rig, root, anim, t)
	local rootCF = root.CFrame
	local bones = buildBones(rig, root)
	local map = {}
	for _, b in ipairs(bones) do
		local pose = anim and samplePoseLocal(anim, t, b.name) or CFrame.new()
		local parentWorld = (b.parentIdx == 0) and rootCF or map[b.parentIdx]
		map[b.index] = parentWorld * b.c0 * pose * b.c1:Inverse()
	end
	return bones, map
end

local function applyPoseAt(t)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local rig = activeRig(anim)
	if not rig then return fail("no rig found in workspace (need a Model with a Humanoid + roots)") end
	local root = rigRoot(rig)
	if not root then return fail("no root part found on the rig") end
	local bones, map = computeWorldPoses(rig, root, anim, t)
	if #bones == 0 then return fail("no joints found on the rig") end
	for _, b in ipairs(bones) do
		local joint = resolvePath(b.jointPath)
		if joint then
			local pose = samplePoseLocal(anim, t, b.name)
			if b.kind == "Motor6D" or b.kind == "AnimationConstraint" then joint.Transform = pose end
			if b.kind ~= "Motor6D" then
				-- BallSocketConstraint exposes attachments, not Part1. The child
				-- part was captured while building the chain and works for both.
				b.part1.CFrame = map[b.index]
			end
		end
	end
	return nil
end

local function resetTransforms(rig, root)
	-- Motor6D rigs: zero the joint transforms. Constraint rigs: write the
	-- rest-pose world CFrame (pose = identity) straight onto the child parts.
	local bones, map = computeWorldPoses(rig, root, nil, 0)
	for _, b in ipairs(bones) do
		local joint = resolvePath(b.jointPath)
		if joint then
			joint.Transform = CFrame.new()
			if b.kind ~= "Motor6D" then b.part1.CFrame = map[b.index] end
		end
	end
end

local function stopPreview(restore)
	PREVIEW_TOKEN.Value = PREVIEW_TOKEN.Value + 1
	local oldRig = resolvePath(PREVIEW_RIG.Value)
	PREVIEW_RIG.Value = ""
	if restore and oldRig then
		local oldRoot = rigRoot(oldRig)
		if oldRoot then resetTransforms(oldRig, oldRoot) end
	end
end

-- Forward declaration: create/select use this after it is assigned below.
local rigEvidence
local api = {}

function api.select_rig(a)
	local path = tostring(a.path or "")
	if path == "" then return fail("path is required (for example 'Workspace.R15')") end
	local rig = resolvePath(path)
	if not rig or not rig:IsA("Model") then return fail(("'%s' is not a Model"):format(path)) end
	if not rig:FindFirstChildOfClass("Humanoid") then return fail(("'%s' has no Humanoid and is not an animation rig"):format(path)) end
	local root = rigRoot(rig)
	if not root then return fail(("'%s' has no HumanoidRootPart, PrimaryPart, Torso, or UpperTorso"):format(path)) end
	if #buildBones(rig, root) == 0 then return fail(("'%s' has no connected Motor6D or supported constraint joints"):format(path)) end
	SELECTED_RIG.Value = pathOf(rig)
	local anim = activeAnim()
	if anim then anim:SetAttribute("RS_RigPath", SELECTED_RIG.Value) end
	RIGREF.Value = SELECTED_RIG.Value
	return okdata(rigEvidence(rig), ("selected rig '%s' for new animations%s"):format(rig.Name, anim and " and pinned the active animation to it" or ""))
end

function api.clear_rig_selection()
	SELECTED_RIG.Value = ""
	return okdata({}, "cleared explicit rig selection; new animations will auto-detect the best rig")
end

function api.create(a)
	local rig = findRig()
	if not rig then return fail("no rig found in workspace (need a Model with a Humanoid + roots)") end
	local root = rigRoot(rig)
	if not root then return fail("the rig was found but no root part (HumanoidRootPart/Torso/UpperTorso) - the model may not be a valid character") end
	local name = tostring(a.name or "")
	if name == "" then return fail("animation name is required") end
	local existing = findAnim(name)
	if existing and not a.overwrite then return fail(("an animation named '%s' ALREADY EXISTS - nothing was changed. Pass overwrite=true to replace it, or pick another name"):format(name)) end
	if existing then existing:Destroy() end
	local anim = Instance.new("KeyframeSequence")
	anim.Name = name
	anim.Loop = false
	anim.Priority = Enum.AnimationPriority.Action
	local t0 = Instance.new("NumberValue")
	t0.Name = "Duration"
	t0.Value = tonumber(a.duration) or 1
	t0.Parent = anim
	anim.Parent = LIB
	local kf = newKeyframe(anim, 0)
	buildPoseTree(kf, rig, root)
	anim:SetAttribute("RS_RigPath", pathOf(rig))
	RIGREF.Value = pathOf(rig)
	ACTIVE.Value = name
	LENGTH.Value = tonumber(a.duration) or 1
	local d = inspectAnim(anim)
	local ev = rigEvidence(rig)
	return okdata(d, ("created animation '%s' (%d bones, keyframe at t=0 default pose, pinned to rig '%s' with %d Motor6D + %d constraint joints)"):format(name, #d.bones, rig.Name, ev.motorJoints, ev.constraintJoints))
end

function api.open(a)
	local name = tostring(a.name or "")
	if name == "" then return fail("animation name is required") end
	local anim = findAnim(name)
	if not anim then
		local names = {}
		for _, c in ipairs(getAnims()) do if c:IsA("KeyframeSequence") then names[#names + 1] = c.Name end end
		return fail(("no animation named '%s' - existing: %s"):format(name, #names > 0 and table.concat(names, ", ") or "(none)"))
	end
	ACTIVE.Value = name
	local pinned = pinOf(anim)
	if not pinned then
		pinned = findRig()
		if pinned then
			anim:SetAttribute("RS_RigPath", pathOf(pinned))
			RIGREF.Value = pathOf(pinned)
		end
	end
	if pinned then RIGREF.Value = pathOf(pinned) end
	local lenV = anim:FindFirstChild("Duration")
	if lenV then LENGTH.Value = tonumber(lenV.Value) or LENGTH.Value end
	-- SELF-HEAL: if the animation's stored pose tree does not match the pinned
	-- rig's bones (e.g. an old animation authored on an R6 rig whose tree still
	-- says "Torso/Left Arm/..."), rebuild the tree onto the rig automatically.
	-- Matching bones keep their values; the reply reports what happened.
	local healed = false
	local healNote = ""
	if pinned then
		local root = rigRoot(pinned)
		local kfs = sortedKeyframes(anim)
		if root and #kfs > 0 then
			local treeNames = {}
			local function collect(p)
				treeNames[p.Name] = true
				for _, sub in ipairs(p:GetSubPoses()) do collect(sub) end
			end
			for _, p in ipairs(kfs[1]:GetPoses()) do collect(p) end
			local bones = buildBones(pinned, root)
			local boneNames = {}
			for _, b in ipairs(bones) do boneNames[b.name] = true end
			local missing = 0
			for name in pairs(treeNames) do if not boneNames[name] then missing = missing + 1 end end
			if missing > 0 and missing > #boneNames / 2 then
				local created = 0
				for _, kf in ipairs(kfs) do
					local _, n = buildPoseTree(kf, pinned, root)
					created = created + n
				end
				healed = true
				healNote = (" pose tree did not match rig '%s' (%d bone(s) mismatched) - auto-rebuilt onto the rig (%d bone pose(s) added, keyframe times preserved)"):format(pinned.Name, missing, created)
			end
		end
	end
	local d = inspectAnim(anim)
	return okdata(d, ("opened animation '%s'%s%s"):format(name, pinned and (" (pinned to rig '%s')"):format(pinned.Name) or "", healNote))
end

-- Hard evidence about which rig the tools see and how its joints are wired:
-- used in animation_test / animation_list replies so the conversation can
-- never pretend an "internal 7-bone rig" exists - the reply names the exact
-- Model in the workspace and counts its actual joints.
rigEvidence = function(rig)
	local motor, constraint = 0, 0
	for _, d in ipairs(rig:GetDescendants()) do
		if d:IsA("Motor6D") then motor = motor + 1 elseif d:IsA("AnimationConstraint") or d:IsA("BallSocketConstraint") then constraint = constraint + 1 end
	end
	return { name = rig.Name, path = pathOf(rig), motorJoints = motor, constraintJoints = constraint }
end

function api.list()
	local names = {}
	for _, c in ipairs(getAnims()) do if c:IsA("KeyframeSequence") then names[#names + 1] = c.Name end end
	local active = activeAnim()
	return okdata({ active = ACTIVE.Value, animations = names, rig = active and (pinOf(active) and rigEvidence(pinOf(active)) or nil) or nil },
		("%d animation(s) in the library"):format(#names) .. (active and pinOf(active) and (" - active animation '%s' is pinned to rig '%s' (%d motor / %d constraint joints)"):format(active.Name, pinOf(active).Name, rigEvidence(pinOf(active)).motorJoints, rigEvidence(pinOf(active)).constraintJoints) or ""))
end

function api.set_length(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local dur = tonumber(a.duration)
	if not dur or dur <= 0 then return fail("duration must be a positive number of seconds") end
	LENGTH.Value = dur
	local lenV = anim:FindFirstChild("Duration")
	if not lenV then lenV = NumberValue.new("Duration", dur); lenV.Parent = anim else lenV.Value = dur end
	return okdata(inspectAnim(anim), ("animation '%s' length set to %.2fs"):format(anim.Name, dur))
end

function api.set_settings(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local changed = {}
	if a.loop ~= nil then
		if type(a.loop) ~= "boolean" then return fail("loop must be true or false") end
		anim.Loop = a.loop
		changed[#changed + 1] = "loop=" .. tostring(a.loop)
	end
	if a.priority ~= nil then
		local name = tostring(a.priority)
		local priority = Enum.AnimationPriority[name]
		if not priority then return fail("unknown priority '" .. name .. "' (use Core, Idle, Movement, Action, Action2, Action3, or Action4)") end
		anim.Priority = priority
		changed[#changed + 1] = "priority=" .. name
	end
	if #changed == 0 then return fail("provide loop and/or priority") end
	return okdata(inspectAnim(anim), ("animation settings updated: %s"):format(table.concat(changed, ", ")))
end

function api.keyframe(a, upsert)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local rig = activeRig(anim)
	if not rig then return fail("no rig found in workspace") end
	local t = tonumber(a.t)
	if not t or t < 0 then return fail("t (seconds) is required and must be >= 0") end
	upsert = upsert or (a.upsert == true)
	local kf = findKeyframe(anim, t)
	local created = false
	if not kf then
		if upsert then kf = newKeyframe(anim, t); created = true else return fail(("no keyframe at t=%s - create it first with animation_add_keyframe"):format(tostring(t))) end
	end
	local poses = a.poses
	if not poses then poses = {} end
	if #kf:GetPoses() == 0 then
		local root = rigRoot(rig)
		buildPoseTree(kf, rig, root)
	end
	for _, entry in ipairs(poses) do
		local bone = tostring(entry.bone or "")
		local pose = findPose(kf, bone)
		if not pose then return fail(("unknown bone '%s' - inspect the animation to see valid bone names"):format(bone)) end
		local pos = entry.pos
		local rot = entry.rot
		if (not pos) and (not rot) then return fail(("pose for '%s' needs pos and/or rot"):format(bone)) end
		local c = pose.CFrame
		if rot then
			local rx, ry, rz = tonumber(rot[1]) or 0, tonumber(rot[2]) or 0, tonumber(rot[3]) or 0
			c = CFrame.fromEulerAnglesYXZ(math.rad(ry), math.rad(rx), math.rad(rz))
		end
		if pos then c = CFrame.new(Vector3.new(tonumber(pos[1]) or 0, tonumber(pos[2]) or 0, tonumber(pos[3]) or 0)) * c end
		pose.CFrame = c
	end
	return okdata(inspectAnim(anim), ("keyframe at t=%.3fs %s"):format(t, created and "created" or "updated"))
end

function api.delete_keyframe(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local t = tonumber(a.t)
	if not t then return fail("t (seconds) is required") end
	local kf = findKeyframe(anim, t)
	if not kf then return fail(("no keyframe at t=%s"):format(tostring(t))) end
	kf:Destroy()
	return okdata(inspectAnim(anim), ("deleted keyframe at t=%.3fs"):format(t))
end

function api.move_keyframe(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local fromT, toT = tonumber(a.from_t), tonumber(a.to_t)
	if not fromT or not toT then return fail("from_t and to_t (seconds) are required") end
	if toT < 0 then return fail("to_t must be >= 0") end
	local kf = findKeyframe(anim, fromT)
	if not kf then return fail(("no keyframe at from_t=%s"):format(tostring(fromT))) end
	local clash = findKeyframe(anim, toT)
	if clash and clash ~= kf then return fail(("a keyframe already exists at to_t=%s - delete or move it first"):format(tostring(toT))) end
	kf.Time = toT
	return okdata(inspectAnim(anim), ("moved keyframe from t=%.3fs to t=%.3fs"):format(fromT, toT))
end

function api.clone_keyframe(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local fromT, toT = tonumber(a.from_t), tonumber(a.to_t)
	if not fromT or not toT or fromT < 0 or toT < 0 then return fail("from_t and to_t must be seconds >= 0") end
	local source = findKeyframe(anim, fromT)
	if not source then return fail(("no keyframe at from_t=%s"):format(tostring(fromT))) end
	if findKeyframe(anim, toT) then return fail(("a keyframe already exists at to_t=%s"):format(tostring(toT))) end
	local copy = source:Clone()
	copy.Time = toT
	copy.Parent = anim
	return okdata(inspectAnim(anim), ("duplicated keyframe from t=%.3fs to t=%.3fs"):format(fromT, toT))
end

function api.set_marker(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local t, name = tonumber(a.t), tostring(a.name or "")
	if not t or t < 0 then return fail("t must be seconds >= 0") end
	if name == "" then return fail("marker name is required") end
	local kf = findKeyframe(anim, t)
	if not kf then return fail(("no keyframe at t=%s - create it before adding a marker"):format(tostring(t))) end
	for _, marker in ipairs(kf:GetMarkers()) do
		if marker.Name == name then marker.Value = tostring(a.value or ""); return okdata(inspectAnim(anim), ("updated marker '%s' at t=%.3fs"):format(name, t)) end
	end
	local marker = Instance.new("KeyframeMarker")
	marker.Name = name
	marker.Value = tostring(a.value or "")
	marker.Parent = kf
	return okdata(inspectAnim(anim), ("added marker '%s' at t=%.3fs"):format(name, t))
end

function api.delete_marker(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local t, name = tonumber(a.t), tostring(a.name or "")
	if not t or t < 0 then return fail("t must be seconds >= 0") end
	if name == "" then return fail("marker name is required") end
	local kf = findKeyframe(anim, t)
	if not kf then return fail(("no keyframe at t=%s"):format(tostring(t))) end
	for _, marker in ipairs(kf:GetMarkers()) do
		if marker.Name == name then marker:Destroy(); return okdata(inspectAnim(anim), ("deleted marker '%s' at t=%.3fs"):format(name, t)) end
	end
	return fail(("no marker named '%s' at t=%.3fs"):format(name, t))
end

function api.set_easing(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local t = tonumber(a.t)
	if not t or t < 0 then return fail("t must be seconds >= 0") end
	local kf = findKeyframe(anim, t)
	if not kf then return fail(("no keyframe at t=%s"):format(tostring(t))) end
	local styleName, directionName = tostring(a.style or ""), tostring(a.direction or "Out")
	local style, direction = Enum.PoseEasingStyle[styleName], Enum.PoseEasingDirection[directionName]
	if not style then return fail("unknown easing style '" .. styleName .. "' (use Linear, Constant, Elastic, CubicV2, or Bounce)") end
	if not direction then return fail("unknown easing direction '" .. directionName .. "' (use In, Out, or InOut)") end
	local wanted = {}
	for _, name in ipairs(a.bones or {}) do wanted[tostring(name)] = true end
	local all, changed = next(wanted) == nil, 0
	local function visit(p)
		if all or wanted[p.Name] then p.EasingStyle = style; p.EasingDirection = direction; changed = changed + 1 end
		for _, sub in ipairs(p:GetSubPoses()) do visit(sub) end
	end
	for _, pose in ipairs(kf:GetPoses()) do visit(pose) end
	if changed == 0 then return fail("none of the requested bones exist at this keyframe") end
	return okdata(inspectAnim(anim), ("set %s/%s easing on %d pose(s) at t=%.3fs"):format(styleName, directionName, changed, t))
end

function api.inspect()
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	return okdata(inspectAnim(anim), ("%d keyframe(s) in '%s'"):format(#sortedKeyframes(anim), anim.Name))
end

function api.resets()
	stopPreview(true)
	return okdata({}, "preview stopped, rig returned to rest pose")
end

-- Rebuild the active animation's pose trees onto its pinned rig: keyframe
-- times are preserved, existing poses are kept when the bone still exists on
-- the rig, poses that are not on the rig are removed, missing bones are added
-- as identity poses. Use this to convert an R6-authored animation to the R15
-- rig (or vice versa) when the bone names do not match.
function api.rebuild()
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local rig = activeRig(anim)
	if not rig then return fail("no rig found in workspace") end
	local root = rigRoot(rig)
	if not root then return fail("no root part found on the rig") end
	local kfs = sortedKeyframes(anim)
	if #kfs == 0 then return fail("animation has no keyframes") end
	local created = 0
	for _, kf in ipairs(kfs) do
		local _, n = buildPoseTree(kf, rig, root)
		created = created + n
	end
	anim:SetAttribute("RS_RigPath", pathOf(rig))
	local d = inspectAnim(anim)
	return okdata(d, ("pose tree rebuilt onto rig '%s': %d bone pose(s) added across %d keyframe(s); kept poses preserved, poses not on the rig removed"):format(rig.Name, created, #kfs))
end

-- Copy any existing KeyframeSequence from anywhere in the DataModel (e.g. a
-- real R15 animation saved under Workspace.X.AnimSaves.Run) into the library
-- and open it. The copied animation is pinned to the current rig.
function api.import(a)
	local path = tostring(a.path or "")
	if path == "" then return fail("path is required (e.g. 'Workspace.R15.AnimSaves.Run')") end
	local src = resolvePath(path)
	if not src then return fail(("nothing found at path '%s'"):format(path)) end
	if not src:IsA("KeyframeSequence") then return fail(("'%s' is a %s, not a KeyframeSequence"):format(path, src.ClassName)) end
	local name = tostring(a.name or "")
	if name == "" then name = src.Name end
	local existing = findAnim(name)
	if existing and not a.overwrite then return fail(("an animation named '%s' ALREADY EXISTS in the library - nothing was changed. Pass overwrite=true to replace it, or pick another name"):format(name)) end
	if existing then existing:Destroy() end
	local copy = src:Clone()
	copy.Name = name
	copy.Parent = LIB
	ACTIVE.Value = name
	local lenV = copy:FindFirstChild("Duration")
	if lenV then LENGTH.Value = tonumber(lenV.Value) or LENGTH.Value end
	local rig = findRig()
	if rig then
		copy:SetAttribute("RS_RigPath", pathOf(rig))
		RIGREF.Value = pathOf(rig)
	end
	local d = inspectAnim(copy)
	return okdata(d, ("imported '%s' as '%s' (%d keyframes, %d bones%s)"):format(path, name, d.keyframeCount, #d.bones, rig and (" - pinned to rig '%s'"):format(rig.Name) or ""))
end

function api.apply(a)
	local t = tonumber(a.t)
	if not t then return fail("t (seconds) is required") end
	local err = applyPoseAt(t)
	if err then return err end
	return okdata({ t = t }, ("posed rig at t=%.3fs (middle of blend between neighbours)"):format(t))
end

-- NUMERIC SIMULATION: sample the animation at EXACTLY time t through the
-- joint chain (pure math - identical to what the preview writes), pose the
-- rig in Studio at that moment, and report where EVERY bone lands in WORLD
-- space (position + orientation) plus quality metrics (root height, hand
-- mirror-symmetry deviation in studs, hand/foot/head positions). This gives
-- the agent eyes without screenshots: simulate at t=0, the middle and the
-- last keyframe to judge spacing, arcs, symmetry and ground contact, then
-- fix poses and re-simulate until the frames read clean.
-- Highest solid surface below the rig (within radius) = the "ground".
-- Parts count if the top face is within 30 studs horizontally of the root.
-- Terrain (if present) is sampled straight under the root. Feet clearances
-- are measured against it so walk cycles can be QA'd: clearance ~0 =
-- planted, >0 = floating, <0 = clipping through the floor.
local function findGroundY(rig, root)
	local rp = root.CFrame.Position
	local best = nil
	for _, p in ipairs(workspace:GetDescendants()) do
		if p:IsA("BasePart") and rig:IsAncestorOf(p) == false and p ~= root then
			local pp = p.CFrame.Position
			local d = ((pp.X - rp.X) * (pp.X - rp.X) + (pp.Z - rp.Z) * (pp.Z - rp.Z))
			if d <= 900 and pp.Y < rp.Y then
				local top = pp.Y + math.abs(p.Size.Y) / 2
				if not best or top > best then best = top end
			end
		end
	end
	local terrain = workspace:FindFirstChildOfClass("Terrain")
	if terrain and terrain:GetMaterial(rp, Vector3.new(4, 4, 4)) ~= Enum.Material.Air then
		local ty = rp.Y
		while ty > -2000 do
			local mat = terrain:GetMaterial(Vector3.new(rp.X, ty, rp.Z), Vector3.new(4, 4, 4))
			if mat ~= Enum.Material.Air then
				if not best or ty > best then best = ty end
				break
			end
			ty = ty - 4
		end
	end
	return best
end

function api.simulate(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local rig = activeRig(anim)
	if not rig then return fail("no rig found in workspace") end
	local root = rigRoot(rig)
	if not root then return fail("no root part found on the rig") end
	local groundY = findGroundY(rig, root)
	local bonesBase, _ = computeWorldPoses(rig, root, anim, 0)
	if #bonesBase == 0 then return fail("no joints found on the rig") end
	local function findBone2(names)
		for _, n in ipairs(names) do
			for _, b in ipairs(bonesBase) do if b.name == n then return b end end
		end
		return nil
	end
	local lhB, rhB = findBone2({ "LeftHand", "Left Arm", "LeftArm" }), findBone2({ "RightHand", "Right Arm", "RightArm" })
	local lfB, rfB = findBone2({ "LeftFoot", "Left Leg", "LeftLeg" }), findBone2({ "RightFoot", "Right Leg", "RightLeg" })
	local headB = findBone2({ "Head" })
	local rootCF = root.CFrame

	-- FULL-SEQUENCE QA SWEEP: one call checks EVERY keyframe (start, middle,
	-- end, and all in between) and returns a verdict flagging any frame with
	-- floating feet, clipping through the floor or asymmetric hands - so a bad
	-- animation is caught and fixed BEFORE it is offered to the user.
	if a.all == true then
		local kfs = sortedKeyframes(anim)
		if #kfs == 0 then return fail("animation has no keyframes to sweep") end
		stopPreview(true)
		local frames = {}
		local issues = {}
		local function clearanceOf(b, t)
			local _, m = computeWorldPoses(rig, root, anim, t)
			return groundY and m[b.index].Position.Y - groundY or nil
		end
		local function symAt(t)
			if not (lhB and rhB) then return nil end
			local _, m = computeWorldPoses(rig, root, anim, t)
			local ls = rootCF:PointToObjectSpace(m[lhB.index].Position)
			local rs = rootCF:PointToObjectSpace(m[rhB.index].Position)
			return (ls - Vector3.new(-rs.X, rs.Y, rs.Z)).Magnitude
		end
		for _, kf in ipairs(kfs) do
			local t = kf.Time
			local f = { t = math.round(t * 1000) / 1000 }
			local issuesHere = {}
			if groundY then
				if lfB then
					local c = clearanceOf(lfB, t)
					f.lFootClearance = math.round(c * 100) / 100
					if c > 0.06 then issuesHere[#issuesHere + 1] = "left foot FLOATING +" .. string.format("%.2f", c) .. " studs"
					elseif c < -0.03 then issuesHere[#issuesHere + 1] = "left foot CLIPPING " .. string.format("%.2f", c) .. " studs" end
				end
				if rfB then
					local c = clearanceOf(rfB, t)
					f.rFootClearance = math.round(c * 100) / 100
					if c > 0.06 then issuesHere[#issuesHere + 1] = "right foot FLOATING +" .. string.format("%.2f", c) .. " studs"
					elseif c < -0.03 then issuesHere[#issuesHere + 1] = "right foot CLIPPING " .. string.format("%.2f", c) .. " studs" end
				end
			end
			local s = symAt(t)
			if s then
				f.symmetryDeviation = math.round(s * 100) / 100
				if s > 0.06 then issuesHere[#issuesHere + 1] = "asymmetric hands (deviation " .. string.format("%.2f", s) .. " studs)" end
			end
			f.issues = issuesHere
			frames[#frames + 1] = f
			for _, i in ipairs(issuesHere) do
				issues[#issues + 1] = ("t=%.2fs: %s"):format(t, i)
			end
		end
		if #kfs > 1 then
			local lastT = kfs[#kfs].Time
			applyPoseAt(lastT)
		end
		local verdict
		if #issues == 0 then
			verdict = "ALL %d frame(s) CLEAN - feet planted, hands symmetric: safe to preview"
		else
			verdict = "%d frame(s) flag(s) - FIX before preview"
		end
		verdict = verdict:format(#issues)
		return okdata({ sweep = true, frames = frames, issues = issues, groundY = groundY and math.round(groundY * 100) / 100 or nil },
			("QA SWEEP of all %d keyframes (t=0 to t=%.2fs): %s%s%s"):format(#kfs, kfs[#kfs].Time, verdict,
				#issues > 0 and (" - issues: " .. table.concat(issues, "; ")) or "",
				not groundY and (lfB or rfB) and " | NO GROUND DETECTED below the rig (no floor or terrain within 30 studs) - foot checks skipped; add a floor part or move the rig above the ground" or ""))
	end

	local t = tonumber(a.t)
	if not t or t < 0 then return fail("t (seconds) is required and must be >= 0 (or use all=true for the full-sequence QA sweep)") end
	local bones, map = computeWorldPoses(rig, root, anim, t)
	if #bones == 0 then return fail("no joints found on the rig") end
	stopPreview(true)
	local posErr = applyPoseAt(t)
	if posErr then return posErr end
	local world = {}
	for _, b in ipairs(bones) do
		local cf = map[b.index]
		local sx, sy, sz = cf:ToEulerAnglesYXZ()
		world[b.name] = {
			pos = { math.round(cf.Position.X * 100) / 100, math.round(cf.Position.Y * 100) / 100, math.round(cf.Position.Z * 100) / 100 },
			rot = { math.round(math.deg(sy) * 100) / 100, math.round(math.deg(sx) * 100) / 100, math.round(math.deg(sz) * 100) / 100 },
		}
	end
	local function findBone(names)
		for _, n in ipairs(names) do
			for _, b in ipairs(bones) do if b.name == n then return b end end
		end
		return nil
	end
	local lh, rh = findBone({ "LeftHand", "Left Arm", "LeftArm" }), findBone({ "RightHand", "Right Arm", "RightArm" })
	local lf, rf = findBone({ "LeftFoot", "Left Leg", "LeftLeg" }), findBone({ "RightFoot", "Right Leg", "RightLeg" })
	local head = findBone({ "Head" })
	local symDev = nil
	if lh and rh then
		local ls = rootCF:PointToObjectSpace(map[lh.index].Position)
		local rs = rootCF:PointToObjectSpace(map[rh.index].Position)
		symDev = math.round((ls - Vector3.new(-rs.X, rs.Y, rs.Z)).Magnitude * 100) / 100
	end
	local data = { t = math.round(t * 1000) / 1000, rootY = math.round(rootCF.Position.Y * 100) / 100, symmetryDeviation = symDev, groundY = groundY and math.round(groundY * 100) / 100 or nil, bones = world }
	local parts = { ("simulation at t=%.2fs (rig posed in Studio): root y=%.2f"):format(t, data.rootY) }
	if symDev then parts[#parts + 1] = ("hand mirror-symmetry deviation: %.2f studs (0 = perfectly mirrored)"):format(symDev) end
	local function line(label, b, foot)
		if not b then return end
		local cf = map[b.index]
		if foot and groundY then
			local clearance = math.round((cf.Position.Y - groundY) * 100) / 100
			parts[#parts + 1] = ("%s y=%.2f (ground y=%.2f -> clearance %+.2f studs: %s)"):format(label, cf.Position.Y, groundY, clearance,
				clearance <= 0.03 and clearance >= -0.03 and "planted" or (clearance > 0 and "FLOATING" or "CLIPPING THROUGH FLOOR"))
		else
			parts[#parts + 1] = ("%s at (%.2f, %.2f, %.2f)"):format(label, cf.Position.X, cf.Position.Y, cf.Position.Z)
		end
	end
	line("left hand", lh); line("right hand", rh)
	line("left foot", lf, true); line("right foot", rf, true)
	line("head", head)
	if not groundY and (lf or rf) then parts[#parts + 1] = "NO GROUND DETECTED below the rig (no floor or terrain within 30 studs) - foot clearances unavailable; add a floor part or move the rig above the ground and re-simulate" end
	return okdata(data, table.concat(parts, "; "))
end

function api.preview(a)
	local anim = activeAnim()
	if not anim then return fail("no active animation - create or open one first") end
	local dur = tonumber(a.duration) or LENGTH.Value
	if not dur or dur <= 0 then return fail("duration must be positive") end
	local rig = activeRig(anim)
	if not rig then return fail("no rig found in workspace") end
	local root = rigRoot(rig)
	if not root then return fail("no root part found on the rig") end
	-- A new token invalidates any async preview launched by a previous call.
	stopPreview(true)
	local token = PREVIEW_TOKEN.Value + 1
	PREVIEW_TOKEN.Value = token
	PREVIEW_RIG.Value = pathOf(rig)
	if #sortedKeyframes(anim) < 2 then
		local err = applyPoseAt(0)
		PREVIEW_TOKEN.Value = PREVIEW_TOKEN.Value + 1
		PREVIEW_RIG.Value = ""
		if err then return err end
		return okdata({}, "only one keyframe - posed at t=0 (add more keyframes for a moving preview)")
	end
	task.spawn(function()
		local t = 0
		local dt = 1 / 30
		while PREVIEW_TOKEN.Value == token and t <= dur do
			applyPoseAt(t)
			task.wait(dt)
			t = t + dt
		end
		if PREVIEW_TOKEN.Value == token then
			PREVIEW_TOKEN.Value = token + 1
			PREVIEW_RIG.Value = ""
			task.wait(0.25)
			resetTransforms(rig, root)
		end
	end)
	return okdata({}, ("preview loop playing %.2fs at ~30fps (stops automatically; call animation_stop_preview to stop early)"):format(dur))
end

-- Probe the rig's rotation-sign convention PURELY MATHEMATICALLY: apply +95
-- roll to the right arm in the joint chain and compute where the arm would
-- move, without touching the rig (works for Motor6D AND AnimationConstraint
-- rigs, in or out of Edit mode). Standard convention = up and out; mirrored
-- rigs would move it down/in.
local function probeDirection(rig, root)
	local bones = buildBones(rig, root)
	local target = nil
	for _, b in ipairs(bones) do
		if b.name == "RightUpperArm" or b.name == "Right Arm" or b.name == "RightArm" then target = b break end
	end
	if not target then
		local names = {}
		for _, b in ipairs(bones) do names[#names + 1] = b.name end
		return { measured = false, note = "no right-arm bone found (bones: " .. (#names > 0 and table.concat(names, ", ") or "none") .. ")" }
	end
	local rootCF = root.CFrame
	local map0, map95 = {}, {}
	for _, b in ipairs(bones) do
		local pose = b == target and CFrame.fromEulerAnglesYXZ(0, 0, math.rad(95)) or CFrame.new()
		local p0w, p95w = CFrame.new(), CFrame.new()
		local parent0 = (b.parentIdx == 0) and rootCF or map0[b.parentIdx]
		local parent95 = (b.parentIdx == 0) and rootCF or map95[b.parentIdx]
		map0[b.index] = parent0 * b.c0 * b.c1:Inverse()
		map95[b.index] = parent95 * b.c0 * pose * b.c1:Inverse()
	end
	local p0 = rootCF:PointToObjectSpace(map0[target.index].Position)
	local p1 = rootCF:PointToObjectSpace(map95[target.index].Position)
	local d = { x = p1.X - p0.X, y = p1.Y - p0.Y, z = p1.Z - p0.Z }
	local up = d.y > 0
	local out = d.x > 0
	return { measured = true, d = d, up = up, out = out, convention = (up and out) and "standard" or "mirrored" }
end

function api.test()
	local rig = findRig()
	if not rig then return fail("no rig found in workspace") end
	if findAnim("RS_Test_Idle") then findAnim("RS_Test_Idle"):Destroy() end
	local anim = Instance.new("KeyframeSequence")
	anim.Name = "RS_Test_Idle"
	anim.Parent = LIB
	local root = rigRoot(rig)
	local kf0 = newKeyframe(anim, 0)
	buildPoseTree(kf0, rig, root)
	local kf1 = newKeyframe(anim, 0.5)
	buildPoseTree(kf1, rig, root)
	local kf2 = newKeyframe(anim, 1)
	buildPoseTree(kf2, rig, root)
	local armL, armR = findPose(kf1, "LeftUpperArm"), findPose(kf1, "RightUpperArm")
	if not (armL or armR) then armL, armR = findPose(kf1, "Left Arm"), findPose(kf1, "Right Arm") end
	if not (armL or armR) then armL, armR = findPose(kf1, "LeftArm"), findPose(kf1, "RightArm") end
	if armL then armL.CFrame = CFrame.fromEulerAnglesYXZ(0, 0, math.rad(-95)) end
	if armR then armR.CFrame = CFrame.fromEulerAnglesYXZ(0, 0, math.rad(95)) end
	ACTIVE.Value = anim.Name
	anim:SetAttribute("RS_RigPath", pathOf(rig))
	RIGREF.Value = pathOf(rig)
	LENGTH.Value = 1
	local probe = probeDirection(rig, root)
	local verdict = "unknown"
	if probe.measured then
		verdict = probe.convention == "standard" and "standard - use rot values as given" or "MIRRORED - flip the sign of every rot value you send on this rig"
	end
	local evidence = rigEvidence(rig)
	return okdata({ inspect = inspectAnim(anim), probe = probe, rig = evidence },
		"test animation 'RS_Test_Idle' created on rig '" .. rig.Name .. "' (" .. evidence.motorJoints .. " Motor6D + " .. evidence.constraintJoints .. " constraint joints; id " .. pathOf(rig) .. "). " ..
		"idle at t=0, arms raised AT SIDES at t=0.5, idle at t=1, 1s. " ..
		"Direction probe (right arm +95 roll -> d=[x " .. (probe.d and string.format("%.2f", probe.d.x) or "?") .. ", y " ..
		(probe.d and string.format("%.2f", probe.d.y) or "?") .. ", z " .. (probe.d and string.format("%.2f", probe.d.z) or "?") .. "]): " ..
		(probe.measured and ("up=" .. tostring(probe.up) .. " out=" .. tostring(probe.out) .. " => " .. verdict) or probe.note))
end

-- PER-JOINT AXIS MAP: stop guessing which local rotation axis moves a limb.
-- For every joint (or a.filter list) this rotates the joint +angle around its
-- own X, Y and Z axes ONE AT A TIME, computes the child part's resulting
-- WORLD-space displacement through the exact same chain math the preview uses
-- (pure math - the rig is never touched), and classifies each local axis into
-- the world direction it actually swings: forward/back, up/down or left/right
-- (root frame). The reply is a per-joint "axis card" so a walk can be authored
-- by rotating the correct axis instead of guessing.
local function classifyAxis(d)
	local ax, ay, az = math.abs(d.x), math.abs(d.y), math.abs(d.z)
	if az >= ax and az >= ay then
		return "forward/back", d.z >= 0 and "+rot=forward, -rot=back" or "+rot=back, -rot=forward"
	elseif ax >= ay then
		return "left/right", d.x >= 0 and "+rot=LEFT, -rot=right" or "+rot=right, -rot=LEFT"
	end
	return "up/down", d.y >= 0 and "+rot=up, -rot=down" or "+rot=down, -rot=up"
end

function api.map_axes(a)
	local rig = activeAnim() and activeRig(activeAnim()) or findRig()
	if not rig then return fail("no rig found in workspace (need a Model with a Humanoid + joints)") end
	local root = rigRoot(rig)
	if not root then return fail("no root part found on the rig") end
	local bones = buildBones(rig, root)
	if #bones == 0 then return fail("no joints found on the rig") end
	local filter = {}
	if a.filter then
		for _, n in ipairs(a.filter) do filter[tostring(n)] = true end
	end
	local angle = math.rad(tonumber(a.angle) or 30)
	local rootCF = root.CFrame
	local trials = {
		{ "X", CFrame.Angles(angle, 0, 0) },
		{ "Y", CFrame.Angles(0, angle, 0) },
		{ "Z", CFrame.Angles(0, 0, angle) },
	}
	local cards = {}
	local summaries = {}
	for _, bone in ipairs(bones) do
		if #bones <= 24 or filter[bone.name] then
			local card = {}
			local bits = {}
			for _, trial in ipairs(trials) do
				local map0, map1 = {}, {}
				for _, b in ipairs(bones) do
					local pose = (b == bone) and trial[2] or CFrame.new()
					map0[b.index] = ((b.parentIdx == 0) and rootCF or map0[b.parentIdx]) * b.c0 * b.c1:Inverse()
					map1[b.index] = ((b.parentIdx == 0) and rootCF or map1[b.parentIdx]) * b.c0 * pose * b.c1:Inverse()
				end
				local p0 = rootCF:PointToObjectSpace(map0[bone.index].Position)
				local p1 = rootCF:PointToObjectSpace(map1[bone.index].Position)
				local d = { x = p1.X - p0.X, y = p1.Y - p0.Y, z = p1.Z - p0.Z }
				local kind, sign = classifyAxis(d)
				card[trial[1]] = ("%s (%s; dx=%+.2f dy=%+.2f dz=%+.2f)"):format(kind, sign, d.x, d.y, d.z)
				bits[#bits + 1] = ("%s=%s"):format(trial[1], kind)
			end
			cards[bone.name] = card
			summaries[#summaries + 1] = ("%s: X=%s, Y=%s, Z=%s"):format(bone.name, bits[1], bits[2], bits[3])
		end
	end
	if next(cards) == nil then
		local names = {}
		for _, b in ipairs(bones) do names[#names + 1] = b.name end
		return fail(("no joints matched the filter - valid bones: %s"):format(table.concat(names, ", ")))
	end
	local ev = rigEvidence(rig)
	return okdata({ rig = ev, angleDeg = math.deg(angle), axes = cards },
		("AXIS MAP of %d/%d joints on rig '%s' (+%.0f deg per axis; root frame X=left/right Y=up/down Z=forward/back, WORLD-measured): %s"):format(#cards, #bones, ev.name, math.deg(angle), table.concat(summaries, " | ")))
end

local dispatch = {
	select_rig = api.select_rig, clear_rig_selection = api.clear_rig_selection,
	create = api.create, open = api.open, list = api.list,
	import = api.import, rebuild = api.rebuild,
	set_length = api.set_length, set_settings = api.set_settings,
	set_pose = function(a) return api.keyframe(a, true) end,
	add_keyframe = function(a) return api.keyframe(a, true) end,
	update_keyframe = function(a) return api.keyframe(a, false) end,
	delete_keyframe = api.delete_keyframe, move_keyframe = api.move_keyframe,
	clone_keyframe = api.clone_keyframe, set_easing = api.set_easing,
	set_marker = api.set_marker, delete_marker = api.delete_marker, inspect = api.inspect,
	reset = api.resets, stop_preview = api.resets, close = api.resets, apply = api.apply,
	preview = api.preview, simulate = api.simulate, test = api.test,
	map_axes = api.map_axes,
}

local args = jdec([==[__ARGS_JSON__]==])
if not args then return fail("bad args") end
local ok2, res = pcall(function()
	local fn = dispatch[args.op]
	if not fn then return fail("unknown animation op: " .. tostring(args.op)) end
	return fn(args)
end)
if not ok2 then return fail("animation error: " .. tostring(res)) end
return res
`;

// Virtual animation command definitions shown to the model via list_commands.
const ANIM_COMMANDS = [
  {
    name: "animation_select_rig",
    description: "Explicitly choose the rig that new animations should use. Use this in places with multiple dummies or characters; it also pins an already-open animation to the selected rig.",
    params: { path: { type: "string", req: true, desc: "dotted Model path, e.g. Workspace.R15" } }
  },
  {
    name: "animation_clear_rig_selection",
    description: "Clear the explicit rig choice so future animations use fresh automatic rig detection.",
    params: {}
  },
  {
    name: "animation_create",
    description: "Create a new Roblox animation (editable keyframe data) from the rig found in the place. R6 and R15 supported, joints via Motor6D or AnimationConstraint (Avatar Joint Upgrade) chains. FAILS if the name is already in the library unless overwrite=true is passed (protects existing animations from being wiped by accident).",
    params: {
      name: { type: "string", req: true, desc: "animation name, e.g. \"wave\"" },
      duration: { type: "number", req: false, desc: "total length in seconds (default 1)" },
      overwrite: { type: "boolean", req: false, desc: "default false - set true to replace an existing animation with this name" }
    }
  },
  {
    name: "animation_open",
    description: "Open (make active) an animation and return its keyframes + bone list. Pins the animation to the rig with the most joints if it was not pinned; if the stored pose tree does not match the rig's bones (e.g. old R6 names on an R15 rig) the tree is auto-rebuilt - check the reply and the 'rig' field.",
    params: { name: { type: "string", req: true, desc: "animation name" } }
  },
  {
    name: "animation_import",
    description: "Copy an existing KeyframeSequence from anywhere in the DataModel (e.g. 'Workspace.R15.AnimSaves.Run') into the library and open it, so it can be inspected, edited and previewed like a tool-created animation. Pinned to the current rig.",
    params: {
      path: { type: "string", req: true, desc: "dotted path of the KeyframeSequence, e.g. Workspace.R15.AnimSaves.Run" },
      name: { type: "string", req: false, desc: "library name (default = the sequence's own name)" },
      overwrite: { type: "boolean", req: false, desc: "default false - set true to replace an existing library animation with this name" }
    }
  },
  {
    name: "animation_rebuild",
    description: "Rebuild the active animation's pose trees onto its pinned rig: keyframe times kept, poses preserved for bones that still exist, poses not on the rig removed, missing bones added as rest poses. Use when the bone names do not match the rig (e.g. an R6 animation rebuilt for the R15 rig).",
    params: {}
  },
  {
    name: "animation_set_length",
    description: "Change the total duration of the active animation in seconds.",
    params: { duration: { type: "number", req: true, desc: "length in seconds (> 0)" } }
  },
  {
    name: "animation_set_settings",
    description: "Set native Roblox animation settings on the active KeyframeSequence. The settings are retained by Studio's Animation Editor.",
    params: {
      loop: { type: "boolean", req: false, desc: "whether playback loops" },
      priority: { type: "string", req: false, desc: "Core, Idle, Movement, Action, Action2, Action3, or Action4" }
    }
  },
  {
    name: "animation_inspect",
    description: "Return the full keyframe data of the active animation as JSON: every keyframe time plus each bone's position (studs) and rotation (degrees). Use this to reason about poses, spacing, arcs and symmetry without capture.",
    params: {}
  },
  {
    name: "animation_set_pose",
    description: "Set the pose of one or more bones at an EXACT keyframe timestamp. Creates the keyframe if it does not exist yet.",
    params: {
      t: { type: "number", req: true, desc: "keyframe timestamp in seconds" },
      poses: { type: "array", req: true, desc: "each item: {bone:\"<name>\", pos:[x,y,z]?, rot:[x,y,z]?} - rotation in DEGREES (YXZ convention), position in studs" }
    }
  },
  {
    name: "animation_add_keyframe",
    description: "Insert a new keyframe (default/rest pose) at timestamp t.",
    params: { t: { type: "number", req: true, desc: "timestamp in seconds" } }
  },
  {
    name: "animation_update_keyframe",
    description: "Update the pose of existing keyframe(s) at timestamp t (fails if no keyframe exists there).",
    params: {
      t: { type: "number", req: true, desc: "existing keyframe timestamp" },
      poses: { type: "array", req: true, desc: "same format as animation_set_pose" }
    }
  },
  {
    name: "animation_delete_keyframe",
    description: "Delete the keyframe at timestamp t.",
    params: { t: { type: "number", req: true, desc: "timestamp in seconds" } }
  },
  {
    name: "animation_move_keyframe",
    description: "Move a keyframe from from_t to to_t (no timestamps collide).",
    params: {
      from_t: { type: "number", req: true, desc: "current timestamp" },
      to_t: { type: "number", req: true, desc: "new timestamp" }
    }
  },
  {
    name: "animation_clone_keyframe",
    description: "Duplicate a complete keyframe, including every pose, easing choice, and marker, to a new timestamp.",
    params: {
      from_t: { type: "number", req: true, desc: "source keyframe timestamp" },
      to_t: { type: "number", req: true, desc: "new keyframe timestamp" }
    }
  },
  {
    name: "animation_set_easing",
    description: "Set native Roblox pose easing for the transition from this keyframe to the next. Omitting bones applies it to every pose in the keyframe; the viewport preview uses the same setting.",
    params: {
      t: { type: "number", req: true, desc: "keyframe timestamp" },
      style: { type: "string", req: true, desc: "Linear, Constant, Elastic, CubicV2, or Bounce" },
      direction: { type: "string", req: false, desc: "In, Out, or InOut (default Out)" },
      bones: { type: "array", req: false, desc: "optional list of exact bone names" }
    }
  },
  {
    name: "animation_set_marker",
    description: "Add or update a named KeyframeMarker. Markers are stored in the actual KeyframeSequence and can drive AnimationTrack marker signals after publishing.",
    params: {
      t: { type: "number", req: true, desc: "existing keyframe timestamp" },
      name: { type: "string", req: true, desc: "marker name" },
      value: { type: "string", req: false, desc: "optional marker payload" }
    }
  },
  {
    name: "animation_delete_marker",
    description: "Remove a named KeyframeMarker from an existing keyframe.",
    params: {
      t: { type: "number", req: true, desc: "existing keyframe timestamp" },
      name: { type: "string", req: true, desc: "marker name" }
    }
  },
  {
    name: "animation_preview",
    description: "Play the active animation directly on its pinned rig in the Studio viewport (Motor6D rigs via joint transforms; AnimationConstraint/BallSocketConstraint rigs by writing the joint chain onto the parts). Stops at the end and honours native pose easing.",
    params: { duration: { type: "number", req: false, desc: "preview length in seconds (default = animation length)" } }
  },
  {
    name: "animation_simulate",
    description:
      "Simulate the active animation AT EXACTLY time t (seconds): poses the rig in Studio at that moment and returns the WORLD position + rotation of every bone plus metrics (root height, hand mirror-symmetry deviation in studs, ground height, foot clearances: planted/FLOATING/CLIPPING THROUGH FLOOR). " +
      "Alternatively pass all=true for the QA SWEEP: every keyframe (start, middle, end, all in between) is checked in ONE call and the verdict lists every frame with floating feet, floor clipping or asymmetric hands - FIX all flagged frames and re-run until the verdict says CLEAN, BEFORE previewing. " +
      "Walking QA: each foot must read PLANTED in its stance frames, arms swing opposite to the legs, rootY bobs smoothly. Never declare an animation done after a non-CLEAN sweep.",
    params: {
      t: { type: "number", req: false, desc: "timestamp to simulate, e.g. 0, 0.5 (omit when using all=true)" },
      all: { type: "boolean", req: false, desc: "true = QA sweep over ALL keyframes (start/mid/end), return verdict" }
    }
  },
  {
    name: "animation_map_axes",
    description:
      "MEASURE the rig's real axis behavior before authoring directional motion (walks, runs, jumps). For every joint it rotates the joint on its local X, Y and Z axes one at a time (PURE MATH - rig untouched, works for Motor6D and AnimationConstraint rigs in or out of Edit mode) and measures the WORLD direction the limb actually swings, in the root's own frame: forward/back, up/down or left/right, including which SIGN (+/-) of each rotation goes which way. Walk prerequisite: run this FIRST, read each limb's axis card (e.g. LeftUpperLeg X=forward/back), then author the walk by rotating the LEG'S forward/back axis for the step and the ARM'S forward/back axis for the counter-swing - never guess an axis.",
    params: {
      filter: { type: "array", req: false, desc: "optional list of bone names to map, e.g. [\"LeftUpperLeg\",\"RightUpperLeg\"] (default: all joints)" },
      angle: { type: "number", req: false, desc: "probe angle in degrees per axis (default 30)" }
    }
  },
  {
    name: "animation_test",
    description:
      "Create a 1s 'RS_Test_Idle' test animation (idle, arms raised at the sides at t=0.5, idle) AND automatically MEASURE the rig's " +
      "rotation-sign convention: it applies +95 roll to the right arm and reads which way the arm really moved. The reply reports " +
      "'standard' (use rot values as given) or 'MIRRORED' (flip the sign of EVERY rot value you send on this rig). Run this once per rig, " +
      "before the first real poses. If it says it could not measure, verify directions with preview + user feedback instead.",
    params: {},
  },
  {
    name: "animation_stop_preview",
    description: "Stop the preview loop and reset the rig to its rest pose.",
    params: {}
  },
  {
    name: "animation_close",
    description: "Close the session: stop any preview loop and reset the rig to its rest pose. Use this for cleanup when you are done with an animation.",
    params: {}
  }
];

// Normalize the model's poses argument into [{bone,pos,rot}] for Luau.
function normalizePoses(arg) {
  if (!arg) return { poses: null };
  const out = [];
  const push = (bone, p) => {
    if (bone === undefined) return;
    const e = { bone: String(bone) };
    const vector = (v) => Array.isArray(v) && v.length === 3
      ? v.map(Number).every(Number.isFinite) ? v.map(Number) : null
      : null;
    const pos = vector(p.pos);
    const rot = vector(p.rot);
    if (pos) e.pos = pos;
    if (rot) e.rot = rot;
    if (!pos && !rot) return;
    out.push(e);
  };
  if (Array.isArray(arg)) {
    for (const item of arg) push(item.bone, item);
  } else if (arg && typeof arg === "object") {
    if (arg.bone !== undefined) push(arg.bone, arg);
    const bones = arg.bones;
    if (bones && typeof bones === "object") {
      if (Array.isArray(bones)) {
        for (const item of bones) push(item.bone, item);
      } else {
        for (const [bone, p] of Object.entries(bones)) push(bone, p || {});
      }
    }
  }
  return out.length ? { poses: out } : { poses: null };
}

function buildLuau(op, args) {
  args = args || {};
  const base = { op };
  const nonNegativeTime = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
  const positiveTime = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  // animation_create passes duration; keep everything else explicit.
  if (op === "select_rig") {
    if (!args.path || !String(args.path).trim()) return { err: "ERROR calling 'animation_select_rig': the rig Model path is required." };
    base.path = String(args.path).trim();
  } else if (op === "create") {
    if (!args.name || !String(args.name).trim()) return { err: "ERROR calling 'animation_create': the 'name' parameter is required. Call list_commands to see the parameters." };
    base.name = String(args.name).trim();
    const dur = Number(args.duration);
    if (args.duration !== undefined && !positiveTime(args.duration)) return { err: "ERROR calling 'animation_create': 'duration' must be a positive finite number of seconds." };
    if (dur > 0) base.duration = dur;
    if (args.overwrite === true) base.overwrite = true;
  } else if (op === "open") {
    if (!args.name || !String(args.name).trim()) return { err: "ERROR calling 'animation_open': the 'name' parameter is required." };
    base.name = String(args.name).trim();
  } else if (op === "set_length") {
    const dur = Number(args.duration);
    if (!positiveTime(args.duration)) return { err: "ERROR calling 'animation_set_length': 'duration' must be a positive finite number of seconds." };
    base.duration = dur;
  } else if (op === "set_settings") {
    if (args.loop === undefined && args.priority === undefined) return { err: "ERROR calling 'animation_set_settings': provide 'loop' and/or 'priority'." };
    if (args.loop !== undefined) {
      if (typeof args.loop !== "boolean") return { err: "ERROR calling 'animation_set_settings': 'loop' must be true or false." };
      base.loop = args.loop;
    }
    if (args.priority !== undefined) {
      const priority = String(args.priority);
      if (!new Set(["Core", "Idle", "Movement", "Action", "Action2", "Action3", "Action4"]).has(priority)) {
        return { err: "ERROR calling 'animation_set_settings': use a valid priority (Core, Idle, Movement, Action, Action2, Action3, or Action4)." };
      }
      base.priority = priority;
    }
  } else if (op === "set_pose" || op === "update_keyframe") {
    const t = Number(args.t);
    if (args.t === undefined || !nonNegativeTime(args.t)) return { err: `ERROR calling 'animation_${op}': 't' (seconds) is required and must be a finite value >= 0.` };
    const poses = normalizePoses(args.poses !== undefined ? args.poses : args.pose);
    if (!poses.poses) return { err: `ERROR calling 'animation_${op}': provide 'poses' as [{bone:\"...\", pos:[x,y,z], rot:[x,y,z]}] (deg) - inspect an animation first for the exact bone names.` };
    base.t = t;
    base.poses = poses.poses;
    if (op === "set_pose" || op === "add_keyframe") base.upsert = true;
  } else if (op === "add_keyframe") {
    const t = Number(args.t);
    if (args.t === undefined || !nonNegativeTime(args.t)) return { err: "ERROR calling 'animation_add_keyframe': 't' (seconds) is required and must be a finite value >= 0." };
    base.t = t;
    base.upsert = true;
  } else if (op === "import") {
    if (!args.path || !String(args.path).trim()) return { err: "ERROR calling 'animation_import': the 'path' parameter is required (e.g. Workspace.R15.AnimSaves.Run)." };
    base.path = String(args.path).trim();
    if (args.name && String(args.name).trim()) base.name = String(args.name).trim();
    if (args.overwrite === true) base.overwrite = true;
  } else if (op === "simulate") {
    const t = Number(args.t);
    if (args.t !== undefined && !nonNegativeTime(args.t)) return { err: "ERROR calling 'animation_simulate': 't' must be a finite value >= 0 seconds." };
    if (t >= 0) base.t = t;
    if (args.all === true) base.all = true;
  } else if (op === "delete_keyframe") {
    const t = Number(args.t);
    if (args.t === undefined || !nonNegativeTime(args.t)) return { err: "ERROR calling 'animation_delete_keyframe': 't' (seconds) is required and must be a finite value >= 0." };
    base.t = t;
  } else if (op === "move_keyframe") {
    const f = Number(args.from_t);
    const to = Number(args.to_t);
    if (args.from_t === undefined || !nonNegativeTime(args.from_t) || args.to_t === undefined || !nonNegativeTime(args.to_t)) {
      return { err: "ERROR calling 'animation_move_keyframe': 'from_t' and 'to_t' must be finite seconds >= 0." };
    }
    base.from_t = f;
    base.to_t = to;
  } else if (op === "preview") {
    const dur = Number(args.duration);
    if (args.duration !== undefined && !positiveTime(args.duration)) return { err: "ERROR calling 'animation_preview': 'duration' must be a positive finite number." };
    if (dur > 0) base.duration = dur;
  } else if (op === "apply") {
    const t = Number(args.t);
    if (args.t === undefined || !nonNegativeTime(args.t)) return { err: "ERROR: 't' (seconds) is required and must be a finite value >= 0." };
    base.t = t;
  } else if (op === "clone_keyframe") {
    if (!nonNegativeTime(args.from_t) || !nonNegativeTime(args.to_t)) return { err: "ERROR calling 'animation_clone_keyframe': 'from_t' and 'to_t' must be finite seconds >= 0." };
    base.from_t = Number(args.from_t);
    base.to_t = Number(args.to_t);
  } else if (op === "set_easing") {
    if (!nonNegativeTime(args.t)) return { err: "ERROR calling 'animation_set_easing': 't' must be finite seconds >= 0." };
    const style = String(args.style || "");
    const direction = String(args.direction || "Out");
    if (!new Set(["Linear", "Constant", "Elastic", "CubicV2", "Bounce"]).has(style)) return { err: "ERROR calling 'animation_set_easing': style must be Linear, Constant, Elastic, CubicV2, or Bounce." };
    if (!new Set(["In", "Out", "InOut"]).has(direction)) return { err: "ERROR calling 'animation_set_easing': direction must be In, Out, or InOut." };
    if (args.bones !== undefined && (!Array.isArray(args.bones) || args.bones.some((bone) => !String(bone).trim()))) return { err: "ERROR calling 'animation_set_easing': 'bones' must be an array of non-empty bone names." };
    base.t = Number(args.t);
    base.style = style;
    base.direction = direction;
    if (Array.isArray(args.bones)) base.bones = args.bones.map((bone) => String(bone).trim());
  } else if (op === "set_marker" || op === "delete_marker") {
    if (!nonNegativeTime(args.t)) return { err: `ERROR calling 'animation_${op}': 't' must be finite seconds >= 0.` };
    if (!args.name || !String(args.name).trim()) return { err: `ERROR calling 'animation_${op}': marker 'name' is required.` };
    base.t = Number(args.t);
    base.name = String(args.name).trim();
    if (op === "set_marker" && args.value !== undefined) base.value = String(args.value);
  } else if (op === "map_axes") {
    if (args.filter) {
      const list = Array.isArray(args.filter) ? args.filter : [args.filter];
      base.filter = list.map(String);
    }
    const angle = Number(args.angle);
    if (args.angle !== undefined && !(Number.isFinite(angle) && angle > 0 && angle < 90)) return { err: "ERROR calling 'animation_map_axes': 'angle' must be a finite number between 0 and 90 degrees." };
    if (angle > 0) base.angle = angle;
  }
  try {
    const json = JSON.stringify(base);
    if (json.includes("]==]")) return { err: "ERROR: internal serialization conflict." };
    return { code: ANIM_LIB_LUA.replace("__ARGS_JSON__", json) };
  } catch (e) {
    return { err: `ERROR building animation command: ${e}` };
  }
}

// Format the virtual command catalogue the same way main.js formats real tools.
function describeCommands() {
  const lines = [];
  lines.push(
    "— RobloxScript animation tools: build REAL Roblox animation keyframe data (KeyframeSequence/Pose) in Studio and " +
    "review it visually. Flow: animation_create → animation_open → animation_set_pose + animation_add_keyframe / " +
    "animation_update_keyframe per keyframe time → animation_preview to check → refine. " +
    "All rotations are DEGREES, order YXZ; bones are the character's joint-connected part names (e.g. RootJoint or HumanoidRootPart, LeftUpperArm, " +
    "RightLowerLeg); both Motor6D (R6/R15) and AnimationConstraint (Avatar Joint Upgrade) rigs are supported; times in seconds from 0 to duration. " +
    "Every call that touches the active animation ignores its name " +
    "parameter in favor of the animation currently open (see animation_open) — pass the name only to create/switch. " +
    "DIRECTIONS: rotations are local per-joint. Run animation_test FIRST - it measures the rig's convention and reports 'standard' or " +
    "'MIRRORED'; if mirrored, flip the sign of every rot value you send. When not measurable, verify with preview + user feedback. —"
  );
  for (const c of ANIM_COMMANDS) {
    const compact = [];
    const detailed = [];
    for (const [k, v] of Object.entries(c.params)) {
      const mark = v.req ? "" : "?";
      if (v.desc && v.desc.length > 45) {
        detailed.push(`    ${k}${mark}: ${v.type} - ${v.desc}`);
      } else {
        compact.push(`${k}${mark}:${v.type}${v.desc ? ` "${v.desc}"` : ""}`);
      }
    }
    const paramLines = [compact.length ? `    ${compact.join(", ")}` : "", ...detailed].filter(Boolean).join("\n");
    lines.push(`${c.name}: ${c.description}${paramLines ? "\n" + paramLines : ""}`);
  }
  return lines;
}

const RSAnim = {
  ANIM_LIB_LUA,
  ANIM_COMMANDS,
  ANIM_OPS: ANIM_COMMANDS.map((c) => c.name.slice("animation_".length)),
  buildLuau,
  describeCommands,
};
