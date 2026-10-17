// synerixcode v1.18 regression suite (run: node test-v118.js). Not shipped.
// Covers what v1.18 changed and what used to break silently:
//   * web_fetch / web_search - previously DDG-only; now a multi-backend chain
//     with per-backend failure notes, timeouts and a reader fallback;
//   * image transport - a screenshot taken by Studio/Blender is written to a
//     file on the user's PC, so the browser can only hand it to the AI through
//     the bridge's read_file_base64; blenderCall must read it BACK;
//   * attach_feedback - the "copy + paste + send the last screenshot" command;
//   * Blender materials - 10 new node-based material commands.
// The service worker is executed for real in a VM with a mocked network, so
// these are behavioural tests, not just grep checks.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failed = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond || extra === undefined ? "" : "  → " + extra));
  if (!cond) failed++;
};

const root = __dirname;
const bgSrc = fs.readFileSync(path.join(root, "background.js"), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "core/main.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(root, "core/config.js"), "utf8");
const pySrc = fs.readFileSync(path.join(root, "blender_ops.py"), "utf8");

// ── 1. Syntax of every shipped script ────────────────────────────────────────
try { new vm.Script(bgSrc, { filename: "background.js" }); ok("background.js parses", true); }
catch (e) { ok("background.js parses", false, e.message); }
try { new vm.Script(mainSrc, { filename: "core/main.js" }); ok("core/main.js parses", true); }
catch (e) { ok("core/main.js parses", false, e.message); }
try { new vm.Script(cfgSrc, { filename: "core/config.js" }); ok("core/config.js parses", true); }
catch (e) { ok("core/config.js parses", false, e.message); }

// ── 2. config.js actually evaluates: TOOL_NOTES + prompt surface ─────────────
let RS = null;
try {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  RS = vm.runInContext(cfgSrc + "\n;RS;", ctx);
  ok("config.js exports RS", !!RS && typeof RS.buildSystemPrompt === "function");
} catch (e) { ok("config.js exports RS", false, e.message); }

if (RS) {
  const notes = RS.TOOL_NOTES || {};
  for (const key of ["synerixcode_screenshot", "attach_feedback", "read_file_base64", "blender_material_create",
                     "blender_material_set", "blender_material_assign", "blender_material_noise",
                     "blender_material_image", "blender_material_pbr", "blender_material_preset",
                     "blender_material_inspect"]) {
    ok("TOOL_NOTES has " + key, typeof notes[key] === "string" && notes[key].length > 40);
  }
  const prompt = RS.buildSystemPrompt({ engine: "roblox" });
  ok("prompt documents attach_feedback", prompt.includes("attach_feedback"));
  ok("prompt documents the attach aliases", prompt.includes("attach_screenshot") && prompt.includes("copy_screenshot"));
  ok("local prompt explains image/file attachments",
    /read_file_base64/.test(RS.buildSystemPrompt({ engine: "local" })) && /attach_feedback/.test(RS.buildSystemPrompt({ engine: "local" })));
  ok("the live roster appends TOOL_NOTES by bare name", /RS\.TOOL_NOTES\[bareToolName\(t\.name\)\]/.test(mainSrc));
  ok("prompt no longer claims web_search is DuckDuckGo-only", !/web_search\\?`? {query, limit\?} DuckDuckGo/.test(prompt));
  ok("prompt keeps the screenshot target list", prompt.includes('{target?:"auto"|"studio"|"tab"|"blender"}'));
  ok("prompt points at the per-target reason on empty capture", /captured NOTHING/i.test(prompt));
  ok("tool notes survive into the roster text", typeof RS.compactTools === "function");
  ok("attach_feedback is a screen-category tool", RS.toolCategory("attach_feedback") === "screen");
  ok("synerixcode_screenshot aliases are screen-category tools", RS.toolCategory("synerixcode_screenshot") === "screen" && RS.toolCategory("screenshot") === "screen");
  ok("read_file_base64 is a read-category tool", RS.toolCategory("read_file_base64") === "read");
}

// ── 3. Blender material toolkit (python side) ────────────────────────────────
const MAT_OPS = ["material_create", "material_preset", "material_set", "material_assign", "material_list",
                 "material_inspect", "material_remove", "material_noise", "material_image", "material_pbr"];
for (const op of MAT_OPS) {
  ok("blender_ops.py defines cmd_" + op, pySrc.includes("def cmd_" + op + "("));
  ok("blender_ops.py dispatches " + op, new RegExp('"' + op + '":\\s*cmd_').test(pySrc));
}
ok("material toolkit has presets", (pySrc.match(/^\s{4}"[a-z_]+":\s*\{/gm) || []).length >= 25);
ok("materials survive Blender 4.x renames", pySrc.includes("Specular IOR Level") && pySrc.includes("Transmission Weight") && pySrc.includes("Coat Weight"));
ok("materials survive Blender <=4.1 blend fields", pySrc.includes("blend_method") && pySrc.includes("shadow_method") && pySrc.includes("surface_render_method"));
ok("no removed Musgrave node", !pySrc.includes("ShaderNodeTexMusgrave"));
ok("SYNERIXCODE_ prefixed nodes are cleaned up", pySrc.includes('"SYNERIXCODE_"') || pySrc.includes("SYNERIXCODE_"));
ok("every advertised preset exists in python (31/31)", (() => {
  const start = pySrc.indexOf("MATERIAL_PRESETS = {");
  const presets = new Set((pySrc.slice(start, pySrc.indexOf("\n}", start)).match(/^\s{4}"([a-z_0-9]+)":/gm) || [])
    .map((l) => l.trim().replace(/[":]/g, "")));
  const m = bgSrc.match(/"metal, steel, iron, ([^"]*)"/);
  const advertised = new Set(["metal", "steel", "iron", ...(m ? m[1].split(",").map((x) => x.trim()) : [])]);
  return advertised.size > 25 && [...advertised].every((n) => presets.has(n));
})());
ok("no helper is called that is not defined", (() => {
  const section = pySrc.slice(pySrc.indexOf("_BSDF_NAMES"));
  const defined = new Set((section.match(/^\s*def (_[a-z_0-9]+)\(/gm) || []).map((l) => l.trim().slice(4).replace("(", "")));
  const called = new Set((section.match(/(?<![\w.])(_[a-z_0-9]+)\(/g) || []).map((x) => x.slice(0, -1)));
  return [...called].every((c) => defined.has(c) || ["_", "_fn", "_m", "_u"].includes(c));
})());
ok("every command writes its status file", (() => {
  const re = /^def (cmd_[a-z_0-9]+)\(\):/gm;
  const heads = [...pySrc.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  const bodies = heads.map((h, i) => pySrc.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : pySrc.indexOf("DISPATCH = {")));
  const silent = bodies.filter((b) => !b.includes("emit("));
  return bodies.length > 20 && silent.every((b) => /return cmd_/.test(b));
})());
ok("every dispatch target exists", (() => {
  const tail = pySrc.slice(pySrc.indexOf("DISPATCH = {"));
  const defined = new Set((pySrc.match(/def (cmd_[a-z_0-9]+)\(/g) || []).map((s) => s.slice(4, -1)));
  return (tail.match(/"(?:[a-z_0-9]+)":\s*(cmd_[a-z_0-9]+)/g) || [])
    .every((m) => defined.has(m.split(":")[1].trim()));
})());

// ── 4. background.js: material tool wiring ───────────────────────────────────
{
  const start = bgSrc.indexOf("const BLENDER_CMD = {");
  const end = bgSrc.indexOf("};", start);
  const table = new Function("return " + bgSrc.slice(start + "const BLENDER_CMD = ".length, end + 1))();
  const tools = [...bgSrc.matchAll(/btool\("([a-z_0-9]+)"/g)].map((m) => m[1]);
  ok("BLENDER_CMD exposes every material op", MAT_OPS.every((op) => Object.values(table).includes(op)));
  ok("every advertised blender_* tool resolves", tools.filter((t) => t.startsWith("blender_")).every((t) => !!table[t]),
    tools.filter((t) => t.startsWith("blender_") && !table[t]).join(","));
  const advertised = tools.filter((t) => t.startsWith("blender_material"));
  ok("10 material tools advertised", advertised.length === 10, advertised.join(","));
  ok("material tools are named blender_material_*", advertised.every((t) => table[t].startsWith("material_")));
  ok("material_create accepts a preset + objects", /btool\("blender_material_create"[\s\S]{0,1400}objects/.test(bgSrc));
  ok("material tool schemas carry required args", bgSrc.includes('btool("blender_material_pbr"') && /btool\("blender_material_create"[\s\S]{0,1400}\["material"\]\)/.test(bgSrc));
  ok("blender tool names include the material tools", bgSrc.includes("BLENDER_TOOL_NAMES") && bgSrc.includes("blender_material_create"));
}

// ── 5. background.js: image transport ────────────────────────────────────────
ok("bridge tool read_file_base64 is called exactly once", (bgSrc.match(/name: "read_file_base64"/g) || []).length === 1);
ok("localReadBase64 helper exists", /async function localReadBase64\(path\)/.test(bgSrc));
ok("localReadBase64 is used by blenderCall", (bgSrc.match(/localReadBase64\(/g) || []).length >= 2);
ok("local_read_base64 message case exists", bgSrc.includes('case "local_read_base64"'));
ok("local_read_base64 returns path/mimeType/bytes/data",
  /case "local_read_base64"[\s\S]{0,400}sendResponse\(\{ ok: true, path: data\.path, mimeType: data\.mimeType, bytes: data\.bytes, data: data\.data \}\)/.test(bgSrc));
ok("blenderCall no longer hardcodes an empty image list", !/images: \[\]/.test(bgSrc));
ok("blenderCall reports the shot path back", bgSrc.includes("_orShot"));
ok("blenderCall explains a failed readback", bgSrc.includes("image_error"));
ok("capture_tab still exists for tab targets", bgSrc.includes('case "capture_tab"'));

// ── 6. core/main.js: screenshots + attach_feedback ───────────────────────────
ok("main has one shared capture routine", (mainSrc.match(/async function captureShots\(target,options=\{\}\)/g) || []).length === 1);
ok("synerixcode_screenshot uses the shared routine", mainSrc.includes('name === "synerixcode_screenshot"') && /captureShots\(target,\s*\{studio_id:\s*args\.studio_id\}\)/.test(mainSrc));
ok("captureShots is the only screen_capture caller", (mainSrc.match(/tryMcp\("screen_capture"/g) || []).length === 1);
ok("recent captures are remembered", mainSrc.includes("function rememberImages(") && mainSrc.includes("A.recentImages.length > 8"));
ok("image payloads become reusable blobs", mainSrc.includes("function imageToBlob(") && mainSrc.includes("function imageToPngBlob("));
ok("clipboard write is guarded and reported", mainSrc.includes("function copyImageToClipboard(") && mainSrc.includes("ClipboardItem"));
ok("attach_feedback is dispatched", mainSrc.includes('name === "attach_feedback"'));
ok("no public OR-prefixed tools remain", !/\bor_(?:status|debug|agent|screenshot|attach|screen_shot)\b/.test(mainSrc + "\n" + cfgSrc));
ok("synerixcode attach alias routes", mainSrc.includes('synerixcode_attach: "attach_feedback"') && !cfgSrc.includes("synerixcode_attach"));
for (const alias of ["attach_image", "attach_file", "attach_screenshot", "attach_last_screenshot", "attach_recent_image", "copy_screenshot", "paste_screenshot", "synerixcode_attach"]) {
  ok("attach alias " + alias + " routed", mainSrc.includes(`${alias}: "attach_feedback"`));
}
ok("attach_feedback reads workspace files through the bridge", mainSrc.includes('type: "local_read_base64"'));
ok("attach_feedback stages into the composer via the provider", mainSrc.includes("P.attachImages([img])"));
ok("attach_feedback can attach without attaching (copy only)", mainSrc.includes("args.copy !== false"));
ok("attach_feedback refuses on non-vision sites", /attach_feedback[\s\S]{0,600}supportsVision/.test(mainSrc));
ok("capture results are recorded for later re-sends", (mainSrc.match(/rememberImages\(r\.images, name\)/g) || []).length === 2);
ok("the popup offers Copy + Use as feedback", mainSrc.includes('"Copy image"') && mainSrc.includes("Use as feedback"));
ok("the popup can re-attach by hand", mainSrc.includes("A.pendingImages = images.slice()"));
ok("attach_feedback is featured in the tool list", mainSrc.includes("attach_feedback {index?, path?, source?, copy?, paste?, send?}"));

// ── 7. background.js runs for real: web stack behaviour ──────────────────────
function httpResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] || null },
    text: async () => String(body),
    json: async () => JSON.parse(String(body)),
  };
}

function makeWorker(fetchImpl, bridgeImpl) {
  const listeners = {};
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = String(url); this.readyState = 1; this.sent = []; sockets.push(this); }
    send(txt) { this.sent.push(JSON.parse(txt)); }
    close() { this.readyState = 3; }
    addEventListener() {}
  }
  FakeWS.CONNECTING = 0;
  FakeWS.OPEN = 1;
  FakeWS.CLOSING = 2;
  FakeWS.CLOSED = 3;
  const chromeStub = {
    storage: {
      local: { get: (_k, cb) => { if (typeof cb === "function") cb({}); return Promise.resolve({}); }, set: () => Promise.resolve(), remove: () => Promise.resolve() },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn) => { listeners.onMessage = fn; } },
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      getURL: (p) => "chrome-extension://test/" + p,
      getPlatformInfo: () => Promise.resolve({ os: "win", arch: "x86-64" }),
      sendMessage: () => Promise.resolve(),
      lastError: null,
    },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: "https://example.test/", windowId: 1 }]),
      sendMessage: () => Promise.resolve(),
      captureVisibleTab: (_a, b, c) => {
        const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
        const cb = typeof b === "function" ? b : c;
        if (typeof cb === "function") { cb(url); return; }
        return Promise.resolve(url);
      },
    },
  };
  const sandbox = {
    chrome: chromeStub,
    crypto: require('node:crypto').webcrypto,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    fetch: async (url, opts) => {
      if (String(url).includes("127.0.0.1:3000/api/pair")) {
        return httpResponse(200, JSON.stringify({ key: "a".repeat(64) }), { "content-type": "application/json" });
      }
      const impl = fetchImpl || (async () => { throw new Error("network disabled in tests"); });
      return impl(url, opts);
    },
    WebSocket: FakeWS,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    URL, AbortController, TextDecoder, TextEncoder, atob, btoa, navigator: { userAgent: "node" },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(bgSrc, ctx, { filename: "background.js" });
  if (bridgeImpl) ctx.sendLocalEngine = bridgeImpl;
  return { ctx, listeners, sockets };
}

const ask = (listeners, msg) => new Promise((resolve) => {
  const done = (r) => resolve(r);
  listeners.onMessage(msg, {}, done);
  setTimeout(() => resolve({ ok: false, error: "__timeout__" }), 4000);
});

const DDG_HTML = `<html><body>
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcreate.roblox.com%2Fdocs%2Freference%2Fengine%2Fpart&amp;rut=abc">Part | Roblox Creator Documentation</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdevforum.roblox.com%2Ft%2Fparts-guide%2F123">Parts guide - DevForum</a>
</body></html>`;
const MOJEEK_HTML = `<html><body><ul>
<li><h2><a class="ob" href="https://lua.org/manual/5.1/">Lua 5.1 Reference Manual</a></h2></li>
</ul></body></html>`;
const WIKI_JSON = JSON.stringify({ query: { search: [{ title: "Roblox" }, { title: "Lua (programming language)" }] } });

(async () => {
  // 7a. web_search: first backend answers.
  {
    const seen = [];
    const headers = [];
    const { listeners } = makeWorker(async (url, opts) => {
      seen.push(String(url));
      headers.push((opts && opts.headers) || {});
      if (String(url).includes("html.duckduckgo.com")) return httpResponse(200, DDG_HTML, { "content-type": "text/html" });
      return httpResponse(500, "nope");
    });
    const r = await ask(listeners, { type: "web_search", query: "roblox part", limit: 3 });
    {
      const i = seen.findIndex((u) => u.includes("duckduckgo.com"));
      ok("web_search identifies as a browser and sends a Referer",
        i >= 0 && /Chrome\/128/.test(headers[i]["User-Agent"] || "") && /duckduckgo/.test(headers[i].Referer || ""),
        JSON.stringify(headers[i] || {}));
    }
    ok("web_search succeeds on the first backend", r.ok === true && r.backend === "duckduckgo", JSON.stringify(r).slice(0, 200));
    ok("web_search unwraps DDG redirect URLs", r.ok && r.results[0].url === "https://create.roblox.com/docs/reference/engine/part", r.ok ? r.results[0].url : "");
    ok("web_search decodes &amp; in titles", r.ok && /Roblox Creator Documentation/.test(r.results[0].title));
    ok("web_search returns both hits", r.ok && r.results.length === 2);
    ok("web_search hits exactly one backend when it succeeds", seen.filter((u) => !u.includes("127.0.0.1")).length === 1, seen.join(","));
    ok("web_search header says which backend answered", r.ok && /Searched "roblox part" \[duckduckgo\]/.test(r.text));
  }

  // 7b. web_search: first backend blocked → lite blocked → mojeek answers, with notes.
  {
    const { listeners } = makeWorker(async (url) => {
      const u = String(url);
      if (u.includes("html.duckduckgo.com")) return httpResponse(403, "blocked");
      if (u.includes("lite.duckduckgo.com")) return httpResponse(200, "<html><body>If this error persists, please let us know (anomaly)</body></html>");
      if (u.includes("mojeek.com")) return httpResponse(200, MOJEEK_HTML, { "content-type": "text/html" });
      return httpResponse(500, "nope");
    });
    const r = await ask(listeners, { type: "web_search", query: "lua manual" });
    ok("web_search falls through to mojeek", r.ok === true && r.backend === "mojeek", JSON.stringify(r).slice(0, 220));
    ok("web_search parses mojeek markup", r.ok && r.results[0].url === "https://lua.org/manual/5.1/");
    ok("web_search names the 403 backend", r.ok && r.notes.some((n) => /duckduckgo: HTTP 403/.test(n)), JSON.stringify(r.notes));
    ok("web_search flags a bot-challenge page", r.ok && r.notes.some((n) => /bot challenge/.test(n)), JSON.stringify(r.notes));
  }

  // 7c. web_search: only Wikipedia answers (JSON API, not scraped).
  {
    const { listeners } = makeWorker(async (url) => {
      const u = String(url);
      if (u.includes("wikipedia.org")) return httpResponse(200, WIKI_JSON, { "content-type": "application/json" });
      return httpResponse(429, "slow down");
    });
    const r = await ask(listeners, { type: "web_search", query: "roblox" });
    ok("web_search falls back to the wikipedia API", r.ok === true && r.backend === "wikipedia", JSON.stringify(r).slice(0, 200));
    ok("wikipedia hits get real article URLs", r.ok && r.results[0].url === "https://en.wikipedia.org/wiki/Roblox");
  }

  // 7d. web_search: everything fails → the error explains each backend.
  {
    const { listeners } = makeWorker(async () => { throw new Error("net::ERR_NAME_NOT_RESOLVED"); });
    const r = await ask(listeners, { type: "web_search", query: "nothing works" });
    ok("web_search fails loudly", r.ok === false);
    ok("web_search error names all four backends",
      ["duckduckgo", "ddg-lite", "mojeek", "wikipedia"].every((b) => String(r.error).includes(b)), r.error);
    ok("web_search error quotes the real reason", /ERR_NAME_NOT_RESOLVED/.test(r.error));
    ok("web_search error says what was tried", /tried /.test(r.error) && /duckduckgo: /.test(r.error), r.error);
  }

  // 7e. web_search: empty query is rejected before any network call.
  {
    let calls = 0;
    const { listeners } = makeWorker(async (url) => { if (!String(url).includes("127.0.0.1")) calls++; return httpResponse(200, ""); });
    const r = await ask(listeners, { type: "web_search", query: "   " });
    ok("web_search rejects an empty query", r.ok === false && calls === 0, r.error);
  }

  // 7f. web_fetch: reads a page and strips scripts/styles to text.
  {
    const filler = "This paragraph exists so the page is longer than a JavaScript shell and is read directly. ".repeat(6);
    const { listeners } = makeWorker(async (url) => httpResponse(200,
      "<html><head><style>body{color:red}</style><script>var secret=1;</script></head><body><h1>Hello</h1><p>World &amp; friends</p><p>" + filler + "</p></body></html>",
      { "content-type": "text/html; charset=utf-8" }));
    const r = await ask(listeners, { type: "web_fetch", url: "https://example.test/doc" });
    ok("web_fetch succeeds", r.ok === true, JSON.stringify(r).slice(0, 160));
    ok("web_fetch keeps the text", r.ok && r.text.includes("Hello") && r.text.includes("World & friends"));
    ok("web_fetch strips scripts and styles", r.ok && !r.text.includes("secret") && !r.text.includes("color:red"));
    ok("web_fetch reports how it got the page", r.ok && r.via === "direct" && r.status === 200);
    ok("web_fetch does not send a short but complete page to the reader", r.ok && !/rendering proxy/.test(r.text));
  }

  // 7g. web_fetch: a JavaScript-only shell is re-read through the reader proxy.
  {
    const urls = [];
    const { listeners } = makeWorker(async (url) => {
      urls.push(String(url));
      if (String(url).startsWith("https://r.jina.ai/")) return httpResponse(200, "Title: Real Page\n\nMarkdown body with the actual documentation text, long enough to be useful to a model that needs the content of this page. ".repeat(3));
      return httpResponse(200, "<html><body>Please enable JavaScript to view this page.</body></html>", { "content-type": "text/html" });
    });
    const r = await ask(listeners, { type: "web_fetch", url: "https://spa.test/app" });
    ok("web_fetch retries a JS shell via the reader", r.ok === true && r.via === "reader", JSON.stringify(r).slice(0, 200));
    ok("web_fetch reader result carries the real text", r.ok && r.text.includes("Markdown body"));
    ok("web_fetch says the layout may be missing", r.ok && /rendering proxy/.test(r.text));
    ok("web_fetch proxies the ORIGINAL url", urls.some((u) => u === "https://r.jina.ai/https://spa.test/app"), urls.join(","));
  }

  // 7h. web_fetch: nothing works → error names both stages.
  {
    const { listeners } = makeWorker(async (url) => {
      if (String(url).startsWith("https://r.jina.ai/")) throw new Error("reader offline");
      return httpResponse(503, "down");
    });
    const r = await ask(listeners, { type: "web_fetch", url: "https://dead.test/" });
    ok("web_fetch fails when both paths fail", r.ok === false);
    ok("web_fetch error names the direct stage", /direct HTTP 503/.test(String(r.error)), r.error);
    ok("web_fetch error names the reader stage", /reader: reader offline/.test(String(r.error)), r.error);
  }

  // 7i. web_fetch: query mode searches first, then fetches the winner.
  {
    const { listeners } = makeWorker(async (url) => {
      const u = String(url);
      if (u.includes("duckduckgo.com")) return httpResponse(200, DDG_HTML, { "content-type": "text/html" });
      return httpResponse(200, "<html><body><p>The docs page body, long enough to be worth reading in full.</p></body></html>", { "content-type": "text/html" });
    });
    const r = await ask(listeners, { type: "web_fetch", query: "roblox part docs" });
    ok("web_fetch query mode works", r.ok === true, JSON.stringify(r).slice(0, 160));
    ok("web_fetch query mode shows the search it ran", r.ok && /Searched "roblox part docs" \[duckduckgo\]/.test(r.text));
    ok("web_fetch query mode fetches the top hit", r.ok && r.url === "https://create.roblox.com/docs/reference/engine/part", r.url);
  }

  // 7j. web_fetch guards.
  {
    const { listeners } = makeWorker(async () => httpResponse(200, "x"));
    ok("web_fetch requires a url or query", (await ask(listeners, { type: "web_fetch" })).ok === false);
    const r = await ask(listeners, { type: "web_fetch", url: "file:///C:/secrets.txt" });
    ok("web_fetch refuses non-http schemes", r.ok === false && /http/.test(r.error), r.error);
  }

  // ── 8. read_file_base64 plumbing (what synerixcode_screenshot / attach_feedback use) ─
  {
    const payload = { path: "C:/Users/Chris/synerixcodeWorkspace/synerixcode_blender_shot.png", mimeType: "image/png", bytes: 68, data: "iVBORw0KGgoAAAANSUhEUg==" };
    let asked = null;
    const { listeners } = makeWorker(async () => ({}), async (obj) => { asked = obj; return { ok: true, text: JSON.stringify(payload) }; });
    const r = await ask(listeners, { type: "local_read_base64", path: payload.path });
    ok("local_read_base64 returns the base64 payload", r.ok === true && r.data === payload.data, JSON.stringify(r).slice(0, 160));
    ok("local_read_base64 passes the path through", r.path === payload.path);
    ok("local_read_base64 reports the mime type", r.mimeType === "image/png");
    ok("local_read_base64 calls the bridge tool", asked && asked.type === "call_tool" && asked.name === "read_file_base64" && asked.arguments.path === payload.path,
      JSON.stringify(asked));
  }
  {
    const { listeners } = makeWorker(async () => ({}), async () => ({ ok: false, error: "no such file: synerixcode_blender_shot.png" }));
    const r = await ask(listeners, { type: "local_read_base64", path: "synerixcode_blender_shot.png" });
    ok("local_read_base64 surfaces bridge errors", r.ok === false && /no such file/.test(r.error), r.error);
  }
  {
    const { listeners } = makeWorker(async () => ({}), async () => ({ ok: true, text: "this is not json" }));
    const r = await ask(listeners, { type: "local_read_base64", path: "x.png" });
    ok("local_read_base64 rejects a non-JSON answer", r.ok === false && /no file data/.test(r.error), r.error);
  }
  {
    const { listeners } = makeWorker(async () => ({}), async () => ({ ok: true, text: JSON.stringify({ path: "x.png", mimeType: "image/png", bytes: 0, data: "" }) }));
    const r = await ask(listeners, { type: "local_read_base64", path: "x.png" });
    ok("local_read_base64 treats empty data as a failure", r.ok === false, JSON.stringify(r));
  }

  // ── 9. capture_tab (the tab target of synerixcode_screenshot / attach_feedback) ─────
  {
    const { listeners } = makeWorker(async () => ({}));
    const r = await ask(listeners, { type: "capture_tab" });
    ok("capture_tab returns an image block", r.ok === true && Array.isArray(r.images) && r.images.length === 1, JSON.stringify(r).slice(0, 160));
    ok("capture_tab tags the mime type", r.ok && r.images[0].mimeType === "image/png");
  }

  // ── 11. A Studio screenshot must survive the whole bridge round trip ────────
  // This is the P0 bug: McpRuntime::call_tool used to return only the TEXT
  // blocks, so screen_capture came back as an empty string with no images and
  // the prompt still claimed an image was attached. The Rust side now returns
  // McpOutput{text, images} and the frame carries "images" — the JS must keep it.
  {
    const { ctx, listeners, sockets } = makeWorker(async () => ({}));
    await new Promise((r) => setTimeout(r, 0));
    const sock = sockets[sockets.length - 1];
    ok("the worker dials the bridge on startup", !!sock && /^ws:\/\/127\.0\.0\.1:\d+$/.test(sock.url), sock && sock.url);
    sock.onopen();
    const pending = ask(listeners, { type: "call_tool", name: "screen_capture", arguments: { area: "full" }, timeout: 45000 });
    await new Promise((r) => setTimeout(r, 60));
    const frame = sock.sent.find((f) => f.type === "call_tool");
    ok("call_tool is forwarded to the bridge", !!frame && frame.name === "screen_capture", JSON.stringify(sock.sent));
    ok("call_tool keeps its arguments", frame && frame.arguments && frame.arguments.area === "full");
    ok("call_tool carries a numeric id", frame && typeof frame.id === "number");
    sock.onmessage({ data: JSON.stringify({ type: "tool_result", id: frame.id, ok: true, text: "Captured the Studio viewport.",
      images: [{ mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" }] }) });
    const r = await pending;
    ok("Studio screenshot images reach the content script", r.ok === true && Array.isArray(r.images) && r.images.length === 1, JSON.stringify(r).slice(0, 200));
    ok("the image keeps its mime type and bytes", r.images && r.images[0].mimeType === "image/png" && /^iVBOR/.test(r.images[0].data));
    ok("the capture text comes through too", r.text === "Captured the Studio viewport.");
  }
  {
    // Same call, text-only answer: no phantom image may be invented.
    const { listeners, sockets } = makeWorker(async () => ({}));
    await new Promise((r) => setTimeout(r, 0));
    sockets[sockets.length - 1].onopen();
    await new Promise((r) => setTimeout(r, 0));
    const sock = sockets[sockets.length - 1];
    const pending = ask(listeners, { type: "call_tool", name: "execute_luau", arguments: {} });
    await new Promise((r) => setTimeout(r, 60));
    const frame = sock.sent.find((f) => f.type === "call_tool");
    sock.onmessage({ data: JSON.stringify({ type: "tool_result", id: frame.id, ok: true, text: "returned fine" }) });
    const r = await pending;
    ok("a text-only result has an empty image list", r.ok === true && Array.isArray(r.images) && r.images.length === 0, JSON.stringify(r));
    ok("a text-only result keeps its text", r.text === "returned fine");
  }
  {
    const { listeners, sockets } = makeWorker(async () => ({}));
    await new Promise((r) => setTimeout(r, 0));
    sockets[sockets.length - 1].onopen();
    await new Promise((r) => setTimeout(r, 0));
    const sock = sockets[sockets.length - 1];
    const pending = ask(listeners, { type: "call_tool", name: "execute_luau", arguments: {} });
    await new Promise((r) => setTimeout(r, 60));
    const frame = sock.sent.find((f) => f.type === "call_tool");
    sock.onmessage({ data: JSON.stringify({ type: "tool_result", id: frame.id, ok: false, kind: "execution", error: "stack traceback" }) });
    const r = await pending;
    ok("a failed tool result stays a failure", r.ok === false && /stack traceback/.test(r.error), JSON.stringify(r));
  }

  // ── 12. The MV3 CSP must let the service worker REACH the web ───────────────
  // This is why web_fetch/web_search "just didn't work" for so long: fetch() ran
  // fine in code but the extension's own connect-src only allowed 'self',
  // 127.0.0.1 and ollama.com - so every scrape was refused by CSP ("Refused to
  // connect to ... because it violates ... connect-src") and the old catch
  // swallowed it into a bare "no results". host_permissions do NOT lift CSP.
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const csp = (manifest.content_security_policy && manifest.content_security_policy.extension_pages) || "";
    const connect = (csp.split("connect-src")[1] || "").split(";")[0];
    ok("manifest is MV3", manifest.manifest_version === 3);
    ok("CSP allows https fetches from the worker", /https:\/\/\*/.test(connect), connect.trim());
    ok("CSP allows plain-http fetches too", /http:\/\/\*/.test(connect), connect.trim());
    ok("CSP still allows the local bridges", /ws:\/\/127\.0\.0\.1:\*/.test(connect) && /http:\/\/127\.0\.0\.1:\*/.test(connect));
    ok("CSP keeps ollama reachable", /ollama\.com/.test(connect));
    ok("CSP does not open script-src to the world", !/script-src[^;]*https?:\/\//.test(csp));
    ok("host permissions cover https", manifest.host_permissions.includes("https://*/*"));
    ok("host permissions cover http", manifest.host_permissions.includes("http://*/*"));
    ok("popup title matches the version", manifest.action.default_title.includes(manifest.version_name || manifest.version));
  }

  // ── 13. DeepSeek vision detection on the 2026-09 UNIFIED model ─────────────
  // DeepSeek merged Instant/Expert/Vision into one model and deleted the picker.
  // synerixcode's detector used to fall through to `false` with no radio and no badge, so
  // every DeepSeek chat refused screenshots ("this assistant cannot see images").
  // These cases execute the real provider with a fake DOM.
  {
    const dsSrc = fs.readFileSync(path.join(root, "providers/deepseek.js"), "utf8");
    const loadProvider = (doc) => {
      const sandbox = { window: {}, document: doc, console: { log: () => {}, warn: () => {}, error: () => {} },
        location: { pathname: "/" }, navigator: { userAgent: "node" }, setTimeout, clearTimeout,
        MouseEvent: class {}, Event: class {}, KeyboardEvent: class {}, ClipboardEvent: class {},
        DataTransfer: class { constructor() { this.items = { add() {}, length: 0 }; this.files = []; } },
        File: class {}, Blob: class {}, atob, btoa, getComputedStyle: () => ({ getPropertyValue: () => "" }),
        Node: class {}, MutationObserver: class { observe() {} disconnect() {} } };
      sandbox.globalThis = sandbox; sandbox.self = sandbox;
      const ctx = vm.createContext(sandbox);
      return vm.runInContext(dsSrc + "\n;RSProvider;", ctx, { filename: "providers/deepseek.js" });
    };
    const badge = (text) => ({ childElementCount: 0, textContent: text, getBoundingClientRect: () => ({ width: 40, top: 8, left: 0 }) });
    const radio = (type, on, text) => ({
      childElementCount: 0, textContent: text || type,
      getAttribute: (n) => (n === "data-model-type" ? type : n === "aria-checked" ? String(on) : null),
      getBoundingClientRect: () => ({ width: 60, top: 20, left: 0 }),
    });
    const docFor = ({ group, radios = [], badges = [] }) => ({
      querySelector: (sel) => (sel === '[role="radiogroup"]' ? (group || null) : null),
      querySelectorAll: (sel) => (sel === "div,span" ? badges : sel === '[role="radio"]' ? radios : []),
      documentElement: { setAttribute() {} },
      body: { appendChild() {} },
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      getElementById: () => null,
    });

    {
      // The unified composer: no radiogroup, no Instant/Expert/Vision badge.
      const P = loadProvider(docFor({ badges: [] }));
      ok("no picker + no badge ⇒ images allowed (unified model)", P.supportsVision === true);
    }
    {
      // A conversation pinned to the OLD UI: badge says Expert → still text-only.
      const P = loadProvider(docFor({ badges: [badge("Expert")] }));
      ok("legacy Expert badge ⇒ images refused", P.supportsVision === false);
      const P2 = loadProvider(docFor({ badges: [badge("Instant")] }));
      ok("legacy Instant badge ⇒ images refused", P2.supportsVision === false);
    }
    {
      // A conversation still marked Vision → images allowed.
      const P = loadProvider(docFor({ badges: [badge("Vision")] }));
      ok("legacy Vision badge ⇒ images allowed", P.supportsVision === true);
    }
    {
      // Legacy picker still on screen: the radio is authoritative, both ways.
      const on = loadProvider(docFor({ group: { querySelectorAll: () => [radio("vision", true)] } }));
      ok("legacy Vision radio checked ⇒ images allowed", on.supportsVision === true);
      const off = loadProvider(docFor({ group: { querySelectorAll: () => [radio("expert", true), radio("vision", false)] } }));
      ok("legacy Vision radio unchecked ⇒ images refused", off.supportsVision === false);
    }
    {
      // A badge scan must not be fooled by unrelated labels ("V4.1 Flash" with
      // the word inside a longer string is not a model badge).
      const P = loadProvider(docFor({ badges: [badge("V4.1 Flash")] }));
      ok("a longer model label is not mistaken for a legacy badge", P.supportsVision === true);
    }
    ok("detector documents the unification", /unified model|2026-09/.test(dsSrc) && /return \(_visCache = true\)/.test(dsSrc));
    ok("session start no longer waits for a deleted picker", /legacyPicker/.test(dsSrc) && /unified: !legacyPicker/.test(dsSrc));
  }

  // ── 14. Qwen's per-model detector must not repeat the DeepSeek trap ───────
  // Qwen really does have text-only models, so its detector is allowed to say no
  // - but only from EVIDENCE (a known model). An unreadable selector (hashed
  // class churn) or a brand-new model must never read as "no vision": that is
  // exactly how DeepSeek's removed picker broke every chat.
  {
    const qwenSrc = fs.readFileSync(path.join(root, "providers/qwen.js"), "utf8");
    const load = (doc) => {
      const store = {};
      const sandbox = {
        window: {}, document: doc, console: { log: () => {}, warn: () => {}, error: () => {} },
        location: { pathname: "/", href: "https://chat.qwen.ai/" }, navigator: { userAgent: "node" },
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        MouseEvent: class {}, Event: class {}, KeyboardEvent: class {}, ClipboardEvent: class {},
        MutationObserver: class { observe() {} disconnect() {} },
        DataTransfer: class { constructor() { this.items = { add() {}, length: 0 }; this.files = []; } },
        File: class {}, Blob: class {}, atob, btoa, getComputedStyle: () => ({ getPropertyValue: () => "" }),
        Node: class {}, requestAnimationFrame: () => 1, fetch: async () => ({ ok: false }),
      };
      sandbox.globalThis = sandbox; sandbox.self = sandbox;
      // qwen.js reaches into window.HTMLTextAreaElement.prototype for the native
      // value setter - provide a minimal element surface on BOTH the global and
      // the window object it actually reads.
      sandbox.HTMLTextAreaElement = sandbox.window.HTMLTextAreaElement = class {};
      sandbox.HTMLInputElement = sandbox.window.HTMLInputElement = class {};
      const ctx = vm.createContext(sandbox);
      return vm.runInContext(qwenSrc + "\n;RSProvider;", ctx, { filename: "providers/qwen.js" });
    };
    const doc = (modelName) => ({
      querySelector: (sel) => (sel.includes("model-selector-text")
        ? (modelName == null ? null : { textContent: modelName }) : null),
      querySelectorAll: () => [],
      documentElement: { setAttribute() {} },
      body: { appendChild() {}, addEventListener() {} },
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
      getElementById: () => null, addEventListener() {},
    });
    ok("qwen: unreadable selector ⇒ images ALLOWED", load(doc(null)).supportsVision === true);
    ok("qwen: brand-new model ⇒ images ALLOWED", load(doc("Qwen3.9-Ultra")).supportsVision === true);
    ok("qwen: known multimodal model ⇒ allowed", load(doc("Qwen3.6-Plus")).supportsVision === true);
    ok("qwen: known text-only model ⇒ refused", load(doc("Qwen3.7-Max")).supportsVision === false);
    ok("qwen keeps the honest text-only path", /no vision|text-only/.test(qwenSrc) && qwenSrc.includes("visionFromDesc"));
    ok("qwen logs an unreadable selector instead of hiding it", qwenSrc.includes("model.selector_unreadable"));
  }

  // ── 15. No shipped code may depend on a REMOVED model picker ──────────────
  // Guard against re-introducing this whole bug class: user-facing copy must not
  // tell anyone to open a model tab/switch models to get images (DeepSeek deleted
  // them on 2026-09-10), and no shipped file may gate images on a picker being
  // present. String literals are extracted so comments may still discuss history.
  {
    const shipped = fs.readdirSync(root).filter((f) => f.endsWith(".js") && !f.startsWith("test-"))
      .map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]);
    for (const d of ["core", "providers"]) {
      for (const f of fs.readdirSync(path.join(root, d))) {
        if (f.endsWith(".js")) shipped.push([d + "/" + f, fs.readFileSync(path.join(root, d, f), "utf8")]);
      }
    }
    const literals = [];
    for (const [file, src] of shipped) {
      const re = /"((?:[^"\\\n]|\\.){0,240})"|'((?:[^'\\\n]|\\.){0,240})'|`((?:[^`\\\n]|\\.){0,240})`/g;
      let m;
      while ((m = re.exec(src)) !== null) literals.push([file, m[1] || m[2] || m[3]]);
    }
    const offenders = literals.filter(([, text]) =>
      /(?:vision|expert|instant|flash)\s+(?:tab|model|mode)|(?:tab|model|mode)\s+(?:to\s+)?(?:vision|expert|flash)/i.test(text) &&
      !/image-blind|unified|text-only|model_|supportsVision|modeRadio|enforceComposer|visionFromDesc/i.test(text));
    ok("no user-facing copy tells the user to switch to a Vision/Expert/Flash tab",
      offenders.length === 0, offenders.map(([f, t]) => f + ": " + t.slice(0, 60)).join(" | "));
    const dsSrc2 = fs.readFileSync(path.join(root, "providers/deepseek.js"), "utf8");
    ok("deepseek vision never falls back to false", !/_visLatchSet|_visLatch\b/.test(dsSrc2));
    ok("deepseek readiness tolerates having no picker", /legacyPicker/.test(dsSrc2));
  }

  // ── 10. No stale code paths left behind ────────────────────────────────────
  ok("old ddgSearch helper is gone", !bgSrc.includes("ddgSearch"));
  ok("the fetching User-Agent is a real browser UA", /const BROWSER_UA =[\s\S]{0,200}Chrome\/128/.test(bgSrc) && !/"User-Agent":\s*"synerixcode/.test(bgSrc));
  ok("no leftover HTML-lite-only scraping", !bgSrc.includes("result__snippet"));
  ok("blender bridge shim port still banned", !bgSrc.includes("17617"));
  ok("bg never references launch_blender_mcp.py", !bgSrc.includes("launch_blender_mcp.py"));

  console.log("\n" + (failed ? failed + " FAILED" : "all v1.18 checks passed"));
  process.exit(failed ? 1 : 0);
})();
