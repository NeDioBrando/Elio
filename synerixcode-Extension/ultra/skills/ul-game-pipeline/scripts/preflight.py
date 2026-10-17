#!/usr/bin/env python3
"""Report what is actually available before a build starts.

Every row is a live check, never a remembered fact. A stale belief once persisted for six
days that no Open Cloud key existed; the key was there. A build that starts on a
stale belief loses the time at the stage that needed it, which is the worst
possible place to find out.

Anything reported missing is machine-specific: record where it lives in LOCAL.md
(copy LOCAL.template.md) or run the ul-setup-check skill.

REQUIRED rows block the build. OPTIONAL rows only close off one stage, and the
report says which.

    preflight.py              # human-readable table
    preflight.py --json       # machine-readable, for the ledger
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

# The skills folder: ROBLOX_SKILLS_DIR if set, else the folder this skill lives
# in, else the standard Claude Code location.
SKILLS = Path(os.environ.get("ROBLOX_SKILLS_DIR") or Path(__file__).resolve().parent.parent.parent)
if not (SKILLS / "ul-game-pipeline").exists():
    SKILLS = Path.home() / ".claude" / "skills"

# name, required, what it unblocks
STAGE_SKILLS = [
    ("ul-luau-code", True, "code stage: scaffold + the four gates"),
    ("ul-map-builder", True, "map stage: geometry and the reachability prover"),
    ("ul-sfx-finder", True, "sfx stage: Creator Store audio by id"),
    ("ul-ui-builder", True, "ui stage: HUD, menus, icons"),
    ("ul-3d-model", False, "mesh stage: props, animals, weapons"),
    ("ul-animation", False, "animation stage"),
    ("ul-vfx-library", False, "vfx stage: particles"),
    ("ul-texture-gen", False, "colour for meshes (the 3d skill's own texturing is broken)"),
    ("ul-build-orchestrator", False, "the ledger, stall rule and fan-out decision"),
]


def check_cmd(name: str, args: list[str]) -> tuple[bool, str]:
    if not shutil.which(name):
        return False, "not on PATH"
    try:
        p = subprocess.run([name] + args, capture_output=True, text=True, timeout=60)
    except Exception as exc:  # noqa: BLE001 - any failure is the same answer here
        return False, str(exc)[:60]
    out = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()
    line = out[0] if out else ""
    # Aftman shims exit non-zero outside a project that lists the tool. That is
    # not a missing tool, it is a tool that needs a project, so say so exactly.
    if "Aftman error" in line or "no aftman.toml" in line:
        return True, "installed (aftman-managed: run inside a project)"
    if p.returncode != 0:
        return False, line[:60] or f"exit {p.returncode}"
    return True, line[:60]


def check_api_key() -> tuple[bool, str]:
    key = os.environ.get("ROBLOX_API_KEY")
    if not key:
        return False, "ROBLOX_API_KEY unset"
    # A GET for an operation id that cannot exist. Creates nothing, changes
    # nothing. 401 means the key is bad; 404 means it authenticated fine.
    url = "https://apis.roblox.com/assets/v1/operations/00000000-0000-0000-0000-000000000000"
    req = urllib.request.Request(url, headers={"x-api-key": key})
    try:
        urllib.request.urlopen(req, timeout=25)
        return True, "authenticates"
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return True, "authenticates (404 on a nonexistent operation, as expected)"
        if exc.code in (401, 403):
            return False, f"key rejected ({exc.code})"
        return False, f"unexpected HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return False, f"unreachable: {type(exc).__name__}"


def check_toolbox() -> tuple[bool, str]:
    url = "https://apis.roblox.com/toolbox-service/v1/marketplace/3?limit=1&keyword=click"
    try:
        with urllib.request.urlopen(url, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return bool(data.get("data")), "reachable, no auth needed"
    except Exception as exc:  # noqa: BLE001
        return False, f"unreachable: {type(exc).__name__}"


def check_blender() -> tuple[bool, str]:
    """BLENDER env var, then PATH, then the usual install locations per OS."""
    env = os.environ.get("BLENDER")
    if env and Path(env).exists():
        return True, f"BLENDER={env}"
    if shutil.which("blender"):
        return True, "on PATH"
    bases = [
        Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Blender Foundation",
        Path.home() / "blender",
        Path("/Applications/Blender.app/Contents/MacOS"),
        Path("/usr/bin"),
        Path("/snap/bin"),
    ]
    names = ("blender.exe", "blender", "Blender")
    for base in bases:
        if not base.is_dir():
            continue
        for exe in [base / n for n in names]:
            if exe.exists():
                return True, f"{exe} (not on PATH)"
        for child in sorted(base.iterdir(), reverse=True):
            for n in names:
                if (child / n).exists():
                    return True, f"{child.name} (not on PATH)"
    return False, "not found - set the BLENDER env var or add it to LOCAL.md"


def check_place_saved() -> tuple[bool, str]:
    """Studio open with an unrecoverable place is a run that cannot survive a crash.

    One definition only: `place_state.state()`. This function used to carry its
    own copy of the window-title logic, and the copy went wrong in two ways at
    once - it read `MainWindowTitle` (which returned a bare "RobloxStudio"
    helper window over a correctly saved place) and it rejected a PUBLISHED
    place, which is strictly safer than a local file. Both fixed there.
    """
    import place_state  # noqa: PLC0415

    ok, detail, _ = place_state.state(place_state.resolve_place_id(None))
    return ok, detail


def check_kaggle() -> tuple[bool, str]:
    """AUTHENTICATE, do not go looking for credential files.

    Two earlier versions of this check guessed from filenames and both were
    wrong: one demanded KAGGLE_KEY and reported FAIL over a working setup, the
    next found ~/.kaggle/access_token and hedged it as UNVERIFIED when it in
    fact authenticates. The credential shape is the client's business. The only
    question preflight should ask is whether an API call succeeds.

    kernels_list is read-only and creates nothing.
    """
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi  # noqa: PLC0415
    except ImportError:
        return False, "kaggle package not installed (pip install kaggle)"
    try:
        api = KaggleApi()
        api.authenticate()
        api.kernels_list(user=os.environ.get("KAGGLE_USERNAME") or "kaggle", page_size=1)
        return True, "authenticates (kernels API reachable)"
    except (Exception, SystemExit) as exc:  # noqa: BLE001 - kaggle exits when no token is set
        return False, f"not set up (no Kaggle token yet?): {type(exc).__name__}: {str(exc)[:60]}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rows: list[tuple[str, str, bool, bool, str]] = []  # group, name, ok, required, detail

    for name, required, unblocks in STAGE_SKILLS:
        ok = (SKILLS / name / "SKILL.md").exists()
        rows.append(("skills", name, ok, required, unblocks if ok else f"MISSING - blocks {unblocks}"))

    ok, detail = check_cmd("python", ["--version"])
    rows.append(("tools", "python", ok, True, detail))
    ok, detail = check_cmd("rojo", ["--version"])
    rows.append(("tools", "rojo", ok, True, detail))
    for tool in ("wally", "selene", "stylua", "lune"):
        ok, detail = check_cmd(tool, ["--version"])
        rows.append(("tools", tool, ok, True, detail))
    ok, detail = check_cmd("git", ["--version"])
    rows.append(("tools", "git", ok, False, detail))
    ok, detail = check_blender()
    rows.append(("tools", "blender", ok, False, detail + " - mesh, animation and render stages"))

    ok, detail = check_toolbox()
    rows.append(("services", "creator store audio", ok, True, detail))
    ok, detail = check_api_key()
    rows.append(("services", "open cloud key", ok, False, detail + " - upload and publish"))
    ok, detail = check_kaggle()
    rows.append(("services", "kaggle gpu", ok, False, detail + " - mesh generation"))

    ok, detail = check_place_saved()
    rows.append(("studio", "place saved to disk", ok, True, detail))

    if a.json:
        print(json.dumps(
            [{"group": g, "name": n, "ok": o, "required": r, "detail": d} for g, n, o, r, d in rows],
            indent=1,
        ))
    else:
        group = ""
        for g, n, o, r, d in rows:
            if g != group:
                print(f"\n{g}")
                group = g
            mark = "ok  " if o else ("FAIL" if r else "--  ")
            print(f"  {mark} {n:<26} {d}")

    blocking = [n for _, n, o, r, _ in rows if r and not o]
    optional = [n for _, n, o, r, _ in rows if not r and not o]

    print()
    if blocking:
        print(f"BLOCKED: {', '.join(blocking)}")
        print("These are required. Fix them before starting a build.")
    else:
        print("every required check passed.")
    if optional:
        print(f"degraded: {', '.join(optional)} - those stages cannot run, the rest can.")

    # Things no script can check. Say them out loud rather than implying the
    # table is the whole truth.
    print("\nnot checkable from here, confirm by hand:")
    print("  - Studio's BUILT-IN MCP server enabled, and the third-party one OFF")
    print("    (Assistant > ... > Manage MCP Servers > Enable Studio as MCP server;")
    print("     a green indicator means a client connected. See references/mcp.md)")
    print("  - that toggle is still ON: an open bug turns it off after a Studio update")
    print("  - EXACTLY ONE MCP server connected, never two")
    print("  - a universe and place minted by hand, if this run intends to publish")
    print("    (the Universes API cannot create one, and an unsaved place is placeId 0)")
    local = Path(__file__).resolve().parent.parent / "LOCAL.md"
    if not local.exists() or blocking or optional:
        print("\nsetup: your paths and tool locations live in LOCAL.md in the ul-game-pipeline")
        print("  folder" + ("" if local.exists() else " (it does not exist yet)")
              + ". Copy LOCAL.template.md to LOCAL.md and fill it in, or run the")
        print("  ul-setup-check skill, then re-run this check.")
    return 1 if blocking else 0


if __name__ == "__main__":
    raise SystemExit(main())
