#!/usr/bin/env python3
"""Assemble an execute_luau payload: codec + body, with %PLACEHOLDER% substitution.

The codec is never duplicated into a body. One definition, one place to fix.
"""
import argparse, json, pathlib, sys

LUAU = pathlib.Path(__file__).parent / "luau"


def build(body_name: str, subs: dict) -> str:
    codec = (LUAU / "codec.lua").read_text(encoding="utf-8")
    # codec.lua ends in `return VFX`; as a prelude we want the table in scope.
    codec = codec.replace("\nreturn VFX\n", "\n")
    codec = "local HttpService = game:GetService(\"HttpService\")\n" + codec.split(
        'local HttpService = game:GetService("HttpService")\n', 1)[1]
    body = (LUAU / f"{body_name}.lua").read_text(encoding="utf-8")
    # `--#include name` splices another luau/ file in. The element+timeline
    # engine is shared verbatim by the edit-mode and play-mode front ends; two
    # copies of it is exactly how the preview and the shipped thing start to
    # disagree, which is the one thing this skill exists to prevent.
    out = []
    for line in body.splitlines():
        inc = line.strip()
        if inc.startswith("--#include "):
            out.append((LUAU / f"{inc.split()[1]}.lua").read_text(encoding="utf-8"))
        else:
            out.append(line)
    body = "\n".join(out)
    for k, v in subs.items():
        body = body.replace(f"%{k}%", v)
    left = [t for t in ("ROOT_PATH", "TARGET_PATH", "RECIPE_JSON", "XFORM_JSON", "SINK_URL",
                        "COMP_JSON", "FREEZE_AT")
            if f"%{t}%" in body]
    if left:
        raise SystemExit(f"unsubstituted placeholders: {left}")
    return codec + "\n" + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("body")
    ap.add_argument("--root")
    ap.add_argument("--target")
    ap.add_argument("--recipe")
    ap.add_argument("--xform", default="{}")
    ap.add_argument("--sink", default="http://127.0.0.1:48752",
                    help="recipe sink URL; pass '' to force chunked-print output")
    ap.add_argument("--out")
    a = ap.parse_args()
    subs = {}
    if a.root:
        subs["ROOT_PATH"] = a.root
    if a.target:
        subs["TARGET_PATH"] = a.target
    if a.recipe:
        p = pathlib.Path(a.recipe)
        subs["RECIPE_JSON"] = json.dumps(json.loads(p.read_text(encoding="utf-8")))
    subs["XFORM_JSON"] = a.xform
    subs["SINK_URL"] = a.sink
    code = build(a.body, subs)
    if a.out:
        pathlib.Path(a.out).write_text(code, encoding="utf-8")
        print(f"{a.out} {len(code)} chars")
    else:
        sys.stdout.write(code)


if __name__ == "__main__":
    main()
