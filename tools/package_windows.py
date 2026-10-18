"""Package a newly built Windows binary; never ship an upstream/stale EXE."""
from pathlib import Path
import argparse,shutil,zipfile,hashlib,json,subprocess,tomllib
ROOT=Path(__file__).resolve().parents[1]
version=tomllib.loads((ROOT/'agent/Cargo.toml').read_text())['package']['version']
manifest=json.loads((ROOT/'elio-Extension/manifest.json').read_text())
if manifest['version']!=version:raise SystemExit('Native and extension versions must match.')
p=argparse.ArgumentParser();p.add_argument('--exe',type=Path,default=ROOT/'agent/target/release/elio.exe');p.add_argument('--output',type=Path,default=ROOT/'dist');a=p.parse_args()
exe=a.exe.resolve()
if not exe.is_file() or exe.read_bytes()[:2]!=b'MZ':raise SystemExit('Build elio.exe on Windows first. No binary was packaged.')
check=subprocess.run([str(exe),'--version'],capture_output=True,text=True,check=True)
if check.stdout.strip() != 'elio-agent '+version:raise SystemExit('Refusing to package a different product/version: '+check.stdout)
a.output.mkdir(parents=True,exist_ok=True)
stage=a.output/'elio'
if stage.exists():shutil.rmtree(stage)
stage.mkdir()
# Complete installable extension includes all bundled resources needed by the agent.
shutil.copytree(ROOT/'elio-Extension',stage/'elio-Extension')
for name in ['config.json','bridge-pairing.cjs','Setup-Mcp-Runtime.ps1','Start-elio-Agent.cmd','launch_studio_mcp.py','launch_blender_mcp.py','blender_bridge.ps1','blender_once.ps1','blender_once.py','blender_ops.py','blender_fbx.py','README-RU.md','README.md','SOURCE.txt','UPSTREAM-SOURCE.txt','FORK-CHANGES.md','LICENSE','BRANDING-NOTICE.txt','THIRD-PARTY-NOTICES.txt','THIRD_PARTY_TEMPLATE_LICENSES.txt','TEST-REPORT.md','DESKTOP-CHAT-RU.md','DESKTOP-CHAT-TEST-REPORT.md','UPDATES-RU.md','UPDATES-TEST-REPORT.md','ELIO-RU.md','ELIO-TEST-REPORT.md']:
 if (ROOT/name).is_file():shutil.copy2(ROOT/name,stage/name)
shutil.copy2(exe,stage/'elio.exe')
shutil.copy2(ROOT/'windows-runtime/WebView2Loader.dll',stage/'WebView2Loader.dll')
shutil.copy2(ROOT/'windows-runtime/NOTICE.txt',stage/'WINDOWS-RUNTIME-NOTICE.txt')
lines=[]
for f in sorted(stage.rglob('*')):
 if f.is_file():lines.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.relative_to(stage).as_posix())
(stage/'SHA256SUMS.txt').write_text('\n'.join(lines)+'\n')
archive=a.output/f'elio-v{version}-Windows-x64.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(stage.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(stage.parent))
print(archive)
