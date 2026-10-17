"""Runs ON KAGGLE, not here. Batch concept images with FLUX.1-schnell.

`kaggle_run.py push --mode images` uploads this as a script kernel with a
prompts.json attached as a dataset. It writes one PNG per prompt into
/kaggle/working, which `fetch` pulls back into each asset's folder as concept.png.

WHY THIS EXISTS. The keyless options are either poor or queued:

  - Pollinations' anonymous tier serves ONLY "sana" (MEASURED: /models returns
    exactly ["sana"]), so a request for flux silently gets a much smaller model
  - the official FLUX.1-schnell Space is excellent and free, but anonymous callers
    sit at the bottom of the ZeroGPU queue and get refused under load - MEASURED:
    first request 12s, the very next one refused

Kaggle has neither problem: it is your own GPU for 30 hours a week. FLUX.1-schnell
is Apache-2.0, so the images are clean for a commercial game, unlike FLUX.1-dev
which is non-commercial.

MEMORY. schnell is about 24GB in bf16 against 16GB on a P100 or T4, so this
enables model CPU offload rather than trying to hold it all on the card.
"""

import sys as _sys
if __name__ == "__main__" and any(a in ("-h", "--help") for a in _sys.argv[1:]):
    # This file is a Kaggle kernel: it installs packages and runs on import.
    # Asking it for help on your own machine must never do that.
    print(__doc__)
    raise SystemExit(0)


import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

IN_DIR = Path("/kaggle/input")
OUT_DIR = Path("/kaggle/working")
# FLUX.1-schnell is the quality choice and is Apache-2.0, so its output is clean
# for a commercial game. But BFL's HF repo is GATED: downloading it needs an
# authenticated account that has accepted the terms on the model page. MEASURED -
# without a token Kaggle dies with GatedRepoError 401 several minutes in, after
# the pip install has already run.
FLUX_MODEL = "black-forest-labs/FLUX.1-schnell"

# The fallback when no token is supplied. SDXL base is NOT gated, and its
# CreativeML OpenRAIL++-M licence permits commercial use, so the images are still
# usable in a published game. It is a step below FLUX on prompt adherence, and a
# large step above the keyless SANA that produced the first rejected batch.
FALLBACK_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"


def sh(cmd: str, check: bool = True) -> int:
    print(f"$ {cmd}", flush=True)
    rc = subprocess.call(cmd, shell=True)
    if check and rc != 0:
        raise RuntimeError(f"command failed ({rc}): {cmd}")
    return rc


def ensure_torch_matches_gpu() -> None:
    """Install a torch build that actually has kernels for the assigned GPU.

    MEASURED, and it costs ten minutes to discover the hard way: Kaggle hands out
    a Tesla P100 (compute capability sm_60), while Kaggle's own preinstalled
    PyTorch 2.10.0+cu128 reports it supports only
    "sm_70 sm_75 sm_80 sm_86 sm_90 sm_100 sm_120".

    torch.cuda.is_available() returns TRUE on that pairing. Everything looks fine
    until the first real kernel launch, which dies with "no kernel image is
    available for execution on the device" - after pip install and a multi-GB
    weight download have already run.

    The accelerator TYPE cannot be chosen through the API: machine_shape is
    normalised server-side to a bare "Gpu", so asking for a T4 does nothing. The
    only reliable fix from inside the kernel is to match torch to the card. cu121
    wheels still carry Pascal kernels; cu128 wheels dropped them.

    The probe runs in a SUBPROCESS so this process has not yet imported torch,
    which means the fresh install is picked up without re-exec.
    """
    probe = subprocess.run(
        [sys.executable, "-c",
         "import torch,json;"
         "print(json.dumps({'cap': list(torch.cuda.get_device_capability(0)),"
         "'archs': torch.cuda.get_arch_list(),"
         "'name': torch.cuda.get_device_name(0)}))"],
        capture_output=True, text=True)

    if probe.returncode != 0:
        print(f"[torch] probe failed, continuing as-is: {probe.stderr[-300:]}", flush=True)
        return

    info = json.loads(probe.stdout.strip().splitlines()[-1])
    arch = f"sm_{info['cap'][0]}{info['cap'][1]}"
    print(f"[torch] {info['name']} is {arch}; installed torch supports {info['archs']}",
          flush=True)

    if arch in info["archs"]:
        print("[torch] compatible, no reinstall needed", flush=True)
        return

    print(f"[torch] {arch} NOT supported by the installed torch. Installing a cu121 "
          "build, which still carries Pascal kernels.", flush=True)
    # torchaudio MUST come along at the matching version. MEASURED: replacing only
    # torch and torchvision leaves the preinstalled torchaudio 2.10.0+cu128 in
    # place, and it is ABI-bound to the torch it shipped with. diffusers imports it
    # transitively, so the run dies on
    #   libtorchaudio.so: undefined symbol: aoti_torch_memory_format_preserve_format
    # which names neither torch nor the GPU and looks nothing like the real cause.
    sh("pip install -q torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 "
       "--index-url https://download.pytorch.org/whl/cu121")


def find_hf_token() -> str | None:
    """Read an HF token from the attached PRIVATE dataset, if the driver sent one.

    Kaggle Secrets would be tidier but must be attached through the web UI, which
    breaks the point of an unattended push. The dataset carrying this is private
    to the account, and the token is never printed.
    """
    env = os.environ.get("HF_TOKEN")
    if env:
        return env
    for path in IN_DIR.rglob("hf_token.txt"):
        token = path.read_text().strip()
        if token:
            return token
    return None


BATCH_ID = "unknown"


def find_prompts() -> list[dict]:
    """Read the prompts.json the driver uploaded as a dataset.

    Also echoes the driver's batch_id. Kaggle can attach a PREVIOUS dataset
    version to a freshly queued kernel, and when it does the run succeeds, the
    timings look normal and the images come back looking fresh - they are just
    the old prompts. MEASURED twice. Printing the id is what makes that visible,
    and cmd_fetch refuses a mismatch rather than overwriting good files with old
    ones.
    """
    global BATCH_ID
    for path in IN_DIR.rglob("prompts.json"):
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            BATCH_ID = data.get("batch_id", "unknown")
            print(f"[batch] prompts.json batch_id = {BATCH_ID}", flush=True)
            print(f"[batch] first prompt: {data['prompts'][0]['prompt'][:160]}", flush=True)
            return data["prompts"]
        return data
    raise SystemExit("no prompts.json in the attached dataset")


def main() -> int:
    print("=== FLUX.1-schnell batch on Kaggle ===", flush=True)
    sh("pip install -q -U diffusers transformers accelerate sentencepiece protobuf")
    ensure_torch_matches_gpu()

    import torch
    from diffusers import AutoPipelineForText2Image

    print(f"torch {torch.__version__} cuda={torch.cuda.is_available()}", flush=True)
    if not torch.cuda.is_available():
        raise SystemExit("no GPU: turn the accelerator on in the kernel settings")

    token = find_hf_token()
    model = FLUX_MODEL if token else FALLBACK_MODEL
    is_flux = model == FLUX_MODEL
    print(f"model: {model} ({'token supplied' if token else 'no token, using fallback'})",
          flush=True)

    pipe = AutoPipelineForText2Image.from_pretrained(
        model,
        torch_dtype=torch.bfloat16 if is_flux else torch.float16,
        token=token,
        **({} if is_flux else {"variant": "fp16", "use_safetensors": True}),
    )
    # Not .to("cuda") for FLUX: 24GB in bf16 does not fit a 16GB card. Offload
    # streams each submodule on and off the GPU, which costs seconds and works.
    if is_flux:
        pipe.enable_model_cpu_offload()
    else:
        pipe.to("cuda")

    prompts = find_prompts()
    print(f"{len(prompts)} prompts", flush=True)

    manifest = []
    for i, item in enumerate(prompts):
        name = item["name"]
        print(f"\n[{i+1}/{len(prompts)}] {name}", flush=True)
        started = time.time()
        try:
            generator = torch.Generator("cpu").manual_seed(int(item.get("seed", i)))
            # schnell is DISTILLED to 4 steps at guidance 0 - raising either does
            # not improve it, it only costs time. SDXL is the opposite and needs
            # real steps and real guidance, so the two cannot share one setting.
            kwargs = dict(
                width=int(item.get("width", 1024)),
                height=int(item.get("height", 1024)),
                generator=generator,
            )
            if is_flux:
                kwargs.update(num_inference_steps=int(item.get("steps", 4)),
                              guidance_scale=0.0, max_sequence_length=256)
            else:
                kwargs.update(num_inference_steps=int(item.get("steps", 30)),
                              guidance_scale=7.0,
                              negative_prompt=item.get("negative_prompt",
                                  "flat vector illustration, 2d cartoon drawing, "
                                  "line art, busy background, scenery, cropped, "
                                  "text, watermark, blurry, deformed, "
                                  # MEASURED: "multiple animals" alone did not hold.
                                  # The two SMALL animals pluralised - the bee came
                                  # back as three bees and the chicken as a grid of
                                  # seven - while none of the large animals did.
                                  # Small subjects read as "a group" unless the
                                  # singular is forced from both directions.
                                  "two animals, three animals, group of animals, "
                                  "herd, flock, swarm, collage, grid, multiple views, "
                                  "duplicated, repeated"))
            image = pipe(item["prompt"], **kwargs).images[0]
            dest = OUT_DIR / f"{name}.png"
            image.save(dest)
            entry = {"name": name, "ok": True, "seconds": round(time.time() - started, 1)}
            print(f"    {entry['seconds']}s -> {dest.name}", flush=True)
        except Exception as exc:  # noqa: BLE001 - one bad prompt must not kill the batch
            traceback.print_exc()
            entry = {"name": name, "ok": False, "error": str(exc)[:500]}
        manifest.append(entry)
        (OUT_DIR / "image_manifest.json").write_text(json.dumps(
            {"batch_id": BATCH_ID, "entries": manifest}, indent=2))

    ok = sum(1 for e in manifest if e.get("ok"))
    print(f"\n=== {ok}/{len(manifest)} images ===", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
