# Traps

Every one of these was paid for on a real build. They share a shape: **the code
looks right, nothing errors, and the wrong thing happens quietly.**

---

## A remote payload has three ends

Changing a RemoteEvent's arguments means updating **sender, server relay, and
receiver**. Update two and the untouched middle drops every packet silently.
There is no error, no warning, and nothing in Output.

*Symptom:* the feature does nothing, and the sender's own logging says it fired.

*Fix:* before believing any remote change, grep the arity at all three sites.

```bash
grep -rn "FireServer\|FireClient\|FireAllClients\|OnServerEvent\|OnClientEvent" src | grep EventName
```

Play mode cannot be reached over MCP, so this must be checked statically. It
will not be caught by running the game unless a human plays exactly that path.

---

## Two Rojo connections duplicate every new file

Two or more connected Rojo plugin sessions create each **new** file twice.
Duplicate ModuleScripts appear, `Knit.AddControllers` throws on the duplicate
name, and every controller dies at once - so the symptom is "all my systems
stopped", not "there is a duplicate file".

*Fix:* one `rojo serve`, one plugin connect. After adding new files, count them
in Studio before debugging anything else.

---

## An established connection is not a synced session

An unaccepted "Would you like to connect?" notification in Studio blocked syncing
for an entire session while the TCP connection looked established from outside.
Every edit went nowhere and every theory about why was wrong.

*Fix:* the scaffold puts a **build stamp** in both boot scripts:

```lua
print("[Game] Server started - BUILD scaffold-1")
```

If that exact line is not in Output on Play, Studio is not running the code on
disk, and no edit can possibly take effect. Change the stamp text whenever you
need certainty about which build is live. Checking `get_script_source` for a
line you just wrote proves the same thing without a playtest.

---

## A Knit method named like its cache field returns the function

If a service has a field `self.Foo` and a method `:Foo()`, the lookup resolves to
the method. The caller gets a function where it expected data, type-checking is
happy, and the failure surfaces somewhere unrelated.

*Fix:* prefix internal state with an underscore. `self._foo` and `:Foo()` cannot
collide.

---

## A bare pcall hides the throw

```lua
pcall(function() risky() end)              -- the error is gone forever
```

```lua
local ok, err = pcall(risky)
if not ok then warn(`[Thing] failed inert: {err}`) end
```

Failing inert is correct for cosmetics (standing rule 4). Failing **silently** is
never correct: it turns one broken effect into an hour of debugging the wrong
layer.

---

## A grounded Humanoid fights scripted velocity

The Humanoid state machine runs at 240Hz and it will win.

- Writing `AssemblyLinearVelocity` on a grounded character gets braked to a stop.
- Setting `WalkSpeed = 0` is itself a brake, not a neutral.
- `ChangeState(Enum.HumanoidStateType.Freefall)` is overridden immediately.

*The only thing that holds:* `Humanoid:SetStateEnabled(Enum.HumanoidStateType.Running, false)`
while the impulse is in flight, **with a guaranteed restore** (a Trove entry, or
a `task.delay` set up before the impulse rather than after). Forget the restore
and the player can never walk again, which reads as a completely different bug.

---

## execute_luau drops all output if the script yields

Any `task.wait`, any `PreloadAsync`, any yielding call at all, and the prints and
the return value both vanish. The call reports success.

*Fix:* either split into two calls (do, then read), or schedule the slow part
with `task.delay` and return immediately.

---

## execute_luau caches require

A module required once in plugin context keeps running the old code even after
the file changes. You will "fix" something five times and watch the old
behaviour five times.

*Fix:* verify through `.Source`, not by re-requiring. To force new code, clone
the ModuleScript under a new name, or restart the plugin.

---

## Play mode is uninspectable

During a playtest: `capture_screenshot` is edit-mode only, `execute_luau` still
reports `IsEdit = true, IsRunning = false` and only ever reaches the **edit**
DataModel, `stop_playtest` is unreliable, and `VirtualInputManager` is
unavailable from plugin context.

`LogService` via `get_playtest_output` is the only channel back.

*Consequence:* a human must verify anything that only exists at runtime, and
what they report is real evidence. On a previous build, the single defect that
mattered came from a playtest, not from any automated check, because the test
stage was not a faithful stand-in for a live player character (a whole-model
`Clone()` returns nil on a non-archivable instance, which a stage dummy never
exposed).

---

## A verifier that cannot find its target must fail

A check hardcoded to `MAP = "SkyCitadel"` never ran, reported green, and 361
defective parts shipped underneath it.

**"Not found" is a FAILURE result, never a pass.** Every check must assert that
its target exists before asserting anything about it, and a newly written check
must be scoped and confirmed to be looking at the right thing before its output
is trusted.

Related: a statistic that measures "something happened" is not a statistic that
measures "the right thing happened". Both are green. Only one is true.

---

## Rig and welding traps

- **Motor6D, not Weld**, for anything the Animation Editor must pose. A Weld is
  ignored by animation.
- **Never move a welded model by setting part CFrames.** Clone it unparented,
  then `PivotTo`.
- **Make `C0` idempotent.** A weld routine that runs twice and compounds its own
  offset drifts a little further every respawn.
- `PivotTo` ignores `WorldPivot` when `PrimaryPart` is set, and `ScaleTo` is
  absolute and uniform, not a multiplier.

---

## Luau specifics worth knowing

- `task.wait()` returns the elapsed time; `wait()` is deprecated and less precise.
- `continue` exists in Luau loops. `goto` does not.
- String interpolation is backticks: `` `hit {n} times` ``.
- `+=`, `-=`, `*=` exist. `++` does not.
- **Validate remote payloads with `typeof()`, never `type()`.** Measured in
  Studio: `type(Vector3.new())` is `"vector"`, while `type(CFrame.new())` and
  `type(Color3.new())` are both `"userdata"` - so a `type()` check cannot tell a
  CFrame from a Color3, and an exploiter sending the wrong one passes. `typeof()`
  returns the real class name for all three.
- `--!strict` at the top of every file. The scaffold sets `languageMode: strict`
  in `.luaurc` so the whole project is checked, not just the annotated parts.
