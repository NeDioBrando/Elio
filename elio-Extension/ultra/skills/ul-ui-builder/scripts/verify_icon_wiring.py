#!/usr/bin/env python3
"""Prove every ImageLabel in a shipped UI tree will actually get a picture.

THE DEFECT THIS EXISTS FOR. On 2026-08-31 a build shipped three empty
ImageLabels in its HUD with every gate green: the icons were generated, cut out
and visible in the mockup PNG, but nobody had uploaded them, so the shipped
`.model.json` carried `Image=""` and the game rendered three blank boxes.

`verify_wired.py` checks for exactly that - an ImageLabel with no Image - by
reading the instance files. THAT CHECK IS WRONG FOR A RUNTIME-RESOLVED UI, and
this script is the right one.

Rojo refuses to serve Content-typed properties, so a UI built through Rojo
CANNOT carry `Image` in its `.model.json` at all. The working pattern is to
strip Image at build time, leave an `IconName` ATTRIBUTE on each ImageLabel, and
have a controller apply the id from a generated bank at runtime. Under that
pattern verify_wired.py reports one FAIL per icon and every one is a false
positive - while the REAL failure it should be catching (an IconName with no
entry in the bank, or an ImageLabel with no attribute at all) is invisible to it.

So this checks the mechanism that actually ships:

  every ImageLabel  ->  has an IconName attribute
  every IconName    ->  resolves to an entry in the generated icon bank
  the bank          ->  has at least one entry, and each is a real asset id

A run that finds ZERO ImageLabels or an EMPTY bank exits 2, not 0. A verifier
that cannot find its own target has failed, not passed - reporting "0 problems"
after matching nothing is how a broken check survives for months.

    python verify_icon_wiring.py --gui src/StarterGui --bank src/shared/Config/UiIcons.luau

Exit codes: 0 all wired, 1 at least one icon will render blank, 2 the check
could not find its target.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

BANK_ENTRY = re.compile(r'^\s*\[?"?(\w+)"?\]?\s*=\s*"(rbxassetid://\d+)"', re.M)


def load_bank(path: pathlib.Path) -> dict[str, str]:
    text = path.read_bytes().decode("utf-8")
    return {name: asset for name, asset in BANK_ENTRY.findall(text)}


def walk(node, path: str, out: list):
    if not isinstance(node, dict):
        return
    name = node.get("name", "?")
    here = f"{path}/{name}"
    if node.get("className") == "ImageLabel":
        out.append((here, (node.get("attributes") or {}).get("IconName")))
    for child in node.get("children") or []:
        walk(child, here, out)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--gui", required=True, type=pathlib.Path, help="directory of *.model.json instance files")
    ap.add_argument("--bank", required=True, type=pathlib.Path, help="the generated icon bank Luau module")
    args = ap.parse_args()

    if not args.bank.exists():
        print(f"FAIL: icon bank not found at {args.bank}", file=sys.stderr)
        return 2
    bank = load_bank(args.bank)

    labels: list[tuple[str, str | None]] = []
    files = sorted(args.gui.glob("*.model.json"))
    for f in files:
        walk(json.loads(f.read_bytes().decode("utf-8")), f.stem, labels)

    missing = [p for p, icon in labels if not icon]
    unresolved = [(p, icon) for p, icon in labels if icon and icon not in bank]
    wired = len(labels) - len(missing) - len(unresolved)

    print(f"icon bank  : {len(bank)} entries ({', '.join(sorted(bank))})")
    print(f"gui files  : {len(files)}")
    print(f"ImageLabels: {len(labels)}   wired {wired}   no attribute {len(missing)}   unresolved {len(unresolved)}")
    for p in missing:
        print(f"  FAIL {p}: no IconName attribute - it will render blank")
    for p, icon in unresolved:
        print(f"  FAIL {p}: IconName '{icon}' has no entry in the bank - it will render blank")

    if not files or not labels or not bank:
        print(
            "\nFAIL: this check matched nothing (no files, no ImageLabels, or an empty bank).\n"
            "That is a failure, not a pass - a verifier must find its own target.",
            file=sys.stderr,
        )
        return 2
    if missing or unresolved:
        return 1

    print("\nevery ImageLabel resolves to an uploaded icon")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
