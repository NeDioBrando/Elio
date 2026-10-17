// synerixcode Firefox page-world transfer helper (Firefox package only).
// Firefox hides DataTransfer text/files created by an extension content script
// from page handlers. The isolated shim forwards exactly the event it was about
// to dispatch; this helper rebuilds it in the page world and dispatches it on the
// same target. It adds no capability: pages can already dispatch these events.
(() => {
  "use strict";
  if (window.__synerixcodeFirefoxEvents) return;
  try { Object.defineProperty(window, "__synerixcodeFirefoxEvents", { value: true }); } catch { return; }
  const KEY = "synerixcode-firefox-dispatch", RESULT = "data-synerixcode-firefox-result";
  const transfers = new Map();
  const transferFor = (detail) => {
    let dt = transfers.get(detail.id);
    if (!dt) {
      dt = new DataTransfer();
      for (const [type, value] of detail.data || []) { try { dt.setData(type, value); } catch {} }
      for (const file of detail.files || []) if (file instanceof File) dt.items.add(file);
      transfers.set(detail.id, dt);
      // Drag sequences reuse one transfer; keep only a few recent ones.
      while (transfers.size > 8) transfers.delete(transfers.keys().next().value);
    }
    if (detail.effectAllowed) { try { dt.effectAllowed = detail.effectAllowed; } catch {} }
    if (detail.dropEffect) { try { dt.dropEffect = detail.dropEffect; } catch {} }
    return dt;
  };
  document.addEventListener(KEY, (event) => {
    const detail = event.detail, path = event.composedPath ? event.composedPath() : [];
    const target = path[0] || event.target;
    event.stopImmediatePropagation();
    let result = "x";
    try {
      if (!detail || typeof detail.type !== "string" || !target || typeof target.dispatchEvent !== "function") throw new Error("invalid");
      const init = Object.assign({}, detail.init || {});
      const dt = transferFor(detail);
      let native;
      if (detail.kind === "clipboard") {
        // Firefox ignores init.clipboardData; expose the rebuilt transfer as the
        // event's own field, which page paste handlers read like the native one.
        native = new ClipboardEvent(detail.type, init);
        Object.defineProperty(native, "clipboardData", { value: dt, configurable: true, enumerable: true });
      }
      else if (detail.kind === "drag") { init.dataTransfer = dt; native = new DragEvent(detail.type, init); }
      else if (detail.kind === "input") { init.dataTransfer = dt; native = new InputEvent(detail.type, init); }
      else throw new Error("unsupported");
      result = target.dispatchEvent(native) ? "1" : "0";
    } catch { result = "x"; }
    try { document.documentElement.setAttribute(RESULT, result); } catch {}
  }, true);
})();
