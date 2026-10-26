# Joint axes cheat sheet

A Pose's CFrame is the joint's **Transform**: a rotation/offset in the joint's
own space, on top of the rest pose. `rot = {x, y, z}` in the spec is degrees,
built with `CFrame.fromEulerAnglesXYZ` (Rx · Ry · Rz). In practice X is the
"outer" rotation: for an arm, Z first sets how far out to the side it is,
then X swings that whole plane forward. So `{90, 0, 36}` on RightUpperArm
means "forward, angled 36° toward the right".

## R15 (verified in Studio, Oct 2026)

R15 joints have no rotation in C0, so the joint axes match the character's
axes: **X = character's right, Y = up, Z = backward** (forward is −Z).

| Part (pose name) | +X | +Y | +Z |
|---|---|---|---|
| LowerTorso (Root joint, the hips) | lean back | turn to character's LEFT | lean to character's left |
| UpperTorso (Waist) | lean back | twist to the left | bend sideways to the left |
| Head (Neck) | look UP | look LEFT | tilt head to the left |
| RightUpperArm (shoulder) | swing arm FORWARD | twist the arm | raise arm OUT to the side |
| LeftUpperArm | swing arm FORWARD | twist the arm | arm moves INWARD (use −Z to raise it out) |
| Right/LeftLowerArm (elbow) | bend the elbow (forearm forward) | twist forearm | splay (unnatural, keep small) |
| Right/LeftHand (wrist) | flex the wrist | twist the wrist | tilt the wrist sideways |
| Right/LeftUpperLeg (hip) | kick leg FORWARD | turn leg | right leg: out to the side; left leg: use −Z |
| Right/LeftLowerLeg (knee) | **−X bends the knee** (shin goes back) | twist the shin (avoid) | avoid |
| Right/LeftFoot (ankle) | toes up | turn the foot | roll the foot |

Verified in Studio: RightUpperArm +X 90 points the arm straight forward, and
UpperTorso +Y 90 interpolated to a 45° turn at the halfway point. The other
rows follow from the same axes. Check any new pose with `inspect_pose.luau`
rather than trusting the table blindly.

Rules of thumb:
- Mirror right to left by flipping the sign of **Y and Z**; keep X the same.
- Positions (`pos`) are studs in joint space. Use them mostly on LowerTorso:
  `pos = {0, -0.6, 0}` crouches the whole body; `{0, 0, -0.5}` shifts it forward.
- Natural ranges: elbow 0–140°, knee 0–150° (as −X), neck ±60°, waist twist ±45°.
  Going past these looks broken.

## R6 (verified in Studio, Oct 2026: sword slash)

R6 joints have rotated C0s, so the axes are NOT the character's axes. Pose
names are `Torso` (the RootJoint), `Head`, `Right Arm`, `Left Arm`,
`Right Leg`, `Left Leg`.

| Pose | +X | +Y | +Z |
|---|---|---|---|
| Torso (RootJoint) | lean FORWARD | lean to the left | turn LEFT (−Z turns right) |
| Head (Neck) | look DOWN | tilt | look LEFT |
| Right Arm | hanging arm: moves INWARD (−X raises it out) | sweeps a raised arm horizontally (+Y = toward the left) | swing FORWARD/up (165 = overhead) |
| Left Arm | hanging arm: inward (−X out) | as above | swing BACK (−Z is forward) |
| Right Leg | inward | twist | kick forward |
| Left Leg | inward | twist | kick back (−Z is forward) |

- The rotation is Rx·Ry·Rz, so Z (the forward swing) happens first. **Once
  the arm is overhead, the side tilt flips**: with Z≈165, +X tilts the arm
  toward the right shoulder. Test raised poses; don't assume.
- R6 has **no elbows, knees or wrists**. Expressive poses come from the
  torso, the shoulders and, for weapons, the grip joint.
- Torso `pos` is in RootJoint space: **Y− moves the body forward, Z− moves
  it down** (not the usual Y-up).
- The legs hang off the Torso, so every torso turn or lean drags the feet.
  Solve the legs so the feet stay planted: for each torso key, compute
  `Tl = A:Inverse() * Tt:Inverse() * Tstance * A * legStance` where
  `A = RootJoint.C1:Inverse() * Hip.C0`, and write rot (from
  `ToEulerAnglesXYZ`) plus pos. In the slash the feet moved 0 studs across
  every key.
- Standard R6 constants (use these for offline pose math):
  RootJoint C0 = C1 = `CFrame.new(0,0,0, -1,0,0, 0,0,1, 0,1,0)`;
  Right Shoulder C0 = `CFrame.new(1,0.5,0, 0,0,1, 0,1,0, -1,0,0)`,
  C1 = `CFrame.new(-0.5,0.5,0, 0,0,1, 0,1,0, -1,0,0)`.

## Weapons and props

Attach a **copy** of the prop to the rig (leave the user's original alone).
Weld all its parts to the grip part with WeldConstraints, unanchor it, and
make it CanCollide=false and Massless. Join it to the arm with a Motor6D
named `Handle`, using the standard tool grip so the animation matches an
in-game Tool:
`C0 = CFrame.new(0, -1, 0) * CFrame.Angles(-math.pi/2, 0, 0)` (R6 `Right Arm`;
for R15 use `RightHand`). With this grip, the blade points forward out of the
fist when the arm hangs down.

Handle joint axes: +X tilts the blade toward the shoulder (up when the arm
hangs), −X tilts it to continue the arm's line, ±Z swings it sideways.
Keying `Handle` gives the blade angles a wrist would, but **in game the
tool must then be held by a Motor6D named `Handle` (Right Arm → Handle)
instead of the default RightGrip weld**, or the blade keys won't play.
Tell the user this.

Check weapon poses by the **tip position** relative to the root (hand plus
blade direction times blade length), not just the arm direction.

## Custom rigs

The builder reads the Motor6D / AnimationConstraint tree, so any rig works.
Pose names are the **child part names** (Part1 of each joint). Read the joint
C0s first if their axes matter:

```lua
for _, j in ipairs(workspace.MyRig:GetDescendants()) do
  if j:IsA("Motor6D") then print(j.Part0.Name, "->", j.Part1.Name, j.C0) end
end
```
