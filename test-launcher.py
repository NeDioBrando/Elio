"""Smoke tests for the Roblox Studio MCP launcher selection logic."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import launch_studio_mcp as launcher


class LauncherTests(unittest.TestCase):
    def test_prefers_roblox_documented_windows_launcher_when_present(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mcp_bat = root / "Roblox" / "mcp.bat"
            mcp_bat.parent.mkdir()
            mcp_bat.write_text("@echo off\r\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"LOCALAPPDATA": str(root)}, clear=False):
                self.assertEqual(launcher._official_windows_launcher(), mcp_bat)

    def test_windows_binary_fallback_prefers_a_complete_newer_studio_install(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "old"
            new = root / "new"
            old.mkdir()
            new.mkdir()
            (old / "StudioMCP.exe").touch()
            (new / "StudioMCP.exe").touch()
            (new / "RobloxStudioBeta.exe").touch()
            os.utime(new / "StudioMCP.exe", (2, 2))
            with mock.patch.object(launcher, "_candidate_roots_windows", return_value=[root]):
                self.assertEqual(launcher._find_studio_mcp_windows(), new / "StudioMCP.exe")



    def test_elio_agent_pe_is_unshifted(self):
        """A different-length version stamp in elio.exe shifts PE sections
        and Windows will not launch the app. File size must match the section table."""
        import struct
        data = Path(__file__).resolve().parent.joinpath("elio.exe").read_bytes()
        self.assertEqual(data[:2], b"MZ")
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        self.assertEqual(data[pe:pe + 4], b"PE\x00\x00")
        nsec = struct.unpack_from("<H", data, pe + 6)[0]
        optsz = struct.unpack_from("<H", data, pe + 20)[0]
        sec = pe + 24 + optsz
        end = 0
        for i in range(nsec):
            rsz, raw = struct.unpack_from("<II", data, sec + i * 40 + 16)
            end = max(end, raw + rsz)
        self.assertEqual(len(data), end, "PE grew/shrank vs its section table — do not patch version strings to a different length")
        self.assertNotIn(b"1.17.10", data, "1.17.10 is 1 byte longer than 1.17.9 and breaks the PE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
