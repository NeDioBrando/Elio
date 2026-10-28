"""Exercise source readers with the Windows cp1252 default, even on UTF-8 hosts."""
from pathlib import Path
import contextlib
import io
import runpy
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
read_text = Path.read_text
write_text = Path.write_text
implicit = []

def windows_read(path, encoding=None, errors=None, **kwargs):
    if encoding is None:
        implicit.append(str(path))
    return read_text(path, encoding=encoding or 'cp1252', errors=errors, **kwargs)

def windows_write(path, data, encoding=None, errors=None, **kwargs):
    if encoding is None:
        implicit.append(str(path))
    return write_text(path, data, encoding=encoding or 'cp1252', errors=errors, **kwargs)

# This source contains characters cp1252 cannot decode: reproduce the reported
# failure first, rather than merely asserting that a keyword was added.
try:
    (ROOT / 'agent/src/main.rs').read_bytes().decode('cp1252')
except UnicodeDecodeError:
    pass
else:
    raise AssertionError('Fixture no longer reproduces the Windows decoding failure')

with patch.object(Path, 'read_text', windows_read), patch.object(Path, 'write_text', windows_write), contextlib.redirect_stdout(io.StringIO()):
    runpy.run_path(str(ROOT / 'tools/test_studio_desktop_contract.py'), run_name='__main__')
    stamp = runpy.run_path(str(ROOT / 'tools/stamp_build.py'))
    stamp['stamp']()
    runpy.run_path(str(ROOT / 'tools/test_package_windows.py'), run_name='__main__')
assert not implicit, 'Locale-dependent build text IO: ' + ', '.join(implicit)
build = (ROOT / 'Build-Windows.ps1').read_text(encoding='utf-8')
assert build.index('$env:PYTHONUTF8 = "1"') < build.index('python tools/stamp_build.py')
print('PASS Windows cp1252 regression: reported decode failure reproduced; real desktop contract, source stamp and package fixture use explicit UTF-8; build enables Python UTF-8 before first invocation.')
