"""Pose-DSL -> real Blender Action -> frame renders, with per-frame integrity assertion.

  blender --background <rig>.blend --enable-autoexec --python anim_render.py -- <spec.json> <outdir>

ARCHITECTURE (see references/traps.md #1):
Do NOT set pose values and then render. Most Roblox rigs ship an Action holding
their rest pose (this R15 rig: ArmatureAction.001, 447 F-curves at frame 0) and
Blender RE-EVALUATES it during render, silently overwriting anything set from
script - pose queries look right while the rendered image shows the default.
Clearing the action instead destroys the rest pose it was holding.

The fix is to stop fighting it: INSERT KEYFRAMES into that same action. Then the
animation *is* the action, there is nothing to overwrite, every bone we do not
touch holds its frame-0 rest value by constant extrapolation, and we end up with
a real Action that can be exported to Roblox.

SPEC FIELDS
  fps, duration, w, h, fit, views      render settings
  ik_targets                           {control bone: driven deform part}
  keyframes[] = {t, bones: {BONE: {rot:[x,y,z] deg, loc:[x,y,z], target:[x,y,z]}}}

`target` is the useful one: a position in RIG SPACE (units, relative to the root
part's rest position, +X = character's right, +Y = forward, +Z = up, exactly the
frame `sweep_control.py` prints) which the solver converts into whatever bone-space
`loc` puts that limb's end effector there. Author positions where you want the
hand or foot to be; let the solver own the inverse kinematics. Raw `loc` still works and
is what you want for controls with no end effector (ROOT, POLE_ARM).
"""
import bpy, math, json, sys, os
from mathutils import Euler, Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
spec_path = argv[0]
# ABSOLUTE, always. Blender resolves a relative render filepath against the .BLEND
# FILE's directory, not the process CWD, so a relative outdir silently scatters
# frames next to the rig and the caller finds an empty output folder.
outdir = os.path.abspath(argv[1])
spec = json.load(open(spec_path))
os.makedirs(outdir, exist_ok=True)


def die(msg):
    """Fail LOUDLY and with a non-zero exit code.

    Blender swallows a bare SystemExit's status in some builds, so a broken run
    can exit 0 and look successful to the caller. Flush, then hard-exit.
    """
    print(f"\n!!! FAILED: {msg}", flush=True)
    sys.stdout.flush()
    os._exit(1)


FPS = spec.get("fps", 24)
DUR = spec["duration"]
KEYS = spec["keyframes"]
START = 10          # keep clear of the rig's own frame-0 rest keys

R15_CHAIN = {"LowerTorso": "HumanoidRootPart", "UpperTorso": "LowerTorso", "Head": "UpperTorso",
             "LeftUpperArm": "UpperTorso", "LeftLowerArm": "LeftUpperArm", "LeftHand": "LeftLowerArm",
             "RightUpperArm": "UpperTorso", "RightLowerArm": "RightUpperArm", "RightHand": "RightLowerArm",
             "LeftUpperLeg": "LowerTorso", "LeftLowerLeg": "LeftUpperLeg", "LeftFoot": "LeftLowerLeg",
             "RightUpperLeg": "LowerTorso", "RightLowerLeg": "RightUpperLeg", "RightFoot": "RightLowerLeg"}
R6_CHAIN = {"Right Arm": "Torso", "Left Arm": "Torso", "Head": "Torso",
            "Right Leg": "Torso", "Left Leg": "Torso"}
DEFAULT_IK = {"IK_LEG.R": "RightFoot", "IK_LEG.L": "LeftFoot",
              "IK_Hand.R": "RightHand", "IK_Hand.L": "LeftHand"}
# root joint each limb swings from, for `aim`
DEFAULT_AIM_FROM = {"IK_LEG.R": "RightUpperLeg", "IK_LEG.L": "LeftUpperLeg",
                    "IK_Hand.R": "RightUpperArm", "IK_Hand.L": "LeftUpperArm"}

# ---- pick the armature by its deform bones, never by a hardcoded name ----
arm = None
for o in bpy.data.objects:
    if o.type != "ARMATURE":
        continue
    names = {b.name for b in o.data.bones}
    if len(names & set(R15_CHAIN)) >= 10:
        arm, CHAIN, ROOTPART = o, dict(R15_CHAIN), "HumanoidRootPart"
        break
    if len(names & set(R6_CHAIN)) >= 4 and arm is None:
        arm, CHAIN, ROOTPART = o, dict(R6_CHAIN), "Torso"
if arm is None:
    die("no armature carrying R6 or R15 deform bones")
CHAIN = {c: p for c, p in CHAIN.items() if c in arm.pose.bones and p in arm.pose.bones}
if ROOTPART not in arm.pose.bones:
    die(f"root part {ROOTPART!r} missing from {arm.name!r}")
print(f"=== rig {arm.name!r}, {len(CHAIN)} chain joints, root part {ROOTPART!r}")

M = arm.matrix_world
sc = bpy.context.scene
IK = dict(DEFAULT_IK)
IK.update(spec.get("ik_targets", {}))
AIM_FROM = dict(DEFAULT_AIM_FROM)
AIM_FROM.update(spec.get("aim_from", {}))

BONES = sorted({b for k in KEYS for b in k["bones"]})

# A BONE KEYED LATER MUST ALSO BE KEYED IN THE FIRST BEAT.
#
# Values are held by constant extrapolation, so a bone whose earliest key is at
# t=0.7 carries that value BACKWARDS across the entire opening of the clip. A
# 38-degree knee bend authored for the bottom of a slam therefore had the boss
# crouched from frame 0, which read as a character leaning forward - invisible
# from the front, obvious from the side, and impossible to attribute to the beat
# that actually caused it because that beat is half a second later.
#
# This is a spec error, not a pose error, and it is cheap to make: you write the
# idle, then add detail to the action beats and never go back.
_first = KEYS[0]["bones"] if KEYS else {}
_late = sorted(b for b in BONES if b not in _first)
if _late:
    die("these bones are keyed later in the clip but NOT in the first beat, so "
        "their value extrapolates backwards over the opening and the clip starts "
        f"in a pose you never authored: {', '.join(_late)}. Add them to the beat "
        f"at t={KEYS[0]['t']}.")

# AND THE LAST BEAT MUST LAND ON A RENDERED FRAME.
#
# n = round(duration * fps) frames are rendered at t = i/fps, so the last instant
# that exists is (n-1)/fps. A beat authored past it is simply never reached: the
# take ends mid-transition and the closing pose - usually the return to idle -
# is not in the clip at all. At 30fps a 0.55s duration gives 16 frames covering
# 0..0.50, so a recover beat at 0.55 silently did not happen, and the swing
# ended stuck in its follow-through.
# `n` is not bound until the bake section further down, so compute it here
# rather than reaching forward - referencing it early made Blender die with a
# NameError that the caller's log filter swallowed whole.
# ROBLOX PLAYS A CLIP FOR EXACTLY ITS LAST KEYFRAME'S TIME (AnimationTrack.Length
# = the last Keyframe.Time), so a 0.6s clip needs a beat AT t=0.6. The old
# n = round(D*fps) frame count stopped rendering at (n-1)/fps = 0.567 and refused
# that beat, which forced every clip to ship one frame SHORT of its authored
# duration in Studio, or to be judged on renders that never showed its final pose.
#   one-shot (loop false): render n+1 frames, 0..D INCLUSIVE, so the final pose
#                          is on the sheet.
#   loop (loop true):      render n frames, 0..D-1/fps. The beat at t=D is the
#                          wrap point and MUST equal the first beat (asserted
#                          below); rendering it would put a duplicate frame -
#                          a visible hitch - into every looping GIF.
LOOP = bool(spec.get("loop", False))
_n_frames = int(round(DUR * FPS)) + (0 if LOOP else 1)
_last_instant = (_n_frames - 1) / FPS if _n_frames > 0 else 0.0
_last_beat = max(k["t"] for k in KEYS) if KEYS else 0.0
# Half a frame of tolerance, not float epsilon. A beat is sampled to the
# nearest frame regardless, so 0.6667 against a last instant of 0.66666...
# is the same frame and not a defect - failing it just teaches people to
# write more decimal places. What this catches is a beat a whole frame or
# more past the end, which is a beat that genuinely never happens.
_wrap_ok = LOOP and abs(_last_beat - DUR) <= 0.5 / FPS
if _last_beat > _last_instant + (0.5 / FPS) and not _wrap_ok:
    die(f"the last beat is at t={_last_beat} but this clip only renders out to "
        f"t={_last_instant:.4f} ({_n_frames} frames at {FPS}fps). That beat is never "
        f"reached and the clip ends in a pose you did not author. Move it to "
        f"{_last_instant:.4f} or lengthen the duration.")
for b in BONES:
    if b not in arm.pose.bones:
        die(f"unknown bone {b!r} - run calibrate_rig.py to see what this rig has")

# A LOOPED CLIP MUST END ON ITS FIRST POSE.
# Roblox wraps a looping track from its last keyframe straight to its first, so
# any difference between the two is a one-frame SNAP on every cycle - the thing
# a Victory or Defeat loop plays for as long as the screen is up. Every value of
# every bone must match, and the last beat must sit at t=duration.
if LOOP and KEYS:
    _k0, _kN = KEYS[0], KEYS[-1]
    if abs(_kN["t"] - DUR) > 0.5 / FPS:
        die(f"loop clip: the last beat is at t={_kN['t']} but the duration is {DUR}; "
            f"put the wrap beat (a copy of t={_k0['t']}) AT t={DUR}")
    _seam = []
    for b in BONES:
        for fld in set(_k0["bones"].get(b, {})) | set(_kN["bones"].get(b, {})):
            a, z = _k0["bones"].get(b, {}).get(fld), _kN["bones"].get(b, {}).get(fld)
            if a is None or z is None or any(abs(x - y) > 1e-6 for x, y in zip(a, z)):
                _seam.append(f"{b}.{fld} {a} -> {z}")
    if _seam:
        die("loop clip: first and last beats differ, so it SNAPS on every wrap: "
            + "; ".join(_seam))
# A `target` on a bone with no known end effector would silently solve nothing.
for b in BONES:
    for k in KEYS:
        a = k["bones"].get(b, {}).get("aim")
        if a is not None and len(a) != 4:
            die(f"{b} aim at t={k['t']} must be [dx, dy, dz, reach], got {len(a)} values")
        if a is not None and not (0.0 < a[3] <= 1.0):
            die(f"{b} aim reach at t={k['t']} is {a[3]}; must be in (0, 1] - it is a "
                f"FRACTION of the limb's straight length, not a distance")
for b in BONES:
    if any("target" in k["bones"].get(b, {}) for k in KEYS):
        if b not in IK:
            die(f"bone {b!r} uses `target` but has no ik_targets entry naming its end effector")
        if IK[b] not in arm.pose.bones:
            die(f"ik_targets[{b!r}] names {IK[b]!r}, which is not a bone on this rig")

# ---- rig custom properties, e.g. flipping the IK/FK switch ----
# On this R15 rig PROPERTIES.ARM_IK_FK / LEG_IK_FK default to 1.0 (IK), which is
# why every FK_* bone reads inert. Setting them to 0.0 hands you one control bone
# per R15 joint, rotating 1:1 in degrees - which is exactly what a Roblox
# KeyframeSequence stores, so FK is the NATIVE way to author for Roblox and IK is
# the detour. They must be KEYED as well as set: frame_set re-evaluates the action
# every frame and would otherwise snap the switch back to IK mid-bake.
PROPS = spec.get("properties", {})
prop_bone = None
if PROPS:
    for pb in arm.pose.bones:
        if all(k in pb.keys() for k in PROPS):
            prop_bone = pb
            break
    if prop_bone is None:
        die(f"no pose bone carries all of {list(PROPS)} - check names with calibrate_rig.py")

if not (arm.animation_data and arm.animation_data.action):
    die("rig has no action to key into")
act = arm.animation_data.action
print(f"=== keying into existing action {act.name!r} ({len(act.fcurves)} fcurves) from frame {START}")


def head(b):
    return M @ arm.pose.bones[b].head


def joint_lengths():
    return {c: (head(c) - head(p)).length for c, p in CHAIN.items()}


# Per-segment easing. A fixed smoothstep eases to a STOP at every keyframe, which
# on a 5-pose combat move reads mushy and robotic - the strike decelerates into
# its own contact frame. Roblox's editor exposes easing per keyframe for exactly
# this reason. `ease` on a keyframe governs the segment STARTING there.
EASE = {
    "smooth": lambda f: f * f * (3 - 2 * f),   # ease in and out (default)
    "linear": lambda f: f,
    "in":     lambda f: f * f,                 # accelerate - drive INTO a strike
    "out":    lambda f: 1 - (1 - f) * (1 - f),  # decelerate - settle, follow through
}


def smooth(f):
    return EASE["smooth"](f)


def sample(bone, field, t):
    ks = [k for k in KEYS if bone in k["bones"] and field in k["bones"][bone]]
    if not ks:
        return None
    if t <= ks[0]["t"]:
        return tuple(ks[0]["bones"][bone][field])
    if t >= ks[-1]["t"]:
        return tuple(ks[-1]["bones"][bone][field])
    for a, b in zip(ks, ks[1:]):
        if a["t"] <= t <= b["t"]:
            span = b["t"] - a["t"]
            fn = EASE.get(a.get("ease", "smooth"))
            if fn is None:
                die(f"unknown ease {a.get('ease')!r} at t={a['t']}; use {list(EASE)}")
            f = 0.0 if span == 0 else fn((t - a["t"]) / span)
            va, vb = a["bones"][bone][field], b["bones"][bone][field]
            return tuple(va[i] + (vb[i] - va[i]) * f for i in range(len(va)))
    return tuple(ks[-1]["bones"][bone][field])


# ---- capture the rig-space frame the spec's `target` positions are written in ----
sc.frame_set(0)
bpy.context.view_layer.update()
ORIGIN = head(ROOTPART).copy()
REST = joint_lengths()
REST_LOC = {b: arm.pose.bones[b].location.copy() for b in BONES}
print(f"=== rig-space origin (rest {ROOTPART}) {tuple(round(v, 3) for v in ORIGIN)}")


def chain_reach(eff, root):
    """Rest length of the bone chain from `root` down to `eff`, summed segment
    by segment - i.e. how far that limb can extend when perfectly straight."""
    total, cur = 0.0, eff
    while cur != root:
        if cur not in CHAIN:
            die(f"no chain path from {root!r} down to {eff!r}")
        total += REST[cur]
        cur = CHAIN[cur]
    return total


AIM_REACH = {}
for b in BONES:
    if any("aim" in k["bones"].get(b, {}) for k in KEYS):
        if b not in IK:
            die(f"bone {b!r} uses `aim` but has no ik_targets entry naming its end effector")
        root = AIM_FROM.get(b)
        if root is None or root not in arm.pose.bones:
            die(f"bone {b!r} uses `aim` but aim_from has no valid root joint for it")
        AIM_REACH[b] = (root, chain_reach(IK[b], root))
        print(f"=== aim {b}: {IK[b]} swings from {root}, straight-limb reach "
              f"{AIM_REACH[b][1]:.3f}")


def aim_target(bone, a):
    """Resolve an `aim` [dx, dy, dz, reach] to a world position.

    `dir` is the direction the limb points, `reach` is the fraction of its
    straight length - so 0.96 is 'almost locked out' and 0.55 is 'well folded'.

    This is measured from the limb's root joint AS IT IS ON THIS FRAME, which is
    the whole point. A fixed rig-space target cannot hold a limb straight while
    the torso twists: the twist swings the hip forward, the hip-to-target
    distance silently drops below full reach, and the knee folds into a V that
    the solver reports as a perfect hit because the ankle IS where you asked.
    It is also the right currency for matching a human reference pose, where limb
    proportions differ - a human leg is 43% of standing height and R15's is 34%,
    so copying grid distances gives nonsense while copying ANGLE and EXTENSION
    transfers exactly.
    """
    root, L = AIM_REACH[bone]
    d = Vector(a[:3])
    if d.length < 1e-6:
        die(f"{bone} aim direction is zero-length")
    return head(root) + d.normalized() * L * a[3]


def solve_ik(bone, want, iters=28, h=0.04):
    """Find the bone-space `location` putting `bone`'s end effector at `want`.

    DAMPED LEAST SQUARES, not plain Newton: step = (J'J + lam.I)^-1 J' err, with a
    numeric 3x3 Jacobian re-estimated every step.

    The damping is load-bearing, not a refinement. These rigs rest with the limbs
    EXACTLY straight (this R15: hip->ankle 1.748 = 0.822 + 0.926 to three decimals),
    so at the rest pose the IK chain sits on its reach singularity - pushing the
    target further along the limb axis moves the effector not at all, J loses rank
    in that direction, and a plain `J.inverted()` raises on the FIRST iteration and
    leaves the limb at rest. The failure looks exactly like an unreachable target,
    so it gets mis-diagnosed as "pull the target closer" and the pose is quietly
    thrown away. lam keeps the system solvable and shrinks as the residual falls.

    Returns (location, residual). A residual that stays large after this really is
    out of reach, and the caller reports it rather than shipping a limb that
    silently stopped short.
    """
    pb = arm.pose.bones[bone]
    eff = IK[bone]

    def effector(l):
        pb.location = l
        bpy.context.view_layer.update()
        return head(eff)

    def descend(seed):
        loc = seed.copy()
        best, best_err = loc.copy(), (want - effector(loc)).length
        lam = 0.05
        for _ in range(iters):
            cur = effector(loc)
            err = want - cur
            if err.length < 1e-4:
                break
            cols = []
            for ax in range(3):
                probe = loc.copy()
                probe[ax] += h
                cols.append((effector(probe) - cur) / h)
            # J columns are d(effector)/d(loc_axis)
            JTJ = [[cols[i].dot(cols[j]) for j in range(3)] for i in range(3)]
            for i in range(3):
                JTJ[i][i] += lam
            JTe = Vector((cols[0].dot(err), cols[1].dot(err), cols[2].dot(err)))
            try:
                step = Matrix(JTJ).inverted() @ JTe
            except ValueError:
                lam *= 10.0           # still singular: damp harder and retry
                if lam > 1e3:
                    break
                continue
            if step.length > 0.6:     # cap: big steps overshoot near the reach limit
                step *= 0.6 / step.length
            trial = loc + step
            e = (want - effector(trial)).length
            if e < best_err:
                best, best_err = trial.copy(), e
                loc, lam = trial, max(lam * 0.5, 1e-4)
            else:
                lam *= 4.0            # rejected: shorten the step
                if lam > 1e3:
                    break
        return best, best_err

    # Warm start from the previous frame keeps the solution temporally coherent,
    # which matters: two equally-good IK solutions on consecutive frames make the
    # limb pop even though both frames verify fine.
    best, best_err = descend(pb.location.copy())

    # FALL BACK TO A COARSE SEARCH, don't trust one descent. Where the limb IK
    # saturates the Jacobian columns decay toward zero, so every step is
    # "accepted" for a thousandth of an improvement and the descent asymptotes
    # far from a target that a grid search reaches easily. Measured on this rig:
    # descent stalled at z=-0.94 on a point whose reachable envelope goes to
    # +0.37. Only reachable-looking failures pay this cost.
    if best_err > REACH_TOL:
        g = [-1.4, -0.7, 0.0, 0.7, 1.4]
        seed, seed_err = None, best_err
        for x in g:
            for y in g:
                for z in g:
                    v = Vector((x, y, z))
                    e = (want - effector(v)).length
                    if e < seed_err:
                        seed, seed_err = v, e
        if seed is not None:
            cand, cand_err = descend(seed)
            if cand_err < best_err:
                best, best_err = cand, cand_err

    effector(best)
    return best, best_err


n = _n_frames
REACH_TOL = spec.get("reach_tolerance", 0.12)

# ---- 1. bake the spec into the action as real keyframes ----
worst_reach = 0.0
reach_fail = []
for i in range(n):
    t = i / FPS
    f = START + i
    sc.frame_set(f)
    for k, v in PROPS.items():
        prop_bone[k] = v
        prop_bone.keyframe_insert(f'["{k}"]', frame=f)
    if PROPS:
        bpy.context.view_layer.update()
    # Rotations first: `target` is solved against the posed body, so the torso
    # twist for this frame must already be applied before the limb is placed.
    for bone in BONES:
        pb = arm.pose.bones[bone]
        r = sample(bone, "rot", t)
        if r is not None:
            if pb.rotation_mode == "QUATERNION":
                pb.rotation_mode = "XYZ"
            pb.rotation_euler = Euler([math.radians(v) for v in r], "XYZ")
        l = sample(bone, "loc", t)
        if l is not None:
            pb.location = Vector(l)
    bpy.context.view_layer.update()

    for bone in BONES:
        pb = arm.pose.bones[bone]
        tg = sample(bone, "target", t)
        am = sample(bone, "aim", t)
        if tg is None and am is None:
            continue
        want = aim_target(bone, am) if am is not None else ORIGIN + Vector(tg)
        if tg is not None and am is not None:
            die(f"{bone} has BOTH `target` and `aim` at t={t:.3f}; pick one")
        loc, res = solve_ik(bone, want)
        pb.location = loc
        bpy.context.view_layer.update()
        worst_reach = max(worst_reach, res)
        if res > REACH_TOL:
            got = head(IK[bone]) - ORIGIN
            asked = tuple(round(v, 2) for v in (tg if tg is not None else (want - ORIGIN)))
            reach_fail.append((i, bone, asked,
                               tuple(round(v, 2) for v in got), round(res, 3)))
    bpy.context.view_layer.update()

    for bone in BONES:
        pb = arm.pose.bones[bone]
        if sample(bone, "rot", t) is not None:
            pb.keyframe_insert("rotation_euler", frame=f)
        if any(sample(bone, k, t) is not None for k in ("loc", "target", "aim")):
            pb.keyframe_insert("location", frame=f)

print(f"=== baked {n} frames of keys; action now has {len(act.fcurves)} fcurves")

# ---- 1a. THE PROP: render the weapon the game will actually put in the hand ----
#
# WHY THIS EXISTS. Every animation this toolchain produced before 2026-09-02 was
# judged as a bare rig. A swing is not an arm moving, it is an arm moving HOLDING
# something, and the two are not separable: a grip offset that reads fine in a
# static pose can put the blade through the forearm at the top of the arc. The
# defect that made this obvious shipped a sword sticking vertically out of a
# closed fist, and it survived a playtest because a playtest screenshot is ONE
# FRAME and cannot show you a swing.
#
# The prop is BAKED per frame off the attach bone rather than parented. Bone
# parenting puts the child at the bone TAIL and mixes its rest orientation into
# the offset, so the number you tune stops meaning anything you can hand to
# Roblox. Baking keeps the offset a plain transform relative to the bone's pose
# matrix, which is a quantity both engines can agree about.
PROP = spec.get("prop")
prop_obj = None
if PROP:
    attach = PROP.get("attach", "RightHand")
    if attach not in arm.pose.bones:
        die(f"prop attaches to {attach!r}, which is not a bone on this rig")

    parts = PROP.get("parts") or []
    GLB = PROP.get("glb")
    if not parts and not GLB:
        die("prop declares no parts - a prop with no geometry renders nothing, "
            "which looks exactly like having no prop at all")

    # One empty holds the assembly so the whole prop is placed with one transform.
    prop_obj = bpy.data.objects.new(PROP.get("name", "Prop"), None)
    bpy.context.collection.objects.link(prop_obj)

    # ---- REAL MESH PROP ----------------------------------------------------
    # Box parts are a stand-in. When the mesh stage has already produced the
    # actual weapon, judging the swing against a box is judging a different
    # object: the box has no crossguard to bury in a wrist and no curve to put
    # through a forearm. `glb` imports the shipped mesh instead.
    #
    # `glb_origin` is the point IN MESH SPACE that goes in the fist - a glaive
    # is held two thirds down the haft, not at its centroid - and it is
    # subtracted so the empty's origin IS the grip point. Everything downstream
    # (grip_bone, tip, the derived Roblox grip) is then measured from the same
    # place.
    if GLB:
        if not os.path.exists(GLB):
            die(f"prop glb {GLB!r} does not exist")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=GLB)
        imported = [o for o in set(bpy.data.objects) - before]
        meshes = [o for o in imported if o.type == "MESH"]
        if not meshes:
            die(f"prop glb {GLB!r} imported no mesh objects")
        ox, oy, oz = PROP.get("glb_origin", [0, 0, 0])
        col = PROP.get("colour", [0.72, 0.70, 0.66])
        mat = bpy.data.materials.new(PROP.get("name", "Prop") + "_M")
        mat.use_nodes = True
        _b = mat.node_tree.nodes.get("Principled BSDF")
        if _b:
            _b.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1)
            _b.inputs["Roughness"].default_value = 0.4
        for o in meshes:
            # Bake the import's own transform into the vertices so the object's
            # location means one thing only. The glTF importer parents meshes
            # under a rotated empty; leaving that in place makes every offset
            # below a statement about a frame nobody measured.
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            o.parent = None
            bpy.ops.object.transform_apply(location=True, rotation=True,
                                           scale=True)
            o.location = (-ox, -oy, -oz)
            o.data.materials.clear()
            o.data.materials.append(mat)
            o.parent = prop_obj
            o["prop_keep_material"] = True
        for o in imported:
            if o.type != "MESH" and o.parent is None and not o.children:
                bpy.data.objects.remove(o, do_unlink=True)
        print(f"=== prop mesh: {len(meshes)} object(s) from {os.path.basename(GLB)}, "
              f"grip point shifted by {(-ox, -oy, -oz)}")

    for part in parts:
        sx, sy, sz = part["size"]
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        cube = bpy.context.active_object
        cube.name = part.get("name", "PropPart")
        # A size=1.0 cube already spans -0.5..+0.5, so the scale IS the
        # dimension - halving it builds every part at half size.
        #
        # AND THE SIZE MUST BE SWAPPED THE SAME WAY THE POSITION IS. The game's
        # axes are X right / Y up / Z back and Blender's are X right / Y forward
        # / Z up, so a part's position goes (x, -z, y) - and its extents have to
        # follow. Swapping one and not the other laid a 4.4-stud blade ACROSS
        # the character instead of along the blade axis, which rendered as a bar
        # floating over a guard that was correctly in the fist. Every assertion
        # still passed: the prop was rigidly attached, its parts followed it,
        # and the tip arithmetic was right about a mesh built the wrong way
        # round.
        cube.scale = (sx, sz, sy)
        # Part offsets are given in the prop's own space, in the SAME axis
        # convention the game uses (X right, Y up, Z back), so the numbers can be
        # copied straight out of the weapon builder without reinterpretation.
        px, py, pz = part.get("pos", [0, 0, 0])
        cube.location = (px, -pz, py)
        col = part.get("colour", [0.6, 0.6, 0.62])
        mat = bpy.data.materials.new(cube.name + "_M")
        mat.use_nodes = True
        b = mat.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1)
            b.inputs["Roughness"].default_value = 0.45
            if part.get("emissive"):
                # The lit fuller is what makes a tier readable across a room, so
                # it has to be visible in the sheet too.
                try:
                    b.inputs["Emission Color"].default_value = (col[0], col[1], col[2], 1)
                    b.inputs["Emission Strength"].default_value = 2.5
                except KeyError:
                    pass
        cube.data.materials.append(mat)
        cube.parent = prop_obj
        # `plain` overrides every material to flat grey for pose reading. The prop
        # is exempt: the whole point of it being here is to see the weapon, and a
        # grey sword against a grey arm is not a check.
        cube["prop_keep_material"] = True

    # TWO WAYS TO SPELL THE OFFSET, and only one of them is guessable.
    #
    # `grip_bone` is raw BONE space - the frame probe_bone.py prints - and is what
    # you tune against a render. `grip` is the game's frame (X right, Y up, Z
    # back), kept for specs that were authored that way.
    #
    # They are not interchangeable and converting between them by hand is where
    # the error lives: the Roblox hand PART has the character's axes, while the
    # Blender hand BONE has +Y running down the fingers and +Z pointing behind
    # the character. Measure the bone, author in bone space, and check the result
    # against the engine by eye - do not trust an axis conversion nobody tested.
    gb = PROP.get("grip_bone")
    if gb:
        gx, gy, gz = gb.get("pos", [0, 0, 0])
        grot = gb.get("rot", [0, 0, 0])
        GRIP_OFFSET = (
            Matrix.Translation(Vector((gx, gy, gz)))
            @ Euler([math.radians(v) for v in grot], "XYZ").to_matrix().to_4x4()
        )
    else:
        gx, gy, gz = PROP.get("grip", {}).get("pos", [0, 0, 0])
        grot = PROP.get("grip", {}).get("rot", [0, 0, 0])
        GRIP_OFFSET = (
            Matrix.Translation(Vector((gx, -gz, gy)))
            @ Euler([math.radians(v) for v in grot], "XYZ").to_matrix().to_4x4()
        )

    # RELEASE. Some clips are ABOUT the prop leaving the hand - planting a stake,
    # dropping a torch, throwing. A prop that is baked to the hand for every frame
    # cannot show that, so the contact sheet is of a different action than the one
    # the spec asked for, and it will look completely convincing.
    #
    # `"release": {"t": 0.9}` bakes the prop onto the bone up to that time and then
    # HOLDS ITS WORLD TRANSFORM for the rest of the take, which is exactly what the
    # game does when it unwelds the tool and leaves a static model standing there.
    REL = PROP.get("release")
    REL_FRAME = None
    if REL is not None:
        REL_FRAME = int(round(float(REL["t"]) * FPS))
        if not (0 < REL_FRAME < n):
            die(f"prop release t={REL['t']} lands on frame {REL_FRAME}, outside "
                f"0..{n - 1} - a release outside the take is not a release")

    held_mat = None
    for i in range(n):
        f = START + i
        sc.frame_set(f)
        bpy.context.view_layer.update()
        if REL_FRAME is not None and i >= REL_FRAME:
            prop_obj.matrix_world = held_mat
        else:
            bone_mat = arm.matrix_world @ arm.pose.bones[attach].matrix
            prop_obj.matrix_world = bone_mat @ GRIP_OFFSET
            held_mat = prop_obj.matrix_world.copy()
        prop_obj.keyframe_insert(data_path="location", frame=f)
        prop_obj.rotation_mode = "XYZ"
        prop_obj.keyframe_insert(data_path="rotation_euler", frame=f)
        prop_obj.keyframe_insert(data_path="scale", frame=f)
    # PROVE THE ATTACHMENT, do not eyeball it.
    #
    # A prop that is rigidly attached has a CONSTANT distance from its anchor
    # bone across every frame. If that number wanders, the prop is not attached
    # and no amount of staring at a contact sheet will tell you whether the gap
    # you can see is a bug or a foreshortened arm. This turns "does the sword
    # look like it is in the hand" into a subtraction.
    HELD = range(n) if REL_FRAME is None else range(REL_FRAME)
    dists = []
    for i in HELD:
        f = START + i
        sc.frame_set(f)
        bpy.context.view_layer.update()
        bone_head = (arm.matrix_world @ arm.pose.bones[attach].matrix).translation
        dists.append((prop_obj.matrix_world.translation - bone_head).length)
    spread = max(dists) - min(dists)
    if REL_FRAME is not None:
        # AND PROVE THE RELEASE ACTUALLY HAPPENED. A release that leaves the prop
        # within a hand's width of the fist for the rest of the take is not a
        # release you can see, and "the moment it leaves the hands" is the whole
        # point of the clip.
        sc.frame_set(START + n - 1)
        bpy.context.view_layer.update()
        endgap = ((arm.matrix_world @ arm.pose.bones[attach].matrix).translation
                  - prop_obj.matrix_world.translation).length
        print(f"=== prop RELEASED at frame {REL_FRAME} (t={REL['t']}); at the last "
              f"frame the hand is {endgap:.2f} studs from the grip point "
              f"(held distance was {dists[0]:.2f})")
        if endgap - dists[0] < float(REL.get("min_separation", 0.6)):
            die(f"the release is not visible: the hand ends {endgap:.2f} studs from "
                f"the prop against {dists[0]:.2f} while held, a separation of only "
                f"{endgap - dists[0]:.2f}. Author the hand travelling away from the "
                f"planted prop, or nobody can see it leave.")
    print(f"=== prop {prop_obj.name!r}: {len(parts)} part(s) baked onto {attach!r} "
          f"across {n} frames")
    print(f"=== prop anchor distance {min(dists):.4f}..{max(dists):.4f} "
          f"(spread {spread:.5f}) - a rigid attachment holds this constant")
    # WHERE THE BUSINESS END ACTUALLY GOES, per authored beat.
    #
    # "Does this read as a downward diagonal cut" is a question about where the
    # TIP travels, and a contact sheet answers it badly - foreshortening makes a
    # blade sweeping toward camera look like a blade sweeping up. Printing the
    # tip in rig space turns it into three numbers you can check against the
    # intent written in the beat's own note.
    tip_local = PROP.get("tip")
    # `points` is the same idea for more than one landmark: a stake needs its BUTT
    # tracked (is it in the ground?) as much as its head, and a rifle needs its
    # muzzle and its butt-plate (is it in the shoulder?). One name per question.
    POINTS = dict(PROP.get("points", {}))
    if tip_local:
        POINTS.setdefault("tip", tip_local)
    if POINTS:
        names = list(POINTS)
        print(f"=== PROP LANDMARKS per beat (rig space: +X right, +Y forward, "
              f"+Z up, relative to the rest {ROOTPART}; the floor is z="
              f"{-ORIGIN.z:.2f})")
        for k in KEYS:
            bi = int(round(k["t"] * FPS))
            if bi >= n:
                bi = n - 1
            sc.frame_set(START + bi)
            bpy.context.view_layer.update()
            cells = []
            for nm in names:
                rel = (prop_obj.matrix_world @ Vector(POINTS[nm])) - ORIGIN
                cells.append(f"{nm}=({rel.x:6.2f},{rel.y:6.2f},{rel.z:6.2f})")
            note = k.get("_note", "")[:40]
            print(f"    t={k['t']:<5} {'  '.join(cells)}  {note}")

    # And check the PARTS follow the empty, not just the empty follow the bone.
    #
    # The anchor assertion above only proves the empty is on the bone. If the
    # children are not actually inheriting that transform, every reported tip is
    # still correct arithmetic about an object nobody is drawing - which looks,
    # in a contact sheet, exactly like a weapon floating beside the hand.
    sc.frame_set(START)
    bpy.context.view_layer.update()
    pm = prop_obj.matrix_world
    worst_part, worst_err = None, 0.0
    for child in prop_obj.children:
        expected = pm @ child.matrix_local.translation
        actual = child.matrix_world.translation
        err = (expected - actual).length
        if err > worst_err:
            worst_part, worst_err = child.name, err
    print(f"=== prop parts follow the anchor: worst drift {worst_err:.5f} "
          f"({worst_part})")
    if worst_err > 1e-3:
        die(f"prop part {worst_part!r} is NOT following the anchor (off by "
            f"{worst_err:.4f}). The tip numbers above are arithmetic about an "
            f"object that is not being drawn where they say.")

    if spread > 1e-3:
        die(f"the prop is NOT rigidly attached to {attach!r}: its distance from the "
            f"bone varies by {spread:.4f} across the take. Every frame of this "
            f"render would be showing a weapon in a place the game will not put it.")

    # ---- DERIVE THE ROBLOX Tool.Grip FROM THIS SCENE -----------------------
    #
    # NEVER TYPE A GRIP. The number that puts the prop in the fist in Blender and
    # the number Roblox needs are the same physical fact expressed in two frames,
    # so it must be MEASURED off the object that actually rendered - otherwise the
    # contact sheet proves one grip and the game ships another, and nothing in the
    # pipeline can see the difference.
    #
    # Tool.Grip is the Handle's CFrame RELATIVE TO THE HAND PART. Two conversions
    # are involved and both are measured here, not assumed:
    #   * the hand PART frame (Roblox axes X right / Y up / Z back) versus the hand
    #     BONE frame (Blender, +Y down the fingers) - a fixed rest transform,
    #     recovered from the part mesh's own rest bounding box;
    #   * Blender world (X right / Y forward / Z up) versus Roblox (X right / Y up
    #     / Z back) - the matrix A below.
    # The result is asserted CONSTANT across every frame: a grip that drifts is not
    # a grip, and that check is the only thing separating this from a guess.
    A = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))   # blender vec -> roblox vec
    B = A.transposed()                                # roblox vec -> blender vec

    hand_obj = bpy.data.objects.get(attach)
    if hand_obj is not None and hand_obj.type == "MESH":
        bb = [hand_obj.matrix_world @ Vector(c) for c in hand_obj.bound_box]
        C_rest = Vector((sum(p.x for p in bb) / 8, sum(p.y for p in bb) / 8,
                         sum(p.z for p in bb) / 8))
        centre_src = f"{attach} mesh rest bounding box"
    else:
        C_rest = (arm.matrix_world @ arm.data.bones[attach].matrix_local).translation
        centre_src = f"{attach} BONE head (no part mesh found - grip origin is the wrist, not the part centre)"

    H_rest = Matrix.Translation(C_rest) @ B.to_4x4()
    BONE_REST = arm.matrix_world @ arm.data.bones[attach].matrix_local
    HAND_FROM_BONE = BONE_REST.inverted() @ H_rest

    grips = []
    for i in HELD:
        sc.frame_set(START + i)
        bpy.context.view_layer.update()
        H = (arm.matrix_world @ arm.pose.bones[attach].matrix) @ HAND_FROM_BONE
        G = H.inverted() @ prop_obj.matrix_world
        R = G.to_3x3() @ B
        grips.append((G.translation.copy(), R.copy()))

    p0, R0 = grips[0]
    dp = max((g[0] - p0).length for g in grips)
    dr = max(max(abs(g[1][r][c] - R0[r][c]) for r in range(3) for c in range(3))
             for g in grips)
    print(f"=== GRIP derived from {centre_src}")
    print(f"    hand part centre (blender world, rest) "
          f"({C_rest.x:.4f}, {C_rest.y:.4f}, {C_rest.z:.4f})")
    print(f"    Tool.Grip position (studs, hand space) "
          f"({p0.x:+.4f}, {p0.y:+.4f}, {p0.z:+.4f})")
    for r in range(3):
        print(f"    Grip R row{r}  {R0[r][0]:+.4f} {R0[r][1]:+.4f} {R0[r][2]:+.4f}")
    print(f"    constancy across {len(grips)} held frames: pos drift {dp:.6f}, "
          f"rot drift {dr:.6f}")
    if dp > 1e-4 or dr > 1e-4:
        die(f"the derived grip is NOT constant (pos {dp:.5f}, rot {dr:.5f}). A "
            f"Tool.Grip is one fixed CFrame; if it moves relative to the hand "
            f"part then the render and the game cannot agree.")
    # orthonormality - a non-rotation matrix handed to CFrame silently shears the
    # tool, which reads as a bent weapon nobody can trace back to here.
    orth = max(abs((R0 @ R0.transposed())[r][c] - (1.0 if r == c else 0.0))
               for r in range(3) for c in range(3))
    if orth > 1e-4 or R0.determinant() < 0:
        die(f"derived grip rotation is not a proper rotation (orth err {orth:.5f}, "
            f"det {R0.determinant():.5f})")

    grip_out = {
        "prop": PROP.get("name", "Prop"),
        "attach": attach,
        "units": "studs; Roblox hand-part space, X right / Y up / Z back",
        "hand_part_centre_source": centre_src,
        "grip_position": [round(v, 4) for v in p0],
        "grip_rotation_rows": [[round(R0[r][c], 6) for c in range(3)] for r in range(3)],
        "cframe_args": [round(v, 4) for v in p0] +
                       [round(R0[r][c], 6) for r in range(3) for c in range(3)],
        "constancy": {"position_drift": round(dp, 6), "rotation_drift": round(dr, 6)},
    }
    if tip_local:
        sc.frame_set(START)
        bpy.context.view_layer.update()
        H = (arm.matrix_world @ arm.pose.bones[attach].matrix) @ HAND_FROM_BONE
        tip_hand = H.inverted() @ (prop_obj.matrix_world @ Vector(tip_local))
        grip_out["tip_in_hand_space"] = [round(v, 4) for v in tip_hand]
    with open(os.path.join(outdir, "grip.json"), "w") as fh:
        json.dump(grip_out, fh, indent=1)
    print(f"=== grip written to {os.path.join(outdir, 'grip.json')}")
if AIM_REACH or any("target" in k["bones"].get(b, {}) for k in KEYS for b in k["bones"]):
    print(f"=== worst IK target residual {worst_reach:.4f}")
if reach_fail:
    # group by bone and show each one's WORST frame: 48 near-identical lines bury
    # the four distinct problems that actually need fixing in the spec
    by_bone = {}
    for i, bone, tg, got, res in reach_fail:
        if bone not in by_bone or res > by_bone[bone][4]:
            by_bone[bone] = (i, bone, tg, got, res)
    for bone in sorted(by_bone):
        i, _, tg, got, res = by_bone[bone]
        cnt = sum(1 for r in reach_fail if r[1] == bone)
        print(f"    {bone:12s} {cnt:3d} frames, worst frame {i:3d}: "
              f"wanted {tg} but reached {got}, off by {res}")
    die(f"{len(reach_fail)} frame(s) have UNREACHABLE ik targets - the limb stops short "
        f"of where the spec says it goes and the pose you authored is NOT what renders. "
        f"Move those targets toward where the limb actually reached (printed above): a "
        f"limb IK saturates well before its segments run out of length, so a point inside "
        f"the naive reach sphere can still be unreachable once the torso is rotated.")

# ---- 1b. optional numeric pose report at each authored beat ----
# A contact sheet tells you a pose is wrong; it does not tell you WHICH joint.
# Printing the deform parts in the same rig-space frame the spec is written in
# makes that a subtraction instead of a guess - and it catches the case where the
# limb went exactly where you asked and the target itself was the mistake.
if spec.get("report"):
    print("\n=== POSE REPORT (rig space, relative to rest root)")
    for k in KEYS:
        i = int(round(k["t"] * FPS))
        if i >= n:
            i = n - 1
        sc.frame_set(START + i)
        bpy.context.view_layer.update()
        p = {b: head(b) - ORIGIN for b in CHAIN}
        note = k.get("_note", "")[:44]
        print(f"\n  t={k['t']:<5} frame {i:2d}  {note}")
        for b in ("Head", "UpperTorso", "LowerTorso", "RightHand", "LeftHand",
                  "RightFoot", "LeftFoot", "RightLowerLeg", "LeftLowerLeg"):
            if b in p:
                v = p[b]
                print(f"      {b:15s} ({v.x:+.2f}, {v.y:+.2f}, {v.z:+.2f})")

# ---- 1b'. optional per-FRAME track of named deform parts ----
# The beat report samples only the authored beats, so it cannot see what happens
# BETWEEN them - a foot that dips through the floor mid-crouch, a hand that
# overshoots, a seam. `"track": ["RightFoot", "RightHand.tip", ...]` prints the
# rig-space position of each part's head (or `.tip` = the bone's tail, e.g. the
# fingertips) on every frame, then its min/max per axis. One line per frame, so
# "does the foot stay on the floor" is a number, not a render.
TRACK = spec.get("track") or []
if TRACK:
    def _tp(name):
        b, _, end = name.partition(".")
        if b not in arm.pose.bones:
            die(f"track: unknown part {b!r}")
        pb = arm.pose.bones[b]
        return (M @ (pb.tail if end == "tip" else pb.head)) - ORIGIN
    print("\n=== TRACK (rig space: +X right, +Y forward, +Z up)")
    _rows = {nm: [] for nm in TRACK}
    for i in range(n):
        sc.frame_set(START + i)
        bpy.context.view_layer.update()
        cells = []
        for nm in TRACK:
            v = _tp(nm)
            _rows[nm].append(v.copy())
            cells.append(f"{nm} ({v.x:+.2f},{v.y:+.2f},{v.z:+.2f})")
        print(f"  f{i:02d} t={i / FPS:.3f}  " + "  ".join(cells))
    for nm, vs in _rows.items():
        print(f"  {nm:16s} x[{min(v.x for v in vs):+.2f},{max(v.x for v in vs):+.2f}] "
              f"y[{min(v.y for v in vs):+.2f},{max(v.y for v in vs):+.2f}] "
              f"z[{min(v.z for v in vs):+.2f},{max(v.z for v in vs):+.2f}]")

# ---- 1c. DRY: answer a geometry question without paying for a render ----
# Rendering to find out where a tip or a grip landed costs seconds per question
# and produces an image nobody looks at. `"dry": true` runs every assertion, the
# pose report, the tip table and the grip derivation, then stops. Use it for the
# authoring loop and render once, at the end.
if spec.get("dry"):
    print("=== DRY RUN: assertions, report, tip table and grip only - no frames rendered")
    sys.stdout.flush()
    os._exit(0)

# ---- 2. render setup ----
sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.view_settings.view_transform = "Standard"

# PREVIEW: one view, quarter resolution, minimum samples. The authoring loop is
# render-bound - a full pass here was 100+ EEVEE frames - and you cannot iterate
# on a pose you have to wait minutes to see. Preview first, final render once.
PREVIEW = bool(spec.get("preview", False))
if PREVIEW:
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    try:
        sc.eevee.taa_render_samples = 1
    except AttributeError:
        pass
else:
    sc.render.resolution_x, sc.render.resolution_y = spec.get("w", 560), spec.get("h", 700)

# PLAIN: override every material with flat neutral grey. This is how Roblox
# animations are actually previewed and showcased, and it is not cosmetic - a
# busy avatar texture turns a blocky rig into an unreadable jumble of coloured
# panels, and you end up debugging the costume instead of the pose.
if spec.get("plain", False):
    mat = bpy.data.materials.new("PlainPreview")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.80, 0.81, 0.83, 1)
        bsdf.inputs["Roughness"].default_value = 0.55
    for o in bpy.data.objects:
        if o.type == "MESH" and o.visible_get():
            if o.get("prop_keep_material"):
                continue  # the prop is the thing being looked at; do not grey it
            o.data.materials.clear()
            o.data.materials.append(mat)
sc.render.film_transparent = bool(spec.get("transparent", False))
if sc.world is None:
    sc.world = bpy.data.worlds.new("W")
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = tuple(spec.get("bg", (0.10, 0.11, 0.13, 1)))
bg.inputs[1].default_value = 1.7

cam = bpy.data.objects.new("AnimCam", bpy.data.cameras.new("AnimCam"))
bpy.context.collection.objects.link(cam)
sc.camera = cam
kl = bpy.data.lights.new("K", type="SUN"); kl.energy = 4.5
ko = bpy.data.objects.new("K", kl); bpy.context.collection.objects.link(ko)
ko.rotation_euler = Euler((math.radians(60), 0, math.radians(40)), "XYZ")
fl = bpy.data.lights.new("F", type="SUN"); fl.energy = 1.6
fo = bpy.data.objects.new("F", fl); bpy.context.collection.objects.link(fo)
fo.rotation_euler = Euler((math.radians(70), 0, math.radians(-120)), "XYZ")

# FRAME ON THE WHOLE ANIMATION, not on the rest pose.
# Framing off frame 0 and a hand-tuned `fit` multiplier is how limbs end up
# cropped: a kick puts the foot a long way outside the standing silhouette, and
# the multiplier that framed the rest pose knows nothing about it. Gather the
# bounds over EVERY baked frame, then solve the camera distance from the actual
# field of view so the result is correct by construction rather than by tuning.
def frame_points():
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in bpy.data.objects:
        if o.type == "MESH" and o.visible_get():
            oe = o.evaluated_get(dg)
            out += [oe.matrix_world @ Vector(c) for c in oe.bound_box]
    return out


allpts = []
for i in range(n):
    sc.frame_set(START + i)
    bpy.context.view_layer.update()
    allpts += frame_points()
if not allpts:
    die("no visible mesh to frame the camera on")
mn = Vector((min(p.x for p in allpts), min(p.y for p in allpts), min(p.z for p in allpts)))
mx = Vector((max(p.x for p in allpts), max(p.y for p in allpts), max(p.z for p in allpts)))
CTR = (mn + mx) / 2
RADIUS = max((p - CTR).length for p in allpts)

VIEWS = spec.get("views", {"side": [1.0, 0.04, 0.0]})
if PREVIEW:
    VIEWS = {next(iter(VIEWS)): VIEWS[next(iter(VIEWS))]}
MARGIN = spec.get("margin", 1.10)
TOL = spec.get("tolerance", 0.06)

# cam.data.angle is the FOV across the LARGER sensor axis; the tighter axis is
# what actually crops, so fit the bounding sphere to that one.
hfov = cam.data.angle
if sc.render.resolution_x >= sc.render.resolution_y:
    vfov = 2 * math.atan(math.tan(hfov / 2) * sc.render.resolution_y / sc.render.resolution_x)
else:
    vfov, hfov = hfov, 2 * math.atan(math.tan(hfov / 2) * sc.render.resolution_x / sc.render.resolution_y)
DIST = RADIUS / math.sin(min(hfov, vfov) / 2) * MARGIN
print(f"=== animated bounds centre {tuple(round(v, 2) for v in CTR)} radius {RADIUS:.2f}, "
      f"camera distance {DIST:.2f} (margin {MARGIN})")

# ---- 3. render, asserting rig integrity per frame ----
worst = 0.0
for i in range(n):
    f = START + i
    sc.frame_set(f)
    bpy.context.view_layer.update()
    now = joint_lengths()
    # exclude the body-root pair: the torso control is DESIGNED to move it
    limb = [b for b in REST if CHAIN[b] != ROOTPART]
    drift = max(abs(now[b] - REST[b]) for b in limb)
    worst = max(worst, drift)
    # IK chains stretch a few percent by design; real breakage was an order more
    if drift > TOL:
        bad = max(limb, key=lambda b: abs(now[b] - REST[b]))
        die(f"RIG BROKEN at frame {i}: {bad} drifted {drift:.3f} (limit {TOL})")
    for vn, vd in VIEWS.items():
        d = Vector(vd).normalized()
        cam.location = CTR + d * DIST
        cam.rotation_euler = (CTR - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{outdir}/{vn}_{i:03d}.png"
        bpy.ops.render.render(write_still=True)

missing = [f"{vn}_{i:03d}.png" for vn in VIEWS for i in range(n)
           if not os.path.exists(f"{outdir}/{vn}_{i:03d}.png")]
if missing:
    die(f"{len(missing)} frames were not written, first {missing[0]}")

print(f"=== done: {n} frames x {len(VIEWS)} views, worst joint drift {worst:.4f} "
      f"(limit {TOL}) - RIG INTACT")
