"""Generate an icon set on Cloudflare Workers AI. No GPU, no queue, no Kaggle.

    python gen_icons_cf.py --manifest ../references/icons.example.json --out raw/
    python gen_icons_cf.py --manifest ... --out raw/ --only barn,silo --seed 4400

WHY THIS EXISTS. The icon quality problem turned out to be Kaggle's HARDWARE, not
the prompts and not really the model either. Measured from a Kaggle kernel log,
Kaggle hands out a Tesla P100 (sm_60, Pascal, 2016) and offers only P100 or T4x2
with no way to choose, so neither card supports bf16 - which every current model
is built around. FLUX.1-schnell is 12B and has to CPU-offload on a 16GB card,
which eats the whole point of a 4-step model.

Cloudflare runs flux-1-schnell on their hardware and hands back a PNG. That
removes the GPU, the bf16 problem, the gated repo, the ten-minute round trip, the
dataset-version race and the accelerator lottery all at once.

BUDGET. Workers AI gives 10,000 NEURONS/day, shared across models, resetting at
00:00 UTC. Note this is NOT the "100,000 requests/day" often quoted - that is the
Workers PLATFORM limit and it does not meter AI at all.

USE THE MEASURED RATE, NOT THE PUBLISHED FORMULA. The published rates
(4.80/512px tile + 9.60/step) predict 57.6 neurons for a 1024px 4-step image.
The dashboard said otherwise: 38 images cost 5,360 neurons, so the real figure is
~141 EACH - the formula under-predicts by 2.4x. The likely reason is that the
per-step charge applies per tile rather than once per image, but the dashboard is
the authority and this file follows it rather than the arithmetic.

    1024x1024, 4 steps  ~141 neurons  ->  ~70 images/day

A 33-icon set is therefore TWO full rerolls a day, not four and a half. Still
free, still ample, but plan against 70 rather than 173. This script tracks the
estimate as it runs and refuses a batch that would overrun.

CREDENTIALS: CF_ACCOUNT_ID and CF_API_TOKEN (Account > Workers AI > Read). The
wrangler OAuth token in ~/.wrangler carries ai:write but expires in days, so it is
not the thing to build a pipeline on.

NOTE the model has no negative prompt and no LoRA - it is Cloudflare's catalogue,
not your pipeline. The prompt HEAD carries the framing instead, which is where it
belongs anyway after the CLIP truncation finding.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "roblox-3d-model" / "scripts"))

CF_URL = "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}"
MODEL = "@cf/black-forest-labs/flux-1-schnell"

# MEASURED against the Cloudflare dashboard 2026-08-26: 38 images at 1024px/4
# steps cost 5,360 neurons. The published per-tile/per-step formula predicted
# 2,189, so it is 2.4x optimistic and is not used here.
MEASURED_NEURONS_1024_4STEP = 141.0
DAILY_NEURONS = 10_000


def env(name: str) -> str | None:
    """os.environ, falling back to the Windows USER registry scope.

    setx writes to the registry and only NEW processes inherit it, so a long-lived
    parent shell - or an agent session started before the variable existed - never
    sees it and the user is told to restart everything for no reason. Reading the
    registry directly removes that step.
    """
    value = os.environ.get(name)
    if value:
        return value
    if sys.platform != "win32":
        return None
    try:
        import winreg  # noqa: PLC0415 - Windows only
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, name)
            if value:
                os.environ[name] = value
            return value
    except OSError:
        return None


def estimate_neurons(size: int, steps: int) -> float:
    """Scaled off the one measured data point rather than the published formula.

    Area scales the tile component and steps scale linearly, so this stays honest
    for other sizes while anchoring on a number that came from the dashboard.
    """
    return MEASURED_NEURONS_1024_4STEP * ((size / 1024) ** 2) * (steps / 4)


def generate(prompt: str, size: int, steps: int, seed: int | None) -> bytes:
    """MEASURED 2026-08-26: this endpoint takes ONLY `prompt` and `steps`.

    Sending width, height or seed returns HTTP 400 "Additional or unevaluated
    properties '/width, /height, /seed' at '/' not allowed". So the output size is
    Cloudflare's, not ours, and there is NO SEED - runs are not reproducible and a
    reroll is a genuine reroll. That is the trade for not owning a GPU, and it is
    worth knowing before building anything that assumes a fixed seed.
    """
    acct, token = env("CF_ACCOUNT_ID"), env("CF_API_TOKEN")
    body = {"prompt": prompt, "steps": steps}
    req = urllib.request.Request(
        CF_URL.format(acct=acct, model=MODEL),
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read())
    if not payload.get("success", True):
        raise RuntimeError(f"cloudflare: {payload.get('errors')}")
    result = payload["result"]
    # The response shape has moved around: older builds return {"image": b64},
    # newer ones an "images" list. Handle both rather than pin one.
    b64 = result.get("image") or (result.get("images") or [None])[0]
    if not b64:
        raise RuntimeError(f"no image in response: {list(result)}")
    return base64.b64decode(b64)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default=None)
    ap.add_argument("--seed", type=int, default=4400)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=4)
    args = ap.parse_args()

    missing = [k for k in ("CF_ACCOUNT_ID", "CF_API_TOKEN") if not env(k)]
    if missing:
        raise SystemExit(
            f"missing {', '.join(missing)}.\n"
            "CF_ACCOUNT_ID is shown on the Cloudflare dashboard (Workers AI page). "
            "CF_API_TOKEN needs minting at "
            "dash.cloudflare.com > My Profile > API Tokens > Create Token > "
            "Custom token, with Account > Workers AI > Read.")

    import concept_image  # noqa: PLC0415 - shares the prompt framing, never duplicates it

    data = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    style = data.get("style", "")
    wanted = {n.strip() for n in args.only.split(",")} if args.only else None
    assets = [a for a in data["assets"] if not wanted or a["name"] in wanted]
    if not assets:
        raise SystemExit("no assets selected")

    per = estimate_neurons(args.size, args.steps)
    print(f"{len(assets)} icons at {args.size}px/{args.steps} steps "
          f"~= {per:.1f} neurons each, {per * len(assets):.0f} of "
          f"{DAILY_NEURONS} daily")
    if per * len(assets) > DAILY_NEURONS:
        raise SystemExit("that batch would exceed the daily free pool; split it "
                         "or drop --size")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    spent, ok = 0.0, 0

    for i, asset in enumerate(assets):
        body = asset["prompt"] + (", " + style if style else "")
        prompt = (f"{concept_image.ICON_HEAD}, {body}, {concept_image.ICON_TAIL}")
        started = time.time()
        try:
            png = generate(prompt, args.size, args.steps, args.seed + i)
            (out / f"{asset['name']}.png").write_bytes(png)
            spent += per
            ok += 1
            print(f"  [{i+1}/{len(assets)}] {asset['name']:<14} "
                  f"{time.time()-started:.1f}s  ~{spent:.0f} neurons used")
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode(errors="ignore")
            print(f"  [{i+1}/{len(assets)}] {asset['name']:<14} HTTP {exc.code}: {detail}")
            if exc.code == 429:
                print("  rate limited or daily pool exhausted; stopping")
                break
        except Exception as exc:  # noqa: BLE001 - one bad icon must not kill a set
            print(f"  [{i+1}/{len(assets)}] {asset['name']:<14} FAILED: {exc}")

    print(f"\n{ok}/{len(assets)} generated, ~{spent:.0f} neurons "
          f"({spent / DAILY_NEURONS:.0%} of the daily pool)")
    print("Next: icon_cutout.py, then LOOK at the sheet.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
