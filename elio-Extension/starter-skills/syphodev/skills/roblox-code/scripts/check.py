#!/usr/bin/env python3
"""Run every gate that can be run without Studio, in cost order.

    1. rojo build     does the whole project parse and assemble?   (~1s)
    2. lune run test   does the pure logic still do what it claims?
    3. selene          lint
    4. stylua --check  format

Order matters: gate 1 is the cheapest and catches the largest class of error
(a syntax error anywhere, a bad $path, a file Rojo will not accept). There is no
point running tests against a project that cannot be built.

None of these open Studio. That is the point - a change is wrong on disk before
it is ever wrong in a game, and disk is where it can be checked in a second.

    check.py                 # all gates, from the project root
    check.py --fix           # let stylua rewrite instead of failing
    check.py --dir ~/Projects/CoinDash
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RESET, RED, GREEN, DIM = "\033[0m", "\033[31m", "\033[32m", "\033[2m"


def run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
    except FileNotFoundError:
        return 127, f"{cmd[0]} not found on PATH"
    except subprocess.TimeoutExpired:
        return 124, f"{cmd[0]} timed out after 600s"
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def report(name: str, code: int, out: str, verbose: bool) -> bool:
    ok = code == 0
    mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  {mark}  {name}")
    if not ok or verbose:
        for line in out.strip().splitlines()[-40:]:
            print(f"        {DIM}{line}{RESET}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=".", help="project root (default: cwd)")
    ap.add_argument("--fix", action="store_true", help="stylua rewrites instead of failing")
    ap.add_argument("--verbose", action="store_true", help="show output from passing gates too")
    ap.add_argument("--skip-lint", action="store_true", help="gates 1 and 2 only")
    a = ap.parse_args()

    root = Path(a.dir).expanduser().resolve()
    if not (root / "default.project.json").exists():
        raise SystemExit(f"no default.project.json in {root} - is this a Rojo project?")

    print(f"gates for {root.name}")

    if not (root / "Packages").exists():
        print(f"  {RED}FAIL{RESET}  Packages/ is missing - run `wally install` first")
        return 1

    results: list[bool] = []

    with tempfile.TemporaryDirectory() as tmp:
        out_file = str(Path(tmp) / "check.rbxl")
        code, out = run(["rojo", "build", "-o", out_file], root)
        results.append(report("rojo build      (parse + assemble)", code, out, a.verbose))
        if code != 0:
            # Everything downstream reads the same files. Stop here: a build
            # failure makes the rest of the output noise, not signal.
            print("\nbuild failed - fix that before anything else.")
            return 1

    if (root / "tests").is_dir() and any((root / "tests").glob("*.spec.luau")):
        code, out = run(["lune", "run", "test"], root)
        # Print the tail always: a green suite's count is worth seeing.
        results.append(report("lune run test   (headless logic)", code, out, True))
    else:
        print(f"  {DIM}skip  lune run test - no tests/*.spec.luau{RESET}")
        print(f"        {DIM}pure logic with no spec is untested logic{RESET}")

    if not a.skip_lint:
        if shutil.which("selene"):
            code, out = run(["selene", "src"], root)
            results.append(report("selene          (lint)", code, out, a.verbose))
        else:
            print(f"  {DIM}skip  selene not on PATH (aftman install){RESET}")

        if shutil.which("stylua"):
            targets = ["src"] + (["lune"] if (root / "lune").is_dir() else [])
            cmd = ["stylua"] + ([] if a.fix else ["--check"]) + targets
            code, out = run(cmd, root)
            label = "stylua          (format, rewritten)" if a.fix else "stylua --check  (format)"
            results.append(report(label, code, out, a.verbose))
            if code != 0 and not a.fix:
                print(f"        {DIM}re-run with --fix to apply{RESET}")
        else:
            print(f"  {DIM}skip  stylua not on PATH (aftman install){RESET}")

    failed = results.count(False)
    print()
    if failed:
        print(f"{RED}{failed} gate(s) failed.{RESET}")
        return 1
    print(f"{GREEN}all gates green.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
