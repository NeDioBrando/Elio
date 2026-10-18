"""Runs ON KAGGLE, not here. Batch image-to-3D with Hi3DGen.

`kaggle_run.py` uploads this as a script kernel with the concept images attached
as a dataset. It reads every image under the input dataset and writes one GLB per
image into /kaggle/working, which `kaggle_run.py fetch` then pulls back.

WHY KAGGLE. ZeroGPU free is 300 GPU-seconds per DAY against a generation of
minutes, which is one or two meshes; Kaggle gives 30 GPU-HOURS PER WEEK on a
P100 or two T4s. For a sixteen-animal set that is the difference between two
weeks and one afternoon. Nothing about the licences changes: Hi3DGen is MIT and
carries no territory clause, so running the weights on Kaggle's hardware is the
same permission as running them anywhere else.

KAGGLE GOTCHAS this script is written around:
  - the session ships its own torch. Reinstalling the version the Space pins
    would drag half of CUDA with it and often lands broken, so torch is left
    alone and only the packages layered on top are installed.
  - spconv must match the session's CUDA major version, so it is chosen at
    runtime rather than pinned.
  - internet must be enabled on the kernel or the weight download dies at the
    first from_pretrained, several minutes in.
  - a script kernel has a 12 hour ceiling and writes to /kaggle/working only.
"""

import sys as _sys
if __name__ == "__main__" and any(a in ("-h", "--help") for a in _sys.argv[1:]):
    # This file is a Kaggle kernel: it installs packages and runs on import.
    # Asking it for help on your own machine must never do that.
    print(__doc__)
    raise SystemExit(0)


import gc
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

# FRAGMENTATION, NOT A LEAK. Measured 2026-09-28 (25 assets on a T4):
# Bush, PicnicBasket and Sandwich died "CUDA out of memory ... 14.8 MiB free" in
# the middle of the batch while assets before AND after them succeeded, so it is
# not the accumulating leak the sheep hit. Expandable segments let the caching
# allocator reuse fragmented blocks. Must be set before torch is first imported.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

IN_DIR = Path("/kaggle/input")
OUT_DIR = Path("/kaggle/working")
REPO_DIR = Path("/kaggle/working/Stable3DGen")

# SET BEFORE ANYTHING IMPORTS cumm, which is why this is at module scope rather
# than inside install(). cumm's __init__ runs a JIT build when:
#
#   project_is_installed(PACKAGE_NAME) and project_is_editable(PACKAGE_NAME)
#       and not CUMM_DISABLE_JIT
#
# On Kaggle it misdetects the prebuilt cumm-cu121 wheel as an EDITABLE install and
# tries to compile the extension with ninja, which fails - the traceback lands in
# pccm/ccimport and names neither spconv, nor cumm's install mode, nor CUDA.
#
# Three earlier theories were wrong and each cost a run: a shadowing source cumm
# (pip reported both as "not installed"), a missing cp312 wheel (one exists), and
# numpy 2.x (pinning to 1.26.4 changed nothing). The condition in the source is
# what settled it. Read the failing module, do not keep guessing at its inputs.
os.environ.setdefault("CUMM_DISABLE_JIT", "1")
os.environ.setdefault("SPCONV_DISABLE_JIT", "1")

# Matches the Hi3DGen Space's requirements.txt, minus the torch/torchvision pins
# (see the gotcha above) and minus gradio/spaces, which only the demo UI needs.
PACKAGES = [
    # numpy 1.x because the REPO's requirements.txt pins numpy==1.26.4 while the
    # Space's omits it, and Kaggle ships 2.x. Kept as correctness, NOT as the fix
    # for the ninja failure - it was tried as that theory and changed nothing.
    # The ninja failure was cumm's editable-install misdetection; see the
    # CUMM_DISABLE_JIT note at the top.
    "numpy==1.26.4",
    "huggingface-hub", "diffusers==0.35.0", "accelerate==1.2.1", "kornia==0.8.0",
    "timm", "pillow==10.4.0", "imageio==2.36.1", "imageio-ffmpeg==0.5.1",
    "easydict==1.13", "opencv-python-headless==4.10.0.84", "scipy==1.14.1",
    "rembg==2.0.60", "onnxruntime==1.20.1", "trimesh==4.5.3", "xatlas==0.0.9",
    "pyvista==0.44.2", "pymeshfix==0.17.0", "igraph==0.11.8",
    "transformers==4.46.3", "einops",
    # xformers is NOT optional and NOT here - it is installed separately by
    # xformers_pin() so its version can be matched to the torch that survived the
    # GPU fix. MEASURED, in this order:
    #   1. dropping it and setting ATTN_BACKEND=sdpa looked right, because the
    #      DENSE attention module accepts {xformers, flash_attn, sdpa, naive}
    #   2. but the SPARSE module accepts only {xformers, flash_attn}, silently
    #      ignores anything else, and then does a bare `import xformers.ops` at
    #      IMPORT TIME - so the run died on ModuleNotFoundError after the full
    #      install and the weight download
    #   3. and installing it unpinned resolves by UPGRADING torch, undoing the
    #      cu121 downgrade that is the only reason this runs on a P100
    "git+https://github.com/EasternJournalist/utils3d.git"
    "@9a4eb15e4021b67b12c460c7057d642626897ec8",
]


def sh(cmd: str, check: bool = True) -> int:
    print(f"$ {cmd}", flush=True)
    rc = subprocess.call(cmd, shell=True)
    if check and rc != 0:
        raise RuntimeError(f"command failed ({rc}): {cmd}")
    return rc


def torch_info() -> dict:
    """Torch/CUDA versions read in a SUBPROCESS, never by importing torch here.

    THIS IS NOT FASTIDIOUSNESS, IT IS THE FIX FOR A REAL FAILURE. Importing torch
    in this process also imports numpy. If that happens BEFORE the pip downgrade
    to numpy 1.26.4 lands on disk, the process is left holding numpy 2.x in memory
    while 1.26.4 sits in site-packages, and the next lazy submodule import
    explodes with:

        ImportError: cannot import name 'broadcast_to' from 'numpy.lib.stride_tricks'

    which names neither numpy's version nor pip. Worse, every check run in a fresh
    SUBPROCESS passes, because a new interpreter sees a consistent 1.26.4 - so the
    gate goes green and the main process still dies.

    Keep this module free of torch and numpy imports until all installs are done.
    """
    code = ("import torch, json;"
            "d={'version': torch.__version__, 'cuda': torch.version.cuda};"
            "print(json.dumps(d))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if r.returncode != 0:
        return {"version": "", "cuda": None}
    return json.loads(r.stdout.strip().splitlines()[-1])


def cuda_tag() -> str:
    """spconv wheels are per CUDA version and a mismatch fails at import, not install."""
    cuda = torch_info().get("cuda") or "12.6"
    ver = cuda.split(".")
    return f"cu{ver[0]}{ver[1][:1] if len(ver) > 1 else '0'}"


# spconv does NOT publish a wheel for every CUDA version torch is built against.
# MEASURED 2026-09-18: Kaggle's session torch reported CUDA 12.8, cuda_tag() asked
# for spconv-cu128, and pip answered "from versions: none" - no such wheel exists.
# The install was run with check=False, so it failed silently and the run died
# several minutes later in the preflight with a bare ModuleNotFoundError that
# named neither pip nor CUDA.
#
# THE BUG WAS DERIVING THE TAG FROM THE RUNTIME. spconv does not publish one
# wheel per CUDA minor version; it publishes a handful of tags. CUDA 12.x minor
# versions are binary compatible for these builds, so a cu126 wheel runs fine on
# a 12.8 runtime. So the rule is: take the newest PUBLISHED tag that is <= the
# runtime, never the runtime's own tag.
SPCONV_TAGS = ["cu126", "cu120", "cu118"]


def spconv_candidates() -> list[str]:
    """Published spconv tags no newer than the runtime, newest first."""
    cuda = torch_info().get("cuda") or "12.6"
    try:
        major, minor = (int(p) for p in cuda.split(".")[:2])
    except ValueError:
        major, minor = 12, 6
    runtime = major * 100 + minor * 10

    def rank(tag: str) -> int:
        # "cu126" -> major 12, minor 6. The tags use two digits for the major
        # version and the rest for the minor, so cu118 is 11.8 and not 1.18.
        digits = tag[2:]
        return int(digits[:2]) * 100 + int(digits[2:] or 0) * 10

    usable = [t for t in SPCONV_TAGS if rank(t) <= runtime]
    return usable or [SPCONV_TAGS[-1]]


def install_spconv(constraints: str) -> None:
    """Install the newest usable spconv wheel, and say which one landed.

    Fails loudly if none install: a missing spconv is not a degraded run, it is a
    run that dies at the first sparse op with a traceback pointing somewhere else.
    """
    tried = []
    for tag in spconv_candidates():
        tried.append(tag)
        rc = sh(f"pip install -q -c {constraints} spconv-{tag}==2.3.8", check=False)
        ok = subprocess.run(
            [sys.executable, "-c", "import spconv.pytorch"],
            capture_output=True, text=True).returncode == 0
        if ok:
            print(f"[install] spconv-{tag} installed and imports", flush=True)
            return
        print(f"[install] spconv-{tag} unusable (pip rc={rc}), trying the next tag",
              flush=True)
    raise SystemExit(f"no usable spconv wheel; tried: {', '.join(tried)}")


def write_constraints() -> str:
    """Freeze the torch trio so no later install can move it.

    Without this, any one of a dozen packages can resolve a dependency by
    upgrading torch, which silently reverts the cu121 downgrade that is the only
    reason this runs on a P100 at all. The failure then appears much later, as a
    CUDA kernel error, with nothing pointing at pip.
    """
    # Subprocess, not an import here: see torch_info().
    code = (
        "import json, importlib\n"
        "out = {}\n"
        "for n in ('torch', 'torchvision', 'torchaudio'):\n"
        "    try:\n"
        "        out[n] = importlib.import_module(n).__version__.split('+')[0]\n"
        "    except Exception:\n"
        "        pass\n"
        "print(json.dumps(out))\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    found = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {}
    pins = ["numpy==1.26.4"] + [f"{n}=={v}" for n, v in found.items()]
    path = "/kaggle/working/constraints.txt"
    Path(path).write_text(chr(10).join(pins) + chr(10))
    print(f"[pip] constraints: {pins}", flush=True)
    return path


def xformers_pin() -> str:
    """The xformers build that matches the installed torch.

    xformers ships one wheel per exact torch version. Left unpinned, pip satisfies
    it by moving torch, which breaks the GPU fix; pinned wrongly, it imports and
    then crashes on a symbol mismatch.
    """
    base = torch_info().get("version", "").split("+")[0]
    known = {"2.5.1": "0.0.28.post3", "2.4.0": "0.0.27.post2", "2.6.0": "0.0.29.post3"}
    pin = known.get(base)
    if pin:
        print(f"[pip] torch {base} -> xformers {pin}", flush=True)
        return f"xformers=={pin}"
    # Unknown torch: let the resolver choose, but the constraints file still
    # forbids it from moving torch, so a bad choice fails loudly at install
    # rather than quietly at the first CUDA call.
    print(f"[pip] torch {base} has no known xformers pin, letting pip resolve",
          flush=True)
    return "xformers"


def install(constraints: str) -> None:
    # A source spconv/cumm would shadow the prebuilt cumm-cuXXX, so they are
    # cleared first. On Kaggle neither is actually present - the log says
    # "Skipping, not installed" - so this is cheap defence, not the fix. The
    # ninja failure was cumm's editable-install misdetection, handled by
    # CUMM_DISABLE_JIT at module scope.
    sh("pip uninstall -q -y spconv cumm", check=False)
    install_spconv(constraints)
    sh(f"pip install -q -c {constraints} " + " ".join(f'"{p}"' for p in PACKAGES))
    sh(f'pip install -q -c {constraints} "{xformers_pin()}"')

    if not REPO_DIR.exists():
        sh(f"git clone --recursive https://github.com/Stable-X/Stable3DGen.git {REPO_DIR}")
    sys.path.insert(0, str(REPO_DIR))

    # The clone is broken upstream and takes the whole run with it. Both of
    # these run before any import of hi3dgen.
    patch_missing_import_os()
    prepare_dinov2_hub()

    # hi3dgen reads these at import time, so they must be set before the import.
    os.environ["SPCONV_ALGO"] = "native"
    # NOT sdpa: the sparse attention module accepts only xformers or flash_attn,
    # ignores anything else, and then hard-imports xformers at module load.
    os.environ.setdefault("ATTN_BACKEND", "xformers")

    # Last, because the hi3dgen check needs the clone to exist.
    verify_imports()



def patch_missing_import_os() -> None:
    """Stable3DGen's hi3dgen.py calls os.path.join without importing os.

    MEASURED 2026-08-31 (dry run), and it is fatal rather than
    cosmetic. `_init_image_cond_model` tries the LOCAL DINOv2 cache first:

        torch.hub.load(os.path.join(torch.hub.get_dir(), ...), source='local')

    which raises `NameError: name 'os' is not defined` every single time. The
    except branch then falls through to the network path, which is also down
    (see prepare_dinov2_hub). So the pipeline dies at the image-conditioning
    model on a healthy GPU, after paying the full install and weight-download
    cost - about thirty minutes before it tells you anything.

    Prepending the import is safe: it is a plain module, not a package __init__
    with an import-order contract.
    """
    f = REPO_DIR / "hi3dgen" / "pipelines" / "hi3dgen.py"
    if not f.exists():
        print(f"[patch] SKIP: {f} not found (repo layout changed?)", flush=True)
        return
    src = f.read_text(encoding="utf-8")
    if any(line.strip() in ("import os", "import os, sys") or
           line.strip().startswith("import os ")
           for line in src.splitlines()[:60]):
        print("[patch] hi3dgen.py already imports os, nothing to do", flush=True)
        return
    header = "import os  # patched in: upstream uses os.path.join without it"
    f.write_text(header + "\n" + src, encoding="utf-8")
    print("[patch] hi3dgen.py: prepended the missing `import os`", flush=True)


def prepare_dinov2_hub() -> None:
    """Put DINOv2 where torch.hub expects it, so the network path is never used.

    MEASURED 2026-08-31: hi3dgen's fallback is

        torch.hub.load('facebookresearch/dinov2', ...)

    which fetches https://github.com/facebookresearch/dinov2/zipball/main and
    returns **HTTP 400 Bad Request**. With the local path also broken by the
    missing import, both routes to the image-conditioning model were dead and
    the kernel could not succeed at all.

    Cloning into the hub dir fixes it at the source: `source='local'` then finds
    a real checkout and never touches the zipball endpoint. git clone uses a
    different endpoint from the codeload zipball, so it is not subject to the
    same failure. This also removes a network round trip from the longest stage
    in the pipeline, which is worth having on its own.
    """
    import torch

    hub = Path(torch.hub.get_dir())
    hub.mkdir(parents=True, exist_ok=True)
    target = hub / "facebookresearch_dinov2_main"
    if (target / "hubconf.py").exists():
        print(f"[patch] dinov2 already present at {target}", flush=True)
        return
    sh(f"git clone --depth 1 https://github.com/facebookresearch/dinov2.git {target}",
       check=False)
    if (target / "hubconf.py").exists():
        print(f"[patch] dinov2 cloned to {target}", flush=True)
    else:
        # Not fatal here: say so plainly rather than failing thirty minutes later
        # inside a stack trace that blames torch.hub.
        print("[patch] WARNING: dinov2 clone did not land. The pipeline will try "
              "the GitHub zipball, which was returning HTTP 400 on 2026-08-31.",
              flush=True)


def verify_imports() -> None:
    """Import every critical layer in a subprocess and report ALL failures.

    Each attempt on Kaggle costs about fifteen minutes, almost all of it install
    and weight download, and the failures have arrived one per run: wrong package
    name, wrong torch, missing xformers, shadowed cumm. Checking them together
    turns four runs into one.

    Subprocesses, because a half-initialised CUDA module can take the whole
    process down with it and take the diagnosis with it.
    """
    checks = {
        "torch on the GPU": "import torch; torch.zeros(8).cuda(); print(torch.__version__)",
        "xformers": "import xformers.ops; import xformers; print(xformers.__version__)",
        "spconv (prebuilt, no JIT)": "import spconv.pytorch as sp; print(sp.__name__)",
        "hi3dgen pipeline": "from hi3dgen.pipelines import Hi3DGenPipeline; print('ok')",
        # The check that would have caught the 2026-08-31 failure THIRTY MINUTES
        # earlier. Importing the pipeline class was never the problem; loading
        # the image-conditioning model was, and nothing looked at it.
        "dinov2 image-cond model": (
            "import torch, os; "
            "d=os.path.join(torch.hub.get_dir(),'facebookresearch_dinov2_main'); "
            "assert os.path.exists(os.path.join(d,'hubconf.py')), 'no local dinov2 at '+d; "
            "m=torch.hub.load(d,'dinov2_vitl14_reg',source='local',pretrained=True); "
            "print('dinov2 ok')"
        ),
    }
    env = dict(os.environ, PYTHONPATH=str(REPO_DIR))
    failed = []
    for label, code in checks.items():
        r = subprocess.run([sys.executable, "-c", code], capture_output=True,
                           text=True, env=env)
        if r.returncode == 0:
            print(f"[check] PASS {label}: {r.stdout.strip()[:80]}", flush=True)
        else:
            lines = r.stderr.strip().splitlines() or ["?"]
            print(f"[check] FAIL {label}:", flush=True)
            for line in lines[-12:]:
                print(f"          {line[:200]}", flush=True)
            failed.append(label)

    if failed:
        raise SystemExit(f"environment is not usable, failing before the weight "
                         f"download: {', '.join(failed)}")


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


def find_images() -> list[Path]:
    """Every image in the attached dataset, in a stable order.

    Named <asset>.png by kaggle_run.py, and the stem is carried through to the
    output filename so a batch of sixteen can be matched back up without guessing.
    """
    images: list[Path] = []
    for pattern in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
        images.extend(IN_DIR.rglob(pattern))
    return sorted(images, key=lambda p: p.stem)


def main() -> int:
    print("=== Hi3DGen batch on Kaggle ===", flush=True)
    # ORDER IS LOAD-BEARING. spconv wheels are chosen by the CUDA version of the
    # torch that is installed AT THAT MOMENT, so picking spconv first and then
    # downgrading torch leaves a mismatched pair that fails at import, not install.
    ensure_torch_matches_gpu()
    install(write_constraints())

    import torch
    from PIL import Image
    print(f"torch {torch.__version__} cuda={torch.cuda.is_available()} "
          f"device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE'}",
          flush=True)
    if not torch.cuda.is_available():
        raise SystemExit("no GPU on this kernel: turn the accelerator on in the kernel settings")

    # The HF Space imports `trellis`, but the GitHub repo this clones ships the
    # package as `hi3dgen` and the class as Hi3DGenPipeline. Copying the Space's
    # import verbatim fails with ModuleNotFoundError after the whole install.
    from hi3dgen.pipelines import Hi3DGenPipeline

    # MIRROR THE REPO'S OWN MAIN BLOCK, not the Space's. The two differ, and the
    # difference has now cost two runs: the Space uses `trellis`/
    # TrellisImageTo3DPipeline, and it loads the pipeline straight from the HF
    # repo id. The repo instead snapshots three models into a LOCAL ./weights
    # folder and loads from the local path.
    #
    # That matters because the pipeline resolves BiRefNet by the RELATIVE path
    # "weights/BiRefNet" during preprocess_image. Loading from the HF id looks
    # fine - the pipeline loads, the GPU work starts - and then every asset fails
    # with "weights/BiRefNet is not a local folder and is not a valid model
    # identifier", which reads like a gated-repo problem and is really a
    # working-directory problem.
    from huggingface_hub import snapshot_download

    weights_dir = REPO_DIR / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)
    for repo_id in ("Stable-X/trellis-normal-v0-1",
                    "Stable-X/yoso-normal-v1-8-1",
                    "ZhengPeng7/BiRefNet"):
        target = weights_dir / repo_id.split("/")[-1]
        print(f"caching {repo_id}", flush=True)
        snapshot_download(repo_id=repo_id, local_dir=str(target), force_download=False)

    # The relative "weights/..." lookups resolve against the CWD, so it has to be
    # the repo root - not /kaggle/working.
    os.chdir(REPO_DIR)

    print("loading trellis-normal-v0-1", flush=True)
    pipeline = Hi3DGenPipeline.from_pretrained("weights/trellis-normal-v0-1")
    pipeline.cuda()

    print("loading StableNormal_turbo", flush=True)
    normal_predictor = torch.hub.load("hugoycj/StableNormal", "StableNormal_turbo",
                                      trust_repo=True, yoso_version="yoso-normal-v1-8-1",
                                      local_cache_dir="./weights")

    images = find_images()
    print(f"{len(images)} input images: {[p.stem for p in images]}", flush=True)

    # Settings copied from the Space's defaults so results match what the Space
    # would have produced. Changing them here silently makes the two paths differ.
    params = json.loads(os.environ.get("HI3DGEN_PARAMS", "{}"))
    seed = int(params.get("seed", 0))
    ss_steps = int(params.get("ss_sampling_steps", 50))
    ss_cfg = float(params.get("ss_guidance_strength", 3.0))
    slat_steps = int(params.get("slat_sampling_steps", 6))
    slat_cfg = float(params.get("slat_guidance_strength", 3.0))

    # TWO PHASES: every normal bridge first, then FREE StableNormal before any
    # 3D decode. Measured 2026-09-28: Bush and Sandwich OOM'd on a T4 in two
    # separate kernels (1.33 / 1.02 GiB allocations with <700 MiB free) while
    # StableNormal and its UNet stayed resident on the same GPU for the whole
    # run. The 3D stage never needs it, so its VRAM is released first.
    bridges = {}
    for path in images:
        try:
            image = pipeline.preprocess_image(Image.open(path).convert("RGBA"),
                                              resolution=1024)
            nimg = normal_predictor(image, resolution=768,
                                    match_input_resolution=True, data_type="object")
            nimg.save(OUT_DIR / f"{path.stem}.normal.png")
            bridges[path.stem] = nimg
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            print(f"    normal bridge FAILED for {path.stem}: {exc}", flush=True)
    del normal_predictor
    gc.collect()
    torch.cuda.empty_cache()
    free, total = torch.cuda.mem_get_info()
    print(f"StableNormal freed: vram {(total-free)/2**30:.1f}/{total/2**30:.1f} GiB used",
          flush=True)

    manifest = []
    for i, path in enumerate(images):
        name = path.stem
        print(f"\n[{i+1}/{len(images)}] {name}", flush=True)
        started = time.time()
        # ONE RETRY PER ASSET. Measured 2026-09-28: the FIRST TWO assets of the
        # run (Anthill, Apple) failed with a cumm "TensorStorage ... cuda" error
        # and the OOMs above were transient; every one of them is a candidate for
        # a clean second attempt after VRAM is released, which costs ~50 s against
        # a whole re-push (dataset settle + kernel boot + installs, ~40 min).
        for attempt in (1, 2):
            outputs = mesh = normal_image = image = None
            try:
                # The normal bridge was made in phase one (and saved: it is the
                # best diagnostic when a mesh comes back wrong).
                normal_image = bridges[name]

                outputs = pipeline.run(
                    normal_image,
                    # a retry is a different draw: an OOM can be seed-specific
                    seed=seed + (attempt - 1),
                    formats=["mesh"],
                    preprocess_image=False,
                    sparse_structure_sampler_params={"steps": ss_steps, "cfg_strength": ss_cfg},
                    slat_sampler_params={"steps": slat_steps, "cfg_strength": slat_cfg},
                )
                mesh = outputs["mesh"][0].to_trimesh(transform_pose=True)
                dest = OUT_DIR / f"{name}.glb"
                mesh.export(dest)

                elapsed = time.time() - started
                entry = {
                    "name": name,
                    "faces": int(len(mesh.faces)),
                    "vertices": int(len(mesh.vertices)),
                    "seconds": round(elapsed, 1),
                    "mb": round(dest.stat().st_size / 1e6, 2),
                    "attempt": attempt,
                    "ok": True,
                }
                print(f"    {entry['faces']} faces, {entry['mb']} MB, {elapsed:.0f}s", flush=True)
            except Exception as exc:  # noqa: BLE001 - one bad asset must not kill the batch
                traceback.print_exc()
                entry = {"name": name, "ok": False, "attempt": attempt,
                         "error": str(exc)[:500]}
                print(f"    FAILED (attempt {attempt}): {exc}", flush=True)

            # RELEASE VRAM BETWEEN ASSETS (and between attempts). Without this the
            # run dies partway through with CUDA out of memory - the sheep died
            # this way on the first sixteen-animal run. Python frees the big
            # tensors only when the last reference goes.
            outputs = mesh = normal_image = None
            gc.collect()
            try:
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            except Exception:
                pass
            if entry.get("ok"):
                break
        if i % 4 == 3:
            free, total = torch.cuda.mem_get_info()
            print(f"    vram {(total-free)/2**30:.1f}/{total/2**30:.1f} GiB used",
                  flush=True)

        manifest.append(entry)
        (OUT_DIR / "batch_manifest.json").write_text(json.dumps(manifest, indent=2))

    ok = sum(1 for e in manifest if e.get("ok"))
    total_s = sum(e.get("seconds", 0) for e in manifest)
    print(f"\n=== {ok}/{len(manifest)} succeeded, {total_s:.0f}s GPU total ===", flush=True)
    # Measured GPU seconds per asset is the number you need to budget a batch,
    # and it is only knowable from a real run, so it is written out explicitly.
    print(json.dumps(manifest, indent=2), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
