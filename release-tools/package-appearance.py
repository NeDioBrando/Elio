from pathlib import Path
import json,zipfile,hashlib,io,plistlib,struct,urllib.request,tarfile,subprocess,shutil
repo=Path.cwd();version='1.22.1';root=repo/'build/synerixcode'
RAW_BASE='https://raw.githubusercontent.com/'
notes=json.loads((root/'release-notes.json').read_text());entry=notes[0];assert entry['version']==version
intro='synerixcode '+version+' — '+entry['title']+'\n\n'+entry['summary']+'\n\n'+'\n'.join('- '+x for key in ['added','improved','fixed'] for x in entry[key])+'\n\n'
validation='synerixcode 1.22.1 validation\nNew tests: test-1.22.1-request-timeouts.js (whole background.js on a virtual clock: hung Ollama model list and installed-model check end within 5 s, a hung /api/chat ends at 10 min with errKind timeout, hung Roblox CSRF/authenticated requests end at 20 s each with the address minus its query string; healthy servers return the same results and the 403 CSRF retry still runs; every Ollama/Roblox fetch carries a signal); test-1.22.1-creator-and-skill.js (every desktop action the bridge forwards, including creator-send, is accepted by the extension; creation_preview fills a valid preview action_id only when missing, reproducing action_id must be a string without it; skill calls naming an advertised tool are rerouted, real skills and unknown names are not); test-1.22.1-notion-leaf-composer.js (content-editable-leaf composer found via the Notion send-button test id or a nearby placeholder attribute; transcript blocks, reply text, search boxes and ordinary pages stay excluded). All three fail on 1.22.0 and also run against the minified production modules.\nUpdated: test-desktop-regression.js (1.22.1 versions; intentionally changed core/main.js and providers/notion.js).\nRust: add-on tools/call timeout honors timeoutMs/timeout_seconds (+30 s, max 630 s; Studio add-ons 330 s); a call timeout sends notifications/cancelled instead of killing the server (reset only after two in a row); Git lookup also reads the current HKCU/HKLM PATH and GitHub Desktop/Chocolatey locations. 2 new unit tests. cargo test --locked: 106 + 3 pass, 2 ignored.\nPerformance: test-bridge-hang.js still peaks at 5 pending bridge requests; Ollama and Roblox use other hosts and never touch the bridge connection pool.\nJS: full suite passes except test-bridges.js, test-design-visual.js and test-v115.js, which fail identically on 1.21.0 and are skipped by the runner.\n\n'
firefox_note='## Firefox page events (maintainers)\n\nFirefox hides DataTransfer data/files created by content scripts from page handlers and ignores clipboardData in the ClipboardEvent constructor. The Firefox package therefore adds core/firefox-events.js (first script in each isolated content-script group) and core/firefox-events-main.js (a MAIN-world entry with the same matches). Synthetic paste, drag/drop and input events that carry text or files are rebuilt in the page world; native events and events without data use the normal dispatch. release-tools/build-firefox.py inserts both entries; the Chromium manifest and scripts do not load them. firefox-transfer-check.js verifies Notion protocol upload, inline paste, Co-Work draft clearing and helper semantics in real Firefox (--without-shim reproduces the original failure).\n\n'
for name in ['README.md','UPDATE.txt','MAINTENANCE.md']:
 body=(repo/name).read_text().replace('synerixcode-Firefox-1.22.0.zip','synerixcode-Firefox-'+version+'.zip')
 (repo/name).write_text(intro+(firefox_note if name=='MAINTENANCE.md' and firefox_note not in body else '')+body);(root/name).write_bytes((repo/name).read_bytes())
(repo/'VALIDATION.txt').write_text(validation+(repo/'VALIDATION.txt').read_text());(root/'VALIDATION.txt').write_bytes((repo/'VALIDATION.txt').read_bytes())
(repo/'release-notes.json').write_bytes((root/'release-notes.json').read_bytes())
(repo/'Update-synerixcode.ps1').write_bytes((root/'Update-synerixcode.ps1').read_bytes())
(repo/'publish_release.py').write_bytes((repo/'publisher-appearance.py').read_bytes())
assets=[('windows_amd64.zip','windows-amd64.exe','bb410e4a578bee96888f848764dbbf9e7dd78971204c05bb7fb81a4a8db324a3'),('darwin_amd64.tar.gz','darwin-amd64','68cc3eebbb265d1c45999a429d1e6774150ba71ac008f4dd381b9d73b10c79dd'),('darwin_arm64.tar.gz','darwin-arm64','54e080ed64a1d1b7b8a5d59e5a6d17100adbd69a6aafbb73d270dbeb37c03266')]
for suffix,name,sha in assets:
 with urllib.request.urlopen('https://github.com/Gentleman-Programming/engram/releases/download/v3.0.0/engram_3.0.0_'+suffix,timeout=60) as r:raw=r.read(12*1024*1024)
 assert hashlib.sha256(raw).hexdigest()==sha,(suffix,'Official Engram archive checksum mismatch')
 if suffix.endswith('.zip'):
  with zipfile.ZipFile(io.BytesIO(raw)) as z:data=z.read(next(n for n in z.namelist() if Path(n).name=='engram.exe'))
 else:
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:data=t.extractfile(next(n for n in t.getmembers() if Path(n.name).name=='engram')).read()
 if name.startswith('windows'):
  p=root/'runtime/engram'/('engram-'+name);p.write_bytes(data);p.chmod(0o755)
(root/'runtime/engram/SHA256SUMS.txt').write_text(''.join(f'{sha}  engram_3.0.0_{suffix}\n' for suffix,name,sha in assets))
with zipfile.ZipFile(repo/'artifacts/native-macOS/synerixcode-app.zip') as app:
 plist=plistlib.loads(app.read('synerixcode.app/Contents/Info.plist'));assert plist['CFBundleShortVersionString']==version
 binary=app.read('synerixcode.app/Contents/MacOS/synerixcode');assert binary[:4]==bytes.fromhex('cafebabe')
 count=struct.unpack('>I',binary[4:8])[0];assert {0x01000007,0x0100000c}.issubset({struct.unpack('>I',binary[8+i*20:12+i*20])[0] for i in range(count)})
 appentries={f'synerixcode/{i.filename}':(i,app.read(i)) for i in app.infolist() if not i.is_dir()}
p=root/'macos/Info.plist';data=plistlib.loads(p.read_bytes());data['CFBundleShortVersionString']=data['CFBundleVersion']=version;p.write_bytes(plistlib.dumps(data))
source={f'synerixcode/{p.relative_to(root).as_posix()}':p.read_bytes() for p in root.rglob('*') if p.is_file() and not any(x in p.relative_to(root).parts for x in ['target','.git','node_modules','__pycache__','synerixcode.app','visual-checks'])}
source['synerixcode/synerixcode.exe']=(repo/'artifacts/native-Windows/synerixcode.exe').read_bytes()
original=repo/'synerixcode-1.22.0.zip';assert hashlib.sha256(original.read_bytes()).hexdigest()=='4167a9e639a91c129b90cb92d266e7cac74419bd3647a86bfafaa5cadd78f016'
with urllib.request.urlopen('https://raw.githubusercontent.com/stoveez/PlazCode/b87b03c0ca4050d4bf5eb5742374ef5714bc7ed0/PlazCode-source-1.22.0.zip', timeout=60) as response: baseline_source=response.read(8*1024*1024)
assert hashlib.sha256(baseline_source).hexdigest()=='404bad6268e41abf74a79694ada05e64c10f323cf3febbb81e71218fad240009'
with zipfile.ZipFile(io.BytesIO(baseline_source)) as old:
 for path in source:
  if '/providers/' in path and path in old.namelist() and not path.endswith(('/providers/notion.js',)):assert source[path]==old.read(path), 'Unrelated provider behavior source changed'
source_name=f'synerixcode-source-{version}.zip'
# Collect every source entry once: the release helpers below replace any copy that
# already exists under release-tools/ instead of being written a second time.
source_entries={path:data for path,data in source.items() if not (path.endswith(('.exe','.dll','.pdb')) or '/runtime/engram/engram-' in path)}
if True:
 for name in ['package-appearance.py','publisher-appearance.py','.github/workflows/appearance-build.yml','appearance-visual.js','test-javascript.py']:
  p=repo/name
  if not p.exists():
   with urllib.request.urlopen(RAW_BASE+__import__('os').environ['GITHUB_REPOSITORY']+'/'+__import__('os').environ['GITHUB_SHA']+'/'+name,timeout=30) as response: data=response.read()
  else:data=p.read_bytes()
  source_entries['synerixcode/release-tools/'+name]=data
with zipfile.ZipFile(repo/source_name,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for path,data in source_entries.items():z.writestr(path,data)
with zipfile.ZipFile(repo/source_name) as z:
 names=z.namelist();assert z.testzip() is None and len(names)==len(set(names)),'Duplicate entries in source ZIP'
 assert all(n.startswith('synerixcode/') for n in names) and len(names)==len(source_entries)
subprocess.run(['node',str(root/'release-tools/minify.mjs'),str(root)],check=True)
for path in list(source):
 p=root/path.removeprefix('synerixcode/')
 if p.is_file() and p.suffix=='.js':source[path]=p.read_bytes()
source['synerixcode/production-build.json']=(root/'production-build.json').read_bytes()
firefox_name=f'synerixcode-Firefox-{version}.zip'
subprocess.run(['python',str(root/'release-tools/build-firefox.py'),str(root/'synerixcode-Extension'),str(root/'synerixcode-Extension-Firefox'),str(repo/firefox_name)],check=True)
for path in (root/'synerixcode-Extension-Firefox').rglob('*'):
 if path.is_file():source['synerixcode/'+path.relative_to(root).as_posix()]=path.read_bytes()

# Run pure behavioral tests against the actual generated modules.
for name in ['test-version.js','test-cowork.js','test-page-startup.js','test-cowork-injection-composer.js','test-cowork-notion-plain-text.js','test-notion-tool-status.js','test-notion-localized-composer.js','test-bridge-hang.js','test-notion-send-receipts.js','test-studio-status.js','test-clarification.js','test-blender-command-results.js','test-firefox-package.js','test-parser-key-order.js','test-bar-hide.js','test-notion-bar-seat.js','test-notion-bar-follow.js','test-tool-guard-repair.js','test-bar-hide-space.js','test-bar-status-text.js','test-continuation-offer-toggle.js','test-notion-send-recovery.js','test-1.22.0-debug-capture.js','test-1.22.1-request-timeouts.js','test-1.22.1-creator-and-skill.js','test-1.22.1-notion-leaf-composer.js']:
 subprocess.run(['node',name],cwd=root,check=True)
def development(path):
 relative=path.removeprefix('synerixcode/');parts=Path(relative).parts
 return any(p in ['.git','.github','node_modules','__pycache__','release-tools'] for p in parts) or any(p.startswith('test-') for p in parts) or relative.startswith('agent/src/') or relative in ['agent/Cargo.toml','agent/Cargo.lock','agent/build.rs','build-macos-bundle.py','package_release.py','design-baseline.html','firefox-runtime-check.js'] or Path(path).suffix in ['.map','.pdb']
metadata=[]
for platform,name in [('windows',f'synerixcode-{version}.zip'),('macos',f'synerixcode-macOS-{version}.zip')]:
 output=repo/name;remaining=dict(source)
 with zipfile.ZipFile(original) as old,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as new:
  seen=set()
  for info in old.infolist():
   path=info.filename
   if development(path):remaining.pop(path,None);continue
   if path.startswith('synerixcode/synerixcode.app/'):continue
   if platform=='macos' and Path(path).suffix.lower() in ['.exe','.dll','.bat','.cmd','.ps1']:continue
   data=remaining.pop(path,old.read(info))
   if path=='PlazCode/update-source.json' and platform=='macos':data=json.dumps({'feedUrl':'https://raw.githubusercontent.com/stoveez/PlazCode/main/latest-macos.json'},indent=2).encode()
   new.writestr(info,data);seen.add(path)
  for path,data in remaining.items():
   if development(path):continue
   if path in seen or path.startswith('synerixcode/synerixcode.app/'):continue
   if platform=='macos' and Path(path).suffix.lower() in ['.exe','.dll','.bat','.cmd','.ps1']:continue
   info=zipfile.ZipInfo(path);info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(0o100755 if Path(path).suffix=='.command' or '/runtime/engram/engram-' in path else 0o100644)<<16;new.writestr(info,data)
  for path,(oldinfo,data) in appentries.items():
   info=zipfile.ZipInfo(path);info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=oldinfo.external_attr;new.writestr(info,data)
 with zipfile.ZipFile(output) as z:
  assert z.testzip() is None and len(z.namelist())==len(set(z.namelist()))
  for path in ['synerixcode/manifest.json','synerixcode/synerixcode-Extension/manifest.json']:
   manifest=json.loads(z.read(path));assert manifest['version']==version and manifest.get('version_name',version)==version
  assert ('synerixcode/synerixcode.exe' in z.namelist())==(platform=='windows')
  assert ('synerixcode/runtime/engram/engram-windows-amd64.exe' in z.namelist())==(platform=='windows')
  for arch in ['amd64','arm64']:assert z.getinfo(f'synerixcode/synerixcode.app/Contents/Resources/engram/engram-darwin-{arch}').external_attr>>16&0o111
  assert z.getinfo('synerixcode/synerixcode.app/Contents/MacOS/synerixcode').external_attr>>16&0o111
  assert not any(development(path) for path in z.namelist()), 'Development artifacts in production ZIP'
  for base in ['synerixcode/','synerixcode/synerixcode-Extension/']:
   manifest=json.loads(z.read(base+'manifest.json'))
   required=[manifest['background']['service_worker'],manifest['action']['default_popup']]
   for content in manifest['content_scripts']:required+=content.get('js',[])+content.get('css',[])
   for path in required:assert base+path in z.namelist(),('Missing production asset',base+path)
 raw=output.read_bytes();assert len(raw)<=64*1024*1024
 metadata.append({'file':name,'platform':platform,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
raw=(repo/source_name).read_bytes();source_metadata={'file':source_name,'platform':'source','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
firefox_raw=(repo/firefox_name).read_bytes();firefox_metadata={'file':firefox_name,'platform':'firefox','bytes':len(firefox_raw),'sha256':hashlib.sha256(firefox_raw).hexdigest()}
with zipfile.ZipFile(repo/firefox_name) as archive:
 assert archive.testzip() is None and 'manifest.json' in archive.namelist() and len(archive.namelist())==len(set(archive.namelist())),'Firefox ZIP is damaged or has duplicate entries'
 m=json.loads(archive.read('manifest.json'));assert m['version']==version and m['background']=={'scripts':['background.js']} and m['browser_specific_settings']['gecko']['id']=='synerixcode@synerixcode.local'
 for key in ['background.js','core/main.js','providers/notion.js','popup.js']:assert archive.read(key)==source['synerixcode/synerixcode-Extension/'+key]
feeds={x['platform']:{'version':version,'desktop_version':version,'url':RAW_BASE+'stoveez/synerixcode/main/'+x['file'],'sha256':x['sha256'],'release_notes':notes} for x in metadata}
feeds['windows']['platforms']={'macos':{k:feeds['macos'][k] for k in ['url','sha256']}}
for feed in feeds.values():
 while len((json.dumps(feed,indent=2)+'\n').encode())>60000 and len(feed['release_notes'])>1:feed['release_notes']=feed['release_notes'][:-1]
 assert len((json.dumps(feed,indent=2)+'\n').encode())<=65536
(repo/'latest.json').write_text(json.dumps(feeds['windows'],indent=2)+'\n');(repo/'latest-macos.json').write_text(json.dumps(feeds['macos'],indent=2)+'\n')
(repo/'SHA256SUMS.txt').write_text(''.join(f"{x['sha256']}  {x['file']}\n" for x in metadata+[source_metadata,firefox_metadata]));(repo/'release-metadata.json').write_text(json.dumps(metadata+[source_metadata,firefox_metadata],indent=2)+'\n')
description='**synerixcode '+version+': '+entry['title']+'**\n\n- '+entry['summary']+'\n'
for key,title in [('added','New additions'),('improved','Improvements'),('fixed','Bug fixes')]:
 if entry[key]:description+='\n***'+title+'***\n\n'+'\n'.join('- '+x for x in entry[key])+'\n'
(repo/('release-description-'+version+'.txt')).write_text(description)
print(json.dumps(metadata,indent=2))
