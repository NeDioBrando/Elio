"""Sample a colour map's ACTUAL pixels against the spec hexes.

Guards the measured 2026-09-02 failure: the painter wrote LINEAR values into a
PNG that is read as sRGB, so a spec asking #969BA0 shipped #4E545A - about half
as bright, which looks like dim lighting and not like a bug. So this reports,
per spec colour:

  present_pct   share of painted texels within tol of the spec colour
  nearest       the closest colour actually in the file, and its distance
  halved_pct    share of texels near srgb_to_linear(spec) - i.e. near the value
                the BUG would have written. Anything but ~0 here is the bug.

Ignores fully-unpainted gutter texels (the painter leaves them at the dilated
edge colour, so a flat-fill check would be dominated by them).
"""
import argparse, json, struct, sys, zlib


def read_png(path):
    d = open(path, "rb").read()
    p, idat, W = 8, b"", None
    while p < len(d):
        ln = struct.unpack(">I", d[p:p + 4])[0]
        tag = d[p + 4:p + 8]
        body = d[p + 8:p + 8 + ln]
        if tag == b"IHDR":
            W, H, bd, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        p += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = W * nch
    out, prev, q = [], bytearray(stride), 0
    for _ in range(H):
        f = raw[q]; q += 1
        line = bytearray(raw[q:q + stride]); q += stride
        for i in range(stride):
            a = line[i - nch] if i >= nch else 0
            b = prev[i]
            c = prev[i - nch] if i >= nch else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out.append(bytes(line)); prev = line
    return W, H, nch, out


def srgb_to_linear_byte(v):
    c = v / 255.0
    lin = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return int(round(lin * 255))


ap = argparse.ArgumentParser()
ap.add_argument("--png", required=True)
ap.add_argument("--spec", required=True, help='json {"key":"#RRGGBB"}')
ap.add_argument("--tol", type=int, default=14)
ap.add_argument("--step", type=int, default=2)
a = ap.parse_args()

W, H, nch, rows = read_png(a.png)
spec = json.loads(a.spec)

px = []
for y in range(0, H, a.step):
    r = rows[y]
    for x in range(0, W, a.step):
        o = x * nch
        if nch >= 4 and r[o + 3] < 8:
            continue
        px.append((r[o], r[o + 1], r[o + 2]))
n = len(px)

hist = {}
for c in px:
    hist[c] = hist.get(c, 0) + 1
top = sorted(hist.items(), key=lambda kv: -kv[1])[:6]

res = {}
for k, hx in spec.items():
    t = tuple(int(hx.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    half = tuple(srgb_to_linear_byte(v) for v in t)
    near = sum(1 for c in px if max(abs(c[0] - t[0]), abs(c[1] - t[1]), abs(c[2] - t[2])) <= a.tol)
    nearh = sum(1 for c in px if max(abs(c[0] - half[0]), abs(c[1] - half[1]), abs(c[2] - half[2])) <= a.tol)
    best, bd = None, 1e9
    for c in hist:
        d = max(abs(c[0] - t[0]), abs(c[1] - t[1]), abs(c[2] - t[2]))
        if d < bd:
            best, bd = c, d
    res[k] = {
        "spec": hx.upper(),
        "present_pct": round(100.0 * near / n, 2),
        "nearest_in_file": "#%02X%02X%02X" % best,
        "nearest_chan_dist": bd,
        "halved_value_would_be": "#%02X%02X%02X" % half,
        "halved_pct": round(100.0 * nearh / n, 2),
    }

print("COLOURS " + json.dumps({
    "png": a.png, "size": [W, H], "sampled_texels": n, "tol_per_channel": a.tol,
    "top_colours": [["#%02X%02X%02X" % c, round(100.0 * v / n, 2)] for c, v in top],
    "spec_colours": res,
}))
