# luau-performance

Use when: a task touches a per-frame loop, a Heartbeat or other tick, a large loop over world objects, any code that runs for every player, or the user reports lag, stutter or low FPS.

Write the code so the hot path does the least work per frame.
- Cache services and frequently used Instances once, at module top:
    local Players = game:GetService("Players")
  Do not call GetService, FindFirstChild or WaitForChild inside a loop that runs every frame.
- Cache a lookup result in a table keyed by the Instance. Look up once, reuse many times.
- Use CollectionService tags (GetTagged, GetInstanceAddedSignal, GetInstanceRemovedSignal)
  instead of GetDescendants() or a whole-workspace scan that runs repeatedly.
- Do not scan the world every frame. Scan once when something changes, then update the set.
- Avoid allocations in per-frame code: no new tables, closures, strings built with ..,
  or Vector3 and CFrame objects created inside a loop that could reuse a value.
- Build a string from many parts with table.concat on a table, not with .. in a loop.
- Use table.create(n) when the size is known, and table.move to copy slices.
- Use table.freeze on read-only config tables, so a bug that writes to them fails loudly.
- Pick the right event: RunService.Heartbeat or PreSimulation for per-frame logic, and a
  Changed or signal event for "when something changes". A while-true loop with a wait is
  the slowest choice and rarely needed.
- A large number of identical parts is a Model with a Union or a MeshPart, or a
  Terrain/ParticleEmitter setup, not thousands of separate Scripts. Count the Instances
  before and after the change.
- Batch remote traffic. Send one message with a list, not one message per item, and never
  fire a remote every frame when a state change is enough.
- State in the report: what was on the hot path, what you removed, and what you measured
  with luau-profiling. If you did not measure, say the change should help, not that it does.
