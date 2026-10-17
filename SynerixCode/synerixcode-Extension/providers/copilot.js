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
      const s = safeStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (s.opacity === "0") return false;
      // If element is in DOM and not display:none, treat as usable.
      // BoundingRect check is unreliable during hydration.
      return true;
    } catch { return !!el; }
  }
  function isVisibleForClick(el) {
    if (!el) return false;
    if (safeRead(() => el.disabled, true) || safeRead(() => el.getAttribute("aria-disabled"), null) === "true") return false;
    try {
      const r = safeRect(el);
      return r.width > 2 && r.height > 2;
    } catch { return safeRead(() => el.offsetParent, null) !== null; }
  }

  // ── Turn classification ───────────────────────────────────────────────
  function isUserItem(item) {
    if (!item) return false;
    const role = safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-message-author-role"), null);
    if (role) return role === "user";
    const dataContent = safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-content"), null);
    if (dataContent === "user-message") return true;
    // Microsoft Copilot: user messages often have different data-content or class
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches('[data-content="user-message"]'), false)) return true;
    // cib custom element: check source attribute
    const src = safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-source"), null);
    if (src === "user") return true;
    // Fallback: class-based
    if (item.classList && (
      safeRead(() => item.classList.contains("user-message"), false) ||
      safeRead(() => item.classList.contains("human-message"), false) ||
      safeRead(() => item.classList.contains("user"), false)
    )) return true;
    // GitHub Copilot / generic: check if contains user-indicating text near top
    return false;
  }

  function isAssistantItem(item) {
    if (!item) return false;
    const role = safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-message-author-role"), null);
    if (role) return role === "assistant" || role === "bot" || role === "ai";
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches('div[data-content="ai-message"], [data-content="response"], [data-message-author="bot"], cib-response-container, [data-testid="answer"], [data-testid="bot-message"]'), false)) return true;
    const src = safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-source"), null);
    if (src === "cib" || src === "ai") return true;
    // If it matched chatItem but is not a user item, treat as assistant
    if (!isUserItem(item)) return true;
    return false;
  }

  function itemText(item) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      // Try markdown containers first
      const mds = safeQueryAll(item, S.markdown);
      if (mds.length) {
        const t = [...mds].map((m) => safeRead(() => m.textContent, "")).join("\n").trim();
        if (t) return t;
      }
      // Fallback: whole item text minus excluded areas
      return (safeRead(() => item.textContent, "") || "").trim();
    }
    return (safeRead(() => item.textContent, "") || "").trim();
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      const mds = [...safeQueryAll(item, S.markdown)];
      if (mds.length) {
        return mds
          .filter((m) => !(excludeSel && safeClosest(m, excludeSel)))
          .map((m) => (safeRead(() => m.textContent, "") || "")).join("\n");
      }
      // Fallback
      if (excludeSel && safeRead(() => item.closest, null) && safeClosest(item, excludeSel)) return "";
      let t = "";
      for (const n of safeRead(() => item.childNodes, [])) {
        if (excludeSel && safeRead(() => n.nodeType, 0) === 1 && safeRead(() => n.matches, null) && safeRead(() => n.matches(excludeSel), false)) continue;
        t += safeRead(() => n.textContent, "") || "";
      }
      return t;
    }
    let t = "";
    for (const n of safeRead(() => item.childNodes, [])) {
      if (excludeSel && safeRead(() => n.nodeType, 0) === 1 && safeRead(() => n.matches, null) && safeRead(() => n.matches(excludeSel), false)) continue;
      t += safeRead(() => n.textContent, "") || "";
    }
    return t;
  }

  // ── DOM primitives ────────────────────────────────────────────────────
  function allItems() {
    // Try primary chatItem selectors
    let items = [...safeQueryAll(document, S.chatItem)];
    // Filter to only those that look like real turns (have text, not empty wrappers)
    // and exclude our own UI
    items = items.filter((el) => !safeClosest(el, "#rs-root") && (safeRead(() => el.textContent, "") || "").trim().length > 0);
    // Deduplicate: nested matches (e.g. div[data-content="ai-message"] and its child
    // .group/ai-message-item) — keep only outermost
    if (items.length > 1) {
      const filtered = [];
      for (const el of items) {
        if (!filtered.some((p) => safeRead(() => p.contains(el), false))) filtered.push(el);
      }
      items = filtered;
    }
    // If still nothing, heuristic fallback: find message-like containers
    // Look for elements that contain markdown-body or are direct children of
    // known chat containers
    if (items.length === 0) {
      const heu = [
        ...safeQueryAll(document, '.markdown-body'),
        ...safeQueryAll(document, '[class*="message-"]'),
        ...safeQueryAll(document, '[class*="response"]'),
        ...safeQueryAll(document, 'cib-message-group'),
      ].map((el) => {
        // For markdown-body, use its message container ancestor
        let p = safeClosest(el, '[data-message-author-role], div[data-content], cib-message-group, [class*="message-"]');
        return p || el;
      }).filter((el) => el && !safeClosest(el, "#rs-root"));
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
    const byId = safeRead(() => document.getElementById("userInput"), null);
    if (byId && (!safeRead(() => byId.closest, null) || !safeClosest(byId, "#rs-root"))) return byId;
    const byTestId = safeQuery(document, '[data-testid="composer-input"]');
    if (byTestId && (!safeRead(() => byTestId.closest, null) || !safeClosest(byTestId, "#rs-root"))) return byTestId;
    const selectors = S.editor.split(", ");
    for (const sel of selectors) {
      try {
        for (const e of safeQueryAll(document, sel)) {
          if (!safeRead(() => e.closest, null) || safeClosest(e, "#rs-root")) continue;
          return e;
        }
      } catch {}
    }
    for (const e of safeQueryAll(document, 'textarea, [contenteditable="true"]')) {
      if (safeRead(() => e.closest, null) && safeClosest(e, "#rs-root")) continue;
      return e;
    }
    return null;
  }

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (safeRead(() => e.value, "") != null) return safeRead(() => e.value, "");
    return safeRead(() => e.textContent, "") || "";
  };

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (on) {
      if (!ed.dataset.rsPlaceholder) ed.dataset.rsPlaceholder = safeRead(() => ed.getAttribute("placeholder"), null) || "";
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
    const did = safeRead(() => item.getAttribute, null) && (safeRead(() => item.getAttribute("data-message-id"), null) || safeRead(() => item.getAttribute("data-id"), null) || safeRead(() => item.getAttribute("id"), null));
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
        const f = safeClosest(ta, sel);
        if (f) return f;
      } catch {}
    }
    // Fallback: walk up and find container that also holds send button or is form-like
    let n = ta;
    for (let i = 0; i < 10 && n && safeRead(() => n.parentElement, null); i++) {
      if (safeRead(() => n.tagName, "") === "FORM" || safeRead(() => n.getAttribute("data-testid"), null) === "composer") return n;
      n = safeRead(() => n.parentElement, null);
    }
    // Prefer a semantic boundary when controls have not mounted yet.
    return safeClosest(ta, 'form, [role="region"], [data-testid="composer"]')
      || safeRead(() => ta.parentElement, null);
  }

  // Anchored mode: React owns this subtree; keep the bar outside it and hug
  // the composer card's top edge instead.
  function barAnchor() {
    const ta = getEditor();
    if (!ta) return null;
    let box = safeClosest(ta, '.w-expanded-composer')
      || safeClosest(ta, '[class*="w-expanded-composer"]')
      || safeClosest(ta, '[data-testid="composer"]')
      || safeClosest(ta, '[data-testid="composer-content"]');
    if (!box) {
      const createBtn = safeRead(() => document.getElementById('composer-create-button'), null);
      if (createBtn) {
        let n = ta;
        for (let i = 0; i < 10 && n; i++) {
          if (safeRead(() => n.contains(createBtn), false)) { box = n; break; }
          n = safeRead(() => n.parentElement, null);
        }
      }
    }
    return box || safeRead(() => ta.parentElement, null);
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
    const mds = safeQueryAll(item, S.markdown);
    if (mds.length) {
      return [...mds].map((m) => {
        // Exclude chip
        let t = "";
        const walk = (n) => {
          if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
          if (safeRead(() => n.nodeType, 0) !== 1) return;
          if (safeRead(() => n.matches, null) && safeRead(() => n.matches(".rs-chip"), false)) return;
          for (const c of safeRead(() => n.childNodes, [])) walk(c);
        };
        walk(m);
        return t;
      }).join("\n");
    }
    return (safeRead(() => item.textContent, "") || "");
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
        const b = safeQuery(document, sel);
        if (b && safeRead(() => b.offsetParent, null) !== null) return true;
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
        const el = safeQuery(document, sel);
        if (el && safeRead(() => el.offsetParent, null) !== null) return true;
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
      const md = [...safeQueryAll(it, S.markdown)];
      return { th: 0, rp: md.reduce((n, m) => n + (safeRead(() => m.textContent, "") || "").length, 0) };
    } catch { return {}; }
  }

  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    // Try markdown containers first
    const mds = safeQueryAll(item, S.markdown);
    let reply = "";
    if (mds.length) {
      reply = [...mds].map((m) => {
        let t = "";
        const walk = (n) => {
          if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
          if (safeRead(() => n.nodeType, 0) !== 1) return;
          if (safeRead(() => n.matches, null) && safeRead(() => n.matches(".rs-chip"), false)) return;
          for (const c of safeRead(() => n.childNodes, [])) walk(c);
        };
        walk(m);
        return t;
      }).join("\n").trim();
    }
    if (!reply) {
      // Fallback: whole item minus chip
      let t = "";
      const walk = (n) => {
        if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
        if (safeRead(() => n.nodeType, 0) !== 1) return;
        if (safeRead(() => n.matches, null) && safeRead(() => n.matches(".rs-chip"), false)) return;
        for (const c of safeRead(() => n.childNodes, [])) walk(c);
      };
      walk(item);
      reply = t.trim();
    }
    return { present: true, reply, thinking: "", item };
  }

  function findContinueBtn() {
    for (const b of safeQueryAll(document, "button")) {
      if (safeRead(() => b.offsetParent, null) === null) continue;
      if (RE.continueBtn.test((safeRead(() => b.innerText, "") || "").trim())) return b;
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
    const budget = waitBudget(timeout, 120), t0 = Date.now();
    for (let poll = 0; poll < budget.polls && Date.now() - t0 < budget.ms; poll++) {
      const result = safePredicate(pred);
      if (result) return true;
      await sleep(120);
    }
    return false;
  }

  // ── Sending ───────────────────────────────────────────────────────────
  function setTextareaValue(el, v) {
    // Handle both textarea and contenteditable
    if (safeRead(() => el.tagName, "") === "TEXTAREA" || safeRead(() => el.tagName, "") === "INPUT") {
      const proto = safeRead(() => el.tagName, "") === "TEXTAREA"
        ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement && window.HTMLInputElement.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable || safeRead(() => el.getAttribute("contenteditable"), null) === "true") {
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
        const btn = safeQuery(document, sel);
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
        for (const b of safeQueryAll(frame, "button")) {
          if (!isVisibleForClick(b)) continue;
          const label = (safeRead(() => b.getAttribute("aria-label"), null) || safeRead(() => b.textContent, "") || "").toLowerCase();
          if (/send|submit|enviar|envoyer/.test(label) || safeRead(() => b.type, "") === "submit") {
            if (/stop|arrêt|detener/.test(label)) continue;
            try { b.click(); return true; } catch {}
          }
        }
        for (const b of safeQueryAll(frame, "button")) {
          if (!isVisibleForClick(b)) continue;
          const label = (safeRead(() => b.getAttribute("aria-label"), null) || "").toLowerCase();
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
    if(typeof window.__rsLimitOutgoing==="function")return window.__rsLimitOutgoing(text);
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
    for (let i = 0; i < 10 && !safeRead(() => editor.isConnected, false); i++) await sleep(100);
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
      if (editor.isContentEditable || safeRead(() => editor.getAttribute("contenteditable"), null) === "true") {
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
    diag("copilot.send", { editorLen: editorText().length, textLen: text.length, hasImages: !!(images && images.length), id: safeRead(() => editor.id, "") || safeRead(() => editor.getAttribute("data-testid"), null) || "?" });
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
          const btn = safeQuery(document, sel);
          if (btn && isVisibleForClick(btn)) return true;
        } catch {}
      }
      const frame = composerFrame();
      if (frame) {
        for (const b of safeQueryAll(frame, "button")) {
          if (isVisibleForClick(b)) {
            const label = (safeRead(() => b.getAttribute("aria-label"), null) || "").toLowerCase();
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
        const b = safeQuery(document, sel);
        if (b && visible(b)) { try { b.click(); } catch {} return; }
      } catch {}
    }
    // Heuristic: any button with stop label in composer
    const frame = composerFrame();
    if (frame) {
      for (const b of safeQueryAll(frame, "button")) {
        if (!visible(b)) continue;
        const label = (safeRead(() => b.getAttribute("aria-label"), null) || safeRead(() => b.textContent, "") || "").toLowerCase();
        if (/stop|arrêt|detener/.test(label)) { try { b.click(); } catch {} return; }
      }
    }
  }

  // ── Error / limit detection ───────────────────────────────────────────
  function scanError() {
    try {
      for (const el of safeQueryAll(document, S.errorSurfaces)) {
        if (safeRead(() => el.offsetParent, null) === null) continue;
        const chatItem = safeClosest(el, S.chatItem.split(",").map((s) => s.trim()).join(", "));
        if (chatItem) continue;
        const t = (safeRead(() => el.innerText, "") || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    // Microsoft Copilot specific: check for sign-in / expired session banners
    try {
      for (const el of safeQueryAll(document, '[class*="error"], [class*="warning"], [role="alert"]')) {
        if (safeRead(() => el.offsetParent, null) === null) continue;
        const t = (safeRead(() => el.innerText, "") || "").trim();
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
      safeQueryAll(frame, '[aria-label*="Remove"], [aria-label*="remove"], [aria-label*="Delete"], [class*="remove"], [class*="delete"]')
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
    const fileInput = safeQuery(document, '[data-testid="composer-file-input"]')
      || safeQuery(document, 'input[type="file"]');
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
        return !!safeQuery(frame, "img, [class*='preview'], [class*='thumbnail'], [class*='attachment']");
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
      return !!safeQuery(frame, "img, [class*='preview'], [class*='thumbnail']");
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
        if (!editor || !safeRead(() => editor.contains(e.target), false)) return;
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
        if (!t || !safeRead(() => t.closest, null)) return;
        // Stop button — allow native stop
        const stopSelectors = S.stopBtn.split(", ");
        for (const sel of stopSelectors) {
          try {
            const stop = safeClosest(t, sel);
            if (stop) { handlers.onNativeStop(); return; }
          } catch {}
        }
        // Also heuristic stop
        const maybeStop = safeClosest(t, "button");
        if (maybeStop) {
          const label = (safeRead(() => maybeStop.getAttribute("aria-label"), null) || "").toLowerCase();
          if (/stop|arrêt/.test(label)) { handlers.onNativeStop(); return; }
        }
        // Continue button
        const cont = safeClosest(t, "button");
        if (cont && RE.continueBtn.test((safeRead(() => cont.innerText, "") || "").trim())) {
          handlers.onNativeContinue();
          return;
        }
        // Send button — detect via selectors or heuristic
        let isSend = false;
        for (const sel of S.sendBtn.split(", ")) {
          try { if (safeClosest(t, sel)) { isSend = true; break; } } catch {}
        }
        if (!isSend && maybeStop) {
          // Heuristic: button inside composer that is not stop
          const frame = composerFrame();
          if (frame && safeRead(() => frame.contains(maybeStop), false)) {
            const label = (safeRead(() => maybeStop.getAttribute("aria-label"), null) || safeRead(() => maybeStop.textContent, "") || "").toLowerCase();
            if (!/stop/.test(label) && visible(maybeStop) && !safeRead(() => maybeStop.disabled, true)) isSend = true;
          }
        }
        if (!isSend) return;
        const btn = maybeStop;
        if (btn && (safeRead(() => btn.getAttribute("aria-disabled"), null) === "true" || safeRead(() => btn.disabled, true))) return;
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
    const containers = safeQueryAll(item, S.markdown);
    const searchRoots = containers.length ? [...containers] : [item];
    for (const container of searchRoots) {
      if (chip && safeRead(() => container.contains(chip), false)) continue;
      // Check code-block wrappers
      for (const cw of safeQueryAll(container, "pre, code, [class*='code']")) {
        if (safeRead(() => cw.closest, null) && safeClosest(cw, ".rs-chip")) continue;
        if (CMD_SHAPE.test(safeRead(() => cw.textContent, "") || "")) {
          cw.classList.add("rs-tool-hide");
          if (!ref && safeRead(() => cw.parentElement, null)) { parent = safeRead(() => cw.parentElement, null); ref = cw; }
        }
      }
      // Check direct children
      for (const kid of [...safeRead(() => container.children, [])]) {
        if (kid === chip || (chip && safeRead(() => kid.contains(chip), false))) continue;
        if (safeRead(() => kid.matches, null) && safeRead(() => kid.matches(".rs-chip"), false)) continue;
        const txt = safeRead(() => kid.textContent, "") || "";
        if (CMD_SHAPE.test(txt)) {
          kid.classList.add("rs-tool-hide");
          if (!ref && safeRead(() => kid.parentElement, null)) { parent = safeRead(() => kid.parentElement, null); ref = kid; }
        }
      }
      // If container itself holds a command and has no children matching, hide it
      if (!ref && CMD_SHAPE.test(safeRead(() => container.textContent, "") || "") && safeRead(() => container.children, []).length === 0) {
        container.classList.add("rs-tool-hide");
        if (safeRead(() => container.parentElement, null)) { parent = safeRead(() => container.parentElement, null); ref = container; }
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





