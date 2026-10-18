#!/usr/bin/env python3
"""Gate the design stage. Nothing downstream runs until this passes.

Every asset skill in this toolchain does something plausible when handed a vague
spec, and plausible is the expensive failure: it produces files, the stage looks
finished, and the defect surfaces at assembly or in a playtest hours later. So
the contract is checked before any of them are called.

    validate.py                     # from the game root
    validate.py --dir <root>
    validate.py --stage-gate        # also verify stages marked done have artifacts

Checks, in order:

    1. game.json parses and has every required field
    2. no TODO marker survives anywhere in design/
    3. every stage marked todo/done points at a spec file that EXISTS
    4. the scope law holds: a real core loop, and out_of_scope is not empty
    5. every system names what state it owns
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED = [
    "title", "slug", "pitch", "core_loop", "win_condition", "lose_condition",
    "players", "session_minutes", "out_of_scope", "stages", "systems", "config",
    # asset_plan is REQUIRED, and it is the field that makes "every stage runs"
    # mean something. See the plan gate below.
    "asset_plan",
    # The full design plan - see PLAN_SECTIONS.
    "plan",
]

# How to read the set of delivered asset names out of each stage's manifest.
# The shapes differ per stage because each was written by a different skill, so
# this maps them explicitly rather than guessing - and an unknown shape raises
# instead of returning an empty set, because a plan gate that silently finds
# nothing would pass every plan ever written.
def _delivered(stage: str, doc):
    if stage == "meshes":
        return set(doc["assets"].keys())
    if stage == "vfx":
        return set(doc["effects"].keys())
    if stage == "sfx":
        return {s["role"] for s in doc["sounds"]}
    if stage == "animation":
        if "clips" in doc:
            clips = doc["clips"]
            if isinstance(clips, dict):
                return set(clips.keys())
            if isinstance(clips, list):
                # A clip list is EITHER bare names or full records. Both are
                # legitimate - a manifest that carries measured durations and
                # strike beats per clip is strictly more useful than one that
                # carries names - and assuming the bare form raised
                # "unhashable type: dict" on a perfectly good manifest.
                out = set()
                for c in clips:
                    if isinstance(c, dict):
                        name = c.get("name")
                        if name:
                            out.add(name)
                    elif isinstance(c, str):
                        out.add(c)
                return out
        raise KeyError(
            "assets/animations/manifest.json has no `clips` key. The animation "
            "stage must list the clips it produced by name, or the asset plan "
            "cannot be checked against it."
        )
    if stage == "ui":
        return set(doc.get("widgets", {}).keys()) if "widgets" in doc else set()
    return set()


def _delivered_ui(root: Path) -> set:
    """Every instance name the UI stage emitted, read from its .model.json trees.

    The UI stage's only REQUIRED artifact is a mockup PNG, which the plan check
    cannot read - it was being handed to json.loads and failing with
    "'utf-8' codec can't decode byte 0x89", the PNG magic number. The names the
    contract actually cares about (HUD, FighterSelect, RoundBanner, ...) live in
    the emitted instance trees, so read those instead of the picture of them.
    """
    names: set = set()
    for model in list(root.glob("assets/ui/**/*.model.json")) + list(root.glob("src/**/*.model.json")):
        try:
            doc = json.loads(model.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        # Rojo names a .model.json's ROOT after its FILE when the JSON carries
        # no top-level name (and rojo build warns about one that does), so a
        # ScreenGui called HUD lives in HUD.model.json and nowhere inside it.
        # Measured on one project: all eight screens read as
        # undelivered until the file stem was counted.
        names.add(model.name[: -len(".model.json")])
        stack = [doc]
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            n = node.get("name") or node.get("Name")
            if n:
                names.add(n)
            # An icon may be wired by ATTRIBUTE rather than by instance name:
            # every ImageLabel is called "Icon" and carries IconName, and a
            # controller sets .Image at runtime. That became necessary
            # on one project: the Rojo 7.2.1 plugin cannot decode a
            # baked rbxassetid Content value and aborts the WHOLE sync, so the
            # ids cannot ship in the .model.json. Without this read, every
            # IconX in the asset plan reported as undelivered.
            attrs = (node.get("attributes") or {}) if isinstance(node.get("attributes"), dict) else {}
            icon = attrs.get("IconName")
            if isinstance(icon, str) and icon:
                names.add(icon)
            stack.extend(node.get("children") or [])
    return names


# THE GAME PLAN. Every section is answered or explicitly DECLINED - never absent.
#
# The pipeline's game-plan checklist (23 sections), mapped onto the stages. The
# list is a standard design-document outline; the
# `declined` escape is this skill's, and the two have to coexist: the scope law
# here says one core loop, no shop, no datastore, and scope creep is the named
# risk on the project. A template that DEMANDED monetisation and guilds would
# push every build toward the thing the skill exists to prevent.
#
# So declining is a first-class answer with a reason attached. What is banned is
# SILENCE - a section nobody thought about looks identical to one deliberately
# cut, and that ambiguity is the same fault that let three stages be skipped
# under a green gate.
PLAN_SECTIONS = {
    "overview": "name, genre, platform, target age, device",
    "pitch_and_usp": "one sentence, and why play this over the game it resembles",
    "core_concept": "what the player does at 0 min, 5 min, 30 min, and tomorrow",
    "player_experience": "what it should FEEL like, and when the first win lands",
    "audience": "who it is for - casual, dedicated, competitive, social",
    "market": "the competitors actually looked at, what they do well and badly",
    "mechanics": "the feature inventory: movement, combat, economy, world",
    "progression": "short, medium and long-term goals",
    "content": "maps, NPCs, enemies, items, collectibles",
    "world": "each area: purpose, theme, difficulty, unlock condition",
    "story": "setting and conflict, kept proportional to the game",
    "ui_ux": "every screen, and how many clicks the common action takes",
    "tutorial": "the first five minutes, beat by beat",
    "art_direction": "the style, and what every asset class must match",
    "audio": "music per state, and the SFX roles",
    "technical_architecture": "services used, and your own systems",
    "data_saving": "what persists, and what happens when a save fails",
    "security": "never trust the client - what the server validates",
    "multiplayer": "players per server, and what happens when one leaves",
    "monetisation": "what a player would happily buy",
    "economy": "per currency: how it enters, how it leaves",
    "retention": "why anyone returns tomorrow",
    "social": "friends, teams, trading, leaderboards",
}


def check_plan(game: dict) -> tuple[list[str], int, int]:
    """Every section answered or declined with a reason. Returns problems + counts."""
    problems: list[str] = []
    plan = game.get("plan")
    if not isinstance(plan, dict):
        return ([
            "game.json has no `plan`. Before anything is built, work through the "
            "plan checklist in references/game-plan.md: " + str(len(PLAN_SECTIONS))
            + " sections, each answered or explicitly declined with a reason."
        ], 0, 0)

    answered = declined = 0
    for key, what in PLAN_SECTIONS.items():
        if key not in plan:
            problems.append(f"plan.{key} is missing - {what}")
            continue
        val = plan[key]
        if isinstance(val, dict) and val.get("declined"):
            declined += 1
            continue
        if not val or (isinstance(val, str) and len(val.strip()) < 12):
            problems.append(
                f"plan.{key} is empty or a stub - {what}. Answer it, or decline it "
                f'with {{"declined": "<reason>"}}. Silence is not a decision.'
            )
            continue
        answered += 1
    return problems, answered, declined


# What a stage must leave behind before it may be called done. A stage that
# claims done without its artifact is the "green check over a broken artifact"
# failure, so it is checked rather than believed.
ARTIFACTS = {
    "map": ["work/map/report.json", "work/map/build.lua", "work/map/map.rbxmx"],
    "meshes": ["assets/meshes/manifest.json"],
    "ui": ["assets/ui/mockup.png"],
    "animation": ["assets/animations/manifest.json"],
    "vfx": ["assets/vfx/manifest.json"],
    "sfx": ["assets/sfx/manifest.json", "work/manifest.json"],
}


def find_todos(obj, path: str = "") -> list[str]:
    """TODO can hide anywhere: a value, a key, or an element of a list."""
    hits: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "TODO" in str(k):
                hits.append(f"{path}.{k} (key)")
            hits.extend(find_todos(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(find_todos(v, f"{path}[{i}]"))
    elif isinstance(obj, str) and "TODO" in obj:
        hits.append(path or "(root)")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=".")
    ap.add_argument("--stage-gate", action="store_true")
    a = ap.parse_args()

    root = Path(a.dir).expanduser().resolve()
    game_path = root / "design" / "game.json"
    if not game_path.exists():
        raise SystemExit(f"no design/game.json under {root} - run new_game.py first")

    problems: list[str] = []
    notes: list[str] = []

    try:
        game = json.loads(game_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"design/game.json is not valid JSON: {exc}")

    for field in REQUIRED:
        if field not in game:
            problems.append(f"game.json is missing required field: {field}")

    stages = game.get("stages", {})
    if not isinstance(stages, dict) or not stages:
        problems.append("game.json declares no stages")
        stages = {}

    # 2. TODOs, but only in files this build will actually use. A skipped stage
    # keeps its stub untouched, and demanding it be filled in would be busywork
    # that teaches people to ignore this gate.
    scan = [game_path]
    for cfg in stages.values():
        if isinstance(cfg, dict) and cfg.get("status") != "skip" and cfg.get("spec"):
            spec_path = root / cfg["spec"]
            if spec_path.exists():
                scan.append(spec_path)

    for spec in scan:
        try:
            data = json.loads(spec.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"{spec.name} is not valid JSON: {exc}")
            continue
        for hit in find_todos(data, spec.name):
            problems.append(f"unfilled TODO at {hit}")

    for name, cfg in stages.items():
        if not isinstance(cfg, dict):
            problems.append(f"stage {name} is not an object")
            continue
        status = cfg.get("status", "todo")
        if status not in ("todo", "done", "skip"):
            problems.append(f"stage {name} has unknown status {status!r} (todo/done/skip)")
        if status == "skip":
            notes.append(f"stage {name} is SKIPPED - deliberate, or forgotten?")
            continue
        spec_rel = cfg.get("spec")
        if not spec_rel:
            problems.append(f"stage {name} names no spec file")
        elif not (root / spec_rel).exists():
            problems.append(f"stage {name} points at {spec_rel}, which does not exist")

    # 4. scope law
    loop = game.get("core_loop") or []
    if len(loop) < 2:
        problems.append("core_loop needs at least two steps - one step is not a loop")
    if not game.get("out_of_scope"):
        problems.append(
            "out_of_scope is empty. Scope creep is the named risk on this project; "
            "write down what you are NOT building."
        )

    # 5. systems own something
    for i, sysdef in enumerate(game.get("systems") or []):
        if not isinstance(sysdef, dict) or not sysdef.get("owns"):
            problems.append(f"systems[{i}] does not say what state it owns")

    plan_problems, plan_answered, plan_declined = check_plan(game)
    problems.extend(plan_problems)
    if not plan_problems:
        notes.append(
            f"plan: {plan_answered} sections answered, {plan_declined} explicitly "
            f"declined, 0 unaddressed"
        )

    # ---- the asset plan ------------------------------------------------
    #
    # WHY THIS EXISTS. A run shipped without meshes, animation or VFX and every
    # gate agreed it was finished. The deeper cause was not the missing skip
    # check - it was that NOTHING EVER WROTE DOWN WHAT THE GAME NEEDED. The
    # contract listed six stage NAMES, so "meshes" was an activity you could
    # decline, not a list of four swords that would visibly be absent.
    #
    # An asset plan enumerates, per entity, every asset that entity requires and
    # which stage owns it. Once the Knight's sword is a named row, skipping
    # the mesh stage is not a scheduling choice, it is four missing rows.
    plan = game.get("asset_plan")
    if not isinstance(plan, list) or not plan:
        problems.append(
            "asset_plan is missing or empty. Before any stage runs, enumerate "
            "what the game NEEDS: for each entity (each enemy, the player, each "
            "weapon, the world), every asset it requires and the stage that owns "
            "it. A pipeline that only lists stage names cannot tell a skipped "
            "stage from a finished one."
        )
    else:
        for i, entry in enumerate(plan):
            if not isinstance(entry, dict):
                problems.append(f"asset_plan[{i}] is not an object")
                continue
            if not entry.get("entity"):
                problems.append(f"asset_plan[{i}] does not name an entity")
            needs = entry.get("needs")
            if not isinstance(needs, list) or not needs:
                problems.append(
                    f"asset_plan[{i}] ({entry.get('entity', '?')}) lists no needs. "
                    f"An entity that needs nothing does not belong in the plan."
                )
                continue
            for j, need in enumerate(needs):
                where = f"asset_plan[{i}].needs[{j}]"
                if not isinstance(need, dict):
                    problems.append(f"{where} is not an object")
                    continue
                if need.get("stage") not in stages:
                    problems.append(
                        f"{where} names stage {need.get('stage')!r}, which is not "
                        f"a stage of this build"
                    )
                if not need.get("name"):
                    problems.append(f"{where} has no asset name")
                if not need.get("why"):
                    problems.append(
                        f"{where} does not say why it is needed. The reason is what "
                        f"makes an unbuilt asset an obvious hole later."
                    )

    if a.stage_gate:
        # EVERY STAGE RUNS. `skip` is a status a stage may hold DURING a run,
        # never at the end of one.
        #
        # Measured 2026-09-02: a run shipped a complete, playable game with
        # meshes, animation and VFX marked `skip` and their fallbacks taken.
        # All four code gates were green, the map prover PASSed, the handover
        # gate passed. Nothing in the pipeline could disagree, because "I chose
        # not to do that stage" and "that stage is done" produced the same
        # green. Three of the six things the brief asked for were missing and
        # every check said finished.
        #
        # A stage that genuinely cannot run on this machine is an EXTERNAL debt
        # with a named blocker, declared here so it has to be written down and
        # read by a human, not silently omitted.
        # `todo` at handover is the same hole wearing a different word.
        #
        # Measured 2026-09-02, in the same run: map and ui were BUILT, verified
        # in a playtest and written up in the handover, while the contract still
        # called them `todo` - and the gate passed, because it only ever looked
        # for `skip`. That cuts both ways. A stage left `todo` is either not done
        # or not recorded, and from outside the run those are indistinguishable,
        # which makes the contract useless as the thing you check the build
        # against. Every stage ends the run at `done` or at a declared blocker.
        for name, cfg in stages.items():
            if not isinstance(cfg, dict) or cfg.get("status") != "todo":
                continue
            if cfg.get("external_blocker"):
                continue  # reported below with the skipped stages
            problems.append(
                f"stage {name} is still marked 'todo' at handover. If it ran, record "
                f"stages.{name}.status = 'done' and what verified it; if it did not, "
                f"run it. A stage nobody can tell apart from unfinished is unfinished."
            )

        for name, cfg in stages.items():
            if not isinstance(cfg, dict) or cfg.get("status") not in ("skip", "todo"):
                continue
            blocker = cfg.get("external_blocker")
            if blocker:
                notes.append(
                    f"stage {name} is SKIPPED with a declared external blocker: {blocker}"
                )
            elif cfg.get("status") == "skip":
                problems.append(
                    f"stage {name} is still marked 'skip'. Every stage runs - a fallback "
                    f"is a checkpoint, not a destination, and it is redeemed before "
                    f"handover in the same run. If it truly cannot run here, say why in "
                    f"stages.{name}.external_blocker and log an external debt."
                )

        # THE PLAN IS CHECKED AGAINST WHAT WAS DELIVERED.
        #
        # Declaring the plan is not enough - a plan nobody reconciles is a wish
        # list. Every planned asset must appear by name in its stage's manifest.
        # This is what turns "meshes: done" into a claim that can be false: the
        # stage can be done, its artifact can exist, and the Knight's sword
        # can still be missing from it.
        if isinstance(plan, list):
            for entry in plan:
                if not isinstance(entry, dict):
                    continue
                for need in entry.get("needs") or []:
                    if not isinstance(need, dict):
                        continue
                    stage, name = need.get("stage"), need.get("name")
                    if not stage or not name or need.get("optional") is True:
                        continue
                    cfg = stages.get(stage)
                    if not isinstance(cfg, dict) or cfg.get("external_blocker"):
                        continue
                    paths = [root / p for p in ARTIFACTS.get(stage, [])]
                    existing = [p for p in paths if p.exists()]
                    if not existing:
                        continue  # already reported as a missing artifact above
                    try:
                        if stage == "ui":
                            got = _delivered_ui(root)
                        else:
                            doc_m = json.loads(existing[0].read_text(encoding="utf-8"))
                            got = _delivered(stage, doc_m)
                    except Exception as exc:  # noqa: BLE001
                        problems.append(
                            f"could not read {existing[0].name} to check the asset "
                            f"plan against it: {exc}"
                        )
                        continue
                    if got and name not in got:
                        problems.append(
                            f"asset_plan wants {name!r} from stage {stage}, and the "
                            f"stage is {cfg.get('status')} - but its manifest does "
                            f"not list it ({entry.get('entity')}: {need.get('why')}). "
                            f"Delivered: {sorted(got)}"
                        )

        for name, cfg in stages.items():
            if not isinstance(cfg, dict) or cfg.get("status") != "done":
                continue
            wanted = ARTIFACTS.get(name, [])
            if wanted and not any((root / w).exists() for w in wanted):
                problems.append(
                    f"stage {name} is marked done but none of its artifacts exist "
                    f"({', '.join(wanted)}). A stage is done when its output is on disk."
                )

    for n in notes:
        print(f"  note  {n}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print(f"  FAIL  {p}")
        print("\ndesign is not ready. No stage may run against an unvalidated contract.")
        return 1

    print(f"\ncontract valid: {game['title']}")
    print(f"  core loop   {' -> '.join(game['core_loop'])}")
    live = [n for n, c in stages.items() if isinstance(c, dict) and c.get("status") != "skip"]
    print(f"  stages      {', '.join(live)}")
    print(f"  out of scope {', '.join(game['out_of_scope'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
