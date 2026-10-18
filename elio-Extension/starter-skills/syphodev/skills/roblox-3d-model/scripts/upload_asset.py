"""Stage 5: upload a mesh or texture to Roblox through Open Cloud.

    python scripts/upload_asset.py --file work/out/low.glb  --name Revolver        --asset-type Model
    python scripts/upload_asset.py --file work/out/color.png  --name Revolver_Tex  --asset-type Image

Environment:
    ROBLOX_API_KEY   an Open Cloud key with Assets write
    ROBLOX_USER_ID   or ROBLOX_GROUP_ID, the creator the asset is filed under

TWO TRAPS THIS SCRIPT EXISTS TO PREVENT.

1. The Assets API `Mesh` type takes Roblox-native content only. A .glb or .fbx
   goes up as `Model`. Send a .glb as `Mesh` and the API answers with something
   that reads like a permissions failure, so the next hour goes into rotating
   API keys instead of changing one string.

2. FOR A TEXTURE, UPLOAD AS `Image`, NOT `Decal`. Both succeed, both come back
   Approved, and only one works. A Decal asset WRAPS an image and carries a
   DIFFERENT id from the image inside it, so assigning a Decal id to
   `MeshPart.TextureID` silently does nothing and the model renders untextured
   grey. Measured 2026-08-26: a Decal id left the pig grey, while the Image
   id from the same PNG textured it correctly. There is no error to
   read; the only symptom is a grey model.

A 200 on the POST means the job was ACCEPTED, not finished. The asset id only
exists once the operation completes, so this polls rather than reporting success
off the first response.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

ASSETS_URL = "https://apis.roblox.com/assets/v1/assets"
OPERATION_URL = "https://apis.roblox.com/assets/v1/operations/{op}"

# Content types Roblox accepts, by extension. Sending the wrong one is another
# failure that surfaces as a vague 400.
CONTENT_TYPES = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".fbx": "model/fbx",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
}

MESH_REFUSAL = (
    "assetType 'Mesh' takes Roblox-native content only. A .glb/.gltf/.fbx uploads "
    "as 'Model'. Roblox reports this mismatch in a way that looks like a "
    "permissions error, which is exactly why this script refuses it up front."
)


def upload(path: Path, name: str, asset_type: str, description: str,
           api_key: str, creator: dict, expected_price: int | None) -> str:
    suffix = path.suffix.lower()
    if asset_type == "Mesh":
        raise SystemExit(MESH_REFUSAL)
    if asset_type == "Model" and suffix not in (".glb", ".gltf", ".fbx"):
        raise SystemExit(f"assetType Model expects .glb/.gltf/.fbx, got {suffix}")
    if suffix not in CONTENT_TYPES:
        raise SystemExit(f"no content type known for {suffix}")

    request = {
        "assetType": asset_type,
        "displayName": name,
        "description": description,
        "creationContext": {"creator": creator},
    }
    if expected_price is not None:
        request["creationContext"]["expectedPrice"] = expected_price

    files = {
        "request": (None, json.dumps(request), "application/json"),
        "fileContent": (path.name, path.read_bytes(), CONTENT_TYPES[suffix]),
    }

    resp = requests.post(ASSETS_URL, headers={"x-api-key": api_key}, files=files, timeout=180)
    if resp.status_code >= 400:
        hint = ""
        if resp.status_code in (401, 403):
            hint = ("\nHINT: a 401/403 here is as often a wrong assetType as a wrong "
                    "key. Confirm assetType before touching the key.")
        raise SystemExit(f"upload failed {resp.status_code}: {resp.text}{hint}")

    body = resp.json()
    op = body.get("operationId") or body.get("path", "").rsplit("/", 1)[-1]
    if not op:
        raise SystemExit(f"no operation id in response: {body}")
    return op


def poll(op: str, api_key: str, timeout_s: int = 300) -> dict:
    """Wait for the operation, because acceptance is not completion."""
    deadline = time.time() + timeout_s
    delay = 2.0
    while time.time() < deadline:
        resp = requests.get(OPERATION_URL.format(op=op),
                            headers={"x-api-key": api_key}, timeout=60)
        if resp.status_code >= 400:
            raise SystemExit(f"operation poll failed {resp.status_code}: {resp.text}")
        body = resp.json()
        if body.get("done"):
            if "error" in body:
                raise SystemExit(f"asset job failed: {body['error']}")
            return body.get("response", body)
        time.sleep(delay)
        delay = min(delay * 1.5, 15.0)
    raise SystemExit(f"operation {op} still not done after {timeout_s}s. "
                     "Moderation can be slow; re-poll rather than re-uploading.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--asset-type", default="Model",
                    choices=["Model", "Image", "Decal", "Audio", "Animation", "Mesh"])
    ap.add_argument("--description", default="Generated by the roblox-3d-model skill.")
    ap.add_argument("--user-id", default=os.environ.get("ROBLOX_USER_ID"))
    ap.add_argument("--group-id", default=os.environ.get("ROBLOX_GROUP_ID"))
    ap.add_argument("--expected-price", type=int, default=None)
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()

    api_key = os.environ.get("ROBLOX_API_KEY")
    if not api_key:
        raise SystemExit("ROBLOX_API_KEY is not set (Open Cloud key with Assets write)")

    if args.group_id:
        creator = {"groupId": str(args.group_id)}
    elif args.user_id:
        creator = {"userId": str(args.user_id)}
    else:
        raise SystemExit("set --user-id/ROBLOX_USER_ID or --group-id/ROBLOX_GROUP_ID")

    path = Path(args.file).resolve()
    if not path.exists():
        raise SystemExit(f"file not found: {path}")

    size_mb = path.stat().st_size / 1e6
    if size_mb > 20:
        raise SystemExit(f"{size_mb:.1f} MB exceeds the 20 MB per-upload limit. "
                         "If this is the high-poly, you skipped the Blender stage.")

    print(f"[upload] {path.name} ({size_mb:.2f} MB) as {args.asset_type}")
    op = upload(path, args.name, args.asset_type, args.description,
                api_key, creator, args.expected_price)
    print(f"[upload] operation {op}, polling")

    result = poll(op, api_key, args.timeout)
    asset_id = result.get("assetId") or result.get("assetid")
    print(json.dumps(result, indent=2))
    if asset_id:
        print(f"[upload] assetId={asset_id}  ->  rbxassetid://{asset_id}")
    else:
        print("[upload] operation completed but returned no assetId; read the body above")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
