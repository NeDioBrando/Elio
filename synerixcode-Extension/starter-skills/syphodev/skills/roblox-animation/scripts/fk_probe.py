"""FK probe + offline joint-angle solver for the community R15 rig.

    blender --background <rig>.blend --enable-autoexec --python fk_probe.py -- in.json out.json

WHY THIS EXISTS, and why it is not IK.

A KeyframeSequence is per-joint rotations, so the shipped spec must contain plain
FK angles - `anim_render.py` must never see a `target` or an `aim`. But some
angles are not guessable: "the support hand holds the rifle so the butt sits in
the shoulder pocket and the muzzle points down-range" is a statement about a
world FRAME, and hand-tuning nine angles against a render to satisfy it is the
expensive loop this skill exists to avoid.

So the solve happens HERE, ONCE, OFFLINE, and its output is frozen into the spec
as constants. The distinction that matters:

  * IK in the clip = a solver runs per frame, picks whichever branch it likes,
    leaves limb ROLL free, and pops between frames. That is banned.
  * a solver run once per BEAT, seeded from the previous beat, whose numbers are
    then written into the spec as plain `rot` values = FK. Interpolation between
    beats is in joint space, roll is fully determined (the frame objective pins
    it), and nothing is solved at render time.

It also derives a prop grip offset in BONE space from a desired WORLD placement,
which is "never type a grip" applied one level up: the placement is stated as a
fact about the scene ("butt at the right shoulder, barrel forward, sights up")
and the bone-space numbers are computed from the posed rig.
"""
import bpy, json, math, sys, os
from mathutils import Euler, Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
inp = json.load(open(argv[0]))
outpath = argv[1]

R15 = {"HumanoidRootPart", "LowerTorso", "UpperTorso", "Head",
       "LeftUpperArm", "LeftLowerArm", "LeftHand",
       "RightUpperArm", "RightLowerArm", "RightHand",
       "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
       "RightUpperLeg", "RightLowerLeg", "RightFoot"}


def die(msg):
    print(f"\n!!! FAILED: {msg}", flush=True)
    sys.stdout.flush()
    os._exit(1)


arm = None
for o in bpy.data.objects:
    if o.type == "ARMATURE" and len({b.name for b in o.data.bones} & R15) >= 10:
        arm = o
        break
if arm is None:
    die("no R15 armature")
M = arm.matrix_world
sc = bpy.context.scene
sc.frame_set(0)
bpy.context.view_layer.update()
ORIGIN = (M @ arm.pose.bones["HumanoidRootPart"].head).copy()
print(f"=== rig-space origin {tuple(round(v,3) for v in ORIGIN)}")

PROPS = inp.get("properties", {})
prop_bone = None
if PROPS:
    for pb in arm.pose.bones:
        if all(k in pb.keys() for k in PROPS):
            prop_bone = pb
            break
    if prop_bone is None:
        die(f"no pose bone carries all of {list(PROPS)}")

REST_ROT = {b.name: b.rotation_euler.copy() for b in arm.pose.bones}
REST_LOC = {b.name: b.location.copy() for b in arm.pose.bones}


def reset():
    for pb in arm.pose.bones:
        if pb.rotation_mode == "QUATERNION":
            pb.rotation_mode = "XYZ"
        pb.rotation_euler = REST_ROT[pb.name]
        pb.location = REST_LOC[pb.name]
    for k, v in PROPS.items():
        prop_bone[k] = v
    bpy.context.view_layer.update()


def apply(pose):
    for bone, spec in pose.items():
        if bone not in arm.pose.bones:
            die(f"unknown bone {bone!r}")
        pb = arm.pose.bones[bone]
        if "rot" in spec:
            if pb.rotation_mode == "QUATERNION":
                pb.rotation_mode = "XYZ"
            pb.rotation_euler = Euler([math.radians(v) for v in spec["rot"]], "XYZ")
        if "loc" in spec:
            pb.location = Vector(spec["loc"])
    bpy.context.view_layer.update()


def head(b):
    return M @ arm.pose.bones[b].head


def bone_frame(b):
    return M @ arm.pose.bones[b].matrix


def basis(x_dir, z_dir):
    xd = Vector(x_dir).normalized()
    zd = Vector(z_dir)
    zd = (zd - xd * zd.dot(xd)).normalized()
    yd = zd.cross(xd)
    return Matrix(((xd.x, yd.x, zd.x), (xd.y, yd.y, zd.y), (xd.z, yd.z, zd.z)))


def want_frame(spec):
    return Matrix.Translation(ORIGIN + Vector(spec["pos"])) @ basis(
        spec["x_dir"], spec["z_dir"]).to_4x4()


def set_params(params, vals):
    for (bone, axis), v in zip(params, vals):
        pb = arm.pose.bones[bone]
        if pb.rotation_mode == "QUATERNION":
            pb.rotation_mode = "XYZ"
        e = list(pb.rotation_euler)
        e[int(axis)] = math.radians(v)
        pb.rotation_euler = Euler(e, "XYZ")
    bpy.context.view_layer.update()


def gauss_solve(A, b):
    """Plain Gaussian elimination with partial pivoting. mathutils.Matrix only
    inverts 2x2/3x3/4x4 and a nine-angle solve needs 9x9."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[p][c]) < 1e-12:
            return None
        m[c], m[p] = m[p], m[c]
        pv = m[c][c]
        for r in range(n):
            if r == c:
                continue
            f = m[r][c] / pv
            if f:
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def rotvec(Ra, Rb):
    """Rotation vector taking Ra to Rb, in world axes (radians * axis)."""
    q = (Rb.to_3x3() @ Ra.to_3x3().transposed()).to_quaternion()
    ang = q.angle
    if ang > math.pi:
        ang -= 2 * math.pi
    ax = q.axis
    return ax * ang


def dls(params, seed, err_fn, iters=90, h=0.5, damp0=1.0, reg=2e-3, cap=20.0):
    """Damped least squares over joint ANGLES in degrees.

    `err_fn()` returns a list of residuals (position in studs, and for a frame
    objective the orientation residual pre-weighted into the same units). The
    seed is the previous beat's answer, which is what keeps consecutive beats on
    the same branch - the thing a per-frame IK solver does not give you."""
    x = list(seed)
    n = len(x)

    def E(v):
        set_params(params, v)
        return err_fn()

    def norm(e):
        return math.sqrt(sum(c * c for c in e))

    best = list(x)
    best_e = norm(E(x))
    lam = damp0
    for _ in range(iters):
        base = E(x)
        if norm(base) < 1e-4:
            break
        cols = []
        for i in range(n):
            p = list(x)
            p[i] += h
            ei = E(p)
            cols.append([(ei[k] - base[k]) / h for k in range(len(base))])
        A = [[sum(cols[i][k] * cols[j][k] for k in range(len(base)))
              + (lam + reg if i == j else 0.0) for j in range(n)] for i in range(n)]
        rhs = [-sum(cols[i][k] * base[k] for k in range(len(base))) for i in range(n)]
        step = gauss_solve(A, rhs)
        if step is None:
            lam *= 10
            if lam > 1e7:
                break
            continue
        L = math.sqrt(sum(s * s for s in step))
        if L > cap:
            step = [s * cap / L for s in step]
        trial = [x[i] + step[i] for i in range(n)]
        te = norm(E(trial))
        if te < best_e:
            best, best_e, x = list(trial), te, trial
            lam = max(lam * 0.5, 1e-4)
        else:
            lam *= 4
            if lam > 1e7:
                break
    set_params(params, best)
    return best, best_e


GRIPS = {}
out = {"grips": {}, "beats": {}}

for q in inp["queries"]:
    reset()
    apply(q.get("pose", {}))
    rec = {"solved": {}, "residual": {}, "positions": {}, "landmarks": {}}

    def record(params, vals):
        for (bone, axis), v in zip(params, vals):
            rec["solved"].setdefault(bone, {})[str(int(axis))] = round(v, 3)

    for op in q.get("ops", []):
        kind = op["op"]
        if kind == "grip":
            Bm = bone_frame(op["attach"])
            off = Bm.inverted() @ want_frame(op)
            e = off.to_euler("XYZ")
            GRIPS[op["name"]] = {
                "attach": op["attach"],
                "pos": [round(v, 5) for v in off.translation],
                "rot": [round(math.degrees(v), 4) for v in e],
            }
            out["grips"][op["name"]] = GRIPS[op["name"]]
            print(f"=== grip {op['name']!r} on {op['attach']}: "
                  f"pos {GRIPS[op['name']]['pos']} rot {GRIPS[op['name']]['rot']}")
        elif kind == "frame_solve":
            g = GRIPS[op["grip"]]
            G = (Matrix.Translation(Vector(g["pos"]))
                 @ Euler([math.radians(v) for v in g["rot"]], "XYZ").to_matrix().to_4x4())
            T = want_frame(op)
            w = op.get("rot_weight", 0.55)
            params = [(b, a) for b, a in op["params"]]

            def err_fn(G=G, T=T, w=w, att=g["attach"]):
                P = bone_frame(att) @ G
                d = T.translation - P.translation
                rv = rotvec(P, T)
                return [d.x, d.y, d.z, rv.x * w, rv.y * w, rv.z * w]

            vals, res = dls(params, op["seed"], err_fn)
            record(params, vals)
            rec["residual"][op.get("name", op["grip"])] = round(res, 4)
        elif kind == "point_solve":
            tgt = op.get("target")
            if tgt is None:
                g = GRIPS[op["target_local"]["grip"]]
                G = (Matrix.Translation(Vector(g["pos"]))
                     @ Euler([math.radians(v) for v in g["rot"]], "XYZ").to_matrix().to_4x4())
                P = bone_frame(g["attach"]) @ G
                tgt = list((P @ Vector(op["target_local"]["local"])) - ORIGIN)
            params = [(b, a) for b, a in op["params"]]
            eff = op["effector"]

            def err_fn(tgt=tgt, eff=eff):
                d = Vector(tgt) - (head(eff) - ORIGIN)
                return [d.x, d.y, d.z]

            vals, res = dls(params, op["seed"], err_fn)
            record(params, vals)
            rec["residual"][eff] = round(res, 4)
            rec["landmarks"][eff + "_target"] = [round(v, 4) for v in tgt]
        elif kind == "report":
            for part in op["parts"]:
                v = head(part) - ORIGIN
                rec["positions"][part] = [round(v.x, 4), round(v.y, 4), round(v.z, 4)]
            for name, loc in op.get("prop_points", {}).items():
                g = GRIPS[op["grip"]]
                G = (Matrix.Translation(Vector(g["pos"]))
                     @ Euler([math.radians(v) for v in g["rot"]], "XYZ").to_matrix().to_4x4())
                P = bone_frame(g["attach"]) @ G
                v = (P @ Vector(loc)) - ORIGIN
                rec["landmarks"][name] = [round(v.x, 4), round(v.y, 4), round(v.z, 4)]
        else:
            die(f"unknown op {kind!r}")

    out["beats"][q["name"]] = rec
    bad = {k: v for k, v in rec["residual"].items() if v > q.get("tolerance", 0.05)}
    flag = f"  RESIDUAL HIGH {bad}" if bad else ""
    print(f"=== {q['name']}: residuals {rec['residual']}{flag}")

json.dump(out, open(outpath, "w"), indent=1)
print(f"=== wrote {outpath}")
