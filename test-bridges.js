// Connectivity suite: verifies the agent is up and every engine bridge
// answers correctly. RS may be honestly offline (no Studio open) — that's
// a PASS as long as the bridge frame arrives with the right shape. AS must
// be fully ready (native, no editor needed).
const HTTP = "http://127.0.0.1:3000";
const ENGINES = [
  { port: 17613, id: "roblox",  name: "Roblox" },
  { port: 17615, id: "local",   name: "AgentScript" },
];
const key = process.env.ELIO_TEST_KEY;
if (!key) throw new Error("Run against an isolated bridge with ELIO_TEST_KEY set.");
const failures = [];
const notes = [];

function introFor(ws, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("intro timeout")), 6000);
    ws.addEventListener("message", function h(ev) {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "connected" && m.servers?.some(server => server.id === id)) { clearTimeout(timer); ws.removeEventListener("message", h); resolve(m); }
      } catch {}
    });
  });
}

async function checkEngine({ port, id, name }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, ["elio", "elio-auth." + key]);
  const received = introFor(ws, id);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`ws:${port} refused`));
  });
  const intro = await received;
  if (intro.type !== "connected") throw new Error("bad frame");
  if (!Array.isArray(intro.servers) || !intro.servers.length || intro.servers[0].id !== id)
    throw new Error(`server id mismatch: ${JSON.stringify(intro.servers && intro.servers[0])}`);
  if (!Array.isArray(intro.tools)) throw new Error("tools not an array");
  ws.close();
  return intro;
}

(async () => {
  // Distinct Chromium extension identities pair independently; web origins remain rejected.
  for(const id of ["a".repeat(32),"b".repeat(32),"c".repeat(32)]) {
    const response=await fetch(`${HTTP}/api/pair`,{method:"POST",headers:{"Content-Type":"application/json","X-elio-Extension":id,Origin:"chrome-extension://"+id},body:"{}"});
    if(!response.ok || (await response.json()).key!==key)failures.push("Independent browser extension pairing failed");
  }
  const denied=await fetch(`${HTTP}/api/pair`,{method:"POST",headers:{"Content-Type":"application/json","X-elio-Extension":"a".repeat(32),Origin:"https://example.com"},body:"{}"});if(denied.status!==403)failures.push("Web origin was allowed to auto-pair");
  // Agent process itself
  let st;
  try {
    st = await fetch(`${HTTP}/api/status`, {headers: {Authorization: "Bearer " + key}}).then((r) => r.json());
    if (typeof st.local_root !== "string" || typeof st.local_full !== "boolean") failures.push("status missing local fields");
    else console.log("PASS http /api/status (local_root present)");
  } catch { failures.push("agent HTTP API unreachable on 3000"); }

  for (const e of ENGINES) {
    try {
      const intro = await checkEngine(e);
      if (e.id === "local") {
        if (intro.ok !== true) failures.push("AS not ready (workspace down?)");
        const names = intro.tools.map(tool => tool.name);
        if (!names.includes("read_file") || !names.includes("edit_file") || !names.includes("run_command") || new Set(names).size !== names.length) failures.push("AS catalog missing required commands or contains duplicates");
        if (intro.servers[0].alive !== true) failures.push("AS server not alive");
        console.log(`PASS ${e.name} (${e.id}) : READY, ${intro.tools.length} tools`);
      } else {
        const alive = intro.servers[0].alive === true;
        if (alive) console.log(`PASS ${e.name} (${e.id}) : bridge up, editor CONNECTED`);
        else { notes.push(`${e.name}: bridge up, editor offline (expected without Studio open)`); console.log(`PASS ${e.name} (${e.id}) : bridge up, editor offline (honest)`); }
      }
    } catch (err) {
      failures.push(`${e.name} (${e.id}) → ${err.message}`);
    }
  }

  const first=new WebSocket("ws://127.0.0.1:17615",["elio","elio-auth."+key]);const second=new WebSocket("ws://127.0.0.1:17615",["elio","elio-auth."+key]);
  await Promise.all([first,second].map(socket=>new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error("Concurrent browser socket failed"))})));
  second.close();await new Promise(resolve=>second.addEventListener("close",resolve,{once:true}));
  const retained=await fetch(HTTP+"/api/status",{headers:{Authorization:"Bearer "+key}}).then(r=>r.json());if(!retained.local_bridge_connected)failures.push("Closing one browser removed the other browser connection");
  first.close();console.log("PASS independent Chromium identities, rejected web origin and concurrent socket isolation");
  if (failures.length) { console.log("FAILURES:\n" + failures.join("\n")); process.exit(1); }
  if (notes.length) console.log("notes: " + notes.join(" | "));
  console.log("ALL BRIDGE CONNECTIVITY TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.log("FATAL:", e.message || String(e)); process.exit(1); });
