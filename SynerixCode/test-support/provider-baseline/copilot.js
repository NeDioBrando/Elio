// SPDX-License-Identifier: GPL-3.0-or-later
// providers/copilot.js - the Copilot provider (covers BOTH GitHub Copilot at
// github.com/copilot AND Microsoft Copilot at copilot.microsoft.com).
// Exports the same RSProvider interface as providers/deepseek.js; the core
// (core/main.js) is provider-agnostic.
//
// DOM notes — validated live 2026-08:
//
//  Microsoft Copilot (copilot.microsoft.com / copilot.microsoft.com/chats):
//   - Textarea: <textarea id="userInput" data-testid="composer-input"
//     placeholder="Message Copilot"> inside [data-testid="composer"]
//     Wrapper: [data-testid="composer"], [data-testid="composer-content"]
//     File input: [data-testid="composer-file-input"] (hidden input[type=file])
//   - Messages: React app — each exchange renders assistant + user blocks.
//     Selectors tried in order (see S.chatItem / S.markdown): data-content
//     attributes, cib- custom elements, markdown-body, generic chat patterns.
//     The page is SSR + client-hydrated; messages appear after login.
//   - Stop/send: button inside composer; aria-label or data-testid based.
//     During generation a stop button replaces send.
//   - Busy: [aria-busy="true"], [data-is-typing], .typing-indicator etc.
//
//  GitHub Copilot (github.com/copilot):
//   - React / Primer app at github.com/copilot (requires login to see chat).
//   - Composer is also a <textarea> (data-testid="composer-input" pattern,
//     same design system as Microsoft Copilot).
//   - Messages use data-message-author-role="user|assistant" or similar
//     semantic markers; markdown renders in .markdown-body / .markdown.
//   - Same Copilot design tokens — shares many selectors with above.
//
//  Because neither site's chat is visible without login, every selector has
//  multiple fallbacks and heuristic scans. The provider never assumes one
//  site's DOM — it tries the known selectors first, then falls back to
//  generic heuristics (any visible textarea, any chat-like container).
// eslint-disable-next-line no-unused-vars
const RSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  // ── Selectors ─────────────────────────────────────────────────────────
  // Ordered by specificity: most precise first, generic heuristics last.
  const S = {
    // Composer / editor — Microsoft Copilot validated live:
    //   <textarea id="userInput" data-testid="composer-input"
    //     placeholder="Message Copilot">
    editor: [
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      '[data-testid="composer"] textarea',
      '[data-testid="composer-content"] textarea',
      'textarea[placeholder*="Message Copilot"]',
      'textarea[placeholder*="Ask Copilot"]',
      'textarea[placeholder*="Copilot"]',
      'textarea[placeholder*="Ask"]',
      'cib-text-input textarea',
      'textarea',
    ].join(", "),
    // Composer frame — the container that holds the textarea + send button
    composerFrame: [
      '[data-testid="composer"]',
      '[data-testid="composer-content"]',
      '[data-testid="composer-background"]',
      'form',
    ].join(", "),
    // Send button — inside composer
    sendBtn: [
      '[data-testid="composer"] button[type="submit"]',
      '[data-testid="composer"] button[aria-label*="Send"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Submit"]',
      '[data-testid="composer"] button:not([aria-label*="Stop"]):not([data-testid*="stop"])',
    ].join(", "),
    // Stop button — present during generation
    stopBtn: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      '[data-testid="composer"] button[aria-label*="Stop"]',
    ].join(", "),
    // Chat messages — Microsoft Copilot + GitHub Copilot + generic
    // Microsoft: div[data-content="ai-message"], .group/ai-message-item,
    //   cib-message-group, cib-response-container, [data-content="response"]
    // GitHub: [data-message-author-role], .markdown-body
    chatItem: [
      '[data-message-author-role]',
      'div[data-content="ai-message"]',
      'div[data-content="ai-message"] .group\\/ai-message-item',
      'cib-message-group[data-source="cib"]',
      'cib-chat-turn',
      '[data-content="chat-message"]',
      '[data-content="response"]',
      '[data-testid="chat-message"]',
      '[data-testid="answer"]',
      '[data-testid="bot-message"]',
      '.b_sydConvCont',
      '[class*="ai-message"]',
      '[class*="chat-message"]',
    ].join(", "),
    // Markdown / reply body inside a turn
    markdown: [
      '.markdown-body',
      '.markdown',
      '[class*="markdown"]',
      'message-content',
      '[data-content="ai-message"]',
      'cib-message[type="text"]',
      '.response-text',
      '.text-response',
      '[class*="prose"]',
    ].join(", "),
    generating: [
      '[data-testid="typing-indicator"]',
      '[aria-busy="true"]',
      '[data-is-typing="true"]',
      '[data-activity="typing"]',
      '.typing-indicator',
      '.is-typing',
      '[class*="loading"]',
      '[class*="spinner"]',
    ].join(", "),
    errorSurfaces:
      '[role="alert"],[class*="toast"],[class*="error"],[class*="warning"],[data-sonner-toast]',
  };

  const RE = {
    contextLimit: new RegExp(
      [
        "conversation.{0,20}(too long|trop long)",
        "context.{0,20}(limit|exceeded|d\\u00e9pass\\u00e9)",
        "session.{0,20}(expired|expir\\u00e9e)",
        "please.{0,30}(start|cr\\u00e9er).{0,20}(new|nouveau).{0,20}(chat|conversation)",
        "(token|context).{0,10}limit",
        "message.{0,20}too.{0,10}long",
        "message.{0,20}exceeds",
        "exceeds.{0,20}10240",
        "maximum.{0,20}context",
        "this conversation has reached",
        "cette conversation a atteint",
      ].join("|"),
      "i"
    ),
    tooLong: /conversation .{0,20}(too long|getting too long|trop longue)/i,
    busy: /server is busy|serveur est occup|please try again|réessayer plus tard|system is currently busy|rate limit|too many requests/i,
    continueBtn: /^(continue|continuer|keep going|resume)$/i,
    stopped: /(arrêté|arrété|stopped|halted|interrupted)/i,
  };

  const timings = {
    GEN_IDLE_MS: 1500,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  function visible(el) {
    if (!el) return false;
    try {
      // Textarea#userInput is always visible in Microsoft Copilot's layout;
      // its sibling send-button container is w-0 until hydration, but the
      // textarea itself is not. Don't gate on offsetParent — React flex can
      // report null offsetParent even when rendered.
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (s.opacity === "0") return false;
      // If element is in DOM and not display:none, treat as usable.
      // BoundingRect check is unreliable during hydration.
      return true;
    } catch { return !!el; }
  }
  function isVisibleForClick(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch { return el.offsetParent !== null; }
  }

  // ── Turn classification ───────────────────────────────────────────────
  function isUserItem(item) {
    if (!item) return false;
    const role = item.getAttribute && item.getAttribute("data-message-author-role");
    if (role) return role === "user";
    const dataContent = item.getAttribute && item.getAttribute("data-content");
    if (dataContent === "user-message") return true;
    // Microsoft Copilot: user messages often have different data-content or class
    if (item.matches && item.matches('[data-content="user-message"]')) return true;
    // cib custom element: check source attribute
    const src = item.getAttribute && item.getAttribute("data-source");
    if (src === "user") return true;
    // Fallback: class-based
    if (item.classList && (
      item.classList.contains("user-message") ||
      item.classList.contains("human-message") ||
      item.classList.contains("user")
    )) return true;
    // GitHub Copilot / generic: check if contains user-indicating text near top
    return false;
  }

  function isAssistantItem(item) {
    if (!item) return false;
    const role = item.getAttribute && item.getAttribute("data-message-author-role");
    if (role) return role === "assistant" || role === "bot" || role === "ai";
    if (item.matches && item.matches('div[data-content="ai-message"], [data-content="response"], [data-message-author="bot"], cib-response-container, [data-testid="answer"], [data-testid="bot-message"]')) return true;
    const src = item.getAttribute && item.getAttribute("data-source");
    if (src === "cib" || src === "ai") return true;
    // If it matched chatItem but is not a user item, treat as assistant
    if (!isUserItem(item)) return true;
    return false;
  }

  function itemText(item) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      // Try markdown containers first
      const mds = item.querySelectorAll(S.markdown);
      if (mds.length) {
        const t = [...mds].map((m) => m.textContent).join("\n").trim();
        if (t) return t;
      }
      // Fallback: whole item text minus excluded areas
      return (item.textContent || "").trim();
    }
    return (item.textContent || "").trim();
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      const mds = [...item.querySelectorAll(S.markdown)];
      if (mds.length) {
        return mds
          .filter((m) => !(excludeSel && m.closest(excludeSel)))
          .map((m) => (m.textContent || "")).join("\n");
      }
      // Fallback
      if (excludeSel && item.closest && item.closest(excludeSel)) return "";
      let t = "";
      for (const n of item.childNodes) {
        if (excludeSel && n.nodeType === 1 && n.matches && n.matches(excludeSel)) continue;
        t += n.textContent || "";
      }
      return t;
    }
    let t = "";
    for (const n of item.childNodes) {
      if (excludeSel && n.nodeType === 1 && n.matches && n.matches(excludeSel)) continue;
      t += n.textContent || "";
    }
    return t;
  }

  // ── DOM primitives ────────────────────────────────────────────────────
  function allItems() {
    // Try primary chatItem selectors
    let items = [...document.querySelectorAll(S.chatItem)];
    // Filter to only those that look like real turns (have text, not empty wrappers)
    // and exclude our own UI
    items = items.filter((el) => !el.closest("#rs-root") && (el.textContent || "").trim().length > 0);
    // Deduplicate: nested matches (e.g. div[data-content="ai-message"] and its child
    // .group/ai-message-item) — keep only outermost
    if (items.length > 1) {
      const filtered = [];
      for (const el of items) {
        if (!filtered.some((p) => p.contains(el))) filtered.push(el);
      }
      items = filtered;
    }
    // If still nothing, heuristic fallback: find message-like containers
    // Look for elements that contain markdown-body or are direct children of
    // known chat containers
    if (items.length === 0) {
      const heu = [
        ...document.querySelectorAll('.markdown-body'),
        ...document.querySelectorAll('[class*="message-"]'),
        ...document.querySelectorAll('[class*="response"]'),
        ...document.querySelectorAll('cib-message-group'),
      ].map((el) => {
        // For markdown-body, use its message container ancestor
        let p = el.closest('[data-message-author-role], div[data-content], cib-message-group, [class*="message-"]');
        return p || el;
      }).filter((el) => el && !el.closest("#rs-root"));
      if (heu.length) items = heu;
    }
    return items;
  }

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;

  function getEditor() {
    // Microsoft Copilot: #userInput is SSR-rendered and always present.
    // Priority: direct ID lookup (fastest, hydration-independent), then selectors.
    const byId = document.getElementById("userInput");
    if (byId && (!byId.closest || !byId.closest("#rs-root"))) return byId;
    const byTestId = document.querySelector('[data-testid="composer-input"]');
    if (byTestId && (!byTestId.closest || !byTestId.closest("#rs-root"))) return byTestId;
    const selectors = S.editor.split(", ");
    for (const sel of selectors) {
      try {
        for (const e of document.querySelectorAll(sel)) {
          if (!e.closest || e.closest("#rs-root")) continue;
          return e;
        }
      } catch {}
    }
    for (const e of document.querySelectorAll('textarea, [contenteditable="true"]')) {
      if (e.closest && e.closest("#rs-root")) continue;
      return e;
    }
    return null;
  }

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (e.value != null) return e.value;
    return e.textContent || "";
  };

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (on) {
      if (!ed.dataset.rsPlaceholder) ed.dataset.rsPlaceholder = ed.getAttribute("placeholder") || "";
      ed.setAttribute("readonly", "");
      ed.setAttribute("placeholder", "⏳ Agent working… please wait");
    } else {
      ed.removeAttribute("readonly");
      if (ed.dataset.rsPlaceholder != null) ed.setAttribute("placeholder", ed.dataset.rsPlaceholder);
    }
  }

  const lastAssistant = () => {
    const it = assistantItems();
    return it.length ? it[it.length - 1] : null;
  };

  const _idMap = new WeakMap();
  let _idSeq = 0;
  function itemKey(item) {
    if (!item) return null;
    // Try stable DOM id first
    const did = item.getAttribute && (item.getAttribute("data-message-id") || item.getAttribute("data-id") || item.getAttribute("id"));
    if (did) return did;
    let id = _idMap.get(item);
    if (!id) { id = "rs-" + (++_idSeq); _idMap.set(item, id); }
    return id;
  }
  function lastAssistantId() {
    return itemKey(lastAssistant());
  }

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => {
    if (!chatIsEmpty()) return false;
    if (!getEditor()) return false;
    // Both copilot sites: fresh chat when no messages yet
    return true;
  };

  function composerFrame() {
    const ta = getEditor();
    if (!ta) return null;
    // Try known composer frames first
    const frames = S.composerFrame.split(", ");
    for (const sel of frames) {
      try {
        const f = ta.closest(sel);
        if (f) return f;
      } catch {}
    }
    // Fallback: walk up and find container that also holds send button or is form-like
    let n = ta;
    for (let i = 0; i < 10 && n && n.parentElement; i++) {
      if (n.tagName === "FORM" || n.getAttribute("data-testid") === "composer") return n;
      n = n.parentElement;
    }
    // Generic climb
    let f = ta;
    for (let i = 0; i < 6 && f.parentElement; i++) f = f.parentElement;
    return f;
  }

  // Anchored mode: React owns this subtree; keep the bar outside it and hug
  // the composer card's top edge instead.
  function barAnchor() {
    const ta = getEditor();
    if (!ta) return null;
    let box = ta.closest('.w-expanded-composer')
      || ta.closest('[class*="w-expanded-composer"]')
      || ta.closest('[data-testid="composer"]')
      || ta.closest('[data-testid="composer-content"]');
    if (!box) {
      const createBtn = document.getElementById('composer-create-button');
      if (createBtn) {
        let n = ta;
        for (let i = 0; i < 10 && n; i++) {
          if (n.contains(createBtn)) { box = n; break; }
          n = n.parentElement;
        }
      }
    }
    return box || ta.parentElement;
  }

  // ── Composer mode ─────────────────────────────────────────────────────
  function enforceComposer(reason) { return { ready: true }; }
  async function ensureComposerReady(reason) {
    diag("mode_ready", { reason, provider: "copilot", hasEditor: !!getEditor() });
    return { ready: !!getEditor() };
  }

  // ── Generation detection ──────────────────────────────────────────────
  function streamText(item) {
    if (!item) return "";
    const mds = item.querySelectorAll(S.markdown);
    if (mds.length) {
      return [...mds].map((m) => {
        // Exclude chip
        let t = "";
        const walk = (n) => {
          if (n.nodeType === 3) { t += n.nodeValue; return; }
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches(".rs-chip")) return;
          for (const c of n.childNodes) walk(c);
        };
        walk(m);
        return t;
      }).join("\n");
    }
    return (item.textContent || "");
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

  function hasStopButton() {
    const selectors = S.stopBtn.split(", ");
    for (const sel of selectors) {
      try {
        const b = document.querySelector(sel);
        if (b && b.offsetParent !== null) return true;
        // Also check visible via getComputedStyle
        if (b && visible(b)) return true;
      } catch {}
    }
    return false;
  }

  function hasGeneratingIndicator() {
    const selectors = S.generating.split(", ");
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true;
      } catch {}
    }
    return false;
  }

  function isGenerating() {
    if (hasStopButton()) return true;
    if (hasGeneratingIndicator()) return true;
    sampleStream();
    return grewWithin(timings.GEN_IDLE_MS);
  }
  function isBusyNow() {
    if (hasStopButton()) return true;
    if (hasGeneratingIndicator()) return true;
    sampleStream();
    return grewWithin(timings.GEN_IDLE_MS);
  }
  function isHardGenerating() { return hasStopButton(); }

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { th: 0, rp: 0 };
      const md = [...it.querySelectorAll(S.markdown)];
      return { th: 0, rp: md.reduce((n, m) => n + (m.textContent || "").length, 0) };
    } catch { return {}; }
  }

  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    // Try markdown containers first
    const mds = item.querySelectorAll(S.markdown);
    let reply = "";
    if (mds.length) {
      reply = [...mds].map((m) => {
        let t = "";
        const walk = (n) => {
          if (n.nodeType === 3) { t += n.nodeValue; return; }
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches(".rs-chip")) return;
          for (const c of n.childNodes) walk(c);
        };
        walk(m);
        return t;
      }).join("\n").trim();
    }
    if (!reply) {
      // Fallback: whole item minus chip
      let t = "";
      const walk = (n) => {
        if (n.nodeType === 3) { t += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches(".rs-chip")) return;
        for (const c of n.childNodes) walk(c);
      };
      walk(item);
      reply = t.trim();
    }
    return { present: true, reply, thinking: "", item };
  }

  function findContinueBtn() {
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null) continue;
      if (RE.continueBtn.test((b.innerText || "").trim())) return b;
    }
    return null;
  }
  function clickContinueBtn() {
    const b = findContinueBtn();
    if (!b) return false;
    try { b.click(); return true; } catch { return false; }
  }
  const turnHalted = () => false;

  async function waitFor(pred, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(120);
    }
    return false;
  }

  // ── Sending ───────────────────────────────────────────────────────────
  function setTextareaValue(el, v) {
    // Handle both textarea and contenteditable
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement && window.HTMLInputElement.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.focus();
      // Select all, then insert
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // Fallback: try value setter anyway
      try {
        el.value = v;
        el.textContent = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {}
    }
  }

  function pressEnter(editor) {
    const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", o));
    editor.dispatchEvent(new KeyboardEvent("keypress", o));
    editor.dispatchEvent(new KeyboardEvent("keyup", o));
  }

  function clickSendButton() {
    if (isBusyNow()) return false;
    const selectors = S.sendBtn.split(", ");
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisibleForClick(btn)) {
          btn.click();
          return true;
        }
      } catch {}
    }
    const ed = getEditor();
    if (ed) {
      const frame = composerFrame();
      if (frame) {
        for (const b of frame.querySelectorAll("button")) {
          if (!isVisibleForClick(b)) continue;
          const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
          if (/send|submit|enviar|envoyer/.test(label) || b.type === "submit") {
            if (/stop|arrêt|detener/.test(label)) continue;
            try { b.click(); return true; } catch {}
          }
        }
        for (const b of frame.querySelectorAll("button")) {
          if (!isVisibleForClick(b)) continue;
          const label = (b.getAttribute("aria-label") || "").toLowerCase();
          if (/stop/.test(label)) continue;
          try { b.click(); return true; } catch {}
        }
      }
    }
    return false;
  }

  // Hard site limit: Copilot rejects any user message > 10240 chars
  // (error: "message exceeds 10240 characters"). Stay safely under.
  const SEND_MAX = 9700;
  function truncateForSend(text) {
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker =
      `\n\n[…synerixcode: result truncated to fit Copilot's input limit - ` +
      `${omitted} of ${text.length} characters omitted…]\n\n`;
    const budget = SEND_MAX - marker.length;
    const headLen = Math.floor(budget * 0.85);
    const tailLen = budget - headLen;
    return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
  }

  async function typeAndSend(text, images) {
    const editor = getEditor();
    if (!editor) throw new Error("Copilot input box not found — selectors tried: " + S.editor.slice(0, 120));
    // Ensure composer is hydrated: Microsoft Copilot SSR ships textarea immediately
    // but send button hydrates later (w-0 container). Wait briefly for React.
    for (let i = 0; i < 10 && !editor.isConnected; i++) await sleep(100);
    editor.focus();
    await sleep(80);
    // Microsoft Copilot's textarea needs a click to activate React focus state
    try { editor.click(); } catch {}
    await sleep(50);
    text = truncateForSend(text);
    setTextareaValue(editor, text);
    await sleep(150);
    // Verify text landed — Microsoft Copilot's React state sometimes lags
    if (editorText().trim().length === 0 && text.trim().length > 0) {
      diag("copilot.retrySet", { before: editorText().length });
      if (editor.isContentEditable || editor.getAttribute("contenteditable") === "true") {
        editor.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } else {
        const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value");
        if (proto && proto.set) proto.set.call(editor, text);
        else editor.value = text;
        // Dispatch with InputEvent for React 18+ (copilot uses React 18)
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: text.slice(0, 20), inputType: "insertText" }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
        // Also trigger React's internal tracker via native setter + bubbling
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      }
      await sleep(200);
      diag("copilot.retrySetAfter", { after: editorText().length });
    }
    if (images && images.length) {
      try { await attachImages(images); } catch (e) { diag("attach.err", { msg: String(e && e.message || e).slice(0, 120) }); }
    }
    diag("copilot.send", { editorLen: editorText().length, textLen: text.length, hasImages: !!(images && images.length), id: editor.id || editor.getAttribute("data-testid") || "?" });
    // Microsoft Copilot PRIMARY send is Enter key (send button hydrates async and
    // is often w-0 until React enables it). Try Enter FIRST — most reliable.
    // Button click is fallback.
    let sent = false;
    // Give React a moment to enable send state after input
    await sleep(250);
    // Attempt Enter (works on both GitHub & Microsoft Copilot)
    if (!isBusyNow()) {
      pressEnter(editor);
      sent = await waitFor(() => editorText().trim() === "" || isHardGenerating() || hasGeneratingIndicator(), 1800);
      if (sent) { diag("copilot.sentViaEnter", {}); return; }
    }
    // Fallback: wait for button then click
    await waitFor(() => {
      const selectors = S.sendBtn.split(", ");
      for (const sel of selectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && isVisibleForClick(btn)) return true;
        } catch {}
      }
      const frame = composerFrame();
      if (frame) {
        for (const b of frame.querySelectorAll("button")) {
          if (isVisibleForClick(b)) {
            const label = (b.getAttribute("aria-label") || "").toLowerCase();
            if (!/stop/.test(label)) return true;
          }
        }
      }
      return false;
    }, 2500);
    if (!isBusyNow() && clickSendButton()) {
      diag("copilot.sentViaClick", {});
      await waitFor(() => editorText().trim() === "" || isHardGenerating() || hasGeneratingIndicator(), 2000);
      return;
    }
    // Last resort: Enter again
    if (!isBusyNow()) {
      pressEnter(editor);
      await sleep(200);
      if (editorText().trim().length > 0) {
        await sleep(300);
        clickSendButton();
      }
    }
    await waitFor(() => editorText().trim() === "" || isHardGenerating() || hasGeneratingIndicator(), 2500);
  }

  function stopGeneration() {
    const selectors = S.stopBtn.split(", ");
    for (const sel of selectors) {
      try {
        const b = document.querySelector(sel);
        if (b && visible(b)) { try { b.click(); } catch {} return; }
      } catch {}
    }
    // Heuristic: any button with stop label in composer
    const frame = composerFrame();
    if (frame) {
      for (const b of frame.querySelectorAll("button")) {
        if (!visible(b)) continue;
        const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
        if (/stop|arrêt|detener/.test(label)) { try { b.click(); } catch {} return; }
      }
    }
  }

  // ── Error / limit detection ───────────────────────────────────────────
  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        const chatItem = el.closest(S.chatItem.split(",").map((s) => s.trim()).join(", "));
        if (chatItem) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    // Microsoft Copilot specific: check for sign-in / expired session banners
    try {
      for (const el of document.querySelectorAll('[class*="error"], [class*="warning"], [role="alert"]')) {
        if (el.offsetParent === null) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 600) {
          if (/sign.?in|log.?in|session.?expired|please.*continue|rate.?limit/i.test(t)) return t.slice(0, 240);
        }
      }
    } catch {}
    if (!getEditor()) return "The input box disappeared (session ended? — try reloading the page).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text);

  // ── Image attachment ──────────────────────────────────────────────────
  function fileFromImage(img, i) {
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return new File([arr], `robloxscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }

  function clearAttachments() {
    try {
      const frame = composerFrame();
      if (!frame) return;
      frame.querySelectorAll('[aria-label*="Remove"], [aria-label*="remove"], [aria-label*="Delete"], [class*="remove"], [class*="delete"]')
        .forEach((d) => { try { d.click(); } catch {} });
    } catch {}
  }

  async function attachImages(images) {
    const editor = getEditor();
    if (!editor || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    editor.focus();
    // Prefer hidden file input (most reliable for both sites)
    // Microsoft Copilot: [data-testid="composer-file-input"]
    // GitHub Copilot: input[type="file"]
    const fileInput = document.querySelector('[data-testid="composer-file-input"]')
      || document.querySelector('input[type="file"]');
    if (fileInput) {
      try {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        diag("attach.fileInput", { count: dt.items.length });
      } catch (e) { diag("attach.fileInputErr", { msg: String(e && e.message || e).slice(0, 80) }); }
      // Wait for preview
      const ok = await waitFor(() => {
        const frame = composerFrame();
        if (!frame) return false;
        return !!frame.querySelector("img, [class*='preview'], [class*='thumbnail'], [class*='attachment']");
      }, 12000);
      if (ok) return true;
    }
    // Fallback: paste event
    try {
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      diag("attach.paste", { count: dt.items.length });
    } catch {}
    return await waitFor(() => {
      const frame = composerFrame();
      if (!frame) return false;
      return !!frame.querySelector("img, [class*='preview'], [class*='thumbnail']");
    }, 8000);
  }

  const conversationKey = () => {
    const p = location.pathname;
    if (p === "/copilot" || p === "/copilot/" || p === "/" || p === "/chats" || p === "/chats/") return "";
    return p;
  };

  // ── User-send interception ────────────────────────────────────────────
  function installSendHooks(handlers) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const editor = getEditor();
        if (!editor || !editor.contains(e.target)) return;
        const text = editorText().trim();
        if (text === "") return;
        if (handlers.isBlocked()) return;
        if (!handlers.isStarted()) {
          if (!chatIsEmpty()) return;
          handlers.onBlockedAttempt();
          return;
        }
        handlers.onUserMessage(assistantCount());
      },
      true
    );

    document.addEventListener(
      "click",
      (e) => {
        if (!getEditor()) return;
        const t = e.target;
        if (!t || !t.closest) return;
        // Stop button — allow native stop
        const stopSelectors = S.stopBtn.split(", ");
        for (const sel of stopSelectors) {
          try {
            const stop = t.closest(sel);
            if (stop) { handlers.onNativeStop(); return; }
          } catch {}
        }
        // Also heuristic stop
        const maybeStop = t.closest("button");
        if (maybeStop) {
          const label = (maybeStop.getAttribute("aria-label") || "").toLowerCase();
          if (/stop|arrêt/.test(label)) { handlers.onNativeStop(); return; }
        }
        // Continue button
        const cont = t.closest("button");
        if (cont && RE.continueBtn.test((cont.innerText || "").trim())) {
          handlers.onNativeContinue();
          return;
        }
        // Send button — detect via selectors or heuristic
        let isSend = false;
        for (const sel of S.sendBtn.split(", ")) {
          try { if (t.closest(sel)) { isSend = true; break; } } catch {}
        }
        if (!isSend && maybeStop) {
          // Heuristic: button inside composer that is not stop
          const frame = composerFrame();
          if (frame && frame.contains(maybeStop)) {
            const label = (maybeStop.getAttribute("aria-label") || maybeStop.textContent || "").toLowerCase();
            if (!/stop/.test(label) && visible(maybeStop) && !maybeStop.disabled) isSend = true;
          }
        }
        if (!isSend) return;
        const btn = maybeStop;
        if (btn && (btn.getAttribute("aria-disabled") === "true" || btn.disabled)) return;
        if (handlers.isBlocked()) return;
        if (!handlers.isStarted()) {
          if (!chatIsEmpty()) return;
          handlers.onBlockedAttempt();
          return;
        }
        handlers.onUserMessage(assistantCount());
      },
      true
    );
  }

  // ── Tool-block camouflage ─────────────────────────────────────────────
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item, chip) {
    if (!item) return null;
    let parent = null, ref = null;
    // Try markdown containers first
    const containers = item.querySelectorAll(S.markdown);
    const searchRoots = containers.length ? [...containers] : [item];
    for (const container of searchRoots) {
      if (chip && container.contains(chip)) continue;
      // Check code-block wrappers
      for (const cw of container.querySelectorAll("pre, code, [class*='code']")) {
        if (cw.closest && cw.closest(".rs-chip")) continue;
        if (CMD_SHAPE.test(cw.textContent || "")) {
          cw.classList.add("rs-tool-hide");
          if (!ref && cw.parentElement) { parent = cw.parentElement; ref = cw; }
        }
      }
      // Check direct children
      for (const kid of [...container.children]) {
        if (kid === chip || (chip && kid.contains(chip))) continue;
        if (kid.matches && kid.matches(".rs-chip")) continue;
        const txt = kid.textContent || "";
        if (CMD_SHAPE.test(txt)) {
          kid.classList.add("rs-tool-hide");
          if (!ref && kid.parentElement) { parent = kid.parentElement; ref = kid; }
        }
      }
      // If container itself holds a command and has no children matching, hide it
      if (!ref && CMD_SHAPE.test(container.textContent || "") && container.children.length === 0) {
        container.classList.add("rs-tool-hide");
        if (container.parentElement) { parent = container.parentElement; ref = container; }
      }
    }
    return ref ? { parent, ref } : null;
  }

  // ── Public interface ──────────────────────────────────────────────────
  return {
    id: "copilot",
    displayName: "Copilot",
    supportsVision: true,
    // Site caps a single user message at 10240 chars - compact SYS + budget
    sysMaxChars: 9000,
    sendCharBudget: 8900,
    timings,
    init({ diag: d } = {}) {
      if (d) diag = d;
      try { document.documentElement.setAttribute("data-rs-copilot-ver", "2026-08-v2"); } catch {}
      const host = location.hostname;
      const path = location.pathname;
      diag("copilot.init", { host, path, hasEditor: !!getEditor(), chatItems: allItems().length });
    },
    // turns
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    // actions
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();





