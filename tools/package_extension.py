#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Package the browser extension as a ready-to-install ZIP.

Run:  python tools/package_extension.py [--output dist]
Produces dist/Elio-Extension-v<version>.zip containing one folder with manifest.json at its top,
ready for chrome://extensions -> "Load unpacked". Fails if the bundled extension is out of sync with
the repository sources or if the manifest references a missing file.
"""
import argparse, hashlib, json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'elio-Extension'
# Fork notes that intentionally differ between the root and the bundled copy.
MIRROR_EXEMPT = {'FORK-CHANGES.md', 'SOURCE.txt', 'TEST-REPORT.md'}

INSTALL = """Elio browser extension v{version}

Install (Chrome, Edge, Brave or another Chromium browser, version 111+):
1. Unzip this archive. Keep the "{folder}" folder somewhere permanent;
   the browser loads the extension from it.
2. Open chrome://extensions (edge://extensions in Edge).
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and choose the "{folder}" folder
   (the one that contains manifest.json).
5. Pin Elio from the puzzle-piece menu, open a supported AI site and click the Elio icon.

Update: unzip the new version over the same folder, then click the reload
arrow on Elio's card in chrome://extensions.

The desktop agent (elio.exe) is a separate Windows download; the extension
pairs with it automatically when it is running.
"""


def check_mirror():
    stale = []
    for src in sorted(EXT.rglob('*')):
        if not src.is_file():
            continue
        rel = src.relative_to(EXT)
        twin = ROOT / rel
        if str(rel) in MIRROR_EXEMPT or not twin.is_file():
            continue
        if twin.read_bytes() != src.read_bytes():
            stale.append(str(rel))
    if stale:
        raise SystemExit('elio-Extension is out of sync with the repository sources; copy these files over:\n  ' + '\n  '.join(stale))


def check_manifest(manifest):
    refs = {manifest['background']['service_worker'], manifest['action']['default_popup']}
    for cs in manifest.get('content_scripts', []):
        refs.update(cs.get('js', []) + cs.get('css', []))
    for war in manifest.get('web_accessible_resources', []):
        refs.update(r for r in war.get('resources', []) if '*' not in r)
    refs.update((manifest.get('icons') or {}).values())
    missing = sorted(r for r in refs if not (EXT / r).is_file())
    if missing:
        raise SystemExit('manifest.json references missing files: ' + ', '.join(missing))
    return len(refs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', type=Path, default=ROOT / 'dist')
    a = ap.parse_args()
    manifest = json.loads((EXT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    check_mirror()
    refs = check_manifest(manifest)
    folder = f'Elio-Extension-v{version}'
    a.output.mkdir(parents=True, exist_ok=True)
    archive = a.output / f'{folder}.zip'
    files = sorted(p for p in EXT.rglob('*') if p.is_file())
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(p, f'{folder}/{p.relative_to(EXT).as_posix()}')
        z.writestr(f'{folder}/INSTALL.txt', INSTALL.format(version=version, folder=folder))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (a.output / f'{folder}.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(f'{archive} ({len(files) + 1} files, {archive.stat().st_size // 1024} KiB, {refs} manifest references checked)')
    print(f'sha256 {digest}')


if __name__ == '__main__':
    main()
