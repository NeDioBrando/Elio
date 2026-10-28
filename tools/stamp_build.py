#!/usr/bin/env python3
"""Deterministic source-build identity; product version remains unchanged."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def stamp(root=ROOT):
    files=[]
    for prefix in ('core','providers','desktop','agent/src','figma-plugin','starter-skills'):
        files += [p for p in (root/prefix).rglob('*') if p.is_file() and p.suffix in ('.js','.rs','.html','.css','.json','.luau','.md','.txt','.ps1') and p.name!='build-info.json']
    files += [root/n for n in ('background.js','manifest.json','overlay.css','popup.js','popup.html')]
    h=hashlib.sha256()
    for p in sorted(files):
        h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes()+b'\0')
    info={'build_id':'elio-'+h.hexdigest()[:20],'protocol':2}
    raw=json.dumps(info,indent=2)+'\n'
    for folder in ('core','elio-Extension/core'):
        p=root/folder/'build-info.json'
        if not p.exists() or p.read_text()!=raw:p.write_text(raw)
    return info
if __name__=='__main__': print(json.dumps(stamp()))
