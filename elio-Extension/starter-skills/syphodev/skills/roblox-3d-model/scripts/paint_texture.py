"""Stage 4b, alternative: PAINT the colour map instead of projecting a photo onto it.

    blender --background --python paint_texture.py -- \\
        --mesh low.glb --spec pig.paint.json --outdir out
    blender --background --python paint_texture.py -- \\
        --mesh low.glb --concept concept.png --describe

WHY THIS EXISTS. Projecting the concept onto the mesh was rebuilt once and still
smears: a photograph has to be wrapped around geometry it was never taken of, so
surfaces edge-on to the camera get stretched colour and a mirror-pair view is
undecidable. A Roblox animal at 6,000 tris is not a photograph. It is four or
five flat regions - body, belly, hooves, snout, eyes - and painting those
directly is exact, deterministic, has no view to choose and nothing to smear.

HOW. Every texel of the mesh's OWN UV layout is rasterised back to the 3D point
it belongs to, that point is normalised into the mesh's bounding box, and a small
stack of stamps decides its colour. No cameras anywhere.

  x: 0..1 across the width      y: 0..1 nose to tail (read it off axes_probe)
  z: 0..1 hoof to spine

SPEC
{
  "base": "#E89AB4",
  "stamps": [
    {"type": "band", "axis": "z", "max": 0.06, "color": "#3B2C30", "soft": 0.01},
    {"type": "blob", "at": [0.5, 0.03, 0.42], "r": [0.17, 0.05, 0.15],
     "color": "#E2849F", "soft": 0.25},
    {"type": "blob", "at": [0.30, 0.13, 0.63], "r": [0.07, 0.07, 0.07],
     "color": "#FFFFFF", "soft": 0.1, "mirror": "x"}
  ]
}

  band  - a slab along one axis, "min" and/or "max"
  blob  - an ellipsoid, "at" centre and "r" per-axis radii
  facing- restricts any stamp to surfaces whose normal points a way:
          "facing": [0, -1, 0] with "facing_min": 0.3

"mirror": "x" repeats the stamp mirrored about x = 0.5, which is how you get two
eyes, two ears and two of anything else from one entry.

Stamps apply in order, each over the last. "soft" is a fraction of the stamp size
over which it fades; 0 is a hard edge, which is usually what a stylised asset
wants.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy, numpy as np


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--spec")
    p.add_argument("--outdir")
    p.add_argument("--concept")
    p.add_argument("--describe", action="store_true")
    p.add_argument("--texture-size", type=int, default=1024)
    p.add_argument("--dilate", type=int, default=12)
    return p.parse_args(a)


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_to_linear(h):
    h = h.lstrip("#")
    rgb = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return srgb_to_linear(rgb)


def linear_to_srgb(c):
    """Encode a linear buffer to sRGB.

    The stamp stack works in LINEAR light, because that is the only space in
    which blending two colours means anything. A PNG handed to a game engine is
    read as sRGB. Those are not the same numbers, and writing one where the
    other is expected costs roughly a factor of two in brightness.
    """
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def linear_to_hex(c):
    c = np.asarray(c, dtype=np.float64)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
    return "#" + "".join("{:02X}".format(int(round(float(v) * 255))) for v in np.clip(s, 0, 1))


def subject_mask(path, size=256, tol=0.02):
    """Subject = whatever the image border CANNOT reach by small local steps.

    Local tolerance, not a global threshold, because a concept background is a
    VIGNETTE: the corners are darker than the centre. And not a chroma test
    either - a grey backdrop picks up a colour cast off the subject, which on
    the pig kept 85% of the background and returned a palette of three greys.
    """
    im = bpy.data.images.load(str(path))
    im.scale(size, size)
    rgb = np.array(im.pixels[:], np.float32).reshape(size, size, 4)[:, :, :3].astype(np.float64)
    bpy.data.images.remove(im)

    bg = np.zeros((size, size), bool)
    bg[0, :] = bg[-1, :] = True
    bg[:, 0] = bg[:, -1] = True
    for _ in range(size * 2):
        grew = False
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            near = np.roll(bg, sh, axis=ax)
            if sh == 1 and ax == 0:
                near[0, :] = False
            elif sh == -1 and ax == 0:
                near[-1, :] = False
            elif sh == 1 and ax == 1:
                near[:, 0] = False
            else:
                near[:, -1] = False
            d = np.abs(rgb - np.roll(rgb, sh, axis=ax)).sum(axis=2)
            add = near & (d < tol) & ~bg
            if add.any():
                bg |= add
                grew = True
        if not grew:
            break
    return ~bg, rgb


def check_mask(mask):
    """Refuse a mask that is obviously a failed segmentation. Without this gate
    the old projection stage shipped a 90.4% mask and every number downstream
    of it was meaningless."""
    fill = float(mask.sum()) / mask.size
    if fill > 0.60:
        raise SystemExit("[paint] FAIL: subject mask covers {:.1%} of the concept. "
                         "That is a failed segmentation, not a subject.".format(fill))
    if fill < 0.03:
        raise SystemExit("[paint] FAIL: subject mask is only {:.1%}.".format(fill))
    return fill


def load_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
    me = obj.data
    if not me.uv_layers:
        raise SystemExit("mesh has no UVs; run mesh_pipeline.py first")
    me.calc_loop_triangles()
    try:
        me.calc_normals_split()
    except AttributeError:
        pass

    nv = len(me.vertices)
    co = np.empty((nv, 3), np.float64)
    me.vertices.foreach_get("co", co.ravel())
    mw = np.array(obj.matrix_world.to_4x4())
    co = co @ mw[:3, :3].T + mw[:3, 3]

    nl = len(me.loops)
    uv = np.empty((nl, 2), np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())
    ln = np.empty((nl, 3), np.float64)
    me.loops.foreach_get("normal", ln.ravel())
    ln = ln @ mw[:3, :3].T

    nt = len(me.loop_triangles)
    tv = np.empty((nt, 3), np.int32)
    tl = np.empty((nt, 3), np.int32)
    me.loop_triangles.foreach_get("vertices", tv.ravel())
    me.loop_triangles.foreach_get("loops", tl.ravel())
    return co, uv, ln, tv, tl


def describe(co, tv, concept):
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)
    n = (co - lo) / span
    print("[paint] bbox span (studs): {}".format([round(float(v), 3) for v in (hi - lo)]))
    print("[paint] Y profile, 10 slices nose(0) to tail(1):")
    print("        {:>6} {:>7} {:>7} {:>7} {:>7} {:>6}".format(
        "y", "zmin", "zmax", "xmin", "xmax", "n"))
    for i in range(10):
        m = (n[:, 1] >= i / 10) & (n[:, 1] < (i + 1) / 10)
        if not m.any():
            continue
        s = n[m]
        print("        {:>6} {:>7} {:>7} {:>7} {:>7} {:>6}".format(
            "{:.2f}".format((i + 0.5) / 10),
            round(float(s[:, 2].min()), 3), round(float(s[:, 2].max()), 3),
            round(float(s[:, 0].min()), 3), round(float(s[:, 0].max()), 3), int(m.sum())))
    tip = n[np.argmin(n[:, 1])]
    print("[paint] nose-most vertex at {}".format([round(float(v), 3) for v in tip]))
    low = n[n[:, 2] < 0.05]
    if len(low):
        print("[paint] lowest 5% of Z: {} verts, x range {} to {}, y range {} to {}".format(
            len(low), round(float(low[:, 0].min()), 3), round(float(low[:, 0].max()), 3),
            round(float(low[:, 1].min()), 3), round(float(low[:, 1].max()), 3)))

    if concept:
        mask, rgbf = subject_mask(concept, 256)
        fill = check_mask(mask)
        keep = rgbf[mask]
        print("[paint] concept subject is {:.1%} of the frame".format(fill))
        rng = np.random.default_rng(0)
        cen = keep[rng.choice(len(keep), 6, replace=False)]
        for _ in range(25):
            d = ((keep[:, None, :] - cen[None, :, :]) ** 2).sum(axis=2)
            lab = d.argmin(axis=1)
            for k in range(6):
                if (lab == k).any():
                    cen[k] = keep[lab == k].mean(axis=0)
        order = np.argsort([-(lab == k).sum() for k in range(6)])
        print("[paint] concept palette, most common first:")
        for k in order:
            share = float((lab == k).sum()) / len(keep)
            print("        {}  {:5.1%}  linear {}".format(
                linear_to_hex(cen[k]), share, [round(float(v), 3) for v in cen[k]]))


def rasterise(co, uv, ln, tv, tl, size):
    """Every texel back to the surface point it belongs to.

    Barycentric fill per triangle in UV space. The mesh's own layout is the
    target, exactly as the bake was, so nothing downstream changes.
    """
    pos = np.zeros((size, size, 3), np.float64)
    nrm = np.zeros((size, size, 3), np.float64)
    hit = np.zeros((size, size), bool)

    p = co[tv]                      # (nt,3,3) triangle corner positions
    n = ln[tl]                      # (nt,3,3) corner normals
    t = uv[tl] * size               # (nt,3,2) corner uvs in texel space

    for i in range(len(t)):
        a, b, c = t[i]
        x0 = max(int(np.floor(min(a[0], b[0], c[0]))) - 1, 0)
        x1 = min(int(np.ceil(max(a[0], b[0], c[0]))) + 1, size)
        y0 = max(int(np.floor(min(a[1], b[1], c[1]))) - 1, 0)
        y1 = min(int(np.ceil(max(a[1], b[1], c[1]))) + 1, size)
        if x1 <= x0 or y1 <= y0:
            continue
        xs = np.arange(x0, x1) + 0.5
        ys = np.arange(y0, y1) + 0.5
        gx, gy = np.meshgrid(xs, ys)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / d
        w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / d
        w2 = 1.0 - w0 - w1
        m = (w0 >= -0.002) & (w1 >= -0.002) & (w2 >= -0.002)
        if not m.any():
            continue
        ww = np.stack([w0[m], w1[m], w2[m]], axis=1)
        sl = (slice(y0, y1), slice(x0, x1))
        pos[sl][m] = ww @ p[i]
        nrm[sl][m] = ww @ n[i]
        hit[sl][m] = True
    return pos, nrm, hit


def evaluate(spec, npos, nrm):
    out = np.tile(hex_to_linear(spec.get("base", "#CCCCCC")), (*npos.shape[:2], 1))
    for raw in spec.get("stamps", []):
        for st in ([raw] if raw.get("mirror") != "x" else [raw, _mirror(raw)]):
            w = _weight(st, npos, nrm)
            col = hex_to_linear(st["color"])
            out = out * (1 - w[..., None]) + col * w[..., None]
    return out


def _mirror(st):
    m = json.loads(json.dumps(st))
    m.pop("mirror", None)
    if "at" in m:
        m["at"] = [1.0 - m["at"][0], m["at"][1], m["at"][2]]
    if m.get("axis") == "x":
        lo, hi = m.get("min"), m.get("max")
        if hi is not None:
            m["min"] = 1.0 - hi
        else:
            m.pop("min", None)
        if lo is not None:
            m["max"] = 1.0 - lo
        else:
            m.pop("max", None)
    if "facing" in m:
        f = m["facing"]
        m["facing"] = [-f[0], f[1], f[2]]
    return m


def _weight(st, npos, nrm):
    kind = st.get("type", "blob")
    soft = float(st.get("soft", 0.0))
    if kind == "band":
        ax = {"x": 0, "y": 1, "z": 2}[st["axis"]]
        v = npos[:, :, ax]
        w = np.ones_like(v)
        if "max" in st:
            w = np.minimum(w, _ramp(float(st["max"]) - v, soft))
        if "min" in st:
            w = np.minimum(w, _ramp(v - float(st["min"]), soft))
    elif kind == "blob":
        at = np.array(st["at"], float)
        r = np.array(st["r"], float)
        d = np.sqrt((((npos - at) / np.maximum(r, 1e-6)) ** 2).sum(axis=2))
        w = _ramp(1.0 - d, max(soft, 1e-6))
    else:
        raise SystemExit("unknown stamp type: {}".format(kind))

    if "facing" in st:
        f = np.array(st["facing"], float)
        f = f / (np.linalg.norm(f) or 1.0)
        ln = nrm / np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-9)
        dot = (ln * f).sum(axis=2)
        w = w * _ramp(dot - float(st.get("facing_min", 0.0)), 0.15)
    return np.clip(w, 0, 1)


def _ramp(x, soft):
    if soft <= 0:
        return (x >= 0).astype(np.float64)
    t = np.clip(x / soft, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def dilate(rgb, hit, rounds):
    """Grow colour into the empty gutter so mip-mapping cannot pull background in."""
    out, filled = rgb.copy(), hit.copy()
    for _ in range(rounds):
        acc = np.zeros_like(out)
        cnt = np.zeros(filled.shape, np.float64)
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            acc += np.roll(np.where(filled[..., None], out, 0), sh, axis=ax)
            cnt += np.roll(filled.astype(np.float64), sh, axis=ax)
        grow = (~filled) & (cnt > 0)
        if not grow.any():
            break
        out[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    return out


def main():
    a = args()
    co, uv, ln, tv, tl = load_mesh(Path(a.mesh).resolve())
    if a.describe:
        describe(co, tv, Path(a.concept).resolve() if a.concept else None)
        return 0
    if not (a.spec and a.outdir):
        raise SystemExit("need --spec and --outdir (or --describe)")

    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    outdir = Path(a.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    size = a.texture_size

    pos, nrm, hit = rasterise(co, uv, ln, tv, tl, size)
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)
    npos = (pos - lo) / span

    rgb = evaluate(spec, npos, nrm)
    rgb = np.where(hit[..., None], rgb, 0.0)
    rgb = dilate(rgb, hit, a.dilate)

    # WRITE sRGB BYTES, AND SAY SO.
    #
    # MEASURED 2026-09-02 on a set of blade props: a spec asking for #969BA0
    # produced a PNG whose pixels were #4E545A - which is exactly #969BA0's
    # LINEAR encoding. Blender was not converting the buffer on save, so every
    # colour map this pipeline has produced shipped linear values in a file its
    # consumer reads as sRGB, and got re-linearised on load. Everything came out
    # around half as bright and washed toward black: an orange ember groove
    # rendered as dark maroon.
    #
    # Nothing caught it, because nothing was looking at the numbers. The atlas
    # had full UV coverage, the stamps landed in the right places, the report
    # was green, and the render was merely "a bit dark" - which reads as
    # lighting, not as a bug.
    #
    # So encode here, explicitly, and mark the image Non-Color so no Blender
    # version silently encodes it a second time.
    srgb = linear_to_srgb(rgb)
    img = bpy.data.images.new("Painted", width=size, height=size, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.concatenate([srgb, np.ones((size, size, 1))], axis=2)
    img.pixels = rgba.reshape(-1).tolist()
    out = outdir / "color.png"
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()

    coverage = float(hit.sum()) / hit.size
    report = {"mesh": str(a.mesh), "spec": str(a.spec), "color_map": str(out),
              "uv_coverage": round(coverage, 4),
              "texels_painted": int(hit.sum()),
              "stamps": [s.get("name", s.get("type")) for s in spec.get("stamps", [])],
              "requires_visual_check": True}
    (outdir / "paint_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if coverage < 0.15:
        print("[paint] FAIL: only {:.1%} of the atlas was reached by any triangle. "
              "The UV layout or the rasteriser is wrong.".format(coverage))
        return 1
    print("[paint] wrote {}. NOW LOOK AT IT.".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
