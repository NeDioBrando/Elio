"""Run the actual desktop contract on LF/CRLF checkouts and reject real edits."""
from pathlib import Path
import contextlib
import hashlib
import io
import runpy
import tempfile

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = 'dd12795f341c420c901f0c2c5f7043a0edbdd8c1a72860e94702e5f9302c6448'
config = (ROOT / 'core/config.js').read_bytes().replace(b'\r\n', b'\n')
assert hashlib.sha256(config).hexdigest() == EXPECTED, 'Input config has real changes'
files = [
    'tools/test_studio_desktop_contract.py', 'tools/stamp_build.py',
    'Build-Windows.ps1', 'agent/src/main.rs', 'agent/src/studio_desktop.rs',
    'agent/src/studio_desktop.ps1', 'core/main.js', 'core/studio_skills.js',
    'core/config.js', 'elio-Extension/core/main.js', 'elio-Extension/core/studio_skills.js',
]
for skill in ['vfx-studio', 'qwinkles-particles-2', 'emitter2d', 'eclipse-animator']:
    for prefix in ['starter-skills', 'elio-Extension/starter-skills']:
        files.append(f'{prefix}/{skill}/SKILL.md')

with tempfile.TemporaryDirectory(prefix='elio-newlines-') as temp:
    root = Path(temp)
    for label, newline in [('LF', b'\n'), ('CRLF', b'\r\n')]:
        for name in files:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
            path.write_bytes(data.replace(b'\n', newline))
        path = root / 'core/config.js'
        original = path.read_bytes()
        with contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(root / 'tools/test_studio_desktop_contract.py'), run_name='__main__')
        assert path.read_bytes() == original, 'Test must not rewrite the config'
        print(f'PASS {label} checkout: actual desktop contract accepts unchanged configuration')
        path.write_bytes(original + b'// meaningful source edit' + newline)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(root / 'tools/test_studio_desktop_contract.py'), run_name='__main__')
        except AssertionError as error:
            # Verify the config guard is the rejecting assertion, not a broken
            # fixture or another disabled boundary.
            assert 'core/config.js changed' in str(error), str(error)
        else:
            raise AssertionError(f'{label}: real source edit was accepted')
        print(f'PASS {label} checkout: actual desktop contract rejects real configuration changes')
print('PASS newline normalization is text-only; binary/package SHA256 checks remain byte-exact')
