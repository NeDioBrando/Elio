"""Runs ON KAGGLE. A/B the icon generator: is it the prompt or is it the model?

Reads /kaggle/input/**/ab.json:

    {"arms": [{"id": "A", "model": "...", "steps": 30, "guidance": 7.0,
               "strip_style": false}, ...],
     "subjects": [{"name": "close", "prompt": "...", "style": "..."}]}

and writes one PNG per (arm, subject) named <arm>_<subject>.png.

WHY AN EXPERIMENT AND NOT A GUESS. The batch produced good PICTORIAL icons - a
carrot, a chest, a tractor, a cow - and bad SYMBOLIC ones: the X came back a
scribble, the tick a down arrow, the heart a games controller. Two candidate
causes with completely different fixes:

  PROMPT  - the style anchor "cartoon farm game" (an example anchor) is pasted onto EVERY prompt,
            including the symbols. Asking for a love heart in a farm game is
            asking for farm imagery, and that is a one-line fix.
  MODEL   - SDXL base is trained on photographs and general art and is weak at
            flat vector. That needs a different model, not a better sentence.

So the arms cross the two: same subjects, style anchor on and off, SDXL against a
FLUX-class model. TWO SUBJECTS THAT ALREADY WORKED ARE INCLUDED ON PURPOSE - if
an arm improves the symbols and wrecks the carrot, it is not an improvement.

MODEL CHOICE. shuttle-3-diffusion is a FLUX-schnell derivative under Apache-2.0
and is NOT a gated repo, so it tests the common claim that FLUX is dramatically better
without needing without needing an HF token. Being schnell-derived it is distilled to few
steps at guidance 0, which is why per-arm steps and guidance exist.
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


def sh(cmd, check=True):
    print(f"$ {cmd}", flush=True)
    rc = subprocess.call(cmd, shell=True)
    if check and rc != 0:
        raise RuntimeError(f"failed ({rc}): {cmd}")
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


def setup():
    # ORDER MATTERS: match torch to the card FIRST, then install the libraries on
    # top of it. Writing this kernel without the guard above cost a full run - it
    # died with cudaErrorNoKernelImageForDevice after loading the model, which is
    # exactly the failure kaggle_flux.py already documents.
    ensure_torch_matches_gpu()
    sh("pip -q install -U 'diffusers>=0.31' 'transformers>=4.44' accelerate "
       "safetensors sentencepiece protobuf", check=False)


def find_config():
    for p in IN_DIR.rglob("ab.json"):
        return json.loads(p.read_text())
    raise SystemExit("no ab.json in the attached dataset")


def main() -> int:
    print("=== icon A/B ===", flush=True)
    setup()
    import torch
    from diffusers import AutoPipelineForText2Image

    cfg = find_config()
    arms, subjects = cfg["arms"], cfg["subjects"]
    print(f"{len(arms)} arms x {len(subjects)} subjects", flush=True)

    head = cfg.get("head", "")
    tail = cfg.get("tail", "")
    negative = cfg.get("negative", "")

    manifest = []
    for arm in arms:
        model = arm["model"]
        print(f"\n===== arm {arm['id']}: {model} "
              f"(strip_style={arm.get('strip_style', False)}) =====", flush=True)
        try:
            pipe = AutoPipelineForText2Image.from_pretrained(
                model, torch_dtype=torch.bfloat16, use_safetensors=True)
            # Offload rather than .to("cuda"): a FLUX-class model in bf16 does not
            # fit a 16GB card, and offload costs seconds instead of failing.
            pipe.enable_model_cpu_offload()
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            manifest.append({"arm": arm["id"], "ok": False, "error": str(exc)[:400]})
            continue

        for i, sub in enumerate(subjects):
            body = sub["prompt"]
            if not arm.get("strip_style") and sub.get("style"):
                body = f"{body}, {sub['style']}"
            prompt = ", ".join(x for x in (head, body, tail) if x)

            name = f"{arm['id']}_{sub['name']}"
            print(f"[{name}] {prompt[:110]}", flush=True)
            started = time.time()
            try:
                gen = torch.Generator("cpu").manual_seed(int(sub.get("seed", 1000 + i)))
                kw = dict(width=1024, height=1024, generator=gen,
                          num_inference_steps=int(arm.get("steps", 30)))
                g = float(arm.get("guidance", 7.0))
                kw["guidance_scale"] = g
                if g > 0 and negative:
                    kw["negative_prompt"] = negative
                img = pipe(prompt, **kw).images[0]
                img.save(OUT_DIR / f"{name}.png")
                manifest.append({"arm": arm["id"], "subject": sub["name"], "ok": True,
                                 "seconds": round(time.time() - started, 1)})
                print(f"    {manifest[-1]['seconds']}s", flush=True)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                manifest.append({"arm": arm["id"], "subject": sub["name"],
                                 "ok": False, "error": str(exc)[:400]})
            (OUT_DIR / "ab_manifest.json").write_text(json.dumps(manifest, indent=2))

        del pipe
        torch.cuda.empty_cache()

    ok = sum(1 for m in manifest if m.get("ok"))
    print(f"\n=== {ok}/{len(manifest)} images ===", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
