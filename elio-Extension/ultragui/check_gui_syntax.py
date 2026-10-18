#!/usr/bin/env python3
"""check_gui_syntax.py - check Roblox GUI Luau against Roblox's own API dump.

Usage:
  python check_gui_syntax.py API-Dump.json file.lua [more.lua ...]

The API dump is the list of every Roblox class, property, event and enum. Get it from
github.com/MaximumADHD/Roblox-Client-Tracker (file API-Dump.json).

What it checks, line by line:
  - Instance.new("Class") names a real, creatable class
  - property assignments on variables made with Instance.new exist on that class
    (or on a parent class) and are properties, not functions or events
  - :Connect on a tracked variable uses a real event
  - Enum.Type.Item names a real enum and a real item in it
  - argument counts for UDim2.new (0 or 4), UDim.new (2), Color3.fromRGB (3),
    Vector2.new (0 or 2), ColorSequenceKeypoint.new (2), NumberSequenceKeypoint.new (2 or 3)

Limits: this is a line-by-line pattern check, not a full Luau parser. It does not
know the type of an untracked variable, so it skips those. A PASS does not prove the
code runs. A FAIL is a real problem to fix. Exit code 1 if anything fails.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ARG_RULES = {
    "UDim2.new": {0, 4},
    "UDim.new": {2},
    "Color3.fromRGB": {3},
    "Vector2.new": {0, 2},
    "ColorSequenceKeypoint.new": {2},
    "NumberSequenceKeypoint.new": {2, 3},
}

INSTANCE_NEW = re.compile(r'(?:local\s+)?(\w+)\s*=\s*Instance\.new\(\s*"(\w+)"\s*\)')
PROP_ASSIGN = re.compile(r'\b(\w+)\.(\w+)\s*=(?!=)')
CONNECT = re.compile(r'\b(\w+)\.(\w+):Connect\(')
ENUM_USE = re.compile(r'\bEnum\.(\w+)\.(\w+)\b')
CALL = re.compile(r'\b(UDim2\.new|UDim\.new|Color3\.fromRGB|Vector2\.new|'
                  r'ColorSequenceKeypoint\.new|NumberSequenceKeypoint\.new)\s*\(')


class Dump:
    def __init__(self, path: str):
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.classes = {c["Name"]: c for c in data["Classes"]}
        self.enums = {e["Name"]: {i["Name"] for i in e["Items"]} for e in data["Enums"]}

    def member(self, cls: str, name: str):
        """Return the member dict for cls.name, searching parent classes too; None if absent."""
        seen = set()
        while cls and cls not in seen and cls in self.classes:
            seen.add(cls)
            for m in self.classes[cls]["Members"]:
                if m["Name"] == name:
                    return m
            cls = self.classes[cls]["Superclass"]
        return None

    def creatable(self, cls: str) -> bool:
        c = self.classes.get(cls)
        return bool(c) and "NotCreatable" not in c.get("Tags", [])


def split_args(s: str) -> list[str]:
    """Split the text inside a call's parentheses on top-level commas."""
    args, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            args.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        args.append(cur.strip())
    return args


def value_type(rhs: str) -> str | None:
    """Type of a simple right-hand side, or None if it is not a simple literal we can judge."""
    m = re.match(r"(Enum)\.(\w+)\.\w+$", rhs)
    if m:
        return m.group(2)  # Enum.Font.GothamBlack -> "Font"
    for prefix, typ in (("UDim2.new(", "UDim2"), ("Color3.fromRGB(", "Color3"), ("Color3.new(", "Color3"),
                        ("Vector2.new(", "Vector2"), ("UDim.new(", "UDim")):
        if rhs.startswith(prefix):
            return typ
    if re.match(r'"[^"]*"$', rhs) or re.match(r"'[^']*'$", rhs):
        return "string"
    if rhs in ("true", "false"):
        return "bool"
    if re.match(r"-?\d+(\.\d+)?$", rhs):
        return "number"
    return None


NUMERIC = {"float", "double", "int", "int64", "number"}


def compatible(got: str, want: str) -> bool:
    """Does a literal of type `got` fit a property whose Roblox type is `want`?"""
    if got == "number":
        return want in NUMERIC
    if got == "string":
        return want in {"string", "ContentId", "Content"}  # "rbxassetid://..." is valid for asset properties
    return got == want


def call_args(line: str, start: int) -> str | None:
    """Return the text between the parentheses that open at position start-1."""
    depth, i = 1, start
    while i < len(line) and depth:
        if line[i] == "(":
            depth += 1
        elif line[i] == ")":
            depth -= 1
        i += 1
    return line[start:i - 1] if depth == 0 else None


def check_file(dump: Dump, path: Path) -> tuple[list[str], int]:
    problems: list[str] = []
    checked = 0
    tracked: dict[str, str] = {}  # variable -> class
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = re.sub(r"--.*$", "", raw)  # drop Luau comments
        where = f"{path.name}:{n}"

        for var, cls in INSTANCE_NEW.findall(line):
            checked += 1
            if not dump.creatable(cls):
                problems.append(f"{where}: Instance.new(\"{cls}\") is not a creatable Roblox class")
            tracked[var] = cls
        for var, prop in PROP_ASSIGN.findall(line):
            if var not in tracked:
                continue
            checked += 1
            mem = dump.member(tracked[var], prop)
            if mem is None:
                problems.append(f"{where}: {tracked[var]} has no property \"{prop}\"")
                continue
            if mem["MemberType"] != "Property":
                problems.append(f"{where}: \"{prop}\" on {tracked[var]} is a {mem['MemberType'].lower()}, not a property")
                continue
            rhs = re.search(rf"\b{var}\.{prop}\s*=\s*(.+)$", line)
            want = mem["ValueType"]["Name"]
            got = value_type(rhs.group(1).strip()) if rhs else None
            if got and not compatible(got, want):
                problems.append(f"{where}: {tracked[var]}.{prop} expects {want}, got {got}")

        for var, ev in CONNECT.findall(line):
            if var not in tracked:
                continue
            checked += 1
            mem = dump.member(tracked[var], ev)
            if mem is None or mem["MemberType"] != "Event":
                problems.append(f"{where}: {tracked[var]} has no event \"{ev}\"")

        for enum, item in ENUM_USE.findall(line):
            checked += 1
            if enum not in dump.enums:
                problems.append(f"{where}: Enum.{enum} does not exist")
            elif item not in dump.enums[enum]:
                problems.append(f"{where}: Enum.{enum}.{item} does not exist")

        for m in CALL.finditer(line):
            name = m.group(1)
            inner = call_args(line, m.end())
            if inner is None:
                continue  # call spans lines; not checked
            checked += 1
            count = len(split_args(inner)) if inner.strip() else 0
            if count not in ARG_RULES[name]:
                want = " or ".join(str(x) for x in sorted(ARG_RULES[name]))
                problems.append(f"{where}: {name} takes {want} arguments, got {count}")
    return problems, checked


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    dump = Dump(sys.argv[1])
    total_problems, total_checked = [], 0
    for f in sys.argv[2:]:
        problems, checked = check_file(dump, Path(f))
        total_problems += problems
        total_checked += checked
    for p in total_problems:
        print("FAIL", p)
    print(f"{total_checked} checks, {len(total_problems)} failed")
    return 1 if total_problems else 0


if __name__ == "__main__":
    sys.exit(main())
