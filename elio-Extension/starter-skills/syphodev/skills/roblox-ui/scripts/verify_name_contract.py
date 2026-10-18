"""Prove the shipped screens carry every name the client code binds to.

    python verify_name_contract.py --gui src/StarterGui --contract ui/name_contract.json

WHY. When controllers are written before the real UI (against a placeholder),
the contract is the NAMES, and the UI stage must satisfy them without touching
the controllers. "I built it with the same names" is a claim; this is the check.
It also checks the SHAPE each binding needs, because a name on the wrong class
fails silently at runtime: a controller doing `if b:IsA("GuiButton")` simply
never connects, and a SetText that finds a Frame with no "Text" child writes
nothing, with no error either way.

Contract file:
  {"screens": {"HUD": {"enabled": true, "elements": {
       "CashLabel":  {"text": true},          # SetText must land (TextLabel/TextButton,
                                              #   or a direct child "Text" that is one)
       "SkipButton": {"button": true, "text": true},
       "CakeBar":    {"children": ["Fill", "Text"]},
       "SlotX":      {"button": true, "paints": true}  # BackgroundColor3 is written:
                                              #   must not be a transparent wrapper
  }}}}

Lookup is recursive and first-match, like FindFirstChild(name, true). A text
binding that would render BEHIND an opaque sibling (a TextButton wrapper whose
own Text is under its Face) is reported: it is set, and nobody sees it.

Exit 0 all satisfied, 1 any unsatisfied, 2 matched nothing.
"""

import argparse
import json
import sys
from pathlib import Path

TEXTY = {"TextLabel", "TextButton", "TextBox"}
BUTTONS = {"TextButton", "ImageButton"}


def find(node, name):
    for c in node.get("children") or []:
        if c.get("name") == name:
            return c
    for c in node.get("children") or []:
        hit = find(c, name)
        if hit:
            return hit
    return None


def child(node, name):
    return next((c for c in node.get("children") or [] if c.get("name") == name), None)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gui", required=True, type=Path)
    ap.add_argument("--contract", required=True, type=Path)
    a = ap.parse_args()
    contract = json.loads(a.contract.read_text(encoding="utf-8"))["screens"]
    bad, ok = [], 0
    for screen, spec in contract.items():
        f = a.gui / f"{screen}.model.json"
        if not f.exists():
            bad.append(f"{screen}: no {f.name}")
            continue
        root = json.loads(f.read_text(encoding="utf-8"))
        if root.get("className") != "ScreenGui":
            bad.append(f"{screen}: root is {root.get('className')}, not ScreenGui")
        if "enabled" in spec:
            got = (root.get("properties") or {}).get("Enabled", True)
            if got != spec["enabled"]:
                bad.append(f"{screen}: ships Enabled={got}, contract says {spec['enabled']}")
        for name, need in spec.get("elements", {}).items():
            el = find(root, name)
            where = f"{screen}/{name}"
            if not el:
                bad.append(f"{where}: MISSING")
                continue
            cls = el.get("className")
            if need.get("class") and cls != need["class"]:
                bad.append(f"{where}: is {cls}, controller checks IsA('{need['class']}')")
            if need.get("button") and cls not in BUTTONS:
                bad.append(f"{where}: is {cls}, controller needs a GuiButton")
            if need.get("text"):
                if cls in TEXTY:
                    if cls == "TextButton" and child(el, "Face"):
                        bad.append(f"{where}: TextButton wrapper - its Text renders "
                                   "BEHIND its Face; use ImageButton + 'Text' caption")
                else:
                    t = child(el, "Text")
                    if not t or t.get("className") not in TEXTY:
                        bad.append(f"{where}: {cls} with no direct 'Text' label child, "
                                   "so SetText writes nothing")
            for kid in need.get("children", []):
                if not child(el, kid):
                    bad.append(f"{where}: no direct child '{kid}'")
            if need.get("paints"):
                if (el.get("properties") or {}).get("BackgroundTransparency") == 1 and child(el, "Face"):
                    bad.append(f"{where}: transparent wrapper round a Face - a runtime "
                               "BackgroundColor3 paints a square box behind it")
            ok += 1
    total = sum(len(s.get("elements", {})) for s in contract.values())
    print(f"name contract: {len(contract)} screens, {total} bindings, {ok} found")
    for b in bad:
        print(f"  FAIL {b}")
    if not total:
        print("FAIL: empty contract - this check matched nothing")
        return 2
    print("PASS: every binding satisfied" if not bad else f"{len(bad)} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
