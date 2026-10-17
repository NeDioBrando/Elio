"""Build Firefox assets from the same extension bytes used by Chromium."""
from pathlib import Path
import json, shutil, sys, zipfile

ADDON_ID = "synerixcode@synerixcode.local"
FIREFOX_SHIM = "core/firefox-events.js"
FIREFOX_PAGE_HELPER = "core/firefox-events-main.js"

def build(extension, destination, archive):
    extension, destination, archive = map(Path, (extension, destination, archive))
    manifest = json.loads((extension / 'manifest.json').read_text())
    manifest.pop('minimum_chrome_version', None)
    manifest['background'] = {'scripts': ['background.js']}
    # Firefox hides content-script DataTransfer text/files from pages. Each
    # isolated provider group loads the transfer shim first, paired with a
    # MAIN-world helper on the same sites. Chromium manifests stay unchanged.
    scripts = []
    for script in manifest.get('content_scripts', []):
        if script.get('world') == 'MAIN':
            scripts.append(script)
            continue
        helper = {key: value for key, value in script.items() if key not in ('js', 'css', 'run_at', 'world')}
        helper.update({'js': [FIREFOX_PAGE_HELPER], 'world': 'MAIN', 'run_at': 'document_start'})
        scripts.append(helper)
        scripts.append({**script, 'js': [FIREFOX_SHIM] + [f for f in script.get('js', []) if f != FIREFOX_SHIM]})
    manifest['content_scripts'] = scripts
    manifest['browser_specific_settings'] = {'gecko': {
        'id': ADDON_ID, 'strict_min_version': '140.0',
        'data_collection_permissions': {'required': [
            'websiteContent', 'personalCommunications', 'browsingActivity', 'websiteActivity'
        ]}
    }}
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in ['background.js', 'popup.js', 'popup.html', 'ollama-page.js', 'overlay.css', 'icon.png']:
        shutil.copy2(extension / name, destination / name)
    for name in ['core', 'providers', 'ui']:
        shutil.copytree(extension / name, destination / name)
    for name in ['LICENSE', 'SOURCE.txt', 'BRANDING-NOTICE.txt']:
        shutil.copy2(extension.parent / name, destination / name)
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (destination / 'FIREFOX-INSTALL.txt').write_text(
        'synerixcode ' + manifest['version'] + ' for Firefox 140 or newer\n\n'
        '1. Update and open the synerixcode desktop app first.\n'
        '2. Open about:debugging#/runtime/this-firefox in Firefox.\n'
        '3. Click Load Temporary Add-on. Open synerixcode-Extension-Firefox and select manifest.json, '
        'or select the standalone synerixcode-Firefox-VERSION.zip directly. Select a file, not a folder.\n'
        '4. Allow site access for the AI chat and localhost if Firefox asks. Refresh existing AI tabs.\n'
        '5. After a synerixcode update, Reload this addon on the same page and refresh AI tabs.\n\n'
        'This package is unsigned. Temporary addons are removed when Firefox restarts. '
        'Permanent installation in standard Firefox requires a Mozilla-signed addon; '
        'Install Add-on From File cannot permanently install this unsigned ZIP.\n\n'
        'synerixcode sends the selected chat content, task inputs, current AI-page URL and interaction '
        'status to the local desktop bridge, and requested prompts, feedback and media to the '
        'selected AI service. These are needed for chat control, tools, memory and continuation. '
        'Use only trusted AI services and review tool permissions. No synerixcode telemetry service is added.\n'
    )
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for path in sorted(destination.rglob('*')):
            if path.is_file():
                output.write(path, path.relative_to(destination).as_posix())
    return manifest

if __name__ == '__main__':
    build(*sys.argv[1:])
