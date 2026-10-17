"""Run production Explorer Luau in the official VM with mocked Roblox services."""
from pathlib import Path
import os,subprocess,tempfile
root=Path(__file__).resolve().parent
compiler=os.environ.get('SYNERIXCODE_LUAU','luau')
production=(root/'agent/src/explorer.luau').read_text().replace('__REQUEST__','"fixture-request"')
fixture=(root/'test-support/explorer-fixture.luau').read_text().replace('__PRODUCTION__',production)
with tempfile.TemporaryDirectory(prefix='synerixcode-luau-') as temporary:
 path=Path(temporary)/'explorer.luau';path.write_text(fixture)
 subprocess.run([compiler,str(path)],check=True)
