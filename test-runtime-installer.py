import argparse
import hashlib
import http.server
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--powershell', default=shutil.which('powershell') or shutil.which('pwsh'))
args = parser.parse_args()
if not args.powershell:
    raise SystemExit('PowerShell is required for runtime installer tests')
source = Path(__file__).with_name('Setup-Mcp-Runtime.ps1').read_text()

def archive(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in files:
            z.writestr(name, 'runtime fixture')
    return data.getvalue()

payloads = {
    '/node.zip': archive(['node-v22.22.0-win-x64/node.exe', 'node-v22.22.0-win-x64/node_modules/npm/bin/npx-cli.js']),
    '/uv.zip': archive(['uv-0.12.21.data/scripts/uv.exe', 'uv-0.12.21.data/scripts/uvx.exe', 'uv-0.12.21.dist-info/licenses/LICENSE-MIT']),
}
counts = {key: 0 for key in payloads}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        counts[self.path] += 1
        self.send_response(200)
        self.end_headers()
        self.wfile.write(payloads[self.path])
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='elio-runtime-') as temp:
        import os
        root = Path(temp)
        env = os.environ.copy()
        env['LOCALAPPDATA'] = str(root / 'cache with spaces')
        prepared = source
        for url, key, original_hash in [
            ('https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip', '/node.zip', 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a'),
            ('https://files.pythonhosted.org/packages/2a/06/bda383b338dd21bcd74c9b4ba47301315573fdb5aba46fe40835f8299482/uv-0.12.21-py3-none-win_amd64.whl', '/uv.zip', '8c7c3eb32d84c711906dedd09df7379cf4d9f5bb84b8e58a1244ca0a8a1209d4'),
        ]:
            assert url in prepared and original_hash in prepared
            prepared = prepared.replace(url, f'http://127.0.0.1:{server.server_port}{key}')
            prepared = prepared.replace(original_hash, hashlib.sha256(payloads[key]).hexdigest())
        script = root / 'Setup-Mcp-Runtime.ps1'
        script.write_text(prepared)
        def run(runtime, expected=0):
            result = subprocess.run([args.powershell, '-NoProfile', '-NonInteractive', '-File', str(script), '-Runtime', runtime], env=env, capture_output=True, text=True, timeout=30)
            assert result.returncode == expected, result.stdout + result.stderr
            return result
        for runtime, name, key in [('npx', 'node-22.22.0', '/node.zip'), ('uvx', 'uv-0.12.21', '/uv.zip')]:
            run(runtime)
            dest = Path(env['LOCALAPPDATA']) / 'elio' / 'runtimes' / name
            assert (dest / '.complete').is_file()
            assert counts[key] == 1
            run(runtime)
            assert counts[key] == 1, 'Cached runtime was downloaded again'
        print('PASS: both runtime branches extract and reuse cache without another request')
        env['LOCALAPPDATA'] = str(root / 'checksum failure cache')
        bad_hash = prepared.replace(hashlib.sha256(payloads['/uv.zip']).hexdigest(), '0' * 64)
        script.write_text(bad_hash)
        result = run('uvx', 1)
        assert 'checksum mismatch' in result.stderr
        cache = Path(env['LOCALAPPDATA']) / 'elio' / 'runtimes'
        assert not (cache / 'uv-0.12.21').exists()
        assert not list(cache.glob('.setup-*'))
        script.write_text(prepared)
        run('uvx')
        assert (cache / 'uv-0.12.21' / '.complete').is_file()
        print('PASS: checksum failure publishes nothing, cleans staging, and retry succeeds')
finally:
    server.shutdown()
