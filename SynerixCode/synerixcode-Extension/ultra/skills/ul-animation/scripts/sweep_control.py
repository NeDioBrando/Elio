"""Learn a control bone's AXIS CONVENTION and its USABLE RANGE.

  blender --background <rig>.blend --enable-autoexec --python sweep_control.py \
      -- IK_LEG.R:loc TORSO:rot ...

`calibrate_rig.py` tells you WHICH controls work. This tells you WHAT THEY DO:
for each axis it sweeps a range of values and reports where the driven deform
parts end up (in rig space, relative to the body root) plus whether the joints
stayed rigid at that magnitude.

Why this exists: axis conventions are per-bone and per-rig, and guessing them
costs whole authoring passes (a punch's twist authored on the lean axis hunched
the figure sideways for four passes). Just as important, IK controls have a
RANGE - push an IK target past the chain's reach and the limb stretches, which
the integrity assertion then rejects at render time. Reading the last magnitude
still marked `ok` tells you the budget BEFORE you author to it.

Output columns:
  value   the value written to that axis (degrees for rot, units for loc)
  <part>  that deform part's head position relative to the body root part, then
          how far the bone has TURNED from rest in degrees (`0d` = pure
          translation, a non-zero turn with an unchanged position = pure rotation
          about that joint, which is what foot and hand orientation controls do)
  drift   worst joint-length change vs rest; `TEAR` once it exceeds tolerance
"""
import bpy, math, sys
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
if not argv:
    raise SystemExit("usage: -- BONE:mode [BONE:mode ...]   (mode = rot | loc)")

R15_CHAIN = {"LowerTorso": "HumanoidRootPart", "UpperTorso": "LowerTorso", "Head": "UpperTorso",
             "LeftUpperArm": "UpperTorso", "LeftLowerArm": "LeftUpperArm", "LeftHand": "LeftLowerArm",
             "RightUpperArm": "UpperTorso", "RightLowerArm": "RightUpperArm", "RightHand": "RightLowerArm",
             "LeftUpperLeg": "LowerTorso", "LeftLowerLeg": "LeftUpperLeg", "LeftFoot": "LeftLowerLeg",
             "RightUpperLeg": "LowerTorso", "RightLowerLeg": "RightUpperLeg", "RightFoot": "RightLowerLeg"}
R6_CHAIN = {}

arm = None
for o in bpy.data.objects:
    if o.type == "ARMATURE" and len({b.name for b in o.data.bones} & set(R15_CHAIN)) >= 10:
        arm = o
        break
if arm is None:
    raise SystemExit("no R15 armature found")
CHAIN = {c: p for c, p in R15_CHAIN.items() if c in arm.pose.bones and p in arm.pose.bones}
ROOTPART = "HumanoidRootPart" if "HumanoidRootPart" in arm.pose.bones else "LowerTorso"
M = arm.matrix_world
TOL = 0.06          # same tolerance anim_render.py asserts with


def head(b):
    return M @ arm.pose.bones[b].head


def lengths():
    return {c: (head(c) - head(p)).length for c, p in CHAIN.items()}


def rel(b):
    return head(b) - head(ROOTPART)


def direction(b):
    """Unit vector along the bone. MUST be measured alongside head position:
    a control that only ROTATES an end bone (a foot about its ankle, a hand
    about its wrist) moves no head at all, so a position-only probe declares it
    INERT and the axis never gets learned."""
    pb = arm.pose.bones[b]
    v = (M @ pb.tail) - (M @ pb.head)
    return v.normalized() if v.length > 1e-9 else Vector((0, 0, 1))


def angle_between(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, a.dot(b)))))


BASE = {n: (arm.pose.bones[n].rotation_euler.copy(), arm.pose.bones[n].location.copy())
        for n in [pb.name for pb in arm.pose.bones]}


def restore():
    for n, (r, l) in BASE.items():
        pb = arm.pose.bones[n]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = r
        pb.location = l
    bpy.context.view_layer.update()


restore()
REST = lengths()
REST_POS = {b: rel(b).copy() for b in CHAIN}
REST_DIR = {b: direction(b).copy() for b in CHAIN}
print("=" * 78)
print(f"REST positions (relative to {ROOTPART}):")
for b in sorted(REST_POS):
    p = REST_POS[b]
    print(f"  {b:16s} ({p.x:+.2f}, {p.y:+.2f}, {p.z:+.2f})   len-to-parent {REST[b]:.3f}")

ROT_VALUES = [-90, -60, -35, -15, 15, 35, 60, 90]
LOC_VALUES = [-1.5, -1.0, -0.5, -0.25, 0.25, 0.5, 1.0, 1.5]

for spec in argv:
    bone, _, mode = spec.partition(":")
    mode = mode or "rot"
    if bone not in arm.pose.bones:
        print(f"\n!! unknown bone {bone!r} - skipped")
        continue
    # which parts does this control actually drive? (measured, not assumed)
    restore()
    pb = arm.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    if mode == "rot":
        pb.rotation_euler = Euler((0, 0, math.radians(35)), "XYZ")
    else:
        pb.location = Vector((0, 0, 0.5))
    bpy.context.view_layer.update()
    driven = [b for b in CHAIN
              if (rel(b) - REST_POS[b]).length > 0.02
              or angle_between(direction(b), REST_DIR[b]) > 2.0]
    if not driven:
        print(f"\n{'=' * 78}\n{bone}:{mode}  -- INERT, drives nothing. Do not author to it.")
        continue
    driven = driven[:3]

    print(f"\n{'=' * 78}\n{bone}:{mode}   drives: {', '.join(driven)}")
    vals = ROT_VALUES if mode == "rot" else LOC_VALUES
    for ax, axname in enumerate("XYZ"):
        print(f"\n  --- {axname} axis ---")
        hdr = "   value  " + "  ".join(f"{b[:14]:>28s}" for b in driven) + "   drift"
        print(hdr)
        for v in vals:
            restore()
            pb = arm.pose.bones[bone]
            pb.rotation_mode = "XYZ"
            if mode == "rot":
                e = [0.0, 0.0, 0.0]
                e[ax] = math.radians(v)
                pb.rotation_euler = Euler(e, "XYZ")
            else:
                l = [0.0, 0.0, 0.0]
                l[ax] = v
                pb.location = Vector(l)
            bpy.context.view_layer.update()
            now = lengths()
            limb = [b for b in REST if b != "LowerTorso"]
            drift = max(abs(now[b] - REST[b]) for b in limb)
            cells = []
            for b in driven:
                p = rel(b)
                turn = angle_between(direction(b), REST_DIR[b])
                cells.append(f"({p.x:+.2f},{p.y:+.2f},{p.z:+.2f}) {turn:3.0f}d".rjust(28))
            flag = "TEAR" if drift > TOL else "ok"
            print(f"   {v:+7.2f}  " + "  ".join(cells) + f"   {drift:.3f} {flag}")

restore()
print("\n" + "=" * 78)
print("Read off: which axis moves the part the way you want, at what magnitude,")
print("and the LAST value still marked `ok` - that is your authoring budget.")
