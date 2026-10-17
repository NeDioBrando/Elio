#!/usr/bin/env python3
"""Run the pipeline one SECTION at a time, with a gate and a handoff between.

WHY THIS EXISTS. A one-shot, whole-game run does not fit in one Claude Code
usage window (a plan with a 5-hour limit cannot carry the whole pipeline). So
the build is prompted in six sections: you approve each one, then CLEAR THE
SESSION before the next. That breaks two assumptions the rest of this skill
was built on:

  1. "The run does not stop until the game is complete." In section mode it
     stops at every section boundary, and only there.
  2. The run lives in one context. It does not: every section starts cold, so
     anything not written down at the boundary is lost, including the rules,
     the ledger's location and every decision made so far.

So a section ends when a GATE says so, not when the section feels finished, and
the gate refuses to close without a handoff a cold session can start from. Same
shape as game.json: the skeleton ships with TODO markers and `close` fails
while any survive.

    section.py brief  N | "research and plan"  # scope, exit criteria, the rules
    section.py resume --game "incremental"     # "continue with the development of ..."
    section.py resume --dir GAME               # same, when the folder is known
    section.py handoff N --dir GAME [--ledger RUN_DIR]   # write the HANDOFF.md skeleton
    section.py close  N --dir GAME             # the gate; stop only after it passes
    section.py resume --dir GAME --expect N    # refuses if N is not the next section
    section.py approve N --dir GAME            # you approved: safe to clear the chat

--ledger is the run directory `run_log.py init` created (the one holding
meta.json). It is recorded in design/sections.json on the first handoff and
reused after that.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parent.parent
RUN_LOG = SKILLS / "ul-build-orchestrator" / "scripts" / "run_log.py"
CODE_CHECK = SKILLS / "ul-luau-code" / "scripts" / "check.py"

sys.path.insert(0, str(HERE))
from validate import ARTIFACTS  # noqa: E402  one definition of "a stage's artifact"

# The six sections, mapped onto this skill's pipeline stages. The map blockout
# goes with code because the loop is PLAYED before art, the full map goes with
# the other visual assets, VFX goes with motion and sound. Budgets are
# suggestions, in minutes.
SECTIONS = {
    1: {
        "aliases": ['research', 'plan', 'planning', 'design'],
        "uses": ['web research (WebSearch/WebFetch, or a research skill if you have one)', 'ul-game-pipeline (the design contract)'],
        "title": "Research and design",
        "budget_min": 45,
        "pipeline": "0 preflight, 1 research, 2 design, 2a game plan, 2b asset plan",
        "scope": [
            "Ask for Roblox Studio screen access, then run preflight.py.",
            "Start the ledger ONCE: run_log.py init --dir <abs> --run <game-slug>. Never again. "
            "One ledger per game.",
            "If the prompt NAMES A GENRE (battlegrounds, incremental, ...), that genre is fixed: "
            "research THAT genre - what its top games do, what is saturated, where the gap is - "
            "and make every call inside it yourself (theme, twist, core loop, scope). If no genre "
            "is named, pick one and argue for it. Either way, cite sources you opened and do not "
            "present options: making you choose between them is an intervention.",
            "new_game.py, then fill design/game.json: core loop, scope, systems, plan, asset_plan.",
            "validate.py green. No code, no assets.",
        ],
        "ledger_stages": ["market-research", "design-spec"],
        "stages_done": [],
        "headings": [],
    },
    2: {
        "aliases": ['code', 'coding', 'scripting', 'loop', 'blockout'],
        "uses": ['ul-luau-code', 'ul-map-builder (placeholder blockout only)'],
        "title": "Code and the playable loop",
        "budget_min": 90,
        "pipeline": "3 code, 4 map BLOCKOUT only, then play the loop on placeholder art",
        "scope": [
            "ul-luau-code: scaffold green on all four gates before game logic, then every system.",
            "A placeholder-part blockout of the map, just enough to play the loop.",
            "Assemble in Studio (one Rojo connection) and PLAY it: the loop starts, the core "
            "verb works, the round ends. Placeholder parts are the correct look here.",
            "No meshes, UI art, animation, VFX or sound yet.",
        ],
        "ledger_stages": ["code"],
        "stages_done": [],
        "headings": ["Loop playtest"],
    },
    3: {
        "aliases": ['art', 'map', '3d', 'models', 'meshes', 'ui', 'visuals', 'world'],
        "uses": ['ul-map-builder', 'ul-3d-model', 'ul-texture-gen', 'ul-ui-builder'],
        "title": "World and visuals",
        "budget_min": 60,
        "pipeline": "4 map (full), 5 meshes + colour + materials, 6 ui",
        "scope": [
            "ul-map-builder: the proven greybox/terrain layout, replacing the blockout. Props come from your own models or ul-3d-model.",
            "ul-3d-model (+ ul-texture-gen for colour): every mesh in asset_plan, uploaded.",
            "ul-ui-builder: every screen the design names.",
            "Fan-out workers are allowed; every one is fanned in and its manifest checked before close.",
        ],
        "ledger_stages": ["map", "3d-meshes", "ui"],
        "stages_done": ["map", "meshes", "ui"],
        "headings": [],
    },
    4: {
        "aliases": ['animation', 'animations', 'vfx', 'effects', 'sound', 'sfx', 'audio'],
        "uses": ['ul-animation', 'ul-vfx-library', 'ul-sfx-finder'],
        "title": "Motion and sound",
        "budget_min": 60,
        "pipeline": "7 animation, 8 vfx, 9 sfx",
        "scope": [
            "ul-animation: Tier 2 (authored KeyframeSequence) first, fallback pre-authorised.",
            "ul-vfx-library: every effect in asset_plan, built from recipes harvested from your own library (see the ul-vfx-library skill).",
            "ul-sfx-finder: every sound role, chosen by you from the Creator Store and measured in Studio.",
            "animation and vfx start as 'skip' in a new game.json. They must end 'done'.",
        ],
        "ledger_stages": ["animation", "vfx", "sfx"],
        "stages_done": ["animation", "vfx", "sfx"],
        "headings": [],
    },
    5: {
        "aliases": ['assembly', 'assemble', 'playtest', 'testing', 'integration'],
        "uses": ['ul-game-pipeline (integration, assembly, wiring, playtest)'],
        "title": "Assembly, playtest and self-correction",
        "budget_min": 45,
        "pipeline": "9b integration, 10 assembly, 10b wiring, 11 playtest",
        "scope": [
            "Integration pass over every seam the asset plan named.",
            "Assemble everything; verify_wired.py static AND live passes green.",
            "Play it (two clients where the loop needs them), find defects, fix them yourself.",
            "HANDOVER.md pre-handover matrix filled, every row measured or UNTESTED.",
        ],
        "ledger_stages": ["assembly-playtest"],
        "stages_done": [],
        "headings": ["Playtest findings"],
    },
    6: {
        "aliases": ['publish', 'publishing', 'release'],
        "uses": ['ul-game-pipeline (publish)'],
        "title": "Publish",
        "budget_min": 15,
        "pipeline": "12 publish",
        "scope": [
            "Publish to the universe and place you minted. Record the ids in game.json.publish.",
            "Confirm audio and animation work in a REAL server, not only in Studio.",
        ],
        "ledger_stages": ["publish"],
        "stages_done": [],
        "headings": ["Live server check"],
    },
}

# The rules for every section. Printed by brief/resume and copied into every
# HANDOFF.md, so a cleared session gets them from the file rather than memory.
# They are the working rules of a section, not failure states for the agent to judge.
RULES = [
    "ONE SECTION PER SESSION. Finish this section's whole scope, then stop. Inside a section "
    "the skill's 'the run does not stop' rule applies in full; `section.py close N` passing "
    "is the only place you stop. Never start the next section's work, even with budget left.",
    "STAY INSIDE CLAUDE CODE AND ROBLOX STUDIO. Work through the skills, MCPs and CLIs. No "
    "browser-driving tools (browser pane, Chrome), no web-GUI generators. WebSearch and "
    "WebFetch inside Claude Code are fine. Screen access is for Roblox Studio only.",
    "NOTHING IN STUDIO BY THE USER'S HAND. Never ask the user to place, type, edit or configure "
    "anything in Studio, and never ask them to leave Claude Code or Studio. You may ask for: "
    "pressing Play or Stop, clicking Publish, approving a tool call, restarting a stuck MCP, "
    "or something purely mechanical no API or screen action of yours can reach.",
    "LOG INTERVENTIONS AS THEY HAPPEN (run_log.py event --kind intervention): the user writes or "
    "edits code, makes a design or art decision (a genre named in the section 1 prompt is the "
    "brief, not an intervention), chooses between options, tells you WHAT is "
    "wrong rather than THAT something is wrong, or does something in Studio by hand. So never "
    "offer options: decide, and say why.",
    "TIER 2 FIRST, fallback pre-authorised: take it without asking and log it as a fallback. "
    "30-minute stall rule: one problem eats 30 minutes, fall back, log it, keep moving.",
    "EVERY SESSION: ask for Roblox Studio screen access first (a grant does not survive a "
    "cleared session). 'Continue with the development of the <genre> game' means `section.py "
    "resume --game \"<genre>\"`: it finds the game and says which section is next.",
    "THE LEDGER IS INITIALISED ONCE, in section 1. Every later call passes the --dir and "
    "--run recorded in HANDOFF.md. Bracket each ledger stage with start/end.",
    "BEFORE CLOSING: save the place, write HANDOFF.md with `section.py handoff N`, replace every "
    "placeholder, run `section.py close N`. Then stop and ask the user to approve. Approval is free. If "
    "the user asks for changes, make them, log an intervention if they named what was wrong, update "
    "HANDOFF.md and close again. When the user approves (\"approved\", \"yes that's all good\"), run "
    "`section.py approve N` and say it is safe to clear the chat. Do not start the next section.",
]

BASE_HEADINGS = [
    "Where things are",
    "Done this section",
    "Decisions and why",
    "Unproven",
    "Debts",
    "Ledger",
    "Place",
    "Rules",
    "Next section: first step",
]

MARKER = re.compile(r"<!--\s*section:\s*(\d+)\s*-->")


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def section(n: int) -> dict:
    if n not in SECTIONS:
        raise SystemExit(f"no section {n}; sections are 1-{len(SECTIONS)}")
    return SECTIONS[n]


def state_path(root: Path) -> Path:
    return root / "design" / "sections.json"


def load_state(root: Path) -> dict:
    p = state_path(root)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"ledger": None, "closed": {}}


def save_state(root: Path, st: dict) -> None:
    state_path(root).write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")


GAMES_HOME = Path(os.environ.get("ROBLOX_GAMES_HOME") or Path.home() / "Projects" / "Roblox-Games")
INDEX = GAMES_HOME / ".section-games.json"


def register(root: Path) -> None:
    """Remember every section-mode game, wherever its folder is.

    The next session is started with "continue with the development of the
    incremental game" - no path. So the game has to be findable by what it IS."""
    idx = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}
    idx[str(root)] = now_iso()
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(idx, indent=2) + "\n", encoding="utf-8")


def known_games() -> list[Path]:
    roots: set[Path] = set()
    if INDEX.exists():
        roots |= {Path(k) for k in json.loads(INDEX.read_text(encoding="utf-8"))}
    roots |= {p.parent.parent for p in GAMES_HOME.glob("*/design/sections.json")}
    return [r for r in roots if (r / "design" / "sections.json").exists()]


def is_finished(root: Path) -> bool:
    return str(len(SECTIONS)) in load_state(root)["closed"]


STOPWORDS = {"the", "a", "an", "game", "my", "roblox", "of", "with", "on", "continue",
             "development", "developing", "develop", "build", "building", "next", "section", "stage",
             "complete", "finish", "do", "for", "and", "please", "now", "start", "let", "lets", "s"}


def find_game(dir_arg: str | None, query: str | None) -> Path:
    """--dir if given; else the game whose design matches the words the user used.

    Matching reads the folder name and the whole of game.json (title, pitch and
    the plan's overview all name the genre), counts how many of the query's words
    appear, and prefers unfinished games, then the most recently touched."""
    if dir_arg:
        root = Path(dir_arg).expanduser().resolve()
        if not (root / "design" / "game.json").exists():
            raise SystemExit(f"no design/game.json under {root}")
        return root
    games = known_games()
    if not games:
        raise SystemExit(
            "no section-mode game exists yet. If the user asked to continue, say so in one line: "
            "there is nothing to continue, and section 1 (research and plan) starts a game."
        )
    # Stage words ("art", "sound") say WHICH SECTION, not which game, and short
    # ones match inside other words, so they are dropped and matching is by whole word.
    stage_words = {a for sec in SECTIONS.values() for a in sec["aliases"]}
    words = [w for w in re.findall(r"[a-z0-9]+", (query or "").lower())
             if w not in STOPWORDS and w not in stage_words]

    def score(r: Path) -> tuple:
        text = r.name.lower() + " " + (r / "design" / "game.json").read_text(encoding="utf-8").lower()
        tokens = set(re.findall(r"[a-z0-9]+", text)) | {r.name.lower()}
        hits = sum(1 for w in words if w in tokens or any(t.startswith(w) for t in tokens))
        return (hits, not is_finished(r), (r / "design" / "sections.json").stat().st_mtime)

    ranked = sorted(games, key=score, reverse=True)
    best = ranked[0]
    if words and score(best)[0] == 0:
        listing = "\n".join(f"  {g}" for g in ranked)
        raise SystemExit(f"no game matches {query!r}. Known games:\n{listing}")
    open_games = [g for g in ranked if not is_finished(g)]
    if not words and len(open_games) > 1:
        listing = "\n".join(f"  {g}" for g in open_games)
        raise SystemExit(f"more than one unfinished game - resume with --game \"<genre or name>\":\n{listing}")
    others = [g for g in ranked[1:] if words and score(g)[0] == score(best)[0]]
    if others:
        print("note: also matched " + ", ".join(str(g) for g in others) + " - picked the unfinished, most recent one")
    return best


def print_brief(n: int) -> None:
    s = section(n)
    print(f"SECTION {n}: {s['title'].upper()}   (suggested budget {s['budget_min']} min)")
    print(f"pipeline stages: {s['pipeline']}")
    print(f"skills: {', '.join(s['uses'])}")
    print("\nscope:")
    for line in s["scope"]:
        print(f"  - {line}")
    print("\nexit gate (section.py close):")
    print(f"  - ledger stages started and ended: {', '.join(s['ledger_stages'])}")
    if s["stages_done"]:
        print(f"  - game.json stages 'done' with artifacts on disk: {', '.join(s['stages_done'])}")
    extra = {1: "validate.py green", 2: "ul-luau-code check.py green",
             5: "validate.py --stage-gate, verify_wired.py --report, HANDOVER.md",
             6: "game.json publish ids recorded"}.get(n)
    if extra:
        print(f"  - {extra}")
    print("  - HANDOFF.md for this section, no TODO left")
    print("\nrules:")
    for i, r in enumerate(RULES, 1):
        print(f"  {i}. {r}")


def section_number(arg: str) -> int:
    """A number, or the words the user used for the stage ("research and plan")."""
    if arg.strip().isdigit():
        return int(arg)
    words = set(re.findall(r"[a-z0-9]+", arg.lower()))
    ranked = sorted(SECTIONS, key=lambda n: len(words & set(SECTIONS[n]["aliases"])), reverse=True)
    if not words & set(SECTIONS[ranked[0]]["aliases"]):
        raise SystemExit(f"{arg!r} names no section. Sections: " +
                         "; ".join(f"{n} {s['title']}" for n, s in SECTIONS.items()))
    return ranked[0]


def cmd_brief(a) -> int:
    print_brief(section_number(a.n))
    return 0


def cmd_resume(a) -> int:
    root = find_game(a.dir, a.game)
    st = load_state(root)
    closed = sorted(int(k) for k in st["closed"])
    nxt = (closed[-1] + 1) if closed else 1
    if closed and str(closed[-1]) not in st.get("approved", {}):
        # The user moving on to the next section IS the approval; record it so the
        # record of who signed off what stays complete.
        st.setdefault("approved", {})[str(closed[-1])] = now_iso() + " (implied by continuing)"
        save_state(root, st)
    print(f"game:      {root}")
    print(f"handoff:   {root / 'HANDOFF.md'}  <- READ THIS FIRST, in full")
    print(f"ledger:    {st.get('ledger') or '(not recorded yet)'}")
    print(f"closed:    {', '.join(map(str, closed)) or 'none'}")
    if a.expect is not None and a.expect != nxt:
        print(f"\nSTOP: this session was started as section {a.expect}, but the next section is {nxt} "
              f"({SECTIONS[nxt]['title'] if nxt in SECTIONS else 'none'}). Sections run in order. "
              f"Tell the user in one line and do no build work.")
        return 1
    if nxt > len(SECTIONS):
        print("\nall six sections are closed. The build is finished.")
        return 0
    print()
    print_brief(nxt)
    return 0


def cmd_handoff(a) -> int:
    n = a.n
    s = section(n)
    root = Path(a.dir).expanduser().resolve()
    if not (root / "design" / "game.json").exists():
        raise SystemExit(f"no design/game.json under {root}")
    st = load_state(root)
    if a.ledger:
        ledger = Path(a.ledger).expanduser().resolve()
        if not (ledger / "meta.json").exists():
            raise SystemExit(f"{ledger} has no meta.json - pass the run directory run_log.py init made")
        st["ledger"] = str(ledger)
        save_state(root, st)
    if not st.get("ledger"):
        raise SystemExit("no ledger recorded for this game yet - pass --ledger <run dir>")

    register(root)
    out = root / "HANDOFF.md"
    archive = root / "design" / "handoffs"
    if out.exists():
        m = MARKER.search(out.read_text(encoding="utf-8"))
        prev = m.group(1) if m else "unknown"
        if prev != str(n):
            # Earlier sections' handoffs are kept, never overwritten: section 5
            # still needs section 1's reasons.
            archive.mkdir(parents=True, exist_ok=True)
            dest = archive / f"HANDOFF-section-{prev}.md"
            dest.write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"archived previous handoff -> {dest}")
        elif not a.force:
            raise SystemExit(f"{out} is already the section {n} handoff. Edit it, or pass --force to reset it.")

    earlier = sorted(archive.glob("HANDOFF-section-*.md")) if archive.exists() else []
    ledger = Path(st["ledger"])
    nxt = n + 1
    lines = [
        f"<!-- section: {n} -->",
        f"# HANDOFF: section {n} of {len(SECTIONS)} closed ({s['title']})",
        "",
        f"Game: `{root}`",
        f"Written: {now_iso()}",
        "",
        "A cleared session starts from this file alone. Read it in full, then run:",
        "",
        "```bash",
        f"python ~/.claude/skills/ul-game-pipeline/scripts/section.py resume --dir \"{root}\"",
        "```",
        "",
        "## Where things are",
        "TODO: every file and Studio location this section produced or changed, as paths.",
        "",
        "## Done this section",
        "TODO: what was built and what verified it (a gate, a measured number, a playtest). No adjectives.",
        "",
        "## Decisions and why",
        "TODO: every design or technical decision made in this section and the reason.",
        "",
        "## Unproven",
        "TODO: what has not been verified, one line each. 'None' only if that is measured.",
        "",
        "## Debts",
        "TODO: every fallback, stall and intervention this section, and whether it is healed.",
        "",
        "## Ledger",
        "",
        "Initialised once in section 1. Never run `init` again.",
        "",
        "```bash",
        f"python ~/.claude/skills/ul-build-orchestrator/scripts/run_log.py counter --dir \"{ledger.parent}\" --run \"{ledger.name}\"",
        "```",
        "",
        "## Place",
        "TODO: where the place is saved and when, and the universe/place ids if minted.",
    ]
    for h in s["headings"]:
        lines += ["", f"## {h}", f"TODO: {h.lower()}, measured."]
    lines += ["", "## Rules", ""]
    lines += [f"{i}. {r}" for i, r in enumerate(RULES, 1)]
    lines += ["", "## Next section: first step"]
    if nxt <= len(SECTIONS):
        ns = SECTIONS[nxt]
        lines += [
            f"Section {nxt}: {ns['title']} ({ns['pipeline']}).",
            "TODO: the exact first action, with the command or file it starts from.",
        ]
    else:
        lines += ["None. This was the last section."]
    if earlier:
        lines += ["", "## Earlier handoffs", ""]
        lines += [f"- `{p}`" for p in earlier]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {out} - fill every TODO, then `section.py close {n}`")
    return 0


def cmd_approve(a) -> int:
    root = find_game(a.dir, a.game)
    st = load_state(root)
    if str(a.n) not in st["closed"]:
        print(f"section {a.n} is not closed - `section.py close {a.n}` must pass before it can be approved")
        return 1
    st.setdefault("approved", {})[str(a.n)] = now_iso()
    save_state(root, st)
    print(f"SECTION {a.n} APPROVED. HANDOFF.md is final: {root / 'HANDOFF.md'}")
    title = json.loads((root / "design" / "game.json").read_text(encoding="utf-8")).get("title", "the game")
    print(f"It is safe to clear the chat. Next session: /ul-game-pipeline continue with the development of {title}")
    return 0


def run(cmd: list[str]) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    except FileNotFoundError as exc:
        return 127, str(exc)
    return p.returncode, (p.stdout + p.stderr).strip()


def ledger_ends(ledger: Path) -> set[str]:
    ends: set[str] = set()
    ev = ledger / "events.jsonl"
    if ev.exists():
        for line in ev.read_text(encoding="utf-8").splitlines():
            if line.strip():
                e = json.loads(line)
                if e.get("kind") == "end" and e.get("stage"):
                    ends.add(e["stage"])
    return ends


def cmd_close(a) -> int:
    n = a.n
    s = section(n)
    root = Path(a.dir).expanduser().resolve()
    game_path = root / "design" / "game.json"
    if not game_path.exists():
        raise SystemExit(f"no design/game.json under {root}")
    game = json.loads(game_path.read_text(encoding="utf-8"))
    st = load_state(root)
    problems: list[str] = []
    py = sys.executable

    for earlier in range(1, n):
        if str(earlier) not in st["closed"]:
            problems.append(f"section {earlier} was never closed. Sections close in order.")

    # The handoff: right section, every heading, no TODO.
    hf = root / "HANDOFF.md"
    if not hf.exists():
        problems.append(f"no HANDOFF.md - run `section.py handoff {n} --dir \"{root}\"` and fill it")
    else:
        text = hf.read_text(encoding="utf-8")
        m = MARKER.search(text)
        if not m or int(m.group(1)) != n:
            problems.append(f"HANDOFF.md is not the section {n} handoff (marker says {m.group(1) if m else 'nothing'})")
        for h in BASE_HEADINGS + s["headings"]:
            if not re.search(rf"^## {re.escape(h)}\s*$", text, re.M):
                problems.append(f"HANDOFF.md is missing '## {h}'")
        todos = [ln.strip() for ln in text.splitlines() if "TODO:" in ln]
        for t in todos:
            problems.append(f"HANDOFF.md still has a TODO: {t[:90]}")

    # The ledger: exists, and this section's stages were bracketed.
    if not st.get("ledger"):
        problems.append("no ledger recorded - `section.py handoff N --ledger <run dir>`")
    else:
        ledger = Path(st["ledger"])
        if not (ledger / "meta.json").exists():
            problems.append(f"recorded ledger {ledger} has no meta.json")
        else:
            ends = ledger_ends(ledger)
            for stage in s["ledger_stages"]:
                if stage not in ends:
                    problems.append(f"ledger stage '{stage}' was never ended (run_log.py start/end --stage {stage})")

    # Stages this section owns: done, with their artifact on disk.
    stages = game.get("stages", {})
    for name in s["stages_done"]:
        cfg = stages.get(name)
        if not isinstance(cfg, dict):
            problems.append(f"game.json has no stage '{name}'")
            continue
        if cfg.get("external_blocker"):
            print(f"  note  stage {name} declares an external blocker: {cfg['external_blocker']}")
            continue
        if cfg.get("status") != "done":
            problems.append(f"stage {name} is '{cfg.get('status')}', this section owns it and it must be 'done'")
        wanted = ARTIFACTS.get(name, [])
        if wanted and not any((root / w).exists() for w in wanted):
            problems.append(f"stage {name} has none of its artifacts on disk ({', '.join(wanted)})")

    # Section-specific gates, by running the gate that already exists.
    if n == 1:
        rc, out = run([py, str(HERE / "validate.py"), "--dir", str(root)])
        if rc != 0:
            problems.append("validate.py is not green:\n" + out[-1500:])
    elif n == 2:
        rc, out = run([py, str(CODE_CHECK), "--dir", str(root)])
        if rc != 0:
            problems.append("ul-luau-code check.py is not green:\n" + out[-1500:])
    elif n == 5:
        rc, out = run([py, str(HERE / "validate.py"), "--dir", str(root), "--stage-gate"])
        if rc != 0:
            problems.append("validate.py --stage-gate is not green:\n" + out[-1500:])
        report = root / "work" / "wired_report.txt"
        if not report.exists():
            problems.append("no work/wired_report.txt - the LIVE wiring pass never ran")
        else:
            rc, out = run([py, str(HERE / "verify_wired.py"), "--dir", str(root), "--report", str(report)])
            if rc != 0:
                problems.append("verify_wired.py is not green:\n" + out[-1500:])
        if not (root / "HANDOVER.md").exists():
            problems.append("no HANDOVER.md - the pre-handover matrix is the playtest's record")
    elif n == 6:
        pub = game.get("publish") or {}
        if not pub.get("universe_id") or not pub.get("place_id"):
            problems.append("game.json publish.universe_id / place_id are not recorded")

    if problems:
        print(f"SECTION {n} NOT CLOSED - {len(problems)} problem(s):")
        for p in problems:
            print(f"  FAIL  {p}")
        print("\nKeep working. Do not stop, summarise or ask for approval until this passes.")
        return 1

    st["closed"][str(n)] = now_iso()
    st.get("approved", {}).pop(str(n), None)  # a re-close after changes needs a fresh approval
    save_state(root, st)
    register(root)
    print(f"SECTION {n} CLOSED: {s['title']}")
    if st.get("ledger"):
        ledger = Path(st["ledger"])
        rc, out = run([py, str(RUN_LOG), "counter", "--dir", str(ledger.parent), "--run", ledger.name])
        if rc == 0:
            print(out)
    print("\nNow STOP. Tell the user the section is done, where HANDOFF.md is, and what is unproven, and ask")
    print(f"for approval. When they approve, run `section.py approve {n}`.")
    print("Do not begin the next section in this session.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("brief"); p.add_argument("n"); p.set_defaults(func=cmd_brief)
    p = sub.add_parser("resume"); p.add_argument("--dir"); p.add_argument("--game"); p.add_argument("--expect", type=int); p.set_defaults(func=cmd_resume)
    p = sub.add_parser("handoff"); p.add_argument("n", type=int); p.add_argument("--dir", default=".")
    p.add_argument("--ledger"); p.add_argument("--force", action="store_true"); p.set_defaults(func=cmd_handoff)
    p = sub.add_parser("close"); p.add_argument("n", type=int); p.add_argument("--dir", default=".")
    p.set_defaults(func=cmd_close)
    p = sub.add_parser("approve"); p.add_argument("n", type=int); p.add_argument("--dir"); p.add_argument("--game")
    p.set_defaults(func=cmd_approve)
    a = ap.parse_args()
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
