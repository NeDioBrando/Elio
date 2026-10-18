# vfx-and-animation

Use when: any visual effect, particle, trail, beam, highlight, tween, animation, camera shake, screen flash, UI transition or feedback effect.

Effects make a game feel good. They are cosmetic and must never decide gameplay.
- Effects are client-side. The server sends the event (what happened, where). Each client draws the
  effect. Do not replicate a particle or tween through a remote every frame.
- Keep effects cheap. Use a small pool of effect Instances, reuse them, and hide or disable them
  instead of creating and destroying them on every hit. Use Debris for one-off effects that must go.
- Limit the count: a fixed maximum number of live effects per type. Drop the oldest, or skip the new.
- Tweens: TweenService:Create(instance, TweenInfo.new(time, Enum.EasingStyle.<style>,
  Enum.EasingDirection.<direction>), goal). Cancel a tween before you start another on the same object.
  Keep most tweens under about one second. Use the same easing for the same kind of motion across the game.
- Animation: load animations through the Animator (an AnimationController's Animator or a Humanoid's
  Animator) with LoadAnimation. Set the track's priority on purpose, and stop tracks you no longer need.
  Check that a custom animation does not override the default walk, run, jump and fall unless that is
  the goal (see roblox-gotchas).
- Particles: use a ParticleEmitter with Emit(count) for bursts. Use Enabled for continuous effects,
  and turn it off when the effect is out of view or the object is hidden.
- Trails and beams: Trail and Beam need two Attachments. Clean them up with the object they follow.
- Highlight outlines: a Highlight can outline a model. Limit how many are on screen at once.
- Camera shake and screen flash: do them on the client only. Keep them short, and restore the camera
  and any overlay state when the effect ends, and on respawn.
- UI feedback: scale or fade a button on press with a short tween, and keep the pressed state visible
  without hover. Respect the reduce-motion idea: keep effects short and avoid strong flashing.
- Check the cost: count the effects and the instances an effect adds, and measure with luau-profiling
  when a change touches a per-frame or per-hit path.
- Verify the APIs for every effect class and enum you use (fetch_roblox_doc), and mark any you could not
  confirm with -- UNVERIFIED: <API name>.
- In the report, say what was checked by reading, and what needs a screen capture or a play test to judge.
