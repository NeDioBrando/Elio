"""Check this machine for everything the Roblox skills use, and report what is missing.

    python check_setup.py           # human-readable table
    python check_setup.py --json    # for the setup skill to read

Reads only. Installs nothing, changes nothing. Secret values are NEVER printed:
for an API key it reports only whether the environment variable is set.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import sys
from pathlib import Path

HOME = Path.home()
SKILLS_DIR = HOME / ".claude" / "skills"
AGENTS_DIR = HOME / ".claude" / "agents"

SKILLS = [
    "ul-game-pipeline", "ul-build-orchestrator", "ul-luau-code", "ul-map-builder", "ul-ui-builder",
    "ul-vfx-library", "ul-sfx-finder", "ul-animation", "ul-3d-model", "ul-texture-gen",
]

# tool -> (needed by, how to get it)
TOOLS = {
    "python": ("everything", "https://www.python.org/downloads/ (3.11 or newer)"),
    "rojo": ("ul-luau-code, ul-game-pipeline", "https://rojo.space (or install with rokit/aftman)"),
    "wally": ("ul-luau-code (packages such as Knit)", "https://wally.run"),
    "lune": ("ul-luau-code (headless tests)", "https://lune-org.github.io/docs"),
    "selene": ("ul-luau-code (lint)", "https://github.com/Kampfkarren/selene"),
    "stylua": ("ul-luau-code (format)", "https://github.com/JohnnyMorganz/StyLua"),
    "blender": ("ul-3d-model, ul-animation", "https://www.blender.org/download/ (4.x)"),
    "node": ("ul-3d-model hard-surface route only", "https://nodejs.org (optional)"),
    "ffmpeg": ("contact sheets / previews (optional)", "https://ffmpeg.org (optional)"),
}

# env var -> (needed by, required?)
ENV = {
    "ROBLOX_API_KEY": ("permanent uploads of meshes/images/animations (Open Cloud key, free)", False),
    "ROBLOX_USER_ID": ("Open Cloud uploads go to this creator", False),
    "ROBLOX_GROUP_ID": ("upload to a group instead of a user (optional)", False),
    "HF_TOKEN": ("ul-3d-model on a Hugging Face Space", False),
    "CF_ACCOUNT_ID": ("concept images / icons via Cloudflare Workers AI (free tier)", False),
    "CF_API_TOKEN": ("pairs with CF_ACCOUNT_ID", False),
    "KILN_HOME": ("ul-3d-model hard-surface route (optional)", False),
}


def find_tool(name: str) -> str | None:
    hit = shutil.which(name) or shutil.which(name + ".exe")
    if hit:
        return hit
    extra = [HOME / ".rokit" / "bin", HOME / ".aftman" / "bin", HOME / ".cargo" / "bin"]
    if name == "blender":
        roots = [Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Blender Foundation",
                 Path("/Applications/Blender.app/Contents/MacOS")]
        for r in roots:
            if r.exists():
                found = sorted(r.rglob("blender.exe")) + sorted(r.glob("Blender"))
                if found:
                    return str(found[-1])
    if name == "python":
        return sys.executable
    for d in extra:
        for cand in (d / name, d / (name + ".exe")):
            if cand.exists():
                return str(cand)
    return None


def studio_mcp() -> str:
    """The official Roblox Studio MCP is registered in Claude Code's config. Report by name only."""
    def servers(node, out):
        # mcpServers blocks sit at the top level and under each project entry
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "mcpServers" and isinstance(v, dict):
                    out.update(v.keys())
                else:
                    servers(v, out)
        return out

    for cfg in (HOME / ".claude.json", HOME / ".claude" / "settings.json", Path.cwd() / ".mcp.json"):
        try:
            names = servers(json.loads(cfg.read_text(encoding="utf-8")), set())
        except (OSError, ValueError):
            continue
        hits = sorted(n for n in names if "roblox" in n.lower() or "studio" in n.lower())
        if hits:
            return f"registered as {', '.join(hits)} (in {cfg.name}); confirm it connects with your AI tool's MCP list command"
    return ("not in Claude Code's config files. It may be registered another way (the desktop app or a plugin): "
            "the real test is calling get_studio_state with Studio open. If that fails, enable the MCP in Studio "
            "and add it to Claude Code")


def main() -> int:
    rows = {"platform": f"{platform.system()} {platform.release()}", "python": sys.version.split()[0],
            "tools": {}, "env": {}, "skills": {}, "agents": [], "studio_mcp": studio_mcp()}
    for t, (need, how) in TOOLS.items():
        rows["tools"][t] = {"path": find_tool(t), "needed_by": need, "get": how}
    for k, (need, _) in ENV.items():
        rows["env"][k] = {"set": bool(os.environ.get(k)), "needed_by": need}
    for s in SKILLS:
        d = SKILLS_DIR / s
        tpl = d / "LOCAL.template.md"
        text = tpl.read_text(encoding="utf-8", errors="replace").lower() if tpl.exists() else ""
        rows["skills"][s] = {"installed": (d / "SKILL.md").exists(),
                             "LOCAL.md": (d / "LOCAL.md").exists(),
                             "template": tpl.exists(),
                             # a template that says it needs nothing is ready as installed
                             "needs_settings": not tpl.exists() or not any(
                                 k in text for k in ("needs no machine-specific", "needs nothing machine-specific"))}
    rows["agents"] = sorted(p.stem for p in AGENTS_DIR.glob("roblox-*.md")) if AGENTS_DIR.exists() else []

    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
        return 0
    print(f"Platform: {rows['platform']}   Python: {rows['python']}")
    print(f"Roblox Studio MCP: {rows['studio_mcp']}\n")
    print("TOOLS")
    for t, r in rows["tools"].items():
        mark = "ok " if r["path"] else "-- "
        print(f"  {mark}{t:8s} {r['path'] or 'missing  -> ' + r['get']}   ({r['needed_by']})")
    print("\nENV VARS (values never shown)")
    for k, r in rows["env"].items():
        print(f"  {'set' if r['set'] else '-- '} {k:16s} {r['needed_by']}")
    print("\nSKILLS")
    for s, r in rows["skills"].items():
        state = ("missing" if not r["installed"] else "configured" if r["LOCAL.md"]
                 else "needs LOCAL.md" if r["needs_settings"] else "ready (no settings needed)")
        print(f"  {s:28s} {state}")
    print(f"\nAGENTS: {', '.join(rows['agents']) or 'none installed'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
