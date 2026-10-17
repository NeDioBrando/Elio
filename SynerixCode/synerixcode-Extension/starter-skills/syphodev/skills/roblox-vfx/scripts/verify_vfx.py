#!/usr/bin/env python3
"""Check recipe JSON for defects that a screenshot will not show you.

This does NOT judge whether an effect looks good. Nothing here can. It catches
the failures that are invisible in a still: a truncated property set, an emitter
that is transparent for its whole life, a burst layer that also streams forever,
a texture path that renders as nothing.

Run --self-test to prove the checks can actually fail. A verifier that has never
been shown to fail is a verifier that says yes.
"""
import argparse
import copy
import json
import os
import pathlib
import sys

def default_lib():
    """Your recipe folder: --lib or the ROBLOX_VFX_LIB env var (see LOCAL.md)."""
    v = os.environ.get("ROBLOX_VFX_LIB")
    if not v and (pathlib.Path.home() / "Roblox-VFX-Library").is_dir():
        v = str(pathlib.Path.home() / "Roblox-VFX-Library")  # the setup skill's default
    if not v:
        sys.exit("no recipe library given: pass --lib <your VFX library folder> "
                 "or set ROBLOX_VFX_LIB (the path is in LOCAL.md)")
    p = pathlib.Path(v).expanduser()
    return p / "recipes" if (p / "recipes").is_dir() else p

# MEASURED in Studio 2026-08-26 by probing a live ParticleEmitter, not read off
# the docs. The MCP's generic property reader returns 6 of these 31.
PE_PROPS = {
    "Acceleration", "Brightness", "Color", "Drag", "EmissionDirection", "Enabled",
    "FlipbookFramerate", "FlipbookLayout", "FlipbookMode", "FlipbookStartRandom",
    "Lifetime", "LightEmission", "LightInfluence", "LockedToPart", "Orientation",
    "Rate", "RotSpeed", "Rotation", "Shape", "ShapeInOut", "ShapeStyle", "Size",
    "SpreadAngle", "Speed", "Squash", "Texture", "TimeScale", "Transparency",
    "VelocityInheritance", "ZOffset", "WindAffectsDrag",
}
LIGHT_PROPS = {"Brightness", "Color", "Enabled", "Range", "Shadows"}

# MEASURED by rendering each one, 2026-08-27. FIVE stock paths exist, not the
# three this file claimed until a real pack was harvested: the first pass only
# probed textures/particles/*.dds and never looked in textures/ itself, so two
# live paths were being hard-failed as nonexistent.
STOCK_TEXTURES = {
    "rbxasset://textures/particles/sparkles_main.dds",
    "rbxasset://textures/particles/fire_main.dds",
    "rbxasset://textures/particles/smoke_main.dds",
    "rbxasset://textures/explosion.png",   # puffy lit explosion cloud
    "rbxasset://textures/sparkle.png",     # hard 8-point star, dark rim
}

# MEASURED to render NOTHING despite looking exactly as plausible as the five
# above. textures/smoke.png is the trap: Roblox's OWN "Particle Effects" pack
# (228304820) ships a Smoke layer pointing at it, so a first-party pack contains
# a permanently invisible emitter. Named explicitly to make the failure legible
# rather than a generic "not in the stock set".
KNOWN_DEAD_TEXTURES = {
    "rbxasset://textures/smoke.png",
    "rbxasset://textures/fire.png",
    "rbxasset://textures/particle.png",
}

KNOWN_CLASSES = {"ParticleEmitter", "Beam", "Trail", "PointLight"}



def recipes_dir(p) -> pathlib.Path:
    """A library ROOT holds recipes/, index.json and harvested/; accept either it or recipes/."""
    p = pathlib.Path(p).expanduser().resolve()
    return p / "recipes" if (p / "recipes").is_dir() else p

def seq(props, key):
    v = props.get(key)
    if isinstance(v, dict) and "NumberSequence" in v:
        return v["NumberSequence"]
    return None


def check(recipe):
    """Return a list of (severity, message). severity in {'fail','warn'}."""
    out = []
    name = recipe.get("name", "<unnamed>")
    layers = recipe.get("layers") or []

    if not layers:
        out.append(("fail", f"{name}: no layers"))
        return out

    # One emitter is almost never an effect. Worth saying out loud.
    emitters = [L for L in layers if L.get("class") == "ParticleEmitter"]
    if len(emitters) == 1:
        out.append(("warn", f"{name}: a single ParticleEmitter rarely reads as an effect; "
                            "real ones layer a core, a body and sparks"))

    max_life = 0.0
    for L in layers:
        ln = f"{name}.{L.get('name','?')}"
        cls = L.get("class")
        props = L.get("props") or {}
        emit = L.get("emit") or {}

        if cls not in KNOWN_CLASSES:
            out.append(("fail", f"{ln}: unknown class {cls!r}"))
            continue

        if cls == "ParticleEmitter":
            missing = PE_PROPS - set(props)
            if missing:
                out.append(("fail", f"{ln}: {len(missing)} of {len(PE_PROPS)} properties missing "
                                    f"({', '.join(sorted(missing)[:6])}"
                                    f"{'...' if len(missing) > 6 else ''}) - harvested through a "
                                    "generic property reader instead of an explicit walk?"))

            tex = props.get("Texture")
            if not tex:
                out.append(("fail", f"{ln}: no Texture"))
            elif isinstance(tex, str) and tex in KNOWN_DEAD_TEXTURES:
                out.append(("fail", f"{ln}: {tex} renders as NOTHING (measured). It looks like a "
                                    "real path and Roblox's own packs ship it; this emitter costs "
                                    "budget and draws nothing"))
            elif isinstance(tex, str) and tex.startswith("rbxasset://") and tex not in STOCK_TEXTURES:
                out.append(("fail", f"{ln}: {tex} is not one of the {len(STOCK_TEXTURES)} stock "
                                    "textures measured to exist; a wrong rbxasset path renders as "
                                    "nothing, with no error"))

            rate = props.get("Rate")
            mode = emit.get("mode")
            if mode == "burst" and rate not in (0, 0.0):
                out.append(("fail", f"{ln}: burst layer has Rate={rate}; it will stream forever "
                                    "as well as bursting"))
            if mode == "continuous" and (rate in (0, 0.0) or rate is None):
                out.append(("fail", f"{ln}: continuous layer has Rate={rate}; it will never emit"))
            if mode == "burst" and not emit.get("count"):
                out.append(("fail", f"{ln}: burst layer has no emit count"))

            life = props.get("Lifetime", {}).get("NumberRange")
            if not life or life[0] <= 0 or life[1] < life[0]:
                out.append(("fail", f"{ln}: bad Lifetime {life}"))
            else:
                max_life = max(max_life, life[1])

            tr = seq(props, "Transparency")
            if tr is not None:
                if all(kp[1] >= 0.999 for kp in tr):
                    out.append(("fail", f"{ln}: Transparency is 1 across the whole life; "
                                        "this emitter costs budget and draws nothing"))
                if min(kp[1] for kp in tr) > 0.95:
                    out.append(("warn", f"{ln}: never gets more opaque than "
                                        f"{min(kp[1] for kp in tr):.2f}; may be invisible in play"))

            sz = seq(props, "Size")
            if sz is not None and all(kp[1] <= 0.0001 for kp in sz):
                out.append(("fail", f"{ln}: Size is 0 across the whole life"))

            for key in ("Size", "Transparency", "Squash"):
                s = seq(props, key)
                if s is None:
                    continue
                times = [kp[0] for kp in s]
                if abs(times[0]) > 1e-6 or abs(times[-1] - 1) > 1e-6:
                    out.append(("fail", f"{ln}.{key}: NumberSequence must span t=0..1, got "
                                        f"{times[0]}..{times[-1]}"))
                if any(b < a for a, b in zip(times, times[1:])):
                    out.append(("fail", f"{ln}.{key}: keypoint times are not ascending"))

        elif cls in ("Beam", "Trail"):
            eps = L.get("endpoints")
            if not eps or len(eps) != 2:
                out.append(("fail", f"{ln}: a {cls} needs two endpoints; without both "
                                    "attachments wired it builds fine and draws nothing"))
            elif any(e.get("missing") for e in eps):
                out.append(("warn", f"{ln}: an endpoint was unresolved in the source pack "
                                    "and got a default offset; check the length looks right"))

        elif cls == "PointLight":
            missing = LIGHT_PROPS - set(props)
            if missing:
                out.append(("fail", f"{ln}: missing light properties {sorted(missing)}"))
            if emit.get("mode") == "pulse" and not emit.get("from"):
                out.append(("fail", f"{ln}: pulse light has no peak brightness ('from')"))

    inferred = [L.get("name", "?") for L in layers if (L.get("emit") or {}).get("inferred")]
    if inferred:
        out.append(("warn", f"{name}: emit mode was INFERRED for {len(inferred)} layer(s) "
                            f"({', '.join(inferred[:4])}{'...' if len(inferred) > 4 else ''}). "
                            "A harvested pack records no burst window, so the counts are a guess. "
                            "Preview it before indexing."))

    stranded = [L.get("name", "?") for L in layers if L.get("renders_in_place") is False]
    if stranded:
        out.append(("warn", f"{name}: {len(stranded)} layer(s) were parented to a "
                            f"{layers[0].get('parent_class')} in the source pack "
                            f"({', '.join(stranded[:4])}), so they render NOTHING where they sit. "
                            "Harvested fine; rebuild puts them on a BasePart."))

    dur = recipe.get("duration")
    if dur is not None and max_life and dur < max_life:
        out.append(("warn", f"{name}: duration {dur}s is shorter than its longest particle "
                            f"life {max_life:.2f}s; previews will cut the tail off"))

    texs = recipe.get("texture_refs") or []
    portable = recipe.get("texture_portable")
    # No texture refs at all = nothing to depend on = portable. This used to be
    # hardcoded False, which made every textureless Beam fail against the sink's
    # (correct) all([]) == True.
    actually = all(t.startswith("rbxasset://") for t in texs)
    if portable is not None and portable != actually:
        out.append(("fail", f"{name}: texture_portable={portable} but refs say {actually}"))
    if texs and not actually:
        out.append(("warn", f"{name}: depends on non-stock texture assets; these may not render "
                            "in another place or for another owner"))
    return out


def run(paths, quiet=False):
    fails = warns = 0
    clean = 0
    for p in paths:
        rec = json.loads(p.read_text(encoding="utf-8"))
        res = check(rec)
        f = sum(1 for s, _ in res if s == "fail")
        w = len(res) - f
        fails += f
        warns += w
        status = "FAIL" if f else ("warn" if w else "ok")
        if status == "ok":
            clean += 1
        if quiet and status != "FAIL":
            continue
        print(f"[{status:4s}] {p.name}  ({len(rec.get('layers', []))} layers)")
        for sev, msg in res:
            if quiet and sev != "fail":
                continue
            print(f"         {sev}: {msg}")
    print(f"\n{len(paths)} recipe(s): {clean} clean, {fails} failure(s), {warns} warning(s)")
    return 1 if fails else 0


SABOTAGES = [
    ("drop 5 properties",
     lambda r: [r["layers"][0]["props"].pop(k, None)
                for k in ("Rate", "Speed", "Drag", "Texture", "Lifetime")]),
    # Must set BOTH, or on a continuous layer a nonzero Rate is simply correct
    # and there is nothing for the check to find.
    ("burst layer that also streams",
     lambda r: (r["layers"][0]["props"].__setitem__("Rate", 25),
                r["layers"][0].__setitem__("emit", {"mode": "burst", "count": 12}))),
    ("continuous layer that never emits",
     lambda r: (r["layers"][0]["props"].__setitem__("Rate", 0),
                r["layers"][0].__setitem__("emit", {"mode": "continuous"}))),
    ("texture path that does not exist",
     lambda r: r["layers"][0]["props"].__setitem__(
         "Texture", "rbxasset://textures/particles/explosion01_smoke1.dds")),
    ("plausible path measured to render nothing",
     lambda r: r["layers"][0]["props"].__setitem__(
         "Texture", "rbxasset://textures/smoke.png")),
    ("fully transparent emitter",
     lambda r: r["layers"][0]["props"].__setitem__(
         "Transparency", {"NumberSequence": [[0, 1, 0], [1, 1, 0]]})),
    ("sequence that does not span 0..1",
     lambda r: r["layers"][0]["props"].__setitem__(
         "Size", {"NumberSequence": [[0.2, 1, 0], [0.8, 2, 0]]})),
    ("negative lifetime",
     lambda r: r["layers"][0]["props"].__setitem__("Lifetime", {"NumberRange": [-1, 0]})),
    ("portability flag lying about the refs",
     lambda r: (r.__setitem__("texture_refs", ["rbxassetid://12345"]),
                r.__setitem__("texture_portable", True))),
    ("unknown layer class",
     lambda r: r["layers"][0].__setitem__("class", "Sparkles")),
]


def _demo_recipe():
    """A minimal valid recipe, built in code, for --self-test.

    No effects ship with this skill, so the self-test cannot borrow one from a
    library. It needs a baseline that passes every check, so each sabotage proves
    one check can fail."""
    tex = "rbxasset://textures/particles/sparkles_main.dds"
    props = {k: 0 for k in PE_PROPS}
    props.update({
        "Texture": tex,
        "Rate": 0,
        "Lifetime": {"NumberRange": [0.5, 1.0]},
        "Transparency": {"NumberSequence": [[0, 0, 0], [1, 1, 0]]},
        "Size": {"NumberSequence": [[0, 1, 0], [1, 0.2, 0]]},
        "Squash": {"NumberSequence": [[0, 0, 0], [1, 0, 0]]},
        "Enabled": False,
    })
    layer = {"name": "Core", "class": "ParticleEmitter", "offset": [0, 0, 0],
             "emit": {"mode": "burst", "count": 12}, "props": props}
    return {"name": "SelfTestDemo", "duration": 1.5, "texture_portable": True,
            "texture_refs": [tex], "layers": [layer, json.loads(json.dumps(layer))]}


def self_test():
    base = _demo_recipe()

    clean = check(base)
    clean_fails = [m for s, m in clean if s == "fail"]
    print(f"baseline {base['name']}: {len(clean_fails)} failure(s)")
    if clean_fails:
        for m in clean_fails:
            print(f"   fail: {m}")
        print("SELF-TEST INVALID: baseline recipe does not pass")
        return 1

    bad = 0
    for label, mutate in SABOTAGES:
        r = copy.deepcopy(base)
        # sabotage the first ParticleEmitter, not whatever is at index 0
        i = next(i for i, L in enumerate(r["layers"]) if L["class"] == "ParticleEmitter")
        r["layers"][0], r["layers"][i] = r["layers"][i], r["layers"][0]
        mutate(r)
        res = [m for s, m in check(r) if s == "fail"]
        ok = bool(res)
        print(f"  [{'caught' if ok else 'MISSED'}] {label}")
        if ok:
            print(f"            -> {res[0]}")
        else:
            bad += 1
    print(f"\nself-test: {len(SABOTAGES) - bad}/{len(SABOTAGES)} sabotages caught")
    return 1 if bad else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("recipes", nargs="*")
    ap.add_argument("--self-test", action="store_true")
    # Your harvested library lives OUTSIDE the skill directory, so updating or
    # sharing the skill can never carry an extracted pack with it.
    ap.add_argument("--lib", default=None,
                    help="recipe directory (default: $ROBLOX_VFX_LIB, your own library)")
    ap.add_argument("--quiet", action="store_true",
                    help="one line per recipe, failures only")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())
    lib = recipes_dir(a.lib) if a.lib else default_lib()
    paths = [pathlib.Path(x) for x in a.recipes] or sorted(lib.glob("*.json"))
    if not paths:
        print(f"no recipes found in {lib}")
        sys.exit(1)
    sys.exit(run(paths, quiet=a.quiet))
