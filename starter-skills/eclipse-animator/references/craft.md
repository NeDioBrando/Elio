# Making animations look good

Stiff Roblox animations almost always have the same causes: every part keyed
on the same frames, linear easing, no anticipation, and dead stops. Each idea
below maps to something concrete in the spec.

## Timing at 60 fps (starting points)

| Action | Total | Breakdown |
|---|---|---|
| Light punch / jab | 18–24 f | anticipation 4–6, strike 3–4, hold 2–3, recover 8–10 |
| Heavy swing (sword, hammer) | 36–50 f | wind-up 12–18, strike 4–6, hold 4, recover 14–20 |
| Wave (looping) | 40–60 f per cycle | |
| Idle breathing (looping) | 120–180 f | very small values: torso 2–3°, arms 2–4° |
| Walk cycle (looping) | 30–36 f | contact 0, passing ~8, contact (mirrored) ~16 |
| Run cycle (looping) | 20–24 f | |
| Jump | 30–45 f | crouch 6–8, launch 3, airborne pose, land 6–10 |
| Death / knockdown | 40–70 f | |

Fast actions read as powerful because the strike is short and the
anticipation and recovery are long. If an action feels weak, shorten the
strike frames, not the whole animation.

## The principles, as spec changes

**Anticipation.** Before the main move, go briefly the opposite way. Punch:
pull the fist back and twist the torso away first. Jump: crouch first.
Typically 20–30% of the action's length.

**Easing.** The `ease`/`dir` on a key shape the motion *leaving* that key.
- Strikes and snaps: `Cubic` with `dir = "Out"` (fast start, soft stop).
- Wind-ups and lifts: `Cubic` with `dir = "In"` (slow start, accelerating).
- Settles and floaty moves: `Cubic` with `dir = "InOut"`.
- Impacts that wobble: `Elastic` with `dir = "Out"`, or `Bounce` for a
  landing. Use them sparingly.
- `Linear` only for mechanical motion or constant spins.
- `Constant` to hold a pose and then pop (cartoon snaps, cuts).

**Overshoot and settle.** At the end of a fast move, go 5–15% past the
target, then come back 3–6 frames later. Doing this on the arm alone makes a
punch look much better.

**Offset (follow-through / overlapping action).** Do not key every part on
the same frame. The hips lead, the torso follows 1–2 frames later, then the
shoulder, then the forearm and hand, each 1–3 frames later. Ending frames
should be offset too: the hand settles last.

**Holds.** After the key pose of a strike, hold 2–4 frames: either repeat the
pose, or move it by about 2° so it doesn't look frozen. This is when the hit
reads.

**Arcs.** Limbs move on arcs, not straight lines. Combine two axes (for
example shoulder X with some Z) so the hand travels in a curve.

**Weight.** Heavier things start slower (longer, eased-in wind-up) and stop
harder. A sword swing should drag the torso with it: twist UpperTorso and
LowerTorso 20–40° in the swing direction.

**The hips and the root drive the body.** Most full-body poses need
LowerTorso movement: lowering it (`pos` Y −0.2 to −0.6) plus bent knees
(−X on LowerLeg, +X on UpperLeg) makes a stance look grounded. Keep the
feet planted: if you lower the hips, bend the knees to compensate. For a
simple crouch, UpperLeg +X ≈ half of the knee bend.

**Asymmetry.** Perfectly mirrored poses look robotic. Turn the head
slightly, offset one arm, shift weight to one leg.

**Loops.** For a looping animation, the last key must equal the first key on
every part, and every part should be keyed at both ends. Set `loop = true`.
Offset secondary parts inside the cycle so the loop doesn't "pulse".

## Priorities

`Idle` for idles, `Movement` for walk and run, `Action` for attacks, emotes
and tools (default), `Action2`–`Action4` for things that must override other
actions. An Action animation only overrides the parts it keys, so key
everything the move needs (for example the legs for a stance change).
