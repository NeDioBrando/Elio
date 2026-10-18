"""Rebuild the offline UI catalog from core/locales and mirror extension assets."""
from pathlib import Path
import json, shutil
root=Path(__file__).resolve().parents[1]
keys=sorted(json.loads((root/'core/locales/en.json').read_text(encoding='utf-8')))
values={}
for path in sorted((root/'core/locales').glob('*.json')):
 if path.stem!='en':
  data=json.loads(path.read_text(encoding='utf-8'));values[path.stem]=[data.get(k) for k in keys]
compact=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'))
text='// SPDX-License-Identifier: GPL-3.0-or-later\n// Generated from core/locales; offline, UI text only.\nglobalThis.elioLocaleData=(()=>{const keys='+compact(keys)+';const values='+compact(values)+';const out={en:Object.fromEntries(keys.map(k=>[k,k]))};for(const [lang,row]of Object.entries(values))out[lang]=Object.fromEntries(keys.map((k,i)=>[k,row[i]]));return out;})();\n'
(root/'core/i18n-catalog.js').write_text(text,encoding='utf-8')
shutil.copy2(root/'core/i18n-catalog.js',root/'elio-Extension/core/i18n-catalog.js')
for path in (root/'core/locales').glob('*.json'):shutil.copy2(path,root/'elio-Extension/core/locales'/path.name)
print(f'Generated {len(keys)} UI keys for {len(values)+1} languages.')
