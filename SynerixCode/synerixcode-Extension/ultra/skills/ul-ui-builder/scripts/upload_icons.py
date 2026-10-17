"""Upload a folder of cut-out icons and record the asset ids.

    python upload_icons.py --icons <project>/icons --map <project>/icons.json

Writes {"coin": 1234567890, ...}. The map is a CACHE keyed by the file's
content hash, so re-running after a reroll uploads ONLY the icons that changed.
Roblox has no delete for uploaded assets, so every needless upload is permanent
clutter on the account.

TWO THINGS THAT WILL BITE

1. UPLOAD AS `Image`, NEVER `Decal`. Both succeed, both come back Approved, and
   only one works: a Decal asset WRAPS an image and carries a DIFFERENT id, so
   assigning a Decal id renders nothing with no error anywhere. Measured in practice. This script does not offer Decal.

2. A FRESH UPLOAD COMES BACK `moderationState: Reviewing`, and an image still in
   review can render as blank. So if a Studio screenshot shows an empty icon
   slot, check the moderation state before assuming the UI is wrong - that is a
   wait, not a bug.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UPLOADER = HERE.parent.parent / "ul-3d-model" / "scripts" / "upload_asset.py"


def digest(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--icons", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--prefix", default="UI")
    ap.add_argument("--only", default=None)
    args = ap.parse_args()

    icons = sorted(Path(args.icons).glob("*.png"))
    if not icons:
        raise SystemExit(f"no icons in {args.icons}")

    map_path = Path(args.map)
    state = json.loads(map_path.read_text()) if map_path.exists() else {}
    hashes = state.get("_hashes", {})
    ids = {k: v for k, v in state.items() if not k.startswith("_")}

    wanted = {n.strip() for n in args.only.split(",")} if args.only else None
    todo = [p for p in icons
            if (wanted is None or p.stem in wanted)
            and hashes.get(p.stem) != digest(p)]

    print(f"{len(icons)} icons, {len(todo)} to upload "
          f"({len(icons) - len(todo)} already current)")

    for i, p in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {p.stem}", flush=True)
        out = subprocess.run(
            [sys.executable, str(UPLOADER), "--file", str(p),
             "--name", f"{args.prefix}_{p.stem}", "--asset-type", "Image"],
            capture_output=True, text=True)
        line = next((l for l in out.stdout.splitlines() if "assetId=" in l), None)
        if not line:
            print(f"    FAILED: {(out.stderr or out.stdout).strip()[-300:]}")
            continue
        asset_id = int(line.split("assetId=")[1].split()[0])
        ids[p.stem] = asset_id
        hashes[p.stem] = digest(p)
        print(f"    {asset_id}")
        # Write after EVERY upload. A crash at icon 30 of 38 must not lose the
        # first 29, because there is no way to delete the duplicates a rerun makes.
        map_path.write_text(json.dumps({**ids, "_hashes": hashes}, indent=2))

    map_path.write_text(json.dumps({**ids, "_hashes": hashes}, indent=2))
    missing = [p.stem for p in icons if p.stem not in ids]
    print(f"\n{len(ids)} icons mapped -> {map_path}")
    if missing:
        print(f"MISSING: {missing}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
