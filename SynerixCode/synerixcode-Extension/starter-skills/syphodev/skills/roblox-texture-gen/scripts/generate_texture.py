#!/usr/bin/env python3
"""
Generate a texture/decal image via the Pollinations.ai free image API and save it locally.

No API key required. Anonymous requests are rate-limited to ~1 per 15s and may carry
a small watermark; set POLLINATIONS_TOKEN (free registration at auth.pollinations.ai)
for faster/watermark-free generation if you have one, but it's optional.

Usage:
    python generate_texture.py "camo military texture, tileable, seamless" out.png
    python generate_texture.py "gold plated metal, brushed, seamless" out.png --width 1024 --height 1024 --seed 42
"""
import argparse
import sys
import time
import urllib.parse
import urllib.request
import os


def build_url(prompt: str, width: int, height: int, seed: int | None, model: str) -> str:
    # Note: the newer gen.pollinations.ai/image/{prompt} endpoint now 401s without an
    # API key. image.pollinations.ai/prompt/{prompt} is the legacy endpoint that still
    # works fully keyless as of this writing — verified live, returns a real JPEG.
    encoded = urllib.parse.quote(prompt, safe="")
    params = {
        "width": str(width),
        "height": str(height),
        "nologo": "true",
        "model": model,
    }
    if seed is not None:
        params["seed"] = str(seed)
    query = urllib.parse.urlencode(params)
    return f"https://image.pollinations.ai/prompt/{encoded}?{query}"


def generate(prompt: str, out_path: str, width: int = 1024, height: int = 1024,
             seed: int | None = None, model: str = "flux", retries: int = 3) -> str:
    """Suggest 'seamless, tileable texture' phrasing in the prompt for best results on game textures."""
    url = build_url(prompt, width, height, seed, model)
    token = os.environ.get("POLLINATIONS_TOKEN")
    headers = {"User-Agent": "Mozilla/5.0 (roblox-texture-gen skill)"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if len(data) < 1000:
                raise RuntimeError(f"Response too small ({len(data)} bytes) — likely an error page, not an image")
            with open(out_path, "wb") as f:
                f.write(data)
            return out_path
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(15)  # respect anonymous rate limit before retrying
    raise RuntimeError(f"Failed to generate image after {retries} attempts: {last_err}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate a texture image via Pollinations.ai (free, no key required)")
    parser.add_argument("prompt", help="Text description of the texture, e.g. 'carbon fiber weave, seamless tileable'")
    parser.add_argument("out_path", help="Where to save the PNG, e.g. ./textures/gun_camo.png")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=None, help="Fixed seed for reproducible variants")
    parser.add_argument("--model", default="flux", help="Pollinations model name (default: flux)")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out_path)) or ".", exist_ok=True)
    path = generate(args.prompt, args.out_path, args.width, args.height, args.seed, args.model)
    print(f"Saved: {path}")
