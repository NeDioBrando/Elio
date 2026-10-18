"""Stage 1-2 on Cloudflare: concept images for the mesh pipeline, and the 2D gate.

    python gen_concepts_cf.py --manifest ../references/example-manifest.json \\
        --outdir work/farm --variants 4
    python gen_concepts_cf.py --manifest ... --outdir ... --only bee,cow --variants 4
    python gen_concepts_cf.py --outdir work/farm --pick bee=3,cow=1

THIS IS NOW THE PRIMARY CONCEPT ROUTE. Kaggle/SDXL is the fallback.

WHY THE SWITCH, in numbers rather than taste:

  - THE PROMPT ACTUALLY ARRIVES. FLUX routes through T5-XXL's 512-token window;
    SDXL's CLIP takes 77 and truncates SILENTLY. A creature prompt is 166-192
    tokens, so roughly the last 60% was discarded - including "single animal
    alone, no other animals" and "no text, no watermark", which sit at the end.
    MEASURED side by side on the bee: truncated gave THREE BEES plus watermark
    text, full gave one bee in side profile. It had been blamed on "small nouns
    pluralise"; the instruction simply never arrived.

  - IT DOES NOT SPEND THE SCARCE RESOURCE. Kaggle is 30 GPU-hours/week and is the
    only place Hi3DGen can run. Generating 16 concepts there costs ~21 min of GPU
    against ~37 min for the meshes themselves - over half again, spent to conserve
    a Cloudflare pool that resets free every night and that 16 images use 23% of.

  - REROLLS BECOME FREE. 1.2s versus 59s. MEASURED: four cow variants in 4.9s.
    That is the real change - the 2D gate stops being "accept or spend ten more
    minutes" and becomes "pick the best of four", which also solves the orient
    stage's worst problem by letting you always choose a clean side profile.

WHAT IT IS NOT BETTER AT. The images are plainer - SDXL gives more expressive
faces. That does not matter here and can actively hurt: Hi3DGen infers geometry
from an ESTIMATED NORMAL MAP, so glossy speculars and a dark vignette (which SDXL
adds by default) are false shading, while FLUX's matte even lighting is what the
estimator wants. A prettier concept can make a worse mesh.

FALLING BACK. Cloudflare can refuse a perfectly innocent prompt - its safety
filter flagged "one metal grain silo tower" as NSFW. Anything that fails here is
listed at the end with the exact kaggle_run.py command to generate just those,
so the fallback is one paste rather than a rethink.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import concept_image as ci  # noqa: E402

CF_URL = "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}"
MODEL = "@cf/black-forest-labs/flux-1-schnell"
# MEASURED against the dashboard: 38 images at 1024px/4 steps cost 5,360 neurons.
# The published per-tile formula predicts 57.6 and is 2.4x optimistic.
NEURONS_PER_IMAGE = 141.0
DAILY_NEURONS = 10_000


def env(name: str) -> str | None:
    """os.environ, falling back to the Windows USER registry scope, because setx
    only reaches NEW processes and a long-lived shell never sees it."""
    value = os.environ.get(name)
    if value:
        return value
    if sys.platform != "win32":
        return None
    try:
        import winreg  # noqa: PLC0415
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, name)
            if value:
                os.environ[name] = value
            return value
    except OSError:
        return None


def generate(prompt: str, steps: int = 4) -> bytes:
    """The endpoint takes ONLY prompt and steps. width/height/seed return HTTP 400,
    so output size is Cloudflare's and there is NO SEED - a reroll is genuinely a
    reroll, which is why --variants exists."""
    acct, token = env("CF_ACCOUNT_ID"), env("CF_API_TOKEN")
    req = urllib.request.Request(
        CF_URL.format(acct=acct, model=MODEL),
        data=json.dumps({"prompt": prompt, "steps": steps}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read())
    if not payload.get("success", True):
        raise RuntimeError(str(payload.get("errors"))[:300])
    result = payload["result"]
    b64 = result.get("image") or (result.get("images") or [None])[0]
    if not b64:
        raise RuntimeError(f"no image in response: {list(result)}")
    return base64.b64decode(b64)


def variant_sheet(outdir: Path, names: list[str], dest: Path, cell: int = 380) -> None:
    """One sheet, every variant of every asset, for the 2D gate.

    The gate is the whole reason this stage exists: it rejected a bee that
    generated as three bees before a single GPU-second was spent downstream. With
    variants it also answers "which of these four" in the same glance.
    """
    from PIL import Image, ImageDraw
    rows = [(n, sorted((outdir / n / "_variants").glob("*.png"))) for n in names]
    rows = [(n, v) for n, v in rows if v]
    if not rows:
        return
    cols = max(len(v) for _, v in rows)
    sheet = Image.new("RGB", (140 + cols * cell, len(rows) * (cell + 20)), (250, 250, 252))
    d = ImageDraw.Draw(sheet)
    for j, (name, vs) in enumerate(rows):
        y = j * (cell + 20)
        d.text((8, y + cell // 2), name, fill=(20, 20, 35))
        for i, v in enumerate(vs):
            sheet.paste(Image.open(v).convert("RGB").resize((cell, cell)), (140 + i * cell, y))
            d.text((140 + i * cell + 6, y + cell + 4), v.stem, fill=(70, 70, 90))
    sheet.save(dest)
    print(f"[sheet] {dest}  <- LOOK AT THIS before spending GPU on meshes")


def cmd_generate(args) -> int:
    missing = [k for k in ("CF_ACCOUNT_ID", "CF_API_TOKEN") if not env(k)]
    if missing:
        raise SystemExit(f"missing {', '.join(missing)}. CF_ACCOUNT_ID is recorded "
                         "in your Cloudflare dashboard; mint CF_API_TOKEN at "
                         "dash.cloudflare.com with Account > Workers AI > Read.")

    data = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    style = data.get("style", "")
    default_preset = data.get("preset", "prop")
    wanted = {n.strip() for n in args.only.split(",")} if args.only else None
    assets = [a for a in data["assets"] if not wanted or a["name"] in wanted]
    if not assets:
        raise SystemExit("no assets selected")

    outdir = Path(args.outdir)
    total = len(assets) * args.variants
    spend = total * NEURONS_PER_IMAGE
    print(f"{len(assets)} assets x {args.variants} variants = {total} images "
          f"~= {spend:.0f} of {DAILY_NEURONS} daily neurons ({spend/DAILY_NEURONS:.0%})")
    if spend > DAILY_NEURONS:
        raise SystemExit("that would exceed the daily free pool; lower --variants")

    failed, made = [], 0
    for a in assets:
        preset = a.get("preset", default_preset)
        # FULL framing, deliberately. T5 has room for it and every clause earned
        # its place; the SHORT variants are only for the CLIP fallback.
        prompt = f'{a["prompt"]}{", " + style if style else ""}, {ci.PRESETS[preset]}'
        vdir = outdir / a["name"] / "_variants"
        vdir.mkdir(parents=True, exist_ok=True)
        for i in range(args.variants):
            try:
                t = time.time()
                (vdir / f"v{i+1}.png").write_bytes(generate(prompt, args.steps))
                made += 1
                print(f"  {a['name']:<10} v{i+1}  {time.time()-t:.1f}s")
            except urllib.error.HTTPError as exc:
                detail = exc.read()[:200].decode(errors="ignore")
                print(f"  {a['name']:<10} v{i+1}  HTTP {exc.code}: {detail}")
                failed.append(a["name"])
                break
            except Exception as exc:  # noqa: BLE001
                print(f"  {a['name']:<10} v{i+1}  FAILED: {exc}")
                failed.append(a["name"])
                break
        # v1 is the default pick so the pipeline is runnable before anyone looks;
        # `--pick` overrides it after the gate.
        if (vdir / "v1.png").exists():
            shutil.copyfile(vdir / "v1.png", outdir / a["name"] / "concept.png")

    variant_sheet(outdir, [a["name"] for a in assets],
                  outdir / "_concept_variants.png")

    print(f"\n{made}/{total} images, ~{made * NEURONS_PER_IMAGE:.0f} neurons "
          f"({made * NEURONS_PER_IMAGE / DAILY_NEURONS:.0%} of today)")
    if failed:
        names = ",".join(sorted(set(failed)))
        print(f"\nFAILED ON CLOUDFLARE: {names}")
        print("Cloudflare's safety filter throws false positives (it refused "
              "'one metal grain silo tower'), so first try a REWORD. If that "
              "fails, fall back to Kaggle for just these:\n")
        print(f'  python kaggle_run.py push --outdir "{outdir}" --slug concepts-fallback '
              f'--mode images --manifest {args.manifest} --only {names}')
    print("\nNext: look at _concept_variants.png, then --pick, then the mesh run.")
    return 0


def cmd_pick(args) -> int:
    """Promote a chosen variant to concept.png. The 2D gate's verdict, recorded."""
    outdir = Path(args.outdir)
    for entry in args.pick.split(","):
        name, _, which = entry.partition("=")
        name, which = name.strip(), which.strip() or "1"
        src = outdir / name / "_variants" / f"v{which}.png"
        if not src.exists():
            print(f"  {name}: no variant v{which}")
            continue
        shutil.copyfile(src, outdir / name / "concept.png")
        print(f"  {name} <- v{which}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=str(HERE.parent / "references" / "example-manifest.json"))
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--only", default=None)
    ap.add_argument("--variants", type=int, default=4,
                    help="rerolls are 1.2s, so generate a spread and pick")
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--pick", default=None,
                    help="promote chosen variants, e.g. bee=3,cow=1")
    args = ap.parse_args()
    return cmd_pick(args) if args.pick else cmd_generate(args)


if __name__ == "__main__":
    raise SystemExit(main())
