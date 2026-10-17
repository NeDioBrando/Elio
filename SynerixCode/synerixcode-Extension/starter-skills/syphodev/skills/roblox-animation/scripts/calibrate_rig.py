"""Onboard ANY Roblox Blender rig: find which controls actually work.

  blender --background <rig>.blend --enable-autoexec --python calibrate_rig.py

Run this FIRST on a rig you have never animated. It answers the three questions
that otherwise cost hours:

  1. Which armature holds the R6/R15 deform bones, and is there a second
     control armature driving it?
  2. Which control bones actually MOVE anything - many named FK_* / Torso_FK
     are inert because the rig is in IK mode or they are vestigial.
  3. Which of those keep the joints rigid, and which tear the character apart.

It also reports the Action trap (see references/traps.md) and the IK/FK switch
state, both of which silently invalidate everything downstream.
"""
import bpy, math
from mathutils import Euler, Vector

R6 = ["Torso", "Right Arm", "Left Arm", "Right Leg", "Left Leg", "Head"]
R15 = ["HumanoidRootPart", "LowerTorso", "UpperTorso", "Head",
       "LeftUpperArm", "LeftLowerArm", "LeftHand",
       "RightUpperArm", "RightLowerArm", "RightHand",
       "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
       "RightUpperLeg", "RightLowerLeg", "RightFoot"]
R15_CHAIN = {"LowerTorso": "HumanoidRootPart", "UpperTorso": "LowerTorso", "Head": "UpperTorso",
             "LeftUpperArm": "UpperTorso", "LeftLowerArm": "LeftUpperArm", "LeftHand": "LeftLowerArm",
             "RightUpperArm": "UpperTorso", "RightLowerArm": "RightUpperArm", "RightHand": "RightLowerArm",
             "LeftUpperLeg": "LowerTorso", "LeftLowerLeg": "LeftUpperLeg", "LeftFoot": "LeftLowerLeg",
             "RightUpperLeg": "LowerTorso", "RightLowerLeg": "RightUpperLeg", "RightFoot": "RightLowerLeg"}

print("=" * 72)
print("ARMATURES")
for o in bpy.data.objects:
    if o.type == "ARMATURE":
        names = {b.name for b in o.data.bones}
        kind = "R15" if len(names & set(R15)) >= 12 else ("R6" if len(names & set(R6)) >= 5 else "-")
        print(f"  {o.name!r}: {len(o.data.bones)} bones  deform-set={kind}")

# pick the armature carrying the deform bones
target, parts, chain = None, None, None
for o in bpy.data.objects:
    if o.type != "ARMATURE":
        continue
    names = {b.name for b in o.data.bones}
    if len(names & set(R15)) >= 12:
        target, parts, chain = o, [b for b in R15 if b in names], R15_CHAIN
        break
    if len(names & set(R6)) >= 5 and target is None:
        target, parts, chain = o, [b for b in R6 if b in names], None
if target is None:
    raise SystemExit("no armature carrying R6 or R15 deform bones")

# the CONTROL armature may be a different object (R6 rigs often split them)
ctrl = target
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o is not target and len(o.data.bones) > len(target.data.bones):
        ctrl = o
print(f"\ndeform armature : {target.name!r} ({len(parts)} parts)")
print(f"control armature: {ctrl.name!r} ({len(ctrl.data.bones)} bones)")

print("\n" + "=" * 72)
print("THE ACTION TRAP")
ad = ctrl.animation_data
if ad and ad.action:
    print(f"  !! {ctrl.name!r} has action {ad.action.name!r} with {len(ad.action.fcurves)} fcurves")
    print("     Blender RE-EVALUATES this during render and will overwrite any pose")
    print("     set from script. DO NOT pose-and-render: insert KEYFRAMES instead.")
    print("     Do NOT simply clear it either - it usually holds the rest pose.")
else:
    print("  no action on the control armature (safe to pose directly)")

print("\nIK/FK switches and custom props:")
found = False
for pb in ctrl.pose.bones:
    for k in pb.keys():
        # skip per-bone housekeeping; only switches change what the rig does
        if k in ("_RNA_UI", "mmd_bone", "wiggle_enable", "constraint_active_index"):
            continue
        if not any(tag in k.upper() for tag in ("IK", "FK", "PARENT", "FOLLOW", "SWITCH")):
            continue
        print(f"   {pb.name}.{k} = {pb[k]}")
        found = True
if not found:
    print("   (none - rig is probably pure FK)")

M = ctrl.matrix_world
MT = target.matrix_world


def snap():
    st = {}
    for b in parts:
        pb = target.pose.bones[b]
        h = MT @ pb.head
        st[b] = (h.copy(), ((MT @ pb.tail) - h).normalized())
    return st


def rigid(st):
    """joint lengths that must stay constant"""
    if chain:
        return {c: (st[c][0] - st[p][0]).length for c, p in chain.items() if c in st and p in st}
    o = st[parts[0]][0]
    return {b: (st[b][0] - o).length for b in parts[1:]}


# Capture the rig's OWN rest values and restore to THOSE between probes.
# Do NOT blanket-zero every pose bone: on a Rigify-style rig the MCH_/ORG_
# mechanism bones carry non-zero defaults the IK solve depends on, so zeroing
# them collapses the limbs and every subsequent probe reports a false TEARS.
# (This script used to zero everything and mis-reported ROOT:loc, TORSO:loc and
# IK_SuperLeg as tearing when all three are in fact rigid.)
BASELINE = {pb.name: (pb.rotation_mode, pb.rotation_euler.copy(),
                      pb.rotation_quaternion.copy(), pb.location.copy())
            for pb in ctrl.pose.bones}


def reset():
    for pb in ctrl.pose.bones:
        mode, eul, quat, loc = BASELINE[pb.name]
        pb.rotation_mode = mode
        pb.rotation_euler = eul
        pb.rotation_quaternion = quat
        pb.location = loc
    bpy.context.view_layer.update()


reset()
REST = snap()
RIGID = rigid(REST)

print("\n" + "=" * 72)
print("WHICH CONTROLS ACTUALLY DO ANYTHING")
print("(35 deg rotation / 0.5 location; 'TEARS' = a joint length changed >5%)")
print(f"\n{'bone':28s}{'mode':5s} | parts moved | rigid?")
skip = ("MCH_", "ORG_", "VIS_", "DEF_")
rows = []
for pb in list(ctrl.pose.bones):
    if pb.name.startswith(skip):
        continue
    for mode in ("rot", "loc"):
        reset()
        b = ctrl.pose.bones[pb.name]
        if mode == "rot":
            b.rotation_mode = "XYZ"
            b.rotation_euler = Euler((0, 0, math.radians(35)), "XYZ")
        else:
            b.location = Vector((0, 0, 0.5))
        bpy.context.view_layer.update()
        st = snap()
        moved = [p for p in parts
                 if (st[p][1] - REST[p][1]).length > 0.02 or (st[p][0] - REST[p][0]).length > 0.02]
        if not moved:
            continue
        now = rigid(st)
        worst = max(abs(now[k] - RIGID[k]) for k in RIGID) if RIGID else 0.0
        tag = "ok" if worst < 0.05 * max(RIGID.values()) else f"TEARS ({worst:.3f})"
        rows.append((pb.name, mode, moved, tag))
        print(f"{pb.name:28s}{mode:5s} | {len(moved):2d} {', '.join(moved[:4])}{'...' if len(moved) > 4 else ''} | {tag}")

print("\n" + "=" * 72)
print("USABLE CONTROLS (move something, keep joints rigid):")
for name, mode, moved, tag in rows:
    if tag == "ok":
        print(f"   {name:28s} {mode}  -> {', '.join(moved[:5])}")
print("\nNEXT: sweep each usable control per axis to learn its convention")
print("(which axis is forward/twist/lean), then author a spec for anim_render.py.")
