# roblox-gotchas

Use when: writing Luau for Roblox, or reviewing code for bugs before the user runs it.

- Use task.wait, task.spawn and task.delay. Do not use wait(), spawn() or delay().
- ScaleTo is a Model method. A MeshPart scales by setting .Size.
- WaitForChild with no timeout can block forever. Always pass a timeout.
- A bare pcall hides the error. Capture the message and warn it.
- A method and a cache field with the same name can return the wrong value. Keep names distinct.
- A grounded Humanoid stops scripted velocity. Setting WalkSpeed to 0 is itself a brake.
- A custom animation at Idle priority or above overrides the default walk, run, jump and
  fall on every joint it poses. Author it at Core, or test walking, running, jumping and
  landing with it playing.
- A weapon or any object welded to a body part is checked attached to a character in
  motion, not only in the tool it was made in.
- Any check that cannot find its target must fail. "Not found" is a failure, not a pass.
- Cosmetic effects must never break gameplay. Wrap them in pcall and let them fail quietly.
