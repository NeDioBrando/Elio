// Blender connect smoke (run: node test-blender.js). Not shipped.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const root = __dirname;
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const main = fs.readFileSync(path.join(root, "core/main.js"), "utf8");
const cfg = fs.readFileSync(path.join(root, "core/config.js"), "utf8");
const py = fs.readFileSync(path.join(root, "blender_once.py"), "utf8");
const ps = fs.readFileSync(path.join(root, "blender_once.ps1"), "utf8");

ok("once python talks to 9876 only", py.includes("9876") && py.includes("--probe") && !py.includes("17617"));
ok("once powershell talks to 9876 only", ps.includes("9876") && ps.includes("-Probe") && !ps.includes("17617"));
ok("bg blender_connect exists", bg.includes('case "blender_connect"') && bg.includes("connectBlender"));
ok("bg probe is one-shot TCP", bg.includes("BLENDER_UP") && bg.includes("TcpClient") && bg.includes("9876"));
ok("bg does not spawn uvx for blender", !/uvx\s+blender-mcp/.test(bg));
ok("bg has no HTTP shim port", !bg.includes("17617") && !bg.includes("PORT_BLENDER_HTTP") && !bg.includes("launch_blender_mcp.py"));
ok("bg does not rememberBlender before success", !bg.includes("rememberBlender") && !bg.includes("blenderWanted"));
ok("bg heartbeat does not restart blender", !bg.includes("ensureBlenderShim") && !bg.includes("blenderHealth"));
ok("bg routes blender tools only when connected", bg.includes("blenderAddon && isBlenderToolName"));
ok("bg sendLocalEngine for one-shot", bg.includes("sendLocalEngine") && bg.includes("blender_once."));
ok("main connect uses blender_connect", main.includes('type: "blender_connect"') && !main.includes("uvx blender-mcp"));
ok("main does not intercept blender tools when disconnected",
  main.includes("A.bridge && A.bridge.blender") && !main.includes("Blender is not connected. Click Connect Blender in the synerixcode menu"));
ok("cards do not claim blender is already connected", !main.includes("Blender MCP is connected"));
ok("prompt no uvx requirement", !cfg.includes("uvx blender-mcp") && cfg.includes("Start MCP Server"));
ok("prompt does not mention hop", !cfg.includes("local hop"));
ok("glass tokens untouched", fs.readFileSync(path.join(root, "overlay.css"), "utf8").includes("rgba(16, 17, 25, 0.82)"));
const ops = fs.readFileSync(path.join(root, "blender_ops.py"), "utf8");
ok("ops script has export and import", ops.includes("try_export_fbx") && ops.includes("try_import_fbx"));
ok("ops script writes status file", ops.includes("SYNERIXCODE_MESH_JSON") && ops.includes("def emit"));
ok("ops can group objects", ops.includes("def cmd_group") && ops.includes("def cmd_join") && ops.includes("def cmd_parent"));
ok("ops has 24+ commands", (ops.match(/\n    \"[a-z_]+\": /g) || []).length >= 24);
ok("bg ships blender_ops.py", bg.includes("blender_ops.py") && bg.includes("blender_group") && bg.includes("blender_send_to_studio"));
ok("bg replaces every ARGS token", bg.includes('split("__SYNERIXCODE_ARGS__")') && bg.includes("JSON.stringify(args"));
ok("execute_code maps EEVEE_NEXT", bg.includes("wrapBlenderUserCode") && bg.includes("BLENDER_EEVEE_NEXT") && bg.includes("wrapBlenderUserCode(a.code"));
ok("ops loads ARGS as JSON", (ops.match(/__SYNERIXCODE_ARGS__/g) || []).length === 1 && ops.includes("json.loads"));
ok("ops has daily commands", ops.includes("def cmd_origin_to_bottom") && ops.includes("def cmd_drop_to_ground") && ops.includes("def cmd_array"));
ok("bg export filepath is optional", bg.includes("blenderOpsCode") && !bg.includes("return {'filepath': fp}"));
ok("main intercepts asset_bridge_import", main.includes("runAssetBridgeImport") && main.includes("blender_mesh_dump"));
ok("main auto-imports export to Studio", main.includes("blender_send_to_studio") && main.includes("Studio:"));
ok("disconnect blender button", main.includes("rs-mcp-blender-off") && main.includes("blender_disconnect") && bg.includes('case "blender_disconnect"'));
ok("connect verifies actual scene with native transport", bg.includes('blenderRequest({type:"get_scene_info"') && bg.includes("8000"));
ok("dump falls back to all meshes", ops.includes("if not objs:") && ops.includes('"meshes": meshes'));
ok("blenderCall returns meshes", bg.includes("meshes: meshes || undefined") && bg.includes('const mesh = "synerixcode_mesh.json"'));
ok("blender flag survives SW restart", bg.includes("rs-blender-on") && bg.includes("probeBlenderTcp"));
ok("asset_bridge is not a queue stub in the intercept", main.includes("studioMeshLuau"));

const probe = spawnSync("python3", [path.join(root, "blender_once.py"), "--probe"], {
  encoding: "utf8", timeout: 8000, env: { ...process.env, BLENDER_PORT: "19976" },
});
const out = String((probe.stdout || "") + (probe.stderr || ""));
ok("blender_once --probe prints UP or DOWN", /BLENDER_UP|BLENDER_DOWN/.test(out));
ok("probe of empty port is DOWN", /BLENDER_DOWN/.test(out));

const port = 19977;
const mock = spawn("python3", ["-c", `
import json, socket
port = ${port}
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port)); s.listen(8)
print("READY", flush=True)
while True:
    c, _ = s.accept()
    data = b""
    c.settimeout(5)
    try:
        while True:
            ch = c.recv(8192)
            if not ch: break
            data += ch
            try:
                json.loads(data.decode()); break
            except Exception:
                pass
        if data:
            c.sendall(json.dumps({"status":"ok","result":{"objects":["Cube"]}}).encode())
    except Exception:
        pass
    try: c.close()
    except Exception: pass
`], { stdio: ["ignore", "pipe", "pipe"] });

function finish(code) {
  try { mock.kill(); } catch {}
  process.exit(code);
}
mock.stdout.once("data", () => {
  const env = { ...process.env, BLENDER_PORT: String(port), BLENDER_HOST: "127.0.0.1" };
  const up = spawnSync("python3", [path.join(root, "blender_once.py"), "--probe"], { encoding: "utf8", timeout: 8000, env });
  ok("probe sees mock addon", /BLENDER_UP/.test(String(up.stdout || "")));
  const inFile = path.join(root, "_synerixcode_blender_in.json");
  const outFile = path.join(root, "_synerixcode_blender_out.json");
  fs.writeFileSync(inFile, JSON.stringify({ type: "get_scene_info", params: {} }));
  const sent = spawnSync("python3", [path.join(root, "blender_once.py"), inFile, outFile], { encoding: "utf8", timeout: 8000, env });
  ok("once send prints SYNERIXCODE_BLENDER_OK", /SYNERIXCODE_BLENDER_OK/.test(String(sent.stdout || "")));
  let parsed = {};
  try { parsed = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
  ok("once round-trip result", parsed && parsed.status === "ok" && parsed.result && parsed.result.objects[0] === "Cube");
  try { fs.unlinkSync(inFile); fs.unlinkSync(outFile); } catch {}
  if (process.exitCode) {
    console.log("\nSome blender checks failed.");
    finish(process.exitCode);
  }
  console.log("\nStatic blender checks passed.");
  finish(0);
});
mock.on("error", (e) => { console.error(e); finish(1); });
setTimeout(() => { console.error("mock addon did not start"); finish(1); }, 8000);

const opsPy = fs.readFileSync(path.join(root, "blender_ops.py"), "utf8");
ok("align camera axis command", opsPy.includes("def cmd_align_camera_axis") && opsPy.includes('"align_camera_axis"'));
ok("view axis + camera_to_view + lens", opsPy.includes("def cmd_view_axis") && opsPy.includes("def cmd_camera_to_view") && opsPy.includes("def cmd_set_camera_lens"));
ok("bg maps blender_align_camera", bg.includes("blender_align_camera") && bg.includes("camera_to_view"));
ok("blender scale/bevel/keyframe/track", opsPy.includes("def cmd_scale") && opsPy.includes("def cmd_bevel") && opsPy.includes("def cmd_keyframe_insert") && opsPy.includes("def cmd_track_to") && opsPy.includes('"scale": cmd_scale'));
ok("bg maps new blender cmds", bg.includes("blender_scale") && bg.includes("blender_subdivision") && bg.includes("blender_add_armature") && bg.includes("blender_origin_to_geometry"));
