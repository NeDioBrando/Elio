"""Exercise the real packager with a marked fixture, not a Windows executable."""
from pathlib import Path
import contextlib, hashlib, io, json, runpy, subprocess, sys, tempfile, zipfile
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools/package_windows.py'


def assert_version_probe(command, expected):
    # resolve() may expand junctions, short paths or path casing on Windows.
    # Verify the actual file identity without accepting a different executable.
    assert len(command) == 2 and command[1] == '--version', command
    assert Path(command[0]).samefile(expected), command

with tempfile.TemporaryDirectory(prefix='elio-package-test-') as temp:
    base = Path(temp)
    # Deliberately non-canonical: reproduce the old string-comparison failure on every OS.
    (base / 'path-alias').mkdir()
    exe = base / 'path-alias' / '..' / 'fixture.exe'
    exe.write_bytes(b'MZ\x00ELIO TEST FIXTURE - NOT EXECUTABLE')
    output = base / 'out'
    assert str(exe.resolve()) != str(exe)
    assert_version_probe([str(exe.resolve()), '--version'], exe)
    wrong_exe = base / 'wrong.exe'
    wrong_exe.write_bytes(exe.read_bytes())
    for command in ([str(wrong_exe), '--version'], [str(exe.resolve()), '--help'], [str(exe.resolve()), '--version', '--extra']):
        try:
            assert_version_probe(command, exe)
        except AssertionError:
            pass
        else:
            raise AssertionError('Wrong executable or arguments accepted')
    def invoke(stdout):
        def version(command, **kw):
            assert_version_probe(command, exe)
            return subprocess.CompletedProcess(command, 0, stdout, '')
        with patch.object(sys, 'argv', [str(SCRIPT), '--exe', str(exe), '--output', str(output)]), patch('subprocess.run', side_effect=version), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(SCRIPT), run_name='__main__')
    invoke('elio-agent 1.0.1\n')
    with zipfile.ZipFile(output / 'elio-v1.0.1-Windows-x64.zip') as z:
        assert z.testzip() is None
        names = z.namelist()
        assert all(n.startswith('elio/') for n in names)
        assert [n for n in names if n.lower().endswith('.exe')] == ['elio/elio.exe', 'elio/runtime/engram/engram-windows-amd64.exe']
        assert z.read('elio/elio.exe') == exe.read_bytes()
        assert json.loads(z.read('elio/elio-Extension/manifest.json'))['version'] == '1.0.1'
        for name in ('manifest.json','code.js','ui.html'):
            assert z.read('elio/figma-plugin/'+name) == (ROOT/'figma-plugin'/name).read_bytes()
        sums = z.read('elio/SHA256SUMS.txt').decode().splitlines()
        assert len(sums) == len(names) - 1
        for line in sums:
            digest, name = line.split('  ', 1)
            assert hashlib.sha256(z.read('elio/' + name)).hexdigest() == digest, name
    try:
        invoke('different-agent 1.0.1\n')
    except SystemExit as error:
        assert 'different product/version' in str(error)
    else:
        raise AssertionError('Wrong product accepted')
    exe.write_bytes(b'NOT MZ')
    try:
        invoke('elio-agent 1.0.1\n')
    except SystemExit as error:
        assert 'Build elio.exe on Windows first' in str(error)
    else:
        raise AssertionError('Non-Windows image accepted')
print('PASS actual Windows packager fixture: Elio archive/root/exe/extension, every SHA256, canonical/aliased paths, reject wrong executable/arguments/product and invalid PE header. This does not build or execute Windows code.')
