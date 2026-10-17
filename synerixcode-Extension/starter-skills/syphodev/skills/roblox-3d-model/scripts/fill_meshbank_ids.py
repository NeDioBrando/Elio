#!/usr/bin/env python3
"""Fill MeshBank.luau's pending meshId placeholders from ids read in Studio.

THE DEFECT THIS EXISTS FOR (2026-09-18, an incremental game build, section 3).

A Roblox mesh asset uploads as a `Model`, and the id Open Cloud hands back is
the MODEL's id. `AssetService:CreateMeshPartAsync` does not accept it - it wants
the id of the MESH INSIDE that model, which is a different number and can only
be read by inserting the model once in a Studio session. So a mesh stage that
runs entirely headlessly CANNOT finish its own bank: it has to leave the meshId
pending and someone with Studio has to resolve it.

Two things went wrong on the run that produced this script, and both are cheap
to prevent:

1. The bank was written with `meshId = ""` on the first pass. An empty MeshId
   renders as NOTHING, which looks exactly like finished art that happens to be
   invisible - the same failure as the three empty ImageLabels that once shipped
   green. Placeholders must be loud and impossible, e.g.
   "MESHID_PENDING_STUDIO_INSERT::<name>", so that a miss is obvious in a grep.

2. The ids were resolved and filled in, and then the mesh worker REGENERATED
   MeshBank.luau to add one more asset - silently reverting all eight fills.
   Nothing failed; the gates stayed green; the bank simply went back to
   placeholders. Always re-grep for pending rows after any regeneration, which
   is what this script's non-zero exit is for.

Resolve the ids in Studio with one call (returns a table - do NOT go looking in
the viewport, that costs images and answers nothing):

    local HttpService, InsertService = game:GetService("HttpService"), game:GetService("InsertService")
    local models = { MyMesh = 1234567890 }        -- name -> MODEL id
    local out = {}
    for name, id in models do
        local model = InsertService:LoadAsset(id)
        for _, d in model:GetDescendants() do
            if d:IsA("MeshPart") then
                out[name] = { meshId = d.MeshId, textureId = d.TextureID, size = tostring(d.Size) }
                break
            end
        end
        model:Destroy()
    end
    return HttpService:JSONEncode(out)

Save that JSON and run:

    python fill_meshbank_ids.py --bank src/shared/Config/MeshBank.luau \\
                               --ids work/meshes/_meshids.json

Exits non-zero if ANY row is still pending afterwards, because a partially
filled bank is the state that ships invisible meshes.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

PENDING = re.compile(r"MESHID_PENDING_STUDIO_INSERT::(\w+)")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--bank", required=True, type=pathlib.Path, help="MeshBank.luau, edited in place")
    ap.add_argument("--ids", required=True, type=pathlib.Path, help="JSON from the Studio probe: name -> {meshId, ...}")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    text = args.bank.read_bytes().decode("utf-8")

    filled, missing = [], []
    for name, row in sorted(ids.items()):
        mesh_id = (row.get("meshId") if isinstance(row, dict) else row) or ""
        mesh_id = str(mesh_id).strip()
        if not mesh_id or "PENDING" in mesh_id:
            missing.append(f"{name} (probe returned no meshId)")
            continue
        if not mesh_id.startswith("rbxassetid://"):
            mesh_id = f"rbxassetid://{mesh_id}"

        needle = f'meshId = "MESHID_PENDING_STUDIO_INSERT::{name}"'
        if needle not in text:
            # Either already filled or the name does not match a bank row. Say
            # which, rather than reporting a clean run over a silent mismatch.
            if f'["{name}"]' in text:
                filled.append(f"{name} (already filled)")
            else:
                missing.append(f"{name} (no such row in the bank)")
            continue
        text = text.replace(needle, f'meshId = "{mesh_id}"')
        filled.append(name)

    remaining = sorted(set(PENDING.findall(text)))

    print(f"bank: {args.bank}")
    for name in filled:
        print(f"  filled  {name}")
    for name in missing:
        print(f"  MISS    {name}")

    if args.dry_run:
        print("\ndry run: no file written")
    else:
        # Bytes, never text: a text-mode write on Windows rewrites every line
        # ending as CRLF and turns a one-line edit into a whole-file diff that
        # the format gate then rejects.
        args.bank.write_bytes(text.encode("utf-8"))

    if remaining:
        print(f"\nFAIL: still pending: {', '.join(remaining)}", file=sys.stderr)
        print("A partially filled bank ships invisible meshes with every gate green.", file=sys.stderr)
        return 1

    print("\nno pending meshIds remain")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
