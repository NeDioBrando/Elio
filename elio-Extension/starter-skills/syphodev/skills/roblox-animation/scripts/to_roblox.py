"""FK anim spec -> a ready-to-run Luau script that builds the KeyframeSequences in Studio.

  python to_roblox.py kick.json punch.json > build_sequences.lua

Paste the output into `execute_luau`. It creates ReplicatedStorage.CustomAnims
holding one KeyframeSequence per spec, then verifies each one loads.

AXIS MAP (derived, then verified by forward kinematics in Studio - see traps 30/33):
  Blender rig: rest limb points DOWN, X- = forward, Z+ = character's right.
  Roblox:      +X right, +Y up, -Z forward. Rotating a down vector (0,-1,0):
                 about +X -> -Z = FORWARD  =>  rx = -bx
                 about +Z -> +X = RIGHT    =>  rz = +bz
  Blender XYZ euler applies X INNERMOST (R = Rz*Ry*Rx) while CFrame.Angles applies
  Z first, so the CFrame is built explicitly in Blender's order.
  Translation: Blender (x, y, z) -> Roblox (x, z, -y).
"""
import json, sys, os

JOINT = {
    "TORSO": "LowerTorso", "UpTorso": "UpperTorso", "HEAD": "Head",
    "FK_UpperArm.R": "RightUpperArm", "FK_LowerArm.R": "RightLowerArm", "FK_Hand.R": "RightHand",
    "FK_UpperArm.L": "LeftUpperArm",  "FK_LowerArm.L": "LeftLowerArm",  "FK_Hand.L": "LeftHand",
    "FK_UpperLeg.R": "RightUpperLeg", "FK_LowerLeg.R": "RightLowerLeg", "FK_Foot.R": "RightFoot",
    "FK_UpperLeg.L": "LeftUpperLeg",  "FK_LowerLeg.L": "LeftLowerLeg",  "FK_Foot.L": "LeftFoot",
}
TREE = [("LowerTorso", "HumanoidRootPart"), ("UpperTorso", "LowerTorso"), ("Head", "UpperTorso"),
        ("LeftUpperArm", "UpperTorso"), ("LeftLowerArm", "LeftUpperArm"), ("LeftHand", "LeftLowerArm"),
        ("RightUpperArm", "UpperTorso"), ("RightLowerArm", "RightUpperArm"), ("RightHand", "RightLowerArm"),
        ("LeftUpperLeg", "LowerTorso"), ("LeftLowerLeg", "LeftUpperLeg"), ("LeftFoot", "LeftLowerLeg"),
        ("RightUpperLeg", "LowerTorso"), ("RightLowerLeg", "RightUpperLeg"), ("RightFoot", "RightLowerLeg")]
# Enum.PoseEasingStyle is Linear/Constant/Cubic/Elastic/Bounce - there is NO Quad.
EASE = {"in": ("Cubic", "In"), "out": ("Cubic", "Out"),
        "smooth": ("Cubic", "InOut"), "linear": ("Linear", "In")}


def convert(path):
    spec = json.load(open(path))
    out = []
    for k in spec["keyframes"]:
        style, direction = EASE[k.get("ease", "smooth")]
        poses = {}
        for bone, data in k["bones"].items():
            j = JOINT.get(bone)
            if j and "rot" in data:
                bx, by, bz = data["rot"]
                poses.setdefault(j, {})["r"] = [-bx, by, bz]
            if bone == "ROOT" and "loc" in data:
                lx, ly, lz = data["loc"]
                poses.setdefault("LowerTorso", {})["p"] = [lx, lz, -ly]
        out.append({"t": k["t"], "s": style, "d": direction, "poses": poses})
    name = spec.get("rbx_name") or os.path.splitext(os.path.basename(path))[0]
    posed = sorted({j for k in out for j in k["poses"]})
    # `pose_only` (Roblox joint names) is the clip's contract - e.g. an upper-body
    # clip must never pose a leg or the root, or at Action priority it freezes the
    # default walk. Refuse to build a clip that breaks its own contract.
    allowed = spec.get("pose_only")
    if allowed is not None:
        bad = [j for j in posed if j not in allowed]
        if bad:
            raise SystemExit(f"{path}: poses {bad} outside its pose_only contract {allowed}")
    return {"name": name, "posed": posed, "priority": spec.get("priority", "Action"),
            "loop": bool(spec.get("loop", False)), "duration": spec["duration"], "keyframes": out}


def _n(v):
    return ("%.4f" % v).rstrip("0").rstrip(".") or "0"


def _kfs(d):
    rows = []
    for k in d["keyframes"]:
        ps = []
        for j, v in sorted(k["poses"].items()):
            bits = []
            if "r" in v:
                bits.append("r={%s}" % ",".join(_n(x) for x in v["r"]))
            if "p" in v:
                bits.append("p={%s}" % ",".join(_n(x) for x in v["p"]))
            ps.append('["%s"]={%s}' % (j, ",".join(bits)))
        rows.append('{t=%s,s="%s",d="%s",poses={%s}}' % (_n(k["t"]), k["s"], k["d"], ",".join(ps)))
    return "{" + ",".join(rows) + "}"


HEAD = '''local ReplicatedStorage = game:GetService("ReplicatedStorage")
local KSP = game:GetService("KeyframeSequenceProvider")
local TREE = %s
local PARENT = {}
for _, pair in ipairs(TREE) do PARENT[pair[1]] = pair[2] end
local function build(name, priority, loopAnim, KFS)
\tlocal seq = Instance.new("KeyframeSequence")
\tseq.Name, seq.Priority, seq.Loop = name, Enum.AnimationPriority[priority], loopAnim
\tfor _, k in ipairs(KFS) do
\t\tlocal kf = Instance.new("Keyframe")
\t\tkf.Name, kf.Time = "KF" .. tostring(k.t), k.t
\t\t-- every Keyframe needs the FULL pose tree; untouched joints sit at identity
\t\tlocal poses = {}
\t\tlocal root = Instance.new("Pose")
\t\troot.Name, root.CFrame = "HumanoidRootPart", CFrame.new()
\t\tposes.HumanoidRootPart = root
\t\tfor _, pair in ipairs(TREE) do
\t\t\tlocal p = Instance.new("Pose")
\t\t\tp.Name = pair[1]
\t\t\tif not k.poses[pair[1]] then p.Weight = 0 end
\t\t\tlocal d, cf = k.poses[pair[1]], CFrame.new()
\t\t\tif d then
\t\t\t\tif d.r then
\t\t\t\t\tcf = CFrame.Angles(0,0,math.rad(d.r[3])) * CFrame.Angles(0,math.rad(d.r[2]),0) * CFrame.Angles(math.rad(d.r[1]),0,0)
\t\t\t\tend
\t\t\t\tif d.p then
\t\t\t\t\tcf = CFrame.new(d.p[1], d.p[2], d.p[3]) * cf
\t\t\t\tend
\t\t\tend
\t\t\tp.CFrame = cf
\t\t\tp.EasingStyle = Enum.PoseEasingStyle[k.s]
\t\t\tp.EasingDirection = Enum.PoseEasingDirection[k.d]
\t\t\tposes[pair[1]] = p
\t\tend
\t\t-- A joint the clip never keys gets NO Pose. The old builder wrote the full
\t\t-- tree at identity, so an upper-body clip at Action priority pinned both legs
\t\t-- straight and froze the default walk. Keep only keyed joints plus the
\t\t-- ancestors that hold them (those as Weight-0 containers).
\t\tlocal keep = {}
\t\tfor _, pair in ipairs(TREE) do
\t\t\tif k.poses[pair[1]] then
\t\t\t\tlocal j = pair[1]
\t\t\t\twhile j and j ~= "HumanoidRootPart" do keep[j] = true j = PARENT[j] end
\t\t\tend
\t\tend
\t\tfor _, pair in ipairs(TREE) do
\t\t\tif keep[pair[1]] then poses[pair[1]].Parent = poses[pair[2]] else poses[pair[1]]:Destroy() end
\t\tend
\t\troot.Parent = kf
\t\tkf.Parent = seq
\tend
\treturn seq
end
local folder = ReplicatedStorage:FindFirstChild("CustomAnims")
if not folder then
\tfolder = Instance.new("Folder")
\tfolder.Name = "CustomAnims"
\tfolder.Parent = ReplicatedStorage
end
local report = {}
'''

TAIL = '''
-- VERIFY: each sequence must load at its authored duration. Length reads 0 until
-- the asset loads, so wait before believing it.
local rig
for _, m in ipairs(workspace:GetDescendants()) do
\tif m:IsA("Humanoid") and m:FindFirstChildOfClass("Animator") then rig = m break end
end
if rig then
\tfor _, seq in ipairs(folder:GetChildren()) do
\t\tlocal a = Instance.new("Animation")
\t\ta.AnimationId = KSP:RegisterKeyframeSequence(seq)   -- BARE id; hash:// and rbxasset:// both fail
\t\tlocal t = rig:FindFirstChildOfClass("Animator"):LoadAnimation(a)
\t\tlocal w = 0
\t\twhile t.Length == 0 and w < 3 do task.wait(0.1) w += 0.1 end
\t\ttable.insert(report, ("%s: %d kf, loads %.2fs"):format(seq.Name, #seq:GetChildren(), t.Length))
\t\tt:Destroy() a:Destroy()
\tend
else
\ttable.insert(report, "no Humanoid+Animator in Workspace to verify against")
end
return table.concat(report, " | ")
'''


def builder(paths):
    tree = "{" + ",".join('{"%s","%s"}' % (c, p) for c, p in TREE) + "}"
    body = []
    for p in paths:
        d = convert(p)
        body.append('do local s = build("%s","%s",%s,%s) local old = folder:FindFirstChild(s.Name) '
                    'if old then old:Destroy() end s.Parent = folder end'
                    % (d["name"], d["priority"], str(d["loop"]).lower(), _kfs(d)))
    return (HEAD % tree) + "\n".join(body) + TAIL


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        raise SystemExit(0)
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    sys.stdout.write(builder(sys.argv[1:]))
