# Movement numbers

The reference layer for maps is a **numbers table, not a mockup library**. A
dozen measured constants decide every layout question; two hundred reference
screenshots decide none of them, because no image tells you whether a gap is
jumpable.

This is the same conclusion roblox-ui reached, for the same reason.

---

## Derivations (gravity 120, Roblox default JumpPower 50)

These tables use the `wallrun_example` profile (gravity 120). Stock Roblox gravity is
196.2, which gives a 6.37-stud jump apex and an 8.16-stud walking jump instead
(`profiles/default.json`). Always name the profile a map is built against.

| Quantity | Formula | Value |
|---|---|---|
| Jump apex | `v0^2 / (2g)` | 2500/240 = **10.42 studs** |
| Jump airtime | `2*v0 / g` | 100/120 = **0.833 s** |
| Jump distance | `speed * airtime` | see below |
| Time to fall `h` | `sqrt(2h/g)` | |
| Fall height for time `t` | `0.5*g*t^2` | |

### Jump distance by entry speed

| Entry | Speed | Distance |
|---|---|---|
| Walk | 16 | 13.3 studs |
| Sprint | 24 | 20.0 studs |
| Slide entry cap | 32 | **26.7 studs** |
| Slide max (long ramp) | 60 | 50.0 studs |

A frequently quoted "about 27 studs of ground" is the **slide-entry**
case, not a walking jump. A gap sized at 27 studs is crossable only by sliding
into it, which is a design decision, not a default.

### Jump that must gain height

Distance is not `speed * 0.833` when the landing is higher than the takeoff.
Solve `0.5*g*t^2 - v0*t + dy = 0` and take the descending root:

```
t = (v0 + sqrt(v0^2 - 2*g*dy)) / g       range = speed * t
```

`v0^2 - 2*g*dy < 0` means the height simply cannot be gained. At gravity 120
that ceiling is 10.42 studs, whatever the horizontal speed.

| Rise | Airtime | Range at 16 | at 24 | at 32 |
|---|---|---|---|---|
| 0 | 0.833 | 13.3 | 20.0 | 26.7 |
| 4 | 0.767 | 12.3 | 18.4 | 24.5 |
| 8 | 0.617 | 9.9 | 14.8 | 19.8 |
| 10 | 0.500 | 8.0 | 12.0 | 16.0 |
| 10.42 | 0.417 | 6.7 | 10.0 | 13.3 |

---

## Wall tech: a worked example

From one game's movement config, as recorded in `profiles/wallrun_example.json`.

| Quantity | Value | Note |
|---|---|---|
| Climb budget | `ClimbSpeed 14 * Hold 1.0` = **14 studs** | per ground contact, across all climbing AND wall jumping |
| Wall reach | 3.5 studs | probed at 1.5 and 3.0 |
| Max mantle rise | 5 studs | highest lip you can pull onto |
| Green wall jump rise | `40^2/240` = 6.67 studs | within 0.35 s of contact |
| Green wall jump travel | `52 * (2*40/120)` = 34.7 studs | away beats up, deliberately |
| Mini wall jump | 2.02 rise / 11.0 travel | the chaining bounce |

**The climb budget is the ring-out dial.** That game's config says so in its own
comment: it is "meant to be a little less than the height of a comfortable
recovery". Raise it and the arena edge stops being lethal.

A consequence worth knowing before designing any shelf: the duel-arena ledges sit at
y=-14 under a deck at y=0, so the return climb needs **exactly 14.0 of the 14.0
stud budget**. It works with zero margin. The prover reports this as P2b.

---

## The stairs number

Auto-step is about **2 studs**. Anything taller is a wall, not a step.

A Minecraft-to-Roblox conversion hit this: at the correct 3 studs per
block a full block exceeds auto-step, so **stairs and slabs must be emitted as
half-height (1.5 stud) parts** or every staircase is an unclimbable ladder and
the map is not playable. It is roughly twenty lines of code and it is the
difference between a walkable map and a demo.

Note that this is the number the prover is most sensitive to and it is
`assumed`, not measured. Run `calibrate.lua`.

---

## Ring-out arithmetic

```
fall time      t      = sqrt(2 * (edge_y - ringout_y) / g)
control window w      = t - ragdollRecovery
required             w >= minWindow
```

For a counterplay mechanic to exist at all, the window must cover ragdoll
recovery **plus** the time to turn, find an anchor and fire. Roughly 1.0 s of
control is the working figure for a grapple save.

Worked, for the duel arena as first designed (deck y=0, kill plane -40, ring-out fires
at plane+10 = -30):

```
t = sqrt(2 * 30 / 120) = 0.71 s
w = 0.71 - 0.50        = 0.21 s        needs 1.00 s
```

Size the plane off the **lowest** ring-out edge, not the highest. The ledges at
y=-14 are the binding constraint and give only 0.02 s.

---

## Sightlines

Sampled as the fraction of standable-node pairs with an unobstructed line at eye
height. There is no universal correct number, but the band matters:

- **too low** and the map is a maze: cover eats every duel and a sniper never
  gets a shot
- **too high** and there is nowhere to break line of sight, so the best angle
  wins every fight from spawn

The duel arena measures 62% with one central block, which is a reasonable arena figure
and the reason the Core is the only hard cover in the map.
