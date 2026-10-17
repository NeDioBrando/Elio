// SPDX-License-Identifier: GPL-3.0-or-later
// Debug capture (AI page world, document_start). Passive only: it listens for
// the site's own uncaught errors, failed resource loads and failed API
// responses, and relays them to core/debug-capture.js as JSON strings. It does
// not wrap the page's console, fetch or any site function.
(() => {
  "use strict";
  const EXT_RE = /(?:chrome|moz)-extension:\/\//;
  const pending = [];
  let ready = false, windowStart = Date.now(), inWindow = 0;
  const clean = (url) => { try { const u = new URL(String(url), location.href); return u.origin + u.pathname.slice(0, 120); } catch { return String(url || "").split(/[?#]/)[0].slice(0, 160); } };
  function emit(entry) {
    const now = Date.now();
    if (now - windowStart > 10000) { windowStart = now; inWindow = 0; }
    if (++inWindow > 40) return; // a looping site error must not flood anything
    let detail;
    try { detail = JSON.stringify(entry); } catch { return; }
    if (!ready) { pending.push(detail); if (pending.length > 60) pending.shift(); return; }
    try { document.dispatchEvent(new CustomEvent("synerixcode:site-log", { detail })); } catch {}
  }
  document.addEventListener("synerixcode:site-log-ready", () => {
    ready = true;
    for (const detail of pending.splice(0)) { try { document.dispatchEvent(new CustomEvent("synerixcode:site-log", { detail })); } catch {} }
  });
  window.addEventListener("error", (event) => {
    try {
      const target = event && event.target;
      if (target && target !== window && target.tagName) {
        const src = target.currentSrc || target.src || target.href || "";
        if (!src || EXT_RE.test(src)) return;
        emit({ level: "warn", kind: "resource", text: "Failed to load " + String(target.tagName).toLowerCase() + " " + clean(src) });
        return;
      }
      const file = String(event.filename || ""), stack = String(event.error && event.error.stack || "");
      if (EXT_RE.test(file) || EXT_RE.test(stack)) return; // synerixcode's own: isolated capture
      if (/ResizeObserver loop/i.test(String(event.message || ""))) return; // benign browser notice
      emit({ level: "error", kind: "error", text: String(event.message || "Script error") + (stack ? "\n" + stack.split("\n").slice(1, 4).join("\n") : ""),
        file: file ? clean(file) + ":" + (event.lineno || 0) + ":" + (event.colno || 0) : "" });
    } catch {}
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event && event.reason;
      const stack = String(reason && reason.stack || "");
      if (EXT_RE.test(stack)) return;
      const text = reason && (reason.message || (typeof reason === "string" ? reason : "")) || "Unhandled promise rejection";
      emit({ level: "warn", kind: "rejection", text: String(text).slice(0, 400) });
    } catch {}
  });
  // Failed API calls (rate limits, signed-out sessions, server errors) from the
  // browser's own resource timing; nothing is intercepted.
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const status = Number(entry.responseStatus) || 0;
        if (status < 400 || !/^(fetch|xmlhttprequest|beacon)$/.test(entry.initiatorType)) continue;
        emit({ level: status >= 500 || status === 429 ? "error" : "warn", kind: "http", status, text: "HTTP " + status + " " + clean(entry.name) });
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {}
})();
