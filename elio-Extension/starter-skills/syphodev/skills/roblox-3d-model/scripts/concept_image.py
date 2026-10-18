"""Stage 1: text prompt -> a 2D concept image suitable for image-to-3D.

    python scripts/concept_image.py --prompt "a weathered brass revolver" --out work/concept.png

Four backends, chosen automatically by which credentials exist, because the
ordering is about NOT burning quota the expensive stage needs:

  hf-space      FLUX.1-schnell on the official Space. DEFAULT, and by a wide
                margin the best output. Works with no credentials at all, but
                anonymous requests get the lowest ZeroGPU queue priority and are
                refused with "No GPU was available after 60s" under load, so this
                backend retries with backoff. HF_TOKEN (free account) removes
                most of that pain. FLUX.1-schnell is Apache-2.0, so the output is
                clean for a commercial game.
  cloudflare    Workers AI free tier. CORRECTED 2026-08-26: the budget is
                10,000 NEURONS PER DAY, not "100k req/day" - neurons are a
                compute unit shared across every model, so the request count
                depends entirely on what you run. For flux-1-schnell the
                published rates are 4.80 neurons per 512x512 tile plus 9.60 per
                step, so a 1024x1024 4-step image is about 57.6 neurons and the
                daily pool buys roughly 170 of them. That is still far more than
                any icon set needs, and it runs FLUX.1-schnell on Cloudflare's
                hardware - no GPU to match, no bf16 problem, no gated repo, and
                no queue. Needs CF_ACCOUNT_ID and CF_API_TOKEN (free account).
  hf-inference  HF serverless inference. Needs HF_TOKEN.
  pollinations  KEYLESS fallback, and the quality floor. MEASURED 2026-08-24: the
                anonymous tier now serves ONLY "sana" - /models returns exactly
                ["sana"] - so a --model flux request silently falls back to a much
                smaller model. That is why the first sixteen animals came out
                poorly. Use it only when nothing else is reachable.

The prompt wrapper matters more than the model. Image-to-3D fails on crops,
groups of objects and busy backgrounds far more often than it fails on style,
so every prompt gets the framing appended unless --raw is passed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Appended to every prompt. Each clause is here because its absence produces a
# specific downstream failure: a cropped object generates a mesh with a flat cut
# face, two objects generate one fused blob, and a busy background bleeds into
# the silhouette that the normal estimator reads.
FRAMING = (
    "single isolated object, centered, full object visible, nothing cropped, "
    "three-quarter view, even studio lighting, plain flat neutral grey background, "
    "no other objects, no text, no watermark, no hands, product photograph"
)

# Creatures need different framing from props, and the difference is not cosmetic.
# MEASURED: the prop wrapper on "cartoon dairy cow" returned a front-on, featureless
# white ceramic figurine - no markings, no body length, legs reduced to stubs. A
# front view hides the axis that makes an animal readable, and "product photograph"
# reads as untextured studio ceramic. Both then generate exactly what they showed.
CREATURE_FRAMING = (
    "3D rendered game asset, stylized toy figurine, smooth matte clay surfaces, "
    "soft even studio lighting with gentle shading and subtle ambient occlusion, "
    "full body side profile view, entire animal visible head to tail, nothing "
    "cropped, ALL legs visible and planted flat on the ground, no leg lifted or "
    "tucked up, natural markings and colours clearly visible, plain flat empty "
    "light grey studio backdrop, no ground plane, no grass, no landscape, "
    "no scenery, single animal alone, no other animals, no text, no watermark"
)
# Every clause here was earned by looking at a batch of sixteen and rejecting it.
#
# "3D rendered ... soft shading ... ambient occlusion" is the load-bearing one and
# it is NOT about looking nice. Hi3DGen infers geometry from an estimated NORMAL
# MAP, and a flat vector-style illustration carries almost no shading to infer
# from. Asking for a shaded toy render gives the normal estimator the gradients it
# needs. A prompt that produces a prettier picture can still produce a worse mesh.
#
# "all legs planted, none tucked" - the duck and the goose both generated standing
#   on one leg with the other folded, which becomes a one-legged mesh.
# "no ground plane, no landscape" - the pig generated on a grass platform under a
#   pink sky, and a busy background bleeds into the silhouette.

# UI ICONS are a third shape entirely, and the differences are all load-bearing.
# The output is not fed to image-to-3D, it is cut out and shown at 64-128px inside a
# Roblox GUI, so what matters is: a SINGLE silhouette readable at thumbnail size, an
# opaque outline that a flood fill can stop against, and NO semi-transparent edge.
#
# THE PROMPT IS SPLIT INTO A HEAD AND A TAIL, AND THAT IS NOT COSMETIC. CLIP takes
# 77 TOKENS AND SILENTLY DROPS THE REST. MEASURED 2026-08-26: the first icon batch
# sent 161 tokens, so every isolation clause - "single object", "plain flat grey
# background", "no text" - was cut before the model saw it, and all four came back
# as scenes and pattern sheets. Nothing errored. The log carried one warning line.
#
# So the clauses that decide whether the image is USABLE go in the HEAD, ahead of
# the subject, and the whole thing is kept short enough to survive. build_prompts
# refuses to push a prompt over the budget rather than letting it truncate.
#
# "no drop shadow" is not cosmetic either: soft edges are forbidden because
# semi-transparent pixels blend badly in-engine, a flood fill cannot separate a soft
# shadow from its background, and a per-image shadow will not share a light
# direction across a set. Shadow is added procedurally in Roblox instead.
#
# The background is FLAT MID GREY on purpose: saturated cartoon icons contain almost
# no mid grey, so a corner flood fill separates cleanly, and unlike a chroma key
# there is no Cb/Cr proximity problem with the reds and pinks that fill an icon set.
ICON_HEAD = "flat vector game icon, ONE single object, centered on plain flat grey"

ICON_TAIL = "thick dark outline, bold flat colours, no shadow, no text"

ICON_FRAMING = f"{ICON_HEAD} | {ICON_TAIL}"   # kept for --preset icon on the CLI

# MEASURED on a 38-icon batch: the first negative was not enough. Small repeatable
# nouns - corn, pumpkin, cheese, chicken, rain - came back as SEAMLESS PATTERN
# WALLPAPER, and buildings came back as landscape scenes. Pluralisation is the
# dominant failure mode for an icon set and it needs naming several ways, because
# the model has a different word for each kind of plural.
ICON_NEGATIVE = ("text, watermark, multiple objects, many objects, several, group, "
                 "collection, set of icons, sticker sheet, collage, pattern, "
                 "repeating pattern, seamless, tiled, grid, scenery, landscape, "
                 "sky, grass, ground, building scene, shadow, photo, realistic, "
                 "cropped")

PRESETS = {"prop": FRAMING, "creature": CREATURE_FRAMING, "icon": ICON_FRAMING}

# ---------------------------------------------------------------- CLIP-SAFE FRAMINGS
#
# TWO framings per preset, because the two backends have different text encoders
# and pretending otherwise silently threw away 60% of every creature prompt.
#
#   FLUX (Cloudflare)  T5-XXL, 512-token window. The FULL framing arrives, and
#                      every clause earns its place - measured: the long version
#                      produced one bee in side profile where the truncated one
#                      produced three bees plus watermark text.
#   SDXL  (Kaggle)     CLIP, 77 tokens, TRUNCATES SILENTLY. MEASURED: a creature
#                      prompt runs 166-192 tokens, so roughly the last 60% was
#                      discarded - including "single animal alone, no other
#                      animals" and "no text, no watermark", which sit at the END.
#                      That, not "small nouns pluralise", is why the bee generated
#                      as THREE BEES and the chicken as a grid of seven.
#
# So the short variants exist for the FALLBACK path only, and they put the
# isolation clauses FIRST, where truncation cannot reach them.

CREATURE_HEAD = ("3D toy figurine of ONE single animal alone, full side profile, "
                 "all legs visible")

CREATURE_TAIL = ("matte clay, soft even studio lighting, plain light grey backdrop, "
                 "no scenery, no text")

PROP_HEAD = "3D product render of ONE single object, centered, nothing cropped"

PROP_TAIL = "even studio lighting, plain flat grey background, no text"

SHORT_FRAMING = {
    "creature": (CREATURE_HEAD, CREATURE_TAIL),
    "prop": (PROP_HEAD, PROP_TAIL),
    "icon": (ICON_HEAD, ICON_TAIL),
}

NEGATIVES = {"icon": ICON_NEGATIVE}

HF_ROUTER = "https://router.huggingface.co/hf-inference/models/{model}"
HF_LEGACY = "https://api-inference.huggingface.co/models/{model}"
# Exception types that mean "this call is WRONG", not "this service is BUSY".
# Retrying any of these burns wall clock and then reports the wrong cause, which
# is exactly what happened on 2026-08-31: a TypeError from a renamed kwarg was
# retried six times over five minutes and reported as a queue refusal.
NON_RETRYABLE = (TypeError, AttributeError, NameError, ImportError, KeyError)

CF_URL = "https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}"


def _post(url: str, data: bytes, headers: dict, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def pick_backend(explicit: str | None) -> str:
    if explicit and explicit != "auto":
        return explicit
    if os.environ.get("CF_ACCOUNT_ID") and os.environ.get("CF_API_TOKEN"):
        return "cloudflare"
    # Quality first: the Space works without credentials and is far better than
    # the keyless fallback, so it leads even when nothing is configured.
    return "hf-space"


# --------------------------------------------------------------------------
# backends
# --------------------------------------------------------------------------

def gen_cloudflare(prompt: str, model: str, steps: int, seed: int | None) -> bytes:
    """Workers AI. NOTE: the endpoint takes ONLY `prompt` and `steps`.

    Sending width, height or seed returns HTTP 400 "Additional or unevaluated
    properties '/width, /height, /seed' at '/' not allowed". The seed is
    therefore accepted by this function and DELIBERATELY DISCARDED, because
    batch.py always passes one and refusing it there would be a worse API.

    The consequence is real and worth stating: **Cloudflare has no seed, so a
    reroll is a genuine reroll** and a run is not reproducible on this backend.
    Use hf-space when reproducibility matters.

    Measured 2026-08-31 (dry run): with the seed in the payload
    EVERY concept image failed with HTTP 400, and because `auto` picks
    Cloudflare whenever CF credentials exist, that broke the whole mesh stage
    on any machine that had them. a sibling Cloudflare icon generator already
    documented this rule in its own source; the fix had never propagated here.
    """
    acct = os.environ["CF_ACCOUNT_ID"]
    token = os.environ["CF_API_TOKEN"]
    payload = {"prompt": prompt, "steps": steps}
    _ = seed  # see the docstring: accepted, discarded, and the reason matters
    raw = _post(
        CF_URL.format(acct=acct, model=model),
        json.dumps(payload).encode(),
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    body = json.loads(raw)
    if not body.get("success", False):
        raise RuntimeError(f"Cloudflare AI error: {body.get('errors')}")
    # Workers AI returns the PNG as base64 under result.image.
    return base64.b64decode(body["result"]["image"])


def gen_hf_inference(prompt: str, model: str, steps: int, seed: int | None) -> bytes:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("hf-inference needs HF_TOKEN in the environment")
    params: dict = {"num_inference_steps": steps}
    if seed is not None and seed >= 0:
        params["seed"] = seed
    data = json.dumps({"inputs": prompt, "parameters": params}).encode()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # The router host replaced the legacy api-inference host, but old tokens and
    # older regions still resolve on the legacy one. Try both before giving up.
    last: Exception | None = None
    for tmpl in (HF_ROUTER, HF_LEGACY):
        try:
            out = _post(tmpl.format(model=model), data, headers)
            if out[:1] == b"{":  # an error body, not an image
                raise RuntimeError(out[:400].decode("utf-8", "replace"))
            return out
        except Exception as exc:  # noqa: BLE001 - both hosts get a fair try
            last = exc
    raise RuntimeError(f"HF inference failed on both hosts: {last}")


def gen_pollinations(prompt: str, model: str, steps: int, seed: int | None) -> bytes:
    """Keyless FLUX via image.pollinations.ai.

    Use the legacy /prompt/ endpoint: the newer gen.pollinations.ai/image/ path
    401s without a key. POLLINATIONS_TOKEN is optional and only raises the rate
    limit. Verified working keyless by the roblox-texture-gen skill.
    """
    params = {"width": "1024", "height": "1024", "nologo": "true", "model": model}
    if seed is not None and seed >= 0:
        params["seed"] = str(seed)
    url = ("https://image.pollinations.ai/prompt/"
           + urllib.parse.quote(prompt, safe="")
           + "?" + urllib.parse.urlencode(params))

    headers = {"User-Agent": "Mozilla/5.0 (roblox-3d-model skill)"}
    token = os.environ.get("POLLINATIONS_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    last: Exception | None = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            # An error page is served with a 200 and is small; a real image is not.
            if len(data) < 1000:
                raise RuntimeError(f"response too small ({len(data)} bytes), likely an error page")
            return data
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < 3:
                time.sleep(15)  # anonymous rate limit is roughly 1 per 15s
    raise RuntimeError(f"pollinations failed after 3 attempts: {last}")


def gen_hf_space(prompt: str, space: str, steps: int, seed: int | None) -> bytes:
    """FLUX.1-schnell on the official Space.

    Anonymous callers sit at the bottom of the ZeroGPU queue and get refused with
    "No GPU was available after 60s" whenever the Space is busy - MEASURED: the
    first request succeeded in 12s and the very next one was refused. That is
    queue priority, not a hard quota, so it is worth retrying: the wait costs
    nothing and the alternative model is visibly worse.
    """
    try:
        from gradio_client import Client
    except ImportError as exc:
        raise RuntimeError("pip install gradio_client") from exc

    token = os.environ.get("HF_TOKEN")
    attempts = int(os.environ.get("CONCEPT_ATTEMPTS", "6"))
    delay = 20

    def make_client():
        """gradio_client renamed hf_token -> token (2.x). Support both.

        Measured 2026-08-31 on gradio_client 2.6.0: the old `hf_token=` kwarg
        raises TypeError, which the retry loop below used to mistake for a queue
        refusal and retry for five minutes before reporting "the Space refused
        6 times" - a message that points at the wrong cause entirely.
        """
        try:
            return Client(space, token=token)
        except TypeError:
            return Client(space, hf_token=token)  # gradio_client < 1.x

    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            client = make_client()
            result = client.predict(
                prompt=prompt,
                seed=0 if seed is None or seed < 0 else seed,
                randomize_seed=seed is None or seed < 0,
                width=1024,
                height=1024,
                num_inference_steps=steps,
                api_name="/infer",
            )
            path = result[0] if isinstance(result, (list, tuple)) else result
            if isinstance(path, dict):
                path = path.get("path") or path.get("url")
            return Path(str(path)).read_bytes()
        except NON_RETRYABLE as exc:
            # A programming or API-shape error can NEVER succeed on a retry, and
            # backing off on one wastes minutes and then blames the queue. Fail
            # loudly and immediately, naming what actually went wrong.
            raise RuntimeError(
                f"hf-space is broken, not busy: {type(exc).__name__}: {exc}. "
                f"This is an API-shape failure and retrying cannot fix it - "
                f"check the gradio_client version against the Space's signature."
            ) from exc
        except Exception as exc:  # noqa: BLE001 - genuinely transient territory
            last = exc
            busy = "No GPU was available" in str(exc) or "quota" in str(exc).lower()
            if attempt < attempts:
                print(f"[concept]   attempt {attempt} {'queued out' if busy else 'failed'}, "
                      f"retrying in {delay}s")
                time.sleep(delay)
                delay = min(int(delay * 1.6), 120)

    raise RuntimeError(
        f"the Space refused {attempts} times. Set HF_TOKEN for queue priority, or "
        f"pass --backend pollinations to fall back to the lower-quality model. {last}"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--backend", default="auto",
                    choices=["auto", "cloudflare", "hf-inference", "pollinations", "hf-space"])
    ap.add_argument("--model", default=None, help="override the model/space id")
    ap.add_argument("--steps", type=int, default=4)  # schnell is a 4-step model
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--preset", default="prop", choices=["prop", "creature"],
                    help="creature reframes for animals: side view, all legs, real markings")
    ap.add_argument("--raw", action="store_true",
                    help="send the prompt verbatim, skipping the framing wrapper")
    args = ap.parse_args()

    prompt = args.prompt if args.raw else f"{args.prompt}, {PRESETS[args.preset]}"
    backend = pick_backend(args.backend)
    seed = None if args.seed < 0 else args.seed

    defaults = {
        "cloudflare": "@cf/black-forest-labs/flux-1-schnell",
        "hf-inference": "black-forest-labs/FLUX.1-schnell",
        "pollinations": "flux",
        "hf-space": "black-forest-labs/FLUX.1-schnell",
    }
    model = args.model or defaults[backend]

    print(f"[concept] backend={backend} model={model} steps={args.steps}")
    print(f"[concept] prompt: {prompt}")

    fn = {"cloudflare": gen_cloudflare,
          "hf-inference": gen_hf_inference,
          "pollinations": gen_pollinations,
          "hf-space": gen_hf_space}[backend]
    png = fn(prompt, model, args.steps, seed)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"[concept] wrote {out} ({len(png) / 1024:.0f} KB)")
    print("[concept] NOW LOOK AT IT. One object? Uncropped? Plain background?")
    print("[concept] The whole pipeline is built around gating here. Do not skip.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
