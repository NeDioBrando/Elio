"""Stage 3 on Kaggle: 30 GPU-hours a week instead of 300 seconds a day.

    python scripts/kaggle_run.py push   --outdir work/farm --slug farm-images --mode images
    python scripts/kaggle_run.py push   --outdir work/farm --slug farm-animals
    python scripts/kaggle_run.py status --slug farm-animals
    python scripts/kaggle_run.py fetch  --outdir work/farm --slug farm-animals

WHY NOT ZeroGPU. Free ZeroGPU is 300 GPU-seconds per DAY against a generation
measured in minutes, so a sixteen-asset set takes a fortnight and fails at hour
four of any working day. Kaggle gives 30 GPU-hours per WEEK on a P100 or two T4s.
The licences do not change with the venue: Hi3DGen is MIT with no territory
clause, so the weights may be run anywhere.

WHAT IT DOES. Kaggle has no "run this script on a GPU" endpoint, so the shape is:

    concept images  -> a private Kaggle DATASET   (the kernel's input)
    kaggle_hi3dgen.py -> a private script KERNEL  (attached to that dataset)
    kernel runs on Kaggle's GPU, writes one GLB per image
    fetch pulls the outputs back into each asset's folder as high.glb

Both the dataset and the kernel are PRIVATE. Pushing again versions them rather
than creating duplicates, so a reroll of two animals is a re-push, not a cleanup.

CREDENTIALS. You need a Kaggle account with a phone-verified profile, which is
what unlocks GPU and internet on kernels. Then either:

    setx KAGGLE_API_TOKEN <token from kaggle.com/settings/api>

or place the classic kaggle.json at ~/.kaggle/kaggle.json. This script never asks
for a password and never logs a token.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KERNEL_SCRIPTS = {"meshes": HERE / "kaggle_hi3dgen.py", "images": HERE / "kaggle_flux.py"}


def api():
    """Authenticate late and fail with something actionable.

    The kaggle package prints a wall of setup text on an unauthenticated import,
    which buries the actual problem, so the import is wrapped.
    """
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "the kaggle package could not load. pip install kaggle, then set "
            "KAGGLE_API_TOKEN or place ~/.kaggle/kaggle.json.\n" + str(exc)
        ) from exc

    client = KaggleApi()
    try:
        client.authenticate()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "Kaggle rejected the credentials. Get a token at "
            "https://www.kaggle.com/settings/api and either set KAGGLE_API_TOKEN "
            "or save kaggle.json to ~/.kaggle/. GPU and internet on kernels also "
            "require a PHONE-VERIFIED Kaggle account.\n" + str(exc)
        ) from exc
    return client


def username(client) -> str:
    for key in ("KAGGLE_USERNAME",):
        if os.environ.get(key):
            return os.environ[key]
    cfg = Path.home() / ".kaggle" / "kaggle.json"
    if cfg.exists():
        try:
            return json.loads(cfg.read_text())["username"]
        except Exception:  # noqa: BLE001
            pass
    for attr in ("get_config_value", "config_values"):
        try:
            value = (client.get_config_value("username") if attr == "get_config_value"
                     else client.config_values.get("username"))
            if value:
                return value
        except Exception:  # noqa: BLE001
            continue
    raise SystemExit("could not determine your Kaggle username. Set KAGGLE_USERNAME.")


def collect_concepts(outdir: Path, only: str | None) -> list[Path]:
    wanted = {n.strip().lower() for n in only.split(",")} if only else None
    found = []
    for concept in sorted(outdir.glob("*/concept.png")):
        if wanted and concept.parent.name.lower() not in wanted:
            continue
        found.append(concept)
    if not found:
        raise SystemExit(f"no */concept.png under {outdir}. Run batch.py concepts first.")
    return found


# CLIP's text encoder takes 77 tokens. Past that diffusers TRUNCATES and only logs
# it, so an over-long prompt produces a plausible image of the wrong thing and every
# check downstream passes. MEASURED: a 161-token icon prompt lost every isolation
# clause and returned four scenes.
#
# The real tokeniser is not installed locally and pulling transformers in just to
# count would be worse than the problem, so this estimates instead. CALIBRATED
# against the one prompt whose true count is known: the failing icon batch, which
# transformers reported as exactly 161. This formula returns 196 on it, so it runs
# ABOUT 20 PERCENT HIGH. That is deliberate and is the direction to be wrong in -
# the effective budget becomes roughly 63 real tokens, which wastes a little prompt
# room and cannot let a truncating prompt through.
# It refuses BEFORE the push, which costs nothing, rather than after a ten-minute run.
TOKEN_LIMIT = 77
TOKENS_PER_WORD = 1.3


def estimate_tokens(text: str) -> int:
    return int(len(text.split()) * TOKENS_PER_WORD + text.count(",")) + 2


def check_token_budget(name: str, text: str) -> None:
    n = estimate_tokens(text)
    if n > TOKEN_LIMIT:
        raise SystemExit(
            f"prompt for '{name}' is about {n} tokens against CLIP's {TOKEN_LIMIT}. "
            f"It would be TRUNCATED SILENTLY and the tail clauses would never reach "
            f"the model. Shorten the asset prompt or the manifest's style field.\n\n"
            f"  {text}")
    if n > TOKEN_LIMIT - 8:
        print(f"[prompt] {name}: ~{n}/{TOKEN_LIMIT} tokens, close to the limit")


def fit_to_budget(head: str, body: str, tail: str, limit: int = TOKEN_LIMIT):
    """Compose head + body + tail within CLIP's window, trimming only the BODY.

    When something has to go, it must not be the framing. The head carries the
    isolation clauses ("ONE single animal alone", "full side profile") and the tail
    carries the lighting and backdrop - lose either and the image is unusable, as
    the three-bee batch demonstrated. The body's TRAILING clauses are descriptive
    detail: dropping "big black patches on white" costs some fidelity, dropping
    "one animal" costs the whole generation.

    Returns (prompt, dropped_clauses).
    """
    clauses = [c.strip() for c in body.split(",") if c.strip()]
    dropped = []
    while clauses:
        text = f"{head}, {', '.join(clauses)}, {tail}"
        if estimate_tokens(text) <= limit:
            return text, dropped
        dropped.insert(0, clauses.pop())
    return f"{head}, {tail}", dropped


def build_prompts(manifest_path: Path, only: str | None, seed: int) -> list[dict]:
    """Turn the asset manifest into the prompt list the FLUX kernel reads.

    The framing wrapper is applied HERE rather than on Kaggle, so the local and
    remote paths cannot drift into producing differently-framed images.
    """
    sys.path.insert(0, str(HERE))
    import concept_image  # noqa: PLC0415 - only needed for this mode

    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    style = data.get("style", "")
    preset = data.get("preset", "prop")
    wanted = {n.strip().lower() for n in only.split(",")} if only else None

    prompts = []
    for i, asset in enumerate(data["assets"]):
        if wanted and asset["name"].lower() not in wanted:
            continue
        kind = asset.get("preset", preset)
        # THIS IS THE SDXL/CLIP PATH, so it uses the SHORT framing with the
        # isolation clauses at the head. The full framing is for FLUX, which has a
        # 512-token T5 window and is the primary route - see gen_concepts_cf.py.
        head, tail = concept_image.SHORT_FRAMING[kind]
        body = asset["prompt"] + (", " + style if style else "")
        text, dropped = fit_to_budget(head, body, tail)
        if dropped:
            print(f"[prompt] {asset['name']}: trimmed {len(dropped)} trailing "
                  f"clause(s) to fit CLIP's {TOKEN_LIMIT} tokens: {dropped}")
        check_token_budget(asset["name"], text)
        item = {"name": asset["name"], "prompt": text, "seed": seed + i}
        # A preset may carry a negative prompt. Only the SDXL fallback path reads it
        # (FLUX.1-schnell is distilled to guidance 0 and has no negative), which is
        # fine: SDXL is the path that actually needs telling not to draw a shadow.
        neg = getattr(concept_image, "NEGATIVES", {}).get(kind)
        if neg:
            item["negative_prompt"] = neg
        for k in ("width", "height", "steps"):
            if k in asset:
                item[k] = asset[k]
            elif k in data:
                item[k] = data[k]
        prompts.append(item)
    if not prompts:
        raise SystemExit("no assets selected")
    return prompts


def _failed(result) -> str:
    """The Kaggle client RETURNS errors, it does not raise them.

    THIS IS THE BUG THAT COST THREE ROUND TRIPS. dataset_create_new on an existing
    dataset returns an ApiCreateDatasetResponse with status="error" and the message
    'The requested title ... is already in use', and the old code caught only
    EXCEPTIONS - so the fallback to dataset_create_version never ran, the dataset
    stayed on VERSION 1 forever, and every reroll silently regenerated the FIRST
    batch's prompts while printing "dataset created". Nothing failed. The images
    came back on time and looked plausible.

    Any wrapper around this client has to inspect the returned object.
    """
    status = str(getattr(result, "status", "") or "")
    if status.lower() == "error":
        return str(getattr(result, "error", "") or "unknown error")
    return ""


def push_dataset(client, data_dir: Path, data_id: str) -> None:
    """Create the dataset, or add a version to it, and PROVE which one happened."""
    created = client.dataset_create_new(str(data_dir), public=False, quiet=True,
                                        dir_mode="skip")
    err = _failed(created)
    if not err:
        print("[push] dataset created (version 1)")
        return

    print(f"[push] create rejected: {err[:100]}")
    versioned = client.dataset_create_version(str(data_dir), version_notes="rerun",
                                              quiet=True, dir_mode="skip")
    err2 = _failed(versioned)
    if err2:
        raise SystemExit(
            f"could not add a dataset version to {data_id}: {err2}. "
            "The kernel would run the PREVIOUS prompts and complete normally.")
    print("[push] dataset versioned")


def cmd_push(args) -> int:
    client = api()
    user = username(client)
    outdir = Path(args.outdir).resolve()
    concepts = collect_concepts(outdir, args.only) if args.mode == "meshes" else []

    data_slug = f"{args.slug}-concepts"
    data_id = f"{user}/{data_slug}"
    kernel_id = f"{user}/{args.slug}"

    staging = Path(tempfile.mkdtemp(prefix="kaggle_push_"))
    data_dir = staging / "data"
    kernel_dir = staging / "kernel"
    data_dir.mkdir()
    kernel_dir.mkdir()

    # The stem becomes the output name on the far side, so the asset folder name
    # is what travels. Do not renumber these.
    if args.mode == "meshes":
        for concept in concepts:
            shutil.copyfile(concept, data_dir / f"{concept.parent.name}.png")
        print(f"[push] {len(concepts)} images: {[c.parent.name for c in concepts]}")
    else:
        prompts = build_prompts(Path(args.manifest), args.only, args.seed)
        # Fingerprint the exact prompt set. The kernel echoes it and fetch refuses a
        # mismatch, which is the only reliable way to tell a stale dataset version
        # from a fresh one: a stale run completes normally and looks right.
        batch_id = hashlib.sha1(
            json.dumps(prompts, sort_keys=True).encode()).hexdigest()[:12]
        (data_dir / "prompts.json").write_text(
            json.dumps({"batch_id": batch_id, "prompts": prompts}, indent=2))
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / ".expected_batch").write_text(batch_id)
        print(f"[push] {len(prompts)} prompts: {[p['name'] for p in prompts]}")
        print(f"[push] batch_id {batch_id}")

    (data_dir / "dataset-metadata.json").write_text(json.dumps({
        "title": f"{args.slug} concepts",
        "id": data_id,
        "licenses": [{"name": "CC0-1.0"}],
    }, indent=2))

    print(f"[push] dataset {data_id}")
    push_dataset(client, data_dir, data_id)

    script = KERNEL_SCRIPTS[args.mode]
    shutil.copyfile(script, kernel_dir / script.name)
    (kernel_dir / "kernel-metadata.json").write_text(json.dumps({
        "id": kernel_id,
        "title": args.slug,
        "code_file": script.name,
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        # Both are required: no GPU means it exits at the CUDA check, and no
        # internet means the weight download dies minutes in.
        "enable_gpu": True,
        "enable_internet": True,
        # THE ACCELERATOR TYPE IS NOT OPTIONAL, and the default is the broken one.
        # MEASURED: Kaggle hands out a Tesla P100, which is compute capability
        # sm_60, while Kaggle's own preinstalled PyTorch 2.10.0+cu128 supports only
        # "sm_70 sm_75 sm_80 sm_86 sm_90 sm_100 sm_120". Every CUDA call then dies
        # with "no kernel image is available for execution on the device" - AFTER
        # the pip install and the multi-GB weight download have already run, so it
        # costs ten minutes to discover. The T4 is sm_75 and works.
        "machine_shape": args.accelerator,
        "dataset_sources": [data_id],
        "competition_sources": [],
        "kernel_sources": [],
    }, indent=2))

    # WAIT BEFORE QUEUEING. A dataset version takes time to become attachable, and
    # a kernel queued inside that window silently attaches the PREVIOUS version.
    # MEASURED twice on this project: the second run of a reroll re-generated the
    # first run's prompts, completed cleanly, and only the token-count line in the
    # log gave it away.
    if args.settle:
        print(f"[push] letting the dataset version settle for {args.settle}s")
        time.sleep(args.settle)

    print(f"[push] kernel {kernel_id}")
    client.kernels_push(str(kernel_dir))
    print(f"[push] queued: https://www.kaggle.com/code/{kernel_id}")
    print("[push] a dataset version can take a minute to become attachable; if the "
          "run fails instantly on missing input, push again.")
    return 0


def cmd_status(args) -> int:
    client = api()
    kernel_id = f"{username(client)}/{args.slug}"
    deadline = time.time() + args.wait
    while True:
        result = client.kernels_status(kernel_id)
        status = getattr(result, "status", None) or str(result)
        message = getattr(result, "failure_message", "") or ""
        print(f"[status] {status} {message}".rstrip())
        finished = any(s in str(status).lower() for s in ("complete", "error", "cancel"))
        if finished or time.time() >= deadline:
            return 0 if "complete" in str(status).lower() else 1
        time.sleep(args.poll)


def cmd_fetch(args) -> int:
    client = api()
    kernel_id = f"{username(client)}/{args.slug}"
    outdir = Path(args.outdir).resolve()
    landing = outdir / "_kaggle_output"
    # CLEAR IT FIRST. kernels_output does not empty the destination, so files from
    # a previous run survive and get redistributed as if they were fresh. MEASURED:
    # a reroll of two animals came back looking like sixteen, with the previous
    # run's manifest, and nothing anywhere said the data was stale. On the mesh
    # stage that would quietly overwrite a new GLB with an old one.
    landing.mkdir(parents=True, exist_ok=True)
    for stale in landing.iterdir():
        # Empty the CONTENTS, not the directory. On Windows inside a cloud-synced folder (a sync client) the
        # folder itself is often locked by the sync client, and rmtree then dies
        # with WinError 32 after already deleting everything inside it.
        try:
            shutil.rmtree(stale) if stale.is_dir() else stale.unlink()
        except OSError as exc:
            print(f"[fetch] could not clear {stale.name}: {exc}")

    print(f"[fetch] {kernel_id} -> {landing}")
    # A CRASH HERE MUST NOT SKIP THE DISTRIBUTION BELOW. Measured 2026-09-28:
    # on a cp1252 Windows console the client died with a charmap
    # UnicodeEncodeError while echoing the kernel log, AFTER every GLB had
    # landed - so nothing was copied into the asset folders, the log file was
    # left at 0 bytes, and the next stage would have reported "no high.glb".
    # Run with PYTHONUTF8=1 to keep the log; either way, carry on.
    try:
        client.kernels_output(kernel_id, str(landing), force=True, quiet=True)
    except UnicodeError as exc:
        print(f"[fetch] client crashed echoing the log ({exc.__class__.__name__}); "
              "outputs already on disk are distributed anyway. Set PYTHONUTF8=1.")

    expected = (outdir / ".expected_batch")
    got = landing / "image_manifest.json"
    if expected.exists() and got.exists():
        data = json.loads(got.read_text())
        actual = data.get("batch_id", "unknown") if isinstance(data, dict) else "unknown"
        want = expected.read_text().strip()
        if actual != want:
            raise SystemExit(
                f"STALE RUN. The kernel used batch_id {actual!r} but the last push was "
                f"{want!r}, so Kaggle attached an older dataset version and these images "
                f"are from the PREVIOUS prompts. Push again and let it settle; do not "
                f"copy these over good files.")
        print(f"[fetch] batch_id {actual} matches the push")

    manifest_path = landing / "batch_manifest.json"
    if manifest_path.exists():
        print(manifest_path.read_text())

    moved = 0
    if args.mode == "images":
        for png in sorted(landing.glob("*.png")):
            if png.name.endswith(".normal.png"):
                continue
            dest = outdir / png.stem / "concept.png"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(png, dest)
            print(f"[fetch] {png.stem} -> {dest}")
            moved += 1
        if moved:
            print(f"[fetch] {moved} concepts. Next: batch.py sheet, then LOOK at it "
                  "before pushing the mesh run.")
            return 0
        print("[fetch] no images came back. Read the kernel log on kaggle.com.")
        return 1

    for glb in sorted(landing.glob("*.glb")):
        dest = outdir / glb.stem / "high.glb"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(glb, dest)
        print(f"[fetch] {glb.stem}: {dest.stat().st_size / 1e6:.1f} MB -> {dest}")
        moved += 1

    # The normal bridge is the diagnostic for a mesh that comes back wrong, so it
    # is kept next to the mesh rather than left in the landing folder.
    for png in sorted(landing.glob("*.normal.png")):
        name = png.name.replace(".normal.png", "")
        target = outdir / name
        if target.exists():
            shutil.copyfile(png, target / "normal_bridge.png")

    if not moved:
        print("[fetch] no GLBs came back. Read the kernel log on kaggle.com: the "
              "usual causes are the accelerator being off, internet being off, or "
              "the dataset not attached.")
        return 1
    print(f"[fetch] {moved} meshes. Next: batch.py meshes --outdir {outdir}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["push", "status", "fetch"])
    ap.add_argument("--outdir", default=None, help="the batch output directory")
    ap.add_argument("--slug", required=True, help="kernel slug, e.g. farm-animals")
    ap.add_argument("--mode", default="meshes", choices=["meshes", "images"],
                    help="images runs FLUX.1-schnell; meshes runs Hi3DGen")
    ap.add_argument("--manifest", default=str(HERE.parent / "references" / "example-manifest.json"),
                    help="images mode only: where the prompts come from")
    ap.add_argument("--seed", type=int, default=900, help="images mode only")
    ap.add_argument("--accelerator", default="gpu-t4x2",
                    help="Kaggle machine_shape. gpu-t4x2 is sm_75 and works; "
                         "gpu-p100 is sm_60 and is NOT supported by Kaggle's own torch")
    ap.add_argument("--only", default=None, help="comma-separated asset names")
    ap.add_argument("--settle", type=int, default=90,
                    help="seconds to wait after the dataset push before queueing the "
                         "kernel, so it cannot attach the previous version")
    ap.add_argument("--poll", type=int, default=60, help="seconds between status checks")
    ap.add_argument("--wait", type=int, default=0, help="seconds to keep polling")
    args = ap.parse_args()

    if args.command in ("push", "fetch") and not args.outdir:
        raise SystemExit("--outdir is required for push and fetch")

    return {"push": cmd_push, "status": cmd_status, "fetch": cmd_fetch}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
