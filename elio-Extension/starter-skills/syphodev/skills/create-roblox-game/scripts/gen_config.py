#!/usr/bin/env python3
"""Emit `src/shared/Config/GameConfig.luau` from `design/game.json` `config`.

    python gen_config.py --dir <game folder>

WHY THIS EXISTS (found in the code stage of an incremental game).
The contract already holds every tunable, and the skill's fifth standing rule
says a balance pass must be a data edit and never a code edit. Before this
script the two were retyped into Luau by hand, which is the same class of defect
as a typed mesh bound: the Luau and the JSON drift, the economy sim keeps
measuring the JSON, and the game ships the stale copy. Measured on this project:
`design/game.json` carries a 16-row upgrade table and a 10-row gate table whose
values came out of a bisecting calibrator, so a single mistyped exponent would
have silently moved a progression gate by tens of minutes with every gate still green.

So the Luau is GENERATED and carries a "do not edit" banner naming this script.
`--check` re-generates to a string and exits 1 if the file on disk differs, so a
hand edit is caught by a gate rather than by a playtest.

Numbers are emitted losslessly: an integral float is written as an integer, and
anything else with `repr()`, which round-trips a double in both Python and Luau.
Large magnitudes stay in decimal rather than scientific notation, because Luau
parses `1e+16` fine but a reader comparing it against the design doc cannot.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

BANNER = """--!strict
-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Source: design/game.json `config`
-- Regenerate: python ~/.claude/skills/create-roblox-game/scripts/gen_config.py --dir <game>
-- Every tunable in the game lives here, so a balance pass is a data edit to the
-- contract and never a code edit. `gen_config.py --check` fails if this file and
-- the contract have drifted apart.
"""

LUAU_KEYWORDS = {
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
    "true", "until", "while", "continue", "export", "type",
}


def is_ident(k: str) -> bool:
    if not k or k in LUAU_KEYWORDS:
        return False
    if not (k[0].isalpha() or k[0] == "_"):
        return False
    return all(c.isalnum() or c == "_" for c in k)


def num(v: float | int) -> str:
    """Write a JSON number as Luau, in decimal, without losing precision."""
    if isinstance(v, bool):  # bool is a subclass of int; never reach the number path
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError(f"cannot emit non-finite number {v!r}")
    # `repr` is the shortest string that round-trips the double.
    s = repr(v)
    if "e" not in s and "E" not in s:
        return str(int(v)) if v.is_integer() else s
    # Expand the exponent so a human can compare it against the design doc - but
    # only while the expansion is still READABLE. Measured 2026-09-18: 1e36 is not
    # exactly representable, so `f"{v:.0f}"` printed the double's true value,
    # 1000000000000000042420637374017961984. That is lossless and useless to a
    # reader checking it against the contract. Past 1e21 the decimal expansion
    # stops matching the literal a human wrote, so keep the exponent; Luau parses
    # `1e+36` perfectly well.
    if abs(v) < 1e21:
        expanded = f"{v:.0f}"
        if float(expanded) == v:
            return expanded
    return s


def emit(value, indent: int = 1) -> str:
    pad = "\t" * indent
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "nil"
    if isinstance(value, (int, float)):
        return num(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        if not value:
            return "{}"
        rows = [f"{pad}{emit(v, indent + 1)}," for v in value]
        return "{\n" + "\n".join(rows) + "\n" + "\t" * (indent - 1) + "}"
    if isinstance(value, dict):
        if not value:
            return "{}"
        rows = []
        for k, v in value.items():
            key = k if is_ident(k) else f"[{json.dumps(k, ensure_ascii=False)}]"
            rows.append(f"{pad}{key} = {emit(v, indent + 1)},")
        return "{\n" + "\n".join(rows) + "\n" + "\t" * (indent - 1) + "}"
    raise TypeError(f"cannot emit {type(value).__name__}")


def render(config: dict, root: Path | None = None) -> str:
    text = f"{BANNER}\nlocal GameConfig = {emit(config)}\n\nreturn GameConfig\n"
    return stylua(text, root)


def stylua(text: str, root: Path | None) -> str:
    """Run the project's formatter over the generated text, if it is installed.

    Without this the generator and the `stylua --check` gate fight: the generator
    writes valid Luau, stylua wants it laid out differently, and the gate goes red
    on a file nobody is allowed to edit by hand. Formatting HERE means the
    generated file is already in the project's own style, and `--check` compares
    formatted against formatted so the drift test still means what it says.

    If stylua is missing the text is returned unchanged - a formatter that is not
    installed should not stop a config being generated.
    """
    if shutil.which("stylua") is None:
        return text
    cwd = str(root) if root else None
    try:
        done = subprocess.run(
            ["stylua", "-"],
            input=text.encode("utf-8"),
            capture_output=True,
            cwd=cwd,
            check=True,
        )
    except (subprocess.CalledProcessError, OSError) as exc:
        print(f"warn: stylua could not format the generated config ({exc}); writing it unformatted")
        return text
    return done.stdout.decode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", default=".", help="game folder (holds design/ and src/)")
    ap.add_argument("--game", help="contract path (default <dir>/design/game.json)")
    ap.add_argument("--out", help="output path (default <dir>/src/shared/Config/GameConfig.luau)")
    ap.add_argument("--check", action="store_true", help="exit 1 if the file on disk has drifted")
    a = ap.parse_args()

    root = Path(a.dir).expanduser().resolve()
    game = Path(a.game).expanduser() if a.game else root / "design" / "game.json"
    out = Path(a.out).expanduser() if a.out else root / "src" / "shared" / "Config" / "GameConfig.luau"

    config = json.loads(game.read_text(encoding="utf-8"))["config"]
    text = render(config, root)

    if a.check:
        if not out.exists():
            print(f"FAIL {out} does not exist; run gen_config.py")
            return 1
        if out.read_text(encoding="utf-8") != text:
            print(f"FAIL {out} has drifted from {game}; regenerate it")
            return 1
        print(f"ok   GameConfig matches the contract ({len(config)} sections)")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    # Explicit LF: Python translates newlines to CRLF on Windows by default, which
    # would put this generated file in a different line ending from every
    # hand-written file beside it and make any later diff of it pure noise.
    out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {out} ({len(text)} bytes, {len(config)} sections)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
