// SPDX-License-Identifier: GPL-3.0-or-later
// background.js - service worker.
// Owns ONE resilient WebSocket to the local bridge (ws://127.0.0.1:PORT).
// Keeping the socket here (not in the content script) avoids https→ws mixed
// content issues and centralises reconnect / timeout logic.
//
// Contract with content.js: every sendMessage ALWAYS gets a response object,
// even when the bridge is offline. The agentic loop must never hang waiting.

const PAIRING_KEY = "elio-pairing-key";
let fullSyncedOnce = false;
let pairingKey = "";
let pairingInFlight = null;
let bridgeError = "";
const pairingReady = chrome.storage.local.get(PAIRING_KEY).then((value) => {
  pairingKey = value[PAIRING_KEY] || "";
}).catch(() => {});
async function ensurePairing(force = false) {
  await pairingReady;
  if (pairingInFlight) return pairingInFlight;
  if (!force && /^[a-f0-9]{64}$/i.test(pairingKey)) return pairingKey;
  pairingInFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("http://127.0.0.1:3000/api/pair", {
        method: "POST", mode: "cors", credentials: "omit", redirect: "error",
        headers: { "Content-Type": "application/json", "X-elio-Extension": pairingIdentity() },
        body: "{}", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Automatic pairing failed (HTTP "+response.status+"). Update the desktop and extension together, then reload this browser’s extension and AI tab.");
      const data = await response.json();
      if (!/^[a-f0-9]{64}$/i.test(data.key || "")) throw new Error("Agent returned an invalid pairing response");
      pairingKey = data.key;
      try { await chrome.storage.local.set({ [PAIRING_KEY]: pairingKey }); } catch {}
      return pairingKey;
    } catch(error) { throw new Error("Local bridge pairing failed: "+String(error.message || error)+". In Edge or Brave, check that Elio is enabled, its site access includes the AI page and localhost, and local-network access is allowed. Browser permission blocks cannot be fixed by restarting Studio."); }
    finally { clearTimeout(timer); }
  })();
  try { return await pairingInFlight; } finally { pairingInFlight = null; }
}
function pairingProtocols() {
  if (!/^[a-f0-9]{64}$/i.test(pairingKey)) throw new Error("Agent pairing is not ready");
  return ["elio", "elio-auth." + pairingKey];
}
function pairingIdentity() {
  // Firefox's public addon ID differs from its installation-specific origin.
  try {
    const url = new URL(chrome.runtime.getURL(""));
    if (url.protocol === "moz-extension:") return url.hostname;
  } catch {}
  return chrome.runtime.id;
}
// A bridge that accepts a connection but never answers must not hold one of the
// browser's 6 per-host connections forever: queued requests behind it (tools,
// push, status) would stall the agent on "Starting Up". Callers with their own
// signal keep their own (often longer) limit.
const BRIDGE_FETCH_TIMEOUT_MS = 15000;
async function bridgeFetch(url, options = {}) {
  try {
    const response = await bridgeFetchOnce(url, options);
    lastBridgeOkAt = Date.now();
    return response;
  } catch (error) {
    // Recorded for the debug report only; the caller still gets the same error.
    try {
      const path = new URL(String(url)).pathname;
      if (!path.startsWith("/api/debug/")) debugRecord({ source: "extension", level: "warn", kind: "bridge",
        text: "Bridge request " + path + " failed: " + String(error && error.name || "Error") + ": " + String(error && error.message || error),
        where: ["background.js › bridgeFetch"] });
    } catch {}
    throw error;
  }
}
async function bridgeFetchOnce(url, options = {}) {
  await ensurePairing();
  const signal = options.signal || AbortSignal.timeout(BRIDGE_FETCH_TIMEOUT_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", "Bearer " + pairingKey);
    const response = await fetch(url, { ...options, headers, signal, redirect: "error" });
    if (response.status !== 401) return response;
    if (attempt === 0) await ensurePairing(true);
  }
  throw new Error("Agent authentication failed after automatic pairing");
}

// ── Debug report capture ───────────────────────────────────────────────
// elio's own errors, warnings and "[elio]" info from this worker and
// from every AI tab (core/debug-capture.js, which also relays the AI site's own
// errors) are kept in capped buffers and forwarded to the desktop app for
// Settings -> Copy debug report. Uploads only happen while the bridge answers,
// are single-flight with a short timeout, and never change any other request.
const DEBUG_PROBLEM_CAP = 300, DEBUG_INFO_CAP = 150, DEBUG_TAB_CAP = 6;
const debugProblems = [], debugInfo = [], debugTabs = new Map();
let debugSeq = 0, debugSentSeq = 0, debugTabsSentAt = 0, debugDirty = false, debugUploading = false, debugLast = null, debugDropped = 0;
let lastBridgeOkAt = 0;
function debugRedact(value) {
  return String(value)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [hidden]")
    .replace(/\b[a-f0-9]{40,}\b/gi, "[hidden-key]")
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AIza)[-_A-Za-z0-9]{10,}/g, "[hidden-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[hidden-jwt]")
    .replace(/((?:api[-_]?key|token|secret|password|passwd|auth|cookie|session|pairing[-_]?key)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gi, "$1[hidden]")
    .replace(/([?&#][^=\s&#]+=)[^&#\s"')]+/g, "$1…")
    .replace(/([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s"']+/g, "$1<user>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>");
}
function debugWhere(stack) {
  const out = [];
  for (const line of String(stack || "").split("\n")) {
    const file = (line.match(/(?:chrome|moz)-extension:\/\/[^/\s)]+\/([^:\s)]+)/) || [])[1];
    if (!file) continue;
    const fn = (line.match(/^\s*at\s+(?:async\s+)?([^\s(]+)\s+\(/) || line.match(/^\s*([^@\s]+)@/) || [])[1] || "";
    if (/^debug(?:Record|Console)/.test(fn)) continue;
    const item = fn && fn !== "<anonymous>" ? file + " › " + fn : file;
    if (!out.includes(item)) out.push(item);
    if (out.length >= 4) break;
  }
  return out;
}
function debugRecord(entry) {
  try {
    const text = debugRedact(entry.text || "").slice(0, 600);
    const key = (entry.source || "") + "|" + (entry.tab || "") + "|" + entry.level + "|" + text;
    const now = Date.now();
    if (debugLast && debugLast.key === key && now - debugLast.at < 5000) {
      debugLast.item.repeats = (debugLast.item.repeats || 1) + (Number(entry.repeats) || 1); debugLast.at = now; debugDirty = true; return;
    }
    const level = entry.level === "error" || entry.level === "warn" ? entry.level : "info";
    const item = { seq: ++debugSeq, t: Number(entry.t) || now, source: entry.source === "site" ? "site" : "extension", level,
      kind: String(entry.kind || "console").slice(0, 20), text };
    if (entry.tab) item.tab = String(entry.tab).slice(0, 80);
    if (Array.isArray(entry.where) && entry.where.length) item.where = entry.where.slice(0, 4).map((w) => debugRedact(w).slice(0, 120));
    if (entry.file) item.file = debugRedact(entry.file).slice(0, 200);
    if (Number(entry.status)) item.status = Number(entry.status);
    if (Number(entry.repeats) > 1) item.repeats = Number(entry.repeats);
    const list = level === "info" ? debugInfo : debugProblems;
    list.push(item);
    if (list.length > (level === "info" ? DEBUG_INFO_CAP : DEBUG_PROBLEM_CAP)) { list.shift(); debugDropped++; }
    debugLast = { key, at: now, item };
    debugDirty = true;
  } catch {}
}
(() => {
  let inside = false;
  for (const method of ["error", "warn", "info", "log"]) {
    const original = console[method];
    if (typeof original !== "function") continue;
    const level = method === "log" ? "info" : method;
    console[method] = function debugConsole(...args) {
      const result = original.apply(this, args);
      if (!inside && (method !== "log" || (typeof args[0] === "string" && args[0].startsWith("[elio")))) {
        inside = true;
        try {
          const err = args.find((a) => a instanceof Error);
          const text = args.map((a) => a instanceof Error ? a.name + ": " + a.message : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ");
          debugRecord({ source: "extension", level, text, where: level === "info" ? [] : debugWhere(err ? err.stack : new Error().stack) });
        } catch {} finally { inside = false; }
      }
      return result;
    };
  }
  try {
    self.addEventListener("error", (event) => debugRecord({ source: "extension", level: "error", kind: "uncaught",
      text: String(event && event.message || "Uncaught error"), where: debugWhere(event && event.error && event.error.stack) }));
    self.addEventListener("unhandledrejection", (event) => {
      const reason = event && event.reason, text = String(reason && (reason.message || reason) || "Unhandled rejection");
      if (/Receiving end does not exist|message port closed/i.test(text)) return;
      debugRecord({ source: "extension", level: "error", kind: "rejection", text, where: debugWhere(reason && reason.stack) });
    });
  } catch {}
})();
function debugAcceptTab(msg, sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  const page = msg.page && typeof msg.page === "object" ? msg.page : {};
  const host = String(page.host || "").slice(0, 80);
  for (const entry of Array.isArray(msg.entries) ? msg.entries.slice(0, 200) : []) {
    if (entry && typeof entry === "object") debugRecord({ ...entry, tab: host });
  }
  if (Number(msg.dropped) > 0) debugDropped += Number(msg.dropped);
  if (Array.isArray(msg.diag) && tabId != null) {
    debugTabs.delete(tabId);
    debugTabs.set(tabId, { host, path: debugRedact(page.path || "").slice(0, 80), at: Date.now(), diag: msg.diag.slice(-40) });
    while (debugTabs.size > DEBUG_TAB_CAP) debugTabs.delete(debugTabs.keys().next().value);
    debugDirty = true;
  }
}
async function debugUpload() {
  if (!rustMode || debugUploading || !debugDirty || Date.now() - lastBridgeOkAt > 10000) return;
  debugUploading = true;
  try {
    const entries = debugProblems.concat(debugInfo).filter((e) => e.seq > debugSentSeq).sort((a, b) => a.seq - b.seq).slice(0, 200);
    const tabs = [...debugTabs.entries()].filter(([, v]) => v.at > debugTabsSentAt).map(([id, v]) => ({ id: String(id), ...v }));
    const top = entries.length ? entries[entries.length - 1].seq : debugSentSeq, tabsAt = Date.now();
    let version = "";
    try { version = chrome.runtime.getManifest().version; } catch {}
    const response = await bridgeFetch(RUST_ROBLOX_HTTP + "/api/debug/browser-log", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ browser_id: browserIdentity, extension_version: version, user_agent: String(globalThis.navigator && navigator.userAgent || "").slice(0, 200), dropped: debugDropped, entries, tabs }),
    });
    if (response.ok) {
      debugSentSeq = top; debugTabsSentAt = tabsAt; debugDropped = 0;
      debugDirty = debugProblems.concat(debugInfo).some((e) => e.seq > debugSentSeq);
    }
  } catch {} finally { debugUploading = false; }
}
setInterval(() => { debugUpload(); }, 5000);

const PORT_ROBLOX = 17613;
const PORT_LOCAL = 17615; // AgentScript — native FS/terminal engine
const BLENDER_ADDON_PORT = 9876;
const RUST_ROBLOX_HTTP = "http://127.0.0.1:3000";
const ENGINE_KEY = "rs-engine";
const DESKTOP_PREF_KEYS = [
  "rsColorMode",
  "rsLanguage",
  "rsWorkMode",
  "rsPermMode",
  "rsSounds",
  "rsStopMode",
  "rsInputLimitEnabled",
  "rsInputCharLimit",
  "rsOutputLimitEnabled",
  "rsOutputCharLimit",
  "rsRunLimitsEnabled",
  "rsToolBudget",
  "rsTaskMinutes",
  "rsVisualCheck",
  "rsContinuationOffer",
  "rsCommandCooldown",
  "rsExtraThinking",
  "rsShowApproach",
  "rsPlanMode",
  "rsThinkingLevel",
  "rsForgeMode",
  "rsAutoFix",
  "rsBgMode",
  "rsCustomPrompt",
  "rsAppearance",
];
let desktopSyncApplying = false;
let desktopSyncPushTimer = null;
const desktopPendingPreferences = new Map();
const desktopRemoteWrites = new Map();
let desktopPushInFlight = false;

async function applyDesktopPreferences(remote) {
  if (!remote || typeof remote !== "object") return false;
  const local = await chrome.storage.local.get(DESKTOP_PREF_KEYS);
  const updates = {};
  for (const key of DESKTOP_PREF_KEYS) {
    if (!(key in remote) || desktopPendingPreferences.has(key)) continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) updates[key] = remote[key];
  }
  if (Object.keys(updates).length) {
    desktopSyncApplying = true;
    for (const [key, value] of Object.entries(updates)) desktopRemoteWrites.set(key, JSON.stringify(value));
    try { await chrome.storage.local.set(updates); }
    catch (error) { for (const key of Object.keys(updates)) desktopRemoteWrites.delete(key); throw error; }
    finally { desktopSyncApplying = false; }
  }
  return true;
}

async function pullDesktopPreferences() {
  try {
    const response = await bridgeFetch("http://127.0.0.1:3000/api/preferences", { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    return await applyDesktopPreferences(await response.json());
  } catch {
    return false;
  }
}

async function pushDesktopPreferences() {
  if (desktopPushInFlight) return false;
  desktopPushInFlight = true;
  try {
    const prefs = desktopPendingPreferences.size
      ? Object.fromEntries(desktopPendingPreferences) : await chrome.storage.local.get(DESKTOP_PREF_KEYS);
    const response = await bridgeFetch("http://127.0.0.1:3000/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      for (const [key, value] of Object.entries(prefs)) {
        if (desktopPendingPreferences.has(key) && JSON.stringify(desktopPendingPreferences.get(key)) === JSON.stringify(value)) desktopPendingPreferences.delete(key);
      }
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    desktopPushInFlight = false;
    if (desktopPendingPreferences.size) {
      clearTimeout(desktopSyncPushTimer);
      desktopSyncPushTimer = setTimeout(() => { pushDesktopPreferences(); }, 500);
    }
  }
}

async function initialDesktopPreferencesSync() {
  try {
    const response = await bridgeFetch("http://127.0.0.1:3000/api/preferences", { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const remote = await response.json();
    if (remote && remote._elioPersisted === true) {
      if (typeof remote.rsCustomPrompt !== "string") {
        const existing = await chrome.storage.local.get("rsCustomPrompt");
        if (typeof existing.rsCustomPrompt === "string") {
          const seeded = await bridgeFetch("http://127.0.0.1:3000/api/preferences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rsCustomPrompt: existing.rsCustomPrompt }),
            signal: AbortSignal.timeout(5000),
          });
          if (!seeded.ok) return false;
          const saved = await seeded.json();
          return await applyDesktopPreferences(saved.preferences || saved);
        }
      }
      return await applyDesktopPreferences(remote);
    }

    const local = await chrome.storage.local.get(DESKTOP_PREF_KEYS);
    const hasExisting = DESKTOP_PREF_KEYS.some((key) => local[key] !== undefined);
    if (hasExisting) return await pushDesktopPreferences();

    if (!(await applyDesktopPreferences(remote))) return false;
    return await pushDesktopPreferences();
  } catch {
    return false;
  }
}

function scheduleDesktopPreferencesPush() {
  clearTimeout(desktopSyncPushTimer);
  desktopSyncPushTimer = setTimeout(() => { pushDesktopPreferences(); }, 50);
}

chrome.storage?.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let changed = false;
  for (const key of DESKTOP_PREF_KEYS) {
    if (!changes[key]) continue;
    const value = changes[key].newValue;
    if (desktopRemoteWrites.has(key) && desktopRemoteWrites.get(key) === JSON.stringify(value)) { desktopRemoteWrites.delete(key); continue; }
    desktopPendingPreferences.set(key, value);
    changed = true;
  }
  if (changed) scheduleDesktopPreferencesPush();
});

// "anim" (Animation mode) is a persona-driven view of the SAME Roblox bridge:
// it maps to 17613 everywhere a port/HTTP target is picked, but keeps its own
// id so prompts, accents and UI state stay engine-isolated.
const ENGINES = ["roblox", "local"];
function normalizeEngine(v) { return v === "local" ? "local" : "roblox"; }
let engine = "roblox"; // "roblox" | "local"
let rustMode = false; // true if Rust agent on 3000 is reachable (preferred)
// Engine selection belongs to a browser tab, never desktop preferences.
const tabEngines = new Map();
async function tabEngine(tabId) {
  if (!Number.isInteger(tabId)) return "roblox";
  if (tabEngines.has(tabId)) return tabEngines.get(tabId);
  try { const key="rs-tab-engine-"+tabId; const saved=await chrome.storage.session.get(key); if (!tabEngines.has(tabId)) tabEngines.set(tabId,normalizeEngine(saved[key])); } catch { if (!tabEngines.has(tabId)) tabEngines.set(tabId,"roblox"); }
  return tabEngines.get(tabId);
}
chrome.tabs.onRemoved?.addListener(tabId=>{tabEngines.delete(tabId);try{chrome.storage.session.remove("rs-tab-engine-"+tabId);}catch{}});
// Probe Rust agent on 3000 at startup — if reachable, use HTTP pipe (CORS bypass) as primary
(async () => {
  try {
    const r = await bridgeFetch(`${RUST_ROBLOX_HTTP}/api/status`, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      rustMode = true;
      log("Rust agent detected on 3000 — HTTP pipe enabled (CORS bypass via background)");
      await initialDesktopPreferencesSync();
      
    }
  } catch {}
})();
function engineUrl() { return `ws://127.0.0.1:${engine === "local" ? PORT_LOCAL : PORT_ROBLOX}`; }
function engineHttpUrl() { return RUST_ROBLOX_HTTP; }
function engineLabel() { return engine === "local" ? "AgentScript" : "Roblox"; }
// The primary Roblox socket stays alive when an individual tab uses AgentScript.

// Chat sites where an elio provider content script runs. Status pushes go
// to every tab matching these. Add the new provider's URL pattern here (and in
// manifest.json content_scripts + host_permissions) when integrating another AI.
const PROVIDER_URLS = ["https://vani.ai/*", "https://www.vani.ai/*", "https://c.vani.ai/*", "https://app.clickup.com/*", "https://chat.deepseek.com/*", "https://deepseek.com/*", "https://chatgpt.com/*", "https://chat.openai.com/*", "https://claude.ai/*", "https://www.claude.ai/*", "https://claude.com/*", "https://www.claude.com/*", "https://gemini.google.com/*", "https://www.kimi.com/*", "https://kimi.com/*", "https://kimi.ai/*", "https://www.kimi.ai/*", "https://chat.z.ai/*", "https://chat.qwen.ai/*", "https://arena.ai/*", "https://www.notion.so/*", "https://app.notion.so/*", "https://www.notion.com/*", "https://notion.com/*", "https://*.notion.com/*", "https://freebuff.ai/*", "https://www.freebuff.ai/*", "https://freebuff.com/*", "https://www.freebuff.com/*", "https://gpt.crax.lol/*", "https://use.ai/*", "https://www.use.ai/*", "https://oxalpha.com/*", "https://www.oxalpha.com/*", "https://oxalpha.org/*", "https://www.oxalpha.org/*", "http://localhost/*", "http://127.0.0.1/*", "https://ollama.com/*", "https://*.ollama.com/*"];

const RECONNECT_MIN = 500;
const RECONNECT_MAX = 500;
const HEARTBEAT_MS = 10000;
// If no message (incl. pong) arrives within this window while we believe we're
// connected, the socket is half-open: force a reconnect instead of letting
// pending requests slowly time out.
const STALE_SOCKET_MS = 140000; // above 120s tool timeout so a long execute_luau never looks half-open
const REQUEST_TIMEOUT_DEFAULT = 130000; // a bit above the 120s tool timeout

let ws = null;
let connected = false;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastMessageAt = 0; // timestamp of the last frame received from the bridge
let nextId = 1;
const pending = new Map(); // id -> {resolve, timer}
let toolsCache = [];
// 1.24.13: AgentScript's own catalogue. toolsCache follows the shared socket's
// engine, so an AgentScript tab could show Roblox's count and "local (0 tools)".
let localToolsCache = [];
let mcpAlive = false;
let serversCache = [];
// true/false = a PLACE is loaded and usable in Roblox Studio; null = unknown.
// The MCP process stays alive when Studio is closed or its MCP option is off,
// so this is probed separately (bridge "studio_status").
let studioConnected = null;
let studioChecking = false;
// true/false = a Roblox Studio app is connected to the MCP server at all; null =
// unknown. studioApp=true with studioConnected=false means "Studio open but no
// place"; studioApp=false means "Studio closed elio its MCP option disabled".
let studioApp = null;
// true/false = a Roblox Studio WINDOW/PROCESS exists on this machine (checked
// bridge-side via tasklist); null = unknown/old bridge. Distinguishes the two
// studioApp=false sub-cases the UI must word differently: Studio genuinely not
// launched ("open Roblox Studio") vs Studio OPEN but its MCP plugin never
// registered with the bridge - the documented fix for the latter is opening
// Assistant Settings > MCP Servers inside Studio (validated live 3x), which
// "open Roblox Studio" wording completely fails to convey.
let studioProc = null;
let robloxProc = false;
// Editor-backed status. A local bridge socket is not an editor connection.
let robloxEditorConnected = false;
let localReady = false; // agent's workspace is up (from /api/status local_ready)
let localFull = false; // AgentScript FULL PC ACCESS (agent is source of truth)
let localRoot = ""; // workspace path, injected into the AI's state line
let blenderSuppressed = false;
let blenderAddon = false; // blender-mcp addon listening on TCP 9876
let blenderError = "";
let blenderScriptsReady = false;
let blenderWasConnected = false; // this browser session reached Blender at least once
const BLENDER_TOOL_NAMES = new Set([
  "get_scene_info", "get_object_info", "execute_blender_code", "get_viewport_screenshot",
  "blender_export_fbx", "blender_import_fbx", "blender_export_obj", "blender_import_obj",
  "blender_mesh_dump", "blender_send_to_studio", "blender_execute_code",
  "blender_get_scene_info", "blender_get_object_info", "blender_screenshot",
  "export_blender_fbx", "import_blender_fbx",
]);
function btool(name, description, props, required) {
  return { name, server: "blender", description, inputSchema: { type: "object", properties: props || {}, required: required || [] } };
}
const BLENDER_TOOLS = [
  btool("get_scene_info", "Inspect the live Blender scene (objects, cameras, lights, collections).", {}, []),
  btool("get_object_info", "Details for one object in the Blender scene.", { name: { type: "string" } }, ["name"]),
  btool("execute_blender_code", "Run Python (bpy) inside Blender. Prefer the named blender_* tools.", { code: { type: "string" } }, ["code"]),
  btool("get_viewport_screenshot", "Capture the Blender 3D viewport.", { max_size: { type: "integer" } }, []),
  btool("blender_send_to_studio", "ONE SHOT: dump the live Blender meshes and import them into Roblox Studio as Workspace.ELIO_Imported. No filepath needed.", { objects: { type: "array", items: { type: "string" } }, dest: { type: "string" }, scale: { type: "number" } }, []),
  btool("blender_export_fbx", "Export meshes to an FBX (Forward -Z, Up Y). filepath optional. Also dumps meshes so blender_send_to_studio / asset_bridge_import can run with no path.", { filepath: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_import_fbx", "Import an FBX into the live Blender scene. filepath optional — defaults to the last elio export.", { filepath: { type: "string" } }, []),
  btool("blender_export_obj", "Export selected/all meshes to OBJ. filepath optional.", { filepath: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_import_obj", "Import an OBJ into the live Blender scene.", { filepath: { type: "string" } }, ["filepath"]),
  btool("blender_add_cube", "Add a cube.", { name: { type: "string" }, size: { type: "number" }, location: { type: "array", items: { type: "number" } } }, []),
  btool("blender_add_sphere", "Add a UV sphere.", { name: { type: "string" }, radius: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_add_cylinder", "Add a cylinder.", { name: { type: "string" }, radius: { type: "number" }, depth: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_add_cone", "Add a cone.", { name: { type: "string" }, radius: { type: "number" }, depth: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_add_plane", "Add a plane.", { name: { type: "string" }, size: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_add_torus", "Add a torus.", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_add_monkey", "Add Suzanne (monkey head).", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_add_empty", "Add an Empty (use as a group parent).", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_add_camera", "Add a camera.", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_add_light", "Add a light (SUN/POINT/SPOT/AREA).", { name: { type: "string" }, type: { type: "string" }, location: { type: "array" }, energy: { type: "number" } }, []),
  btool("blender_group", "Group objects: parent them to a new Empty and put them in a collection of the same name.", { name: { type: "string", description: "Group name" }, objects: { type: "array", items: { type: "string" }, description: "Object names; omit = selected/all meshes" } }, []),
  btool("blender_ungroup", "Ungroup: clear parent, keep world transforms, remove the group Empty.", { name: { type: "string" } }, []),
  btool("blender_parent", "Parent objects under an existing object/Empty.", { parent: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, ["parent"]),
  btool("blender_unparent", "Clear parent, keep world transforms.", { objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_join", "Join mesh objects into one.", { objects: { type: "array", items: { type: "string" } }, name: { type: "string" } }, []),
  btool("blender_move_to_collection", "Move objects into a collection (created if missing).", { collection: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_list_collections", "List collections and their objects.", {}, []),
  btool("blender_list_objects", "List every object: type, location, parent, collections.", {}, []),
  btool("blender_delete", "Delete objects.", { name: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_duplicate", "Duplicate objects.", { name: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_rename", "Rename an object.", { name: { type: "string" }, new_name: { type: "string" } }, ["new_name"]),
  btool("blender_select", "Select objects by name.", { name: { type: "string" }, objects: { type: "array", items: { type: "string" } } }, []),
  btool("blender_transform", "Set location / rotation (radians) / scale.", { name: { type: "string" }, objects: { type: "array" }, location: { type: "array" }, rotation: { type: "array" }, scale: { type: "array" } }, []),
  btool("blender_apply_transforms", "Apply rotation/scale (and optional location).", { objects: { type: "array" }, location: { type: "boolean" }, rotation: { type: "boolean" }, scale: { type: "boolean" } }, []),
  btool("blender_set_origin", "Set object origin (ORIGIN_GEOMETRY, ORIGIN_CURSOR, ORIGIN_CENTER_OF_MASS).", { name: { type: "string" }, type: { type: "string" } }, []),
  btool("blender_shade_smooth", "Shade smooth.", { name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_set_material", "Assign a Principled BSDF material. color = [r,g,b] or [r,g,b,a] 0–1.", { name: { type: "string" }, material: { type: "string" }, color: { type: "array" } }, []),
  // ── Material toolkit ──
  btool("blender_material_create", "Create a node-based material (optionally assigning it). Either a preset, explicit PBR values, or both. color = [r,g,b(,a)] 0–1, [r,g,b] 0–255, or '#rrggbb'.", { material: { type: "string" }, preset: { type: "string", description: "metal, steel, iron, chrome, gold, silver, copper, bronze, brass, plastic, rubber, ceramic, concrete, asphalt, wood, marble, fabric, leather, glass, frosted_glass, water, ice, emissive, neon, lava, hologram, ghost, toon, roblox_plastic, roblox_metal, roblox_glass" }, color: { type: "array" }, metallic: { type: "number" }, roughness: { type: "number" }, ior: { type: "number" }, transmission: { type: "number" }, alpha: { type: "number" }, emission: { type: "array" }, emission_strength: { type: "number" }, coat: { type: "number" }, sheen: { type: "number" }, blend: { type: "string", description: "BLEND / HASHED / OPAQUE" }, name: { type: "string", description: "object to assign to" }, objects: { type: "array" }, append_slot: { type: "boolean" } }, ["material"]),
  btool("blender_material_preset", "Create a material from a named preset in one call (see blender_material_create for the list) and assign it.", { material: { type: "string" }, preset: { type: "string" }, name: { type: "string" }, objects: { type: "array" }, color: { type: "array" } }, ["preset"]),
  btool("blender_material_set", "Change values on an EXISTING material (color, metallic, roughness, emission, alpha, ior, transmission, coat, sheen, blend).", { material: { type: "string" }, color: { type: "array" }, metallic: { type: "number" }, roughness: { type: "number" }, emission: { type: "array" }, emission_strength: { type: "number" }, alpha: { type: "number" }, transmission: { type: "number" }, ior: { type: "number" }, coat: { type: "number" }, sheen: { type: "number" }, blend: { type: "string" } }, ["material"]),
  btool("blender_material_assign", "Assign an existing material to objects (all slots, one slot, or append a new slot).", { material: { type: "string" }, name: { type: "string" }, objects: { type: "array" }, slot: { type: "integer" }, append: { type: "boolean" } }, ["material"]),
  btool("blender_material_list", "List every material: users, Principled values, plus the known preset names.", {}, []),
  btool("blender_material_inspect", "Dump one material completely: Principled BSDF inputs, linked inputs, node graph, users.", { material: { type: "string" }, name: { type: "string" } }, []),
  btool("blender_material_remove", "Delete a material from the file.", { material: { type: "string" } }, ["material"]),
  btool("blender_material_noise", "Add a procedural texture to a material (noise, voronoi, wave, checker, brick, gradient) driving bump, base color, roughness or emission.", { material: { type: "string" }, type: { type: "string" }, affect: { type: "string", description: "bump | base_color | roughness | emission" }, scale: { type: "number" }, detail: { type: "number" }, roughness: { type: "number" }, distortion: { type: "number" }, strength: { type: "number" }, color_a: { type: "array" }, color_b: { type: "array" }, replace: { type: "boolean" } }, ["material"]),
  btool("blender_material_image", "Wire an image file into a material slot (base_color, roughness, metallic, normal, emission).", { material: { type: "string" }, path: { type: "string" }, slot: { type: "string" }, strength: { type: "number" }, alpha_to_alpha: { type: "boolean" }, colorspace: { type: "string" } }, ["material", "path"]),
  btool("blender_material_pbr", "Build a full PBR graph from map files (base_color/albedo + optional orm, roughness, metallic, normal, emission) with correct Non-Color colorspaces.", { material: { type: "string" }, base_color: { type: "string" }, albedo: { type: "string" }, orm: { type: "string" }, roughness: { type: "string" }, metallic: { type: "string" }, normal: { type: "string" }, emission: { type: "string" } }, ["material"]),
  btool("blender_add_modifier", "Add a modifier: SUBSURF, BEVEL, SOLIDIFY, MIRROR, ARRAY, BOOLEAN, DECIMATE. apply=true to apply.", { name: { type: "string" }, type: { type: "string" }, levels: { type: "integer" }, apply: { type: "boolean" }, target: { type: "string" } }, []),
  btool("blender_boolean", "Boolean one mesh with another (DIFFERENCE/UNION/INTERSECT) and apply.", { name: { type: "string" }, target: { type: "string" }, operation: { type: "string" } }, ["target"]),
  btool("blender_clear_scene", "Delete objects. keep = names to leave.", { keep: { type: "array", items: { type: "string" } } }, []),
  btool("blender_add_grid", "Add a grid.", { name: { type: "string" }, size: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_add_text", "Add 3D text. text=string, extrude=thickness.", { name: { type: "string" }, text: { type: "string" }, extrude: { type: "number" }, location: { type: "array" } }, []),
  btool("blender_translate", "Move objects by offset [x,y,z] (relative).", { offset: { type: "array" }, name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_rotate", "Set rotation in DEGREES [x,y,z]. add=true to add.", { rotation_deg: { type: "array" }, add: { type: "boolean" }, name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_set_dimensions", "Set object size in meters [x,y,z].", { dimensions: { type: "array" }, name: { type: "string" } }, []),
  btool("blender_origin_to_bottom", "Put origin at the lowest point (Roblox feet).", { name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_drop_to_ground", "Move objects so the lowest vertex sits on Z=0.", { name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_array", "Duplicate along offset, count times.", { count: { type: "integer" }, offset: { type: "array" }, objects: { type: "array" } }, []),
  btool("blender_mirror", "Mirror-duplicate across X/Y/Z.", { axis: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_triangulate", "Convert faces to triangles (needed before Studio).", { objects: { type: "array" } }, []),
  btool("blender_apply_modifiers", "Apply every modifier so dump/export sees the result.", { objects: { type: "array" } }, []),
  btool("blender_merge", "Merge-by-distance (remove doubles).", { distance: { type: "number" }, objects: { type: "array" } }, []),
  btool("blender_recalc_normals", "Recalculate outside normals.", { objects: { type: "array" } }, []),
  btool("blender_hide", "Hide objects.", { name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_unhide", "Unhide objects (omit names = all).", { name: { type: "string" }, objects: { type: "array" } }, []),
  btool("blender_undo", "Undo last Blender action.", {}, []),
  btool("blender_stats", "Vertex/face/modifier counts.", { objects: { type: "array" } }, []),
  btool("blender_get_selection", "Names of selected objects.", {}, []),
  btool("blender_uv_unwrap", "Smart UV project.", { objects: { type: "array" } }, []),
  btool("blender_look_at", "Point an object/camera at a target or location.", { name: { type: "string" }, target: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_align_camera", "Align the scene camera to an axis (front/back/left/right/top/bottom/iso) looking at a target or the selection.", { axis: { type: "string" }, distance: { type: "number" }, target: { type: "string" }, name: { type: "string" } }, []),
  btool("blender_align_camera_axis", "Same as blender_align_camera.", { axis: { type: "string" }, distance: { type: "number" }, target: { type: "string" }, name: { type: "string" } }, []),
  btool("blender_view_axis", "Align the 3D viewport to FRONT/BACK/LEFT/RIGHT/TOP/BOTTOM (or iso via camera).", { axis: { type: "string" } }, []),
  btool("blender_camera_to_view", "Move the scene camera to match the current 3D viewport.", {}, []),
  btool("blender_set_camera_lens", "Set camera focal length, clip planes, or orthographic mode.", { name: { type: "string" }, lens: { type: "number" }, clip_start: { type: "number" }, clip_end: { type: "number" }, ortho: { type: "boolean" }, ortho_scale: { type: "number" } }, []),
  btool("blender_scale", "Scale selected/named objects. scale:[x,y,z] or a number. multiply=true multiplies current scale.", { name: { type: "string" }, scale: { type: "array" }, factor: { type: "array" }, multiply: { type: "boolean" } }, []),
  btool("blender_bevel", "Bevel mesh edges in edit mode.", { name: { type: "string" }, width: { type: "number" }, segments: { type: "number" } }, []),
  btool("blender_solidify", "Add a Solidify modifier (thickness).", { name: { type: "string" }, thickness: { type: "number" } }, []),
  btool("blender_extrude", "Extrude the mesh along normals.", { name: { type: "string" }, distance: { type: "number" } }, []),
  btool("blender_add_curve", "Add a Bezier curve.", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_add_armature", "Add an armature (single bone).", { name: { type: "string" }, location: { type: "array" } }, []),
  btool("blender_keyframe_insert", "Insert a keyframe on location/rotation/scale (or data_path) at frame.", { name: { type: "string" }, frame: { type: "number" }, data_path: { type: "string" } }, []),
  btool("blender_set_frame", "Set the current scene frame.", { frame: { type: "number" } }, []),
  btool("blender_set_active_camera", "Make a camera the scene camera.", { name: { type: "string" } }, []),
  btool("blender_track_to", "TRACK_TO constraint from selected objects toward target.", { target: { type: "string" }, name: { type: "string" } }, ["target"]),
  btool("blender_cursor_to_selected", "Move the 3D cursor to the selection midpoint.", { name: { type: "string" } }, []),
  btool("blender_randomize_transform", "Jitter location/rotation/scale of selected objects.", { name: { type: "string" }, location: { type: "number" }, rotation: { type: "number" }, scale: { type: "number" }, seed: { type: "number" } }, []),
  btool("blender_hide_render", "Hide (or unhide) objects from render.", { name: { type: "string" }, hide: { type: "boolean" } }, []),
  btool("blender_subdivision", "Add a Subdivision Surface modifier.", { name: { type: "string" }, levels: { type: "number" }, render_levels: { type: "number" } }, []),
  btool("blender_origin_to_geometry", "Set origin to geometry for selected objects.", { name: { type: "string" } }, []),
];
for (const t of BLENDER_TOOLS) BLENDER_TOOL_NAMES.add(t.name);

function blenderServers(list) {
  const rest = (Array.isArray(list) ? list : []).filter((s) => s && s.id !== "blender");
  if (blenderAddon) {
    rest.push({
      id: "blender", name: "Blender",
      alive: true, tools: BLENDER_TOOLS.length,
    });
  }
  return rest;
}
function mergeBlenderTools(tools) {
  const base = Array.isArray(tools) ? tools.slice() : [];
  if (!blenderAddon) return base;
  const have = new Set(base.map((t) => t && t.name));
  for (const t of BLENDER_TOOLS) if (!have.has(t.name)) base.push(t);
  return base;
}

function log(...a) {
  console.log("[elio-bg]", ...a);
}

// ── WebSocket lifecycle ─────────────────────────────────────────────────
async function connect() {
  try { await ensurePairing(true); } catch (error) {
    bridgeError = String(error.message || "Agent unavailable for automatic pairing");
    log(bridgeError);
    broadcastStatus();
    scheduleReconnect();
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  clearTimeout(reconnectTimer);
  const url = engineUrl();
  let sock;
  try {
    sock = new WebSocket(url, pairingProtocols());
  } catch (e) {
    log("WebSocket ctor failed", e);
    scheduleReconnect();
    return;
  }
  ws = sock;

  sock.onopen = () => {
    if (sock !== ws) return;
    connected = true;
    bridgeError = "";
    reconnectDelay = RECONNECT_MIN;
    lastMessageAt = Date.now();
    lastSocketOpenAt = Date.now();
    log(`connected to ${engineLabel()} bridge (${url})`);
    startHeartbeat();
    studioChecking = engine !== "local";
    refreshProcStatus();
    refreshStudioStatus();
    broadcastStatus();
  };

  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleBridgeMessage(msg);
  };

  sock.onclose = () => {
    if (sock !== ws) return;
    connected = false;
    mcpAlive = false;
    studioConnected = null;
    studioApp = null;
    studioProc = null;
    robloxEditorConnected = false;
    toolsCache = [];
    serversCache = [];
    stopHeartbeat();
    failAllPending("bridge connection closed");
    broadcastStatus();
    scheduleReconnect();
  };

  sock.onerror = () => {
    if (sock !== ws) return;
    // onclose will follow; nothing to do here but avoid an unhandled error.
    try { sock.close(); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.7, RECONNECT_MAX);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (connected) {
      // Half-open socket: the WS still reports OPEN but nothing comes through.
      // The pong (and every other frame) refreshes lastMessageAt; if it has
      // gone stale, drop the dead socket so onclose triggers a reconnect.
      const toolPending = [...pending.values()].some((p) => p.type === "call_tool");
      if (lastMessageAt && Date.now() - lastMessageAt > STALE_SOCKET_MS) {
        if (toolPending) return; // execute_luau owns the helper — pong resumes after it
        log("socket stale, forcing reconnect");
        try { ws.close(); } catch {}
        return;
      }
      // Keeps the MV3 service worker alive AND detects a half-open socket.
      // Use short timeout so pending ping doesn't leak for 130s
      send({ type: "ping" }, 12000).catch(() => {});
      refreshStudioStatus();
      // ── MCP auto-heal (v1.12) ────────────────────────────────────────────
      // The StudioMCP helper the agent spawns can die on its own (Studio
      // update, sleep/resume, crash). The agent only recycles it when a TOOL
      // call proves the helper dead - so between calls the bar kept showing
      // "connected" with a corpse helper and every command failed. If the
      // helper has been dead for two consecutive heartbeats, restart it
      // proactively (max once per 3 min so a legitimately closed Studio can't
      // cause a restart loop - the agent refuses when Studio's MCP option is
      // off, and that answer must win).
      if ((engine === "roblox" || engine === "anim") && !toolPending) {
        // Studio closed / MCP plugin off: do not restart-loop the helper.
        // 1.24.13-fix: never heal while Studio is attaching, already linked, or
        // closed. The old 1-heartbeat/30 s heal killed the helper while Studio's
        // auto-connect was still registering, which dropped the selected Studio
        // ("The selected Studio disconnected") and looped OFFLINE -> reset.
        if (studioProc === false || studioApp === false || studioChecking ||
            robloxEditorConnected === true || studioConnected === true) {
          mcpDownStreak = 0;
        } else if (!mcpAlive) {
          mcpDownStreak++;
          const now = Date.now();
          if (mcpDownStreak >= MCP_HEAL_STREAK && !mcpHealInFlight &&
              now - lastSocketOpenAt > MCP_HEAL_GRACE_MS &&
              now - lastMcpHealAt > MCP_HEAL_COOLDOWN_MS) {
            mcpHealInFlight = true;
            // Confirm with the bridge that the helper is really dead; a stale
            // mcpAlive=false flag alone must not restart a working helper.
            send({ type: "mcp_status" }, 10000).then((st) => {
              if (!st || !st.ok || st.alive !== false || robloxEditorConnected === true) {
                mcpDownStreak = 0;
                return;
              }
              lastMcpHealAt = Date.now();
              mcpDownStreak = 0;
              log("MCP helper confirmed dead - auto-restarting Studio MCP");
              return send({ type: "restart_mcp" }, 30000).then((r) => {
                if (r && r.ok) {
                  send({ type: "list_tools" }, 10000).catch(() => {});
                  refreshStudioStatus();
                }
              });
            }).catch(() => {}).finally(() => { mcpHealInFlight = false; });
          }
        } else {
          mcpDownStreak = 0;
        }
      }
    }
  }, HEARTBEAT_MS);
}
// Auto-heal state (see startHeartbeat).
let mcpDownStreak = 0;
let lastMcpHealAt = 0;
let mcpHealInFlight = false;
let lastSocketOpenAt = 0;
const MCP_HEAL_STREAK = 3;          // 3 heartbeats (~30 s) of a dead helper
const MCP_HEAL_GRACE_MS = 60000;    // let Studio auto-connect settle after (re)connect
const MCP_HEAL_COOLDOWN_MS = 180000; // at most one heal every 3 min

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Resolve once the socket is OPEN, or false after `timeout` ms.
function waitForConnection(timeout = 20000) {
  return new Promise((resolve) => {
    if (connected && ws && ws.readyState === WebSocket.OPEN) return resolve(true);
    connect(); // nudge a (re)connection - important after a worker wake-up
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
}

// ── request/response over the socket ────────────────────────────────────
async function send(obj, timeout = REQUEST_TIMEOUT_DEFAULT) {
  // The MV3 service worker can be suspended; the first message after a wake-up
  // arrives before the socket has re-opened. Wait for it instead of failing -
  // otherwise Kimi wrongly hears "bridge offline".
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    await waitForConnection(20000);
  }
  const attempt = () => new Promise((resolve) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      resolve({ ok: false, kind: "disconnected", error: "bridge not connected" });
      return;
    }
    const id = nextId++;
    const payload = { ...obj, id };
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, kind: "timeout", error: "bridge did not respond in time" });
      }
    }, timeout);
    pending.set(id, { resolve, timer, type: obj.type });
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, kind: "disconnected", error: String(e) });
    }
  });
  let r = await attempt();
  if (r && (r.kind === "disconnected" || (r.kind === "lost" && RESEND_AFTER_LOSS.has(obj.type)))) {
    await waitForConnection(15000);
    r = await attempt();
  }
  return r;
}

// Ask the bridge whether a Roblox Studio instance is actually connected to the
// MCP server. Broadcasts only on change so the UI updates promptly but quietly.
let studioProbing = false;
async function refreshStudioStatus() {
  if (studioProbing || !connected) return;
  if ([...pending.values()].some((p) => p.type === "call_tool")) return;
  studioProbing = true;
  try {
    const r = await send({ type: "studio_status" }, 12000);
    const v = r && r.ok && typeof r.studio === "boolean" ? r.studio : null;
    if (v !== null && (engine === "roblox" || engine === "anim")) robloxEditorConnected = v;
    // local readiness comes from the agent's /api/status (local_ready), not editor probes
    if (v !== null && v !== studioConnected) {
      studioConnected = v;
      broadcastStatus();
    } else {
      // The probe result can change independently of the tri-state cache when a
      // timeout returns null, so still publish the strict editor flag.
      broadcastStatus();
    }
  } finally {
    studioProbing = false;
  }
}

function handleBridgeMessage(msg) {
  if (msg.type === "roblox_status") {
    robloxEditorConnected = msg.studio === true;
    robloxProc = msg.studio_proc === true || robloxEditorConnected;
    if (engine === "roblox" || engine === "anim") {
      studioChecking = false;
      studioConnected = robloxEditorConnected;
      studioProc = robloxProc;
      if (Array.isArray(msg.tools)) toolsCache = msg.tools;
      if (msg.mcp_alive === true) mcpAlive = true;
      const row = { id: "roblox", name: "Roblox Studio MCP", alive: robloxEditorConnected, tools: robloxEditorConnected ? toolsCache.length : 0 };
      serversCache = [...serversCache.filter((server) => server.id !== "roblox"), row];
    }
    broadcastStatus();
    return;
  }
  if (msg.type === "desktop_preferences") {
    applyDesktopPreferences(msg.preferences).catch(() => {});
    return;
  }
  if (msg.type === "desktop_agent_action") {
    dispatchDesktopAgentAction(msg).catch(() => {});
    return;
  }
  if ("studio" in msg && (typeof msg.studio === "boolean" || msg.studio === null)) {
    studioConnected = msg.studio;
  }
  if ("studio_app" in msg && (typeof msg.studio_app === "boolean" || msg.studio_app === null)) {
    studioApp = msg.studio_app;
  }
  if ("studio_proc" in msg && (typeof msg.studio_proc === "boolean" || msg.studio_proc === null)) {
    studioProc = msg.studio_proc;
  }
  if (msg.type === "studio_status") {
    studioChecking = false;
    const online = studioConnected === true;
    if (engine === "roblox" || engine === "anim") robloxEditorConnected = online;
    // 1.24.13: a successful Studio probe proves the helper is alive. Without this,
    // a stale mcpAlive=false made the heartbeat auto-heal restart a working helper,
    // which dropped the verified link and showed "MCP is off".
    if (online && (engine === "roblox" || engine === "anim")) mcpAlive = true;
    resolvePending(msg.id, { ok: true, studio: online });
    broadcastStatus();
    return;
  }
  if (msg.type === "connected") {
    studioChecking = msg.studio_checking === true;
    mcpAlive = !!msg.mcp_alive;
    // The bridge's first frame carries no catalogue yet; keep the last good one.
    if (Array.isArray(msg.tools) && (msg.tools.length || msg.ok === false)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    const online = msg.studio === true;
    if (engine === "roblox" || engine === "anim") robloxEditorConnected = online;
    broadcastStatus();
    return;
  }
  if (msg.type === "pong") {
    resolvePending(msg.id, { ok: true });
    return;
  }
  if (msg.type === "tools") {
    studioChecking = false;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    mcpAlive = !!msg.mcp_alive;
    const online = msg.studio === true;
    if (engine === "roblox" || engine === "anim") robloxEditorConnected = online;
    resolvePending(msg.id, { ok: !!msg.ok, tools: toolsCache, studio: online });
    broadcastStatus();
    return;
  }
  if (msg.type === "tool_result") {
    resolvePending(msg.id, msg.ok
      ? { ok: true, text: msg.text, images: msg.images || [] }
      : { ok: false, kind: msg.kind, error: msg.error });
    return;
  }
  if (msg.type === "mcp_status") {
    mcpAlive = !!msg.alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) {
      serversCache = msg.servers;
      const rbx = serversCache.find((x) => x.id === "roblox" || x.id === "studio");
      if (rbx) robloxEditorConnected = !!rbx.alive;
      const loc = serversCache.find((x) => x.id === "local");
      if (loc) localReady = !!loc.alive;
    }
    resolvePending(msg.id, { ok: !!msg.ok, alive: mcpAlive, error: msg.error });
    broadcastStatus();
    return;
  }
  if (msg.type === "server_changed") {
    // The bridge acks, then restarts itself to reload config.json. The socket
    // will drop right after this - the content script shows a spinner until the
    // reconnect lands and a fresh status arrives.
    resolvePending(msg.id, { ok: !!msg.ok, error: msg.error, restarting: !!msg.restarting });
    return;
  }
  if (msg.type === "error") {
    resolvePending(msg.id, { ok: false, error: msg.error });
    return;
  }
}

function resolvePending(id, value) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(value);
}

// A request in `pending` was already written to the socket. If the socket
// closes now, the bridge may have executed it, so it is "lost", not
// "disconnected": send() must never transparently resend a mutation (a
// restarted or updated desktop would run execute_luau or a file write twice).
// Read-only requests are safe to resend once the bridge is back.
const RESEND_AFTER_LOSS = new Set(["list_tools", "studio_status", "ping", "list_servers", "status", "mcp_status"]);
function failAllPending(reason) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, kind: "lost", error: reason });
  }
  pending.clear();
}

// ── status push to any open DeepSeek tab + popup ─────────────────────────
function localTools() {
  if (localToolsCache.length) return localToolsCache;
  return engine === "local" ? toolsCache : [];
}
function statusObj(mode = engine) {
  return {
    type: "rs-status", connected: mode === "local" ? localReady : connected, mcpAlive: mode === "local" ? localReady : mcpAlive, studio: studioConnected, studioApp, studioProc,
    robloxProc, roblox_connected: robloxEditorConnected, studio_checking: studioChecking,
    local_connected: localReady, local_full: localFull,
    local_root: localRoot,
    tools: mergeBlenderTools(mode === "local" ? localTools() : toolsCache).length,
    // Blender (and any other live add-on) is listed in AgentScript too, so the bar,
    // the popup, list_mcp_servers and the startup note all tell the AI it is connected.
    servers: mode === "local" ? blenderServers([{id:"local",name:"Local Filesystem",alive:localReady,tools:localReady ? localTools().length : 0}]) : blenderServers(serversCache), engine: mode,
    blender: blenderAddon, blender_error: blenderError || undefined, bridge_error: bridgeError || undefined,
  };
}

async function refreshProcStatus() {
  if (procStatusReading) return;
  procStatusReading = true;
  try {
    // Bounded by the bridgeFetch default timeout.
    const r = await bridgeFetch(`${RUST_ROBLOX_HTTP}/api/status`, { method: "GET" });
    if (!r.ok) return;
    const j = await r.json();
    if (!rustMode) { rustMode = true; await initialDesktopPreferencesSync();  }
    // The desktop's editor probe is authoritative; a browser socket or a
    // process-name scan alone cannot establish Studio readiness.
    if(typeof j.blender_connected==="boolean" && !blenderSuppressed && j.blender_connected!==blenderAddon)setBlender(j.blender_connected,j.blender_connected ? "" : "Blender’s last scene check failed. Use Connect Blender for the exact error.");
    const editor = typeof j.roblox_connected === "boolean" ? j.roblox_connected : robloxEditorConnected;
    const nr = j.roblox_proc === true || editor;
    const editorChanged = editor !== robloxEditorConnected;
    robloxEditorConnected = editor;
    const nl = j.local_ready === true;
    const nf = j.local_full === true;
    const nrRoot = typeof j.local_root === "string" ? j.local_root : localRoot;
    const changed = editorChanged || nr !== robloxProc || nl !== localReady || nf !== localFull || nrRoot !== localRoot;
    robloxProc = nr;
    localReady = nl;
    localFull = nf;
    localRoot = nrRoot;
    // One-shot re-sync: if the agent restarted with FULL off but the user's
    // persisted toggle says ON, re-apply their choice once.
    if (!fullSyncedOnce) {
      fullSyncedOnce = true;
      try {
        chrome.storage.local.get("rs-local-full", (o) => {
          const want = o && o["rs-local-full"];
          if (typeof want === "boolean" && want !== nf) {
            bridgeFetch("http://127.0.0.1:3000/api/local-full", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: want }), signal: AbortSignal.timeout(5000),
            }).then((r2) => r2.json()).then((j2) => { localFull = j2.local_full === true; broadcastStatus(); }).catch(() => {});
          }
        });
      } catch {}
    }
    if (changed) broadcastStatus();
    await pullDesktopPreferences();
  } catch {} finally { procStatusReading = false; }
}
// Single-flight: the 5 s interval must never stack status reads on a slow bridge.
let procStatusReading = false;

let updateSnapshot=null,updateStatusAt=0,updateStatusFlight=null;
async function readUpdateStatus(force=false){
  if(!force && updateSnapshot && Date.now()-updateStatusAt<4000)return updateSnapshot;
  if(updateStatusFlight)return updateStatusFlight;
  updateStatusFlight=(async()=>{
    const response=await bridgeFetch("http://127.0.0.1:3000/api/updates/status",{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error("Обновите приложение Elio до версии с поддержкой обновлятора.");
    const value=await response.json();if(!value.ok)throw Error(value.error||"Не удалось прочитать статус обновления.");
    updateSnapshot=value.update;updateStatusAt=Date.now();return updateSnapshot;
  })().finally(()=>{updateStatusFlight=null;});
  return updateStatusFlight;
}
async function updateAction(action){
  if(action==='reload'){
    if([...runTabs.values()].some(at=>Date.now()-at<RUN_BEAT_TTL_MS))throw Error("Сначала завершите задачи агента.");
    setTimeout(()=>chrome.runtime.reload(),500);return {ok:true};
  }
  if(!['check','install'].includes(action))throw Error("Неизвестное действие обновления.");
  const response=await bridgeFetch("http://127.0.0.1:3000/api/updates/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(6000)});
  const value=await response.json();if(!response.ok||!value.ok)throw Error(value.error||"Обновление не запущено.");
  updateStatusAt=0;return value;
}
const browserIdentity = crypto.randomUUID();
let desktopPinnedTab = null;
let desktopLastTab = null;
const desktopPinReady = chrome.storage.session.get("elioDesktopPinnedTab").then(value => {
  desktopPinnedTab = Number.isInteger(value.elioDesktopPinnedTab) ? value.elioDesktopPinnedTab : null;
}).catch(() => {});
let desktopAgentReporting = false;
let desktopAgentError = null;
async function reportDesktopAgentState() {
  if (desktopAgentReporting || !rustMode) return;
  desktopAgentReporting = true;
  try {
    await desktopPinReady;
    let tab;
    if (desktopPinnedTab !== null) {
      try { tab = await chrome.tabs.get(desktopPinnedTab); }
      catch { desktopPinnedTab = null; await chrome.storage.session.remove("elioDesktopPinnedTab"); }
    }
    if (!tab) {
      const focused=await chrome.windows.getLastFocused().catch(()=>null);
      if(focused?.focused || desktopLastTab===null)tab=(await chrome.tabs.query({active:true,lastFocusedWindow:true,url:PROVIDER_URLS}))[0];
      if(!tab && desktopLastTab!==null)try{const prior=await chrome.tabs.get(desktopLastTab);if(PROVIDER_URLS.some(pattern=>new RegExp('^'+pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$').test(prior.url||'')))tab=prior;}catch{desktopLastTab=null;}
      if(tab)desktopLastTab=tab.id;
    }
    let control = { canStart: false, canStop: false, pageMounted:false, barVisible:false, status: "Select a supported AI chat in your browser." };
    if (tab && Number.isInteger(tab.id)) {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: "rs-desktop-agent-state" });
        if (reply) {
          control = { ...reply, tab_id: tab.id };
          // Desktop controls do not depend on the browser bar being in the viewport.
        }
      } catch { control.status = "Refresh the selected AI chat to reconnect Elio."; }
    }
    if(tab && Number.isInteger(tab.id))control.tab_id=tab.id;
    control.canChatPin=Number.isInteger(control.tab_id);
    control.any_running=control.canStop===true || [...runTabs.values()].some(at=>Date.now()-at<RUN_BEAT_TTL_MS);
    control.browser_id=browserIdentity;
    control.pinned=desktopPinnedTab !== null;
    try {control.browser_focused=(await chrome.windows.getLastFocused()).focused===true;}catch{control.browser_focused=false;}
    if (desktopAgentError && Date.now() < desktopAgentError.until) control.status = desktopAgentError.message;
    await bridgeFetch("http://127.0.0.1:3000/api/desktop/browser-agent", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(control), signal: AbortSignal.timeout(3000),
    });
  } catch {} finally { desktopAgentReporting = false; }
}
async function dispatchDesktopAgentAction(msg) {
  if(msg.browser_id && msg.browser_id!==browserIdentity)return;
  let actionResult;
  try {
    if (!Number.isInteger(msg.tab_id) || !["start", "stop", "enhance", "engine-set", "cowork-on", "cowork-off", "cowork-queue", "cowork-resume", "cowork-remove", "memory-export", "memory-import", "media-stage", "handoff-export", "budget-resume", "task-send", "chat-read", "chat-pin", "activity-read", "creator-send", "creator-insert"].includes(msg.action)) throw new Error("Invalid desktop agent action.");
    // Validate identity at the final hop, not only against the last heartbeat.
    if (msg.expected_chat) {
      const current = await chrome.tabs.sendMessage(msg.tab_id, {type:"rs-desktop-agent-state"});
      if (current?.chat !== msg.expected_chat) throw new Error("The selected conversation changed. Review it before sending.");
    }
    let reply;
    if (msg.action === "chat-pin") {
      await desktopPinReady;
      desktopPinnedTab = msg.prompt === "off" ? null : msg.tab_id;
      if (desktopPinnedTab === null) await chrome.storage.session.remove("elioDesktopPinnedTab");
      else await chrome.storage.session.set({elioDesktopPinnedTab:desktopPinnedTab});
      reply = {ok:true,pinned:desktopPinnedTab !== null};
    } else reply = await chrome.tabs.sendMessage(msg.tab_id, { type: "rs-desktop-agent-action", action: msg.action, prompt: msg.prompt, request_id: msg.request_id, expected_chat:msg.expected_chat });
    actionResult = reply;
    if (!reply || !reply.ok) throw new Error(reply && reply.error || "The AI tab did not accept the action.");
  } catch (error) {
    actionResult = { ok: false, error: String(error.message || error) };
    desktopAgentError = { message: String(error.message || error), until: Date.now() + 5000 };
  }
  if (msg.request_id) {
    try { await bridgeFetch("http://127.0.0.1:3000/api/desktop/agent-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: msg.request_id, result: actionResult }) }); } catch {}
  }
  await reportDesktopAgentState();
}
setInterval(() => { reportDesktopAgentState(); }, 750);

// ── Unattended runs ─────────────────────────────────────────────────────────
// A content script with an agent run sends rs-run-beat. While a tab is running:
//  * the browser may not auto-discard it (Edge sleeping tabs, Chrome memory
//    saver), which would silently end an overnight task;
//  * every second the tab gets rs-wake, which resolves only sleeps whose
//    deadline already passed. Hidden or occluded tabs (Studio maximized over
//    the browser, a locked screen) otherwise get one timer wake-up per minute
//    after five minutes, slowing every turn to minutes;
//  * the desktop bridge is told work is in progress, so an automatic desktop
//    update never restarts it during a long model reply with no tool calls.
const RUN_BEAT_TTL_MS = 180000;
const runTabs = new Map();
let lastActivityPost = 0;
function releaseRunTab(tabId) {
  if (!runTabs.delete(tabId)) return;
  try { const p = chrome.tabs.update(tabId, { autoDiscardable: true }); if (p && p.catch) p.catch(() => {}); } catch {}
}
function noteRunBeat(tabId, running) {
  if (!Number.isInteger(tabId)) return;
  if (!running) { releaseRunTab(tabId); return; }
  if (!runTabs.has(tabId)) {
    try { const p = chrome.tabs.update(tabId, { autoDiscardable: false }); if (p && p.catch) p.catch(() => {}); } catch {}
  }
  runTabs.set(tabId, Date.now());
  if (rustMode && Date.now() - lastActivityPost > 30000) {
    lastActivityPost = Date.now();
    bridgeFetch(`${RUST_ROBLOX_HTTP}/api/desktop/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [tabId, at] of runTabs) {
    if (now - at > RUN_BEAT_TTL_MS) { releaseRunTab(tabId); continue; }
    try { const p = chrome.tabs.sendMessage(tabId, { type: "rs-wake" }); if (p && p.catch) p.catch(() => {}); } catch {}
  }
}, 1000);
chrome.tabs.onRemoved?.addListener(tabId => { runTabs.delete(tabId); });

function broadcastStatus() {
  chrome.runtime.sendMessage(statusObj()).catch(() => {});
  chrome.tabs.query({ url: PROVIDER_URLS }, (tabs) => {
    for (const t of tabs) tabEngine(t.id).then(mode=>chrome.tabs.sendMessage(t.id, statusObj(mode))).catch(() => {});
  });
}


// ── Web tools (search + fetch) ──────────────────────────────────────────────
// Health notes (why this is not one DDG call anymore):
//  * html.duckduckgo.com/html/ is the endpoint elio used to scrape with a
//    "elio/1.0" UA. DDG now treats that as an anomaly: it answers 202/403 with a
//    challenge page that contains ZERO .result__a anchors, so the old parser
//    returned [] and the tool reported "no results" on every query.
//  * A browser UA + Accept-Language + Referer is required for the same URL to
//    serve real results, and even then DDG rate-limits datacenter IPs.
//  * So: try several independent backends in order, use a REAL browser UA, and
//    fall back to a generic anchor parser per backend (markup drifts; a
//    changed class name must not zero out the whole tool).
// Every backend failure is collected and reported, so "it doesn't work" is
// always accompanied by WHY (status codes included) instead of a bare "no
// results for X".
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const WEB_FETCH_TIMEOUT = 20000;
// Ollama (127.0.0.1:11434) and Roblox web requests use other hosts, so they never
// block the bridge connection pool, but a hung request used to leave the Ollama
// page or a dev-product tool waiting forever. Every one now has a hard deadline.
// Chat gets a long one: a large local model on a CPU can take minutes to answer.
const OLLAMA_TAGS_TIMEOUT_MS = 5000;
const OLLAMA_CHAT_TIMEOUT_MS = 600000;
const ROBLOX_FETCH_TIMEOUT_MS = 20000;
const isTimeoutError = (e) => !!e && (e.name === "TimeoutError" || e.name === "AbortError");
const WEB_SEARCH_TIMEOUT = 12000;

function webHeaders(extra, referer) {
  const h = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };
  if (referer) h.Referer = referer;
  return Object.assign(h, extra || {});
}

// A hung fetch is worse than a failed one: the content script's bg() has no
// timeout of its own, so an endpoint that never answers used to spin the tool
// forever. AbortController gives every request a hard deadline.
async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const callerSignal = opts && opts.signal;
  const cancel = () => { try { controller.abort(callerSignal.reason); } catch {} };
  if (callerSignal) { if (callerSignal.aborted) cancel(); else callerSignal.addEventListener("abort", cancel, { once: true }); }
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, Object.assign({ redirect: "follow" }, opts || {}, { signal: controller.signal }));
        // Keep the same deadline through the body. Headers alone are not a
        // completed request: a server can stop sending immediately afterward.
        const body = await response.text();
        return { ok: response.ok, status: response.status, headers: response.headers, url: response.url, text: async () => body };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Web request timed out before its complete response arrived")); }, ms || WEB_FETCH_TIMEOUT); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", cancel);
  }
}

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  middot: "·", times: "×", deg: "°", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
};
function decodeEntities(s) {
  // Numeric forms first, then named. &amp; is decoded LAST via a single pass so
  // a literal "&amp;lt;" does not turn into "<" (double-decoding).
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return " "; } })
    .replace(/&([a-z#0-9x]+);/gi, (m, name) => {
      const key = String(name).toLowerCase();
      if (key === "amp") return "&";
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// DDG wraps every result link as /l/?uddg=<urlencoded>&rut=…
function unwrapDdg(href) {
  let h = String(href || "").trim();
  if (h.startsWith("//")) h = "https:" + h;
  const m = h.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return h; } }
  const m2 = h.match(/[?&]url=([^&]+)/);
  if (m2 && /duckduckgo\.com\/l\//.test(h)) { try { return decodeURIComponent(m2[1]); } catch {} }
  return h;
}

function cleanHits(list, n, engineHost) {
  const out = [];
  const seen = new Set();
  for (const r of list) {
    let url = String((r && r.url) || "").trim();
    const title = stripTags((r && r.title) || "");
    if (!/^https?:\/\//i.test(url)) continue;
    if (engineHost && url.includes(engineHost)) continue;
    if (!title || title.length < 3) continue;
    const key = url.replace(/[#?].*$/, "").replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 180), url });
    if (out.length >= n) break;
  }
  return out;
}

// Last-resort parser: ANY anchor with an http(s) href and real text. Used when
// a backend's markup changed (or is unknown) so the tool still returns hits.
function parseGenericAnchors(html, n, engineHost) {
  const hits = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    const url = unwrapDdg(m[1]);
    const title = stripTags(m[2]);
    if (!title || title.length < 12 || title.length > 180) continue;
    hits.push({ url, title });
  }
  return cleanHits(hits, n, engineHost);
}

function parseDdgHtml(html, n) {
  const hits = [];
  const re = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) hits.push({ url: unwrapDdg(m[1]), title: m[2] });
  // class before href (older markup) — attribute order is not guaranteed.
  if (!hits.length) {
    const re2 = /<a\b[^>]*href=["']([^"']+)["'][^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(String(html || ""))) !== null) hits.push({ url: unwrapDdg(m[1]), title: m[2] });
  }
  const clean = cleanHits(hits, n, "duckduckgo.com");
  return clean.length ? clean : parseGenericAnchors(html, n, "duckduckgo.com");
}

function parseDdgLite(html, n) {
  const hits = [];
  const re = /<a\b[^>]*class="[^"]*result-link[^"]*"[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) hits.push({ url: unwrapDdg(m[1]), title: m[2] });
  const clean = cleanHits(hits, n, "duckduckgo.com");
  return clean.length ? clean : parseGenericAnchors(html, n, "duckduckgo.com");
}

function parseMojeek(html, n) {
  const hits = [];
  const re = /<a\b[^>]*class="[^"]*\bob\b[^"]*"[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) hits.push({ url: m[1], title: m[2] });
  if (!hits.length) {
    const re2 = /<h2>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(String(html || ""))) !== null) hits.push({ url: m[1], title: m[2] });
  }
  const clean = cleanHits(hits, n, "mojeek.com");
  return clean.length ? clean : parseGenericAnchors(html, n, "mojeek.com");
}

// Wikipedia has a real JSON API with CORS — not scraped, so it never breaks.
// Not a general web search, but an excellent last resort for API/property
// questions and it keeps the tool useful when every scraper is blocked.
function parseWikipedia(json, n) {
  const out = [];
  try {
    const rows = (JSON.parse(json).query || {}).search || [];
    for (const r of rows) {
      out.push({
        title: r.title + " — Wikipedia",
        url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(r.title).replace(/ /g, "_")),
      });
      if (out.length >= n) break;
    }
  } catch {}
  return out;
}

const SEARCH_BACKENDS = [
  { id: "duckduckgo", url: (q) => "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), parse: parseDdgHtml, referer: "https://duckduckgo.com/" },
  { id: "ddg-lite", url: (q) => "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q), parse: parseDdgLite, referer: "https://lite.duckduckgo.com/" },
  { id: "mojeek", url: (q) => "https://www.mojeek.com/search?q=" + encodeURIComponent(q), parse: parseMojeek, referer: "https://www.mojeek.com/" },
  { id: "wikipedia", url: (q) => "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=" + encodeURIComponent(q), parse: parseWikipedia, json: true, referer: "https://en.wikipedia.org/" },
];

// Try every backend until one yields hits. Returns { hits, backend, notes }.
async function webSearch(query, limit) {
  const q = String(query || "").trim();
  const n = Math.max(1, Math.min(8, Number(limit) || 3));
  if (!q) return { hits: [], backend: null, notes: ["empty query"] };
  const notes = [];
  for (const b of SEARCH_BACKENDS) {
    try {
      const extra = b.json ? { Accept: "application/json,text/plain,*/*" } : null;
      const res = await fetchWithTimeout(b.url(q), { headers: webHeaders(extra, b.referer) }, WEB_SEARCH_TIMEOUT);
      if (!res.ok) { notes.push(`${b.id}: HTTP ${res.status}`); continue; }
      const body = await res.text();
      const hits = b.parse(body, n);
      if (hits.length) return { hits, backend: b.id, notes };
      notes.push(`${b.id}: no results parsed${/anomaly|captcha|unusual traffic/i.test(body) ? " (bot challenge page)" : ""}`);
    } catch (e) {
      notes.push(`${b.id}: ${String((e && e.message) || e).slice(0, 90)}`);
    }
  }
  return { hits: [], backend: null, notes };
}

function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre|ul|ol|table)>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote|pre|ul|ol|table)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return s;
}

// A JS-only shell ("enable JavaScript", a few hundred chars) is not a page we
// can read; the reader proxy renders it server-side and returns Markdown.
function looksLikeShell(text) {
  const t = String(text || "");
  if (t.length < 400) return true;
  return /enable javascript|javascript is (required|disabled)|checking your browser|just a moment|cf-browser-verification/i.test(t.slice(0, 600));
}
async function readerFallback(url, maxChars) {
  const res = await fetchWithTimeout("https://r.jina.ai/" + url, { headers: webHeaders() }, WEB_FETCH_TIMEOUT);
  if (!res.ok) throw new Error("reader HTTP " + res.status);
  let text = await res.text();
  if (!text || text.length < 40) throw new Error("reader returned nothing");
  const orig = text.length;
  if (orig > maxChars) text = text.slice(0, maxChars) + `\n\n…[truncated ${orig - maxChars} chars]`;
  return text;
}


// ── Blender (one-shot TCP 9876 via AgentScript) ─────────────────────────
// Native elio.exe rejects add_server/uvx. Chrome cannot open raw TCP.
// Connect is a short PowerShell/Python probe of the blender-mcp addon the
// user already started. Tool calls write a JSON request, run blender_once,
// then read the JSON response. No daemon, so the agent console is not
// flooded with failed `start /B py` / shim-restart loops.
function isBlenderToolName(name) {
  const bare = String(name || "").split("__").pop().split("/").pop().split(".").pop();
  return /^blender__/.test(String(name || "")) || BLENDER_TOOL_NAMES.has(bare) || /^blender_/.test(bare);
}
const BLENDER_KEY = "rs-blender-on";
// Persist intent, not a stale connected flag. Verify an addon response on startup.
try { chrome.storage?.local.get(BLENDER_KEY, o => { if(o?.[BLENDER_KEY]) connectBlender(); }); } catch {}
function setBlender(on, err) {
  const was = blenderAddon;
  blenderAddon = !!on;
  if (on) blenderWasConnected = true;
  blenderError = on ? "" : (err || blenderError);
  try { chrome.storage.local.set({ [BLENDER_KEY]: !!on }); } catch {}
  if (was !== blenderAddon) broadcastStatus();
}

async function sendLocalEngine(obj, timeout = 25000) {
  try { await ensurePairing(); } catch (error) { return { ok: false, error: error.message }; }
  if (engine === "local" && connected && ws && ws.readyState === WebSocket.OPEN) {
    return send(obj, timeout);
  }
  return await new Promise((resolve) => {
    let sock;
    try { sock = new WebSocket(`ws://127.0.0.1:${PORT_LOCAL}`, pairingProtocols()); }
    catch (e) { resolve({ ok: false, error: "elio.exe is not running" }); return; }
    const id = 800000 + Math.floor(Math.random() * 99999);
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.close(); } catch {}
      resolve(v);
    };
    const timer = setTimeout(() => done({ ok: false, error: "elio.exe did not answer — is it running?" }), timeout);
    sock.onerror = () => done({ ok: false, error: "AgentScript connection failed. Start elio and allow the extension access to localhost in this browser." });
    sock.onopen = () => {
      try { sock.send(JSON.stringify({ ...obj, id })); }
      catch (e) { done({ ok: false, error: String(e) }); }
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "connected") {
        if (typeof msg.workspace_root === "string" && msg.workspace_root) localRoot = msg.workspace_root;
        return;
      }
      if (["tools","mcp_status","studio_status"].includes(msg.type) && msg.id === id) { done(msg); return; }
      if (msg.type === "tool_result" && (msg.id == null || msg.id === id)) {
        done(msg.ok ? { ok: true, text: msg.text } : { ok: false, error: msg.error || "tool failed" });
        return;
      }
      if (msg.type === "error" && (msg.id == null || msg.id === id)) {
        done({ ok: false, error: msg.error || "error" });
      }
    };
  });
}

async function extText(name) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(chrome.runtime.getURL(name), { signal: controller.signal });
        if (!response.ok) throw new Error("extension file missing: " + name);
        return await response.text();
      })(),
      new Promise((_, reject) => { timer=setTimeout(() => { controller.abort(); reject(new Error("Extension file read timed out: " + name)); }, 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function localWrite(path, content) {
  const r = await sendLocalEngine({
    type: "call_tool", name: "write_file",
    arguments: { path, content },
  }, 20000);
  if (!r || !r.ok) throw new Error((r && r.error) || ("could not write " + path));
  return r.text || "";
}

async function localRead(path, offset) {
  const r = await sendLocalEngine({
    type: "call_tool", name: "read_file",
    arguments: { path, offset: offset || 1, limit: 4000 },
  }, 20000);
  if (!r || !r.ok) throw new Error((r && r.error) || ("could not read " + path));
  const lines = String(r.text || "").split("\n");
  const body = [];
  let more = false;
  let next = offset || 1;
  for (const ln of lines) {
    const cont = ln.match(/\.\.\. lines (\d+)/);
    if (cont) { more = true; next = Number(cont[1]); continue; }
    const m = ln.match(/^\s*\d+\s+\|\s(.*)$/);
    if (m) body.push(m[1]);
  }
  return { text: body.join("\n"), more, next, count: body.length };
}
async function localReadAll(path) {
  let offset = 1, chunks = [];
  for (let i = 0; i < 20; i++) {
    const part = await localRead(path, offset);
    if (part.text) chunks.push(part.text);
    if (!part.more || !part.count) break;
    offset = part.next || (offset + part.count);
  }
  return chunks.join("\n");
}

// Read ANY workspace file as base64 (images/binaries included) through the
// native AgentScript engine. This is the ONLY way browser-side code can get at
// bytes on disk, so it backs every "attach this file / screenshot" feature.
async function localReadBase64(path) {
  const r = await sendLocalEngine({ type: "call_tool", name: "read_file_base64", arguments: { path } }, 30000);
  if (!r || !r.ok) throw new Error((r && r.error) || ("could not read " + path));
  let parsed = null;
  try { parsed = JSON.parse(String(r.text || "")); } catch {}
  if (!parsed || !parsed.data) throw new Error("the bridge returned no file data for " + path);
  return parsed;
}

async function localRun(command, timeoutSeconds = 12) {
  return sendLocalEngine({
    type: "call_tool", name: "run_command",
    arguments: { command, timeout_seconds: timeoutSeconds },
  }, (timeoutSeconds + 8) * 1000);
}

function probeCommands(win) {
  if (win) {
    return [
      "powershell -NoProfile -Command try{$c=New-Object Net.Sockets.TcpClient;$c.ReceiveTimeout=2500;$c.Connect('127.0.0.1',9876);$c.Close();Write-Output BLENDER_UP}catch{Write-Output BLENDER_DOWN}",
    ];
  }
  return [
    "python3 -c \"import socket;s=socket.create_connection(('127.0.0.1',9876),2);s.close();print('BLENDER_UP')\"",
    "python -c \"import socket;s=socket.create_connection(('127.0.0.1',9876),2);s.close();print('BLENDER_UP')\"",
    "(echo >/dev/tcp/127.0.0.1/9876) >/dev/null 2>&1 && echo BLENDER_UP || echo BLENDER_DOWN",
  ];
}

async function probeBlenderTcp() {
  let plat = { os: "win" };
  try { plat = await chrome.runtime.getPlatformInfo(); } catch {}
  const win = plat.os === "win";
  let last = "";
  for (const cmd of probeCommands(win)) {
    const r = await localRun(cmd, 8);
    const text = String((r && (r.text || r.error)) || "");
    last = text;
    if (/BLENDER_UP/.test(text)) return { ok: true };
    if (r && r.ok === false && /not running|not connected|timeout/i.test(text)) {
      return { ok: false, error: "elio.exe is not running — start it, then Connect Blender again." };
    }
  }
  const down = /BLENDER_DOWN/.test(last);
  const err = down
    ? "Blender addon is not on port 9876. In Blender: press N → MCP for Blender → Start MCP Server."
    : (last && last.slice(0, 220)) || "Could not reach Blender. Run elio.exe, then Start MCP Server in Blender.";
  return { ok: false, error: err };
}

async function blenderRequest(payload, timeout=120000) {
  const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/blender",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,timeout_seconds:Math.ceil(timeout/1000)}),signal:AbortSignal.timeout(timeout+4000)});
  if(!response.ok) throw Error("Blender bridge request failed (HTTP "+response.status+"). Update the desktop app and extension together.");
  return response.json();
}
async function connectBlender() {
  blenderSuppressed=false;
  try {
    const ping=await blenderRequest({type:"get_scene_info",params:{}},8000);
    if(!ping.ok) throw Error(ping.error || "Blender did not answer its scene check.");
    setBlender(true,"");broadcastStatus();return {ok:true,blender:true};
  } catch(error) {const message=String(error.message || error);setBlender(false,message);broadcastStatus();return {ok:false,blender:false,error:message};}
}

async function agentWorkspaceRoot() {
  if (localRoot) return localRoot;
  const r = await sendLocalEngine({ type: "call_tool", name: "workspace_info", arguments: {} }, 12000);
  const t = String((r && r.text) || "");
  const m = t.match(/Workspace root:\s*(.+)/);
  if (m) { localRoot = m[1].trim(); return localRoot; }
  return "";
}

function pyLiteral(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(pyLiteral).join(", ") + "]";
  const parts = [];
  for (const [k, val] of Object.entries(v)) parts.push(JSON.stringify(k) + ": " + pyLiteral(val));
  return "{" + parts.join(", ") + "}";
}

const BLENDER_CMD = {
  blender_export_fbx: "export_fbx", export_blender_fbx: "export_fbx",
  blender_import_fbx: "import_fbx", import_blender_fbx: "import_fbx",
  blender_export_obj: "export_obj", blender_import_obj: "import_obj",
  blender_mesh_dump: "dump", blender_send_to_studio: "dump",
  blender_group: "group", blender_ungroup: "ungroup",
  blender_parent: "parent", blender_unparent: "unparent", blender_join: "join",
  blender_move_to_collection: "move_to_collection",
  blender_list_collections: "list_collections", blender_list_objects: "list_objects",
  blender_delete: "delete", blender_duplicate: "duplicate", blender_rename: "rename",
  blender_select: "select", blender_transform: "transform",
  blender_apply_transforms: "apply_transforms", blender_set_origin: "set_origin",
  blender_shade_smooth: "shade_smooth", blender_set_material: "set_material",
  // ── Material toolkit (node-based; version-safe across Blender 3.x/4.x) ──
  blender_material_create: "material_create", blender_material_new: "material_create",
  blender_make_material: "material_create", blender_material_preset: "material_preset",
  blender_material_apply_preset: "material_preset", blender_material_set: "material_set",
  blender_material_edit: "material_set", blender_material_assign: "material_assign",
  blender_material_apply: "material_assign", blender_material_list: "material_list",
  blender_materials: "material_list", blender_material_inspect: "material_inspect",
  blender_material_info: "material_inspect", blender_material_remove: "material_remove",
  blender_material_delete: "material_remove", blender_material_noise: "material_noise",
  blender_material_texture: "material_noise", blender_material_image: "material_image",
  blender_material_texture_image: "material_image", blender_material_pbr: "material_pbr",
  blender_material_maps: "material_pbr",
  blender_add_modifier: "add_modifier", blender_boolean: "boolean",
  blender_add_cube: "add_cube", blender_add_sphere: "add_sphere",
  blender_add_cylinder: "add_cylinder", blender_add_cone: "add_cone",
  blender_add_plane: "add_plane", blender_add_torus: "add_torus",
  blender_add_monkey: "add_monkey", blender_add_empty: "add_empty",
  blender_add_camera: "add_camera", blender_add_light: "add_light",
  blender_add_ico_sphere: "add_ico_sphere", blender_add_grid: "add_grid",
  blender_add_circle: "add_circle", blender_add_text: "add_text",
  blender_clear_scene: "clear_scene",
  blender_select_all: "select_all", blender_deselect: "deselect",
  blender_invert_selection: "invert_selection", blender_select_children: "select_children",
  blender_get_selection: "get_selection",
  blender_translate: "translate", blender_rotate: "rotate_deg", blender_rotate_deg: "rotate_deg",
  blender_set_dimensions: "set_dimensions",
  blender_origin_to_bottom: "origin_to_bottom", blender_drop_to_ground: "drop_to_ground",
  blender_center: "center", blender_snap_to_grid: "snap_to_grid",
  blender_shade_flat: "shade_flat",
  blender_apply_modifiers: "apply_modifiers", blender_remove_modifier: "remove_modifier",
  blender_triangulate: "triangulate", blender_decimate: "decimate",
  blender_merge: "merge", blender_recalc_normals: "recalc_normals",
  blender_flip_normals: "flip_normals", blender_separate: "separate_loose",
  blender_subdivide: "subdivide", blender_uv_unwrap: "uv_unwrap",
  blender_array: "array", blender_mirror: "mirror",
  blender_hide: "hide", blender_unhide: "unhide", blender_unhide_all: "unhide_all",
  blender_hide_unselected: "hide_unselected",
  blender_undo: "undo", blender_redo: "redo",
  blender_frame_selected: "frame_selected", blender_stats: "stats",
  blender_save: "save_blend", blender_look_at: "look_at",
  blender_convert_to_mesh: "convert_to_mesh",
  blender_align_camera: "align_camera_axis", blender_align_camera_axis: "align_camera_axis",
  blender_view_axis: "view_axis", blender_camera_to_view: "camera_to_view",
  blender_set_camera_lens: "set_camera_lens",
  blender_scale: "scale", blender_bevel: "bevel", blender_solidify: "solidify",
  blender_extrude: "extrude", blender_add_curve: "add_curve", blender_add_armature: "add_armature",
  blender_keyframe: "keyframe_insert", blender_keyframe_insert: "keyframe_insert",
  blender_set_frame: "set_frame", blender_set_active_camera: "set_active_camera",
  blender_track_to: "track_to", blender_cursor_to_selected: "cursor_to_selected",
  blender_randomize: "randomize_transform", blender_randomize_transform: "randomize_transform",
  blender_hide_render: "hide_render", blender_subdivision: "subdivision",
  blender_subsurf: "subdivision", blender_origin_to_geometry: "origin_to_geometry",
};

async function blenderOpsCode(cmd, args) {
  let py = await extText("blender_ops.py");
  const status = "elio_status.json";
  const mesh = "elio_mesh.json";
  py = py.split("__ELIO_CMD__").join(String(cmd || ""));
  py = py.split("__ELIO_ARGS__").join(JSON.stringify(args || {}));
  py = py.split("__ELIO_OUT__").join(JSON.stringify(status || "elio_status.json"));
  py = py.split("__ELIO_MESH__").join(JSON.stringify(mesh || "elio_mesh.json"));
  return { py, status, mesh };
}

function wrapBlenderUserCode(code) {
  const src = String(code || "");
  if (!src.trim()) return src;
  if (src.indexOf("_elio_items") >= 0 && src.indexOf("_elio_src =") >= 0) return src;
  return [
    "import bpy, re as _elio_re",
    "_elio_src = " + JSON.stringify(src),
    "try:",
    "    _elio_items = set(getattr(it, 'identifier', str(it)) for it in bpy.context.scene.render.bl_rna.properties['engine'].enum_items)",
    "except Exception:",
    "    _elio_items = set()",
    "if 'BLENDER_EEVEE_NEXT' not in _elio_items and 'BLENDER_EEVEE' in _elio_items:",
    "    _elio_src = _elio_src.replace('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE')",
    "elif 'BLENDER_EEVEE' not in _elio_items and 'BLENDER_EEVEE_NEXT' in _elio_items:",
    "    _elio_src = _elio_re.sub(r'BLENDER_EEVEE(?!_NEXT)', 'BLENDER_EEVEE_NEXT', _elio_src)",
    "if not hasattr(bpy.context.scene, 'eevee_next') and hasattr(bpy.context.scene, 'eevee'):",
    "    _elio_src = _elio_src.replace('.eevee_next', '.eevee')",
    "exec(compile(_elio_src, '<or_blender>', 'exec'))",
  ].join("\n");
}

// 1.24.14: fresh Blender viewport capture.
// The blender-mcp addon's get_viewport_screenshot copies the 3D View's LAST
// DRAWN framebuffer. Blender stops redrawing while its window is in the
// background (the user is in the browser), so every capture returned the same
// stale pixels under a new file name. Render the viewport off-screen from the
// live scene instead (independent of window redraws), force a redraw before
// the screen-copy fallback, and report a content hash so stale shots are
// visible.
function blenderShotCode(filepath, maxSize) {
  const fp = JSON.stringify(String(filepath));
  const mx = Math.max(64, Math.min(4096, Number(maxSize) || 1000));
  return [
    "import bpy, json, os, hashlib, time",
    "FP = " + fp,
    "MAX = " + mx,
    "res = {'filepath': FP}",
    "win = area = reg = None",
    "for w in bpy.context.window_manager.windows:",
    "    for a in w.screen.areas:",
    "        if a.type == 'VIEW_3D' and area is None:",
    "            for r in a.regions:",
    "                if r.type == 'WINDOW': win, area, reg = w, a, r",
    "if area is None: raise RuntimeError('No 3D Viewport is open in Blender, so there is nothing to capture.')",
    "space = area.spaces.active; rv3d = space.region_3d",
    "if os.path.exists(FP): os.remove(FP)",
    "W, H = reg.width, reg.height",
    "s = min(1.0, MAX / float(max(W, H)))",
    "W2, H2 = max(64, int(W * s)), max(64, int(H * s))",
    "try:",
    "    import gpu",
    "    off = gpu.types.GPUOffScreen(W2, H2)",
    "    try:",
    "        try: off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, reg, rv3d.view_matrix, rv3d.window_matrix, do_color_management=True)",
    "        except TypeError: off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, reg, rv3d.view_matrix, rv3d.window_matrix)",
    "        with off.bind():",
    "            buf = gpu.state.active_framebuffer_get().read_color(0, 0, W2, H2, 4, 0, 'UBYTE')",
    "    finally:",
    "        off.free()",
    "    buf.dimensions = W2 * H2 * 4",
    "    try:",
    "        import numpy as np",
    "        px = (np.array(buf, dtype=np.float32) / 255.0)",
    "        px[3::4] = 1.0",
    "        flat = px",
    "    except Exception:",
    "        flat = [v / 255.0 for v in buf]",
    "        for i in range(3, len(flat), 4): flat[i] = 1.0",
    "    img = bpy.data.images.new('_elio_shot', W2, H2, alpha=True)",
    "    try:",
    "        img.pixels.foreach_set(flat)",
    "        img.filepath_raw = FP; img.file_format = 'PNG'; img.save()",
    "    finally:",
    "        bpy.data.images.remove(img)",
    "    res['method'] = 'offscreen'",
    "except Exception as e:",
    "    res['offscreen_error'] = str(e)[:200]",
    "    with bpy.context.temp_override(window=win, area=area, region=reg):",
    "        try: bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)",
    "        except Exception: pass",
    "        bpy.ops.screen.screenshot_area(filepath=FP)",
    "    res['method'] = 'screenshot_area'",
    "if not os.path.isfile(FP): raise RuntimeError('Blender did not write the capture file ' + FP)",
    "raw = open(FP, 'rb').read()",
    "res['bytes'] = len(raw); res['sha1'] = hashlib.sha1(raw).hexdigest()[:12]; res['size'] = [W2, H2]",
    "res['taken'] = time.strftime('%H:%M:%S')",
    "print('ELIO_SHOT_JSON:' + json.dumps(res))",
  ].join("\n");
}

async function blenderPayload(name, args) {
  const bare = String(name || "").split("__").pop().split("/").pop().split(".").pop();
  const a = args || {};
  if (bare === "get_scene_info" || bare === "blender_get_scene_info") return { type: "get_scene_info", params: {} };
  if (bare === "get_object_info" || bare === "blender_get_object_info") return { type: "get_object_info", params: { name: a.name || a.object_name || "" } };
  if (bare === "execute_blender_code" || bare === "execute_code" || bare === "blender_execute_code") return { type: "execute_code", params: { code: wrapBlenderUserCode(a.code || "") } };
  if (bare === "get_viewport_screenshot" || bare === "blender_screenshot") {
    const relativeShot = "elio_blender_shot_" + crypto.randomUUID() + ".png";
    let shot = relativeShot;
    const root = await agentWorkspaceRoot();
    if (root) shot = root.replace(/[\\/]+$/, "") + "/" + relativeShot;
    // _orShot: the exact path we asked Blender to write, so blenderCall can read
    // the pixels back (see the screenshot branch there) without guessing.
    return { type: "execute_code", params: { code: blenderShotCode(shot, a.max_size) }, _orShot: shot, _orReadShot: relativeShot, _orIsShot: true };
  }
  const mapped = BLENDER_CMD[bare];
  if (mapped) {
    const packed = await blenderOpsCode(mapped, a);
    return { type: "execute_code", params: { code: packed.py }, _orStatus: packed.status, _orMesh: packed.mesh };
  }
  const params = Object.assign({}, a);
  delete params.user_prompt;
  return { type: bare, params };
}

async function ensureBlenderScripts() {
  if (blenderScriptsReady) return;
  const py = await extText("blender_once.py");
  const ps = await extText("blender_once.ps1");
  await localWrite("blender_once.py", py);
  await localWrite("blender_once.ps1", ps);
  blenderScriptsReady = true;
}

let blenderCallRunning = false;
async function blenderCall(name, args, timeout) {
  // 1.24.12: another tab/chat may be mid-command. Wait for it (Blender runs one
  // command at a time) instead of failing at once; nothing is ever repeated.
  if (!blenderCallRunning && !blenderAddon && !blenderSuppressed && blenderWasConnected) {
    // A short drop (a slow scene check while Studio launches) must not leave
    // the AI stranded: verify the addon once before reporting it offline.
    try { await connectBlender(); } catch {}
  }
  if (blenderCallRunning) {
    const until = Date.now() + 45000;
    while (blenderCallRunning && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250));
    if (blenderCallRunning) return { ok: false, error: "Blender is still processing another elio command (from this or another chat). Wait for it to finish, then send this command again. Nothing was queued or repeated." };
  }
  if (!blenderAddon) {
    return { ok: false, error: "Blender is not connected. Click Connect Blender (Blender: N → MCP for Blender → Start MCP Server)." };
  }
  const run = async () => {
    const payload = await blenderPayload(name, args);
    const statusPath = payload._orStatus || "";
    const reply = await blenderRequest({type:payload.type,params:payload.params},payload.type === "get_scene_info" ? 8000 : Math.min(180000,timeout || 120000));
    if(!reply.ok) {if(/not listening|actively refused|connection refused|connection (?:closed|failed)|closed (?:the )?(?:socket|connection)|Blender is not connected/i.test(reply.error || ""))setBlender(false,reply.error);return {ok:false,error:reply.error || "Blender command failed."};}
    const data = reply.data;
    if (data && data.status === "error") {
      const details=[data.message,data.error,data.result?.error,data.result?.message,data.traceback].filter(value=>typeof value==="string"&&value.trim());
      const msg=[...new Set(details)].join(" · ").slice(0,12000)||"Blender addon error";
      if (/not listening|closed|actively refused|10061|Connection refused/i.test(msg)) {
        setBlender(false, "Blender addon dropped. Start MCP Server in Blender, then Connect Blender again.");
      }
      return { ok: false, error: msg };
    }
    let result = (data && Object.prototype.hasOwnProperty.call(data, "result")) ? data.result : data;
    const rawText = typeof result === "string" ? result : typeof result?.result === "string" ? result.result : "";
    const marker = String(rawText).indexOf("ELIO_MESH_JSON:");
    let inlineResult = false;
    if (marker >= 0) {
      try { result = JSON.parse(String(rawText).slice(marker + "ELIO_MESH_JSON:".length).split(/\r?\n/)[0]); inlineResult = true; } catch {}
    }
    if (result && result.ok === false) {
      return { ok: false, error: result.error || "Blender FBX failed" };
    }
    if (statusPath && !inlineResult) {
      return { ok: false, error: "Blender answered but did not return the current elio operation receipt. No cached status file was substituted. The edit may have run; inspect Blender before retrying." };
    }
    if (result && result.ok === false) {
      return { ok: false, error: result.error || "Blender command failed" };
    }
    let meshes = result && result.meshes;
    const mf = (result && result.mesh_file) || "";
    if ((!meshes || !meshes.length) && mf) {
      for (const cand of [mf]) {
        try {
          const rawM = (await localReadAll(cand)).replace(/^\uFEFF/, "").trim();
          if (!rawM) continue;
          const parsed = JSON.parse(rawM);
          meshes = parsed.meshes || (parsed.result && parsed.result.meshes);
          if (meshes && meshes.length) break;
        } catch {}
      }
    }
    if (meshes && meshes.length && result && typeof result === "object") result.meshes = meshes;
    // ── Screenshot → real image bytes ──────────────────────────────────────
    // The blender-mcp addon WRITES the viewport capture to a PNG path and
    // answers with that path as text. A Chrome extension cannot read a local
    // path, so this used to hand back images:[] and elio_screenshot silently fell
    // through to a tab capture (the AI got a picture of its own chat window).
    // The path IS inside the AgentScript workspace, so read it back as base64
    // through the bridge and return it as a real attachment.
    let images = [];
    const shotPath = payload._orShot ||
      (result && typeof result === "object" && (result.filepath || result.file_path || result.path)) ||
      "";
    let shotInfo = null;
    if (payload._orIsShot) {
      const m = String(rawText).match(/ELIO_SHOT_JSON:(\{.*\})/);
      if (m) { try { shotInfo = JSON.parse(m[1]); } catch {} }
      if (!shotInfo) return { ok: false, error: "Blender did not confirm a fresh viewport capture. " + String(rawText || "").slice(0, 400) };
    }
    if (shotPath && payload._orIsShot) {
      try {
        // Blender needs an absolute write path; the sandbox read API needs a
        // relative one. Read our own unique requested file, not an addon path.
        const parsed = await localReadBase64(payload._orReadShot || shotPath);
        images = [{ mimeType: parsed.mimeType || "image/png", data: parsed.data }];
        if (result && typeof result === "object") result.bytes = parsed.bytes;
      } catch (e) {
        // Keep the path in the text so the model/user can still open the file;
        // report the reason rather than pretending a capture happened.
        result = typeof result === "object" && result
          ? Object.assign({}, result, { image_error: String((e && e.message) || e).slice(0, 200) })
          : result;
      }
    }
    let textOut = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    if (payload._orIsShot && shotInfo) {
      textOut = "Fresh Blender viewport capture " + (shotInfo.size || []).join("x") + " via " + shotInfo.method +
        " at " + shotInfo.taken + " (sha1 " + shotInfo.sha1 + ", " + shotInfo.bytes + " bytes)" +
        (shotInfo.offscreen_error ? " [off-screen render failed: " + shotInfo.offscreen_error + "]" : "");
    }
    if (payload._orIsShot && !images.length) {
      textOut += "\n\n[elio: the viewport image could not be read back from disk" +
        (shotPath ? ` (${shotPath})` : "") + " — the capture file may be missing or unreadable.]";
    }
    return { ok: true, text: textOut, images, meshFile: mf, filepath: result && result.filepath, meshes: meshes || undefined };
  };
  blenderCallRunning = true;
  try { return await run(); }
  catch (error) {
    const message = String(error.message || error);
    // A slow answer (Blender busy, e.g. while Roblox Studio launches) is not a
    // lost connection; only a refused/closed socket marks Blender offline.
    if (/not listening|closed|actively refused|10061|Connection refused/i.test(message)) setBlender(false, message);
    return { ok: false, error: message + " The command was not automatically repeated; inspect Blender before retrying." };
  }
  finally { blenderCallRunning = false; }
}

async function robloxCsrf() {
  try {
    const r = await fetch("https://auth.roblox.com/v2/logout", { method: "POST", credentials: "include", signal: AbortSignal.timeout(ROBLOX_FETCH_TIMEOUT_MS) });
    return r.headers.get("x-csrf-token") || r.headers.get("X-CSRF-TOKEN") || "";
  } catch {
    return "";
  }
}
async function robloxAuthedFetch(url, opts) {
  opts = opts || {};
  const method = opts.method || "GET";
  const headers = Object.assign({}, method !== "GET" ? { "Content-Type": "application/json" } : {}, opts.headers || {});
  const go = async (token) => {
    const h = Object.assign({}, headers);
    if (token) h["X-CSRF-TOKEN"] = token;
    let r, text;
    try {
      r = await fetch(url, { method, credentials: "include", headers: h, body: opts.body, signal: AbortSignal.timeout(ROBLOX_FETCH_TIMEOUT_MS) });
      text = await r.text();
    } catch (e) {
      if (isTimeoutError(e)) throw new Error("Roblox did not answer within " + (ROBLOX_FETCH_TIMEOUT_MS / 1000) + " s (" + String(url).replace(/[?#].*$/, "") + "). Check the connection to roblox.com, then retry.");
      throw e;
    }
    const csrf = r.headers.get("x-csrf-token") || r.headers.get("X-CSRF-TOKEN") || "";
    return { r, text, csrf };
  };
  let token = await robloxCsrf();
  let res = await go(token);
  if ((res.r.status === 403 || res.r.status === 401) && res.csrf && res.csrf !== token) {
    res = await go(res.csrf);
  }
  let data = null;
  try { data = JSON.parse(res.text); } catch {}
  return { ok: res.r.ok, status: res.r.status, text: res.text, data };
}
async function robloxResolveUniverse(msg) {
  let universeId = Number(msg.universeId || msg.universe_id || msg.gameId || 0) || 0;
  const placeId = Number(msg.placeId || msg.place_id || 0) || 0;
  if (universeId > 0) return { ok: true, universeId, placeId };
  if (placeId > 0) {
    const res = await robloxAuthedFetch("https://apis.roblox.com/universes/v1/places/" + placeId + "/universe", { method: "GET" });
    const id = Number(res.data && (res.data.universeId || res.data.id) || 0) || 0;
    if (id > 0) return { ok: true, universeId: id, placeId };
  }
  const listed = await robloxAuthedFetch("https://develop.roblox.com/v1/user/universes?limit=50&sortOrder=Desc", { method: "GET" });
  const rows = (listed.data && listed.data.data) || [];
  if (placeId > 0) {
    const hit = rows.find((u) => Number(u.rootPlaceId) === placeId || Number(u.id) === placeId);
    if (hit) return { ok: true, universeId: Number(hit.id), placeId, name: hit.name };
  }
  if (rows.length === 1) return { ok: true, universeId: Number(rows[0].id), placeId: Number(rows[0].rootPlaceId) || placeId, name: rows[0].name };
  if (rows.length > 1) {
    const top = rows[0];
    return {
      ok: true,
      universeId: Number(top.id),
      placeId: Number(top.rootPlaceId) || placeId,
      name: top.name,
      candidates: rows.slice(0, 8).map((u) => ({ id: u.id, name: u.name, rootPlaceId: u.rootPlaceId })),
    };
  }
  const who = await robloxAuthedFetch("https://users.roblox.com/v1/users/authenticated", { method: "GET" });
  if (!who.ok) return { ok: false, error: "Could not reach the game. Sign into roblox.com in this Chrome profile, publish the place in Studio, then retry." };
  return { ok: false, error: "Could not reach a universe for this place (GameId/PlaceId empty). Publish the place (File > Publish to Roblox) so it has a Universe ID." };
}
async function robloxCreateDevProduct(msg) {
  const resolved = await robloxResolveUniverse(msg);
  if (!resolved.ok) return resolved;
  const universeId = resolved.universeId;
  const name = String(msg.name || "").trim();
  const description = String(msg.description || name).trim();
  const priceInRobux = Math.floor(Number(msg.priceInRobux || msg.price || 0));
  if (!name) return { ok: false, error: "name required" };
  if (!priceInRobux || priceInRobux < 1) return { ok: false, error: "priceInRobux must be >= 1" };
  const qUrl = "https://apis.roblox.com/developer-products/v1/universes/" + universeId +
    "/developerproducts?name=" + encodeURIComponent(name) +
    "&description=" + encodeURIComponent(description) +
    "&priceInRobux=" + encodeURIComponent(String(priceInRobux));
  let res = await robloxAuthedFetch(qUrl, { method: "POST" });
  if (!res.ok && (res.status === 400 || res.status === 404 || res.status === 415)) {
    res = await robloxAuthedFetch("https://apis.roblox.com/developer-products/v1/universes/" + universeId + "/developerproducts", {
      method: "POST",
      body: JSON.stringify({ name: name, description: description, priceInRobux: priceInRobux }),
    });
  }
  if (!res.ok) {
    let err = res.text.slice(0, 280) || ("HTTP " + res.status);
    try {
      const d = res.data;
      if (d) err = d.message || d.error || (d.errors && d.errors[0] && d.errors[0].message) || err;
    } catch {}
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Not signed into Roblox in this Chrome profile. Open roblox.com, log in, then retry. (" + err + ")" };
    }
    return { ok: false, error: String(err) + " (universe " + universeId + (resolved.name ? " / " + resolved.name : "") + ")", status: res.status, universeId: universeId };
  }
  const product = res.data || {};
  return { ok: true, product: product, productId: product.id || product.productId, universeId: universeId, universeName: resolved.name || "", text: JSON.stringify(product) };
}
async function robloxListDevProducts(msg) {
  const resolved = await robloxResolveUniverse(msg);
  if (!resolved.ok) return resolved;
  const universeId = resolved.universeId;
  const url = "https://apis.roblox.com/developer-products/v1/universes/" + universeId + "/developerproducts?pageNumber=1&pageSize=50";
  const res = await robloxAuthedFetch(url, { method: "GET" });
  if (!res.ok) {
    const err = (res.data && (res.data.message || res.data.error)) || res.text.slice(0, 280) || ("HTTP " + res.status);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Not signed into Roblox in this Chrome profile. Open roblox.com, log in, then retry. (" + err + ")" };
    }
    return { ok: false, error: String(err), status: res.status };
  }
  return { ok: true, products: res.data, text: typeof res.text === "string" ? res.text.slice(0, 4000) : JSON.stringify(res.data) };
}

// ── messages from content.js / popup.js ─────────────────────────────────
let lastMemorySignature = "";
async function readPersonalMemory(action) {
  // Reads are polled every 3 s and must give up quickly; explicit memory actions
  // (save, import, delete) get a longer limit.
  const response = await bridgeFetch("http://127.0.0.1:3000/api/memory", action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), signal: AbortSignal.timeout(30000) } : { signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Memory bridge is unavailable.");
  const memory = value.memory ? {...value.memory,receipt:value.receipt||null} : value;
  const signature=JSON.stringify(memory);
  if(signature!==lastMemorySignature){await chrome.storage.local.set({ rsPersonalMemory: memory });lastMemorySignature=signature;}
  return memory;
}
// Single-flight: a 10 s read on a 3 s interval would otherwise overlap up to 4 times.
let memoryPollInFlight = false;
setInterval(() => {
  if (!rustMode || memoryPollInFlight) return;
  memoryPollInFlight = true;
  readPersonalMemory().catch(() => {}).finally(() => { memoryPollInFlight = false; });
}, 3000);
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const tabId = _sender.tab?.id ?? msg.tab_id;
    const mode = await tabEngine(tabId);
    const dispatch = (value, timeout) => normalizeEngine(msg.engine ?? mode) === "local" ? sendLocalEngine(value, timeout) : send(value, timeout);
    switch (msg.type) {
      case "rs-update-status":
        try{sendResponse({ok:true,update:await readUpdateStatus()});}catch(error){sendResponse({ok:false,error:error.message||String(error)});}break;
      case "rs-update-action":
        try{sendResponse(await updateAction(msg.action));}catch(error){sendResponse({ok:false,error:error.message||String(error)});}break;
      case "rs-run-beat":
        noteRunBeat(tabId, msg.running === true);
        sendResponse({ ok: true });
        break;
      case "rs-toolkit": {
        const request = msg.request || {};
        if (request.action !== "insert-typed-asset") { sendResponse({ ok: false, error: "Only asset uploads are available here." }); break; }
        try { const response = await bridgeFetch("http://127.0.0.1:3000/api/toolkit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "insert-typed-asset", kind: String(request.kind || ""), asset_id: request.asset_id }), signal: AbortSignal.timeout(120000) }); const value = await response.json(); sendResponse(response.ok ? value : { ok: false, error: value.error || "Studio upload failed." }); } catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
        break;
      }
      case "rs-memory":
        try { sendResponse({ ok: true, memory: await readPersonalMemory(msg.action) }); } catch (error) { sendResponse({ ok: false, error: error.message || String(error) }); }
        break;
      case "rs-get-engine":
        sendResponse({engine:mode}); break;
      case "rs-set-engine": {
        const next=normalizeEngine(msg.engine);
        if (!Number.isInteger(tabId)) {sendResponse({ok:false,error:"Select an AI tab before changing its engine."});break;}
        tabEngines.set(tabId,next);
        try {await chrome.storage.session.set({["rs-tab-engine-"+tabId]:next});}catch{}
        try {await chrome.tabs.sendMessage(tabId,{type:"rs-engine",engine:next});}catch{}
        sendResponse({engine:next}); break;
      }
      case "rs-set-full": {
        // FULL PC ACCESS toggle for the AgentScript engine. The agent process
        // is the source of truth; mirror its answer into the status broadcast.
        const want = !!msg.enabled;
        try {
          const r = await bridgeFetch("http://127.0.0.1:3000/api/local-full", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: want }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || typeof j.local_full !== "boolean") throw new Error("Agent did not confirm the permission change");
          localFull = j.local_full;
          try { chrome.storage.local.set({ "rs-local-full": localFull }); } catch {}
        } catch (error) {
          sendResponse({ ok: false, enabled: localFull, error: String(error.message || error) });
          break;
        }
        broadcastStatus();
        sendResponse({ ok: true, enabled: localFull });
        break;
      }
      case "rs-get-full":
        sendResponse({ enabled: localFull });
        break;
      case "immediate-stop": {
        try{const response=await bridgeFetch(`${RUST_ROBLOX_HTTP}/api/stop`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkpoint_id:msg.checkpoint_id}),signal:AbortSignal.timeout(4000)});sendResponse(await response.json());}
        catch(error){sendResponse({ok:false,error:String(error.message || error)});}break;
      }
      case "media-convert": {
        try {
          if(typeof msg.data!=="string" || msg.data.length>90*1024*1024)throw Error("Local conversion accepts files up to 64 MB.");
          const bytes=Uint8Array.from(atob(msg.data),c=>c.charCodeAt(0));
          const response=await bridgeFetch(`${RUST_ROBLOX_HTTP}/api/media/convert?video=${msg.video===true}`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:bytes,signal:AbortSignal.timeout(65000)});
          sendResponse(await response.json());
        }catch(error){sendResponse({ok:false,error:String(error.message || error)});}
        break;
      }
      case "live-status": {
        try {
          const response = await bridgeFetch(`${RUST_ROBLOX_HTTP}/api/status`, {method:"GET",signal:AbortSignal.timeout(4000)});
          if(!response.ok)throw Error("Bridge status request failed.");
          const live=await response.json();
          sendResponse({ok:true,...statusObj(mode),local_connected:live.local_ready===true,local_root:live.local_root,local_full:live.local_full===true,roblox_connected:live.roblox_connected===true,bridge_reachable:true});
        }catch(error){sendResponse({ok:false,error:String(error.message || error)});}
        break;
      }
      case "status":
        if (!connected) connect(); // self-heal after a worker wake-up
        sendResponse(statusObj(mode));
        break;
      case "desktop_tools_snapshot": {
        try {
          const rows = Array.isArray(msg.tools) ? msg.tools : [];
          const response = await bridgeFetch("http://127.0.0.1:3000/api/tools/browser", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tools: rows }),
          });
          const body = await response.json().catch(() => ({}));
          sendResponse({ ok: response.ok, ...body });
        } catch (error) {
          sendResponse({ ok: false, error: String(error && error.message || error) });
        }
        break;
      }
      case "list_tools": {
        // Prefer a live refresh; fall back to cache so the loop never stalls.
        // 10s, not 25s: a catalogue request only blocks this long when one of the
        // MCP servers is dead (typically Roblox in a degraded, Blender-only
        // session), and in that exact case we already hold a perfectly good cached
        // catalogue. Waiting the full 25s just froze the boot for no new data.
        const r = await dispatch({ type: "list_tools" }, 10000);
        if (mode === "roblox" && r.ok && Array.isArray(r.tools)) toolsCache = r.tools;
        if (mode === "local" && r.ok && Array.isArray(r.tools)) { localToolsCache = r.tools; broadcastStatus(); }
        const tools = mergeBlenderTools(mode === "local" ? (r.tools || localToolsCache) : toolsCache);
        const ok = r.ok || tools.length > 0;
        sendResponse({ ok, tools, error: r.ok ? undefined : r.error });
        break;
      }
      case "skills": {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
        try{const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/skills",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.request||{action:"list"}),signal:controller.signal});const value=await response.json();sendResponse(response.ok?value:{ok:false,error:value.error||"Skill request failed."});}catch(error){sendResponse({ok:false,error:error.message||String(error)});}finally{clearTimeout(timer);}break;
      }
      case "creations": {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
        try{const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/creations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.request||{action:"list"}),signal:controller.signal});const value=await response.json();sendResponse(response.ok?value:{ok:false,error:value.error||"Creator request failed."});}catch(error){sendResponse({ok:false,error:error.message||String(error)});}finally{clearTimeout(timer);}break;
      }
      case "templates":
        try {
          let request=msg.request || {action:"list"},url=`${RUST_ROBLOX_HTTP}/api/templates`,body,headers={"Content-Type":"application/json"};
          if(request.action==='upload-chunk'){
            if(!/^[a-f0-9]{32}$/.test(request.id)||!Number.isSafeInteger(request.offset)||request.offset<0||typeof request.content!=='string'||request.content.length>2796204)throw Error('Invalid template upload chunk.');
            const binary=atob(request.content);if(!binary.length||binary.length>2097152)throw Error('Template chunk exceeds 2 MB.');body=Uint8Array.from(binary,c=>c.charCodeAt(0));url+='/upload/'+request.id+'?offset='+request.offset;headers={'Content-Type':'application/octet-stream'};
          }else if(['upload-begin','upload-finish','upload-status','upload-cancel'].includes(request.action)){url+='/upload';body=JSON.stringify(request);
          }else           if(request.action==="import"){if(typeof request.content!=="string" || request.content.length>44739244)throw Error("Template file exceeds 32 MB.");const binary=atob(request.content);body=Uint8Array.from(binary,c=>c.charCodeAt(0));url+="/import?name="+encodeURIComponent(request.name)+"&description="+encodeURIComponent(request.description || "");headers={"Content-Type":"application/octet-stream"};}else body=JSON.stringify(request);
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);try{const response=await bridgeFetch(url,{method:"POST",headers,body,signal:controller.signal});const value=await response.json();sendResponse(response.ok?value:{ok:false,error:value.error || "Template request failed."});}finally{clearTimeout(timer);}
        }catch(error){sendResponse({ok:false,error:error.message || String(error)});}
        break;
      case "vault": {
        try {const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/vault",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.request||{}),signal:AbortSignal.timeout(15000)});sendResponse(await response.json());}
        catch(error){sendResponse({ok:false,error:error.message||String(error)});}break;
      }
      case "engram": {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
        try { const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/engram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.request||{}),signal:controller.signal});sendResponse(await response.json()); }
        catch(error){sendResponse({ok:false,error:error.message||String(error)});}finally{clearTimeout(timer);}break;
      }
      case "chat-history": {
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
        try{const response=await bridgeFetch(RUST_ROBLOX_HTTP+"/api/chat-history",msg.request?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.request),signal:controller.signal}:{signal:controller.signal});sendResponse(await response.json());}catch(error){sendResponse({ok:false,error:error.message||String(error)});}finally{clearTimeout(timeout);}break;
      }
      case "checkpoints": {
        const timer = new AbortController(); const timeout = setTimeout(() => timer.abort(), 30000);
        try {
          const response = await bridgeFetch("http://127.0.0.1:3000/api/checkpoints", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(msg.request || {action:"list"}), signal:timer.signal });
          const body = await response.json(); sendResponse({ok:response.ok,...body});
        } catch(error) { sendResponse({ok:false,error:String(error.message || error)}); } finally { clearTimeout(timeout); }
        break;
      }
      case "call_tool": {
        const timeout = (msg.timeout || 120000) + 10000;
        if (blenderAddon && isBlenderToolName(msg.name)) {
          sendResponse(await blenderCall(msg.name, msg.arguments, timeout));
          break;
        }
        const r = await dispatch(
          { type: "call_tool", name: msg.name, arguments: msg.arguments, timeout: msg.timeout, checkpoint_id: msg.checkpoint_id },
          timeout
        );
        sendResponse(r);
        break;
      }
      case "restart_mcp": {
        const r = await dispatch({ type: "restart_mcp" }, 30000);
        if (r && r.ok) {
          const tools = await dispatch({ type: "list_tools" }, 10000);
          if (mode === "roblox" && tools && tools.ok && Array.isArray(tools.tools)) toolsCache = tools.tools;
          mcpAlive = true;
        }
        sendResponse(r);
        break;
      }
      case "local_read": {
        try {
          const text = await localReadAll(String(msg.path || ""));
          sendResponse({ ok: true, text });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        break;
      }
      // Base64 read (any file: images, PDFs, binaries) — powers attach_feedback
      // ({"path": ...}), which puts a workspace file into the chat as an
      // attachment instead of pasting its text.
      case "local_read_base64": {
        try {
          const data = await localReadBase64(String(msg.path || ""));
          sendResponse({ ok: true, path: data.path, mimeType: data.mimeType, bytes: data.bytes, data: data.data });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        break;
      }
      case "blender_connect": {
        sendResponse(await connectBlender());
        break;
      }
      case "blender_status": {
        sendResponse({ ok: blenderAddon, blender: blenderAddon, error: blenderError || undefined });
        break;
      }
      case "blender_disconnect": {
        blenderSuppressed=true;
        setBlender(false, "");
        broadcastStatus();
        sendResponse({ ok: true, blender: false });
        break;
      }
      case "add_server": {
        // Blender’s bar shortcut verifies the addon, without spawning a second MCP process.
        if (String(msg.server_id || "").toLowerCase() === "blender") {
          sendResponse(await connectBlender());
          break;
        }
        const r = await send({
          type: "add_server", server_id: msg.server_id,
          command: msg.command, args: msg.args, env: msg.env,
        }, 15000);
        sendResponse(r);
        break;
      }
      case "remove_server": {
        const r = await send({ type: "remove_server", server_id: msg.server_id }, 15000);
        sendResponse(r);
        break;
      }
      case "reconnect":
        reconnectDelay = RECONNECT_MIN;
        connect();
        sendResponse({ ok: true });
        break;
      // ── ZeroScript Rust pipe — CORS bypass via background (content script → background → 127.0.0.1) ──
      case "rs-push":
      case "push_payload": {
        // Content script payload from AI chat (Gemini/ChatGPT/Claude) → local bridge
        // Must go through background to bypass chat site CORS on http://127.0.0.1
        try {
          const target = RUST_ROBLOX_HTTP;
          const res = await bridgeFetch(`${target}/api/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(msg.payload || msg),
          });
          const j = await res.json().catch(() => ({}));
          sendResponse({ ok: res.ok, ...j });
        } catch (e) {
          // Fallback to legacy WS if Rust HTTP not reachable
          const r = await send({ type: "call_tool", name: msg.name || "push_payload", arguments: msg.arguments || msg.payload || {} }, 10000);
          sendResponse(r);
        }
        break;
      }
      case "rs-poll": {
        try {
          const target = RUST_ROBLOX_HTTP;
          // /api/poll long-polls for up to 25 s; stay above that so a queued payload is never dropped mid-reply.
          const res = await bridgeFetch(`${target}/api/poll?client_id=${encodeURIComponent(msg.client_id || engine)}`, { signal: AbortSignal.timeout(35000) });
          const j = await res.json().catch(() => ({}));
          sendResponse(j);
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        break;
      }
      case "web_fetch": {
        try {
          let url = String(msg.url || "").trim();
          const query = String(msg.query || "").trim();
          if (!url) {
            const q = String(msg.q || query).trim();
            if (/^https?:\/\//i.test(q)) url = q;
          }
          let searchNote = "";
          if (!url) {
            const q = query || String(msg.q || "").trim();
            if (!q) { sendResponse({ ok: false, error: "url or query is required" }); break; }
            const found = await webSearch(q, 3);
            if (!found.hits.length) {
              sendResponse({ ok: false, error: `no search results for: ${q} (tried ${found.notes.join("; ") || "all backends"})` });
              break;
            }
            url = found.hits[0].url;
            searchNote = `Searched "${q}" [${found.backend}]. Top result: ${url}\n` +
              found.hits.map((h, i) => (i + 1) + ". " + h.title + " — " + h.url).join("\n") + "\n\n";
          }
          if (!/^https?:\/\//i.test(url)) { sendResponse({ ok: false, error: "url must start with http:// or https://" }); break; }
          const maxChars = Math.max(500, Math.min(50000, Number(msg.max_chars) || 12000));
          let text = "";
          let directWasHtml = false;
          let status = 0;
          let ctype = "";
          let via = "direct";
          const notes = [];
          try {
            const res = await fetchWithTimeout(url, { headers: webHeaders({}, (() => { try { return new URL(url).origin + "/"; } catch { return undefined; } })()) }, WEB_FETCH_TIMEOUT);
            status = res.status;
            ctype = (res.headers.get("content-type") || "").toLowerCase();
            if (!res.ok) {
              notes.push(`direct HTTP ${res.status}`);
            } else {
              let raw = await res.text();
              const looksHtml = /html|xml/.test(ctype) || /^\s*</.test(raw);
              directWasHtml = looksHtml;
              text = looksHtml ? htmlToText(raw) : raw.trim();
            }
          } catch (e) {
            notes.push("direct: " + String((e && e.message) || e).slice(0, 90));
          }
          // Reader proxy when the direct fetch failed, was blocked, or returned
          // a JavaScript shell we cannot read.
          // Short pages are only suspicious when they were HTML: a 200-char
          // plain-text/JSON answer is a complete document, and re-reading it
          // through a proxy would be wasted time.
          const wasShell = !text || (directWasHtml && looksLikeShell(text));
          if (wasShell) {
            try {
              const viaReader = await readerFallback(url, maxChars);
              if (viaReader) { text = viaReader; via = "reader"; }
            } catch (e) {
              notes.push("reader: " + String((e && e.message) || e).slice(0, 90));
            }
          }
          if (!text) {
            sendResponse({ ok: false, error: `fetch failed for ${url}${notes.length ? " (" + notes.join("; ") + ")" : ""}` });
            break;
          }
          const origLen = text.length;
          const truncated = origLen > maxChars;
          if (truncated) text = text.slice(0, maxChars) + `\n\n…[truncated ${origLen - maxChars} chars]`;
          const suffix = via === "reader"
            ? `\n\n[elio: the page served no readable text directly (${notes.join("; ") || "blocked"}), so it was read through a rendering proxy — layout/menus may be missing.]`
            : (wasShell
              ? `\n\n[elio: this page returned almost no readable text${notes.length ? " (" + notes.join("; ") + ")" : ""} — it is served by JavaScript or blocks non-browser readers, so the text above is all there is. Use web_search for a text source instead of relying on this page.]`
              : "");
          sendResponse({ ok: true, text: searchNote + text + suffix, truncated, status, url, content_type: ctype, via });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "web_search": {
        try {
          const q = String(msg.query || msg.q || "").trim();
          if (!q) { sendResponse({ ok: false, error: "query is required" }); break; }
          const limit = Math.max(1, Math.min(8, Number(msg.limit) || 3));
          const found = await webSearch(q, limit);
          if (!found.hits.length) {
            sendResponse({ ok: false, error: `no results for '${q}' (tried ${found.notes.join("; ") || "all backends"})`, notes: found.notes });
            break;
          }
          const results = found.hits;
          const txt = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n");
          sendResponse({ ok: true, text: `Searched "${q}" [${found.backend}]\n${txt}`, results, query: q, backend: found.backend, notes: found.notes });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "ollama_list_models": {
        try {
          const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(OLLAMA_TAGS_TIMEOUT_MS) });
          if (!res.ok) { sendResponse({ ok: false, error: `Ollama not running (HTTP ${res.status}) — run 'ollama serve'` }); break; }
          const j = await res.json();
          sendResponse({ ok: true, models: j.models || [] });
        } catch (e) { sendResponse({ ok: false, error: isTimeoutError(e) ? `Ollama did not answer at 127.0.0.1:11434 within ${OLLAMA_TAGS_TIMEOUT_MS / 1000} s — restart 'ollama serve'.` : `Ollama not reachable at 127.0.0.1:11434 — is 'ollama serve' running? ${String(e&&e.message||e)}` }); }
        break;
      }
      // One-click start: ask whichever bridge is connected to spawn `ollama serve`.
      case "ollama_ensure": {
        const ask = (type) => send({ type, timeoutMs: 12000 });
        let r = await ask("start_ollama");
        if (!r || r.error === "bridge not connected") {
          // Engine bridge down? try the other port by flipping engine briefly is
          // too invasive; instead just report so popup can hint to run robloxscript-agent.exe.
          sendResponse({ ok: false, up: false, error: "bridge offline - run elio.exe first" });
          break;
        }
        sendResponse(r);
        break;
      }
      case "ollama_status": {
        const r = await send({ type: "ollama_status" }, 8000);
        if (!r || r.error === "bridge not connected") {
          sendResponse({ ok: false, up: false, error: "bridge offline" });
          break;
        }
        sendResponse(r);
        break;
      }
      case "ollama_chat": {
        try {
          let model = msg.model ? String(msg.model) : "";
          const messages = Array.isArray(msg.messages) ? msg.messages : [{role:"user", content:String(msg.prompt||"")}];
          // Validate the model against what is ACTUALLY installed before calling
          // /api/chat - a stale name (model deleted after being picked, or the
          // hardcoded default no longer pulled) otherwise surfaces as a raw 404
          // body. Return a structured error the page can react to (auto-recover).
          let available = [];
          try {
            const tr = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(OLLAMA_TAGS_TIMEOUT_MS) });
            if (tr.ok) { const tj = await tr.json(); available = (tj.models || []).map(m => m.name); }
          } catch {}
          if (!available.length) {
            sendResponse({ ok:false, errKind:"no_server", error:"ERR: OLLAMA NOT RUNNING - nothing answered on 127.0.0.1:11434." });
            break;
          }
          if (!model || !available.includes(model)) {
            if (model) {
              sendResponse({
                ok: false, errKind: "model_not_found", available,
                error: `ERR: MODEL NOT FOUND - "${model}" is not installed anymore.`
              });
              break;
            }
            // No model given: fall back to a coder model if present, else first.
            const pref = available.find(n => /coder|code/i.test(n));
            model = pref || available[0];
          }
          const res = await fetch("http://127.0.0.1:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify({ model, messages, stream: false }),
            signal: AbortSignal.timeout(OLLAMA_CHAT_TIMEOUT_MS)
          });
          if (!res.ok) {
            const t = await res.text().catch(()=> "");
            sendResponse({ ok: false, errKind:"http_"+res.status, model,
              error: `Ollama chat HTTP ${res.status}: ${t.slice(0,400)}` });
            break;
          }
          const j = await res.json();
          const text = (j.message && j.message.content) || j.response || "";
          sendResponse({ ok: true, text, model, raw: j });
        } catch (e) {
          if (isTimeoutError(e)) sendResponse({ ok: false, errKind: "timeout", error: `ERR: OLLAMA TIMED OUT - no answer within ${OLLAMA_CHAT_TIMEOUT_MS / 60000} min. Try a smaller model or a shorter conversation.` });
          else sendResponse({ ok: false, error: `Ollama chat failed: ${String(e&&e.message||e)} - try OLLAMA_ORIGINS=* ollama serve` });
        }
        break;
      }
      case "resolve_universe": {
        try { sendResponse(await robloxResolveUniverse(msg)); }
        catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "create_dev_product": {
        try { sendResponse(await robloxCreateDevProduct(msg)); }
        catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "list_dev_products": {
        try { sendResponse(await robloxListDevProducts(msg)); }
        catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "capture_tab": {
        try {
          const windowId = (_sender.tab && _sender.tab.windowId) || undefined;
          const dataUrl = await new Promise((resolve, reject) => {
            let settled=false;
            const timer=setTimeout(()=>done(new Error("Browser did not finish the screen capture")),15000);
            const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
            try {
              chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (url) => {
                try { if (chrome.runtime.lastError) done(new Error(chrome.runtime.lastError.message)); else done(null,url); } catch(error) { done(error); }
              });
            } catch (e) { done(e); }
          });
          const m = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          if (!m) {
            sendResponse({ ok: false, error: "tab capture returned no image" });
            break;
          }
          sendResponse({ ok: true, images: [{ mimeType: m[1], data: m[2] }] });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        break;
      }
      case "tab_read": {
        try {
          const tab = await resolveTab(msg);
          if (!tab) { sendResponse({ ok: false, error: "no target tab (open a page, or pass url_contains)" }); break; }
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const safeRead=(read,fallback)=>{try{return read();}catch{return fallback;}};
              const safeQueryAll=(selector)=>safeRead(()=>Array.from(document.querySelectorAll(selector)),[]);
              const isVisible = (el) => safeRead(() => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight;
              },false);
              const text = safeRead(()=>document.body && document.body.innerText || "", "").replace(/\n{3,}/g, "\n\n").slice(0, 6000);
              const clickable = [];
              const els = safeQueryAll("a, button, input, [role=button], [onclick], summary, select, textarea");
              let i = 0;
              for (const el of els) {
                if (!isVisible(el)) continue;
                try {
                const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
                clickable.push({ i, tag: el.tagName.toLowerCase(), type: el.type || "", label, id: el.id || "", cls: (el.className && String(el.className).slice(0, 60)) || "" });
                i++;
                if (i >= 120) break;
                } catch { /* A virtualized row was removed while reading it. */ }
              }
              return { url: safeRead(()=>location.href,""), title: safeRead(()=>document.title,""), text, clickable };
            },
          });
          sendResponse({ ok: true, tab: { id: tab.id, url: tab.url, title: tab.title }, page: res.result });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "tab_click": {
        try {
          const tab = await resolveTab(msg);
          if (!tab) { sendResponse({ ok: false, error: "no target tab" }); break; }
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [String(msg.selector || ""), String(msg.text || "")],
            func: (selector, text) => {
              const safeRead=(read,fallback)=>{try{return read();}catch{return fallback;}};
              const safeQuery=(value)=>safeRead(()=>document.querySelector(value),null);
              const safeQueryAll=(value)=>safeRead(()=>Array.from(document.querySelectorAll(value)),[]);
              let el = null;
              if (selector) el = safeQuery(selector);
              if (!el && text) {
                const t = text.toLowerCase();
                const cands = safeQueryAll("a, button, input, [role=button], [onclick], summary, select, textarea, label");
                el = cands.find((c) => safeRead(() => ((c.innerText || c.value || c.getAttribute("aria-label") || c.getAttribute("placeholder") || "").toLowerCase().includes(t)),false));
              }
              if (!el) return { clicked: false, error: "element not found" };
              try {
              const receipt={ clicked:true,tag:el.tagName.toLowerCase(),label:(el.innerText || el.value || "").trim().slice(0,60) };
              el.scrollIntoView({ block: "center" });
              el.focus && el.focus();
              el.click();
              return receipt;
              } catch(error) { return {clicked:false,error:String(error.message || error),note:"The click was not repeated; inspect the page before retrying."}; }
            },
          });
          sendResponse({ ok: true, result: res.result });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "tab_type": {
        try {
          const tab = await resolveTab(msg);
          if (!tab) { sendResponse({ ok: false, error: "no target tab" }); break; }
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [String(msg.selector || ""), String(msg.text || ""), !!msg.submit],
            func: (selector, text, submit) => {
              let el;
              try { el=selector ? document.querySelector(selector) : document.activeElement; } catch { return {typed:false,error:"Invalid selector or unavailable field"}; }
              try {
              if (!el) return { typed: false, error: "no field (pass selector)" };
              el.focus();
              if ("value" in el) {
                el.value = text;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              } else {
                el.textContent = text;
              }
              if (submit) {
                const k = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true });
                el.dispatchEvent(k);
                if (el.form && el.form.requestSubmit) el.form.requestSubmit();
              }
              return { typed: true, tag: el.tagName.toLowerCase() };
              } catch(error) { return {typed:false,error:String(error.message || error),note:"The write was not repeated; inspect the field before retrying."}; }
            },
          });
          sendResponse({ ok: true, result: res.result });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "tab_scroll": {
        try {
          const tab = await resolveTab(msg);
          if (!tab) { sendResponse({ ok: false, error: "no target tab" }); break; }
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [Number(msg.amount) || 600],
            func: (amount) => { window.scrollBy({ top: amount, behavior: "smooth" }); return { scrolled: amount, y: Math.round(window.scrollY) }; },
          });
          sendResponse({ ok: true, result: res.result });
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
        break;
      }
      case "rs-debug-log":
        debugAcceptTab(msg, _sender);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })().catch((error) => {
    // Contract: every message gets an answer, even after an unexpected throw.
    try { sendResponse({ ok: false, error: String(error && error.message || error) }); } catch {}
  });
  return true; // async sendResponse
});

// Pick the tab a tab_* tool should act on: explicit tabId > a tab whose URL
// contains url_contains > the active tab in any window that is NOT a chat
// provider (so "control my browser" doesn't click the chat itself).
async function resolveTab(msg) {
  try {
    if (msg && msg.tabId != null) {
      const t = await chrome.tabs.get(Number(msg.tabId));
      return t || null;
    }
    const all = await chrome.tabs.query({});
    if (msg && msg.url_contains) {
      const needle = String(msg.url_contains).toLowerCase();
      return all.find((t) => (t.url || "").toLowerCase().includes(needle)) || null;
    }
    const isProvider = (u) => PROVIDER_URLS.some((p) => {
      const rx = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
      return rx.test(u || "");
    });
    const candidates = all.filter((t) => t.url && !isProvider(t.url));
    const active = candidates.find((t) => t.active);
    return active || candidates[candidates.length - 1] || all.find((t) => t.active) || null;
  } catch (_e) { return null; }
}

// Proc poll — keeps RS availability gated on the live Studio process
refreshProcStatus();
setInterval(refreshProcStatus, 5000);

// Wake/keepalive hooks.
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

connect();
