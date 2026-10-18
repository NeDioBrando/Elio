"""Print the rest-pose frame of one bone, so a prop offset can be COMPUTED.

  blender --background <rig>.blend --enable-autoexec --python probe_bone.py -- RightHand

WHY. A prop offset that is guessed lands the weapon somewhere near the hand and
looks, in a contact sheet, exactly like a weapon that is somewhere near the hand.
The first attempt at this put a sword about two studs behind the fist and
the sheet was the only reason anybody knew.

The offset is not guessable because two different frames are in play:

  - Roblox positions a tool against the RightHand PART, whose axes are the
    character's (X right, Y up, Z back).
  - Blender parents to the RightHand BONE, whose +Y runs along the bone toward
    the fingertips and whose origin is the wrist.

They differ by a fixed rest transform, which this prints. Measure it once, put
the number in the spec, and the same contract grip then means the same thing in
both engines.
"""
import bpy
import sys
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
want = argv[0] if argv else "RightHand"

R15 = {"HumanoidRootPart", "LowerTorso", "UpperTorso", "Head",
       "LeftUpperArm", "LeftLowerArm", "LeftHand",
       "RightUpperArm", "RightLowerArm", "RightHand"}

arm = None
for o in bpy.data.objects:
    if o.type == "ARMATURE" and len({b.name for b in o.data.bones} & R15) >= 8:
        arm = o
        break
if arm is None:
    print("!!! FAILED: no R15 armature found")
    raise SystemExit(1)

bpy.context.view_layer.update()
M = arm.matrix_world

print(f"\n=== armature {arm.name!r} matrix_world translation {tuple(round(v,4) for v in M.translation)}")

pb = arm.pose.bones.get(want)
if pb is None:
    print(f"!!! FAILED: no bone {want!r}. Bones containing 'Hand': "
          f"{[b.name for b in arm.pose.bones if 'Hand' in b.name]}")
    raise SystemExit(1)

world = M @ pb.matrix
head = M @ pb.head
tail = M @ pb.tail
print(f"\n=== bone {want!r}")
print(f"  head (world)   {tuple(round(v,4) for v in head)}")
print(f"  tail (world)   {tuple(round(v,4) for v in tail)}")
print(f"  length         {round((tail-head).length,4)}")
print(f"  matrix axes (world):")
print(f"    X {tuple(round(v,4) for v in world.col[0][:3])}")
print(f"    Y {tuple(round(v,4) for v in world.col[1][:3])}   <- along the bone")
print(f"    Z {tuple(round(v,4) for v in world.col[2][:3])}")
print(f"  origin         {tuple(round(v,4) for v in world.translation)}")

# The character's own frame, so the offset can be expressed the way the game
# thinks: +X right, +Y forward, +Z up in Blender terms.
root = arm.pose.bones.get("HumanoidRootPart")
if root:
    rw = M @ root.matrix
    print(f"\n=== HumanoidRootPart origin {tuple(round(v,4) for v in rw.translation)}")
    rel = rw.inverted() @ world
    print(f"  {want} relative to root:")
    print(f"    translation {tuple(round(v,4) for v in rel.translation)}")
    e = rel.to_euler("XYZ")
    print(f"    rotation deg {tuple(round(math.degrees(v),2) for v in e)}")

# What a prop at offset (0,0,0) would inherit, spelled out, because that is the
# thing the spec's numbers are relative to.
print(f"\n=== a prop with grip pos [0,0,0] rot [0,0,0] lands at "
      f"{tuple(round(v,4) for v in world.translation)} "
      f"with its local +Y along {tuple(round(v,4) for v in world.col[1][:3])}")
print("=== PROBE_OK")
