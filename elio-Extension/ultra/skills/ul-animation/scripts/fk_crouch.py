"""FK crouch / landing-squash solver: leg angles that keep the feet PLANTED and FLAT.

    python fk_crouch.py 0.10 0.25 0.35            # root drops, in studs
    python fk_crouch.py --forward 0.05 0.30       # ankle may sit 0.05 in front of the hip
    python fk_crouch.py --json 0.30               # one spec-ready bones block

THE DEFECT THIS EXISTS FOR
In FK the legs are children of the root. Dip `ROOT` loc Z to crouch and BOTH FEET
GO DOWN WITH IT - measured on the community R15 rig, ROOT z -0.30 put both feet at
-3.05 against a floor at -2.75. Every numeric probe calls that pose fine (no joint
stretched, the rig is intact) and on the contact sheet it reads as "a slightly
shorter character", because the floor is not drawn. Bending the knees by eye
instead gives feet that slide forward/back or hover on every crouch frame.

The fix is geometry, not tuning: for a root drop d, choose thigh angle a (forward)
and shin angle c (back, from vertical) so that

    L1*(1-cos a) + L2*(1-cos c) = d          (ankle stays at floor height)
    L1*sin a - L2*sin c         = forward    (ankle stays under the hip, default 0)

then FK is   FK_UpperLeg X = -a,  FK_LowerLeg X = a + c,  FK_Foot X = -c
(the last is the "counter-rotate the support ankle" rule, trap 25, solved exactly).

Leg lengths default to the community R15 rig (a free Rigify-style R15 rig) as measured with anim_render's report:
hip->knee 0.82, knee->ankle 0.93. Pass --l1/--l2 for another rig. Verify the output
with `"track": ["RightFoot", "LeftFoot"]` in a dry run: foot z must stay at -2.75.
Keep TORSO rot at 0 while using this - TORSO rotates the legs too and breaks it.
"""
import argparse, json, math


def solve(d, fwd, l1, l2):
    """Bisection on thigh angle a; c follows from the horizontal constraint."""
    def c_of(a):
        s = (l1 * math.sin(a) - fwd) / l2
        return math.asin(max(-1.0, min(1.0, s)))

    def drop(a):
        c = c_of(a)
        return l1 * (1 - math.cos(a)) + l2 * (1 - math.cos(c))

    lo, hi = 0.0, math.radians(100)
    if d > drop(hi):
        raise SystemExit(f"drop {d} is deeper than this leg can crouch ({drop(hi):.2f})")
    for _ in range(60):
        mid = (lo + hi) / 2
        if drop(mid) < d:
            lo = mid
        else:
            hi = mid
    a = (lo + hi) / 2
    return math.degrees(a), math.degrees(c_of(a))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drops", nargs="+", type=float, help="root drop(s) in studs, positive = down")
    ap.add_argument("--forward", type=float, default=0.0, help="ankle offset in front of the hip")
    ap.add_argument("--l1", type=float, default=0.82, help="hip->knee length")
    ap.add_argument("--l2", type=float, default=0.93, help="knee->ankle length")
    ap.add_argument("--json", action="store_true", help="print a spec bones block per drop")
    a = ap.parse_args()
    for d in a.drops:
        th, sh = solve(d, a.forward, a.l1, a.l2)
        up, lo, ft = round(-th, 1), round(th + sh, 1), round(-sh, 1)
        if a.json:
            blk = {"ROOT": {"loc": [0, 0, round(-d, 3)]}}
            for s in ("R", "L"):
                blk[f"FK_UpperLeg.{s}"] = {"rot": [up, 0, 0]}
                blk[f"FK_LowerLeg.{s}"] = {"rot": [lo, 0, 0]}
                blk[f"FK_Foot.{s}"] = {"rot": [ft, 0, 0]}
            print(json.dumps(blk))
        else:
            print(f"drop {d:.3f}: ROOT loc z {-d:+.3f} | UpperLeg X {up:+.1f}  "
                  f"LowerLeg X {lo:+.1f}  Foot X {ft:+.1f}")


if __name__ == "__main__":
    main()
