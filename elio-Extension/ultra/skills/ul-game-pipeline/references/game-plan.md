# The game plan

Worked through **before stage 3**, written into `design/game.json` as `plan`.
`validate.py` requires all 23 sections and nothing downstream runs until they are
there. A section is finished when it is either **answered** or **declined with a
reason**:

```json
"plan": {
  "overview": "Example Name. Third-person melee action RPG, PC and mobile, 10+.",
  "monetisation": {"declined": "no Robux in this build - out_of_scope says so"},
  "social": {"declined": "single-player loop; no friends, parties or trading"}
}
```

## Declining is an answer. Silence is not.

This skill's scope law is one core loop, no shop, no datastore, and scope creep is
the named risk on a build like this - so **most builds will decline a third of this
list, and that is correct.** The checklist is not a demand that you build guilds
and a battle pass. It is a demand that somebody *decided*.

That distinction is the whole point. A section nobody thought about and a section
deliberately cut look identical from outside, and that exact ambiguity is what
let three stages ship as `skip` under a green gate: "I chose not to" and "it is
done" produced the same green. A `declined` with a reason can be read, argued
with and reversed. An absence cannot.

## The sections

**Shape of the thing** — what is being built and for whom.

1. **overview** - name, genre, platform, target age, device
2. **pitch_and_usp** - one sentence, and why play this over the game it resembles
3. **core_concept** - what the player does at 0 min, 5 min, 30 min, and tomorrow
4. **player_experience** - what it should FEEL like, and when the first win lands
5. **audience** - casual, dedicated, competitive, social
6. **market** - competitors actually looked at, what they do well and badly

**What the player does** — the systems.

7. **mechanics** - the feature inventory: movement, combat, economy, world
8. **progression** - short, medium and long-term goals
9. **content** - maps, NPCs, enemies, items, collectibles
10. **world** - each area: purpose, theme, difficulty, unlock condition
11. **story** - setting and conflict, kept proportional to the game

**What the player sees and hears.**

12. **ui_ux** - every screen, and how many clicks the common action takes
13. **tutorial** - the first five minutes, beat by beat
14. **art_direction** - the style, and what every asset class must match
15. **audio** - music per state, and the SFX roles

**Software.** The part that turns a design into a project.

16. **technical_architecture** - services used, and your own systems
17. **data_saving** - what persists, and what happens when a save fails
18. **security** - never trust the client: what the server validates
19. **multiplayer** - players per server, and what happens when one leaves

**Business and lifetime.** Usually declined on a prototype - but decided.

20. **monetisation** - what a player would happily buy
21. **economy** - per currency: how it enters, how it leaves
22. **retention** - why anyone returns tomorrow
23. **social** - friends, teams, trading, leaderboards

## Sections 9, 10, 14 and 15 feed the asset plan directly

`content`, `world`, `art_direction` and `audio` are where `asset_plan` comes
from, and the handover gate reconciles that plan against what each stage
actually delivered. So these four are not prose for a document nobody reads -
writing "three enemy types, each with two attack animations" here is what makes
a single-animation enemy a FAIL later.

Work them in that order: content and world say what exists, art_direction and
audio say what each thing needs, and `asset_plan` turns that into named rows with
an owning stage.

## Why the plan comes before the code

Measured 2026-09-02. A run built a complete, playable RPG and marked meshes,
animation and VFX `skip`. Every gate passed. The missing check was blamed first,
and a skip check was added - but that was the symptom. The cause was that
**nothing had ever written down what the game needed**, so "meshes" was an
activity that could be declined rather than four named swords that would visibly
be absent.

A skip check catches a stage that produced nothing. It cannot catch a stage that
built three of four swords, or gave every enemy the same single attack
animation, or a map made entirely of boxes. Only a plan catches those, because
only a plan says what "all of them" was.
