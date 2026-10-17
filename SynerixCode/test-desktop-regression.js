const fs = require("fs");
const crypto = require("crypto");

const baseline = {
  "core/agent_skills.js": "86e63d2ecefeafd586744411650cb446c0db2a5f",
  "core/animlib.js": "420ea8eb69637b27ca9856b974d44181e57d3420",
  "core/config.js": "54e14472bb723ed02c949c2a3db2c8aad26ce6f8",
  "core/headless-builder.js": "b343a897a17fc05d79ab469aeea55c8abaa8c4e5",
  "core/luau-knowledge.js": "234c1ca2155d3ef5f38927d85893b70fd6bde6e6",
  "core/main.js": "fc0e706318eb3e530f738be2269121a2d6c2fd83",
  "core/motion-interchange.js": "038afa13a5b59c030a809abf7d617a36f2fae82d",
  "core/motion-preview.js": "ae0ab0526fbc762dfbf7cae9c248239e217e7a2f",
  "core/motion-tools.js": "8ac81b4a4a9f634fef9285aeee06db4a15af578e",
  "core/parser.js": "0c07fb4907aaa4550b04af6a5ca15def24212955",
  "core/studio_daily.js": "56632a6bd1a81ddeded243ff9d740e4b75a4fa34",
  "core/studio_gui.js": "726793b63c24b3fd128be60e6f3fb98e60a19243",
  "core/studio_plus.js": "c149c47cc7d178e3aa87f39539cc3c1420bff065",
  "core/studio_skills.js": "3f549ef8b67a4a646b0a3d3219ecf38b0839e09e",
  "providers/arena.js": "7472973533a67ab200dbe0a60db61636cc8fbdde",
  "providers/chatgpt-cm.js": "c83bc0702be0d75590155cff61c36ee0340a17c1",
  "providers/chatgpt.js": "07f594935092235a89183ff8dfe1a9d671305194",
  "providers/claude.js": "5994de93ea8f560ac040ccc370d383c2c99fecc9",
  "providers/copilot.js": "2f0bd280402a94578a249baa7731b235a3d8a712",
  "providers/crax-net.js": "a3c1bfb62a62594a2d6eef3615f66d4aa53b9157",
  "providers/crax.js": "501518b20c4b609d8230181eab1ddb6c77e5e852",
  "providers/deepseek.js": "6e7901e32f9186afd6b7ca9f93f526424b3cff2c",
  "providers/freebuff.js": "4642a361b9f80753f265fc6818b743454b6e1063",
  "providers/gemini.js": "c7882ad7133928cdeacb6d3026ce0fd203c61460",
  "providers/glm.js": "5791b81c089f12ac0022654569d7920bbf0412c5",
  "providers/kimi.js": "e38ebb381e0ca54ed57866b63e1a864e14f61f26",
  "providers/meta.js": "84f3c1fb4f144685bd404b86bad9588e52fc8985",
  "providers/notion.js": "2155eab0a66f03794f8a6b964422be06e8dd62b8",
  "providers/oxalpha.js": "bb167464f4c2360ea05849eeac0bc6b24752b929",
  "providers/qwen-net.js": "6073141989f67e4ad2dd57444af6f55e48ff0b71",
  "providers/qwen.js": "9c7ae960fb3942e8ce6f1712126af7645eb896b4",
  "providers/useai.js": "c34cd22f3dda940d98e5c1fe12050cb464855815"
};
const requiredProviders = [
  "providers/clickup.js",
  "providers/deepseek.js",
  "providers/chatgpt.js",
  "providers/claude.js",
  "providers/gemini.js",
  "providers/kimi.js",
  "providers/glm.js",
  "providers/qwen.js",
  "providers/arena.js",
  "providers/freebuff.js",
  "providers/crax.js",
  "providers/useai.js",
  "providers/oxalpha.js",
  "providers/notion.js"
];

function gitBlobSha(path) {
  const body = Buffer.from(fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
  const header = Buffer.from("blob " + body.length + "\0");
  return crypto.createHash("sha1").update(header).update(body).digest("hex");
}

for (const [path, expected] of Object.entries(baseline)) {
  if (!fs.existsSync(path)) throw new Error("Protected synerixcode file missing: " + path);
  const actual = gitBlobSha(path);
  if (actual !== expected) throw new Error("Protected synerixcode file changed: " + path + "\nexpected " + expected + "\nactual   " + actual);
}

for (const path of requiredProviders) {
  if (!fs.existsSync(path)) throw new Error("Supported provider missing: " + path);
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
if (manifest.version !== "1.0.0") throw new Error("Expected extension version 1.0.0");

const cargoToml = fs.readFileSync("agent/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
if (!cargoVersion) throw new Error("Could not read desktop package version from agent/Cargo.toml");
if (cargoVersion !== "1.0.0") throw new Error("Unexpected desktop version: " + cargoVersion);
// Provider DOM hardening is intentional and covered by differential and preservation suites.
// Intentional core/main integration is covered by creator/skills regression tests.
// Other core baselines remain protected; native and extension versions match.

const desktopHtml = fs.readFileSync("agent/src/desktop.html", "utf8");
for (const token of [
  'data-page="home"',
  'data-page="tools"',
  'data-page="mcp"',
  'data-page="terminal"',
  'data-page="settings"',
  "/api/desktop/state",
  "/api/desktop/preferences",
  "/api/desktop/restart",
  "/api/desktop/clear-logs",
  "window.ipc.postMessage",
  "Your workspace.",
  'class="hero-name">Choose your <span>AI.</span>'
]) {
  if (!desktopHtml.includes(token)) throw new Error("Desktop WebView contract missing: " + token);
}
for (const forbidden of [
  'data-page="chat"',
  "BUILD MORE",
  "CODE SMARTER",
  "AI-powered development companion",
  "development control center",
  "swatch-night.jpg",
  "mountain"
]) {
  if (desktopHtml.includes(forbidden)) throw new Error("Removed desktop UI content returned: " + forbidden);
}
for (const removed of ['Model Builder','UI Creator','modelWorkspace','uiWorkspace','synerixcodeCreatorUI','Mountbuilder','__SYNERIXCODE_CREATOR','__SYNERIXCODE_HEADLESS']) if (desktopHtml.includes(removed)) throw Error('Removed desktop creator leaked: '+removed);
// Approved localization guards/hooks; behavioral Toolkit/Notifications fixtures remain.
const toolkit=fs.readFileSync('core/toolkit-ui.js','utf8');if(crypto.createHash('sha256').update(toolkit.replace(/\r\n/g,'\n')).digest('hex')!=='75e54f096a1682f5fc545c6b69e3e52bfbb60fc7aabd4a966c3e04e7744f1320')throw Error('Toolkit localization baseline changed');
const desktopScript = desktopHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]?.replace("__SYNERIXCODE_I18N_CATALOG__", "").replace("__SYNERIXCODE_I18N__", "").replace("__SYNERIXCODE_SKILLS_UI__", fs.readFileSync("core/skills-ui.js", "utf8")).replace("__SYNERIXCODE_EXPLORER_UI__", fs.readFileSync("core/explorer-ui.js", "utf8")).replace("__SYNERIXCODE_TOOLKIT_UI__", fs.readFileSync("core/toolkit-ui.js", "utf8")).replace("__SYNERIXCODE_TEMPLATE_UI__", fs.readFileSync("core/templates.js", "utf8")).replace("__SYNERIXCODE_TASK_UI__", fs.readFileSync("core/task-center.js", "utf8")).replace("__SYNERIXCODE_MEDIA_UI__", fs.readFileSync("core/media.js", "utf8")).replace("__SYNERIXCODE_MEMORY_UI__", fs.readFileSync("core/memory.js", "utf8")).replace("__SYNERIXCODE_VERSION_UI__", fs.readFileSync("core/version.js", "utf8")).replace(/__SYNERIXCODE_VERSION__/g, "1.19.33");
if (!desktopScript) throw new Error("Desktop WebView script block missing");
new Function(desktopScript);

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }
  add(name) { this.values.add(name); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) this.values.delete(name);
      else this.values.add(name);
      return this.values.has(name);
    }
    if (force) this.values.add(name);
    else this.values.delete(name);
    return !!force;
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(id = "", attrs = {}, classes = []) {
    this.id = id;
    this.attrs = { ...attrs };
    this.classList = new FakeClassList(classes);
    this.listeners = {};
    this.style = { setProperty(name,value) { this[name]=value; } };
    this.dataset = {};
    this.children = [];
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.onclick = null;
  }
  querySelector(selector) { this.queries ||= new Map(); if (!this.queries.has(selector)) this.queries.set(selector, new FakeElement()); return this.queries.get(selector); }
  querySelectorAll() { return []; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs,name); }
  toggleAttribute(name,force) { const enabled=force===undefined?!this.hasAttribute(name):force;if(enabled)this.attrs[name]="";else delete this.attrs[name];return enabled; }
  contains() { return false; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); for(const child of children) if(child&&typeof child==='object')child.parentElement=this; }
  prepend(...children) { this.children.unshift(...children); }
  getContext() { return new Proxy({}, { get: () => () => {} }); }
  appendChild(child) { this.children.push(child); return child; }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  closest() {
    return null;
  }
}

async function runDesktopInteractionRegression() {
  const ids = [...desktopHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const elementsById = new Map(ids.map((id) => [id, new FakeElement(id)]));

  const pages = [...desktopHtml.matchAll(/<section class="([^"]*\bpage\b[^"]*)" id="([^"]+)"/g)].map((m) => {
    const classes = m[1].split(/\s+/).filter(Boolean);
    const el = elementsById.get(m[2]) || new FakeElement(m[2]);
    el.classList = new FakeClassList(classes);
    elementsById.set(m[2], el);
    return el;
  });

  const navButtons = [...desktopHtml.matchAll(/<button class="([^"]*\bnavbtn\b[^"]*)" data-page="([^"]+)"/g)].map((m) => {
    return new FakeElement("", { "data-page": m[2] }, m[1].split(/\s+/).filter(Boolean));
  });

  const goButtons = [...desktopHtml.matchAll(/data-go="([^"]+)"/g)].map((m) => {
    return new FakeElement("", { "data-go": m[1] });
  });

  const ipcButtons = [...desktopHtml.matchAll(/data-ipc="([^"]+)"/g)].map((m) => {
    return new FakeElement("", { "data-ipc": m[1] });
  });

  const selectPrefs = [];
  const togglePrefs = [];
  const dynamicFilters = [];
  const dynamicMcp = [];
  const ipcMessages = [];

  const document = {
    readyState: "complete",
    documentElement: new FakeElement("html"),
    createElement() { return new FakeElement(); },
    createDocumentFragment() { return new FakeElement(); },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(selector) {return this.querySelectorAll(selector)[0]||null;},
    querySelectorAll(selector) {
      if (selector === ".page") return pages;
      if (selector === ".navbtn") return navButtons;
      if (selector === "[data-page]") return navButtons;
      if (selector === "[data-go]") return goButtons;
      if (selector === "[data-ipc]") return ipcButtons;
      if (selector === "select[data-pref]") return selectPrefs;
      if (selector === ".toggle[data-pref]") return togglePrefs;
      if (selector === "[data-filter]") return dynamicFilters;
      if (selector === "[data-mcp]") return dynamicMcp;
      return [];
    },
    addEventListener() {}
  };

  const window = {
    localStorage: { values:new Map(),getItem(key){return this.values.get(key)||null;},setItem(key,value){this.values.set(key,value);} },
    ipc: {
      postMessage(message) {
        ipcMessages.push(String(message));
      }
    },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval() {
      return 1;
    }
  };

  const fakeState = {
    bridge_connected: true,
    studio_running: true,
    mcp_alive: true,
    roblox_connected: true,
    workspace_ready: true,
    workspace_root: "C:\\synerixcodeWorkspace",
    tools: [],
    servers: [],
    logs: [],
    fatal: null,
    preferences: {},
    browser_agent: { canCoWork: true, canQueue: true, canStop: true, cowork: { enabled: true, pending: [{ id: 1, preview: "Follow-up task", status: "queued" }] } }
  };

  const fakeUpdate = { installed:"1.19.33",latest:"1.19.33",checked_at:Date.now(),check_error:null,background:false,available:true,busy:false,message:"Update available.",release_notes:[{version:"1.19.33",title:"Release notes",summary:"Exact <text> stays literal",added:["New notes"],improved:["Better layout"],fixed:[]}] };
  function fetch(url, options) {
    if (String(url).includes("/api/desktop/update") && options && options.method === "POST") { fakeUpdate.busy=true; fakeUpdate.message="Downloading update…"; }
    const body = String(url).includes("/api/mcp/catalog")
      ? { servers: [] }
      : String(url).includes("/api/desktop/update") ? fakeUpdate : String(url).includes("/api/memory") ? { automatic: true, entries: [] } : fakeState;
    return Promise.resolve({
      ok: true,
      status: 200,
      json() {
        return Promise.resolve(body);
      }
    });
  }

  const vm = require("vm");
  vm.runInNewContext(desktopScript, {
    document,
    window,
    crypto: require("node:crypto").webcrypto,
    fetch,
    Headers,
    AbortController,
    console,
    Promise,
    Object,
    Array,
    String,
    JSON,
    Error,
    RegExp,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  }, { timeout: 2000 });

  if (!window.synerixcodeDesktop || typeof window.synerixcodeDesktop.go !== "function") {
    throw new Error("Desktop UI bootstrap did not expose synerixcodeDesktop.go");
  }
  if (!ipcMessages.includes("ui-ready")) {
    throw new Error("Desktop UI did not emit ui-ready");
  }

  for (const pageName of ["home", "tools", "mcp", "terminal", "settings", "updates"]) {
    window.synerixcodeDesktop.go(pageName);
    const page = elementsById.get("page-" + pageName);
    if (!page || !page.classList.contains("active")) {
      throw new Error("Desktop navigation failed for page: " + pageName);
    }
    for (const other of pages) {
      if (other !== page && other.classList.contains("active")) {
        throw new Error("Multiple desktop pages active after navigating to: " + pageName);
      }
    }
    const nav = navButtons.find((button) => button.getAttribute("data-page") === pageName);
    if (!nav || !nav.classList.contains("active")) {
      throw new Error("Desktop nav active state failed for page: " + pageName);
    }
  }

  await new Promise(resolve => setTimeout(resolve, 0));
  await window.synerixcodeDesktop.refresh();
  if (elementsById.get("coworkPrompt").placeholder !== "Follow up") throw new Error("Active Co-work placeholder missing");
  if (elementsById.get("homeCowork").getAttribute("aria-pressed") !== "true") throw new Error("Co-work toggle did not sync from browser");
  if (elementsById.get("coworkDialog").hidden) throw new Error("Co-work mode must show the inline chat");
  if (elementsById.get("coworkList").children.length !== 1) throw new Error("Queue preview missing");
  if (elementsById.get("sideStudioStatus").textContent !== "Studio connected") throw new Error("Connected Studio indicator missing");
  if (elementsById.get("studioVal").textContent !== "Connected") throw new Error("Connected Studio card missing");
  // 1.24.17: Studio open with a running helper but an OFFLINE editor link is not "Connected".
  fakeState.roblox_connected = false; await window.synerixcodeDesktop.refresh();
  if (elementsById.get("sideStudioStatus").textContent !== "Studio open · not linked") throw new Error("Studio + helper without the editor link must not say connected");
  if (elementsById.get("studioVal").textContent !== "Open") throw new Error("Unlinked Studio card must say Open");
  fakeState.mcp_alive = false; await window.synerixcodeDesktop.refresh();
  if (elementsById.get("sideStudioStatus").textContent !== "Studio open · not linked") throw new Error("Unlinked Studio indicator missing");
  fakeState.studio_running = false; await window.synerixcodeDesktop.refresh();
  if (elementsById.get("sideStudioStatus").textContent !== "Studio closed") throw new Error("Closed Studio indicator missing");
  if (elementsById.get("studioVal").textContent !== "Offline") throw new Error("Closed Studio card must say Offline");
  fakeState.browser_agent.canStop = false;
  fakeState.browser_agent.cowork.enabled = false;
  fakeState.browser_agent.canQueue = false;
  await window.synerixcodeDesktop.refresh();
  if (!elementsById.get("coworkDialog").hidden) throw new Error("Co-work off must hide its inline chat");
  if (!elementsById.get("queueCowork").disabled) throw new Error("Co-work off must block queue submission");
  if (elementsById.get("coworkPrompt").placeholder !== "Message") throw new Error("Idle placeholder missing");
  fakeState.browser_agent.activity=[{id:'manual-fold-test',label:'Working',done:false}];await window.synerixcodeDesktop.refresh();
  elementsById.get("homeActivity").open=true;
  fakeState.browser_agent.activity[0].done=true;fakeState.browser_agent.activity[0].label='Worked';await window.synerixcodeDesktop.refresh();
  if(!elementsById.get("homeActivity").open)throw new Error("Completion must retain the expanded desktop work panel");
  elementsById.get("homeActivity").open=false;await window.synerixcodeDesktop.refresh();
  if(elementsById.get("homeActivity").open)throw new Error("Polling must retain a manually folded work panel");

  window.synerixcodeDesktop.go("updates"); await new Promise(resolve => setTimeout(resolve, 0));
  if (elementsById.get("installUpdate").disabled) throw new Error("Available update must be installable");
  if (!elementsById.get("sidebarVersion").textContent.includes("(Up to date)")) throw new Error("Current version indicator missing");
  fakeUpdate.latest="1.19.34";window.synerixcodeDesktop.go("updates");await new Promise(resolve=>setTimeout(resolve,0));
  if (!elementsById.get("sidebarVersion").textContent.includes("- Outdated") || elementsById.get("updateInstalled").style.color!=="#ff696c") throw new Error("Outdated version indicator missing");
  fakeUpdate.check_error="Offline";window.synerixcodeDesktop.go("updates");await new Promise(resolve=>setTimeout(resolve,0));
  if (!elementsById.get("titleVersion").textContent.includes("(Check unavailable)")) throw new Error("Unavailable version check must not claim current");
  fakeUpdate.check_error=null;fakeUpdate.latest="1.19.33";fakeUpdate.busy=true;fakeUpdate.background=true;
  window.synerixcodeDesktop.go("updates");await new Promise(resolve=>setTimeout(resolve,0));
  if (!elementsById.get("updateOverlay").hidden) throw new Error("Automatic check must not open update overlay");
  if(elementsById.get("checkUpdates").disabled || elementsById.get("installUpdate").disabled)throw new Error("Automatic checks must keep manual update controls available");
  fakeUpdate.busy=false;fakeUpdate.background=false;window.synerixcodeDesktop.go("updates");await new Promise(resolve=>setTimeout(resolve,0));
  const notes=elementsById.get("updateReleaseNotes").children;
  if (notes.length !== 1 || notes[0].children[0].textContent !== "synerixcode v1.19.33: Release notes" || notes[0].children[1].textContent !== "Exact <text> stays literal") throw new Error("Release note rendering failed");
  const firstNote=notes[0];window.synerixcodeDesktop.go("updates");await new Promise(resolve=>setTimeout(resolve,0));
  if(elementsById.get("updateReleaseNotes").children[0] !== firstNote)throw new Error("Polling reset release expansion");
  elementsById.get("installUpdate").onclick(); await new Promise(resolve => setTimeout(resolve, 0));
  if (elementsById.get("updateOverlay").hidden || !elementsById.get("installUpdate").disabled) throw new Error("Update progress/double-click guard missing");
  fakeUpdate.busy=false; fakeUpdate.error="Download failed";
  window.synerixcodeDesktop.go("updates"); await new Promise(resolve => setTimeout(resolve, 0));
  if (elementsById.get("updateError").textContent !== "Download failed" || elementsById.get("closeUpdateError").hidden) throw new Error("Update error feedback missing");
  elementsById.get("closeUpdateError").onclick();
  if (!elementsById.get("updateOverlay").hidden) throw new Error("Update error overlay did not close");
  for (const target of ["chatgpt","deepseek","claude","github"]) {
    const button=ipcButtons.find(button=>button.getAttribute("data-ipc") === "open:"+target);
    if (!button || typeof button.onclick !== "function") throw new Error("Browser shortcut missing: "+target);
    button.onclick();if (!ipcMessages.includes("open:"+target)) throw new Error("Browser shortcut IPC failed: "+target);
  }
  elementsById.get("desktopTheme").value="cyan";elementsById.get("desktopTheme").onchange();
  if(document.documentElement.dataset.desktopTheme !== "cyan" || document.documentElement.style["--orange"] !== "#27c1e7")throw new Error("Theme palette did not apply");
  elementsById.get("desktopGlow").value="off";elementsById.get("desktopGlow").onchange();
  elementsById.get("desktopGradients").value="off";elementsById.get("desktopGradients").onchange();
  if(JSON.parse(window.localStorage.getItem("synerixcodeDesktopAppearance")).gradients !== "off" || document.documentElement.style["--theme-glow"] !== "0")throw new Error("Appearance selection did not persist");
  elementsById.get("resetAppearance").onclick();if(document.documentElement.dataset.desktopTheme !== "default")throw new Error("Default theme restore failed");
  const minimize = ipcButtons.find((button) => button.getAttribute("data-ipc") === "minimize");
  if (!minimize || typeof minimize.onclick !== "function") {
    throw new Error("Desktop minimize IPC button was not bound");
  }
  minimize.onclick();
  if (!ipcMessages.includes("minimize")) {
    throw new Error("Desktop minimize IPC message was not emitted");
  }
}

runDesktopInteractionRegression().catch(error => { console.error(error); process.exitCode = 1; });

if (!cargoToml.includes('wry = { version = "0.57.0"') || !cargoToml.includes('tao = { version = "0.37.0"')) {
  throw new Error("WebView2/Tao desktop renderer dependencies missing");
}
if (cargoToml.includes("eframe =")) throw new Error("Legacy egui renderer dependency returned");

for (const token of [
  ".shell{min-width:0;min-height:0;",
  ".content{flex:1 1 auto;min-height:0;",
  "overflow-y:auto",
  "scrollbar-gutter:stable",
  'id="content"',
  "Content.scrollTop = 0"
]) {
  if (!desktopHtml.includes(token)) {
    throw new Error("Desktop scroll contract missing: " + token);
  }
}

const guiRs = fs.readFileSync("agent/src/gui.rs", "utf8");
for (const token of ['.with_initialization_script(initialization)', '.with_url(&desktop_url)', '.with_navigation_handler']) {
  if (!guiRs.includes(token)) throw new Error("Same-origin desktop startup contract missing: " + token);
}
const mainRs = fs.readFileSync("agent/src/main.rs", "utf8");
if (!mainRs.includes("ready_rx).await") || !mainRs.includes("let _ = ready.send(());")) throw new Error("Desktop must wait for bridge bind before opening");
if (!mainRs.includes('.route("/desktop-ui", get(desktop_shell_handler))')) throw new Error("Credential-free desktop shell missing");
for (const entry of manifest.content_scripts || []) {
  for (const path of entry.js || []) {
    if (!fs.existsSync(path)) throw new Error("Manifest references missing JS: " + path);
  }
  for (const path of entry.css || []) {
    if (!fs.existsSync(path)) throw new Error("Manifest references missing CSS: " + path);
  }
}

const background = fs.readFileSync("background.js", "utf8");
for (const token of [
  "DESKTOP_PREF_KEYS",
  "/api/preferences",
  "_synerixcodePersisted",
  "initialDesktopPreferencesSync",
  "pullDesktopPreferences",
  "pushDesktopPreferences",
  "desktop_tools_snapshot",
  "/api/tools/browser",
  "chrome.runtime.onMessage.addListener",
  "sendResponse"
]) {
  if (!background.includes(token)) throw new Error("Desktop relay contract missing: " + token);
}

const main = fs.readFileSync("core/main.js", "utf8");
for (const token of [
  "desktopBrowserTools",
  "syncDesktopToolSnapshot",
  "SWEEP_ACTIVE_MS",
  "SWEEP_IDLE_MS",
  "releaseMediaUrl",
  "clearMediaFiles",
  "nextDelay = document.hidden ? 1000",
  "e.t - lastDiagDomAt >= 2000"
]) {
  if (!main.includes(token)) throw new Error("Long-chat/tool catalog regression guard missing: " + token);
}

if (main.includes("barRaf = requestAnimationFrame(placeBar);")) {
  throw new Error("High-frequency perpetual placeBar requestAnimationFrame loop returned");
}
if (main.includes("rsInterval(scheduleSweep, 1500)")) {
  throw new Error("Old high-frequency fallback sweep returned");
}

const providerNames = requiredProviders.map((p) => p.split("/").pop());
console.log("desktop regression: protected", Object.keys(baseline).length, "core/provider files");
console.log("desktop regression: supported provider adapters present:", providerNames.join(", "));
console.log("desktop regression: notion remains experimental; authorized result-paste/deadline changes are hash-protected");
console.log("desktop regression: PASS");
