"""Self-test: sabotage a known-good map and confirm the prover notices.

A prover nobody has tried to fool is a prover that reports PASS. Every entry
below breaks one thing and names the check that must catch it; a sabotage that
slips through is a hole in the prover, and a sabotage that fires the WRONG check
is just as much of a failure.

Baseline is the duel arena with its ring-out fixed, so P9 starts green and each case
isolates one defect. Several cases are modelled on defects commonly seen in published maps: the
floating jump pad, the sightline wall and the scattered ring.

Run:  python verify_map.py
"""

from __future__ import annotations

import copy
import math
import json
import os
import sys

import prove
import spec as specmod

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)


def baseline():
    with open(os.path.join(SKILL, "specs", "duel_arena.json"), encoding="utf-8") as f:
        s = json.load(f)
    # Apply the fix P9 itself recommends, so the baseline is clean.
    s["volume"]["killPlane"] = -200
    return s


def part(s, pid):
    for p in s["parts"]:
        if p["id"] == pid:
            return p
    raise KeyError(pid)


# --------------------------------------------------------------------------
# sabotages: (name, mutator, check that must fail, expected status)
# --------------------------------------------------------------------------

def sab_float_ledge(s):
    """A shelf declared grounded, floating instead (floating jump pads)."""
    part(s, "Post")["pos"] = [88, 6, 0]


def sab_unreachable_core(s):
    """Delete the only way up the Core."""
    s["parts"] = [p for p in s["parts"] if p["id"] != "Ramp"]


def sab_free_spine(s):
    """Drop the recoil-only prize to somewhere a plain jump reaches."""
    part(s, "Spine")["pos"] = [0, 32, 0]


def sab_undeclared_platform(s):
    """A part nobody declared, reachable off the deck. The 'what is this ramp
    doing in here' defect."""
    s["parts"].append({
        "id": "Mystery", "size": [16, 4, 16], "pos": [50, 4, 50],
        "roles": ["hard_cover"],
    })


def sab_interpenetrate(s):
    """Two parts sharing space."""
    part(s, "Core")["pos"] = [0, 10, 0]


def sab_sightline_wall(s):
    """Wall the arena in until nothing can see anything."""
    n = 0
    for ring_r in (30, 46, 62):
        for k in range(8):
            ang = math.radians(k * 45 + (22.5 if ring_r == 46 else 0))
            s["parts"].append({
                "id": f"Blocker{n}", "size": [34, 40, 5],
                "pos": [ring_r * math.cos(ang), 20, ring_r * math.sin(ang)],
                "yaw": -math.degrees(ang),
                "roles": ["hard_cover", "sightline_break"],
            })
            n += 1


def sab_scattered_ring(s):
    """Move one member of a symmetric ring (randomly placed jump pads)."""
    s["parts"] = [p for p in s["parts"] if p["id"] != "Ledge"]
    for i, (x, z, yaw) in enumerate([(78, 0, 0), (0, -78, 90), (-78, 0, 180),
                                     (20, 75, 270)]):
        s["parts"].append({
            "id": f"Ledge{i + 1}", "size": [26, 3, 14], "pos": [x, -15.5, z],
            "yaw": yaw, "roles": ["crouch_anchor", "pocket", "ringout_edge"],
        })
    s["intent"]["reachable"] = ["Deck", "Ramp", "Core", "Ledge*"]


def sab_invisible_anchor(s):
    """A grapple anchor players cannot see (invisible walls)."""
    part(s, "Spine")["visible"] = False


def sab_shallow_killplane(s):
    """The duel arena's original defect, restored."""
    s["volume"]["killPlane"] = -40


def sab_trap_pocket(s):
    """A pocket with no way back: drop the shelves out of climb range of the
    deck face by making the deck thin and the drop long."""
    part(s, "Ledge")["pos"] = [78, -40.0, 0]


def sab_roleless_part(s):
    """A part that declares no purpose at all."""
    s["parts"].append({"id": "Nameless", "size": [8, 8, 8], "pos": [40, 4, 0]})


CASES = [
    ("floating declared-grounded part", sab_float_ledge, "P1", prove.FAIL),
    ("no route to the Core", sab_unreachable_core, "P3", prove.FAIL),
    ("recoil-only prize reachable by jumping", sab_free_spine, "P3", prove.FAIL),
    ("undeclared reachable platform", sab_undeclared_platform, "P3", prove.FAIL),
    ("interpenetrating parts", sab_interpenetrate, "P6", prove.FAIL),
    ("arena walled in, no sightlines", sab_sightline_wall, "P5", prove.FAIL),
    ("scattered symmetric ring", sab_scattered_ring, "P8", prove.FAIL),
    ("invisible grapple anchor", sab_invisible_anchor, "P4", prove.FAIL),
    ("kill plane too shallow", sab_shallow_killplane, "P9", prove.FAIL),
    ("pocket with no way out", sab_trap_pocket, "P3", prove.FAIL),
]


def run_case(mutator):
    s = baseline()
    mutator(s)
    m = specmod.resolve(s)
    checks, r = prove.run(m, res=4.0)
    return {c.id: c for c in checks}


def main():
    print("BASELINE (duel arena with the kill plane fixed to -200)")
    m = specmod.resolve(baseline())
    checks, r = prove.run(m, res=4.0)
    by = {c.id: c for c in checks}
    base_bad = [c.id for c in checks if c.status in (prove.FAIL,)]
    if base_bad:
        print(f"  baseline is not clean: {base_bad} FAIL. Fix that before trusting "
              f"any result below.")
    else:
        print("  clean, no FAILs\n")

    # The roleless part must be rejected at RESOLVE time, before the prover
    # ever runs. Checked separately because it is not a prover result.
    s = baseline()
    sab_roleless_part(s)
    try:
        specmod.resolve(s)
        role_ok = False
    except specmod.SpecError:
        role_ok = True
    print(f"[{'CAUGHT ' if role_ok else 'MISSED '}] part with no declared role "
          f"(rejected at resolve time)")

    passed = int(role_ok)
    total = 1
    for name, mutator, want_check, want_status in CASES:
        total += 1
        got = run_case(mutator)
        c = got.get(want_check)
        hit = c is not None and c.status == want_status
        # A sabotage that trips a DIFFERENT check is not a pass: it means the
        # prover noticed something, not that it noticed this.
        others = sorted(k for k, v in got.items()
                        if v.status == prove.FAIL and k != want_check)
        passed += int(hit)
        tag = "CAUGHT " if hit else "MISSED "
        print(f"[{tag}] {name:44s} -> {want_check} "
              f"{'=' if hit else '!='} {want_status}"
              + (f"   (also failing: {others})" if others else ""))
        if not hit and c is not None:
            print(f"{'':11s}{want_check} said {c.status}: {c.detail}")

    print(f"\n{passed}/{total} sabotages caught by the intended check")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
