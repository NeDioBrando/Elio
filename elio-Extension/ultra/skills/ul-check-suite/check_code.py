#!/usr/bin/env python3
"""check_code.py - Check-Code scanner for Roblox Luau.

A pattern scanner, not a parser. It prints a table of Check-Code results for the files you give it.
Exit code 1 if any FAIL, so it can run in CI or in a gate.

Usage:
  python check_code.py src/server/*.luau src/shared/*.luau
  python check_code.py --json report.json src/

Limits: see SKILL.md. A PASS here is not proof that the code works.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

RULES = {
    3: "No deprecated globals (wait, spawn, delay, tick)",
    4: "WaitForChild has a timeout",
    5: "No indexing a FindFirstChild result on the same line",
    7: "while true loops contain a wait",
    9: "DataStore: no GetAsync/SetAsync pair in one file",
    12: "pcall captures its error",
    14: "New modules declare --!strict",
    18: "No print debugging or tick() in code",
}

# Each check: (rule, severity, regex, message). severity FAIL or WARN.
LINE_CHECKS = [
    (3, "FAIL", re.compile(r"(?<![\w.:])wait\s*\("), "use task.wait()"),
    (3, "FAIL", re.compile(r"(?<![\w.:])spawn\s*\("), "use task.spawn()"),
    (3, "FAIL", re.compile(r"(?<![\w.:])delay\s*\("), "use task.delay()"),
    (3, "WARN", re.compile(r"(?<![\w.:])tick\s*\(\s*\)"), "use os.clock() for timing"),
    (4, "FAIL", re.compile(r":WaitForChild\(\s*[^,()]*\)"), "pass a timeout as the second argument"),
    (5, "FAIL", re.compile(r"FindFirstChild\([^()]*\)\s*\."), "store the result and check it for nil first"),
    (18, "WARN", re.compile(r"(?<![\w.:])print\s*\("), "remove debug print or change to warn with a clear message"),
]


def scan_file(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    out: list[dict] = []

    def add(rule, result, line_no, note):
        out.append({"rule": rule, "name": RULES[rule], "result": result,
                    "where": f"{path}:{line_no}" if line_no else str(path), "note": note})

    for i, line in enumerate(lines, 1):
        code = line.split("--", 1)[0]  # ignore comments
        for rule, sev, rx, msg in LINE_CHECKS:
            if rx.search(code):
                add(rule, sev, i, msg)

    # rule 12: a pcall whose result is thrown away (no "=" before it on the line)
    for i, line in enumerate(lines, 1):
        code = line.split("--", 1)[0]
        m = re.search(r"\bpcall\(", code)
        if m and "=" not in code[: m.start()]:
            add(12, "FAIL", i, "pcall result is discarded; capture ok and err, then warn the error")

    # rule 7: while true with a wait in the next 12 lines
    for i, line in enumerate(lines, 1):
        if re.search(r"\bwhile\s+true\s+do\b", line.split("--", 1)[0]):
            window = "\n".join(lines[i:i + 12])
            if "task.wait" not in window and "wait(" not in window:
                add(7, "FAIL", i, "while true loop has no task.wait nearby")

    # rule 9: DataStore read and write in one file, no UpdateAsync
    has_get = re.search(r":GetAsync\(", text) is not None
    has_set = re.search(r":SetAsync\(", text) is not None
    has_update = re.search(r":UpdateAsync\(", text) is not None
    if has_get and has_set and not has_update:
        add(9, "FAIL", None, "read then write in one file; use UpdateAsync for read-modify-write")

    # rule 14: new modules declare strict mode (only files with a return and no --!nonstrict)
    if path.suffix in {".luau", ".lua"} and not re.search(r"^--!(strict|nonstrict)", text, re.M):
        if re.search(r"^return\s", text, re.M):
            add(14, "WARN", None, "module has no --!strict line")

    return out


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(p.rglob("*.luau")) + sorted(p.rglob("*.lua"))
        elif p.is_file():
            files.append(p)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description="Check-Code scanner for Roblox Luau.")
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", help="also write results to this JSON file")
    args = ap.parse_args()

    files = collect(args.paths)
    if not files:
        print("no .luau or .lua files found", file=sys.stderr)
        return 2
    findings: list[dict] = []
    for f in files:
        findings += scan_file(f)

    print("| Rule | Result | Where | Note |")
    print("|---|---|---|---|")
    for fnd in findings:
        print(f"| {fnd['rule']}. {fnd['name']} | {fnd['result']} | {fnd['where']} | {fnd['note']} |")
    fails = sum(1 for f in findings if f["result"] == "FAIL")
    warns = sum(1 for f in findings if f["result"] == "WARN")
    print(f"\nFiles: {len(files)}. FAIL: {fails}. WARN: {warns}.")
    if not findings:
        print("Scanner found no pattern issues. This does not prove rules 1, 2, 6, 8, 10, 11, 13, 15, 16, 17.")
    if args.json:
        Path(args.json).write_text(json.dumps(findings, indent=2), encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
