"""Bump every package version together, before creating a Git tag."""
from pathlib import Path
import sys,re,json
root=Path(__file__).resolve().parents[1]
value=sys.argv[1] if len(sys.argv)==2 else ''
if not re.fullmatch(r'(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})',value):raise SystemExit('Usage: python tools/set_version.py 1.0.2')
p=root/'agent/Cargo.toml';s=p.read_text();s=re.sub(r'(?m)^version = "[^"]+"',f'version = "{value}"',s,count=1);p.write_text(s)
p=root/'agent/Cargo.lock';s=p.read_text();s=re.sub(r'(name = "elio-agent"\nversion = ")[^"]+',lambda m:m[1]+value,s,count=1);p.write_text(s)
for name in ['manifest.json','elio-Extension/manifest.json']:
 p=root/name;s=json.loads(p.read_text());s['version']=value;s['version_name']=value;p.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
print('Package version:',value)
