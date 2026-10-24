"""Offline verification of the actual pinned runtime and refusal paths."""
from pathlib import Path
import runpy, tempfile
from unittest.mock import patch
module = runpy.run_path(str(Path(__file__).with_name('prepare_engram.py')))
runtime = module['ROOT'] / 'runtime/engram' / module['NAME']
assert module['verify_runtime'](runtime) == runtime
with patch('urllib.request.urlopen', side_effect=AssertionError('Existing verified runtime must not download')):
    assert module['prepare'](runtime) == runtime
with tempfile.TemporaryDirectory() as temp:
    missing = Path(temp) / 'missing.exe'
    for contents in [None, b'MZ untrusted executable']:
        if contents: missing.write_bytes(contents)
        try: module['verify_runtime'](missing)
        except ValueError: pass
        else: raise AssertionError('Unverified runtime accepted')
    for data in [b'', b'not a trusted release', b'x' * (module['MAX_ARCHIVE'] + 1)]:
        try: module['extract_verified'](data)
        except ValueError: pass
        else: raise AssertionError('Untrusted archive accepted')
print('PASS pinned Engram runtime, offline reuse, missing/tampered executable and invalid/oversized archive refusal')
