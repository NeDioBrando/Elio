"""Drive a whole asset set through the pipeline from one manifest.

    python scripts/batch.py concepts --outdir work/farm   # 1-2  text -> concept png
    python scripts/batch.py sheet    --outdir work/farm   #      LOOK at the gate sheet
    #                        stage 3 (Kaggle) is run with kaggle_run.py
    python scripts/batch.py meshes   --outdir work/farm   # 4    glb -> low.glb + normal
    python scripts/batch.py orient   --outdir work/farm   #      LOOK once, record head ends
    python scripts/batch.py paint    --outdir work/farm   # 4b   spec + colour map
    python scripts/batch.py publish  --outdir work/farm   # 5    Open Cloud upload
    python scripts/batch.py studio   --outdir work/farm   # 6    emit the Luau to run

TWO STAGES NEED EYES, and neither is a human clicking a button - both are a
single image the agent reads:

  sheet   the 2D concept gate. Cheap to fix here, expensive later.
  orient  which end of each body axis is the head. Geometry cannot decide this:
          the heuristic is right on a pig (11.3x) and WRONG on a cow (2.3x).
          One sheet settles a whole set. Answers go in _orientation.json.

Sixteen assets one command at a time is sixteen chances to lose track of which
one failed, so state lives in the output directory rather than in the operator's
head. Every stage is resumable: an asset whose output already exists is skipped
unless --force, which matters when stage 3 is metered GPU time.

Layout under --outdir, one folder per asset:

    cow/concept.png     stage 1
    cow/high.glb        stage 3  (from Kaggle or a Space)
    cow/out/low.glb     stage 4
    cow/out/normal.png  stage 4
    cow/out/report.json stage 4
    cow/cow.paint.json  stage 4b  (generated, then hand-tweakable)
    cow/out/color.png   stage 4b
    _contact_sheet.png     every concept in one image, for the verification gate
    _orientation_sheet.png every mesh side-on, for the head-end gate
    _orientation.json      {asset: "min"|"max"}, written by you after looking
    _assets.json           {asset: {model_id, image_id}} after publishing
    _studio_wire.lua       paste into execute_luau, or Studio's command bar
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def find_blender() -> str:
    """Blender executable: $BLENDER, then PATH, then the usual install folders."""
    import os
    import shutil
    env = os.environ.get("BLENDER")
    if env and Path(env).exists():
        return env
    on_path = shutil.which("blender")
    if on_path:
        return on_path
    roots = [os.environ.get("ProgramFiles"), os.environ.get("ProgramW6432"),
             "/Applications/Blender.app/Contents/MacOS", "/usr/bin", "/usr/local/bin",
             str(Path.home() / "blender"), "/opt/blender"]
    for root in (r for r in roots if r):
        base = Path(root)
        hits = sorted(base.glob("Blender Foundation/Blender */blender.exe"), reverse=True)
        hits += [p for p in (base / "Blender", base / "blender") if p.is_file()]
        if hits:
            return str(hits[0])
    raise SystemExit("Blender not found. Install Blender 4.x and either put it on PATH or set "
                     "the BLENDER environment variable to the full path of the executable "
                     "(see LOCAL.md).")


# Pollinations anonymously allows roughly one request per 15s. The FLUX Space has
# no rate limit as such, but hammering an anonymous ZeroGPU queue just collects
# refusals, so a short breath between assets buys throughput rather than costing it.
POLLINATIONS_GAP = 16
SPACE_GAP = 5


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "assets" not in data:
        raise SystemExit(f"{path} has no 'assets' list")
    return data


def selected(manifest: dict, only: str | None) -> list[dict]:
    assets = manifest["assets"]
    if not only:
        return assets
    wanted = {n.strip().lower() for n in only.split(",")}
    picked = [a for a in assets if a["name"].lower() in wanted]
    missing = wanted - {a["name"].lower() for a in picked}
    if missing:
        raise SystemExit(f"not in the manifest: {', '.join(sorted(missing))}")
    return picked


def run(cmd: list[str]) -> int:
    print("  $ " + " ".join(str(c) for c in cmd))
    return subprocess.run(cmd).returncode


def run_quiet(cmd: list[str]) -> tuple[int, str]:
    """Run a command, capture its output. For parallel work, where interleaved
    stdout from several Blenders is unreadable."""
    proc = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_parallel(tasks, jobs: int, label: str):
    """tasks = [(name, callable -> (rc, log))]. Returns (done, failures).

    Per-asset Blender jobs are independent, so a set is embarrassingly
    parallel. Measured on a desktop CPU: the mesh stage is ~14.7s and
    the paint stage ~3.7s per asset, so sixteen assets serially is minutes of
    pure waiting for work that has no reason to be sequential.

    Blender is itself multi-threaded, so more jobs than about a third of the
    core count stops helping and starts thrashing.
    """
    if jobs <= 1 or len(tasks) <= 1:
        done, failures = 0, []
        for name, fn in tasks:
            print(f"\n=== {name} ===")
            rc, log = fn()
            sys.stdout.write(log)
            if rc == 0:
                done += 1
            else:
                failures.append(name)
        return done, failures

    from concurrent.futures import ThreadPoolExecutor
    print(f"[batch] {label}: {len(tasks)} assets across {jobs} parallel jobs")
    done, failures = 0, []
    started = time.time()
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(fn): name for name, fn in tasks}
        for fut in futures:
            pass
        for fut, name in list(futures.items()):
            rc, log = fut.result()
            print(f"\n=== {name} ===")
            sys.stdout.write(log)
            if rc == 0:
                done += 1
            else:
                failures.append(name)
    print(f"[batch] {label} finished in {time.time() - started:.0f}s")
    return done, failures


# --------------------------------------------------------------------------
# stages
# --------------------------------------------------------------------------

def stage_concepts(manifest: dict, outdir: Path, only: str | None,
                   force: bool, backend: str, seed: int) -> int:
    assets = selected(manifest, only)
    style = manifest.get("style", "")
    preset = manifest.get("preset", "prop")
    failures: list[str] = []

    # Index within the WHOLE manifest, not within the --only subset. `seed + i`
    # over a filtered list gives an asset a different seed depending on whether
    # you reran it alone or with the others, so "redo just this one" quietly
    # produced a different object than the one that passed the gate.
    order = {a["name"]: n for n, a in enumerate(manifest.get("assets", []))}

    for i, asset in enumerate(assets):
        name = asset["name"]
        dest = outdir / name / "concept.png"
        if dest.exists() and not force:
            print(f"[{i+1}/{len(assets)}] {name}: concept exists, skipping")
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        prompt = asset["prompt"] + (", " + style if style else "")
        print(f"[{i+1}/{len(assets)}] {name}")
        rc = run([sys.executable, str(HERE / "concept_image.py"),
                  "--prompt", prompt, "--out", str(dest),
                  "--preset", asset.get("preset", preset),
                  "--backend", backend,
                  # A per-asset seed keeps a rerun reproducible while still
                  # giving each animal its own draw.
                  #
                  # An asset may PIN its own seed. The concept gate exists so a
                  # bad draw is caught before GPU time, which means some assets
                  # are only accepted after several tries - and without a place
                  # to record the winning seed, the manifest describes a draw
                  # nobody accepted and a rerun silently ships a different
                  # object than the one that was looked at.
                  "--seed", str(asset.get("seed", seed + order.get(name, i)))])
        if rc != 0 or not dest.exists():
            failures.append(name)

        if i < len(assets) - 1:
            time.sleep(POLLINATIONS_GAP if backend == "pollinations" else SPACE_GAP)

    if failures:
        print(f"\n[batch] FAILED: {', '.join(failures)}")
        return 1
    print(f"\n[batch] {len(assets)} concepts in {outdir}")
    print("[batch] Build the contact sheet and LOOK at it before spending GPU time.")
    return 0


def stage_sheet(outdir: Path, cols: int, cell: int) -> int:
    """One image of every concept, so the gate is a single look, not sixteen.

    Sixteen separate images is sixteen chances to wave one through. Side by side,
    the one with two animals in frame or a cropped tail is obvious.
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise SystemExit("pip install pillow") from exc

    concepts = sorted(outdir.glob("*/concept.png"))
    if not concepts:
        raise SystemExit(f"no concepts under {outdir}")

    rows = (len(concepts) + cols - 1) // cols
    label_h = 28
    sheet = Image.new("RGB", (cols * cell, rows * (cell + label_h)), (32, 32, 36))
    draw = ImageDraw.Draw(sheet)

    for idx, path in enumerate(concepts):
        img = Image.open(path).convert("RGB").resize((cell, cell), Image.LANCZOS)
        x = (idx % cols) * cell
        y = (idx // cols) * (cell + label_h)
        sheet.paste(img, (x, y))
        draw.text((x + 6, y + cell + 7), path.parent.name, fill=(235, 235, 235))

    out = outdir / "_contact_sheet.png"
    sheet.save(out)
    print(f"[batch] {len(concepts)} concepts -> {out}")
    return 0


def stage_meshes(manifest: dict, outdir: Path, only: str | None, force: bool,
                 target_tris: int, texture_size: int, jobs: int = 1) -> int:
    assets = selected(manifest, only)
    missing: list[str] = []
    tasks: list = []

    for asset in assets:
        name = asset["name"]
        high = outdir / name / "high.glb"
        result = outdir / name / "out" / "low.glb"

        if not high.exists():
            missing.append(name)
            continue
        if result.exists() and not force:
            print(f"{name}: low.glb exists, skipping")
            continue

        cmd = [find_blender(), "--background", "--python", str(HERE / "mesh_pipeline.py"), "--",
               "--input", str(high),
               "--outdir", str(outdir / name / "out"),
               # PER-ASSET BUDGET. The manifest's "tris" wins over the global
               # --target-tris. Before 2026-09-28 this stage ignored it, so a set
               # whose enemies were budgeted at 900 tris (80 on screen) would have
               # shipped every one of them at the 6,000 default with exit 0.
               "--target-tris", str(asset.get("tris", target_tris)),
               "--decimate-mode", asset.get("decimate_mode", "collapse"),
               "--remesh-voxel", str(asset.get("remesh_voxel", 0.0)),
               "--min-part-frac", str(asset.get("min_part_frac", 0.002)),
               "--texture-size", str(texture_size),
               "--target-studs", str(asset.get("studs", 0))]
        tasks.append((f"{name} ({asset.get('studs', 0)} studs, "
                       f"{asset.get('tris', target_tris)} tris)",
                      (lambda c=cmd: run_quiet(c))))

    done, failures = run_parallel(tasks, jobs, "meshes")

    if missing:
        print(f"\n[batch] no high.glb yet for: {', '.join(missing)}")
        print("[batch] Run stage 3 (Kaggle or a Space) for those first.")
    if failures:
        print(f"[batch] FAILED: {', '.join(failures)}")
        return 1
    print(f"[batch] {done} meshes processed")
    return 0


def stage_report(outdir: Path) -> int:
    """One table of every asset's real numbers. Skimmable, and it exposes the
    asset that quietly came out at 19,000 triangles."""
    rows = []
    for report_path in sorted(outdir.glob("*/out/report.json")):
        r = json.loads(report_path.read_text())
        rows.append((
            report_path.parent.parent.name,
            r.get("high_tris", 0), r.get("low_tris", 0),
            r.get("uv_coverage", 0),
            "yes" if r.get("normal_looks_baked") else "NO",
            "ok" if r.get("within_working_budget_10k") else "OVER",
            max(r.get("dimensions_studs", [0])),
        ))
    if not rows:
        print(f"no reports under {outdir}")
        return 1

    print(f"{'asset':10} {'high':>8} {'low':>7} {'uv':>6} {'baked':>6} {'budget':>7} {'studs':>7}")
    for name, high, low, uv, baked, budget, studs in rows:
        print(f"{name:10} {high:>8} {low:>7} {uv:>6.2f} {baked:>6} {budget:>7} {studs:>7.2f}")

    bad = [r[0] for r in rows if r[4] == "NO" or r[5] == "OVER"]
    if bad:
        print(f"\nNEEDS ATTENTION: {', '.join(bad)}")
        return 1
    return 0


def _assets_with_mesh(outdir, manifest, only):
    out = []
    for asset in selected(manifest, only):
        if (outdir / asset["name"] / "out" / "low.glb").exists():
            out.append(asset)
    return out


def stage_orient(outdir: Path, cols: int) -> int:
    """Render every mesh side-on with a marker at the +body-axis end."""
    rc = run([find_blender(), "--background", "--python", str(HERE / "orient_sheet.py"), "--",
              "--outdir", str(outdir),
              "--out", str(outdir / "_orientation_sheet.png"),
              "--cols", str(cols)])
    if rc != 0:
        return rc
    path = outdir / "_orientation.json"
    if not path.exists():
        names = sorted(p.parent.parent.name for p in outdir.glob("*/out/low.glb"))
        path.write_text(json.dumps({n: "UNKNOWN" for n in names}, indent=2),
                        encoding="utf-8")
    print("\n[batch] LOOK AT _orientation_sheet.png, then set each entry in")
    print("[batch] _orientation.json to \"min\" or \"max\". Nothing downstream")
    print("[batch] will guess: paint refuses any asset still marked UNKNOWN.")
    return 0


def stage_paint(manifest: dict, outdir: Path, only: str | None, force: bool,
                texture_size: int, jobs: int = 1) -> int:
    orient_path = outdir / "_orientation.json"
    orient = json.loads(orient_path.read_text(encoding="utf-8")) if orient_path.exists() else {}
    assets = _assets_with_mesh(outdir, manifest, only)
    if not assets:
        print("[batch] no low.glb anywhere. Run 'meshes' first.")
        return 1

    # The manifest preset was previously read ONLY by stage_concepts, so every
    # asset got the creature paint spec no matter what the manifest said. That
    # is what put eyes on a gold coin on 2026-08-31.
    default_preset = manifest.get("preset", "prop")

    unknown, tasks = [], []
    for asset in assets:
        name = asset["name"]
        preset = asset.get("preset", default_preset)
        preset = "creature" if preset == "creature" else "prop"
        head = orient.get(name, "UNKNOWN")
        # A prop has no head end, so do not make the operator answer for one.
        if preset == "creature" and head not in ("min", "max"):
            unknown.append(name)
            continue
        if head not in ("min", "max"):
            head = "max"

        folder = outdir / name
        spec = folder / (name + ".paint.json")
        colour = folder / "out" / "color.png"
        if colour.exists() and not force:
            print(f"{name}: color.png exists, skipping")
            continue

        def make(_name=name, _folder=folder, _spec=spec, _head=head, _preset=preset):
            log = ""
            if not _spec.exists() or force:
                rc, out = run_quiet([find_blender(), "--background", "--python",
                                     str(HERE / "make_paint_spec.py"), "--",
                                     "--mesh", str(_folder / "out" / "low.glb"),
                                     "--concept", str(_folder / "concept.png"),
                                     "--out", str(_spec), "--name", _name,
                                     "--preset", _preset,
                                     "--head-end", _head])
                log += out
                if rc != 0:
                    return rc, log
            rc, out = run_quiet([find_blender(), "--background", "--python",
                                 str(HERE / "paint_texture.py"), "--",
                                 "--mesh", str(_folder / "out" / "low.glb"),
                                 "--spec", str(_spec),
                                 "--outdir", str(_folder / "out"),
                                 "--texture-size", str(texture_size)])
            return rc, log + out

        tasks.append((f"{name} (head at {head})", make))

    done, failures = run_parallel(tasks, jobs, "paint")

    if unknown:
        print(f"\n[batch] SKIPPED, head end not recorded: {', '.join(unknown)}")
        print("[batch] Run 'orient', look at the sheet, fill in _orientation.json.")
    if failures:
        print(f"[batch] FAILED: {', '.join(failures)}")
        return 1
    print(f"\n[batch] {done} colour maps painted")
    if done:
        print("[batch] NOW LOOK: render each with scripts/render_check.py before publishing.")
    return 0 if not unknown else 1


def stage_publish(manifest: dict, outdir: Path, only: str | None, force: bool) -> int:
    """Upload each mesh as a Model and each colour map as an Image.

    Image, never Decal. A Decal WRAPS an image and carries a different id, so a
    Decal id assigned to MeshPart.TextureID silently does nothing and the model
    renders grey with no error anywhere.
    """
    import os
    if not os.environ.get("ROBLOX_API_KEY"):
        print("[batch] ROBLOX_API_KEY is not set. Publishing is the only stage that")
        print("[batch] needs it; everything up to here runs without credentials.")
        return 1

    reg_path = outdir / "_assets.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {}
    failures, done = [], 0

    for asset in _assets_with_mesh(outdir, manifest, only):
        name = asset["name"]
        folder = outdir / name / "out"
        colour = folder / "color.png"
        if not colour.exists():
            print(f"{name}: no color.png, run 'paint' first")
            continue
        entry = reg.get(name, {})
        if entry.get("model_id") and entry.get("image_id") and not force:
            print(f"{name}: already published ({entry['model_id']}), skipping")
            continue

        print(f"\n=== publishing {name} ===")
        ok = True
        for kind, path, atype in (("model_id", folder / "low.glb", "Model"),
                                  ("image_id", colour, "Image")):
            if entry.get(kind) and not force:
                continue
            proc = subprocess.run(
                [sys.executable, str(HERE / "upload_asset.py"),
                 "--file", str(path), "--asset-type", atype,
                 "--name", f"Gen_{name}_{atype}",
                 "--description", f"{name}, generated by the ul-3d-model skill."],
                capture_output=True, text=True)
            sys.stdout.write(proc.stdout)
            if proc.returncode != 0:
                sys.stdout.write(proc.stderr)
                ok = False
                break
            tail = [l for l in proc.stdout.splitlines() if "assetId=" in l]
            if not tail:
                ok = False
                break
            entry[kind] = tail[-1].split("assetId=")[1].split()[0]
        if ok:
            reg[name] = entry
            done += 1
        else:
            failures.append(name)
        reg_path.write_text(json.dumps(reg, indent=2), encoding="utf-8")

    if failures:
        print(f"[batch] FAILED: {', '.join(failures)}")
        return 1
    print(f"\n[batch] {done} assets published -> {reg_path}")
    return 0


def stage_studio(outdir: Path, spacing: float) -> int:
    """Emit the Luau that inserts every published asset and textures it."""
    reg_path = outdir / "_assets.json"
    if not reg_path.exists():
        print("[batch] no _assets.json. Run 'publish' first.")
        return 1
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    rows = [(n, v["model_id"], v["image_id"]) for n, v in sorted(reg.items())
            if v.get("model_id") and v.get("image_id")]
    if not rows:
        print("[batch] _assets.json has no complete entries.")
        return 1

    entries = ",\n".join(
        '    {{ name = "{}", model = "rbxassetid://{}", image = "rbxassetid://{}" }}'
        .format(n, m, i) for n, m, i in rows)
    lua = """-- Generated by batch.py studio. Run in EDIT MODE via execute_luau,
-- or paste into Studio's command bar (Ctrl+Enter runs it; plain Enter is a newline).
-- Uses no plugin beyond whatever is executing it.
local ASSETS = {{
{entries}
}}

local folder = workspace:FindFirstChild("GeneratedAssets")
if folder then folder:Destroy() end
folder = Instance.new("Folder")
folder.Name = "GeneratedAssets"
folder.Parent = workspace

local bp = workspace:FindFirstChild("Baseplate")
local groundY = (bp and bp:IsA("BasePart")) and (bp.Position.Y + bp.Size.Y / 2) or 0

local report, x = {{}}, 0
for _, a in ipairs(ASSETS) do
    local ok, objs = pcall(function() return game:GetObjects(a.model) end)
    if not ok then
        table.insert(report, a.name .. ": INSERT FAILED " .. tostring(objs))
    else
        local root = objs[1]
        local part = root:IsA("MeshPart") and root or root:FindFirstChildWhichIsA("MeshPart", true)
        if not part then
            table.insert(report, a.name .. ": no MeshPart in the model")
        else
            part.Parent = folder
            if root ~= part then root:Destroy() end
            part.Name = a.name
            part.Anchored = true
            part.TextureID = a.image
            part.CFrame = CFrame.new(x, groundY + part.Size.Y / 2, 0)
            x = x + part.Size.X + {spacing}
            -- REPORT THE INNER MESH ID. The uploaded id is a MODEL; the mesh
            -- asset it wraps has a DIFFERENT id, and that inner one is the only
            -- thing AssetService:CreateMeshPartAsync accepts. It is discoverable
            -- exactly here, once, and nowhere else - so print it and record it
            -- rather than rediscovering it every time.
            table.insert(report, string.format("%s ok (%s studs) mesh=%s texture=%s",
                a.name, tostring(part.Size), tostring(part.MeshId), tostring(part.TextureID)))
        end
    end
end
return table.concat(report, " | ")
""".format(entries=entries, spacing=spacing)

    out = outdir / "_studio_wire.lua"
    out.write_text(lua, encoding="utf-8")
    print(f"[batch] wrote {out} for {len(rows)} assets")
    print("[batch] Run it with the Studio MCP's execute_luau, in EDIT MODE.")
    print("[batch] If that times out: check a place is OPEN, then check for a")
    print("[batch] second Studio process on the MCP port, then fall back to the")
    print("[batch] command bar. references/traps.md has the full sequence.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("stage", choices=["concepts", "sheet", "meshes", "orient",
                                      "paint", "publish", "studio", "report"])
    ap.add_argument("--manifest", default=str(HERE.parent / "references" / "example-manifest.json"))
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--only", default=None, help="comma-separated asset names")
    ap.add_argument("--force", action="store_true", help="redo work that already has output")
    ap.add_argument("--backend", default="auto")
    ap.add_argument("--seed", type=int, default=100)
    ap.add_argument("--target-tris", type=int, default=6000)
    ap.add_argument("--texture-size", type=int, default=1024)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--cell", type=int, default=320)
    ap.add_argument("--jobs", type=int, default=0,
                    help="parallel per-asset jobs for meshes/paint. 0 picks "
                         "max(1, cores // 3), because Blender is itself threaded.")
    ap.add_argument("--spacing", type=float, default=2.0,
                    help="studs between assets when the studio stage lays them out")
    args = ap.parse_args()

    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    jobs = args.jobs
    if jobs <= 0:
        import multiprocessing
        jobs = max(1, multiprocessing.cpu_count() // 3)

    if args.stage == "sheet":
        return stage_sheet(outdir, args.cols, args.cell)
    if args.stage == "report":
        return stage_report(outdir)
    if args.stage == "orient":
        return stage_orient(outdir, args.cols)
    if args.stage == "studio":
        return stage_studio(outdir, args.spacing)

    manifest = load_manifest(Path(args.manifest))
    if args.stage == "concepts":
        return stage_concepts(manifest, outdir, args.only, args.force,
                              args.backend, args.seed)
    if args.stage == "paint":
        return stage_paint(manifest, outdir, args.only, args.force,
                           args.texture_size, jobs)
    if args.stage == "publish":
        return stage_publish(manifest, outdir, args.only, args.force)
    return stage_meshes(manifest, outdir, args.only, args.force,
                        args.target_tris, args.texture_size, jobs)


if __name__ == "__main__":
    sys.exit(main())
