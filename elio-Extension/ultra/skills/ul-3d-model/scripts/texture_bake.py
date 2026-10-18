"""Stage 4b: give a colourless generated mesh its colour, from the concept image.

WORKING as of 2026-08-26. Rebuilt after v1 shipped a cow with its face on its
flank and a pig that was dark grey over most of its body. Verified by eye on
both, front and back, against the concept.

    blender --background --python scripts/texture_bake.py -- \n        --mesh work/out/low.glb --concept work/concept.png --outdir work/out

NOTE: an explicit view must be passed as --view=-X+Y, with the equals sign.
argparse reads a bare "-X+Y" as an option, not a value.

WHAT V1 GOT WRONG, all four found by measurement on the pig:

 1. THE SUBJECT MASK WAS THE WHOLE FRAME. v1 sampled the four corners for a
    background colour and thresholded at 0.06. A concept has a VIGNETTE, so the
    lighter centre background read as subject: the mask covered 90.4% of the
    image and its bbox was the entire frame. Every silhouette score was
    therefore the mesh compared against a filled square, which is why all eight
    candidate views tied within 0.02 and why the report said
    alignment_trustworthy on a ruined texture. Now a border flood fill with a
    LOCAL tolerance, which follows a gradient. Pig: fill 0.275, correct bbox.

 2. NOTHING CHECKED THE MASK. check_mask() now refuses a mask over 60% or under
    3%, or one whose bbox spans the frame. Six lines, and it turns v1's silent
    wrong answer into a loud failure.

 3. THE PROJECTOR WAS FRAMED ON THE MESH, NOT ON THE CONCEPT. v1 used
    ortho_scale = radius * 2.2 centred on the mesh, against an uncropped
    concept: about 0.10 frame off in x and hanging 0.055 below the pig, so 31%
    of the pig's front-facing surface sampled background. That is the grey.
    Note that v1 ALREADY KNEW framing was the problem - _normalise() crops to
    the bbox for exactly this reason - but the fix had been applied only to the
    SCORE and never to the thing being scored. fit_projector() now moves and
    zooms the camera in a measured loop until the mesh silhouette bbox sits on
    the concept subject bbox. Pig: bbox IoU 0.99.

 4. ONE CAMERA CANNOT TEXTURE AN ANIMAL. Even perfectly aligned, a surface
    edge-on to the projector receives a colour stretched along the view axis.
    All eight single-camera trials put a snout across the flank. Two fixes:
      - a SECOND projector, camera A spun 180 degrees about the object's
        vertical axis, sampling the concept MIRRORED in u, blended by which way
        each surface faces. On a bilaterally symmetric animal that is the
        correct far side for free, and the mirror is what keeps the head at the
        head end instead of landing it on the rump.
      - a CONFIDENCE fade: where |normal . view axis| is near zero neither
        projector knows anything, so the shader falls back to the subject's
        median colour rather than painting a stretched sample.
    Camera B is DERIVED from camera A, not fitted separately. Two independent
    fits both scored 0.992 and still disagreed about which end was the head.

 5. Misses fall back to the subject's median colour, so a gap reads as
    pig-coloured rather than as background grey.

VIEW SELECTION IS SCORED AFTER FITTING, not before. Unfitted silhouette IoU is
dominated by framing: on the pig it spread 0.066 across all eight candidates.
Fitting first removes position and scale as variables and the cow's spread goes
from 0.11 to 0.25.

WHAT IS STILL TRUE AND CANNOT BE FIXED HERE: a silhouette cannot tell a mirror
pair apart. The pig's top two candidates scored 0.7523 and 0.7515. When
ambiguous_view is set, RENDER BOTH AND LOOK - scripts/pair_sheet.py puts the
concept next to the mesh seen from the projector axis and from behind it. That
is the one decision no statistic in this stage can make.

The report carries pct_landing_on_subject, which measures whether the colour
landed in the right place. Every statistic v1 reported measured only that
something had been projected.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import math
import bpy, numpy as np
from mathutils import Vector, Matrix

CANDIDATE_VIEWS = [
    ("+X", (1, 0, 0)), ("-X", (-1, 0, 0)),
    ("+Y", (0, 1, 0)), ("-Y", (0, -1, 0)),
    ("+X+Y", (.7071, .7071, 0)), ("+X-Y", (.7071, -.7071, 0)),
    ("-X+Y", (-.7071, .7071, 0)), ("-X-Y", (-.7071, -.7071, 0)),
]


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--concept", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--view", default="auto")
    p.add_argument("--texture-size", type=int, default=1024)
    p.add_argument("--mask-size", type=int, default=512)
    p.add_argument("--probe-size", type=int, default=192)
    p.add_argument("--samples", type=int, default=1)
    p.add_argument("--fit-iters", type=int, default=4)
    p.add_argument("--conf-min", type=float, default=0.15)
    p.add_argument("--conf-max", type=float, default=0.45)
    p.add_argument("--blend", type=float, default=0.25,
                   help="facing band: surfaces within +/- this dot product mix the two projectors")
    return p.parse_args(a)


def load_rgba(path, size):
    im = bpy.data.images.load(str(path))
    im.scale(size, size)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(im)
    return a


def subject_mask(path, size, tol=0.02):
    """Background is whatever the image border reaches by small local steps.

    Local rather than global, because a concept background is a VIGNETTE: the
    corners are visibly darker than the centre, which is exactly what defeated
    the corner-sample threshold in v1.
    """
    rgb = load_rgba(path, size)[:, :, :3]
    bg = np.zeros((size, size), bool)
    bg[0, :] = bg[-1, :] = True
    bg[:, 0] = bg[:, -1] = True
    for _ in range(size * 2):
        grew = False
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            near = np.roll(bg, sh, axis=ax)
            delta = np.abs(rgb - np.roll(rgb, sh, axis=ax)).sum(axis=2)
            if sh == 1 and ax == 0:
                near[0, :] = False
            elif sh == -1 and ax == 0:
                near[-1, :] = False
            elif sh == 1 and ax == 1:
                near[:, 0] = False
            else:
                near[:, -1] = False
            add = near & (delta < tol) & ~bg
            if add.any():
                bg |= add
                grew = True
        if not grew:
            break
    return ~bg


def check_mask(mask):
    """The gate v1 never had. A mask that is nearly the whole frame is not a
    subject, it is a failed segmentation, and everything downstream of it lies.
    """
    size = mask.shape[0]
    fill = float(mask.sum()) / mask.size
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        raise SystemExit("[texture] FAIL: subject mask is empty.")
    box = (float(xs.min()) / size, float(xs.max() + 1) / size,
           float(ys.min()) / size, float(ys.max() + 1) / size)
    touched = sum([box[0] <= 0.005, box[1] >= 0.995,
                   box[2] <= 0.005, box[3] >= 0.995])
    info = {"fill": round(fill, 4), "bbox": [round(v, 4) for v in box],
            "edges_touched": touched}
    if fill > 0.60:
        raise SystemExit(
            "[texture] FAIL: subject mask covers {:.1%} of the concept. That is "
            "a failed segmentation, not a subject. v1 shipped a 90.4% mask and "
            "every number downstream of it was meaningless.".format(fill))
    if fill < 0.03:
        raise SystemExit("[texture] FAIL: subject mask is only {:.1%}.".format(fill))
    if touched == 4:
        raise SystemExit("[texture] FAIL: subject mask bbox spans the whole frame.")
    return info


def bbox_of(mask):
    size = mask.shape[0]
    ys, xs = np.nonzero(mask)
    return (float(xs.min()) / size, float(xs.max() + 1) / size,
            float(ys.min()) / size, float(ys.max() + 1) / size)


def norm_crop(mask, out=64):
    size = mask.shape[0]
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return np.zeros((out, out), bool)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = max(x1 - x0 + 1, 1), max(y1 - y0 + 1, 1)
    j = np.clip((np.arange(out) * h) // out + y0, 0, size - 1)
    i = np.clip((np.arange(out) * w) // out + x0, 0, size - 1)
    return mask[j][:, i]


def iou(a, b):
    a, b = norm_crop(a), norm_crop(b)
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 0.0


def box_iou(a, b):
    ax0, ax1, ay0, ay1 = a
    bx0, bx1, by0, by1 = b
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    u = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / u if u > 0 else 0.0


def import_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    m = [o for o in bpy.data.objects if o.type == "MESH"]
    if not m:
        raise SystemExit("no mesh in {}".format(path))
    if not m[0].data.uv_layers:
        raise SystemExit("mesh has no UVs; run mesh_pipeline first")
    return m[0]


def centre_radius(obj):
    c = obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box), Vector()) / 8.0)
    return c, (max(obj.dimensions) * 0.5 or 1.0)


def make_cam(obj, direction, scale_mult=2.2):
    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    cam.data.type = "ORTHO"
    c, r = centre_radius(obj)
    d = Vector(direction).normalized()
    cam.location = c + d * (r * 4.0)
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = r * scale_mult
    bpy.context.scene.camera = cam
    return cam


def setup_render(size, samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.render.resolution_x = s.render.resolution_y = size
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"


def silhouette(cam, size, tmp):
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    a = load_rgba(tmp, size)[:, :, 3] > 0.03
    Path(tmp).unlink(missing_ok=True)
    return a


def fit_projector(obj, cam, target_box, size, tmp, iters):
    """Move and zoom the camera until the mesh silhouette bbox sits on the
    concept subject bbox. Measured in a loop, not derived in one step: the sign
    conventions for an ortho shift are easy to get backwards and a wrong sign
    here is invisible in the output.
    """
    cx0, cx1, cy0, cy1 = target_box
    tcx, tcy = (cx0 + cx1) / 2, (cy0 + cy1) / 2
    tw, th = cx1 - cx0, cy1 - cy0
    trace = []
    for _ in range(iters):
        m = silhouette(cam, size, tmp)
        b = bbox_of(m)
        trace.append({"mesh_bbox": [round(v, 4) for v in b],
                      "bbox_iou": round(box_iou(b, target_box), 4)})
        mw, mh = b[1] - b[0], b[3] - b[2]
        mcx, mcy = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
        k = float(np.sqrt((mw / tw) * (mh / th)))
        cam.data.ortho_scale *= k
        pcx = 0.5 + (mcx - 0.5) / k
        pcy = 0.5 + (mcy - 0.5) / k
        rot = cam.matrix_world.to_3x3()
        right = rot @ Vector((1, 0, 0))
        up = rot @ Vector((0, 1, 0))
        s = cam.data.ortho_scale
        cam.location = cam.location + right * ((pcx - tcx) * s) + up * ((pcy - tcy) * s)
    b = bbox_of(silhouette(cam, size, tmp))
    trace.append({"mesh_bbox": [round(v, 4) for v in b],
                  "bbox_iou": round(box_iou(b, target_box), 4)})
    return {"trace": trace, "final_bbox_iou": trace[-1]["bbox_iou"]}


def masked_concept(concept, mask, size):
    """The concept with the background made transparent, so a miss is visible
    to the shader as alpha 0 and can be replaced instead of painted on."""
    rgba = load_rgba(concept, size)
    m = mask
    if m.shape[0] != size:
        idx = np.clip((np.arange(size) * m.shape[0]) // size, 0, m.shape[0] - 1)
        m = m[idx][:, idx]
    rgba[:, :, 3] = m.astype(np.float32)
    img = bpy.data.images.new("ConceptMasked", width=size, height=size, alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    med = np.median(rgba[:, :, :3][m], axis=0)
    return img, [float(v) for v in med]


def mirror_camera(obj, cam):
    """Camera B is camera A walked 180 degrees around the object's vertical axis.

    Derived from A rather than fitted independently. Two independent fits can
    each score 0.99 and still disagree about which end is the head, which is how
    the face ended up on one side's rump.
    """
    centre, _ = centre_radius(obj)
    spin = (Matrix.Translation(centre) @ Matrix.Rotation(math.pi, 4, "Z")
            @ Matrix.Translation(-centre))
    bpy.ops.object.camera_add()
    cam_b = bpy.context.view_layer.objects.active
    cam_b.data.type = "ORTHO"
    cam_b.data.ortho_scale = cam.data.ortho_scale
    cam_b.matrix_world = spin @ cam.matrix_world
    return cam_b


def _projector(obj, cam, name):
    if name not in obj.data.uv_layers:
        obj.data.uv_layers.new(name=name)
    mod = obj.modifiers.new("UVProject_" + name, "UV_PROJECT")
    mod.uv_layer = name
    mod.projector_count = 1
    mod.projectors[0].object = cam
    mod.aspect_x = mod.aspect_y = 1.0


def build_projection(obj, cam_a, cam_b, direction, img, fallback, blend=0.25,
                     conf_min=0.15, conf_max=0.45):
    """Two opposed projectors, blended by which way each surface faces.

    ONE CAMERA CANNOT TEXTURE AN ANIMAL. Surfaces edge-on to the projector
    receive a colour stretched along the view axis, which is what put a snout
    across the pig's flank in every one of the eight single-camera trials.

    Camera B looks from the OPPOSITE direction and samples the concept MIRRORED
    in u. On a bilaterally symmetric subject that is the correct far side for
    free: the head stays at the head end instead of landing on the rump, which
    is what an unmirrored second projector would do.
    """
    _projector(obj, cam_a, "ProjA")
    _projector(obj, cam_b, "ProjB")

    mat = bpy.data.materials.new("ProjectMat")
    mat.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nt = mat.node_tree
    n, l = nt.nodes, nt.links
    bsdf = n.get("Principled BSDF")

    uva = n.new("ShaderNodeUVMap"); uva.uv_map = "ProjA"
    texa = n.new("ShaderNodeTexImage"); texa.image = img; texa.extension = "CLIP"
    l.new(uva.outputs["UV"], texa.inputs["Vector"])

    uvb = n.new("ShaderNodeUVMap"); uvb.uv_map = "ProjB"
    flip = n.new("ShaderNodeMapping")
    flip.inputs["Location"].default_value = (1.0, 0.0, 0.0)
    flip.inputs["Scale"].default_value = (-1.0, 1.0, 1.0)
    texb = n.new("ShaderNodeTexImage"); texb.image = img; texb.extension = "CLIP"
    l.new(uvb.outputs["UV"], flip.inputs["Vector"])
    l.new(flip.outputs["Vector"], texb.inputs["Vector"])

    geo = n.new("ShaderNodeNewGeometry")
    dot = n.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(Vector(direction).normalized())
    l.new(geo.outputs["Normal"], dot.inputs[0])
    fac = n.new("ShaderNodeMapRange")
    fac.inputs["From Min"].default_value = -blend
    fac.inputs["From Max"].default_value = blend
    fac.inputs["To Min"].default_value = 0.0
    fac.inputs["To Max"].default_value = 1.0
    fac.clamp = True
    l.new(dot.outputs["Value"], fac.inputs["Value"])

    mix_c = n.new("ShaderNodeMixRGB"); mix_c.blend_type = "MIX"
    l.new(fac.outputs["Result"], mix_c.inputs["Fac"])
    l.new(texb.outputs["Color"], mix_c.inputs["Color1"])
    l.new(texa.outputs["Color"], mix_c.inputs["Color2"])

    mix_a = n.new("ShaderNodeMixRGB"); mix_a.blend_type = "MIX"
    l.new(fac.outputs["Result"], mix_a.inputs["Fac"])
    l.new(texb.outputs["Alpha"], mix_a.inputs["Color1"])
    l.new(texa.outputs["Alpha"], mix_a.inputs["Color2"])

    # CONFIDENCE. A surface edge-on to the view axis is seen by NEITHER
    # projector, and sampling it anyway is what smears a snout up the back.
    # |normal . axis| near zero means "no information", so fade to flat colour.
    absd = n.new("ShaderNodeMath"); absd.operation = "ABSOLUTE"
    l.new(dot.outputs["Value"], absd.inputs[0])
    conf = n.new("ShaderNodeMapRange")
    conf.inputs["From Min"].default_value = conf_min
    conf.inputs["From Max"].default_value = conf_max
    conf.inputs["To Min"].default_value = 0.0
    conf.inputs["To Max"].default_value = 1.0
    conf.clamp = True
    l.new(absd.outputs["Value"], conf.inputs["Value"])
    gate = n.new("ShaderNodeMath"); gate.operation = "MULTIPLY"
    l.new(mix_a.outputs["Color"], gate.inputs[0])
    l.new(conf.outputs["Result"], gate.inputs[1])

    flat = n.new("ShaderNodeRGB")
    flat.outputs[0].default_value = (fallback[0], fallback[1], fallback[2], 1.0)
    out = n.new("ShaderNodeMixRGB"); out.blend_type = "MIX"
    l.new(gate.outputs["Value"], out.inputs["Fac"])
    l.new(flat.outputs[0], out.inputs["Color1"])
    l.new(mix_c.outputs["Color"], out.inputs["Color2"])
    l.new(out.outputs["Color"], bsdf.inputs["Base Color"])


def bake(obj, size, samples, outdir):
    image = bpy.data.images.new("Colour", width=size, height=size, alpha=True)
    mat = obj.data.materials[0]
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.select = True
    mat.node_tree.nodes.active = node
    obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.render.bake.use_selected_to_active = False
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    r = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"},
                            use_selected_to_active=False, use_clear=True, margin=16)
    if "FINISHED" not in r:
        raise SystemExit("bake failed: {}".format(r))
    out = Path(outdir) / "color.png"
    image.filepath_raw = str(out)
    image.file_format = "PNG"
    image.save()
    return out


def main():
    a = args()
    mesh_p, concept_p = Path(a.mesh).resolve(), Path(a.concept).resolve()
    outdir = Path(a.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    tmp = outdir / "_probe.png"

    obj = import_mesh(mesh_p)
    mask = subject_mask(concept_p, a.mask_size)
    mask_info = check_mask(mask)
    target_box = bbox_of(mask)
    print("[texture] subject mask OK: fill {} bbox {}".format(
        mask_info["fill"], mask_info["bbox"]))

    setup_render(a.probe_size, 1)
    idx = np.clip((np.arange(a.probe_size) * mask.shape[0]) // a.probe_size,
                  0, mask.shape[0] - 1)
    probe_mask = mask[idx][:, idx]
    spread = None
    ambiguous = False
    scores = {}
    if a.view == "auto":
        # SCORE AFTER FITTING, NOT BEFORE. An unfitted silhouette score is
        # dominated by framing: on the pig it spread only 0.066 across all eight
        # candidates and picked a view whose fit could not exceed 0.98. Fitting
        # first removes position and scale as variables, so what is left is the
        # thing actually being asked - does this outline match.
        for label, d in CANDIDATE_VIEWS:
            c = make_cam(obj, d)
            fit_projector(obj, c, target_box, a.probe_size, tmp, a.fit_iters)
            m = silhouette(c, a.probe_size, tmp)
            u = (m | probe_mask).sum()
            scores[label] = round(float((m & probe_mask).sum() / u) if u else 0.0, 4)
            bpy.data.objects.remove(c, do_unlink=True)
        label = max(scores, key=scores.get)
        ranked = sorted(scores.values(), reverse=True)
        spread = ranked[0] - ranked[-1]
        ambiguous = (ranked[0] - ranked[1]) < 0.02
    else:
        label = a.view
    direction = dict(CANDIDATE_VIEWS)[label]
    print("[texture] view {} post-fit scores={}".format(label, scores))

    cam = make_cam(obj, direction)
    fit = fit_projector(obj, cam, target_box, a.probe_size, tmp, a.fit_iters)
    cam_b = mirror_camera(obj, cam)
    print("[texture] projector fitted, bbox IoU {:.3f}".format(fit["final_bbox_iou"]))

    m = silhouette(cam, a.mask_size, tmp)
    idx = np.clip((np.arange(a.mask_size) * mask.shape[0]) // a.mask_size,
                  0, mask.shape[0] - 1)
    mk = mask[idx][:, idx]
    on = float((m & mk).sum()) / max(int(m.sum()), 1)

    setup_render(a.texture_size, a.samples)
    img, fallback = masked_concept(concept_p, mask, a.texture_size)
    build_projection(obj, cam, cam_b, direction, img, fallback, a.blend,
                     a.conf_min, a.conf_max)
    colour = bake(obj, a.texture_size, a.samples, outdir)

    report = {
        "mesh": str(mesh_p), "concept": str(concept_p), "view": label,
        "view_scores": scores, "ambiguous_view": ambiguous,
        "view_score_spread": round(spread, 4) if spread is not None else None,
        "mask": mask_info, "projector_fit": fit,
        "pct_landing_on_subject": round(100 * on, 1),
        "fallback_colour_linear": [round(v, 4) for v in fallback],
        "color_map": str(colour),
    }
    # Deliberately NOT a pass/fail on the texture. These say what was measured
    # and nothing more; v1's sin was a boolean called alignment_trustworthy that
    # measured only that something had been projected.
    # THRESHOLDS ARE PROVISIONAL, on two measured assets and no measured
    # failure. pig 0.988 and cow 0.810 BOTH produced a texture that reads
    # correctly by eye, so a 0.90 hard fail would have rejected a good cow.
    # Fail low, warn in between, and do not tighten either number without a
    # measured bad case to justify it.
    report["projector_aligned"] = fit["final_bbox_iou"] > 0.70
    report["projector_fit_weak"] = fit["final_bbox_iou"] <= 0.90
    report["coverage_ok"] = on > 0.60
    report["requires_visual_check"] = True
    report["check_command"] = (
        'blender --background --python scripts/pair_sheet.py -- '
        '--mesh {} --color {} --concept {} --view={} --out pair.png'.format(
            mesh_p.name, "color.png", concept_p.name, label))
    (outdir / "texture_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if not report["projector_aligned"]:
        print("[texture] FAIL: the projector could not be fitted to the concept "
              "(bbox IoU {:.2f}). The chosen view is probably wrong."
              .format(fit["final_bbox_iou"]))
        return 1
    if report["projector_fit_weak"]:
        print("[texture] NOTE: fit is {:.2f}. The mesh silhouette and the concept "
              "differ in shape, so some colour will sit slightly off. Look harder "
              "at the pair sheet.".format(fit["final_bbox_iou"]))
    if not report["coverage_ok"]:
        print("[texture] FAIL: only {:.0f}% of the visible mesh lands on the "
              "subject. Most of this model would be flat fallback colour."
              .format(100 * on))
        return 1
    if ambiguous:
        print("[texture] AMBIGUOUS VIEW: the top two candidates are within 0.02. "
              "A silhouette cannot tell a mirror pair apart. Render both and LOOK.")
    print("[texture] projector aligned and {:.0f}% covered. NOW LOOK AT IT:"
          .format(100 * on))
    print("  " + report["check_command"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
