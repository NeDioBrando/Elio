"""Every dynamic label in the shipped UI must be written by some controller.

    python verify_labels.py --ui src/ui --client src/client

THE DEFECT THIS EXISTS FOR, measured 2026-09-09. The HUD shipped with four
labels that no line of code anywhere could ever write: AmmoCounter had no remote
at all (ammo lived in a server-side table nobody broadcast), and the freezing
panel had three rows fed by a roster that did not carry a frozen flag. They sat
on screen for an entire run rendering their mockup placeholder.

Nothing caught it, and that is the interesting part. `rojo build` passed. 53
specs passed. selene and stylua passed. `verify_ui.py` passed, because it checks
LAYOUT - nothing touching, nothing off-centre - and a dead label is laid out
perfectly. The PNG mockup agreed with the game because both are drawn from the
same tree. Every gate was measuring internal consistency, and a placeholder is
perfectly internally consistent.

So this asks the one question none of them did: for each label carrying the
placeholder, does any client controller mention its name?

It is a static check and it can be fooled by a controller that mentions a name
without writing it. That is fine - it costs nothing and it catches the failure
that actually happened, which is a label with NO reference anywhere at all.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ap = argparse.ArgumentParser(description=__doc__,
                             formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--ui", default="src/ui", help="directory of built *.model.json screens")
ap.add_argument("--client", default="src/client", help="client source tree that must bind them")
ap.add_argument("--sentinel", default="<unbound>",
                help="the placeholder string. It MUST be one the live code can never produce - "
                     "'--' reads as a plausible empty value, which is how four dead labels shipped")
_a = ap.parse_args()
UI_DIR = pathlib.Path(_a.ui)
CLIENT_DIR = pathlib.Path(_a.client)

# The placeholder is deliberately a string the live code can never produce. It
# used to be "--", which reads as a plausible empty value - which is exactly why
# four dead labels looked like "nothing yet" rather than like a bug.
SENTINEL = _a.sentinel


def is_referenced(name: str, src: str) -> bool:
    """Does any controller name this label?

    Two shapes, and the second one is why this function exists rather than a
    single `in` test. A controller may name a label OUTRIGHT ("AmmoCount"), or
    ASSEMBLE it from a row index - `BankRow{i}` .. "Name" - in which case the
    string "BankRow1Name" appears nowhere in the source at all.

    A first version of this check only understood the literal form and reported
    ten working labels as dead. The settlement screen had been seen in game
    listing real sheep names, so the check was wrong, not the code - and a gate
    that cries wolf gets switched off, which is worse than not having it.

    So: split the name on digit runs and require every remaining segment. That
    is weaker for a name whose segments are common words, and it is exact for
    the failure that actually happened - a label mentioned NOWHERE.
    """
    if f'"{name}"' in src:
        return True
    if not re.search(r"\d", name):
        # No index in the name, so there is nothing to assemble it from: the
        # literal is the only way it can be written, and it was not. This is
        # the branch that catches a genuinely dead label.
        return False
    # An indexed name: FrozenRow1 is written as `FrozenRow{i}`, BankRow1Name as
    # `BankRow{i}` .. "Name". Require every non-digit segment.
    return all(seg in src for seg in re.split(r"\d+", name) if seg)


# A label with a GENERIC name is written through its parent: UiController-style
# SetText(screen, "CashLabel", ...) lands in CashLabel's child called "Text".
# Checking the literal "Text" passed trivially - every controller mentions it -
# so a dead Text child under a parent nobody names would sail through. The name
# that must be referenced is the nearest ancestor that is not generic.
GENERIC = {"Text", "Label", "Caption", "Value", "Face", "Title"}


def labels_with_placeholder(node, out, path="", owner=""):
    """Every named node whose Text is the sentinel, with the name that binds it."""
    name = node.get("name", "")
    props = node.get("properties", {}) or {}
    binder = owner if name in GENERIC else name
    if props.get("Text") == SENTINEL and name:
        out.append((binder or name, path + "/" + name))
    for child in node.get("children", []) or []:
        labels_with_placeholder(child, out, path + "/" + name,
                                binder if name and not name.endswith("Cell") else owner)
    return out


def main() -> int:
    if not UI_DIR.is_dir():
        print(f"FAIL: no {UI_DIR}")
        return 1

    client_src = "\n".join(
        p.read_text(encoding="utf-8", errors="replace")
        for p in CLIENT_DIR.rglob("*.luau")
    )

    problems = []
    checked = 0
    for model in sorted(UI_DIR.glob("*.model.json")):
        tree = json.loads(model.read_text(encoding="utf-8"))
        for name, path in labels_with_placeholder(tree, []):
            checked += 1
            if not is_referenced(name, client_src):
                problems.append(f"{model.name}{path}  (name '{name}' appears in NO controller)")

    if checked == 0:
        print("FAIL: no label carries the sentinel - this check matched nothing, "
              "which is a failure, not a pass")
        return 2
    if problems:
        print(f"FAIL: {len(problems)} of {checked} dynamic labels are written by nothing:")
        for p in problems:
            print("  " + p)
        print()
        print("A label nobody writes renders its placeholder for the whole run.")
        return 1

    print(f"PASS: all {checked} dynamic labels are referenced by a controller")
    return 0


if __name__ == "__main__":
    sys.exit(main())
