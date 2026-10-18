#!/usr/bin/env python3
"""Turn candidates.json into the two Luau calls that verify them in Studio.

TWO calls, not one, and that is not a style choice. `execute_luau` drops all
output if the script yields at all, and a Sound does not resolve its length in
the same frame you set SoundId. So:

    call 1  probe.lua   creates every candidate Sound and returns immediately
    call 2  report.lua  reads IsLoaded and TimeLength a moment later

Anything still IsLoaded=false in call 2 gets one more report.lua before it is
treated as a genuine failure (unresolvable id, deleted asset, or audio the
place is not permitted to use).

    emit_probe.py work/candidates.json --out work/
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PROBE = """-- roblox-sfx: create every candidate Sound. Generated, do not hand-edit.
local SoundService = game:GetService("SoundService")

local root = SoundService:FindFirstChild("SFXProbe")
if not root then
\troot = Instance.new("Folder")
\troot.Name = "SFXProbe"
\troot.Parent = SoundService
end
root:ClearAllChildren()

local SPEC = {spec}

local made = 0
for _, role in ipairs(SPEC) do
\tlocal folder = Instance.new("Folder")
\tfolder.Name = role.role
\tfolder.Parent = root
\tfor _, id in ipairs(role.ids) do
\t\tlocal s = Instance.new("Sound")
\t\ts.Name = tostring(id)
\t\ts.SoundId = "rbxassetid://" .. tostring(id)
\t\ts.Volume = 0
\t\ts.Parent = folder
\t\tmade += 1
\tend
end

return string.format("created %d sounds across %d roles", made, #SPEC)
"""

REPORT = """-- roblox-sfx: measure what actually loaded. Generated, do not hand-edit.
-- TimeLength is the ONLY trustworthy duration in this pipeline.
local root = game:GetService("SoundService"):FindFirstChild("SFXProbe")
if not root then
\treturn "NO PROBE - run probe.lua first"
end

local lines = {}
for _, folder in ipairs(root:GetChildren()) do
\tfor _, s in ipairs(folder:GetChildren()) do
\t\ttable.insert(lines, string.format(
\t\t\t"%s,%s,%s,%.3f",
\t\t\tfolder.Name, s.Name, tostring(s.IsLoaded), s.TimeLength
\t\t))
\tend
end
table.sort(lines)
return table.concat(lines, "\\n")
"""

AUDITION = """-- roblox-sfx: play one candidate out loud in edit mode, for a human ear.
-- Studio plays Sounds in edit mode, so this needs no playtest.
local root = game:GetService("SoundService"):FindFirstChild("SFXProbe")
if not root then return "NO PROBE" end

local ROLE, ID, VOLUME = {role}, {id}, {volume}

local folder = root:FindFirstChild(ROLE)
if not folder then return "no such role: " .. ROLE end
local s = folder:FindFirstChild(tostring(ID))
if not s then return "no such id under " .. ROLE end

for _, other in ipairs(root:GetDescendants()) do
\tif other:IsA("Sound") and other.IsPlaying then other:Stop() end
end

s.Volume = VOLUME
s.TimePosition = 0
s:Play()
return string.format("playing %s / %s  (%.3fs)", ROLE, s.Name, s.TimeLength)
"""


def luau_table(spec: list[dict]) -> str:
    parts = []
    for role in spec:
        ids = ", ".join(str(i) for i in role["ids"])
        parts.append('\n\t{ role = "%s", ids = { %s } },' % (role["role"], ids))
    return "{" + "".join(parts) + "\n}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates")
    ap.add_argument("--out", default="work")
    ap.add_argument("--audition", nargs=3, metavar=("ROLE", "ID", "VOLUME"),
                    help="also write audition.lua for one candidate")
    a = ap.parse_args()

    data = json.loads(Path(a.candidates).read_text(encoding="utf-8"))
    spec = [
        {"role": r["role"], "ids": [c["id"] for c in r["candidates"]]}
        for r in data["roles"]
        if r["candidates"]
    ]
    if not spec:
        raise SystemExit("no candidates in " + a.candidates)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "probe.lua").write_text(PROBE.replace("{spec}", luau_table(spec)), encoding="utf-8")
    (out / "report.lua").write_text(REPORT, encoding="utf-8")

    n = sum(len(r["ids"]) for r in spec)
    print(f"{out/'probe.lua'}   creates {n} sounds across {len(spec)} roles")
    print(f"{out/'report.lua'}  reads IsLoaded + TimeLength")

    if a.audition:
        role, aid, vol = a.audition
        text = (AUDITION.replace("{role}", f'"{role}"')
                        .replace("{id}", str(int(aid)))
                        .replace("{volume}", str(float(vol))))
        (out / "audition.lua").write_text(text, encoding="utf-8")
        print(f"{out/'audition.lua'} plays {role}/{aid} at volume {vol}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
