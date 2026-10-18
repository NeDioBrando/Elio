"""One command from a spec to a map Studio can build. The runbook, as code.

    python scripts/build_map.py <spec.json> [--out work/map] [--serve] [--asset-ids ids.json]

WHY. A map built by hand-running several scripts in an order that lives only in
the conversation gets steps run stale or skipped. SKILL.md "THE PIPELINE MUST
LIVE IN FILES" - so the order lives here:

  1. prove      prove.py - every P check, plus the T checks on a terrain map;
                any FAIL stops here (the report is written as JSON)
  2. plan       plan.py - the annotated top-down plan PNG
  3. terrain    terrain.py - heightfield, material map and preview (terrain maps)
  4. serve      serve_map.py, with the asset ids (with --serve)

Then in Studio, run each through execute_luau, in this order:
  bootstrap (scripts/luau/build.lua, printed below)  parts, meshes, spawns, kill plane;
                       removes the place's template SpawnLocation and Baseplate
  /build_terrain.lua   terrain voxels, caves, water   (terrain maps; background, poll attributes)
  /horizon_ocean.lua   the ocean ring past the map edge (terrain maps with water)
  /tide.lua            tide runtime                    (terrain maps with a tide)
Then PROVE THE SPAWN: luau/spawn_probe.server.lua as a ServerScriptService Script,
start a playtest, read the SPAWN_PROBE lines, stop.
Then CHECK THE PLACE: luau/verify_build.lua, luau/verify_ground.lua, luau/verify_placement.lua.
Then LOOK: capture_receiver.py + luau/capture_views.lua.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
sys.path.insert(0, HERE)

LOADER = ('local H = game:GetService("HttpService")\n'
          'return loadstring(H:GetAsync("http://127.0.0.1:{port}{path}"))()')


def run(cmd, stop_on_fail=True):
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, text=True)
    if r.returncode != 0 and stop_on_fail:
        raise SystemExit(f"step failed ({r.returncode}): {' '.join(cmd[1:3])}")
    return r.returncode


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--out", help="output folder (default: work/<map name> beside the spec's folder)")
    ap.add_argument("--serve", action="store_true", help="serve the map to Studio after a clean prove")
    ap.add_argument("--asset-ids", help="JSON {meshName: assetId} for the meshes the spec places")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--seconds", type=int, default=3000)
    ap.add_argument("--res", type=float, default=4.0, help="prover sampling resolution in studs")
    a = ap.parse_args(argv)

    import spec as specmod
    spec_path = a.spec if os.path.exists(a.spec) else os.path.join(SKILL, "specs", f"{a.spec}.json")
    spec_path = os.path.abspath(spec_path)
    raw = specmod.load_spec(spec_path)
    name = raw.get("name", "map")
    out = os.path.abspath(a.out or os.path.join(os.path.dirname(raw["__dir__"]), "work", name))
    os.makedirs(out, exist_ok=True)
    py = sys.executable

    report = os.path.join(out, "report.json")
    rc = run([py, os.path.join(HERE, "prove.py"), spec_path, "--res", str(a.res), "--json", report],
             stop_on_fail=False)
    if not os.path.isfile(report):
        raise SystemExit("prove could not run - read the error above")
    with open(report, encoding="utf-8") as f:
        result = json.load(f)["result"]
    print(f"prove: {result} -> {report}")

    run([py, os.path.join(HERE, "plan.py"), spec_path, "--prove", "-o", os.path.join(out, "plan.png")])
    if raw.get("terrain"):
        run([py, os.path.join(HERE, "terrain.py"), spec_path, "--out", os.path.join(out, "terrain")])

    if rc != 0 and result == "FAIL":
        raise SystemExit("prove FAILED - fix the spec before building (read the report above)")

    if a.serve:
        print("\nIn Studio, run the bootstrap first, then each loader through execute_luau:")
        print("--- bootstrap: python scripts/serve_map.py <spec> --print-bootstrap prints it; "
              "it is scripts/luau/build.lua with the port filled in")
        if raw.get("terrain"):
            for path in ("/build_terrain.lua", "/horizon_ocean.lua", "/tide.lua"):
                print(f"--- {path}\n" + LOADER.format(port=a.port, path=path))
        cmd = [py, os.path.join(HERE, "serve_map.py"), spec_path, "--port", str(a.port),
               "--seconds", str(a.seconds), "--print-bootstrap"]
        if a.asset_ids:
            cmd += ["--asset-ids", a.asset_ids]
        run(cmd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
