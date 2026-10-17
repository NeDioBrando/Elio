#!/usr/bin/env python3
"""Can the open place survive a crash? Answer before trusting a run.

This exists because an unrecoverable place cannot survive a crash, and Studio
crashes. Measured 2026-08-30: Studio exited on its own mid-session and relaunched
with a blocking Auto-Recovery modal. Everything in the unsaved place was gone.

There are TWO ways a place is recoverable, and the check accepts either:

  1. **Saved to a file** - the window title carries the full path.
  2. **Published to the account** - it has a real `placeId`, so it can be
     reopened from the Roblox website after any crash. Measured 2026-09-01:
     a run published mid-build to enable HttpService and API Services, and the
     file-only check then reported UNSAVED over a place that was strictly SAFER
     than a local file. A gate that fails on the safer state is a wrong gate.

**The DataModel cannot answer (1).** After saving to `...\\SavedPlaceTest.rbxl`,
`game.Name` still returned `Place1` and `game.PlaceId` was still 0. Only the
window title carries the path.

**`MainWindowTitle` is NOT a reliable read.** Measured 2026-09-01: with a saved
place open, `Get-Process RobloxStudioBeta | Select MainWindowTitle` returned the
bare string `RobloxStudio` - Windows had picked a helper top-level window as the
process's "main" window. The visible document window was still titled with the
full path. So enumerate every visible top-level window owned by the process and
keep the ones that look like a Studio document window, rather than trusting
Windows' choice of one.

    place_state.py                      # SAVED <path> / PUBLISHED / UNSAVED
    place_state.py --place-id 1234567890  # accept a published place as recoverable
    place_state.py --json

`--place-id` also reads the `ROBLOX_PLACE_ID` environment variable. Pass the id
that `game.PlaceId` returns in Studio; a value of 0 means unpublished and is
rejected.

How to save to a file, which is a SCREEN action because `game:Save()` does not
exist (`Save is not a valid member of DataModel`):

    File > Save to File As    (Ctrl+Shift+S)   -> local .rbxl, what you want
    File > Save to File       (after the first save)  -> silent re-save

**Do NOT use Ctrl+S blindly.** In current Studio that is "Save Experience",
which PUBLISHES to the Roblox account and mints a new experience, with Team
Create and Data Sharing toggles defaulting on. That is the user's decision,
never the run's - but if the user has already made it, the place is recoverable
and this check says so.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

# Enumerate EVERY visible top-level window owned by any RobloxStudioBeta
# process, not just the one Windows nominates as MainWindow. See the module
# docstring: MainWindowTitle returned a bare "RobloxStudio" helper window over a
# correctly saved place, which is a false UNSAVED.
TITLE_PS = r"""
Add-Type -Namespace W -Name N -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
"@
$procIds = @(Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if ($procIds.Count -eq 0) { exit 0 }
$found = New-Object System.Collections.ArrayList
$cb = [W.N+EnumWindowsProc]{
  param($h, $l)
  if ([W.N]::IsWindowVisible($h)) {
    $wpid = 0
    [void][W.N]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($procIds -contains $wpid) {
      $sb = New-Object System.Text.StringBuilder 1024
      [void][W.N]::GetWindowText($h, $sb, 1024)
      $t = $sb.ToString()
      if ($t -like "*Roblox Studio*") { [void]$found.Add($t) }
    }
  }
  return $true
}
[void][W.N]::EnumWindows($cb, [IntPtr]::Zero)
$found | ForEach-Object { Write-Output $_ }
"""


def titles() -> list[str]:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", TITLE_PS],
        capture_output=True, text=True, timeout=90,
    )
    return [t.strip() for t in (out.stdout or "").splitlines() if t.strip()]


def parse(title: str, place_id: int = 0) -> dict:
    # Saved:     "C:\path\to\Thing.rbxl - Roblox Studio"
    # Published: "RPG TEST - Roblox Studio"   (no path, but game.PlaceId != 0)
    # Unsaved:   "Place1 - Roblox Studio"
    # A trailing "*" (or similar) marks unsaved changes in some builds.
    m = re.match(r"^(.*\.rbxlx?)\s*\*?\s*-\s*Roblox Studio", title, re.IGNORECASE)
    if m:
        return {"saved": True, "how": "file", "path": m.group(1), "title": title}
    if place_id:
        return {"saved": True, "how": "published", "path": f"placeId {place_id}", "title": title}
    return {"saved": False, "how": None, "path": None, "title": title}


def resolve_place_id(cli_value: str | None) -> int:
    raw = cli_value if cli_value is not None else os.environ.get("ROBLOX_PLACE_ID", "")
    try:
        return int(str(raw).strip() or 0)
    except ValueError:
        return 0


def state(place_id: int = 0) -> tuple[bool, str, list[dict]]:
    """(ok, one-line detail, per-window states). Shared with preflight.py."""
    found = titles()
    if not found:
        return True, "Studio not running (nothing to check yet)", []
    states = [parse(t, place_id) for t in found]
    if len(found) > 1:
        return False, f"{len(found)} Studio windows open - a run needs exactly ONE", states
    s = states[0]
    if s["saved"] and s["how"] == "file":
        return True, "place is saved to a file", states
    if s["saved"]:
        return True, f"place is published ({s['path']}) - recoverable from the account", states
    return False, "place is UNSAVED and unpublished - it cannot be reopened after a crash (Ctrl+Shift+S)", states


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--place-id", default=None,
                    help="game.PlaceId from Studio; non-zero means published, which is recoverable. "
                         "Falls back to $ROBLOX_PLACE_ID.")
    a = ap.parse_args()

    place_id = resolve_place_id(a.place_id)
    ok, detail, states = state(place_id)

    if a.json:
        print(json.dumps({"ok": ok, "detail": detail, "placeId": place_id, "studios": states}, indent=1))
        return 0 if ok else 1

    if not states:
        print("Studio is not running.")
        return 1

    if len(states) > 1:
        # More than one Studio is its own hazard: two MCP plugins long-polling is
        # the duplicate-server deadlock. This was a WARNING until 2026-08-31,
        # when a run spawned a second Studio on its very first action and the
        # warning changed nothing because it did not touch the exit code. A
        # warning nobody is required to read is a doc, not a gate.
        print(f"FAIL: {len(states)} Studio windows open. A run needs EXACTLY one.")
        print("  Two Studio plugins long-polling the MCP port is the duplicate-")
        print("  server deadlock. Close all but the one holding the run's place.")
        print("  And never use computer-use's open_application on Roblox Studio -")
        print("  it LAUNCHES a second instance rather than focusing the running")
        print("  one. Use Win32 SetForegroundWindow instead.")

    for s in states:
        if s["saved"] and s["how"] == "file":
            print(f"SAVED     {s['path']}")
        elif s["saved"]:
            print(f"PUBLISHED {s['path']}  ({s['title']})")
        else:
            print(f"UNSAVED   {s['title']}")

    if not ok and len(states) == 1:
        print()
        print("An unrecoverable place cannot be reopened after a crash, and Studio crashes.")
        print("Save it: File > Save to File As (Ctrl+Shift+S), or publish it and pass")
        print("--place-id / $ROBLOX_PLACE_ID so this check can see that it is recoverable.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
