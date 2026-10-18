"""Measure (and optionally yaw) the GLB that is actually uploaded. No Blender.

    python glb_tool.py measure --glb out/low.glb [--bins 10] [--json]
    python glb_tool.py rotate  --glb out/low.glb --yaw 90 [--out rotated.glb]

WHY IT EXISTS (defects it guards, measured on this project):

1. HAND-TYPED BOUNDS DRIFTED UP TO 47%. mesh_pipeline.py's report carries
   `dimensions_studs`, but those are measured on the HIGH poly BEFORE decimation,
   so they are not the numbers of the file that ships. This reads the uploaded
   GLB itself - every primitive, through its node's world matrix - and reports
   the bounds in glTF axes, which are ROBLOX axes (Y up). Put these numbers in a
   manifest, never a typed one.

2. "WHICH END IS THE FRONT" INVERTED ON THREE BLADES under three different rules.
   So `measure` hands back the whole cross-section PROFILE along the longest
   horizontal axis (width across and height per bin), not a conclusion. A second
   reader can check the call from the numbers.

3. AN OPEN MESH IS A SEE-THROUGH HOLE IN ROBLOX (single-sided rendering).
   `measure` welds by position and counts boundary edges (edges with one face).
   Non-zero is reported, not fatal: a generated organic mesh can carry a few.

`rotate` bakes a yaw about the vertical (glTF +Y) into POSITION, NORMAL and
TANGENT and rewrites the accessor min/max, so an asset's front can be put on a
fixed axis IN THE ASSET instead of in a per-asset rotation table in game code
(which goes stale the moment one asset is regenerated). UVs are untouched, so the
painted atlas and the baked tangent-space normal map stay valid.
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
      5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load(path: Path):
    data = path.read_bytes()
    magic, _ver, _len = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise SystemExit(f"{path} is not a GLB")
    off, gj, binc = 12, None, None
    while off < len(data):
        ln, typ = struct.unpack_from("<II", data, off)
        body = data[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A:
            gj = json.loads(body.decode("utf-8"))
        elif typ == 0x004E4942:
            binc = bytearray(body)
        off += 8 + ln
    return gj, binc


def save(path: Path, gj: dict, binc: bytearray) -> None:
    js = json.dumps(gj, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = bytes(binc) + b"\0" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bn), 0x004E4942) + bn
    path.write_bytes(out)


def accessor(gj, binc, idx):
    acc = gj["accessors"][idx]
    bv = gj["bufferViews"][acc["bufferView"]]
    dt = np.dtype(CT[acc["componentType"]])
    nc = NC[acc["type"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride", 0) or dt.itemsize * nc
    if stride != dt.itemsize * nc:
        raise SystemExit("interleaved buffers are not supported")
    arr = np.frombuffer(bytes(binc[start: start + acc["count"] * stride]), dtype=dt)
    return arr.reshape(acc["count"], nc) if nc > 1 else arr, start


def node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], float).reshape(4, 4).T
    t = np.array(node.get("translation", [0, 0, 0]), float)
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    s = np.array(node.get("scale", [1, 1, 1]), float)
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def world_geometry(gj, binc):
    """All triangles of the scene, in world space (glTF = Roblox axes)."""
    verts, tris, base = [], [], 0

    def walk(ni, parent):
        nonlocal base
        node = gj["nodes"][ni]
        m = parent @ node_matrix(node)
        if "mesh" in node:
            for prim in gj["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                pos, _ = accessor(gj, binc, prim["attributes"]["POSITION"])
                pos = pos.astype(float) @ m[:3, :3].T + m[:3, 3]
                if "indices" in prim:
                    idx, _ = accessor(gj, binc, prim["indices"])
                    idx = idx.astype(np.int64).reshape(-1, 3)
                else:
                    idx = np.arange(len(pos)).reshape(-1, 3)
                verts.append(pos)
                tris.append(idx + base)
                base += len(pos)
        for c in node.get("children", []):
            walk(c, m)

    scene = gj["scenes"][gj.get("scene", 0)]
    for ni in scene["nodes"]:
        walk(ni, np.eye(4))
    return np.concatenate(verts), np.concatenate(tris)


def boundary_edges(v, t, tol=1e-5):
    key = np.round(v / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    tt = inv[t]
    tt = tt[(tt[:, 0] != tt[:, 1]) & (tt[:, 1] != tt[:, 2]) & (tt[:, 0] != tt[:, 2])]
    e = np.concatenate([tt[:, [0, 1]], tt[:, [1, 2]], tt[:, [2, 0]]])
    e.sort(axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    return int((counts == 1).sum()), int((counts > 2).sum())


def cmd_measure(a) -> int:
    gj, binc = load(Path(a.glb))
    v, t = world_geometry(gj, binc)
    lo, hi = v.min(axis=0), v.max(axis=0)
    size = hi - lo
    open_e, nonman = boundary_edges(v, t)
    # Long axis = the longer of the two HORIZONTAL Roblox axes (X, Z); Y is up.
    long_ax = 0 if size[0] >= size[2] else 2
    across = 2 if long_ax == 0 else 0
    n = (v - lo) / np.where(size == 0, 1, size)
    prof = []
    for i in range(a.bins):
        m = (n[:, long_ax] >= i / a.bins) & (n[:, long_ax] < (i + 1) / a.bins + (1e-9 if i == a.bins - 1 else 0))
        if m.sum() < 3:
            prof.append({"bin": i, "n": int(m.sum())})
            continue
        s = v[m]
        prof.append({"bin": i, "n": int(m.sum()),
                     "width": round(float(np.ptp(s[:, across])), 3),
                     "height": round(float(np.ptp(s[:, 1])), 3),
                     "y_top": round(float(s[:, 1].max() - lo[1]), 3)})
    has_uv = all("TEXCOORD_0" in p["attributes"]
                 for m in gj["meshes"] for p in m["primitives"])
    out = {
        "glb": str(a.glb),
        "tris": int(len(t)),
        "verts": int(len(v)),
        "bounds_studs_xyz_roblox": [round(float(x), 3) for x in size],
        "longest_studs": round(float(size.max()), 3),
        "centre_offset": [round(float(x), 3) for x in (lo + hi) / 2],
        "has_uv": has_uv,
        "boundary_edges": open_e,
        "nonmanifold_edges": nonman,
        "profile_axis": "XYZ"[long_ax],
        "profile_across": "XYZ"[across],
        "profile_min_to_max": prof,
    }
    print(json.dumps(out) if a.json else json.dumps(out, indent=1))
    return 0


def cmd_rotate(a) -> int:
    src = Path(a.glb)
    gj, binc = load(src)
    ang = math.radians(a.yaw)
    c, s = math.cos(ang), math.sin(ang)
    # Right-handed yaw about +Y: x' = c x + s z, z' = -s x + c z
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    for node in gj["nodes"]:
        if any(k in node for k in ("matrix", "rotation", "scale")):
            m = node_matrix(node)
            if not np.allclose(m[:3, :3], np.eye(3), atol=1e-6):
                raise SystemExit("node carries a rotation/scale; bake transforms before rotating")
    done = set()
    for mesh in gj["meshes"]:
        for prim in mesh["primitives"]:
            for key in ("POSITION", "NORMAL", "TANGENT"):
                idx = prim["attributes"].get(key)
                if idx is None or idx in done:
                    continue
                done.add(idx)
                arr, start = accessor(gj, binc, idx)
                arr = arr.astype(np.float64).copy()
                arr[:, :3] = arr[:, :3] @ R.T
                binc[start: start + arr.astype(np.float32).nbytes] = arr.astype(np.float32).tobytes()
                if key == "POSITION":
                    acc = gj["accessors"][idx]
                    acc["min"] = [float(x) for x in arr[:, :3].min(axis=0)]
                    acc["max"] = [float(x) for x in arr[:, :3].max(axis=0)]
    for node in gj["nodes"]:
        if "translation" in node:
            node["translation"] = [float(x) for x in R @ np.array(node["translation"], float)]
    dest = Path(a.out) if a.out else src
    save(dest, gj, binc)
    print(f"[glb] yaw {a.yaw} deg baked into {dest}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["measure", "rotate"])
    ap.add_argument("--glb", required=True)
    ap.add_argument("--bins", type=int, default=10)
    ap.add_argument("--json", action="store_true", help="one line")
    ap.add_argument("--yaw", type=float, default=0.0, help="degrees about +Y (up)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    return cmd_measure(a) if a.cmd == "measure" else cmd_rotate(a)


if __name__ == "__main__":
    sys.exit(main())
