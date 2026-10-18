// SPDX-License-Identifier: GPL-3.0-or-later
// Debug capture (isolated content-script world).
// Records elio's own console errors, warnings and info, uncaught extension
// errors, the agent's recent diag events, and AI-site problems relayed by
// core/debug-capture-main.js. Batches go to background.js, which forwards them
// to the desktop app for Settings -> Copy debug report.
// Rules: the wrapped console prints exactly as before (original first), nothing
// here throws or awaits on a caller's path, and buffers are capped.
(() => {
  "use strict";
  if (globalThis.__elioDebugCapture) return;
  const MAX_TEXT = 600, MAX_QUEUE = 150, FLUSH_MS = 3000, REPEAT_MS = 5000, DIAG_TAIL = 40;
  const queue = [];
  let dropped = 0, last = null, inside = false, stopped = false, diagSig = "";
  const EXT_RE = /(?:chrome|moz)-extension:\/\/[^/\s)]+\//;

  function redact(value) {
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
  // "core/main.js › sendPrompt" for the first few elio frames of a stack.
  function where(stack) {
    const out = [];
    for (const line of String(stack || "").split("\n")) {
      if (!EXT_RE.test(line) || /debug-capture/.test(line)) continue;
      const file = (line.match(/(?:chrome|moz)-extension:\/\/[^/\s)]+\/([^:\s)]+)/) || [])[1];
      if (!file) continue;
      const fn = (line.match(/^\s*at\s+(?:async\s+)?([^\s(]+)\s+\(/) || line.match(/^\s*([^@\s]+)@/) || [])[1] || "";
      const item = fn && fn !== "<anonymous>" ? file + " › " + fn : file;
      if (!out.includes(item)) out.push(item);
      if (out.length >= 4) break;
    }
    return out;
  }
  // Duck-typed so errors from other realms (frames, page objects) still count.
  function isError(arg) {
    return !!arg && typeof arg === "object" && typeof arg.message === "string" && typeof arg.stack === "string";
  }
  function describe(arg) {
    if (isError(arg)) return arg.name + ": " + arg.message;
    if (typeof arg === "string") return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  function record(entry) {
    if (stopped) return;
    const text = redact(entry.text || "").slice(0, MAX_TEXT);
    const key = entry.source + "|" + entry.level + "|" + text;
    const now = Date.now();
    if (last && last.key === key && now - last.at < REPEAT_MS) { last.entry.repeats = (last.entry.repeats || 1) + 1; last.at = now; return; }
    const item = { t: now, source: entry.source, level: entry.level, kind: entry.kind || "console", text };
    if (entry.where && entry.where.length) item.where = entry.where.map(redact);
    if (entry.file) item.file = redact(entry.file).slice(0, 200);
    if (entry.status) item.status = entry.status;
    queue.push(item);
    if (queue.length > MAX_QUEUE) { queue.shift(); dropped++; }
    last = { key, at: now, entry: item };
  }
  // elio's console only: this world's console object is separate from the
  // AI page's, so the site's own console is never touched.
  // console.log is kept only for elio's own "[elio]" lines (as info);
  // diag lines are collected separately below.
  for (const method of ["error", "warn", "info", "log"]) {
    const original = console[method];
    const level = method === "log" ? "info" : method;
    if (typeof original !== "function") continue;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (!inside) {
        inside = true;
        try {
          const own = method !== "log" || (typeof args[0] === "string" && /^\[elio/.test(args[0]));
          const text = own ? args.map(describe).join(" ") : "";
          // Uncaught errors are recorded with their stack by the listeners below.
          if (own && !/^\[rs\] uncaught /.test(text)) {
            const err = args.find(isError);
            record({ source: "extension", level, text, where: level === "info" ? [] : where(err ? err.stack : new Error().stack) });
          }
        } catch {} finally { inside = false; }
      }
      return result;
    };
    try { console[method] = wrapped; } catch {}
  }
  window.addEventListener("error", (event) => {
    try {
      const stack = String(event && event.error && event.error.stack || "");
      const file = String(event && event.filename || "");
      if (!EXT_RE.test(file) && !EXT_RE.test(stack)) return; // site errors: MAIN-world helper
      record({ source: "extension", level: "error", kind: "uncaught", text: String(event.message || "Uncaught error"),
        where: where(stack || ("at x (" + file + ":" + event.lineno + ")")) });
    } catch {}
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event && event.reason;
      const text = reason && (reason.message || String(reason)) || "Unhandled rejection";
      if (/Extension context invalidated|message port closed|Receiving end does not exist/i.test(text)) return;
      record({ source: "extension", level: "error", kind: "rejection", text: String(text), where: where(reason && reason.stack) });
    } catch {}
  });
  // AI-site problems from the passive MAIN-world helper (string detail only).
  document.addEventListener("elio:site-log", (event) => {
    try {
      const data = JSON.parse(String(event.detail || "{}"));
      record({ source: "site", level: data.level === "error" ? "error" : data.level === "info" ? "info" : "warn",
        kind: String(data.kind || "error").slice(0, 20), text: String(data.text || ""), file: data.file, status: Number(data.status) || undefined });
    } catch {}
  });
  try { document.dispatchEvent(new CustomEvent("elio:site-log-ready")); } catch {}

  // Recent agent decisions from core/main.js (window.__rsDiag), with chat text removed.
  const TEXT_KEY = /text|prompt|content|message|code|html|reply|body|answer|query|source|args|arguments|payload/i;
  function cleanDiag(value, depth) {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return redact(value).slice(0, 120);
    if (depth > 2) return "…";
    if (Array.isArray(value)) return value.slice(0, 6).map((v) => cleanDiag(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 24)) {
      out[k] = TEXT_KEY.test(k) && typeof v === "string" ? "[" + v.length + " chars]" : cleanDiag(v, depth + 1);
    }
    return out;
  }
  function diagTail() {
    const list = Array.isArray(window.__rsDiag) ? window.__rsDiag : [];
    if (!list.length) return null;
    const tail = list.slice(-DIAG_TAIL), sig = list.length + ":" + tail[tail.length - 1].t;
    if (sig === diagSig) return null;
    diagSig = sig;
    return tail.map((e) => ({ t: e.t, event: String(e.event).slice(0, 60), data: cleanDiag(e.data, 0), snap: cleanDiag(e.snap, 1) }));
  }
  const timer = setInterval(() => {
    if (stopped) return;
    try {
      if (!chrome.runtime || !chrome.runtime.id) { stopped = true; clearInterval(timer); return; }
      const diag = diagTail();
      if (!queue.length && !diag) return;
      const entries = queue.splice(0, queue.length);
      const message = { type: "rs-debug-log", entries, diag, dropped, page: { host: location.host, path: redact(location.pathname).slice(0, 80) } };
      dropped = 0; last = null;
      const sent = chrome.runtime.sendMessage(message);
      if (sent && sent.catch) sent.catch(() => {});
    } catch { stopped = true; clearInterval(timer); }
  }, FLUSH_MS);
  globalThis.__elioDebugCapture = { redact, where, record, pending: () => queue.slice() };
})();
