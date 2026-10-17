// SPDX-License-Identifier: GPL-3.0-or-later
// providers/useai.js — Use AI (use.ai) provider.
// Chat lives at use.ai / use.ai/chat. Adaptive composer (textarea or contenteditable). Selectors fail open so a reskin still finds the box.
// eslint-disable-next-line no-unused-vars
const RSProvider = (() => {
  "use strict";
  // Reads can fail while a framework remounts a surface. Do not hide write failures.
  let domReadErrors = 0;
  function safeRead(read, fallback) {
    try { return read(); } catch { domReadErrors++; return fallback; }
  }
  function safeQuery(root, selector) {
    return safeRead(() => root.querySelector(selector), null);
  }
  function safeQueryAll(root, selector) {
    return safeRead(() => Array.from(root.querySelectorAll(selector)), []);
  }
  function safeClosest(node, selector) {
    return safeRead(() => node.closest(selector), null);
  }
  function safeRect(node) {
    return safeRead(() => node.getBoundingClientRect(), {x:0,y:0,left:0,top:0,right:0,bottom:0,width:0,height:0,readFailed:true});
  }
  function safeStyle(node) {
    return safeRead(() => getComputedStyle(node), {display:'none',visibility:'hidden',opacity:'0',overflow:'hidden',overflowY:'hidden'});
  }
  function safePredicate(predicate) {
    const before = domReadErrors;
    const result = safeRead(predicate, false);
    return before === domReadErrors ? result : false;
  }
  // A poll-count limit also bounds waits if the wall clock moves backwards.
  function waitBudget(timeout, interval) {
    const ms = Number.isFinite(timeout) ? Math.min(600000, Math.max(0, timeout)) : 30000;
    return {ms, polls: Math.ceil(ms / interval)};
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  const S = {
    editor:
      'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"], .ProseMirror, .tiptap, [role="textbox"]',
    sendAria: /^(send|submit|ask)$|send message|submit prompt/i,
    stopAria: /stop|cancel generation|abort/i,
    auth: 'a[href*="login"], button, [class*="login"]',
    errorSurfaces: '[role="alert"],[class*="toast"],[class*="error"],[data-sonner-toast]',
  };

  const RE = {
    contextLimit: /context.{0,20}(limit|exceeded)|conversation.{0,20}too long|(token|context).{0,10}limit/i,
    tooLong: /conversation .{0,20}(too long|getting too long)/i,
    busy: /rate limit|too many requests|try again later|temporarily unavailable|server is busy/i,
    continueBtn: /^(continue|continuer)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 1600,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function visible(el) {
    if (!el || safeClosest(el, "#rs-root")) return false;
    try {
      const r = safeRect(el);
      if (r.width < 16 || r.height < 10) return false;
      const s = safeStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    } catch { return false; }
    return true;
  }

  function textWithout(root, excludeSel) {
    if (!root) return "";
    const skip = excludeSel ? `.rs-chip, ${excludeSel}` : ".rs-chip";
    let t = "";
    const walk = (n) => {
      if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
      if (safeRead(() => n.nodeType, 0) !== 1) return;
      if (safeRead(() => n.matches, null) && safeRead(() => n.matches(skip), false)) return;
      if (safeRead(() => n.tagName, "") === "BR") { t += "\n"; return; }
      const isBlock = /^(P|DIV|PRE|LI|UL|OL|BLOCKQUOTE|H[1-6]|ARTICLE|SECTION)$/.test(safeRead(() => n.tagName, ""));
      if (isBlock && t && !t.endsWith("\n")) t += "\n";
      for (const c of safeRead(() => n.childNodes, [])) walk(c);
      if (isBlock && !t.endsWith("\n")) t += "\n";
    };
    walk(root);
    return t;
  }

  const getEditor = () => {
    const sels = S.editor.split(",").map((s) => s.trim());
    for (const sel of sels) {
      for (const el of safeQueryAll(document, sel)) {
        if (!visible(el)) continue;
        if (safeClosest(el, "nav, header, [role='navigation']")) continue;
        return el;
      }
    }
    return null;
  };

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (safeRead(() => e.tagName, "") === "TEXTAREA" || safeRead(() => e.tagName, "") === "INPUT") return safeRead(() => e.value, "") || "";
    return (safeRead(() => e.innerText, "") || safeRead(() => e.textContent, "") || "").replace(/\u00a0/g, " ");
  };

  function roleOf(item) {
    if (!item) return "";
    const a = (safeRead(() => item.getAttribute("data-message-role"), null) || safeRead(() => item.getAttribute("data-role"), null) || safeRead(() => item.getAttribute("data-author"), null) || "").toLowerCase();
    if (a) return a;
    const cls = String(safeRead(() => item.className, "") || "").toLowerCase();
    if (/\buser\b|human|from-user|msg-user/.test(cls)) return "user";
    if (/\bassistant\b|\bagent\b|\bai\b|from-assistant|msg-assistant/.test(cls)) return "assistant";
    const inner = safeQuery(item, "[data-message-role],[data-role]");
    if (inner) return (safeRead(() => inner.getAttribute("data-message-role"), null) || safeRead(() => inner.getAttribute("data-role"), null) || "").toLowerCase();
    return "";
  }

  function allItems() {
    const sels = [
      "[data-message-role]",
      "[data-role='user']",
      "[data-role='assistant']",
      ".msg, .message, [class*='ChatMessage'], [class*='chat-message']",
      "article",
    ];
    const seen = new Set();
    const out = [];
    for (const s of sels) {
      for (const el of safeQueryAll(document, s)) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);
        out.push(el);
      }
      if (out.length) break;
    }
    if (!out.length) {
      const log = safeQuery(document, "[role='log'], [role='feed'], main [class*='thread'], main [class*='messages']");
      if (log) {
        for (const el of safeRead(() => log.children, [])) {
          if (safeRead(() => el.nodeType, 0) === 1 && visible(el)) out.push(el);
        }
      }
    }
    return out;
  }

  function isUserItem(item) {
    const r = roleOf(item);
    if (/user|human/.test(r)) return true;
    if (/assistant|agent|ai|model|system/.test(r)) return false;
    return /\bml-auto\b|justify-end|items-end/.test(String(item && safeRead(() => item.className, "") || ""));
  }
  function isAssistantItem(item) {
    const r = roleOf(item);
    if (/assistant|agent|ai|model/.test(r)) return true;
    if (/user|human/.test(r)) return false;
    return !isUserItem(item) && !!(item && (safeRead(() => item.innerText, "") || "").trim());
  }

  function itemText(item) {
    if (!item) return "";
    const body = safeQuery(item, ".prose, .markdown, .bubble, [class*='message-content'], [class*='md']") || item;
    return textWithout(body);
  }
  function classifyText(item, excludeSel) {
    if (!item) return "";
    const body = safeQuery(item, ".prose, .markdown, .bubble, [class*='message-content']") || item;
    if (excludeSel && safeRead(() => body.closest, null) && safeClosest(body, excludeSel)) return "";
    return textWithout(body, excludeSel);
  }

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => { const it = assistantItems(); return it.length ? it[it.length - 1] : null; };

  const _idMap = new WeakMap();
  let _idSeq = 0;
  function itemKey(item) {
    if (!item) return null;
    let id = _idMap.get(item);
    if (!id) { id = ++_idSeq; _idMap.set(item, id); }
    return id;
  }
  const lastAssistantId = () => itemKey(lastAssistant());

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && !!getEditor();

  function composerFrame() {
    const ed = getEditor();
    if (!ed) return null;
    return safeClosest(ed, "form")
      || safeClosest(ed, "[class*='composer']")
      || safeClosest(ed, "footer")
      || safeRead(() => ed.parentElement, null);
  }
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 10 && n; i++) {
      const cls = String(safeRead(() => n.className, "") || "");
      if (/rounded|composer|input-bar|chat-input/i.test(cls)) return n;
      n = safeRead(() => n.parentElement, null);
    }
    return composerFrame();
  }

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (ed.isContentEditable || safeRead(() => ed.getAttribute("contenteditable"), null) === "true") {
      ed.setAttribute("contenteditable", on ? "false" : "true");
      return;
    }
    if (on) {
      if (!ed.dataset.rsPlaceholder) ed.dataset.rsPlaceholder = safeRead(() => ed.getAttribute("placeholder"), null) || "";
      ed.setAttribute("readonly", "");
      ed.setAttribute("placeholder", "⏳ Agent working… please wait");
    } else {
      ed.removeAttribute("readonly");
      if (ed.dataset.rsPlaceholder != null) ed.setAttribute("placeholder", ed.dataset.rsPlaceholder);
    }
  }

  function loginGatePresent() {
    const p = (location.pathname || "").toLowerCase();
    if (/^\/login(\/|$)/.test(p) || /callbackurl=/i.test(location.search || "")) return true;
    try {
      for (const el of safeQueryAll(document, "button, a, h1, h2, p")) {
        if (!visible(el)) continue;
        const t = (safeRead(() => el.textContent, "") || "").trim();
        if (/continue with (github|google)/i.test(t)) return true;
      }
    } catch {}
    return false;
  }

  function isProductPage() {
    return /^\/(web|cloud|desktop)(\/|$)/i.test(location.pathname || "");
  }
  function modeWarning() {
    if (loginGatePresent()) {
      return "<b>Use AI</b> — sign in first, then open Chat (use.ai/chat).";
    }
    if (isProductPage() && !getEditor()) {
      return "<b>Use AI</b> — open <b>Chat</b> at use.ai/chat, then reload.";
    }
    if (!getEditor()) {
      return "<b>Use AI</b> — open <b>Chat</b> at use.ai/chat, then reload.";
    }
    return "";
  }

  const ariaOf = (b) => (safeRead(() => b.getAttribute("aria-label"), null) || safeRead(() => b.title, "") || "").trim();
  const allButtons = () => [...safeQueryAll(document, "button")].filter((b) => !safeClosest(b, "#rs-root"));
  const sendButton = () =>
    allButtons().find((b) => S.sendAria.test(ariaOf(b)) && visible(b) && b.type !== "reset") ||
    allButtons().find((b) => safeRead(() => b.type, "") === "submit" && visible(b)) ||
    null;
  const stopButton = () =>
    allButtons().find((b) => S.stopAria.test(ariaOf(b)) && visible(b)) || null;

  function streamText(item) {
    if (!item) return "";
    return classifyText(item, ".rs-chip").trim();
  }
  const streamLen = (item) => streamText(item === undefined ? lastAssistant() : item).length;

  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = streamText(item).length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  const WEDGE_MS = 10000;
  let _stopSince = 0;
  function genActive() {
    sampleStream();
    const stop = !!stopButton();
    const now = Date.now();
    if (stop) {
      if (!_stopSince) _stopSince = now;
      return (now - _streamAt < WEDGE_MS) || (now - _stopSince < 2000);
    }
    _stopSince = 0;
    return grewWithin(timings.GEN_IDLE_MS);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton();

  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { th: 0, rp: 0 };
      return { th: 0, rp: streamLen(it) };
    } catch { return {}; }
  }
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: streamText(item).trim(), thinking: "", item };
  }

  async function waitFor(pred, timeout) {
    const budget = waitBudget(timeout, 120), t0 = Date.now();
    for (let poll = 0; poll < budget.polls && Date.now() - t0 < budget.ms; poll++) {
      const result = safePredicate(pred);
      if (result) return true;
      await sleep(120);
    }
    return false;
  }

  const SEND_MAX = 120000;
  function truncateForSend(text) {
    if(typeof window.__rsLimitOutgoing==="function")return window.__rsLimitOutgoing(text);
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker = `\n\n[…synerixcode: result truncated to fit Use AI's input limit - ${omitted} of ${text.length} characters omitted…]\n\n`;
    const budget = SEND_MAX - marker.length;
    const headLen = Math.floor(budget * 0.85);
    const tailLen = budget - headLen;
    return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
  }

  function setTextareaValue(el, v) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setRichText(el, text) {
    if (safeRead(() => el.tagName, "") === "TEXTAREA" || safeRead(() => el.tagName, "") === "INPUT") {
      setTextareaValue(el, text);
      return;
    }
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch {}
    if (!ok) {
      el.textContent = text;
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function pressEnter(editor) {
    const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", o));
    editor.dispatchEvent(new KeyboardEvent("keyup", o));
  }

  async function typeAndSend(text, images) {
    const editor = getEditor();
    if (!editor) throw new Error("Use AI chat box not found — open use.ai/chat and sign in if needed");
    editor.focus();
    await sleep(40);
    text = truncateForSend(text);
    setRichText(editor, text);
    await sleep(80);
    if (images && images.length) {
      try { await attachImages(images); } catch {}
    }
    const sendReady = () => {
      const b = sendButton();
      return !!b && !safeRead(() => b.disabled, true) && safeRead(() => b.getAttribute("aria-disabled"), null) !== "true";
    };
    await waitFor(sendReady, 2500);
    diag("useai.send", { editorLen: editorText().length, textLen: text.length });
    let sent = false;
    for (let i = 0; i < 5 && !sent; i++) {
      const b = sendButton();
      if (b && !safeRead(() => b.disabled, true)) { try { b.click(); } catch {} }
      else {
        try {
          const form = safeClosest(editor, "form");
          if (form && typeof form.requestSubmit === "function") form.requestSubmit();
          else pressEnter(editor);
        } catch { pressEnter(editor); }
      }
      sent = await waitFor(() => editorText().trim() === "" || isHardGenerating(), 800);
    }
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); } catch {} }
  }

  function scanError() {
    try {
      for (const el of safeQueryAll(document, S.errorSurfaces)) {
        if (!visible(el)) continue;
        const t = (safeRead(() => el.innerText, "") || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    if (!getEditor() && !loginGatePresent()) return "The input box disappeared (session ended?).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text);

  function fileFromImage(img, i) {
    if (typeof synerixcodeMedia !== "undefined") return synerixcodeMedia.fileFrom(img, i);
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : "jpg";
    return new File([arr], `or_${Date.now()}_${i}.${ext}`, { type: mime });
  }
  function clearAttachments() {}
  async function attachImages(images) {
    const editor = getEditor();
    if (!editor || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    const fileInput = safeQuery(document, 'input[type="file"]');
    if (fileInput) {
      try {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch {}
    }
    try {
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {}
    return false;
  }

  const conversationKey = () => {
    const m = (location.pathname || "").match(/\/(?:chat|c|conversation|thread)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : location.pathname;
  };

  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const ed = getEditor();
      if (!ed || !safeRead(() => ed.contains(e.target), false)) return;
      if (editorText().trim() === "") return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
    document.addEventListener("click", (e) => {
      if (!getEditor()) return;
      const t = e.target;
      const stop = safeRead(() => t.closest, null) && safeClosest(t, "button");
      if (stop && S.stopAria.test(ariaOf(stop))) { handlers.onNativeStop(); return; }
      const btn = safeRead(() => t.closest, null) && safeClosest(t, "button");
      if (!btn) return;
      const isSend = S.sendAria.test(ariaOf(btn)) || safeRead(() => btn.type, "") === "submit";
      if (!isSend) return;
      if (safeRead(() => btn.disabled, true)) return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item) {
    if (!item) return null;
    let parent = null, ref = null;
    for (const pre of safeQueryAll(item, "pre")) {
      if (safeRead(() => pre.closest, null) && safeClosest(pre, ".rs-chip")) continue;
      if (!CMD_SHAPE.test(safeRead(() => pre.textContent, "") || "")) continue;
      pre.classList.add("rs-tool-hide");
      item.classList.add("rs-cmd-mask");
      if (!ref && safeRead(() => pre.parentElement, null)) { parent = safeRead(() => pre.parentElement, null); ref = pre; }
    }
    return ref ? { parent, ref } : null;
  }

  return {
    id: "useai",
    displayName: "Use AI",
    supportsVision: true,
    timings,
    thinkingSel: ".reasoning, [class*='thinking'], [class*='reason']",
    init({ diag: d } = {}) {
      if (d) diag = d;
      try { document.documentElement.setAttribute("data-rs-useai-ver", "2026-09"); } catch {}
      diag("useai.init", { hasEditor: !!getEditor(), login: loginGatePresent(), path: location.pathname });
    },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer() { return { ready: true }; },
    async ensureComposerReady(reason) {
      diag("useai.mode_ready", { reason, hasEditor: !!getEditor(), login: loginGatePresent() });
      return { ready: !!getEditor() && !loginGatePresent() };
    },
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    modeWarning, loginGatePresent,
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
