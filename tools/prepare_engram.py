"""Prepare the pinned MIT Engram runtime; no unverified executable is packaged."""
from pathlib import Path
import hashlib, io, os, tempfile, urllib.request, zipfile
ROOT = Path(__file__).resolve().parents[1]
NAME = 'engram-windows-amd64.exe'
ARCHIVE_SHA256 = 'bb410e4a578bee96888f848764dbbf9e7dd78971204c05bb7fb81a4a8db324a3'
BINARY_SHA256 = '743037ca1415b1ab2f9f71dba9024b020020c413c2efd8c1acf1c08143772eb7'
URL = 'https://github.com/Gentleman-Programming/engram/releases/download/v3.0.0/engram_3.0.0_windows_amd64.zip'
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_BINARY = 32 * 1024 * 1024

def verify_runtime(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > MAX_BINARY:
        raise ValueError('Pinned Engram runtime is missing. Run python tools/prepare_engram.py before packaging.')
    if hashlib.sha256(path.read_bytes()).hexdigest() != BINARY_SHA256:
        raise ValueError('Engram runtime SHA256 mismatch; packaging refused. Restore the pinned runtime.')
    return path

def extract_verified(data):
    if len(data) > MAX_ARCHIVE or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Engram archive SHA256 mismatch; nothing installed.')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename == 'engram.exe']
        if len(entries) != 1 or entries[0].file_size > MAX_BINARY:
            raise ValueError('Invalid Engram archive layout; nothing installed.')
        binary = archive.read(entries[0])
    if hashlib.sha256(binary).hexdigest() != BINARY_SHA256:
        raise ValueError('Engram executable SHA256 mismatch; nothing installed.')
    return binary

def prepare(destination=None):
    destination = Path(destination or ROOT / 'runtime/engram' / NAME)
    if destination.is_file():
        return verify_runtime(destination)
    request = urllib.request.Request(URL, headers={'User-Agent': 'Elio-runtime-builder/1.0.1'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(MAX_ARCHIVE + 1)
    binary = extract_verified(data)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.engram-', delete=False) as target:
            temporary = Path(target.name)
            target.write(binary)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return verify_runtime(destination)

if __name__ == '__main__':
    print('Verified Engram 3.0.0:', prepare())
