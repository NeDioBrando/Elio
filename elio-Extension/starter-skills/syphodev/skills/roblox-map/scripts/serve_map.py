"""Serve a resolved map to Studio over localhost.

LIFT. The map is raised off y=0 at build time, and the default is 6 studs for a
reason that a smaller number cannot satisfy: TERRAIN QUANTISES TO A 4-STUD VOXEL
GRID. A 0.5 stud lift is rounded away entirely, which put a lake surface back at
exactly y=0 - straight onto Studio's editor grid - even though every Part in the
map was correctly above it. Any lift must exceed one voxel (4 studs), and
terrain surfaces should be planned on multiples of 4.

SHAPES. Measured in Studio: a Roblox `Cylinder` part runs along its X axis with
the circular cross-section taken from min(Y, Z), and a `Ball` uses the SMALLEST
of the three dimensions as its diameter. A map almost always wants an UPRIGHT
cylinder - a silo, a pillar, a round platform - so the builder rolls those 90
degrees about Z and swaps the extents. The spec just says `"shape": "cylinder"`
with a normal (diameter, height, diameter) size.

The prover keeps treating every shape as its bounding box, which is
conservative: a cylinder's true volume is a subset of that box, so an overlap
check can only ever be too cautious, never permissive.

A dressed map is hundreds of parts, and a Luau builder for one is tens of
kilobytes - too much to paste through execute_luau, and a very large
generated script can hang the plugin thread anyway. So the geometry
goes over HTTP as JSON and a ~40 line bootstrap builds it. HttpService works
from plugin context; roblox-vfx proved that.

Run:  python serve_map.py sky_citadel          # serves, prints the bootstrap
      python serve_map.py sky_citadel --port 8787
      python serve_map.py design/map.json --asset-ids work/asset_ids.json
"""

from __future__ import annotations

import argparse
import io
import http.server
import json
import os
import socketserver
import sys
import threading

import spec as specmod
import theme as thememod
from emit import MATERIALS, _colour, _material, _wedge_transform

def bootstrap(port):
    """The builder Luau, with the port injected.

    This used to be a triple-quoted string here, and it silently fell YEARS
    behind the builder actually being used - it could not place a mesh, fill
    water, or make a folder. One copy, in scripts/luau/build.lua.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "luau", "build.lua")
    with io.open(path, encoding="utf-8") as fh:
        return fh.read().replace("{port}", str(port))


# Where each kit's output belongs in the tree. A flat Model is unusable in the
# explorer once a map passes a hundred parts, and every Roblox map convention
# expects Terrain / Landmarks / Structures / Props / Spawns under one root.
KIT_GROUP = {
    "mesh": "Props", "mesh_scatter": "Props",
    # terrain and ground
    "island": "Terrain", "pond": "Terrain", "treeline": "Terrain",
    "tree": "Terrain",
    # things you walk on or through
    "platform": "Structures", "wall": "Structures", "bridge": "Structures",
    "stairs": "Structures", "path": "Structures", "field": "Structures",
    "plaza": "Structures",
    # silhouette anchors
    "tower": "Landmarks", "barn": "Landmarks", "silo": "Landmarks",
    "windmill": "Landmarks", "cottage": "Landmarks",
    # dressing
    "pillar": "Props", "scatter": "Props",
    # the round kits, added late - without these every part fell through to
    # "Structures/<its own name>" and made 61 folders holding one part each
    "round_platform": "Structures", "round_silo": "Landmarks", "well": "Landmarks",
    "boulder_cluster": "Terrain", "mound": "Terrain",
}

# Plain (non-kit) parts are filed by role, so a hand-written ground plane does
# not end up in Structures next to the bridges.
ROLE_GROUP = {
    "arena_floor": "Terrain", "meadow": "Terrain", "yard": "Terrain",
    "high_ground": "Terrain", "landmark_base": "Terrain",
    "landmark": "Landmarks", "prop": "Props", "border": "Terrain",
}


def group_of(b):
    kit = b.meta.get("kit")
    if kit in KIT_GROUP:
        return KIT_GROUP[kit] + "/" + str(b.meta.get("zone") or b.name)
    if b.meta.get("mesh") and "landmark" not in b.roles:
        return "Props/" + b.name
    for r in b.roles:
        if r in ROLE_GROUP:
            return ROLE_GROUP[r] + "/" + b.name
    return "Structures/" + b.name


def _asset_ids(m, override=None):
    """Your uploaded mesh ids, {name: assetId}, so build.lua can cache them in
    ServerStorage and clone one per placement.

    Looked up in this order: the --asset-ids flag, the spec's "assetIdsFile"
    (relative to the spec), then <skill>/assets/<assetSet>_ids.json.
    An empty registry is legal - a part-only map needs none - but a spec that
    names a mesh with no id will report it as MISSING at build time rather
    than silently placing nothing.
    """
    aset = m.source.get("assetSet", "map")
    rel = override or m.source.get("assetIdsFile")
    if rel:
        path = rel if os.path.isabs(rel) else os.path.join(m.source.get("__dir__", "."), rel)
        if override and not os.path.isabs(rel):
            path = os.path.abspath(rel)
    else:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "assets", f"{aset}_ids.json")
    if not os.path.isfile(path):
        if rel:
            print(f"WARNING: asset ids file {path} not found - meshes will be reported MISSING")
        return {}
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def payload(m, asset_ids=None):
    parts = []
    for b in m.boxes:
        size, extra = _wedge_transform(b) if b.ramp_axis else (b.size, 0.0)
        r, g, bl = _colour(b)
        decor = bool(b.meta.get("decor"))
        parts.append([
            b.name,
            round(size[0], 3), round(size[1], 3), round(size[2], 3),
            round(b.centre[0], 3), round(b.centre[1], 3), round(b.centre[2], 3),
            round((b.yaw + extra) % 360.0, 3),
            r, g, bl, _material(b),
            1 if b.ramp_axis else 0,
            1 if b.solid else 0,
            1 if b.visible else 0,
            # Small greeble casting shadows is expensive and buys nothing; the
            # masses it sits on already cast them.
            0 if (decor and max(size) < 4.0) else 1,
            group_of(b),
            b.meta.get("themeRole") or "",
            b.meta.get("mesh") or "",
            round(b.meta.get("meshScale", 1.0), 4),
            1 if b.meta.get("terrainWater") else 0,
            b.meta.get("shape") or "block",
            1 if b.meta.get("organic") else 0,
            int(b.meta.get("lobes", 0)),
        ])
    # The theme is named in the spec, not carried on the resolved map, so the
    # payload loads it here. Meshes are coloured from this same table, which is
    # the whole point: parts and meshes cannot drift onto different palettes.
    # The asset set names the uploaded-mesh library and the ServerStorage folder
    # it is cached in. It used to be the literal string "farm" in three places -
    # the ids file, the folder name and the MaterialVariant prefix - which meant
    # a map of any other genre could not be built at all without editing the
    # builder. It is a spec field now.
    aset = m.source.get("assetSet", "map")
    theme = thememod.load(m.source.get("theme")) if m.source.get("theme") else {}
    pal = theme.get("palette") or {}
    mats = theme.get("materials") or {}
    palette = {r: {"r": c[0], "g": c[1], "b": c[2],
                   "material": mats.get(r, "SmoothPlastic")}
               for r, c in pal.items()}
    return {
        "name": m.name,
        "palette": palette,
        "assetSet": aset,
        "assetIds": _asset_ids(m, asset_ids),
        "lift": float((m.source.get("volume") or {}).get("lift", 8.0)),
        # build.lua must not clear the voxels build_terrain.lua writes
        "terrain": bool(m.source.get("terrain")),
        "parts": parts,
        "spawns": [list(s) for s in m.spawns],
        "killPlane": m.kill_plane,
        "ringOutOffset": m.ring_out_y - m.kill_plane,
        "killSize": [m.bounds[1][0] - m.bounds[0][0],
                     m.bounds[1][2] - m.bounds[0][2]],
    }


def load_textures(directory, size=256):
    """Raw RGBA bytes per theme role, for the no-upload texture route.

    Measured 2026-08-27: `upload_decal` needs ROBLOSECURITY or an Open Cloud
    key, but AssetService:CreateEditableImage + WritePixelsBuffer +
    MaterialVariant.ColorMapContent needs NEITHER and works entirely in the
    session. Roblox strings are byte strings and `buffer.fromstring` exists, so
    the pixels go over the wire raw - no base64, no JSON escaping.
    """
    from PIL import Image
    out = {}
    if not directory or not os.path.isdir(directory):
        return out
    for fn in sorted(os.listdir(directory)):
        if not fn.lower().endswith(".png") or fn.endswith("_raw.png"):
            continue
        role = os.path.splitext(fn)[0]
        im = Image.open(os.path.join(directory, fn)).convert("RGBA")
        im = im.resize((size, size), Image.LANCZOS)
        out[role] = (im.tobytes(), size)
    return out


TERRAIN_CHUNK = 64


def terrain_payload(t, lift, chunk=TERRAIN_CHUNK, start_tide="high"):
    """meta + binary chunks for build_terrain.lua.

    3 bytes per column: uint16 little-endian (h + 512) * 8, then uint8 material.
    An eighth of a stud of height precision is below anything a voxel can show,
    and a 512x512 map is ~790 KB instead of megabytes of JSON.
    """
    import numpy as np
    h, m, meta = t["height"], t["material"], t["meta"]
    nz, nx = h.shape
    chunks = {}
    for cz in range(0, nz, chunk):
        for cx in range(0, nx, chunk):
            hh = h[cz:cz + chunk, cx:cx + chunk]
            mm = m[cz:cz + chunk, cx:cx + chunk]
            enc = np.clip(np.round((hh + 512.0) * 8.0), 0, 65535).astype("<u2")
            rec = np.zeros(hh.shape, dtype=[("h", "<u2"), ("m", "u1")])
            rec["h"], rec["m"] = enc, mm
            chunks[f"{cx // chunk}_{cz // chunk}"] = rec.tobytes()
    info = {
        "grid": meta["grid"], "tide": meta["tide"], "materials": meta["materials"],
        "caves": meta["caves"], "lift": lift, "chunk": chunk,
        "chunksX": (nx + chunk - 1) // chunk, "chunksZ": (nz + chunk - 1) // chunk,
        "seaFloorMin": float(h.min()), "deepMaterial": "Rock", "clear": True,
        "startTide": start_tide, "extent": max(nx, nz) * 4,
    }
    return json.dumps(info).encode("utf-8"), chunks


def serve(data, port, textures=None, terrain=None, extra=None):
    extra = extra or {}
    blob = json.dumps(data).encode("utf-8")
    textures = textures or {}
    index = json.dumps({r: {"size": t[1], "bytes": len(t[0])}
                        for r, t in textures.items()}).encode("utf-8")
    t_meta, t_chunks = terrain if terrain else (None, {})

    class H(http.server.BaseHTTPRequestHandler):
        def _send(self, body, ctype):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/terrain/meta.json" and t_meta:
                return self._send(t_meta, "application/json")
            if path.startswith("/terrain/chunk/"):
                key = path[len("/terrain/chunk/"):].removesuffix(".bin")
                if key in t_chunks:
                    return self._send(t_chunks[key], "application/octet-stream")
                self.send_response(404)
                self.end_headers()
                return
            if path.startswith("/files/") and extra:
                key = path[len("/files/"):]
                if key in extra:
                    with io.open(extra[key], "rb") as fh:
                        return self._send(fh.read(), "application/json")
                self.send_response(404)
                self.end_headers()
                return
            if path in ("/tide.lua", "/build_terrain.lua", "/horizon_ocean.lua"):
                lp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "luau", path[1:])
                with io.open(lp, "rb") as fh:
                    src = fh.read().replace(b"{port}", str(port).encode())
                return self._send(src, "text/plain")
            if path.startswith("/tex/"):
                role = path[5:].removesuffix(".rgba")
                if role not in textures:
                    self.send_response(404)
                    self.end_headers()
                    return
                body, _ = textures[role]
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/ambient.lua":
                # served so build.lua can install the runtime itself
                lp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "luau", "ambient.lua")
                with io.open(lp, "rb") as fh:
                    src = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(src)))
                self.end_headers()
                self.wfile.write(src)
                return
            body = index if path == "/textures.json" else blob
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, len(blob)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Serve a map to Studio over localhost.")
    ap.add_argument("spec")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--seconds", type=int, default=900)
    ap.add_argument("--print-bootstrap", action="store_true")
    ap.add_argument("--textures", help="directory of <role>.png tiling textures")
    ap.add_argument("--tex-size", type=int, default=256)
    ap.add_argument("--start-tide", choices=["low", "high"], default="high")
    ap.add_argument("--file", action="append", default=[],
                    help="name=path: serve a JSON file at /files/<name>")
    ap.add_argument("--asset-ids", help="JSON {meshName: assetId} for the meshes the spec places")
    a = ap.parse_args(argv)

    m = specmod.load(a.spec)
    d = payload(m, a.asset_ids)
    tex = load_textures(a.textures, a.tex_size)
    terrain_blob = None
    if m.source.get("terrain"):
        import terrain as terrainmod
        t = terrainmod.generate(m.source, None, preview=False)
        terrain_blob = terrain_payload(t, d["lift"], start_tide=a.start_tide)
        print(f"terrain: {len(terrain_blob[1])} chunks, "
              f"{sum(len(c) for c in terrain_blob[1].values())} bytes at /terrain/meta.json; "
              f"builder at /build_terrain.lua, tide runtime at /tide.lua")
    extra = dict(f.split("=", 1) for f in a.file)
    srv, n = serve(d, a.port, tex, terrain_blob, extra)
    if extra:
        print("files:", ", ".join(f"/files/{k}" for k in extra))
    print(f"serving {m.name}: {len(d['parts'])} parts, {n} bytes "
          f"on http://127.0.0.1:{a.port}/map.json")
    if tex:
        print(f"  textures at /tex/<role>.rgba : "
              f"{', '.join(f'{r}({t[1]}px)' for r, t in sorted(tex.items()))}")
    if a.print_bootstrap:
        print("--- bootstrap ---")
        print(bootstrap(a.port))
    import time
    time.sleep(a.seconds)
    srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
