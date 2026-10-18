"""Author and render quadruped gaits on a rig built by quadruped_rig.py.

    blender --background <name>_rigged.blend --python tools/quadruped_anim.py \
        -- <name> <gait> <outdir>

GAITS ARE GENERATED FROM A FOOTFALL PATTERN, NOT HAND-TYPED. A quadruped walk is
a four-beat LATERAL sequence - back-left, front-left, back-right, front-right -
and a trot is a two-beat DIAGONAL pair. Those are facts about how animals move,
so they are written down once as phase offsets and every clip is sampled from
them. Hand-typing twenty poses per creature per gait would be slower, wrong in a
different way each time, and impossible to retune.

The output is TWO things from ONE evaluation, which is what stops the preview
disagreeing with what ships:
  * a contact sheet, so a human can see the gait
  * angles.json - per frame, per bone, the Euler angles in degrees - which the
    Luau side turns into a KeyframeSequence with the same bone names.
"""
import bpy
import sys
import os
import json
import math
from mathutils import Euler

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, GAIT, OUTDIR = argv[0], argv[1], argv[2]
os.makedirs(OUTDIR, exist_ok=True)

arm = bpy.data.objects.get(NAME + "_Arm")
mesh = bpy.data.objects.get(NAME)
if arm is None or mesh is None:
    print("!!! FAILED: expected %s_Arm and %s in the blend" % (NAME, NAME))
    sys.exit(1)

# Footfall phase per leg, as a fraction of the cycle.
#   walk  - four beats, lateral sequence. Only ever one foot off the ground.
#   trot  - two beats, diagonal pairs. This is the honest "run" for a sheep.
#   idle  - no footfall at all; the body breathes and the head drifts.
GAITS = {
    "idle": {"phases": {}, "swing": 0.0, "knee": 0.0, "foot": 0.0,
             "bob": 0.006, "pitch": 0.6, "cycles": 1.0, "frames": 48,
             "head": 3.0, "note": "standing: breath and a slow head drift, feet planted"},
    "walk": {"phases": {"BL": 0.00, "FL": 0.25, "BR": 0.50, "FR": 0.75},
             "swing": 20.0, "knee": 26.0, "foot": 12.0,
             "bob": 0.020, "pitch": 1.4, "cycles": 1.0, "frames": 32,
             "head": 2.0, "note": "four-beat lateral sequence"},
    "run": {"phases": {"FL": 0.00, "BR": 0.00, "FR": 0.50, "BL": 0.50},
            "swing": 34.0, "knee": 44.0, "foot": 18.0,
            "bob": 0.045, "pitch": 3.0, "cycles": 1.0, "frames": 20,
            "head": 4.0, "note": "two-beat diagonal trot"},
    "lunge": {"phases": {"FL": 0.05, "FR": 0.05, "BL": 0.55, "BR": 0.55},
              "swing": 46.0, "knee": 54.0, "foot": 22.0,
              "bob": 0.075, "pitch": 8.0, "cycles": 1.0, "frames": 18,
              "head": 10.0, "note": "bound: both fronts reach together, then both backs drive"},
}
if GAIT not in GAITS:
    print("!!! FAILED: unknown gait %r; have %s" % (GAIT, sorted(GAITS)))
    sys.exit(1)
G = GAITS[GAIT]
FRAMES = G["frames"]

for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"

# Height of the rig, used to scale the body bob into studs.
H = max(b.tail_local.z for b in arm.data.bones) - min(b.head_local.z for b in arm.data.bones)


def leg_angles(phase, g):
    """Upper swing, knee bend and foot angle at a point in the cycle.

    The leg swings fore and aft as a sine. The KNEE only bends on the swing
    half - a leg bending while it is carrying weight is the single most obvious
    tell of a fake walk cycle, because a real one is straight under load.
    """
    swing = math.sin(phase * math.tau) * g["swing"]
    lift = max(0.0, math.sin(phase * math.tau + math.pi / 2))
    knee = -lift * g["knee"]
    foot = math.sin(phase * math.tau + math.pi / 3) * g["foot"]
    return swing, knee, foot


angles = []
for f in range(FRAMES):
    t = (f / FRAMES) * G["cycles"]
    pose = {}
    for leg, off in G["phases"].items():
        s, k, ft = leg_angles((t + off) % 1.0, G)
        pose["Leg%s_Upper" % leg] = [round(s, 3), 0.0, 0.0]
        pose["Leg%s_Lower" % leg] = [round(k, 3), 0.0, 0.0]
        pose["Leg%s_Foot" % leg] = [round(ft, 3), 0.0, 0.0]
    # Body: bob at twice the leg frequency (two footfalls per cycle lift the
    # body twice), plus a small counter-pitch so it is not a rigid plank.
    bob = math.sin(t * math.tau * 2.0) * G["bob"] * H
    pitch = math.sin(t * math.tau * 2.0 + math.pi / 4) * G["pitch"]
    pose["Root"] = {"loc": [0.0, 0.0, round(bob, 4)]}
    pose["Spine"] = [round(pitch, 3), 0.0, 0.0]
    pose["Chest"] = [round(-pitch * 0.6, 3), 0.0, 0.0]
    pose["Neck"] = [round(-pitch * 0.4, 3), 0.0, 0.0]
    pose["Head"] = [round(math.sin(t * math.tau) * G["head"], 3), 0.0, 0.0]
    pose["Tail"] = [round(math.sin(t * math.tau + math.pi) * G["head"] * 1.5, 3), 0.0, 0.0]
    angles.append(pose)

# ------------------------------------------------------------------ apply ---
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
scene = bpy.context.scene
scene.frame_start = 0
scene.frame_end = FRAMES - 1
scene.render.fps = 30

for f, pose in enumerate(angles):
    scene.frame_set(f)
    for name, val in pose.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        if isinstance(val, dict):
            pb.location = val.get("loc", [0, 0, 0])
            pb.keyframe_insert("location", frame=f)
        else:
            pb.rotation_euler = Euler([math.radians(v) for v in val], "XYZ")
            pb.keyframe_insert("rotation_euler", frame=f)
bpy.ops.object.mode_set(mode="OBJECT")

# ----------------------------------------------------------------- render ---
# A side view reads a gait; a three-quarter view shows whether the far legs
# collapse into the near ones. Both, small, because these are read as a strip.
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 55
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 3.5
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = Euler((math.radians(55), 0, math.radians(35)), "XYZ")
bpy.context.collection.objects.link(sun)

# Blender 4.2 renamed EEVEE; try the new name and fall back rather than assuming.
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x = 360
scene.render.resolution_y = 300
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("W")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.44, 0.47, 1)

bb = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
cx = sum(v.x for v in bb) / len(bb)
cy = sum(v.y for v in bb) / len(bb)
cz = sum(v.z for v in bb) / len(bb)
radius = max((v - __import__("mathutils").Vector((cx, cy, cz))).length for v in bb)
# At 85mm and 4.2r the animal was cropped: half the frame covers 0.89r against
# the r it needs. 55mm at 5.0r gives about 1.5r, which leaves the feet in shot.
dist = radius * 5.0

VIEWS = {"side": (1.0, 0.0, 0.22), "tq": (0.75, 0.55, 0.30)}
for vname, d in VIEWS.items():
    import mathutils
    dirv = mathutils.Vector(d).normalized()
    cam.location = mathutils.Vector((cx, cy, cz)) + dirv * dist
    look = mathutils.Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    for f in range(FRAMES):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(OUTDIR, "%s_%03d.png" % (vname, f))
        bpy.ops.render.render(write_still=True)

with open(os.path.join(OUTDIR, "angles.json"), "w", encoding="utf-8") as fh:
    json.dump({
        "creature": NAME,
        "gait": GAIT,
        "note": G["note"],
        "fps": 30,
        "frames": FRAMES,
        "duration": round(FRAMES / 30.0, 4),
        "loop": GAIT != "lunge",
        "bones": [b.name for b in arm.data.bones],
        "angles_deg": angles,
    }, fh, indent=1)

print("=== %s %s: %d frames, %d bones, %s" % (NAME, GAIT, FRAMES, len(arm.data.bones), G["note"]))
print("=== wrote " + os.path.join(OUTDIR, "angles.json"))
