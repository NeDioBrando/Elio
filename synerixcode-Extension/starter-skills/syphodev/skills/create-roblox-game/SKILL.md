---
name: create-roblox-game
description: Take a Roblox game from a genre to something built, assembled, playable and published, ONE SECTION PER SESSION - research and plan, code, art, animation and sound, playtest, publish - with a HANDOFF.md between sessions so the chat can be cleared after each approved section. Drives the whole toolchain - market research, a design contract, the code project, map, meshes, textures, UI, animation, VFX and sound, then assembly in Studio, playtest and publish. This is the FRONT DOOR: it owns research, design and assembly itself and delegates each asset stage to the skill that already proves that stage. Use whenever the user wants a Roblox game made, built, started or prototyped, says "make me a game" or names a genre to build (incremental, battlegrounds, ...), asks to "complete the research and plan stage" or any other stage, says "continue with the development of the <genre> game", approves a finished stage ("approved", "looks good"), or asks what is still missing before a game can be built.
---

# Make a Roblox game, end to end

> **First time on this machine?** Read `LOCAL.md` in this folder. If it does not exist, run the
> `roblox-skills-setup` skill (or copy `LOCAL.template.md` to `LOCAL.md` and fill it in).
> `LOCAL.md` holds your paths and tool locations; it is yours and is never shared.

## START HERE. EVERY RUN IS ONE SECTION PER SESSION. THIS IS THE DEFAULT.

A game is built in six sections. You approve each one, then **clear the chat**
before the next. So the first thing the agent does, before reading further, is
map the prompt to a command and run it:

| You say | The agent runs first |
|---|---|
| "complete the research and plan stage" (optionally naming a genre) | `section.py brief "research and plan"` - a NEW game, section 1 |
| "complete the <art / code / sound / ...> stage" | `section.py resume --game "<words from the prompt>" --expect <that section>` |
| "continue with the development of the incremental game" | `section.py resume --game "continue with the development of the incremental game"` |
| "approved" / "looks good" (after a section closed) | `section.py approve N --dir <game>`, then say it is safe to clear the chat |

`S=~/.claude/skills/create-roblox-game/scripts/section.py`. `resume` finds the
game from the words alone (genre, title, folder name), reads out `HANDOFF.md`,
and prints the next section's scope, exit gate and rules. **Read `HANDOFF.md` in
full before any work.** Do one section, pass `section.py close N`, stop, and ask
for approval. Never start the next section in the same session.

**The only way to get a one-shot, whole-game run is the user asking for one
explicitly** ("build the whole game in one go"). Anything else is section mode.

---

One prompt in, a built and assembled game out. This skill owns the three stages
nothing else does - **research, design and assembly** - and delegates every
asset stage to the skill that already proves it.

```
prompt
 0 preflight    what is actually available today, checked live
 1 research     research the named genre (or pick one), argue, cite what was read
 2 design       -> design/game.json      THE CONTRACT
 2a game plan   -> game.json plan         23 sections, answered OR declined
 2b asset plan  -> game.json asset_plan   WHAT THE GAME NEEDS, per entity
 3 code         roblox-code              scaffold + four gates
 4 map          roblox-map               proven greybox/terrain layout (spec, plan, prover)
 5 meshes       roblox-3d-model          + roblox-texture-gen for colour
 6 ui           roblox-ui
 7 animation    roblox-animation
 8 vfx          roblox-vfx
 9 sfx          roblox-sfx
 9b integrate   ONE thread - every seam the asset plan named
 10 assembly    ONE thread, Studio, rojo serve
 11 playtest    a human
 12 publish     Open Cloud
```

**What the map and VFX stages are in this pack.** The map stage produces a
proven greybox/terrain layout: a spec, a plan image, the reachability prover
and the emitted build. It does not dress the map. Props (trees, rocks,
furniture, scenery) come from your own models or from the `roblox-3d-model`
skill, and "every prop is a real mesh, not a stack of primitive parts" is a
check you make at stage 9b. The VFX stage is harvest-only: effects come from a
library you build yourself by harvesting free Creator Store VFX packs you took
into your own account with `roblox-vfx`. No effects ship with the pack, so
if your library is empty the first step of the VFX stage is to harvest a pack
(see the `roblox-vfx` skill), not to hand-write emitters.

Stages 4 to 9 are the asset block: mutually independent, all downstream of the
contract. They are the only part that may be parallelised, and as of 2026-09-02
they ARE, by default - one `roblox-asset-*` worker each. See "Fan out the asset
block" under Running it for the measurement that changed this.

Everything else is single-threaded. Stages 10 to 12 by law, because the DataModel
is single shared mutable state and this project has already lost a day to that
twice. Stages 0 to 2b because they are the design judgment the whole run depends on. And stage 9b because a defect at the seam between two stages is
invisible to both of the workers that produced them.

---

## SECTION MODE IN DETAIL

**The build is not a one-shot.** A 5-hour Claude Code usage limit cannot carry
the whole pipeline, so it is prompted in six sections: you approve each one, then
**clear the session** before the next. You may say "stage"; the script says
"section"; they are the same thing.

| Section | Pipeline stages | Suggested budget |
|---|---|---|
| 1 Research and design | 0 preflight, 1 research, 2 design, 2a plan, 2b asset plan | 45 min |
| 2 Code and the playable loop | 3 code, 4 map **blockout**, play the loop on placeholder art | 1.5 h |
| 3 World and visuals | 4 map (full proven layout), 5 meshes + colour + materials, 6 ui | 1 h |
| 4 Motion and sound | 7 animation, 8 vfx, 9 sfx | 1 h |
| 5 Assembly and playtest | 9b integration, 10 assembly, 10b wiring, 11 playtest + self-correction | 45 min |
| 6 Publish | 12 publish, live-server check | 15 min |

The blockout rides with code because the loop is played before art is built;
the full map rides with the other visual assets; VFX rides with motion and sound.

**Everything is in one script, so none of it depends on this paragraph being read:**

```bash
S=~/.claude/skills/create-roblox-game/scripts/section.py
python $S brief "research and plan"    # a number or the stage's words: scope, exit gate, rules
python $S resume --game "<prompt words>"   # FIRST command of every later session
python $S resume --game "<words>" --expect N   # refuses if N is not the next section
python $S handoff N --dir <game> [--ledger <run dir>]   # HANDOFF.md skeleton
python $S close N --dir <game>         # the gate. Stop only after it passes
python $S approve N --dir <game>       # you approved: safe to clear the chat
```

Every game that has had a handoff is recorded in
`.section-games.json` inside your games folder (`ROBLOX_GAMES_HOME`, default
`~/Projects/Roblox-Games`; set it in `LOCAL.md`), so `resume --game` finds it even
when the game's own folder lives elsewhere. With no matching words and more than one
unfinished game it refuses rather than guess. `close` clears any earlier approval
(a re-close after changes needs a fresh one), and a `resume` after an unapproved
close records the approval as implied by continuing.

`close` refuses while any `TODO:` survives in `HANDOFF.md`, while this section's
ledger stages are not bracketed, while the stages it owns are not `done` with
artifacts on disk, or while the section's own gate is red (validate.py for 1,
roblox-code `check.py` for 2, `--stage-gate` + `verify_wired.py` + `HANDOVER.md`
for 5, recorded publish ids for 6). Earlier handoffs are archived to
`design/handoffs/`, never overwritten, because section 5 still needs section 1's
reasons.

**What section mode changes in this skill, and what it does not:**

- **The first rule below still holds, scoped to the section.** Inside a section
  you do not stop, summarise or check in. The one new stopping point is
  `section.py close N` passing. Then you stop, and you do not start the next
  section even with budget left.
- **Stay inside Claude Code and Roblox Studio.** These are the working rules of a
  section, so the run must never need them broken: no browser-driving tools and no
  web-GUI generators (WebSearch and WebFetch are fine), never ask the user to leave
  Claude Code or Studio, and **never ask the user to enter anything in Studio by
  hand.** Screen access is for Studio only. The free asks are Play/Stop,
  Publish, approving a tool call, restarting a stuck MCP, and anything purely
  mechanical nothing of yours can reach.
- **Never offer options.** Choosing between them is an intervention under the
  project's protocol. Decide, and say why.
- **The genre is fixed when the prompt names one.** A named genre ("an
  incremental game", "a battlegrounds game") is the brief and is not an
  intervention. Research THAT genre and make every call inside it yourself:
  theme, twist, core loop, scope. Only when no genre is named do you pick one.
  One game folder and one ledger run per game.
- **Log interventions as they happen** with `run_log.py event --kind
  intervention`. Approving a section is free. Changes the user asks for that name
  WHAT is wrong count; make them, log it, update `HANDOFF.md`, close again.
- **The user's approval ("approved", "yes that's all good") is the gate.** Run
  `section.py approve N`, tell the user it is safe to clear the chat and what to
  say next, and do nothing else.
- **The ledger is initialised once, in section 1.** `run_log.py init` refuses an
  existing run, and its default `--dir` is relative to the working directory, so
  every later call passes the absolute `--dir` and `--run` from `HANDOFF.md`.
- **Screen access is asked for at the start of EVERY session**, not once per run.
  A grant does not survive a cleared session.
- **Save the place at every section close.** A crash between sessions is the
  same loss as a crash mid-run.
- **Fan-out is allowed inside sections 3 and 4**, and every worker is fanned in
  and its manifest checked before `close`. A worker still running when the
  session is cleared is a lost stage.

The same rules are printed by `brief`/`resume` and copied into every
`HANDOFF.md`, so a cold session gets them from the file.

---

## THE RUN DOES NOT STOP UNTIL THE GAME IS COMPLETE. THIS IS THE FIRST RULE.

**You may not hand back, summarise, or ask what to do next while the game is
not finished. Not after a stage. Not after a good find. Not after a long
stretch of work. Not to report progress. If the game does not yet run and play
end to end, the only correct next action is to keep building it.**

Written 2026-09-09 because a run stopped SIX TIMES with the game unplayable,
each time with a tidy account of what had been fixed, and each time the user had
to ask why it had stopped. Every one of those stops felt justified from
inside the run - a stage had landed, a hard bug had been diagnosed, a budget
looked tight. From outside, the deliverable was an unfinished game and a
paragraph about it.

**What "complete" means, and it is not negotiable:**

1. Every stage in the pipeline has run and produced its artifact.
2. `validate.py --stage-gate` and `verify_wired.py` are both green.
3. The game BOOTS in Studio, and the build stamp is in the Output.
4. A run can be **played from start to finish**: the loop begins, the core verb
   works, every screen the design names opens, and the run reaches its end
   state. Not "the systems exist" - PLAYED.
5. The pre-handover matrix in `HANDOVER.md` is filled in, every row measured or
   explicitly UNTESTED.

Until all five hold, there is nothing to report. Keep working.

**In section mode the same rule applies to the section:** until `section.py
close N` passes there is nothing to report. When it passes, stop there.

**The two things that are still allowed to interrupt a run**, and only these:

- A question whose answer changes what gets built and that you cannot settle
  from the brief, the code or a sensible default. Ask it in one line and carry
  on with everything that does not depend on the answer.
- A genuine blocker outside your reach: a credential you do not have, an API
  that is down, a decision that is legally or financially the user's. Say what
  is blocked, say what you did with the rest, and keep going on the rest.

"I have used a lot of budget", "this is a good stopping point", "the next part
is large" and "I should check in" are **not** blockers. Neither is a stage
boundary. If you find yourself writing a summary, check first whether the five
conditions hold; if they do not, delete the summary and go back to work.

**AND "I CANNOT VERIFY THIS" IS NOT A BLOCKER EITHER. IT IS AN INSTRUCTION TO
FIND A CHEAPER WAY TO VERIFY.** Added 2026-09-09 after a run spent four sessions
and most of a weekly budget and still handed back a broken game. The first
attempt at fixing that made this rule softer - it added an escape hatch for
"nothing I build can be checked" - and that was the wrong lesson, because a run
that stops is exactly what this rule exists to prevent. **The problem was never
that the run should have stopped. It was that the run chose the most expensive
possible way to look at things and then ran out of budget.**

Verification being blocked means the METHOD is wrong, not that the run is over.
Climb down the ladder in `THE RUN HAS A TOKEN BUDGET` - a static check, a
`execute_luau` probe returning a table, a numeric verdict - and keep building.
Measured on that run: the question "did the skinned meshes upload correctly"
was answered by ONE probe for about 300 tokens, after roughly twenty screenshots
had failed to answer it. The cheap path was available the whole time.

If the tool itself is broken - Studio wedged, the plugin on the wrong DataModel -
**resetting the tool is cheap and fighting it is not.** Restart it and carry on.

**A partial game is worth less than the sum of its parts.** Meshes with no game
around them, a map nobody can walk, a HUD bound to nothing - each of those is a
sunk cost until the loop closes. Stopping early does not bank the work, it
strands it.

---

## Read this before promising anything

**The run is not done when the gates are green. It is done when every fighter,
weapon, move, effect, screen and sound has been exercised in a TWO-PLAYER
playtest and the result written down.** See "NOTHING SHIPS UNTESTED" below - it
is a filled-in matrix in `HANDOVER.md`, not a feeling, and a row that could not
be tested says UNTESTED rather than nothing.

Checked live on 2026-08-30, not remembered:

| Stage | State |
|---|---|
| research, design, code, map, ui, sfx, vfx, assembly | **Ready.** Every one has proven tooling. The vfx stage needs a harvested library of your own (see below) |
| animation | Ready. `RegisterKeyframeSequence` ids are session-local, and that is ACCEPTED: you right-click and save the animations at the end. A game testable in Studio counts as created, so this is not a blocker |
| meshes | Ready end to end, upload included - proven 2026-08-26 with a cow and a pig, painted and uploaded. ~102 GPU-s per asset on Kaggle. Upload as `Model` never `Mesh`, texture as `Image` never `Decal` |
| meshes: colour | **Ready. PAINT it** (`paint_texture.py`), which is exact because there is no camera to align. The older concept-*projection* route is the broken one and is only for assets that need the concept's actual markings |
| meshes: Kaggle | **Authenticates.** Verified by a live `kernels_list` call |
| playtest | **Studio's built-in MCP does have working play-mode tools.** The play-mode wall measured on this project belongs to the *third-party* server. See `references/mcp.md` - switch servers before build day |
| publish | `ROBLOX_API_KEY` authenticates. The universe and place are **yours to mint by hand**, once, which the pipeline's own rules already count as a free intervention |

So: **the pipeline is ready end to end**, with one human action at the start
(mint the universe and place) and one at the end (press publish, invite people).
Nothing in between needs a human: a dropped MCP link, a duplicated server or a
crashed Studio are all repaired from the screen by the run itself. See
`references/recovery.md`.

**The one prerequisite for that: the place must be SAVED TO DISK before the run
starts and re-saved at every stage boundary.** An unsaved `Place1` at `placeId 0`
cannot be reopened after a crash, and everything in it is gone.

Reading the RUNNING game: the built-in MCP's `execute_luau` runs in the Edit
DataModel by default, which is separate from the game. During Play, target the
game's own DataModels instead with `scripts/studio_mcp.py luau --dm Server` (or
`--dm Client`). Still print from game code and collect it with
`get_console_output`: a log survives a crash and a probe does not.

Run the check rather than trusting this table, because the table ages:

```bash
python ~/.claude/skills/create-roblox-game/scripts/preflight.py
```

---

## The contract is the whole design

```bash
python ~/.claude/skills/create-roblox-game/scripts/new_game.py "My Game" --dir <your games folder>/MyGame
```

That lays down the `roblox-code` scaffold (by calling that skill's own
scaffolder, so there is one definition of a project and never two) plus
`design/game.json` and one stub spec per stage.

**Every stage reads a slice of one document.** The map skill reads
`design/map.json`, the sfx skill reads `design/sfx.json`, the code stage reads
`systems` and `config`. That is the same architecture `roblox-ui` and
`roblox-map` already use internally - one resolved tree, so the preview cannot
disagree with what ships - lifted up to the whole build.

`game.json` ships full of `TODO` markers on purpose:

```bash
python ~/.claude/skills/create-roblox-game/scripts/validate.py
```

fails while any survive. Every asset skill in this toolchain does something
*plausible* when handed a vague spec, and plausible is the expensive failure: it
produces files, the stage looks finished, and the defect surfaces at assembly or
in a playtest hours later. So the contract is checked before anything is called.

`validate.py --stage-gate` additionally refuses a stage marked `done` whose
artifact is not on disk. Tested: it catches the lie.

---

## The rules that make a run finish

**One core loop.** No progression, no shop, no datastore. `out_of_scope` is a
required field precisely so someone has to write down what they are not
building. Scope creep is the named risk on this project.

**Tier 2 first, and the fallback is pre-authorised.** Attempt the ambitious path,
let it fail, drop to the fallback without asking. An agent stopping to ask
permission to fall back is an intervention caused by an incomplete brief.
On sound this is now settled the other way round: the Creator Store **is** the
correct answer, not a fallback, and `roblox-sfx` explains why.

**30-minute stall rule.** One problem eats 30 minutes, take the pre-authorised
fallback so the run keeps moving, and log it.

**That protects the RUN, not the FIX.** The fallback is not permission to ship
the defect. Every stalled problem is healed before the run is called done -
always, with no exception. Measured 2026-08-31: the mesh stage stalled, fell
back, and the build shipped with Cylinder coins. The cause was a missing
`import os` in a vendored repo; one hour once, and every run afterwards has real
meshes. `run_log.py debts` gates on this and a run is not finished until it is
clean. **It lives in `roblox-build-orchestrator/scripts/`, not here** - a bare
`run_log.py` was looked for in this skill's own scripts, not found, and briefly
written off as a gate that did not exist.

### THE LOOP IS PLAYED BEFORE THE ART IS BUILT. THIS IS AN ORDERING RULE, NOT A SCOPE ONE.

**Stage 3 code, stage 4 map blockout, then PLAY IT. A human moves, the core verb
works, the round starts and ends. Only then do stages 5-9 run.** Placeholder
parts are the correct look for that playtest.

**"Every stage runs" and "the loop is played first" are not in conflict, and
confusing them cost one project most of its budget.** That game was scoped as
full V1, all stages, at the user's explicit instruction - and the agent wrongly read that
instruction as dictating ORDER as well as SCOPE. So meshes, textures, animations,
VFX, SFX and UI art were all built against a loop nobody had ever played. When it
was finally played, the flock spawned behind the camera and four HUD labels were
bound to nothing. Both are ten-minute findings in hour one. Both were found in
week two, after everything expensive had been built on top of them.

The project's own design doc had mandated a grey-box prototype first, for exactly this
reason. **If the user overrules the prototype, that changes what gets built, not
what order it gets built in - and if you think it changes the order, say so and
let them decide, because they are choosing on your framing.**

Cost, not taste, is the argument here. Art built on an unverified loop is art
that may have to be rebuilt, and rebuilding is the most expensive thing a run
does. Five artifacts on this project were built complete and then discarded.

### A TOOL YOU WRITE DURING A RUN BELONGS TO THE SKILL, NOT TO THE PROJECT.

**Before a stage is done: any script it needed that would help the NEXT build is
copied into the owning skill's `scripts/`, parameterised so it takes paths as
arguments. A tool left in `<project>/tools/` dies with the project.**

Written after a user asked the obvious question: why had new tools not been
baked into the skill? They were
right, and the gap was in this file: nothing said where a new tool goes,
so every one of them was written to solve today's problem in today's project and
left there. That run produced eight genuinely reusable scripts - a skinned
quadruped exporter, a map mesh bake, a Rojo-safe rbxmx bake, a
dead-label gate proven to catch its own defect - and every one of them was
sitting in an abandoned project's `tools/` directory. The next run would have
rebuilt them from scratch, badly, exactly as they were built badly the first time.

The existing rule ("the pipeline must live in files") only says *put it in a
file*, and a project file satisfies that. This is the missing half.

**Where things go:**

| Kind of tool | Home |
|---|---|
| Blender, mesh generation, rigging, export, upload | `roblox-3d-model/scripts/` |
| Map layout, provers, rbxmx baking | `roblox-map/scripts/` |
| GUI emitters and UI gates | `roblox-ui/scripts/` |
| Animation authoring and pose verification | `roblox-animation/scripts/` |
| Contract, stage gates, orchestration, recovery | `create-roblox-game/scripts/` |

**Three conditions on the promotion, or it is not worth doing:**

1. **It takes paths as ARGUMENTS.** A hardcoded `ROOT = __file__.parent.parent`
   is a project script wearing a skill script's clothes. `argparse`, with the
   project layout as defaults.
2. **Its docstring carries the DEFECT it exists for**, with the date and the
   symptom. That is what stops the next run deleting it as unexplained, and what
   makes it obvious when it applies.
3. **A gate must be proven to FAIL.** Break the thing it checks, watch it go red,
   put it back. A check that cannot fail is not a check, and one that has never
   been seen failing is not known to be a check.

**A NEW CAPABILITY is what gets stranded, not an edit.** The audit that followed
this rule swept every project on the machine and found exactly one with stranded
tooling. Previous runs had promoted their fixes correctly - because those were
EDITS to scripts that already lived in a skill, so there was nowhere else to put
them. The run that stranded fourteen scripts was the one that built two genuinely
new capabilities (a quadruped rig-and-skin chain, and a map mesh pipeline). A new
capability has no existing file to edit, so the natural home is the project, and
that is the moment the promotion has to be deliberate.

**So the trigger is: "I am creating a script that does not exist yet."** That is
when it goes in the skill.

**And prefer promoting a GATE over adding a paragraph here.** This file is past
13,000 words, and the measured failure mode of that length is being skimmed - a
complete and correct seven-rule cost section was read past and violated across an
entire session by the agent that wrote it. A twenty-line script that exits 1
does not depend on anybody reading anything.

### A GENERATED ASSET THAT NOTHING USES IS A FAILED STAGE, NOT A DONE ONE.

**Before any stage is called done: for every artifact it produced, name the line
of shipping code that loads it. If there is no such line, the stage is not
finished - however good the artifact is and however green the gates are.**

Written 2026-09-09 after a run was handed back four times as complete and was
broken in four ways at once. Every one of the four is the SAME failure:

| what was asked for | what shipped | the artifact that existed and was used by nothing |
|---|---|---|
| sheep, wolves, a dog | a stack of 19 **boxes** each | painted, decimated, normal-baked GLBs on disk |
| map props (trees, rocks) | **primitive parts** - a tree was a brown box with green boxes on top | the whole mesh pipeline, wired to the creatures but never to the map's props |
| a live HUD | four labels rendering `--` forever | a `Loadout` remote that did not exist; a roster with no `frozen` flag |

Every gate passed on all three. `rojo build`, 53 specs, `selene`, `stylua`,
`verify_wired.py`, the map prover, `verify_ui.py`. **A box is a real, internally
consistent, existing part**, and every gate this pipeline owns asks "is what I
built self-consistent", never "is it the thing that was asked for". The PNG
mockup agreed with the game because both are drawn from the same tree.

**THE MECHANISM, and it is the part to actually guard against: substitution with
a rationale.** The run takes the cheaper path, writes a defensible comment
explaining why, and the comment then becomes the record that stops the decision
ever being revisited. Verbatim from the run's own source:

> *"WHY RIGID PARTS RATHER THAN A SKINNED MESH. A skinned MeshPart is the
> prettier answer and it is not reachable from here: it has to be UPLOADED
> before Roblox will accept bones, and nothing in this run can verify that round
> trip."*

Every clause true; the conclusion false. The argument was defending the game's
performance law - no Humanoid, no Animator, one bulk write per frame - and a
skinned mesh breaks none of it: `Bone.Transform` is a plain property set, and a
skinned creature puts ONE part into the `BulkMoveTo` where the boxes put
nineteen. **The substitution was strictly worse on the very axis it was
justified by.** The upload took four minutes and worked first time.

So, concretely:

- **Write the fallback down as a DEBT the moment you take it, in `HANDOVER.md`,
  not as a comment justifying it.** A comment arguing for the fallback is the
  single most reliable way to make it permanent. If you find yourself writing
  one, that is the signal to stop and check the claim instead.
- **Check the claim that closes off the better path.** "The upload can't be
  verified", "the kit only does parts", "there is no remote for that" - each of
  those took minutes to disprove and each had cost days.
- **Ask what the constraint actually requires.** A performance budget requires
  *anchored parts you control*, not *boxes*. Restate the constraint in its own
  terms before accepting that it forces the cheap option.
- **Then gate it:** at handover, walk every file under `assets/` and `work/` that
  a stage produced and grep the shipping tree for its id or path. An asset with
  no reference is an open defect and goes in the handover as one.

### EVERY STAGE RUNS. `skip` IS NOT AN ENDING.

**A run does not get to choose which stages it does.** Meshes, animation and VFX
are not optional polish that a working game can be declared without - they are
three of the six things the brief asks for, and a build that ships without them
has not built the game, it has built the parts of the game that were easy.

Measured 2026-09-02, and it is the reason this section exists. A run delivered a
complete, playable RPG with all four code gates green, a PASSing map prover and a
green handover gate, having marked meshes, animation and VFX `skip` and taken
their fallbacks. Every gate agreed it was finished. The user opened it, went
looking for the KeyframeSequences, and found none - because none had ever been
authored. The honest report said so; that was not the problem. The problem was
that **the pipeline had no way to disagree with the run about it**, so "I chose
not to do that stage" and "that stage is done" produced the same green.

So:

- `skip` is a status a stage may hold **during** a run, never at the end of one.
- Taking a fallback is a *checkpoint*, not a *destination*. It buys the run time
  to keep moving; it is redeemed before handover, in the same run.
- `validate.py --stage-gate` FAILS on any stage still marked `skip`. That is the
  code enforcing it, because a rule that is only written down gets forgotten and
  this one already was.
- If a stage genuinely cannot run on this machine - no GPU quota, no rig, an API
  that is down - that is an `external` debt with a named blocker, recorded with
  `roblox-build-orchestrator/scripts/run_log.py event --kind fix --level external`. "I ran out of enthusiasm" is
  not a blocker, and neither is "the game already works without it".

**And the fallback must be judged against the thing it replaces, not against
nothing.** A parts-built sword looks fine in isolation and wrong the moment it is
in a hand mid-swing. Which is the next rule.

### ASK FOR SCREEN ACCESS IN THE FIRST MINUTE. NOT WHEN YOU ARE STUCK.

**Stage 0 now includes one request, and it is the first thing the run does:**

```
request_access(apps=["Roblox Studio"],
  reason="Play the game and watch it, which is the only way several whole
          classes of defect are visible at all.")
```

Ask BEFORE research, before design, before anything. Two reasons, both measured
on 2026-09-05/06:

1. **The consent card renders on the PC, not in the conversation.** A user
driving the machine remotely could not see the card at all,
so it could not be granted when it was finally needed. Asking at the start,
while the user is still at the keyboard, is the only time the answer is reliable.
2. **Asking late means asking after the damage.** That run reached "handover"
   with the whole UI at the wrong scale, every ability rejected, weapons hanging
   through the floor and four of eleven VFX called by nothing - and every gate
   was green, because every gate ran in EDIT MODE. The first playtest found four
   defects in ten minutes.

Granted once, it lasts the session. Then the run is genuinely unattended: it can
play, look, and fix without another interruption. That is the point.

**In section mode the session is cleared after every section, so ask again at
the start of every section**, before `section.py resume`.

### A SCREENSHOT CAN BE A STALE FRAME. PROVE IT IS FRESH BEFORE BELIEVING IT.

**Studio's viewport can stop redrawing geometry while its chrome keeps updating,
and `capture_screenshot` will hand you the frozen frame with no indication that
anything is wrong.** Measured 2026-09-09: three consecutive screenshots came back
byte-identical - down to a stuck tooltip - across two camera moves and 897
instances being created. Reading them as evidence produced a confident, wrong
"the map is still boxes" that survived several rounds of investigation. The
meshes had been there the whole time.

**Put a changing witness in every frame you intend to reason from.** Anything
that must differ shot to shot - a wall clock in the corner of the screen, a
counter you increment, the mouse moved to a new position. If the witness has not
moved, the frame is stale and the picture is not evidence.

**And a plugin can be attached to a DIFFERENT DataModel than the one on screen.**
Same session, same day: `execute_luau` reported `selection=0` while the viewport
showed dozens of parts outlined in blue, and reported 897 MeshParts in a map that
visibly had none. Studio was holding a second DataModel from an interrupted
playtest. **Two cheap ways to catch it before it costs an hour:**

- Ask for something you can also see, and compare. Selection count against
  visible outlines is the fastest one.
- `RunService:IsRunning()` against what the toolbar shows.

When they disagree, stop investigating the game and restart Studio. Nothing you
measure in that state means anything. Symptoms: `start_playtest` answering "a
test is already running" while the editor sits in edit mode; toolbar clicks
raising tooltips but never activating; `stop_playtest` reporting success with no
effect.

### PLAY IT. THE EDIT-MODE GATES DO NOT KNOW WHETHER THE GAME WORKS.

`validate.py`, `check.py` and `verify_wired.py` all answer "is the thing there".
None of them answers "does it work when a player presses the button". A run that
has not been played has not been tested, no matter how green it is.

**Stage 11 is not optional and not a formality. It has a method:**

1. **Open Studio's Output panel FIRST** - `Window > Output`. It is readable off
   the screen and it is the ONLY channel that reports the running game.
   `get_playtest_output` returns `[]` with `isRunning: true`, and
   `capture_screenshot` is edit-mode only. A whole afternoon went into guessing
   from screenshots while one log line - `icons applied: 4` - had the answer.
2. **Run a TWO-PLAYER test**, not a solo one: the Test tab's client count, then
   Play. Solo cannot exercise a single hit, so combat, combos, ragdoll, the
   parry and every hit-triggered effect are all untested by a solo run. A solo
   round also hides round-flow bugs - one run had `alive == 1` ending the round
   on its first tick, which rejected every ability, and it was invisible until
   two players were in.
3. **Capture FRAMES, not a screenshot.** `scripts/capture_frames.ps1` bursts the
   window to numbered PNGs; build a contact sheet and look at every frame. A
   still cannot show a swing, a trail that follows a blade, or a shockwave's
   radius - those exist for a few frames. This is the same method used to judge any
   motion, and it is the only way to judge animation and VFX in engine.
4. **Strip the tester's avatar costume** before judging weapon placement. A
   Roblox avatar with a large layered outfit hides a 7-stud sword completely,
   and you will conclude the weapon is missing when it is attached correctly.
5. **Make the capture prove it saw its subject.** A "Server & Clients" test runs
   FOUR Studio processes - editor, server, one per client - and they do not all
   have distinct titles. `Get-Process | Select -First 1` returned the EDITOR, a
   maximised window behind everything; `SetForegroundWindow` is then REFUSED by
   Windows when called from a background process and returns false silently, so
   the capture read that rectangle and photographed whatever was on top. It
   produced 45 confident PNGs of the chat window. `capture_frames.ps1` now takes
   `-TitleMatch`/`-Hwnd`, refuses to guess between matches, verifies it reached
   the foreground, aborts if it did not, and takes `-MoveTo` to get the window
   out from under an always-on-top panel.
6. **Build the trace BEFORE you need it.** You cannot ask a running game a
   question: `execute_luau` with `target: "server"` times out (the plugin lives
   only in the edit DataModel), and the Studio command bar runs outside Knit, so
   it cannot `GetService` anything. That left eight melee hits that visibly
   swung and did nothing, with no way to tell a rejected intent from a landed
   one - the client plays its swing animation on input, so the two look
   identical. Every gameplay service should carry a trace behind an attribute
   flag (`workspace:GetAttribute("<Game>CombatDebug")`), printing WHY an action
   was refused and, for a hit check, the target count with the nearest
   candidate's distance, facing dot and alive flag. Off by default, one lookup
   when off, and it turns a two-hour guess into one line of Output.
7. **Check that you are measuring the number the GAME uses.** Damage was landing
   the whole time; I was reading `Humanoid.Health`, which this game does not use
   - it keeps health in its own state service. Both players read a flat 100/100
   while their HUDs read 90/90 and dropped correctly. Prefer the end-to-end
   check: tile the two client windows side by side and read the VICTIM's own
   health bar. That measures the whole chain, and it cannot be measuring the
   wrong field.

### NOTHING SHIPS UNTESTED. THE MATRIX IS THE GATE, NOT A SUGGESTION.

**A run is not finished when the gates are green. It is finished when every
element of the game has been exercised IN PLAY, with two players, and the result
written down.** "It compiles", "it synced", "the asset exists" and "the same code
path works for the other one" are not results. Neither is a screenshot of the
thing sitting still.

Measured across two handovers of the same project: the first was declared done
with all four code gates green, 78 specs passing and a wiring gate covering 51
names, and it was broken in six ways. The second was declared done after ONE
fighter had been played, and the other two were described as "proven by the same
code path" - which then hid a bug that made a surviving player unable to change
fighter at all. **The untested half is where the defects are, every time.**

**Before the word "done", fill this in and put it in `HANDOVER.md`. Every row
gets a measurement or the word UNTESTED. There is no third option, and an
UNTESTED row must appear in the handover's own "not verified" list.**

| what | what counts as tested |
|---|---|
| every **fighter** | selected through the real UI, spawned, and played - not just present in the config |
| every **weapon** | attached, and its extents MEASURED against the floor and the hand at rest, plus looked at mid-swing |
| every **move** (E, R, ultimate, dash, block, parry) | fired in game, its effect observed, its cooldown seen to run |
| every **VFX in the manifest** | seen firing, at the right place, at a size that does not blank the screen |
| every **animation** | playing on a real character holding the real weapon, and the weapon carried the way the reference says that class is carried |
| **locomotion, per playable character** | stand, walk, run, jump, land - **watching the LEGS**. An authored idle at `Idle` priority masks the default walk, and it breaks only the character it was authored for |
| every **UI page** | run through `verify_ui.py` with nothing touching, nothing off-centre, and no frame drawing a box round its child |
| every **UI screen** | open in play, every dynamic label showing a live value and not its mockup placeholder |
| every **sound role** | heard, or explicitly listed as unheard - nothing in this pipeline can hear |
| the **round loop** | at least two full rounds, including the transition and the intermission |
| **damage and elimination** | landed by one player on another and read off the VICTIM's own HUD |

**Three rules about the matrix itself:**

1. **"Same code path" is not evidence.** Two of the three fighters in one game
   shared one attach function with the third, and the shared function was
   correct - the bug was in a service that gated on the wrong thing, and it only
   appeared for a player in a state the tested fighter never reached.
2. **Test the thing a PLAYER does, through the interface a player uses.** Driving
   a remote from the command bar proves the remote works. It does not prove the
   button is wired to it, that the screen is open when it should be, or that the
   server accepts it in the state the player will be in.
3. **A row you could not test is a row you WRITE DOWN.** Scaling the verification
   down is the user's call, never the run's. Handing over a list of four honest
   UNTESTED rows is a good outcome; handing over silence is not.

### VERIFY AGAINST THE CONSTRAINT, NOT A PROXY YOU CAN MEASURE EASILY

A check that cannot fail when the defect is present is not a check. Three of
these shipped on one project, each one reported as a pass:

| the question | the proxy I measured | what the proxy cannot see |
|---|---|---|
| is the weapon IN THE HAND | its lowest point vs the floor | a weapon floating a stud out to the SIDE - height is unchanged |
| did the UI change reach the game | the build printed success | the build wrote to `mockups/` and Rojo serves `src/StarterGui` |
| does the ability work | the swing animation played | the client animates on input; the server had rejected it |

**Write the check as the thing that must be true**, in the units of the thing
itself:

- a grip: the weapon's grip point IS the hand's origin. One 3D distance, and it
  is zero or the grip is wrong. `GRIP_ERR=0.000`.
- a synced file: the SOURCE in Studio contains the string you just wrote.
- an accepted action: the SERVER says it accepted it.
- damage: the VICTIM's own health bar moved.

**Then assert it in the code**, not only in the session. `FighterService`
computes the grip error at attach time and warns above 0.05 studs, so the next
regression announces itself in the Output window instead of waiting to be
noticed in a screenshot. A check that only exists in a transcript protects one
run; a check in the code protects every run after it.

**And when you generate a picture as evidence, LOOK at it.** A screenshot was
cropped, captioned "gauntlet on the fist, glaive held level" and sent, and both
weapons were visibly wrong in the image being captioned. Read your own evidence
before you attach a claim to it - at full resolution, zoomed onto the thing you
are asserting, not at thumbnail size.

### ATTACHING ANYTHING TO A BODY PART: HELD vs WORN, AND CHECK THE RIGHT ONE

Weapons, tools, carried items, armour, hats, backpacks - anything welded to a
limb - come in two kinds with **different geometric requirements**. Getting the
kind wrong produces something that is attached, passes a coincidence check, and
still looks broken. This cost three consecutive handovers on one project.

| kind | the requirement | example |
|---|---|---|
| **held** | the item's GRIP POINT coincides with the body part's origin, and the item extends away from it | sword, polearm, gun, torch |
| **worn** | the body part is INSIDE the item - the item CONTAINS it, so its centre sits on the part | gauntlet, glove, bracer, helmet, boot |

**Declare the kind per item.** Do not infer it. A gauntlet treated as "held" put
its wrist cuff at the hand and hung the whole item downward, so it dangled past
the fingertips beside the leg - and the grip-point check read a perfect 0.000,
because for a worn item the grip point is not the thing that has to be right.

**Build the transform from the part that is actually in the engine.** An
exporter's derived matrix describes the asset in the exporter's frame; the
importer may rotate it. On this project `grips.json` recorded a glaive as
(0.99, 3.02, 8.60) - long axis Z - while the shipped MeshPart measured
(0.99, 8.60, 3.02) - long axis Y. Only ONE thing survives that safely: a SCALAR
distance such as grip-to-centre. Take the axes from `Part.Size` and assert which
one is the length, rather than reading a column out of the derived matrix.

**A worn item must be BIGGER than the part, and it must be checked as a VOLUME.**
Two separate mistakes hide here and both shipped:

- *Size.* Armour sits ON TOP of a limb, so its cross-section has to exceed the
  limb's. The gauntlet shipped at 1.00 x 1.70 x 1.02 against an R15 arm whose
  cross-section is exactly 1.00 x 1.00 - a margin of ZERO. Its bounding box was
  flush with the arm and, because a fist mesh does not fill its own box, the
  visible armour was NARROWER than the limb. Derive the scale from the two parts
  in the engine and grow the item until it clears by a margin; never type it:

  ```lua
  local need = math.max((part.Size.X + 2 * MARGIN) / item.Size.X,
                        (part.Size.Z + 2 * MARGIN) / item.Size.Z)
  if need > 1 then item.Size = item.Size * need end   -- uniform, only ever grows
  ```

- *Check shape.* Asking whether the part's ORIGIN is inside the item is a
  point-shaped answer to a volume-shaped question - it passes while most of the
  limb hangs out. Test all EIGHT CORNERS of the part.

**Assert the requirement in code, at attach time, per kind:**

```lua
if style == "worn" then
    -- EVERY CORNER of the part must be inside the item, not just its centre
    local half, reach, worst = item.Size / 2, part.Size / 2, 0
    for _, sx in { -1, 1 } do for _, sy in { -1, 1 } do for _, sz in { -1, 1 } do
        local c = c0:PointToObjectSpace(Vector3.new(sx * reach.X, sy * reach.Y, sz * reach.Z))
        worst = math.max(worst, Vector3.new(
            math.max(0, math.abs(c.X) - half.X),
            math.max(0, math.abs(c.Y) - half.Y),
            math.max(0, math.abs(c.Z) - half.Z)).Magnitude)
    end end end
    if worst > 0.01 then warn(...) end
else
    -- the grip point must BE the part's origin
    local grip = (part.CFrame * c0 * CFrame.new(0, -gripToCentre, 0)).Position
    if (grip - part.Position).Magnitude > 0.05 then warn(...) end
end
```

**A WORN ITEM MUST HIDE THE LIMB IT REPLACES, AND ONLY A SCREENSHOT PROVES IT.**

Growing the item is not enough. A gauntlet mesh is an OPEN RING at the cuff, and
an R15 hand is a solid 1.00 x 0.30 x 1.00 slab - so the slab shows THROUGH the
opening no matter what. Proved by sweeping five offsets at two scales with a
bright green hand proxy inside the real mesh: green above the cuff at negative
offsets, green below it at positive ones, never covered at any combination.

**And hide EVERY limb it covers, not just the one it is welded to.** The
gauntlet is 2.20 studs tall and reaches well up the forearm, so hiding only the
hand left the LOWER ARM running straight through it. Which limbs those are is
MEASURED - the fraction of each limb's volume inside the item - never listed:

```lua
for _, limbName in ARM_CHAIN do                    -- hand, lower arm, upper arm
    local limb = character:FindFirstChild(limbName)
    if limb and coveredFraction(limb, item) >= 0.85 then limb.Transparency = 1 end
end
```

On an R15 arm that hides the hand (100% covered) and the lower arm (90.5%) and
leaves the upper arm (0%) alone, so no gap opens at the elbow. Restore the whole
chain whenever the item is removed or swapped, or a later sword inherits an
invisible arm.

**The coverage rig - build this, it takes one minute and it is the only honest
check.** In EDIT mode, away from the map:

1. build proxy parts at the REAL limb dimensions, measured from a running
   character (`RightHand`, `RightLowerArm`, ...), and colour the covered part a
   colour that cannot occur in the scene - bright green, magenta;
2. colour the neighbouring limbs skin tone, so an uncovered FOREARM does not
   read as a failure when only the HAND has to be covered;
3. clone the real mesh, apply the real transform, and lay out several offsets
   and scales side by side in one shot;
4. point the camera at them and `capture_screenshot`.

**Any proxy colour visible is a protrusion.** That is a pixel fact and nothing
else in the pipeline can produce it: bounding-box containment cannot see a mesh
with a hollow cuff, and a corner test cannot either. Both pass while the limb
pokes out.

This loop runs in edit mode in seconds, needs no playtest, no round timer and no
window juggling - which is the difference between iterating four times in a
minute and shipping the wrong answer three times over an afternoon.

**And know what the assertion does NOT cover.** It proves the item is ATTACHED
correctly. It says nothing about whether it is POSED sensibly, because that
depends on the animation the limb is in. Roblox's default idle holds the arms
straight down, and from that pose no transform can make a weapon look gripped by
a posed hand - the best available is "hanging plausibly". If a fighter needs to
look like it is holding something, that is a per-fighter IDLE ANIMATION, and it
is a separate piece of work from the grip.

**The verification, in this order, every time:**

1. compute the per-kind assertion and print it (`GRIP_ERR=0.000`, or
   `hand is inside the item`);
2. put the camera ON THE BODY PART, close, side-on, with nothing else in frame -
   not a wide shot of the character, where a hand-sized error is a few pixels;
3. look at that image at full resolution before claiming anything about it.

Step 2 is not optional. Every wrong version of this shipped after a wide
screenshot in which the defect was three pixels across and the numbers looked
perfect.

### VALIDATING A WEAPON IN A HAND: BUILD THE POSE STRIP FIRST

Every wrong weapon this project shipped passed a numeric check, and every one of
them was signed off from a wide screenshot in which the defect was three pixels
across. The fix is not more checks. It is one instrument, built before the first
weapon is welded, that answers all of the questions at once and costs a single
screenshot per run.

**THE POSE STRIP.** In EDIT mode, away from the map: N real R15 rigs in a row,
each frozen at a different time through one clip, each carrying the weapon welded
by *the shipped grip code*, with a marker on the hand and the camera side-on.
One screenshot shows the whole animation. It runs in about four seconds, needs no
playtest, no round timer and no window juggling, and it can be re-run after every
change to a constant. Build it once in your project (for example `src/server/Dev/PoseStrip.luau`); nothing in this pack ships one, so the numbers below are the spec.

```lua
require(SSS.Server.Dev.PoseStrip:Clone())({
    weapon = "Glaive", clip = "M1_A", count = 6,     -- an animation
    weapons = { "Katana", "Glaive" },                -- or all fighters, one pose
    sweep = { {1,0,0}, {3,0,0} },                           -- or candidate grips
    poseSweep = { { RightLowerArm = {90,0,0} }, ... },      -- or candidate stances
})
```

It prints, per cell:

| number | what it catches | target |
|---|---|---|
| `gripErr` | distance from the hand to the handle LINE | < 0.05 |
| `through` | samples of the handle line inside a limb that is not the hand | 0 to 2 of 25 |
| `pitch` | degrees the weapon points above horizontal | the pose you chose |
| `reach` | how far along the character's facing the tip sits | the pose you chose |

Six things that make it work, each of which was a silent failure first:

1. **It requires the same module the game does.** The grip construction lives in
   `Shared/Grip.luau` and both the strip and the live service call it. A check
   that runs its own copy of the maths is a picture of something the player never
   sees.
2. **It requires a CLONE of that module.** `require()` is cached for the Studio
   session, so after an edit the strip keeps welding with the old code and shows
   a fix that is not there. Clone the folder, require the clone, destroy it.
3. **It poses the rig by hand, down the joint tree.** Writing a pose into
   `Motor6D.C0` or `.Transform` does nothing in edit mode - the joint solver is
   physics and physics is not running - and a rig from
   `Players:CreateHumanoidModelFromDescription` has **no Motor6Ds at all** there
   (measured: motors = 0; the Humanoid builds them on spawn). Read the joints
   off the `RigAttachment` pairs and set every CFrame yourself:
   `child.CFrame = parent.CFrame * parentAtt.CFrame * pose * childAtt.CFrame:Inverse()`,
   everything anchored. Both mistakes produce N identical rigs in the rest pose
   while every number printed looks healthy.
4. **Leave the weapon's TEXTURE ON while the grip is in question.** Flooding it
   with a colour separates a pale blade from a pale arm, and it is worth having
   as an option - but it also erases the only cue that says which end you are
   holding. One flooded strip signed off a katana that a live playtest
   then showed being held by the blade: a flooded sword looks identical either
   way round, a textured one has a red grip and a gold guard. Flood only for a
   silhouette question, never for a grip question.
5. **It draws the cell index into the shot.** The camera looks down -X, so
   screen-right is -Z and the cells appear in the OPPOSITE order to the list that
   made them. A bar of `i + 1` studs at each rig's feet, countable at a glance.
   Without it a candidate gets credited with its neighbour's silhouette.
6. **It uses a long lens pulled back, not a wide one up close,** and frames low
   enough to include the weapon. At FOV 70 a five-stud character is eighty pixels
   tall and a hand-sized error is invisible. FOV 30 and back off.

#### The two things the strip cannot tell you, and what does

**Which end is the handle.** Every candidate grip that puts the hand somewhere on
the weapon's long axis scores a perfect `gripErr` - the line runs the whole
length, and both ends are on it. One game shipped a katana held *by the blade,
pommel in the air*, reading 0.017 studs of grip error the whole time.

**Do not try to infer it from the shape. Two heuristics were tried and both
failed on a weapon the other one handled:**

- *"the widest feature is the business end, so the hand goes on the far side of
  it"* - true for a glaive, whose axe head flares at the top; FALSE for a katana,
  whose widest feature is the TSUBA, the guard, which sits against the hand.
- *"a tip is an outlier against the median width, a butt is not"* - true for the
  glaive (butt 0.25, head 2.64, median 0.25); FALSE for the katana, because the
  blade TAPERS: the profile runs `0.34 0.34 0.34 [0.52 guard] 0.26 ... 0.17 0.04`
  and the tapered tip sits CLOSER to the median than the handle does.

**Judge a shape by a landmark, not by an extreme.** State the handle end per
weapon, verified once from a picture with the weapon's real TEXTURE showing - a
red grip and a gold guard are unmistakable - and make an unlisted weapon warn
rather than guess. It is one line of data per weapon and it cannot be got wrong
silently.

**And judge the direction only AFTER the end is right.** The katana's quarter
turn was first "verified" against the Blender sheet in a build that was holding
the sword by the blade, so every silhouette compared was of the wrong object. It
had to be redone from scratch.

**The handle is not the bounding-box axis.** `MeshPart.CFrame` is the centre of
the BOX. A glaive measured 0.99 x 8.60 x 3.02 - three studs deep only
because the axe head flares sideways at the top - and the shaft runs along one
EDGE. Rays across it hit material only at local Z 0.75 to 0.91 along the grip,
while at the blade end they span the full -1.36 to 1.36. Putting the hand on the
box's centre axis put it **0.83 studs off the shaft**, which read exactly as "the
character is not grabbing it" while every containment check passed. Probe for the handle's
real lateral offset and slide the weld by it.

### DIRECTION FROM THE ANIMATOR. POSITION FROM THE MESH. NEVER A REST ANGLE IN CODE.

The two halves of a grip fail differently and are fixed from different places.

- **Direction** is the animator's decision. Take it from the derived grip - the
  matrix measured in the same Blender scene the contact sheets were rendered
  from - and let nothing in code override it.
- **Position** is geometry. Construct it so the handle end lands on the hand.
  Do not take it from the derived translation, which describes the weapon's
  centre in a frame the imported part is not in.

**A rest angle invented in code is the single most expensive mistake in this
build.** It rotates the weapon in the HAND's frame, so every authored swing then
renders with the blade somewhere the animator never put it: One game's glaive swung through `M1_A` with its head in the air while the Blender sheet for that
same clip brings the head down, leading. It looked defensible - the weapon
tracked the hand, the grip point was exact, the rest pose read well - and it
quietly broke all eleven clips. The complaint it produces from a player is that the
weapons do not rotate properly during the animations, and no amount of staring
at the weld will find it, because the weld is not where the error is.

**The derived rotation arrives rotated, and it is NOT the GLB importer.** That
was three separate explanations on this project and all of them were wrong. It
arrives rotated because the animation specs rotated the GRIP BONE by a different
amount per weapon when they built each prop - one glaive spec used
`grip_bone.rot = [0,0,0]` and the katana's `[-90,0,0]` - and that rotation is baked
into the derived matrix. **Carry `grip_bone.rot` through to the engine and undo
exactly it.** One line, derived from data you already have, no per-weapon
constant to verify, and it is the difference between a polearm carried head-up
and one dragging its blade at the wielder's feet.

**When the metric and the reference disagree, the reference wins.** The
through-the-body count ranked a katana held straight out in front at 0 and the
authored 45-degree low guard at 2. It is a good metric for "is the pole through
the character's arm" and it is not a substitute for what the animator drew.

### LOOK UP HOW THE WEAPON IS REALLY HELD. BEFORE, NOT AFTER.

**This is a research step, and it comes before you choose any angle.** Geometry
that satisfies every check can still be plainly wrong, because "held correctly"
is a fact about that weapon class, not something to infer from a matrix - and the
person looking at your build will see it in one second.

**Do not use your own contact sheets as the reference for what looks natural.**
They are the reference for what the ANIMATOR intended, which is a different
question, and if the weapon was authored wrong they will confirm the error. On
this project the Blender sheet showed the glaive with its head down at the hip,
the game matched the sheet exactly, and the verdict was that the polearm
was completely upside down. It was. Both were.

What to establish for each class, from actual references, before welding:

- **Polearm / glaive / naginata / spear.** **The head is UP.** Shouldered,
  planted butt-to-ground, or held at a guard with the head forward and above the
  shoulder - never hanging at the wielder's feet. In photographs of naginata
  practitioners the blade leads at chest height or higher; in one-handed carries
  it rides up over the shoulder. Target roughly +55 to +75 degrees above
  horizontal for a one-handed carry.
- **Sword.** Angled up and forward from a LOWERED hand, around +35 degrees. The
  hand belongs near the hip, not out in front: if the arm is held forward with
  the elbow bent, the blade continues the line of the forearm and the whole thing
  reads as a lance. Measure the wrist angle - "straight out of the hand" is
  literally 180 degrees between forearm and blade, and it is the single most
  common way a sword idle goes wrong.
- **Fist weapon / gauntlet.** Worn, not gripped: centred on the hand, pointing
  down the fingers, covering the limbs it swallows. The idle is a brawler's
  guard, both fists up, not a hanging arm.

Sources:
[Naginata](https://en.wikipedia.org/wiki/Naginata),
[naginatajutsu practitioners, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Naginatajutsu_no_5%C2%B0_Torneio_Brasileiro.jpg),
[Glaive](https://en.wikipedia.org/wiki/Glaive),
[Polearm guard stances](https://gabebzelda.wixsite.com/blog/post/perfect-polearm-part-1)

### THE REST POSE IS AN IDLE CLIP. AUTHOR IT WITH THE FIRST WEAPON, NOT LAST.

Roblox's default idle holds the arms straight DOWN. No weld rotation makes a limp
downward hand look like it is gripping, so the first instinct is to tilt the
weapon in the weld - and that is the mistake above, which breaks every authored
clip to fix the one pose nobody animated. **Author an Idle instead.** Then the
weld angle is zero, the weapon is held because the HAND is holding it, and the
rest pose is tuned by moving the ARM.

Two things make this cheap:

- **Author it in the engine's joint space, not in Blender.** An idle is one
  static stance plus a breath. Writing it as R15 joint angles skips the export,
  the axis conversion and the import, and it is validated in the same pose strip
  that validates everything else - which renders the real rig with the real grip,
  and is better evidence than a Blender render anyway.
- **Start from the pose the other clips already end on.** Every attack in this project returns to the same neutral stance at its last keyframe. Building the
  idle on that stance makes the blend in and out of an attack seamless for free.

Then **sweep the arm, not the weapon**, and sweep it against numbers the strip
prints: the weapon's `pitch` above horizontal, how low the `hand` sits relative
to the hip, and the `wrist` angle between forearm and weapon.

```
Katana     arm at the side, hand at the hip, RightHand 120 -> blade +38 up-forward
Glaive     same hanging arm,                 RightHand 140 -> head  +57, well up
Gauntlets  a brawler: both fists up in a guard, not hanging
```

**ONE CLIP PER FIGHTER, not one shared clip.** With the authored grip the
weapon's angle is a consequence of the arm, and a sword, a polearm and a pair of
gauntlets are not carried the same way. A single shared stance was tried first:
it put the katana straight out along a raised forearm - `wrist = 180`, the lance
look - and no single set of angles fixes all three at once.

Priority `Idle` and looping, so Movement (walking) and Action (attacks) both
override it on their own.

### THE REFERENCE CHECK BELONGS AT THE BLENDER STAGE, NOT AFTER IT

Everything in the three sections above is about catching a wrong weapon pose in
the ENGINE. All of it is a backstop. **The place a wrong pose is cheap is the
animation stage, before a keyframe is authored** - and once it is authored wrong,
every later check confirms it rather than catching it, because every later check
measures agreement with the authored clip.

That is not hypothetical. A glaive was authored head-DOWN in Blender. The mesh
stage, the grip derivation, the engine weld and the pose strip then all did their
jobs perfectly: the game reproduced the authored grip exactly, grip error 0.000,
zero samples of the weapon inside the body, silhouette matching the contact sheet
frame for frame. It shipped a polearm carried upside down, and a human spotted it
in one second.

So the animation stage must, **before authoring**:

1. **Search for how that weapon class is really carried and used** - photographs
   of practitioners, not concept art and not other games;
2. **write the answer into the spec as `_intent`**, as a sentence about the
   weapon ("head up, shaft crossing the lead shoulder");
3. **judge its own contact sheet against that sentence**, not against itself.

`roblox-animation` carries this as step 3a and the corresponding rule in step 4.
The orchestrator's job is to refuse an animation deliverable that has no `_intent`
naming the carry, because that is the only evidence that the question was asked.

**A CONTACT SHEET IS NOT A REFERENCE FOR "NATURAL".** It proves the render
matches the spec. Treating it as ground truth for how a weapon is held is how the
error above survived four stages.

### AN AUTHORED CLIP BREAKS THE CLIPS YOU DID NOT AUTHOR

Roblox's default `Animate` script plays idle, walk, run, jump and fall at **Core**
priority. Anything authored and played at `Idle` or above **masks them on every
joint it poses**. A full-body idle loop - the correct fix for a character standing
holding a weapon - therefore stops the legs moving when the player walks, and it
does so on ONLY the character that has the custom idle, which makes it read as a
problem with that character's weapon.

Author the idle at `Core`, or leave the legs out of it, or author the locomotion
set too. Then **check it per character in a playtest: stand, walk, run, jump,
land, watching the LEGS.** Add a `locomotion` row to the pre-handover matrix, one
per playable character. No static check can see this - both clips are correct on
their own, and the defect exists only while they play together.

### UI: NOTHING TOUCHES, CENTRED MEANS MEASURED, NO BOX ROUND A BUTTON

Three defects a player names in one second and no property-tree check can see.
`roblox-ui` enforces all three in `verify_ui.py`; the orchestrator must not accept
a UI deliverable that has not run it.

- **Elements must never touch.** 8px minimum between siblings at the reference
  resolution. Overlap is a failure. Anything deliberately on top says so
  (`"overhang": true`), so an unexplained overlap is always a bug.
- **Centred is a measurement.** Compare the rendered centre against the parent's.
  A `0.5` scale position with no `0.5` anchor lands the element half its own size
  off centre and looks almost right.
- **No frame draws a box around its child.** A container that only positions
  something must be transparent; an opaque one hugging a single child within 6px
  is the classic box-around-the-button defect.

Judge these from the RENDERED page at the real resolution. A mockup is drawn from
the same numbers as the layout, so it agrees with the layout by construction -
including when both are wrong.

### THE RUN HAS A TOKEN BUDGET AND IMAGES SPEND IT OVER AND OVER

**Nothing in the verification sections above becomes optional here.** A weapon
held by the blade shipped once already. What changes is the MEDIUM: the checks
run on numbers, and a picture is spent when a number says to, or once at
sign-off. A run that dies at stage 8 because it spent its budget looking at
stage 4 has verified nothing.

**The cost model, because it is not intuitive.** Input dominates, and it is not
linear: every tool call re-sends the whole conversation, so a run costs roughly
(number of calls) x (average context). Two consequences that decide how to work:

- **An image costs its tokens ONCE and then again on every later call in that
  window.** A screenshot is ~1.7k tokens; read at call 100 of 300 it costs
  1.7k x 200 = **340k**. This is the single biggest lever in the pipeline.
- **A number is free by comparison.** A verdict line is 20 tokens and it is the
  same evidence, provided the tool states the band and judges itself.

**The rules:**

1. **Every verification tool returns a VERDICT, not an artifact.** State what
   correct is as numbers, judge against them, answer `PASS` or `LOOK - <reason>`.
   `PoseStrip` does this via `Shared.Core.PoseVerdict`, and the bands are covered
   by `lune run test` so they cannot quietly drift. `verify_ui.py` already worked
   this way. **Then iterate on the text and spend the screenshot on LOOK or on
   sign-off.**
2. **State the POSE target for the clip, not just the universal checks.** A grip
   can be geometrically perfect and still be a lance - `wrist=180` and
   `pitch=+15` describe that exactly. `expect = { { "pitch", 20, 60 }, { "wrist",
   0, 160 } }` turns "does it look natural" into something that fails in text.
3. **Crop and scale before reading any capture.** A full 1928x1040 viewport is
   ~1.8k tokens; the same subject cropped to 800x400 is ~430. Four times cheaper
   on the read AND on every re-send. Never read a full-screen grab to inspect
   something hand-sized.
4. **Never `cat` a generated data file.** One dump of a keyframe builder cost
   ~20k tokens in a single call on this project and answered a question that
   `grep -c` would have answered for 50. Read a line range or grep for the shape.
5. **Batch probes into one call.** One `execute_luau` returning a table beats six
   returning one value each, and the gates run as one chained command. Sweep N
   candidates in ONE strip, not N runs - that is what the sweep modes are for.
6. **In fan-out, images must never cross back to the parent.** A worker looks at
   its own contact sheets and returns numbers plus a verdict. A worker that ships
   its render up to be judged has re-imported the exact cost the split was
   buying, which is why the workers that produce visuals run on a model that can
   judge them.
7. **The 30-minute stall rule is also a cost rule.** A dead end does not just
   waste its own calls; it sits in the context and is re-sent by every call after
   it. Take the pre-authorised fallback and move.
8. **DRIVING STUDIO'S UI BY SCREENSHOT IS THE MOST EXPENSIVE WAY TO LEARN
   ANYTHING. BUDGET IT AT FIVE CALLS.** Every click needs a screenshot to aim and
   another to confirm, and each of those is re-sent forever after. Measured
   2026-09-09: about twenty round trips went into hunting for Studio's Play
   button, Stop button and Output panel, against a Studio that was wedged and
   could not have started a playtest whatever was clicked. **If five calls have
   not achieved the UI action, stop clicking and change method** - keyboard
   (`shift+F5` stopped a playtest that clicking Stop would not), an MCP call, or
   restarting Studio. Prefer `execute_luau` returning a table over any number of
   screenshots: it is a hundred times cheaper and it cannot be a stale frame.
9. **A screenshot you cannot prove is fresh is worse than no screenshot.** It
   costs full price and yields a confident wrong answer. See the stale-frame
   rule above; put a changing witness in the frame or do not read it.

**THE CHEAP-VERIFICATION LADDER. Always start at the top, and only descend when
the rung above genuinely cannot answer the question.** The first rule of this
skill stands without exception - the run does not stop - so when a check is
blocked or expensive, the move is to climb this ladder, never to hand back.

1. **A static check on files. Effectively free, and it catches real bugs.**
   `rojo build`, `lune run test`, `selene`, a grep of the shipping tree for an
   asset id. A twenty-line Python gate found four dead HUD labels that a PNG
   mockup, a layout verifier and 53 specs had all passed. Write the gate; it is
   cheaper than the screenshot that would have found the same thing, and unlike
   the screenshot it protects every run afterwards.
2. **One `execute_luau` returning a TABLE.** ~200 tokens, one call, and it cannot
   be a stale frame. It answers: does this asset load, how many bones, what size,
   is it in the tree, how many of them are there, what is selected. **Measured:
   one probe confirmed all four skinned creatures loaded with 19 bones each and
   sizes matching Blender exactly - after ~20 screenshots had failed to answer
   it.** Batch every question into that one table.
3. **A rendered artifact judged by a script**, returning `PASS` or
   `LOOK - <reason>`. Iterate on the text.
4. **One cropped screenshot with a freshness witness in frame.** Last resort,
   spent on a `LOOK` or at sign-off. Never a full-screen grab to inspect
   something hand-sized.

**And when the TOOL is the thing that is broken, reset it rather than fight it.**
Studio wedged, the plugin bound to a stale DataModel, a playtest that will not
stop - restarting Studio costs a handful of calls. Twenty screenshot-bearing
clicks aimed at a Play button that could never have worked cost far more and
taught nothing.

**Measured on this project:** judging a weapon in a hand used to take ~35
iterations of start-playtest, burst-capture 56 frames, build and read contact
sheets - roughly 20 calls and several images each, every image re-sent for the
rest of the window. On the numbers-first loop the same work is one
`execute_luau` and one line of text per iteration, with a single screenshot at
the end. That is the difference between millions of tokens and a few hundred
thousand, for **strictly more** checking than before: grip error, through-body
count, weapon pitch, hand height and wrist angle, on every cell, every run.

### VERIFY EVERY GENERATED ASSET IN THE ENGINE, NOT ONLY IN ITS OWN TOOL

An asset can be perfect in Blender and wrong in Roblox, because the transfer
changes axes, scale and parenting. Measured: a grip DERIVED correctly in Blender,
whose contact sheets showed the sword sitting properly in the hand, put the blade
through the floor in game - the derivation was right and the axis assumption
across the glTF import was not. The animation worker had even flagged that exact
assumption as untested.

So for every asset class, the run must see it **in the engine, on a character,
mid-motion**:

- **weapons and anything else welded to a limb**: see "ATTACHING ANYTHING TO A
  BODY PART" above - declare held vs worn, assert the right constraint, and put
  the camera on the body part. Attached, at the right offset AND the right
  angle, at rest and at the top of a swing arc. Roblox's default idle hangs the arms down, so a long
  weapon needs a rest pose or a tilt or it clips the floor.
- **animations**: playing on a real character with the real weapon, not the bare
  rig. Judge from frames.
- **VFX**: actually firing. **Grep the game for every effect name in the
  manifest** - on this project FOUR of eleven were referenced by nothing,
  including both always-on effects, so a solo playtest showed no effects at all
  and the reasonable conclusion was that VFX were broken. They were never called.
- **UI**: at the real viewport size, in PLAY, with a character alive.

### THE GAME PLAN COMES BEFORE THE CODE

**Stage 2a.** 23 sections - overview, pitch and USP, the 0/5/30-minute concept,
player experience, audience, market, mechanics, progression, content, world,
story, UI/UX, tutorial, art direction, audio, technical architecture, data
saving, security, multiplayer, monetisation, economy, retention, social. Each is
**answered or explicitly declined with a reason**, and `validate.py` fails on any
that is missing or a stub. The full checklist is `references/game-plan.md`.

Declining is a first-class answer, and most prototypes will decline a third of
the list - the scope law here is one core loop, no shop, no datastore. What is
banned is SILENCE. A section nobody considered and a section deliberately cut
look identical from outside, and that is the same ambiguity that let three stages
ship as `skip` under a green gate.

`content`, `world`, `art_direction` and `audio` are where the asset plan below
comes from, which is why they are not prose for a document nobody reads.

### PLAN THE ASSETS BEFORE BUILDING ANY OF THEM

**Stage 2b, and nothing downstream runs without it.** Before the first line of
code, enumerate what the game NEEDS - not as stage names, but per entity:

```json
"asset_plan": [
  {"entity": "Knight", "needs": [
    {"stage": "meshes",    "name": "KnightSword", "why": "visibly armed; the tier the player fights toward"},
    {"stage": "animation", "name": "KnightSwingA",     "why": "attack"},
    {"stage": "animation", "name": "KnightSwingB",     "why": "alternates with A so a fight is not one looping frame"},
    {"stage": "vfx",       "name": "KnightSlashTrail", "why": "reads the swing arc at distance"},
    {"stage": "sfx",       "name": "knight_swing",     "why": "the swing needs a sound or the hit lands silently"}
  ]}
]
```

Every row carries a **why**. That is not decoration: the reason is what makes an
unbuilt asset an obvious hole three hours later, when the row is still sitting
there unmatched.

`validate.py` requires `asset_plan`, checks every row names a real stage, an
asset and a reason, and **at handover reconciles every planned name against that
stage's manifest.** A stage can be `done`, its artifact can exist, and the
Knight's sword can still be missing from it - that is now a FAIL.

**Why this is the root fix, and the `skip` check was only the symptom.**
Measured 2026-09-02: a run shipped without meshes, animation or VFX, and every
gate agreed. The skip check was added, and it would have caught that particular
run. But it would not have caught a run that built *three of four* swords, or one
that gave every enemy the same single attack animation. The deeper fault was that
**nothing ever wrote down what the game needed**, so "meshes" was an activity
that could be declined rather than four named swords that would visibly be
absent. A pipeline that lists only stage names cannot tell a skipped stage from a
finished one, and cannot tell a half-finished stage from either.

Plan first, and skipping stops being a decision anyone can make.

### JUDGE AN ASSET IN THE CONTEXT IT SHIPS IN

An animation is not a rig moving. It is a rig moving **holding the weapon the
game will actually put in its hand**, and the two are not separable: a grip
offset that reads fine in a static pose can put the blade through the forearm at
the top of a swing arc.

`anim_render.py` renders the bare rig, so every animation this toolchain has ever
produced was judged without the prop. That is how a hand-typed `Tool.Grip`
survived: nothing in the pipeline ever drew the sword and the arm in the same
frame.

Two consequences, both required:

1. **Build the weapon into the animation scene**, positioned exactly as the game
   will position it, and render every frame with it attached. A contact sheet of
   a swing without the sword is a contact sheet of the wrong thing.
2. **Derive the in-game grip from that scene, never type it.** The offset you
   verified in Blender is the offset that ships, exported as data. A typed
   `Tool.Grip` is the same class of mistake as a typed mesh bound, which drifted
   47% on this project.

**A playtest screenshot is one frame.** It cannot show you a swing. The contact
sheet and the GIF are the artifacts that can, which is why they exist and why
somebody has to actually look at them.

**The write boundary.** Workers write files. One thread does every
`execute_luau`, `insert_asset`, assembly and publish. Enforced by the worker tool
allowlists, not by asking politely.

**A stage is done when the GAME USES ITS OUTPUT**, never when it produced
files, and never when a preview looked right.

That is stricter than it sounds and it is the rule this pipeline broke first. A
build once shipped with three empty ImageLabels in its HUD while every gate was
green: the icons were generated, cut out, visible in the mockup PNG,
`validate.py --stage-gate` passed because the files were on disk, and the
contract's label names were confirmed present in the emitted tree. Nobody had
uploaded them, so the shipped `.model.json` carried `Image=""`. In the same
build `CoinService` cloned a Cylinder while a finished, uploaded coin mesh sat
unused, because nothing had created the template it looked for.

`scripts/verify_wired.py` is the gate for exactly this, and it is **stage 10b,
before handover**. Run it in both passes - the static one reads the emitted
instance files, the live one probes the assembled tree through `execute_luau`
and catches what files cannot show: script-built instances, place-side installs,
and anything Rojo silently failed to apply. The counts are part of the check, so
a probe that finds none of an expected class fails rather than passing quietly.

**A stage is also done when its own exit criterion passes**, which is the
narrower test. `BUILD.md` in every new game carries the criterion for each stage. The
ones that matter: the map prover returns PASS and not UNVERIFIABLE; the mesh
manifest lists *measured* bounds; sfx roles filled equals roles requested;
`check.py` green on all four gates.

---

## Running it

**FAN OUT THE ASSET BLOCK. This is the default now, and it was earned.**

Stages 4-9 run as parallel `roblox-asset-*` workers. Stages 0-2b and 10-12 stay
on one thread. Wrap the run in the orchestrator's ledger either way:

```bash
python ~/.claude/skills/roblox-build-orchestrator/scripts/run_log.py init --run my-game --mode fanout
```

| Stage | Worker | Model |
|---|---|---|
| 4 map | `roblox-asset-map` | **opus** |
| 5 meshes | `roblox-asset-mesh` | **opus** |
| 6 ui | `roblox-asset-ui` | **opus** |
| 7 animation | `roblox-asset-anim` | **opus** |
| 8 vfx | `roblox-asset-vfx` | **opus** |
| 9 sfx | `roblox-asset-sfx` | haiku |

The tiering rule: **if a human will LOOK AT what the worker produces, the worker
has to be able to judge it.**

The tempting rule is "a gate can check this stage, so it can run cheap" - and it
is wrong, because gates catch CATEGORICAL failures, not quality. A gate
that refuses a map built from boxes has nothing to say about whether the props
you generated instead look good. Poor-looking trees and rocks were the
verdict that ended a map stage which passed all 16 prover checks.

And the fan-out economics point the same way. The saving comes from images
staying INSIDE the worker - contact sheets, paint sheets, UI mockups, orientation
sheets are expensive and never leave a context once read. A worker that cannot
judge its own render has to ship it to the parent to be judged, which re-imports
the exact cost the split was buying. So the model that looks at the sheet must be
the model that can judge it.

That covers map, meshes, UI, animation and VFX - everything a player sees. Sound
stays on haiku because nothing in this pipeline can hear: sfx is chosen by
listing name and measured duration, which is search-and-record work, and a human
still has to listen before launch. Market research stays cheap because it gathers
and cites, while the genre decision it feeds is never delegated at all.

Most of the saving does NOT come from tiering anyway. Context isolation is the
larger half and applies at every tier, so a nearly-all-Opus fan-out still captures
most of the win. Raise a worker rather than ship a subtly wrong asset.

**Why, measured 2026-09-02 on a solo run of the whole pipeline.** The reason is
not wall-clock - that was worth about thirteen minutes waiting on a GPU. It is
token cost, and it has two independent halves:

1. **Context.** Every tool call re-sends the whole conversation, so in one long
   window the *n*-th call carries everything before it and total cost grows
   closer to quadratic than linear. By the end of that run, one-line Studio
   probes were dragging the map prover, the UI stage and every render along with
   them. A worker's eighty interior calls cost the parent one report instead.
   Images are the sharpest case: contact sheets, paint sheets and screenshots are
   expensive, never leave a context once read, and re-send forever. In a worker
   they stay in the worker.
2. **Model tier.** The per-agent models above already existed and went entirely
   unused, because tiering only applies to work running inside a subagent. That
   run did market research and sound sourcing on Opus. Both are haiku work.

**What fan-out does NOT buy, and do not pretend otherwise.** Five of the six
defects in that run's mesh stage lived at the **seam between stages**, not inside
one: a mesh built as a blade when the concept was a whole sword, an unhidden Neon
part left inside the finished mesh, a texture that attaches to nothing, a number
passed where a Content string belongs. A worker in isolation produces four
correct meshes, returns a clean manifest, and every one of those still ships.
Fan-out finds them in parallel; it does not find them.

So two rules make the handoff safe, and neither is optional:

- **Workers hand back artifacts and measurements, not adjectives.** A manifest
  with measured numbers is a fact; "textures look right" is a claim. The cheaper
  model does the work, this thread checks the numbers - that is the whole deal.
- **Workers report the defects they hit, not just the output.** One that quietly
  fixes six things and reports "done" has destroyed what the integrator needed.

### STAGE 9b: THE INTEGRATION PASS

Fan-in is not the end of the asset block. On one thread, and never delegated,
walk **every cross-stage dependency the asset plan named** and check the pair
together:

- the weapon a rig holds, posed mid-swing - not the rig, and not the weapon
- the effect attached to the thing that moves, at the scale it ships at
- every generated id actually resolving in a live tree, not merely recorded

The asset plan is what makes this possible: it wrote the seams down before any
worker started, so this pass has a list rather than a hunch. Without a plan,
fan-out only multiplies workers who each believe they are finished.

Bracket each stage with `run_log.py start/end`, log every intervention as it
happens, and finish with `run_log.py report` and `run_log.py decide`.

The division of labour between the two skills: **this one defines the pipeline,
the orchestrator times and logs it.** Do not put stage logic in the orchestrator
or ledger logic in here.

Stage-by-stage commands, with the exact input each skill wants and the exit
criterion for each: `references/pipeline.md`.

Which MCP server to connect, what it can and cannot do during Play, and the
known failure modes with their dates and fixes: `references/mcp.md`. Read
it once before the first run - two of those failures are open bugs with no fix,
and one of them silently turns the server off after a Studio update.

**Delegating to another agent or tool does not fix a cost problem caused by
method.** Costed on one project: splitting the run across a second coding agent
would have prevented NONE of the four things that actually cost that run -
Studio screenshots, a wedged Studio, five discarded artifacts, and art built
before the loop was verified. It would only have removed cost from stages that
were already cheap, and charged a coordination tax back in review, integration
and debugging code you did not write. Fix the method first.

**Safeguards for any delegated worker, including this skill's own subagent
fan-out.** A worker that dies silently is the `skip` failure wearing a different
hat. Judge a delegated stage by a manifest that validates, never by files
appearing or by an exit code; write to temp and move atomically so a partial
artifact never passes for a finished one; time-box then take the work back; and
check the worker is ALIVE before waiting on it - a dead worker and a slow one are
indistinguishable, and the difference is a wasted timeout.

**When the infrastructure breaks mid-run, repair it rather than asking**:
`references/recovery.md` plus `scripts/recover_mcp.py`. The MCP half is proven -
a real dead connection was diagnosed, repaired and verified with no human input
on 2026-08-30. The governing rule for all screen driving is there too: never
click a coordinate from a frame you have not just re-taken, and never accept a
screenshot as proof - verify through a channel that is not the screen.

---

## What this skill never delegates

The design decisions. Every one of them, including which genre, what the core
loop is, and what is out of scope - not because a subagent could not draft them,
but because those calls are the judgment the whole run depends on, and a worker
that makes them returns a decision with no reasoning the integrating thread can
check.

Also never delegated: verification of any worker's report against the artifact
it points at. A worker saying a mesh is under budget is a claim. The manifest
with a measured number is a fact. When two reports disagree, open the artifact
rather than averaging them.
