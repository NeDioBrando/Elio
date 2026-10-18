#!/usr/bin/env python3
"""Tag a harvested VFX library so it can be searched by what an effect IS.

A harvest gives you values and filenames. Measured on a real 1813-recipe library,
only 29% of those filenames say anything ("Part", "78", a texture id), so the
library is complete, verified and unusable. This adds two independent signals:

  1. VALUES  (100% coverage) - how the particle moves and is timed, read from the
     harvested properties. Says nothing about the sprite. And for the long tail of
     texture-swatch entries the values are DELIBERATELY neutral (white, speed 0,
     size 1), so on its own this classifies 1552 of them identically.

  2. SPRITE  (97% coverage) - what the texture looks like, read from its pixels.
     CRITICAL: most particle textures are flipbook sprite SHEETS (1481 of 2180
     layers here are Grid4x4), so measuring the whole image reports the geometry
     of the tiling, not the effect. Crop to one frame first, using the layout the
     recipe declares, and pick the frame with the most ink because frame 0 of a
     OneShot flipbook is usually near-empty.

Together they cover 98%. Names, where they exist, still beat both and are kept.

    python classify_lib.py --lib "~/Roblox-VFX-Library"          # all three stages
    python classify_lib.py --lib DIR --stage index            # just re-merge
    python classify_lib.py --lib DIR --sheet ring             # AUDIT the labels

Run the audit. A classifier nobody eyeballed is a classifier that says yes.
"""
import argparse, colorsys, json, math, pathlib, re, sys, time, urllib.request, collections

UA = {"User-Agent": "Mozilla/5.0"}
GRID = {"ParticleFlipbookLayout.Grid2x2": 2, "ParticleFlipbookLayout.Grid4x4": 4,
        "ParticleFlipbookLayout.Grid8x8": 8, "ParticleFlipbookLayout.None": 1}


def recipes_dir(lib):
    p = pathlib.Path(lib) / "recipes"
    return p if p.is_dir() else pathlib.Path(lib)


def load_recipes(lib):
    return [(f, json.loads(f.read_text(encoding="utf-8")))
            for f in sorted(recipes_dir(lib).glob("*.json"))]


# ─────────────────────────────────────────────────────────── stage 1: textures
def http(u, raw=False, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=45)
            return r.read() if raw else json.load(r)
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(1.5 * (i + 1))


def stage_fetch(lib):
    tex = pathlib.Path(lib) / ".cache" / "tex"
    tex.mkdir(parents=True, exist_ok=True)
    ids = set()
    for _, r in load_recipes(lib):
        for t in r.get("texture_refs", []):
            m = re.search(r"(\d{5,})", t or "")
            if m:
                ids.add(m.group(1))
    todo = sorted(i for i in ids if not (tex / f"{i}.png").is_file())
    print(f"[fetch] {len(ids)} unique textures, {len(todo)} to download")
    urls = {}
    for i in range(0, len(todo), 100):
        d = http("https://thumbnails.roblox.com/v1/assets?assetIds="
                 + ",".join(todo[i:i + 100]) + "&size=150x150&format=Png")
        for x in (d or {}).get("data", []):
            if x.get("state") == "Completed" and x.get("imageUrl"):
                urls[str(x["targetId"])] = x["imageUrl"]
    n = 0
    for k, u in urls.items():
        b = http(u, raw=True)
        if b:
            (tex / f"{k}.png").write_bytes(b)
            n += 1
            if n % 200 == 0:
                print(f"  {n}/{len(urls)}", flush=True)
    print(f"[fetch] saved {n}, cache now {len(list(tex.glob('*.png')))}")


# ───────────────────────────────────────────────────────────── stage 2: values
def _seq(p, k):
    v = p.get(k)
    return v["NumberSequence"] if isinstance(v, dict) and "NumberSequence" in v else None


def _rng(p, k):
    v = p.get(k)
    return v["NumberRange"] if isinstance(v, dict) and "NumberRange" in v else None


HUES = [("red", 345, 15), ("orange", 15, 45), ("yellow", 45, 70), ("green", 70, 165),
        ("cyan", 165, 200), ("blue", 200, 255), ("purple", 255, 295), ("pink", 295, 345)]


def hue_name(d, s=1.0, v=1.0):
    if v < 0.12:
        return "black"
    if s < 0.12:
        return "white" if v > 0.7 else "grey"
    for n, a, b in HUES:
        if a > b:
            if d >= a or d < b:
                return n
        elif a <= d < b:
            return n
    return "red"


def value_tags(rec):
    layers = rec.get("layers", [])
    pes = [L for L in layers if L.get("class") == "ParticleEmitter"]
    t, notes = set(), {}
    if any(L.get("class") in ("Beam", "Trail") for L in layers):
        t.add("beam-or-trail")
    t.add("layered" if len(layers) >= 4 else ("single-emitter" if len(layers) == 1 else "pair"))
    modes = {(L.get("emit") or {}).get("mode") for L in layers}
    if "burst" in modes:
        t.add("one-shot")
    if "continuous" in modes:
        t.add("continuous")

    lifes = [x for x in (_rng(L.get("props", {}), "Lifetime") for L in pes) if x]
    if lifes:
        mx = max(x[1] for x in lifes)
        notes["lifetime_max"] = round(mx, 3)
        t.add("flash" if mx <= 0.35 else ("lingering" if mx >= 2.5 else "medium"))
    sps = [x for x in (_rng(L.get("props", {}), "Speed") for L in pes) if x]
    if sps:
        mx = max(x[1] for x in sps)
        notes["speed_max"] = round(mx, 2)
        if mx <= 0.6:
            t.add("stationary")
        elif mx >= 25:
            t.add("fast")
    spr = [max(abs(v["Vector2"][0]), abs(v["Vector2"][1]))
           for L in pes for v in [L.get("props", {}).get("SpreadAngle")]
           if isinstance(v, dict) and "Vector2" in v]
    if spr:
        mx = max(spr)
        notes["spread_max"] = round(mx, 1)
        if mx >= 120:
            t.add("omnidirectional")
        elif mx <= 12:
            t.add("directional")
    acc = [v["Vector3"] for L in pes for v in [L.get("props", {}).get("Acceleration")]
           if isinstance(v, dict) and "Vector3" in v]
    if acc:
        if max(a[1] for a in acc) >= 8:
            t.add("rises")
        if min(a[1] for a in acc) <= -8:
            t.add("falls")
    dr = [d for d in (L.get("props", {}).get("Drag") for L in pes) if isinstance(d, (int, float))]
    if dr and max(dr) >= 4:
        t.add("high-drag")
    for L in pes:
        s = _seq(L.get("props", {}), "Size")
        if not s or len(s) < 2:
            continue
        first, last, peak = s[0][1], s[-1][1], max(k[1] for k in s)
        notes["size_peak"] = round(max(notes.get("size_peak", 0), peak), 3)
        if last > first * 1.6 and last >= peak * 0.85:
            t.add("expanding")
        elif first > last * 1.6:
            t.add("shrinking")
        t.add("large" if peak >= 12 else ("small" if peak <= 1.2 else "mid-size"))
    le = [x for x in (L.get("props", {}).get("LightEmission") for L in pes)
          if isinstance(x, (int, float))]
    if le and max(le) >= 0.6:
        t.add("glowing")
    if any(L.get("class") == "PointLight" for L in layers):
        t.add("casts-light")
    # colour, weighted by how visible the particle is at each keypoint
    acc2, w = [0.0, 0.0, 0.0], 0.0
    for L in layers:
        p = L.get("props", {})
        cs = p.get("Color")
        cs = cs["ColorSequence"] if isinstance(cs, dict) and "ColorSequence" in cs else None
        tr = _seq(p, "Transparency") or []
        if not cs:
            continue
        for tt, rgb in cs:
            a = 1.0
            if tr:
                a = max(0.0, 1.0 - min(tr, key=lambda k: abs(k[0] - tt))[1])
            for i in range(3):
                acc2[i] += rgb[i] * a
            w += a
    if w > 0:
        r, g, b = (c / w for c in acc2)
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        t.add("colour:" + hue_name(h * 360, s, v))
        notes["rgb"] = [round(r, 3), round(g, 3), round(b, 3)]
    if any(L.get("renders_in_place") is False for L in layers):
        t.add("needs-reparent")
    if any((L.get("emit") or {}).get("inferred") for L in layers):
        t.add("emit-inferred")
    return sorted(t), notes


def stage_values(lib):
    out = {}
    for f, rec in load_recipes(lib):
        tags, notes = value_tags(rec)
        out[f.name] = {"value_tags": tags, "metrics": notes}
    p = pathlib.Path(lib) / ".cache" / "value_tags.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"[values] {len(out)} recipes")


# ───────────────────────────────────────────────────────────── stage 3: sprite
def texture_layouts(lib):
    out = {}
    for _, r in load_recipes(lib):
        for L in r.get("layers", []):
            p = L.get("props", {})
            t = p.get("Texture")
            if not isinstance(t, str):
                continue
            m = re.search(r"(\d{5,})", t)
            if not m:
                continue
            fl, fm = p.get("FlipbookLayout"), p.get("FlipbookMode")
            n = GRID.get(fl.get("Enum") if isinstance(fl, dict) else "", 1)
            mode = ((fm.get("Enum") if isinstance(fm, dict) else "") or "").replace(
                "ParticleFlipbookMode.", "")
            prev = out.get(m.group(1))
            if prev is None or n > prev[0]:
                out[m.group(1)] = (n, mode)
    return out


def sprite_features(path, grid):
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255.0
    if grid > 1:
        H, W = a.shape[:2]
        ch, cw = H // grid, W // grid
        if ch >= 8 and cw >= 8:
            best, bs = None, -1
            for r in range(grid):
                for c in range(grid):
                    cell = a[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
                    s = float(cell[..., 3].sum())
                    if s > bs:
                        bs, best = s, cell
            a = best
    rgb, al = a[..., :3], a[..., 3]
    H, W = al.shape
    ink = al > 0.10
    cov = float(ink.mean())
    if cov < 0.005:
        return None
    ys, xs = np.nonzero(ink)
    cy, cx = ys.mean(), xs.mean()
    h2, w2 = H / 2.0, W / 2.0
    y0, x0 = ys - cy, xs - cx
    cxx, cyy, cxy = (x0 * x0).mean(), (y0 * y0).mean(), (x0 * y0).mean()
    tr, det = cxx + cyy, cxx * cyy - cxy * cxy
    d = max(tr * tr / 4 - det, 0.0)
    l1, l2 = tr / 2 + math.sqrt(d), tr / 2 - math.sqrt(d)
    elong = float(math.sqrt(max(l1, 1e-6) / max(l2, 1e-6)))
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt((yy - h2) ** 2 + (xx - w2) ** 2)
    rmax = min(h2, w2)
    prof = []
    for i in range(12):
        m = (r >= rmax * i / 12) & (r < rmax * (i + 1) / 12)
        prof.append(float(al[m].mean()) if m.any() else 0.0)
    inner, mid = float(np.mean(prof[:3])), float(np.mean(prof[4:8]))
    hollow = mid > inner * 1.6 and mid > 0.05
    ang = np.arctan2(yy - h2, xx - w2)
    radii = []
    for i in range(24):
        lo = -math.pi + 2 * math.pi * i / 24
        hi = -math.pi + 2 * math.pi * (i + 1) / 24
        m = ink & (ang >= lo) & (ang < hi)
        radii.append(float(r[m].max()) if m.any() else 0.0)
    radii = np.array(radii)
    spiky = float(radii.std() / (radii.mean() + 1e-6))
    gy, gx = np.gradient(al)
    sharp = float(np.sqrt(gy ** 2 + gx ** 2)[ink].mean())
    solid = al > 0.30
    if solid.sum() >= 12:
        px = rgb[solid]
        hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[:: max(1, len(px) // 4000)]])
        sat, sat90 = float(hsv[:, 1].mean()), float(np.percentile(hsv[:, 1], 90))
        hs = hsv[hsv[:, 1] > 0.25][:, 0]
        hue = float(np.median(hs) * 360) if len(hs) else -1.0
    else:
        sat = sat90 = 0.0
        hue = -1.0
    return dict(cov=round(cov, 4), elong=round(elong, 3), hollow=bool(hollow),
                spiky=round(spiky, 3), sharp=round(sharp, 4), sat=round(sat, 3),
                sat90=round(sat90, 3), hue=round(hue, 1), grid=grid)


def sprite_tags(f, mode=""):
    if f is None:
        return ["empty"]
    t = set()
    if f["grid"] > 1:
        t.add("flipbook")
        t.add("animated-loop" if mode == "Loop" else "animated-oneshot")
    if f["elong"] >= 2.4:
        t.add("streak")
    if f["hollow"]:
        t.add("ring")
    if f["spiky"] >= 0.32 and f["elong"] < 2.4:
        t.add("star")
    if f["sharp"] <= 0.022 and f["spiky"] < 0.26 and not f["hollow"]:
        t.add("soft")
    if f["sharp"] >= 0.06:
        t.add("crisp")
    if f["cov"] >= 0.40 and not f["hollow"]:
        t.add("dense")
    elif f["cov"] <= 0.05:
        t.add("wispy")
    if f["sat90"] >= 0.45 and f["sat"] >= 0.15:
        t.add("prebaked-colour")
        if f["hue"] >= 0:
            t.add("tex:" + hue_name(f["hue"]))
    else:
        t.add("tintable")
    if not t & {"streak", "ring", "star", "soft"}:
        t.add("blob")
    return sorted(t)


def stage_sprites(lib):
    tex = pathlib.Path(lib) / ".cache" / "tex"
    lay = texture_layouts(lib)
    out = {}
    files = sorted(tex.glob("*.png"))
    for i, p in enumerate(files):
        g, mode = lay.get(p.stem, (1, ""))
        try:
            f = sprite_features(p, g)
        except Exception:
            f = None
        out[p.stem] = {"features": f, "shape": sprite_tags(f, mode), "grid": g, "mode": mode}
        if (i + 1) % 400 == 0:
            print(f"  {i+1}/{len(files)}", flush=True)
    (pathlib.Path(lib) / ".cache" / "image_tags.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")
    print(f"[sprite] {len(out)} textures")


# ────────────────────────────────────────────────────────────── stage 4: index
NAME_CATS = {
    "explosion": r"explo|blast|boom|nuke|detonat|burst", "slash": r"slash|swing|\bcut\b|blade|sword|claw|katana|slice",
    "impact": r"impact|\bhit\b|smash|punch|kick|land|crater|stomp", "aura": r"aura|buff|charge|idle|halo|ambient|passive",
    "smoke": r"smoke|dust|\bfog\b|cloud|mist|steam", "fire": r"fire|flame|burn|ember|blaze|inferno|magma|lava",
    "lightning": r"lightn|elect|thunder|shock|volt|plasma", "water": r"water|splash|wave|bubble|liquid|rain",
    "ice": r"\bice\b|frost|snow|freeze|frozen|blizzard", "wind": r"wind|gust|tornado|vortex|cyclone",
    "magic": r"magic|arcane|rune|spell|sigil|summon|portal", "energy": r"energy|beam|laser|\bray\b|\borb\b|\bki\b",
    "shockwave": r"shockwave|ripple|dome|pulse", "trail": r"trail|streak|projectile|bullet|missile|arrow|comet",
    "heal": r"heal|regen|revive|bless|holy", "dark": r"dark|shadow|void|curse|demon|evil",
}
SHAPE_USE = {"ring": ["shockwave", "impact"], "streak": ["slash", "trail", "lightning"],
             "star": ["spark", "impact", "flash"], "soft": ["smoke", "aura", "glow"]}


def fingerprint(rec):
    import hashlib
    sig = []
    for L in sorted(rec.get("layers", []),
                    key=lambda x: x.get("class", "") + str(x.get("props", {}).get("Texture", ""))):
        sig.append(L.get("class", ""))
        sig.append(json.dumps(L.get("props", {}), sort_keys=True))
    return hashlib.sha1("|".join(sig).encode()).hexdigest()[:12]


def stage_index(lib):
    cache = pathlib.Path(lib) / ".cache"
    val = json.loads((cache / "value_tags.json").read_text(encoding="utf-8"))
    img = (json.loads((cache / "image_tags.json").read_text(encoding="utf-8")) if (cache / "image_tags.json").exists() else {})
    index, seen = {}, {}
    for f, rec in load_recipes(lib):
        v = val.get(f.name, {})
        tags = set(v.get("value_tags", []))
        shapes = set()
        for t in rec.get("texture_refs", []):
            m = re.search(r"(\d{5,})", t or "")
            if m and m.group(1) in img:
                shapes |= set(img[m.group(1)].get("shape", []))
        tags |= shapes
        hay = ((rec.get("name") or "") + " " + (rec.get("source_path") or "") + " "
               + " ".join(L.get("name", "") for L in rec.get("layers", []))).lower()
        named = {c for c, p in NAME_CATS.items() if re.search(p, hay)}
        tags |= {f"is:{c}" for c in named}
        hints = set()
        for s, uses in SHAPE_USE.items():
            if s in shapes:
                hints |= set(uses)
        tags |= {f"maybe:{h}" for h in hints - named}

        fp = fingerprint(rec)
        dupe = seen.get(fp)
        seen.setdefault(fp, f.name)
        sp = rec.get("source_path") or ""
        index[f.name] = {
            "name": rec.get("name"), "layers": len(rec.get("layers", [])),
            "duration": rec.get("duration"),
            "pack": sp.split(".")[1] if "." in sp else "",
            "textures": rec.get("texture_refs", []), "portable": rec.get("texture_portable"),
            "fingerprint": fp, "dupe_of": dupe,
            "tags": sorted(tags), "metrics": v.get("metrics", {}),
        }
    out = pathlib.Path(lib) / "index.json"
    out.write_text(json.dumps(index, indent=1), encoding="utf-8")
    uniq = len({e["fingerprint"] for e in index.values()})
    either = sum(1 for e in index.values()
                 if any(t.startswith("is:") for t in e["tags"])
                 or any(t in ("ring", "streak", "star", "soft", "blob") for t in e["tags"]))
    print(f"[index] {len(index)} recipes -> {out}")
    print(f"        {uniq} unique by content, {len(index)-uniq} duplicates flagged")
    print(f"        {either} ({100*either//len(index)}%) carry a shape or a named category")


def stage_sheet(lib, fam, n=24):
    from PIL import Image, ImageDraw
    cache = pathlib.Path(lib) / ".cache"
    img = (json.loads((cache / "image_tags.json").read_text(encoding="utf-8")) if (cache / "image_tags.json").exists() else {})
    tex = cache / "tex"
    keys = [k for k, v in img.items() if fam == "all" or fam in v["shape"]][:n]
    CELL, PAD, COLS, LAB = 128, 6, 8, 26
    rows = (len(keys) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * (CELL + PAD) + PAD, rows * (CELL + PAD + LAB) + PAD + 22),
                      (24, 26, 30))
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 6), f"{fam} ({len(keys)})", fill=(235, 235, 235))
    BORING = {"flipbook", "animated-oneshot", "animated-loop", "crisp", "tintable"}
    for i, k in enumerate(keys):
        r, c = divmod(i, COLS)
        x, y = PAD + c * (CELL + PAD), 22 + PAD + r * (CELL + PAD + LAB)
        d.rectangle([x, y, x + CELL, y + CELL], fill=(96, 100, 108))
        p = tex / f"{k}.png"
        if p.is_file():
            im = Image.open(p).convert("RGBA").resize((CELL, CELL), Image.LANCZOS)
            sheet.paste(im, (x, y), im)
        show = [t for t in img[k]["shape"] if t not in BORING] or ["-"]
        d.text((x + 1, y + CELL + 2), ",".join(show)[:30], fill=(210, 235, 210))
        d.text((x + 1, y + CELL + 13), k[:18], fill=(140, 145, 155))
    out = cache / f"sheet_{fam}.png"
    sheet.save(out)
    print(f"[sheet] {out}  ({len(keys)} cells) - LOOK AT IT")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True)
    ap.add_argument("--stage", choices=["fetch", "values", "sprites", "index", "all"],
                    default="all")
    ap.add_argument("--sheet", help="build an audit contact sheet for a shape family "
                                    "(ring/streak/star/soft/blob/all)")
    ap.add_argument("--n", type=int, default=24)
    a = ap.parse_args()
    if a.sheet:
        return stage_sheet(a.lib, a.sheet, a.n)
    if a.stage in ("fetch", "all"):
        stage_fetch(a.lib)
    if a.stage in ("values", "all"):
        stage_values(a.lib)
    if a.stage in ("sprites", "all"):
        stage_sprites(a.lib)
    if a.stage == "index" and not (pathlib.Path(a.lib) / ".cache" / "value_tags.json").exists():
        # first run on a new library: the index needs the value pass (offline, fast)
        print("no value tags yet - running the values stage first")
        stage_values(a.lib)
    if a.stage in ("index", "all"):
        stage_index(a.lib)


if __name__ == "__main__":
    main()
