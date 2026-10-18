"""Stage 3: concept image -> high-poly GLB, on the Hi3DGen HuggingFace Space.

    python scripts/image_to_3d.py --image work/concept.png --out work/high.glb

Hi3DGen (Stable3DGen, MIT, Bytedance) fine-tunes TRELLIS and bridges through a
normal map: StableNormal turns the photo into a normal image first, and TRELLIS
generates geometry from THAT rather than from colour. Two consequences that shape
every stage after this one:

  1. the output is GEOMETRY ONLY. No colour, no texture, no UVs. The Space calls
     TRELLIS with formats=["mesh"], so there is nothing to bake a base colour from.
  2. the normal-bridge image is the best diagnostic you get. When a mesh comes back
     wrong, look at that image before touching seeds: if the bridge is wrong, the
     concept image was the problem, and no reroll will fix it.

Local generation needs a 16GB NVIDIA GPU. Without one (for example a card with less VRAM,
or no CUDA), the Space or Kaggle is mandatory rather than convenient. Set HF_TOKEN to
raise the ZeroGPU quota above the signed-out floor and to get queue priority.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

SPACE = "Stable-X/Hi3DGen"
# Function name in the Space's app.py. It has no explicit api_name, so Gradio
# derives the endpoint from the function name; discovery below does not assume it.
FN_NAME = "generate_3d"


def find_endpoint(client) -> tuple[str | None, int | None]:
    """Return (api_name, fn_index) for the generation call.

    The Space sets no api_name, so the endpoint is whatever Gradio derived. Ask
    the client rather than hard-coding it: a Space edit that renames the function
    would otherwise fail with an opaque 'endpoint not found' months from now.
    """
    try:
        api = client.view_api(return_format="dict") or {}
    except Exception:  # noqa: BLE001 - discovery is best-effort by design
        return f"/{FN_NAME}", None

    named = api.get("named_endpoints", {}) or {}
    for key in named:
        if FN_NAME in key:
            return key, None

    # Unnamed endpoints are addressed positionally. Pick the one whose signature
    # matches: six inputs starting with an image, four outputs.
    for key, spec in (api.get("unnamed_endpoints", {}) or {}).items():
        params = spec.get("parameters", [])
        returns = spec.get("returns", [])
        if len(params) == 6 and len(returns) == 4:
            try:
                return None, int(key)
            except ValueError:
                continue

    return f"/{FN_NAME}", None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image", required=True, help="verified concept PNG")
    ap.add_argument("--out", required=True, help="destination .glb")
    ap.add_argument("--space", default=SPACE)
    ap.add_argument("--seed", type=int, default=0, help="-1 randomises")
    ap.add_argument("--ss-guidance", type=float, default=3.0)
    ap.add_argument("--ss-steps", type=int, default=50)
    ap.add_argument("--slat-guidance", type=float, default=3.0)
    ap.add_argument("--slat-steps", type=int, default=6)
    ap.add_argument("--save-normal", default=None,
                    help="also save the normal-bridge image here (default: <out>.normal.png)")
    args = ap.parse_args()

    try:
        from gradio_client import Client, handle_file
    except ImportError as exc:
        raise SystemExit("pip install gradio_client") from exc

    image = Path(args.image)
    if not image.exists():
        raise SystemExit(f"concept image not found: {image}")

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("[hi3dgen] WARNING: no HF_TOKEN. You are on the signed-out ZeroGPU "
              "floor, which is a handful of seconds per day. Expect to be refused.")

    print(f"[hi3dgen] connecting to {args.space}")
    client = Client(args.space, hf_token=token)
    api_name, fn_index = find_endpoint(client)
    print(f"[hi3dgen] endpoint api_name={api_name} fn_index={fn_index}")

    call_kwargs: dict = {"api_name": api_name} if api_name else {"fn_index": fn_index}

    started = time.time()
    try:
        result = client.predict(
            handle_file(str(image)),
            args.seed,
            args.ss_guidance,
            args.ss_steps,
            args.slat_guidance,
            args.slat_steps,
            **call_kwargs,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "quota" in msg.lower() or "gpu" in msg.lower():
            raise SystemExit(
                "[hi3dgen] ZeroGPU refused the job. This is the throughput limit, "
                "not a bug: free is 300 GPU-seconds/day against a 2-5 minute "
                "generation. Wait for the reset, use an HF PRO token, or drop to "
                "Tier 1 (Studio generate_mesh).\n" + msg
            ) from exc
        raise

    elapsed = time.time() - started

    # Outputs, in order: preview gallery, normal-bridge image, Model3D path,
    # download path. The last two are the same file.
    normal_out = result[1] if len(result) > 1 else None
    mesh_out = result[2] if len(result) > 2 else None
    if isinstance(mesh_out, dict):
        mesh_out = mesh_out.get("path") or mesh_out.get("url")
    if isinstance(normal_out, dict):
        normal_out = normal_out.get("path") or normal_out.get("url")

    if not mesh_out or not Path(str(mesh_out)).exists():
        raise SystemExit(f"[hi3dgen] no mesh came back (got {result!r})")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(mesh_out), out)

    if normal_out and Path(str(normal_out)).exists():
        normal_dst = Path(args.save_normal) if args.save_normal else out.with_suffix(".normal.png")
        shutil.copyfile(str(normal_out), normal_dst)
        print(f"[hi3dgen] normal bridge -> {normal_dst}")

    size_mb = out.stat().st_size / 1e6
    print(f"[hi3dgen] wrote {out} ({size_mb:.1f} MB) in {elapsed:.0f}s wall clock")
    print("[hi3dgen] geometry only: no colour, no UVs. Blender stage supplies both.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
