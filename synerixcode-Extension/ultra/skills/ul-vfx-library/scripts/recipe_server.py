#!/usr/bin/env python3
"""Localhost sink for harvested recipes.

Printing recipes back through execute_luau output works for three and falls over
for two hundred: the output is chunked, size-capped, and a truncated recipe looks
like a valid one. HttpService reaches localhost from plugin context even with
HttpEnabled off, so the plugin POSTs each recipe straight to disk instead.
"""
import argparse, hashlib, json, os, pathlib, re
from http.server import BaseHTTPRequestHandler, HTTPServer


# A harvest is raw intake, not library content. Land it somewhere else and
# promote by hand: "curation is the part that is NOT mechanical", and a sink
# pointed straight at recipes/ makes thirty unlooked-at recipes indistinguishable
# from the ones you chose. Default: <your library folder>/harvested (from
# ROBLOX_VFX_LIB), else work/harvested inside the skill folder.
_LIB = os.environ.get("ROBLOX_VFX_LIB")
STAGE = (pathlib.Path(_LIB).expanduser() / "harvested") if _LIB else \
    pathlib.Path(__file__).resolve().parent.parent / "work" / "harvested"
WORK = pathlib.Path(__file__).resolve().parent.parent / "work"
SAFE = re.compile(r"[^A-Za-z0-9_.-]")


class H(BaseHTTPRequestHandler):
    OUT = STAGE

    def _reply(self, code, body):
        raw = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            return self._reply(400, json.dumps({"ok": False, "error": str(e)}))

        recipes = payload.get("recipes", [])
        written = []
        out_dir = self.OUT
        out_dir.mkdir(parents=True, exist_ok=True)
        for rec in recipes:
            name = SAFE.sub("_", str(rec.get("name", "unnamed")))[:64] or "unnamed"
            # A real place has ~120 loose Parts all called "Part", each carrying an
            # emitter. Keying the file on name alone silently collapses them into
            # ONE file and the harvest looks like it worked. Disambiguate on the
            # source path, which is unique by construction.
            src = rec.get("source_path", "")
            existing = out_dir / f"{name}.json"
            if existing.is_file():
                try:
                    prev = json.loads(existing.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    prev = {}
                if prev.get("source_path") not in (None, src):
                    tag = hashlib.sha1(src.encode()).hexdigest()[:6]
                    name = f"{name}__{tag}"
            # Belt and braces: never let two DIFFERENT recipes land on one file.
            # A lost recipe looks exactly like one that was never harvested.
            while True:
                cand = out_dir / f"{name}.json"
                if not cand.is_file():
                    break
                try:
                    prev = json.loads(cand.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    break
                if prev.get("source_path") in (None, src):
                    break
                name = f"{name}_x"
            # Texture provenance decided HERE, at ingest. Retrofitting it across a
            # harvested library later means re-walking every recipe.
            texs = rec.get("textures", [])
            rec["texture_portable"] = all(t.startswith("rbxasset://") for t in texs)
            rec["texture_refs"] = sorted(set(texs))
            p = out_dir / f"{name}.json"
            p.write_text(json.dumps(rec, indent=1), encoding="utf-8")
            written.append({"file": p.name, "layers": len(rec.get("layers", [])),
                            "portable": rec["texture_portable"]})
        print(f"wrote {len(written)}: {written}")
        self._reply(200, json.dumps({"ok": True, "written": written}))

    def do_GET(self):
        # Serve an assembled payload so Studio can fetch+loadstring it instead of
        # having it pasted into execute_luau. MEASURED: loadstring IS available in
        # plugin context, so payload size stops being a limit at all.
        if self.path.startswith("/payload/"):
            name = SAFE.sub("_", self.path[len("/payload/"):])
            f = WORK / name
            if not f.is_file():
                return self._reply(404, json.dumps({"ok": False, "error": f"no {name} in {WORK}"}))
            raw = f.read_text(encoding="utf-8").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self._reply(200, json.dumps({"ok": True, "out": str(self.OUT)}))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=48752)
    ap.add_argument("--out", default=None,
                    help="output dir (default: <ROBLOX_VFX_LIB>/harvested, else work/harvested; "
                         "NOT your curated recipes/ folder)")
    a = ap.parse_args()
    OUT = pathlib.Path(a.out).resolve() if a.out else STAGE
    H.OUT = OUT
    print(f"recipe sink on http://127.0.0.1:{a.port} -> {OUT}")
    HTTPServer(("127.0.0.1", a.port), H).serve_forever()
