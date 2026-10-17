#!/usr/bin/env python3
"""Create the workspace a build runs in, and the one document it runs from.

    new_game.py "My Game" --dir <games folder>/MyGame

Lays down the ul-luau-code scaffold (by calling that skill's own scaffolder, so
there is one definition of a project and not two), then adds:

    design/game.json     THE CONTRACT. Every later stage reads a slice of this.
    design/*.json        one stub spec per stage, pre-filled from game.json
    assets/              where worker output lands
    BUILD.md             the stage checklist, with the exit criterion for each

game.json ships full of TODO markers on purpose. `validate.py` fails while any
remain, so the design stage cannot be skipped by accident - which is the failure
this whole layout is built to prevent, because every downstream skill silently
does something plausible when handed a vague spec.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# The skills folder is the parent of this skill, wherever the user installed it;
# fall back to the standard Claude Code location.
_SKILLS = Path(__file__).resolve().parent.parent.parent
CODE_SKILL = _SKILLS / "ul-luau-code" / "scripts" / "new_project.py"
if not CODE_SKILL.exists():
    CODE_SKILL = Path.home() / ".claude" / "skills" / "ul-luau-code" / "scripts" / "new_project.py"

TODO = "TODO"

BUILD_MD = """# {title} - build checklist

One core loop. Every stage has an exit criterion that can be checked, not
eyeballed. A stage is not done because it produced files; it is done because its
criterion passed.

| # | Stage | Exit criterion | Done |
|---|---|---|---|
| 0 | preflight | every REQUIRED row green | [ ] |
| 0b | save the place | `place_state.py` says SAVED. **File > Save to File As, NEVER Ctrl+S** (that publishes) | [ ] |
| 1 | research | a findings file naming the genre, with sources that were opened | [ ] |
| 2 | design | `validate.py` passes: no TODO left, every referenced spec exists | [ ] |
| 3 | code | `ul-luau-code/scripts/check.py` all four gates green | [ ] |
| 4 | map | the prover returns PASS, not UNVERIFIABLE | [ ] |
| 5 | meshes | manifest lists MEASURED bounds and tri counts, all under budget | [ ] |
| 6 | ui | mockup PNG and .model.json emitted from the same tree | [ ] |
| 7 | animation | verification renders exist AND were looked at | [ ] |
| 8 | vfx | phase-frozen captures for every effect | [ ] |
| 9 | sfx | roles filled == roles requested, zero unfilled | [ ] |
| 10 | assembly | build stamp in Output, no duplicate modules, map + assets placed | [ ] |
| 10b | **wiring** | `verify_wired.py` green on the STATIC and the LIVE pass. Nothing generated is still a placeholder | [ ] |
| 11 | playtest | a human played it and reported back | [ ] |
| 12 | publish | place published and joinable | [ ] |

Re-save the place (File > Save to File) at every stage boundary. An unsaved
place cannot be reopened after a crash, and Studio does crash.

Stages 4 to 9 are the asset block and are mutually independent. They are the only
part of this list that may be fanned out to parallel workers (the default; see the
ul-game-pipeline skill). Stages 10 to 12 are single-threaded by law: one thread
touches Studio.

## Ledger

Every run is logged from the start, not reconstructed afterwards:

```
python ~/.claude/skills/ul-build-orchestrator/scripts/run_log.py init --run {slug} --mode fanout
```
"""

GAME = {
    "title": "",
    "slug": "",
    "pitch": TODO + ": one sentence. What the player does, and what is at stake.",
    "core_loop": [TODO + ": step 1", TODO + ": step 2", TODO + ": step 3"],
    "win_condition": TODO,
    "lose_condition": TODO,
    "players": {"min": 1, "max": 4},
    "session_minutes": 8,
    "out_of_scope": [
        "progression",
        "shop",
        "datastore",
        "anything that is not the one core loop",
    ],
    "stages": {
        "map": {"spec": "design/map.json", "status": "todo"},
        "meshes": {"spec": "design/meshes.json", "status": "todo"},
        "ui": {"spec": "design/ui.json", "status": "todo"},
        "animation": {"spec": "design/animations.json", "status": "skip"},
        "vfx": {"spec": "design/vfx.json", "status": "skip"},
        "sfx": {"spec": "design/sfx.json", "status": "todo"},
    },
    "systems": [
        {
            "name": TODO + "Service",
            "side": "server",
            "owns": TODO + ": the one piece of state this service is authoritative for",
        }
    ],
    "config": {TODO + "Tunable": 0},
    "publish": {"universe_id": None, "place_id": None},
}

STUBS = {
    "design/map.json": {
        "name": TODO,
        "theme": TODO,
        "note": "ul-map-builder spec. Build from a REFERENCE IMAGE, never from imagination.",
    },
    "design/meshes.json": {
        "assets": [
            {"name": TODO, "prompt": TODO + ": a shaded 3D toy render of ...", "tris": 6000}
        ],
        "note": "ul-3d-model. Colour: PAINT it (paint_texture.py), never project it.",
    },
    "design/ui.json": {
        "screens": [{"name": TODO, "elements": []}],
        "note": "ul-ui-builder spec. One tree emits the mockup, the .model.json and the Luau.",
    },
    "design/animations.json": {
        "rig": "R15",
        "clips": [{"name": TODO, "reference": TODO}],
        "note": "ul-animation. Match a reference by ANGLE and fraction-of-reach, not distance.",
    },
    "design/vfx.json": {
        "effects": [{"name": TODO, "from": "a recipe harvested into your own ul-vfx-library library"}],
        "note": "ul-vfx-library. Harvest effects, never generate them from scratch.",
    },
    "design/sfx.json": {
        "name": TODO,
        "roles": [
            {
                "name": TODO,
                "query": TODO,
                "kind": "SoundEffect",
                "min_len": 0.1,
                "max_len": 5.0,
                "volume": 0.5,
            }
        ],
        "note": "ul-sfx-finder. One role per thing the game needs a sound FOR.",
    },
}


def slugify(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", name.title()) or "Game"


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(json.dumps(data, indent=1) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("title")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    root = Path(a.dir).expanduser()
    slug = slugify(a.title)

    if not CODE_SKILL.exists():
        raise SystemExit(f"ul-luau-code skill not found at {CODE_SKILL}. Run preflight.py, and see LOCAL.md / the ul-setup-check skill.")

    cmd = [sys.executable, str(CODE_SKILL), a.title, "--dir", str(root)]
    if a.force:
        cmd.append("--force")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout + result.stderr)
        raise SystemExit("scaffold failed - nothing else was written")

    game = json.loads(json.dumps(GAME))
    game["title"] = a.title
    game["slug"] = slug
    write_json(root / "design" / "game.json", game)

    for rel, body in STUBS.items():
        write_json(root / rel, body)

    (root / "assets").mkdir(parents=True, exist_ok=True)
    (root / "assets" / ".gitkeep").touch()
    with open(root / "BUILD.md", "w", encoding="utf-8", newline="") as fh:
        fh.write(BUILD_MD.format(title=a.title, slug=slug))

    print(f"\ngame workspace ready at {root}")
    print("  design/game.json   the contract - fill it in before any stage runs")
    print("  BUILD.md           the checklist, with an exit criterion per stage")
    print("\nnext:")
    print(f"  cd {root} && aftman install && wally install")
    print("  # design stage: replace every TODO in design/*.json")
    print("  python ~/.claude/skills/ul-game-pipeline/scripts/validate.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
