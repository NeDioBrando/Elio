"""Measure every <asset>/out/low.glb of a batch against its brief, in one table.

    python measure_set.py --outdir work/set --manifest design/meshes.json [--json out.json]

WHY: mesh_pipeline's report.json measures the HIGH poly before decimation, and
a single collapse pass can silently miss a small budget (Crumb asked 300, got
666; GrassClump asked 120, got 372, and shrank 25% in span). This reads the
files that actually ship (via glb_tool.py) and flags, per asset:
  OVER   tris above the manifest budget ("tris")
  SPAN   longest axis more than 2% off the briefed "studs"
  OPEN   boundary edges (Roblox renders single-sided: an open edge is a hole)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def measure(glb: Path) -> dict:
    out = subprocess.run([sys.executable, str(HERE / "glb_tool.py"), "measure",
                          "--glb", str(glb), "--json"], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr)
    return json.loads(out.stdout)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    outdir = Path(a.outdir)
    assets = json.loads(Path(a.manifest).read_text(encoding="utf-8"))["assets"]
    rows, bad = {}, 0
    print(f"{'asset':16}{'budget':>7}{'tris':>6}{'long':>8}{'brief':>7}{'drift%':>7}  "
          f"{'bounds XYZ (Y up)':26}{'open':>5}  flags")
    for asset in assets:
        n = asset["name"]
        glb = outdir / n / "out" / "low.glb"
        if not glb.exists():
            print(f"{n:16}  -- no low.glb")
            continue
        r = measure(glb)
        drift = 100 * (r["longest_studs"] - asset["studs"]) / asset["studs"]
        flags = []
        if r["tris"] > asset.get("tris", 10 ** 9):
            flags.append("OVER")
        if abs(drift) > 2:
            flags.append("SPAN")
        if r["boundary_edges"]:
            flags.append("OPEN")
        bad += bool({"OVER", "SPAN"} & set(flags))
        rows[n] = {**r, "briefed_studs": asset["studs"], "budget_tris": asset.get("tris"),
                   "span_drift_pct": round(drift, 2), "flags": flags}
        print(f"{n:16}{asset.get('tris', 0):>7}{r['tris']:>6}{r['longest_studs']:>8}"
              f"{asset['studs']:>7}{drift:>7.2f}  {str(r['bounds_studs_xyz_roblox']):26}"
              f"{r['boundary_edges']:>5}  {' '.join(flags)}")
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=1), encoding="utf-8")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
