"""Create a versioned GitHub Release from an already published synerixcode feed.
No secrets or local install data are packaged. Existing published releases are
never edited; an interrupted draft can be completed by rerunning the workflow.
"""
import base64, hashlib, io, json, os, pathlib, re, subprocess, time, urllib.request, zipfile

def gh(*args):
    attempts=6 if (args[:2] in [('release','upload'),('release','edit'),('release','view')] or args[:1]==('api',)) else 1
    for attempt in range(attempts):
        try:return subprocess.check_output(['gh',*args],text=True)
        except subprocess.CalledProcessError:
            if attempt+1==attempts:raise
            time.sleep(min(2**attempt,8))
def fetch(url):
    with urllib.request.urlopen(url,timeout=60) as r:
        data=r.read(64*1024*1024+1)
    if len(data)>64*1024*1024: raise ValueError('Release download exceeds 64 MB')
    return data

def notes(feed):
    version=feed['version'];entry=next(x for x in feed['release_notes'] if x['version']==version)
    lines=['**synerixcode '+version+': '+entry['title']+'**','','- '+entry['summary'],'']
    for key,title in [('added','New additions'),('improved','Improvements'),('fixed','Bug fixes')]:
        if entry.get(key):lines+=['***'+title+'***','']+['- '+x for x in entry[key]]+['']
    lines+=['## Update','','- Desktop launch automatically checks and updates to the newest release when outdated. Manual update: choose **Updates → Update now**.\n- Windows: run **Update-synerixcode.bat** for a manual update. macOS: launch **synerixcode.app** from the extracted folder; use **MacOS_Setup.command** for setup.','- Chromium: reload at chrome://extensions, edge://extensions or brave://extensions and refresh AI tabs. Firefox: open about:debugging, Load Temporary Add-on and select manifest.json inside synerixcode-Extension-Firefox or the standalone Firefox ZIP. Unsigned temporary addons are removed when Firefox restarts; permanent installation needs Mozilla signing.','- Windows: download **synerixcode-'+version+'.zip**. macOS: download **synerixcode-macOS-'+version+'.zip**. The normal ZIP retains Mac compatibility for older installed updaters.','- Firefox: download **synerixcode-Firefox-'+version+'.zip** or use **synerixcode-Extension-Firefox** inside either desktop package. Requires Firefox 140 or newer.', '- Existing settings, memory and enabled MCP servers keep their data locations.','','See VALIDATION.txt inside the ZIP for checks and live-test limitations.']
    return 'synerixcode '+version+': '+entry['title'],'\n'.join(lines)+'\n'

def validate_archive(data,version,platform="windows"):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None:raise ValueError('ZIP checksum failure')
        names=archive.namelist()
        if len(names)!=len(set(names)):raise ValueError('ZIP contains duplicate entries')
        for path in ['synerixcode/manifest.json','synerixcode/synerixcode-Extension/manifest.json']:
            manifest=json.loads(archive.read(path))
            if manifest['version']!=version:raise ValueError('ZIP version does not match feed: '+path)
            if manifest.get('version_name',manifest['version'])!=manifest['version']:raise ValueError('Extension display version contradicts release version: '+path)
        if platform=='windows' and 'synerixcode/synerixcode.exe' not in archive.namelist():raise ValueError('Windows desktop executable missing')
        if platform=='macos' and 'synerixcode/synerixcode.exe' in archive.namelist():raise ValueError('Mac download must not contain the Windows executable')
        import plistlib, struct
        app='synerixcode/synerixcode.app/Contents/'
        if tuple(map(int,plistlib.loads(archive.read(app+'Info.plist'))['CFBundleShortVersionString'].split('.')))>tuple(map(int,version.split('.'))):raise ValueError('Mac app version exceeds package version')
        binary=archive.read(app+'MacOS/synerixcode')
        if binary[:4]!=bytes.fromhex('cafebabe'):raise ValueError('Universal Mac application missing')
        count=struct.unpack('>I',binary[4:8])[0]
        architectures={struct.unpack('>I',binary[8+i*20:12+i*20])[0] for i in range(count)}
        if not {0x01000007,0x0100000c}.issubset(architectures):raise ValueError('Mac architecture missing')


def main():
    repo=os.environ['GITHUB_REPOSITORY'];commit=os.environ['GITHUB_SHA']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo) or not re.fullmatch(r'[a-f0-9]{40}',commit):raise ValueError('Invalid repository or commit')
    root='https://raw.githubusercontent.com/'+repo+'/'+commit+'/'
    feed=json.loads(fetch(root+'latest.json'));version=feed['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid release version')
    tag='v'+version;title,body=notes(feed)
    try:existing=json.loads(gh('release','view',tag,'--repo',repo,'--json','isDraft'))
    except subprocess.CalledProcessError:existing=None
    if existing and not existing['isDraft']:
        print('Version is already published; leaving it unchanged.');return
    assets=[]
    for name,platform,expected_hash in [('synerixcode-'+version+'.zip','windows',feed['sha256']),('synerixcode-macOS-'+version+'.zip','macos',feed['platforms']['macos']['sha256'])]:
        data=fetch(root+name)
        content=json.loads(gh('api','repos/'+repo+'/contents/'+name+'?ref='+commit))
        actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if actual!=content['sha']:raise ValueError('Repository ZIP hash mismatch')
        if hashlib.sha256(data).hexdigest()!=expected_hash:raise ValueError('Update SHA-256 mismatch')
        validate_archive(data,version,platform);pathlib.Path(name).write_bytes(data);assets.append(name)
    pathlib.Path('release-notes.md').write_text(body)
    for name in ['synerixcode-source-'+version+'.zip','synerixcode-Firefox-'+version+'.zip','synerixcode-'+version+'.sigstore.json']:
        data=fetch(root+name);content=json.loads(gh('api','repos/'+repo+'/contents/'+name+'?ref='+commit))
        if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=content['sha']:raise ValueError('Source/provenance repository hash mismatch')
        pathlib.Path(name).write_bytes(data);assets.append(name)
    for name in assets[:4]:gh('attestation','verify',name,'--repo',repo)
    if not existing:gh('release','create',tag,'--repo',repo,'--target',commit,'--draft','--title',title,'--notes-file','release-notes.md')
    gh('release','upload',tag,*assets,'--repo',repo,'--clobber')
    current=json.loads(gh('api','repos/'+repo+'/contents/latest.json?ref=main'))
    current=json.loads(base64.b64decode(current['content']))
    gh('release','edit',tag,'--repo',repo,'--draft=false','--latest='+str(current['version']==version).lower())
    print('Published https://github.com/'+repo+'/releases/tag/'+tag)
if __name__=='__main__':main()



