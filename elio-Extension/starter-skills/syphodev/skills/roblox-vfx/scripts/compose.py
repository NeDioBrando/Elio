#!/usr/bin/env python3
"""Assemble a COMPOSITION payload: codec + scene body + every recipe it names.

A composition is the layer the skill was missing. `payload.py build` puts ONE
harvested recipe on ONE part; a real effect - "orb forms in the hand, swells,
pulses, releases" - is a timeline over several recipes plus geometry that no
particle system expresses. This resolves the recipe references, inlines them,
and hands Studio a single self-contained payload.

    python compose.py my_effect.json --lib DIR --freeze 0.45 \
        --target Workspace.__VFXStage --out work/s.lua
"""
import argparse
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import payload as P  # noqa: E402


def default_lib() -> pathlib.Path:
    """Your own recipe folder: --lib, or the ROBLOX_VFX_LIB env var (see LOCAL.md).

    No effects ship with this skill, so there is no built-in library to fall back
    to. If the library folder has a recipes/ subfolder, that is what is used."""
    v = os.environ.get("ROBLOX_VFX_LIB")
    if not v and (pathlib.Path.home() / "Roblox-VFX-Library").is_dir():
        v = str(pathlib.Path.home() / "Roblox-VFX-Library")  # the setup skill's default
    if not v:
        raise SystemExit("no recipe library given: pass --lib <your VFX library folder> "
                         "or set ROBLOX_VFX_LIB (the path is in LOCAL.md)")
    p = pathlib.Path(v).expanduser()
    return p / "recipes" if (p / "recipes").is_dir() else p



def recipes_dir(p) -> pathlib.Path:
    """A library ROOT holds recipes/, index.json and harvested/; accept either it or recipes/."""
    p = pathlib.Path(p).expanduser().resolve()
    return p / "recipes" if (p / "recipes").is_dir() else p

def resolve_recipes(comp, libs):
    """Every element with kind=recipe names a file; inline the JSON by name."""
    # beam elements name a recipe too: one of its Beam layers, wired by the engine
    want = sorted({e["recipe"] for e in comp["elements"] if e.get("kind") in ("recipe", "beam", "chain")})
    out = {}
    for name in want:
        found = None
        for lib in libs:
            for cand in (lib / name, lib / f"{name}.json", lib / "recipes" / f"{name}.json"):
                if cand.is_file():
                    found = cand
                    break
            if found:
                break
        if not found:
            raise SystemExit(f"composition names recipe '{name}' - not found under {[str(x) for x in libs]}")
        rec = json.loads(found.read_text(encoding="utf-8"))
        out[name] = rec
    return out


def check(comp, recipes):
    """Catch the composition-authoring slips that read as 'nothing happened'."""
    ids = {e["id"] for e in comp["elements"]}
    problems = []
    if len(ids) != len(comp["elements"]):
        problems.append("duplicate element ids")
    for c in comp["timeline"]:
        if c["id"] not in ids:
            problems.append(f"cue targets unknown element '{c['id']}'")
    for e in comp["elements"]:
        if e.get("kind") == "beam":
            # The engine wires ONE Beam layer between two points. A non-Beam
            # layer here builds nothing, silently, so catch it before Studio.
            rec = recipes[e["recipe"]]
            want = str(e.get("layer", "#1"))
            if want.startswith("#"):
                i = int(want[1:])
                L = rec["layers"][i - 1] if 1 <= i <= len(rec["layers"]) else None
            else:
                L = next((x for x in rec["layers"] if x["name"] == want), None)
            if L is None or L.get("class") != "Beam":
                problems.append(f"{e['id']}: beam layer {want} of '{e['recipe']}' is not a Beam")
            if not any(c["id"] == e["id"] and c["act"] in ("enable", "show")
                       for c in comp["timeline"]):
                problems.append(f"{e['id']}: beam with no enable/show cue - it will never draw")
            continue
        if e.get("kind") not in ("recipe", "chain"):
            continue
        rec = recipes[e["recipe"]]
        names = [L["name"] for L in rec["layers"]]
        # Resolve the selection exactly as scene.lua does, so the count printed
        # here is the count that will be built. Selection is BY NAME; "#n" is
        # by-index. Sharing one namespace silently over-selects, because pack
        # layers are routinely NAMED "1".."9".
        sel = e.get("layers")
        if sel is not None:
            hit = set()
            for L in sel:
                s = str(L)
                if s.startswith("#"):
                    i = int(s[1:])
                    if not (1 <= i <= len(names)):
                        problems.append(f"{e['id']}: '{e['recipe']}' has no layer #{i} "
                                        f"({len(names)} layers)")
                    else:
                        hit.add(i)
                elif s in names:
                    for i, n in enumerate(names, 1):
                        if n == s:
                            hit.add(i)
                else:
                    problems.append(f"{e['id']}: recipe '{e['recipe']}' has no layer "
                                    f"'{s}' (has {names})")
            live = [i for i in hit
                    if rec["layers"][i - 1]["class"] not in ("Beam", "Trail")
                    or rec["layers"][i - 1].get("endpoints")]
            dead = len(hit) - len(live)
            if dead:
                problems.append(f"{e['id']}: {dead} selected layer(s) are Beam/Trail with no "
                                f"endpoints block - they cannot be wired and would draw nothing")
            if not live:
                problems.append(f"{e['id']}: selection resolves to ZERO buildable layers")
        # An emit cue on an element whose layers are all continuous, or no cue at
        # all on a burst element, is the silent way a composition does nothing.
        cued = [c for c in comp["timeline"] if c["id"] == e["id"]
                and c["act"] in ("emit", "enable", "show")]
        if not cued:
            problems.append(f"{e['id']}: recipe element with no emit/enable cue - it will never fire")
    return problems


SABOTAGE = [
    ("cue targets an element that does not exist",
     lambda c: c["timeline"].append({"t": 0, "id": "no_such_element", "act": "emit"})),
    ("two elements share an id",
     lambda c: c["elements"].append(dict(c["elements"][0]))),
    ("layer name that is not in the recipe",
     lambda c: _first_recipe(c).__setitem__("layers", ["NotARealLayerName"])),
    ("layer index past the end of the recipe",
     lambda c: _first_recipe(c).__setitem__("layers", ["#999"])),
    ("recipe element with no emit/enable cue - it would never fire",
     lambda c: c["timeline"].__setitem__(
         slice(None), [q for q in c["timeline"]
                       if not (q["id"] == _first_recipe(c)["id"]
                               and q["act"] in ("emit", "enable", "show"))])),
    ("selection resolves to zero buildable layers",
     lambda c: _first_recipe(c).__setitem__("layers", [])),
]


def _first_recipe(comp):
    for e in comp["elements"]:
        if e.get("kind") == "recipe":
            return e
    raise SystemExit("self-test needs a composition with a recipe element")


def self_test(path, libs):
    """Prove the checks can FAIL. A checker nobody has seen reject anything is a
    checker that says yes - the same reason verify_vfx.py ships --self-test."""
    base = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    recipes = resolve_recipes(base, libs)
    clean = check(json.loads(json.dumps(base)), recipes)
    if clean:
        print(f"BASELINE NOT CLEAN ({len(clean)} problems) - fix those first:")
        for c in clean:
            print("   " + c)
        return 1
    print(f"baseline {pathlib.Path(path).name}: clean")
    caught = 0
    for label, break_it in SABOTAGE:
        comp = json.loads(json.dumps(base))
        try:
            break_it(comp)
            probs = check(comp, resolve_recipes(comp, libs))
        except SystemExit as e:
            probs = [str(e)]
        ok = bool(probs)
        caught += ok
        print(f"  [{'CAUGHT ' if ok else 'MISSED!'}] {label}")
        if not ok:
            print("            -> the check for this does not work")
    print(f"{caught}/{len(SABOTAGE)} sabotages caught")
    return 0 if caught == len(SABOTAGE) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("composition")
    ap.add_argument("--lib", action="append", default=[],
                    help="library dir(s) to resolve recipe names against; repeatable")
    ap.add_argument("--target", default="Workspace.__VFXStage",
                    help="the STAGE folder holding the named anchor parts")
    ap.add_argument("--freeze", type=float, default=-1,
                    help="play to this time then TimeScale=0 everything. -1 = play through")
    ap.add_argument("--out")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the checks can fail, by sabotaging this composition")
    a = ap.parse_args()

    if a.self_test:
        libs = [recipes_dir(x) for x in a.lib] or [default_lib()]
        raise SystemExit(self_test(a.composition, libs))
    if not a.out:
        ap.error("--out is required unless --self-test is given")

    comp = json.loads(pathlib.Path(a.composition).read_text(encoding="utf-8"))
    libs = [recipes_dir(x) for x in a.lib] or [default_lib()]
    recipes = resolve_recipes(comp, libs)
    problems = check(comp, recipes)
    if problems:
        for p in problems:
            print(f"  FAIL {p}", file=sys.stderr)
        raise SystemExit(f"{len(problems)} problem(s) in {a.composition}")

    comp["recipes"] = recipes
    code = P.build("scene", {
        "COMP_JSON": json.dumps(comp),
        "TARGET_PATH": a.target,
        "FREEZE_AT": repr(a.freeze),
    })
    pathlib.Path(a.out).write_text(code, encoding="utf-8")
    layers = sum(len(r["layers"]) for r in recipes.values())
    used = sum(len(e.get("layers", recipes[e["recipe"]]["layers"]))
               for e in comp["elements"] if e.get("kind") == "recipe")
    print(f"{a.out}  {len(code)} chars  elements={len(comp['elements'])} "
          f"cues={len(comp['timeline'])} recipes={len(recipes)} layers={used}/{layers} "
          f"freeze={a.freeze}")


if __name__ == "__main__":
    main()
