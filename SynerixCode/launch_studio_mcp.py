"""Launch Roblox Studio's built-in MCP server.

The module is intentionally side-effect free when imported. This keeps the
selection helpers testable and lets the native Rust agent remain the preferred
runtime launcher while config.json can still reference this script.
"""

from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path
from typing import Iterable, Optional


_MCP_NAME = "StudioMCP.exe"
_STUDIO_NAME = "RobloxStudioBeta.exe"


def _official_windows_launcher() -> Optional[Path]:
    """Return Roblox's documented MCP batch launcher when it is installed."""
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        return None
    candidate = Path(local_appdata) / "Roblox" / "mcp.bat"
    return candidate if candidate.is_file() else None


def _candidate_roots_windows() -> list[Path]:
    """Return common Roblox install roots without requiring a fixed username."""
    roots: list[Path] = []
    for raw in (
        os.environ.get("LOCALAPPDATA"),
        os.environ.get("PROGRAMFILES"),
        os.environ.get("PROGRAMFILES(X86)"),
    ):
        if raw:
            roots.append(Path(raw))

    # Keep the helper tolerant of test doubles and unusual installations.
    return list(dict.fromkeys(roots))


def _iter_mcp_candidates(roots: Iterable[Path]) -> Iterable[Path]:
    """Yield StudioMCP.exe files below candidate roots, if any."""
    for root in roots:
        if not root.exists():
            continue
        try:
            yield from root.rglob(_MCP_NAME)
        except OSError:
            continue


def _find_studio_mcp_windows() -> Optional[Path]:
    """Find the best fallback MCP binary for a Windows Roblox install.

    A complete install contains both StudioMCP.exe and RobloxStudioBeta.exe.
    Prefer those complete installs, then prefer the most recently modified MCP
    binary so an old side-by-side Studio install does not win accidentally.
    """
    candidates = [p for p in _iter_mcp_candidates(_candidate_roots_windows()) if p.is_file()]
    if not candidates:
        return None

    complete: list[Path] = []
    for mcp in candidates:
        try:
            if (mcp.parent / _STUDIO_NAME).is_file():
                complete.append(mcp)
        except OSError:
            continue

    pool = complete or candidates
    try:
        return max(pool, key=lambda p: p.stat().st_mtime)
    except OSError:
        return pool[0]


def find_launcher() -> Optional[Path]:
    """Return the official launcher or a discovered MCP executable."""
    if platform.system().lower() == "windows":
        return _official_windows_launcher() or _find_studio_mcp_windows()
    return None


def main() -> int:
    launcher = find_launcher()
    if launcher is None:
        raise SystemExit(
            "Roblox Studio MCP launcher not found. Open Studio and enable "
            "Assistant -> Manage MCP Servers -> Enable Studio as MCP server."
        )

    if launcher.suffix.lower() == ".bat":
        command = ["cmd", "/D", "/C", str(launcher)]
    else:
        command = [str(launcher)]
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    return subprocess.call(command, **options)


if __name__ == "__main__":
    raise SystemExit(main())
