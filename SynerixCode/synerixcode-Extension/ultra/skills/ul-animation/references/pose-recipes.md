# R15 FK pose recipes — measured angles that work

"Exaggerate" is not actionable. These are the actual numbers from animations that
rendered correctly on the community R15 rig, in the FK convention (**rest = limb
pointing straight down; X negative = forward; Z positive = character's right; 1:1
degrees; both sides identical; child angles COMPOUND with the parent**).

Start here, render the 4-second preview, adjust. Do not derive them again.

## Timing skeleton

| beat | when | ease |
|---|---|---|
| idle / guard | 0% | `in` |
| anticipation | ~16% | `in` |
| chamber (kicks only) | ~40% | `in` |
| **contact** | ~56% | `out` |
| follow-through | ~72% | `smooth` |
| recovery | 100% | `smooth` |

Punch ≈ **0.5s**, kick ≈ **0.8s**, at **30fps**. Make the last pose identical to the
first and the clip loops.

## Arms

| pose | shoulder X | shoulder Z | elbow X | note |
|---|---|---|---|---|
| guard (both) | −34 … −45 | ±18 … 22 | −70 … −75 | shoulder+elbow ≈ **110 total** — that is a fist at chin height |
| guard, tightened (anticipation) | −28 … −46 | ±24 … 30 | −80 … −86 | |
| punch, extended | **−92** | −6 | **−6** | total ≈ 98 → arm straight, just above horizontal |
| off-hand during a kick | −34 … −46 | +38 … 46 | −46 … −66 | flung wide is what reads as effort |
| strike-side arm at kick contact | +38 … +48 | −28 … −34 | −14 … −20 | swung down and back to counterbalance |

**Shoulder + elbow is the number that matters.** Over ~120 total and the forearm
points up over the shoulder — that is what makes hands look wrong.

### Arms ABOVE the head: swing them up SIDEWAYS, not forward-then-spread

Measured 2026-09-29 (a cheer animation), on the community R15 rig, and the Blender
report and the engine agree to 0.1 stud:

| `FK_UpperArm.R` | right hand (x out, z up; head at z 1.0) | reads as |
|---|---|---|
| `[-160, 0, 42]` | x **+0.43**, z 2.13 | fists MEETING over the head |
| `[20, 0, 145]` | x +1.40, z 2.21, slightly forward | **V**, fists pumped |
| `[20, 0, 125]` | x +1.86, z 1.98 | wide V |

Z is "outward" only while the arm hangs. Swing the arm forward past vertical
with X and the same +Z now tips the hand INWARD, so "arms up, spread 42" puts
both fists on the crown. For any overhead pose (cheer, surrender, lift) drive
the rise with Z (~120-150) and use a small POSITIVE X (+15..+25) to bring the
hands just in front. Check with `"report": true` - hand separation is one number.

## Legs (kicking leg, right)

| pose | UpperLeg X | LowerLeg X | Foot X | UpperLeg Z |
|---|---|---|---|---|
| stance, rear leg | +12 | −6 | −6 | +8 |
| anticipation, cocked | +34 | −28 | −6 | +14 |
| **chamber** | **−108** | **+110** | −34 | +14 … 30 |
| **contact** | **−132** | **+4** | −56 | +8 … 12 |
| follow-through | −116 | +18 | −44 | −12 … −14 |

A high kick needs `UpperLeg X` past **−120**. Below about −95 the leg sits at hip
height and **merges with the torso silhouette** on a blocky rig — it stops reading
as a leg at all.

## Support leg

Nearly straight, and **counter-rotate the ankle** or the character stands on an
invisible slope:

```
FK_Foot.X  ≈  −(FK_UpperLeg.X + FK_LowerLeg.X)
```

Typical: `UpperLeg X −4 … +6`, `LowerLeg X +6 … +16`, `Foot X` per the formula.

## Torso

| pose | TORSO Y (twist) | UpTorso Y (twist) | UpTorso X (lean) |
|---|---|---|---|
| guard | −12 | −14 | 0 |
| anticipation (coil away) | −22 … −30 | −28 … −34 | −8 |
| contact | +20 … +26 | +30 … +44 | +28 … +30 |
| follow-through | +26 … +32 | +40 … +52 | +26 |

**Lean and most twist go on `UpTorso`.** `TORSO` drives the legs too — lean it and
the figure topples and the planted foot slides. The rig also **amplifies**: `X=+15`
swings the head 23°.

Follow-through should overshoot contact by roughly **+6 … +10°** of twist. That
overshoot is most of what makes a strike feel like it landed.

## Sanity check

Whole-body rotation past ~55° of combined `TORSO`+`UpTorso` twist starts to read as
falling rather than striking. Budget lean and twist **together**, never separately.
