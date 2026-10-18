// elio Firefox content-script transfer shim (Firefox package only).
// Firefox content scripts have their own view of DOM prototypes, so this
// override applies only to elio's own dispatches; page code is unaffected.
// Paste, drop and beforeinput events that carry elio-created data are
// replayed by firefox-events-main.js in the page world, where Notion, ChatGPT and
// other providers can read the text/files exactly as in Chromium browsers.
(() => {
  "use strict";
  if (typeof cloneInto !== "function" || globalThis.__elioFirefoxShim) return;
  globalThis.__elioFirefoxShim = true;
  const KEY = "elio-firefox-dispatch", RESULT = "data-elio-firefox-result";
  const proto = window.EventTarget && window.EventTarget.prototype;
  const native = proto && proto.dispatchEvent;
  if (typeof native !== "function") return;
  const ids = new WeakMap();
  let seq = 0;
  // Firefox's ClipboardEvent constructor discards init.clipboardData. Remember
  // the transfer elio supplied so the page-world replay carries its data.
  const NativeClipboardEvent = window.ClipboardEvent;
  const clipboardInit = new WeakMap();
  if (typeof NativeClipboardEvent === "function") {
    const ClipboardEvent = function ClipboardEvent(type, init) {
      const event = new NativeClipboardEvent(type, init);
      try { if (init && init.clipboardData) clipboardInit.set(event, init.clipboardData); } catch {}
      return event;
    };
    ClipboardEvent.prototype = NativeClipboardEvent.prototype;
    try { window.ClipboardEvent = ClipboardEvent; } catch {}
  }
  const kindOf = (event) => {
    try {
      if (NativeClipboardEvent && event instanceof NativeClipboardEvent) return "clipboard";
      if (window.DragEvent && event instanceof window.DragEvent) return "drag";
      if (window.InputEvent && event instanceof window.InputEvent) return "input";
    } catch {}
    return "";
  };
  const MOUSE = ["screenX", "screenY", "clientX", "clientY", "button", "buttons", "ctrlKey", "shiftKey", "altKey", "metaKey"];
  function forward(target, event) {
    const kind = kindOf(event);
    if (!kind || event.isTrusted) return null;
    const transfer = kind === "clipboard" ? (clipboardInit.get(event) || event.clipboardData) : event.dataTransfer;
    if (!transfer) return null;
    const data = [];
    let files = [];
    try {
      for (const type of transfer.types || []) if (type !== "Files") data.push([type, transfer.getData(type)]);
      files = [...(transfer.files || [])];
    } catch { return null; }
    if (!data.length && !files.length) return null;
    let id = ids.get(transfer);
    if (!id) { id = ++seq; ids.set(transfer, id); }
    const init = { bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed };
    if (kind === "drag") for (const key of MOUSE) init[key] = event[key];
    if (kind === "input") { init.inputType = event.inputType; init.data = event.data; init.isComposing = event.isComposing; }
    let effectAllowed = "", dropEffect = "";
    try { effectAllowed = transfer.effectAllowed || ""; dropEffect = transfer.dropEffect || ""; } catch {}
    const root = document.documentElement;
    if (!root) return null;
    root.removeAttribute(RESULT);
    try {
      const detail = cloneInto({ id, kind, type: event.type, init, data, files, effectAllowed, dropEffect }, window);
      native.call(target, new window.CustomEvent(KEY, { bubbles: true, composed: true, detail }));
    } catch { root.removeAttribute(RESULT); return null; }
    const result = root.getAttribute(RESULT);
    root.removeAttribute(RESULT);
    if (result !== "1" && result !== "0") return null; // helper unavailable: native fallback
    if (result === "0") { try { event.preventDefault(); } catch {} }
    return result === "1";
  }
  proto.dispatchEvent = function dispatchEvent(event) {
    const forwarded = event && typeof event === "object" ? forward(this, event) : null;
    return forwarded === null ? native.call(this, event) : forwarded;
  };
})();
