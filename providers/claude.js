// SPDX-License-Identifier: GPL-3.0-or-later
// providers/claude.js — claude.ai / claude.com
// Same RSProvider interface as chatgpt.js. To disable, remove this file from
// manifest.json, background.js PROVIDER_URLS, popup.js SUPPORTED_HOSTS, main.js AI_SITES.
//
// Works with EVERY Claude model the site offers. The picker is left to the user
// (Haiku / Sonnet / Opus / Fable / Mythos, any generation). synerixcode never clicks it.
// Family is read from the picker label so timings + prompt size can adapt:
//   haiku  — compact system prompt, tighter idle windows
//   sonnet — default
//   opus / fable / mythos — long thinking / adaptive-reasoning windows
//
// Claude DOM (claude.ai / claude.com, 2026 — shared across models):
//  - User turns: [data-testid="user-message"]
//  - Assistant turns: .font-claude-response (markdown in .standard-markdown)
//  - Composer: ProseMirror contenteditable at the bottom (not inside a turn)
//  - Send: button[aria-label="Send message"] / data-testid="send-button"
//  - Stop: aria-label contains "Stop" ("Stop response" / "Stop generating")
//  - Thinking: [data-is-thinking], [class*="thinking"], [class*="extended-thinking"]
//  - Chat URL: /new, /chat/<uuid>, /project/<uuid>
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
  const waitFor = async (fn, ms) => {
    const budget = waitBudget(ms, 80), t0 = Date.now();
    for (let poll = 0; poll < budget.polls && Date.now() - t0 < budget.ms; poll++) {
      const result = safePredicate(fn);
      if (result) return result;
      await sleep(80);
    }
    return safePredicate(fn);
  };

  let diag = () => {};
  const timings = {
    GEN_IDLE_MS: 1600,
    REASON_IDLE_MS: 14000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    STABLE_MS: 8000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  const S = {
    user: '[data-testid="user-message"], [data-testid="user-turn"], [data-role="user"]',
    assistant: '.font-claude-response, [data-testid="assistant-message"], [data-testid="assistant-turn"], [data-testid="claude-response"], [data-role="assistant"]',
    reply: ".standard-markdown, .font-claude-response, [class*='grid-cols-1'], [data-testid='markdown']",
    // Include locked (contenteditable=false) nodes: startSession locks the
    // composer BEFORE ensureComposerReady, so requiring true would miss it and
    // the core would banner "Couldn't switch Claude into the right mode".
    editor: 'div.ProseMirror, [data-rs-locked="1"], [contenteditable][role="textbox"], div[contenteditable="true"]',
    thinking: '[data-is-thinking="true"], [data-testid*="thinking"], [class*="thinking"], [class*="extended-thinking"], [class*="Thoughts"]',
    artifact: '[data-testid="artifact"], [data-testid*="artifact"], [class*="artifact-content"], [class*="Artifact"]',
    codeWrap: "pre, .code-block, .cm-content",
    errorSurfaces: '[role="alert"], [data-testid*="error"], [class*="error-message"]',
    modelBtn: '[data-testid="model-selector"], [data-testid="model-selector-dropdown"], button[aria-haspopup="listbox"], button[aria-label*="model" i], [class*="model-selector"]',
  };

  const SEND_HARD_CAP = 120000;
  const SEND_MAX_CHARS = 100000;
  const SEND_MAX_LINES = 500;
  const INSERT_CHUNK_LINES = 25;
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;

  const RE = {
    contextLimit: /conversation.{0,20}(too long|limit)|too many (tokens|characters)|maximum.{0,16}(length|context)|context window/i,
    tooLong: /message.{0,20}too long|over the (character|token) limit/i,
    busy: /try again later|capacity|overloaded|usage limit|rate limit|something went wrong|usage cap/i,
    continueBtn: /^(continue|continue generating)$/i,
    modelFamily: /\b(mythos|fable|opus|sonnet|haiku)\b/i,
  };

  // Every current + recent Claude family. Unknown labels fall through to sonnet
  // (the site default) rather than fighting the picker.
  const MODEL_CAPS = {
    haiku:   { GEN_IDLE_MS: 1200, REASON_IDLE_MS: 8000,  WARMUP_MS: 30000, REASON_NOREPLY_MS: 45000,  STABLE_MS: 6000,  RESPONSE_TIMEOUT_MS: 180000, sysMaxChars: 12000, resendEvery: 8 },
    sonnet:  { GEN_IDLE_MS: 1600, REASON_IDLE_MS: 14000, WARMUP_MS: 45000, REASON_NOREPLY_MS: 90000,  STABLE_MS: 8000,  RESPONSE_TIMEOUT_MS: 300000, sysMaxChars: 0,     resendEvery: 0 },
    sonnet5: { GEN_IDLE_MS: 2800, REASON_IDLE_MS: 28000, WARMUP_MS: 90000, REASON_NOREPLY_MS: 240000, STABLE_MS: 14000, RESPONSE_TIMEOUT_MS: 720000, sysMaxChars: 0,     resendEvery: 0 },
    opus:    { GEN_IDLE_MS: 2000, REASON_IDLE_MS: 22000, WARMUP_MS: 60000, REASON_NOREPLY_MS: 180000, STABLE_MS: 10000, RESPONSE_TIMEOUT_MS: 600000, sysMaxChars: 0,     resendEvery: 0 },
    fable:  { GEN_IDLE_MS: 2200, REASON_IDLE_MS: 24000, WARMUP_MS: 70000, REASON_NOREPLY_MS: 210000, STABLE_MS: 12000, RESPONSE_TIMEOUT_MS: 720000, sysMaxChars: 0,     resendEvery: 0 },
    mythos: { GEN_IDLE_MS: 2200, REASON_IDLE_MS: 24000, WARMUP_MS: 70000, REASON_NOREPLY_MS: 210000, STABLE_MS: 12000, RESPONSE_TIMEOUT_MS: 720000, sysMaxChars: 0,     resendEvery: 0 },
  };

  let _family = "sonnet";
  let _modelLabel = "";
  let _sysMaxChars = 0;
  let _resendEvery = 0;

  function currentModelLabel() {
    const tryText = (el) => (el && (safeRead(() => el.getAttribute("aria-label"), null) || safeRead(() => el.getAttribute("title"), null) || safeRead(() => el.textContent, "")) || "").replace(/\s+/g, " ").trim();
    for (const el of safeQueryAll(document, S.modelBtn)) {
      const t = tryText(el);
      if (t && RE.modelFamily.test(t) && t.length < 80) return t;
    }
    // Fallback: any visible control whose label names a Claude family.
    for (const b of safeQueryAll(document, "button, [role='button']")) {
      if (safeClosest(b, "#rs-root")) continue;
      const t = tryText(b);
      if (t && RE.modelFamily.test(t) && t.length < 64) {
        const r = safeRect(b);
        if (r.width > 8 && r.height > 8) return t;
      }
    }
    return _modelLabel;
  }
  function familyFromLabel(label) {
    const s = String(label || "");
    if (/\bmythos\b/i.test(s)) return "mythos";
    if (/\bfable\b/i.test(s)) return "fable";
    if (/\bopus\b/i.test(s)) return "opus";
    if (/\bhaiku\b/i.test(s)) return "haiku";
    if (/\bsonnet\b/i.test(s) && /\b(4(?:\.\d+)?|[5-9](?:\.\d+)?)\b/.test(s)) return "sonnet5";
    if (/\bsonnet\b/i.test(s)) return "sonnet";
    const m = RE.modelFamily.exec(s);
    return m ? m[1].toLowerCase() : "sonnet";
  }
  function applyModelCaps(reason) {
    const label = currentModelLabel();
    const fam = familyFromLabel(label);
    const caps = MODEL_CAPS[fam] || MODEL_CAPS.sonnet;
    const changed = fam !== _family || label !== _modelLabel;
    _family = fam;
    if (label) _modelLabel = label;
    _sysMaxChars = caps.sysMaxChars;
    _resendEvery = caps.resendEvery;
    timings.GEN_IDLE_MS = caps.GEN_IDLE_MS;
    timings.REASON_IDLE_MS = caps.REASON_IDLE_MS;
    timings.WARMUP_MS = caps.WARMUP_MS;
    timings.REASON_NOREPLY_MS = caps.REASON_NOREPLY_MS;
    timings.STABLE_MS = caps.STABLE_MS;
    timings.RESPONSE_TIMEOUT_MS = caps.RESPONSE_TIMEOUT_MS;
    if (changed && label) diag("claude.model", { family: fam, label, reason: reason || "sweep" });
  }

  function truncateForSend(text) {
    if(typeof window.__rsLimitOutgoing==="function")return window.__rsLimitOutgoing(text);
    if (!text) return text;
    let s = String(text);
    const cap = _family === "haiku" ? Math.min(SEND_MAX_CHARS, 60000) : SEND_MAX_CHARS;
    if (s.length > cap) s = s.slice(0, cap) + "\n…[truncated]";
    const lines = s.split("\n");
    if (lines.length > SEND_MAX_LINES) s = lines.slice(0, SEND_MAX_LINES).join("\n") + "\n…[truncated]";
    return s;
  }

  function textWithout(root, excludeSel) {
    if (!root) return "";
    let t = "";
    const walk = (n) => {
      if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
      if (safeRead(() => n.nodeType, 0) !== 1) return;
      if (excludeSel && safeRead(() => n.matches, null) && safeRead(() => n.matches(excludeSel), false)) return;
      if (n.classList && safeRead(() => n.classList.contains("rs-chip"), false)) return;
      if (safeRead(() => n.tagName, "") === "BR") { t += "\n"; return; }
      if (n.classList && safeRead(() => n.classList.contains("cm-line"), false)) {
        for (const c of safeRead(() => n.childNodes, [])) walk(c);
        t += "\n";
        return;
      }
      const block = /^(P|DIV|LI|PRE|H1|H2|H3|H4|TR|ARTICLE|SECTION)$/.test(safeRead(() => n.tagName, ""));
      if (block && t && !t.endsWith("\n")) t += "\n";
      for (const c of safeRead(() => n.childNodes, [])) walk(c);
      if (block && t && !t.endsWith("\n")) t += "\n";
    };
    walk(root);
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  // Only message bubbles — not [data-role=assistant] on a page-wide wrapper,
  // which would hide the live composer from getEditor().
  const inTurn = (el) => !!(el && safeClosest(el, '[data-testid="user-message"], [data-testid="user-turn"], [data-testid="assistant-message"], [data-testid="assistant-turn"], [data-testid="claude-response"], .font-claude-response'));

  function visibleComposer(n) {
    if (!n || safeClosest(n, "#rs-root")) return false;
    if (inTurn(n)) return false;
    if (safeClosest(n, "pre, .cm-editor, [data-testid='artifact']")) return false;
    return true;
  }
  function getEditor() {
    const all = [...safeQueryAll(document, S.editor)].filter((n) => n && !safeClosest(n, "#rs-root"));
    let nodes = all.filter(visibleComposer);
    if (!nodes.length) nodes = all.filter((n) => !inTurn(n));
    if (!nodes.length) nodes = all;
    if (!nodes.length) return null;
    const pm = nodes.filter((n) => (n.classList && safeRead(() => n.classList.contains("ProseMirror"), false)) || safeRead(() => n.getAttribute("data-rs-locked"), null) === "1");
    const pool = pm.length ? pm : nodes;
    try { pool.sort((a, b) => safeRect(a).top - safeRect(b).top); } catch {}
    return pool[pool.length - 1] || pool[0] || null;
  }
  const editorText = () => {
    const e = getEditor();
    return e ? (safeRead(() => e.textContent, "") || "") : "";
  };

  function docPos(a, b) {
    const r = safeRead(() => a.compareDocumentPosition(b), 0);
    if (r & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (r & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  const allItems = () => {
    const users = [...safeQueryAll(document, S.user)];
    // Claude nests response/markdown nodes inside the owning assistant turn.
    // Counting each match as a separate turn can select an empty trailing child
    // after the real reply has finished, falsely reporting "sent nothing".
    const candidates = safeQueryAll(document, S.assistant).filter(el => !safeQuery(el, S.user));
    const roots = new Set(candidates);
    const asst = candidates.filter(el => {
      let parent = safeClosest(el.parentElement, S.assistant);
      while (parent) {
        if (roots.has(parent)) return false;
        parent = safeClosest(parent.parentElement, S.assistant);
      }
      return true;
    });
    const mixed = [...users, ...asst].filter((el, i, arr) => arr.indexOf(el) === i);
    mixed.sort(docPos);
    return mixed;
  };
  const isUserItem = (item) => !!(item && safeRead(() => item.matches, null) && safeRead(() => item.matches(S.user), false));
  const isAssistantItem = (item) => !!(item && safeRead(() => item.matches, null) && safeRead(() => item.matches(S.assistant), false));
  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => {
    const it = assistantItems();
    return it.length ? it[it.length - 1] : null;
  };
  const itemKey = (item) => {
    if (!item || !safeRead(() => item.getAttribute, null)) return null;
    return safeRead(() => item.getAttribute("data-message-id"), null)
      || safeRead(() => item.getAttribute("data-testid"), null) + ":" + (safeRead(() => item.textContent, "") || "").slice(0, 24)
      || null;
  };
  const lastAssistantId = () => itemKey(lastAssistant());

  function replyRoots(item) {
    if (!item) return [];
    // Thinking can contain the first markdown block. Read all non-thinking
    // answer blocks, without double-reading nested markdown wrappers.
    const answerOnly = nodes => nodes.filter(node => !safeClosest(node, S.thinking));
    let nodes = answerOnly(safeQueryAll(item, ".standard-markdown, [data-testid='markdown']"));
    if (!nodes.length) nodes = answerOnly(safeQueryAll(item, ".font-claude-response"));
    if (!nodes.length) return safeClosest(item, S.thinking) ? [] : [item];
    const selected = new Set(nodes);
    return nodes.filter(node => {
      for (let parent = node.parentElement; parent && parent !== item; parent = parent.parentElement) {
        if (selected.has(parent)) return false;
      }
      return true;
    });
  }
  function artifactText(item) {
    if (!item) return "";
    let t = "";
    safeQueryAll(item, S.artifact).forEach((el) => {
      if (safeClosest(el, S.thinking)) return;
      t += "\n" + textWithout(el, S.thinking);
    });
    return t.trim();
  }
  function thinkingText(item) {
    if (!item) return "";
    const nodes = [...safeQueryAll(item, S.thinking)];
    return nodes.map((n) => textWithout(n)).join("\n").trim();
  }
  function itemText(item) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      const body = replyRoots(item).map(node => textWithout(node, S.thinking)).filter(Boolean).join("\n");
      const art = artifactText(item);
      return art && !body.includes(art.slice(0, 80)) ? (body + "\n" + art).trim() : body;
    }
    return textWithout(item);
  }
  function classifyText(item, excludeSel) {
    if (!item) return "";
    const skip = [S.thinking, excludeSel].filter(Boolean).join(",");
    if (isAssistantItem(item)) {
      const body = replyRoots(item).map(node => textWithout(node, skip)).filter(Boolean).join("\n");
      const art = artifactText(item);
      return art && !body.includes(art.slice(0, 80)) ? (body + "\n" + art).trim() : body;
    }
    return textWithout(item, skip);
  }

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => {
    const path = (location.pathname.replace(/\/+$/, "") || "/");
    return chatIsEmpty() && /(\/(new|chat|project))?$/.test(path) && !!getEditor();
  };
  const conversationKey = () =>
    (/\/(chat|project)\//.test(location.pathname) ? location.pathname : "");

  const composerFrame = () => {
    const ed = getEditor();
    if (!ed) return null;
    return safeClosest(ed, "fieldset") || safeClosest(ed, "form") || safeClosest(ed, "[class*='composer']") || safeRead(() => ed.parentElement, null);
  };
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    return safeClosest(ed, "fieldset") || safeClosest(ed, "[class*='composer']") || safeClosest(ed, "form") || safeRead(() => ed.parentElement, null);
  }

  let _locked = false;
  function setInputLock(on) {
    _locked = on;
    const ed = getEditor();
    if (!ed) return;
    ed.setAttribute("contenteditable", on ? "false" : "true");
    if (on) ed.setAttribute("data-rs-locked", "1");
    else ed.removeAttribute("data-rs-locked");
  }

  function visibleBtn(b) {
    if (!b || safeRead(() => b.disabled, true)) return false;
    if (safeRead(() => b.getAttribute("aria-disabled"), null) === "true") return false;
    const r = safeRect(b);
    return r.width > 8 && r.height > 8;
  }
  function labelOf(b) {
    return ((b && (safeRead(() => b.getAttribute("aria-label"), null) || safeRead(() => b.getAttribute("title"), null) || safeRead(() => b.textContent, ""))) || "").toLowerCase();
  }
  function stopButton() {
    for (const s of [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop response" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop" i]',
    ]) {
      for (const b of safeQueryAll(document, s)) {
        if (visibleBtn(b) && !inTurn(b)) return b;
      }
    }
    for (const b of safeQueryAll(document, "button")) {
      if (!visibleBtn(b) || inTurn(b)) continue;
      const l = labelOf(b);
      if (l.includes("stop") && (l.includes("response") || l.includes("generat") || l === "stop")) return b;
    }
    return null;
  }
  // 1.24.13: Claude labels its send control in the UI language ("Send message",
  // "Nachricht senden", "Envoyer le message", ...). The old fallback returned the
  // LAST visible composer button whenever no English label matched, and also while
  // the real send button was still disabled right after a long draft was typed.
  // That button is the voice-mode / model control, so the click sent nothing and
  // startup ended with "Claude wouldn't take the message after 2 tries".
  const SEND_LABEL_RE = /\bsend\b|senden|envoyer|enviar|invia|verstuur|verzend|wy[sś]lij|odeslat|g[öo]nder|отправ|надісл|送信|发送|發送|보내기|kirim|gửi|ส่ง|إرسال|שלח/i;
  const NOT_SEND_RE = /stop|voice|dictat|micro|mikro|sprach/i;
  function sendCandidates() {
    const out = [];
    for (const s of [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[aria-label*="Send message" i]',
      'button[data-testid="send-button"]',
    ]) for (const b of safeQueryAll(document, s)) if (!inTurn(b) && !out.includes(b)) out.push(b);
    const ed = getEditor();
    const root = (ed && (safeClosest(ed, "fieldset") || safeClosest(ed, "form") || safeRead(() => ed.parentElement && ed.parentElement.parentElement, null))) || null;
    if (root) {
      for (const b of safeQueryAll(root, "button")) {
        if (inTurn(b) || out.includes(b)) continue;
        const l = labelOf(b);
        if ((SEND_LABEL_RE.test(l) || safeRead(() => b.getAttribute("type"), "") === "submit") && !NOT_SEND_RE.test(l)) out.push(b);
      }
    }
    return out;
  }
  // An ENABLED, visible send control, or null. Never a guessed neighbour button.
  function sendButton() {
    if (stopButton()) return null;
    for (const b of sendCandidates()) if (visibleBtn(b)) return b;
    return null;
  }
  function pressEnter(ed) {
    if (!ed) return;
    try { ed.focus(); } catch {}
    const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    ed.dispatchEvent(new KeyboardEvent("keydown", o));
    ed.dispatchEvent(new KeyboardEvent("keypress", o));
    ed.dispatchEvent(new KeyboardEvent("keyup", o));
  }

  function streamText(item) {
    if (!item) return "";
    const reply = itemText(item);
    const think = thinkingText(item);
    return think ? (think + "\n" + reply) : reply;
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
  function isGenerating() {
    sampleStream();
    if (stopButton()) return true;
    const last = lastAssistant();
    if (last && safeQuery(last, '[data-is-thinking="true"], [data-thinking="true"], [data-is-streaming="true"]')) return true;
    return _streamMax > 1 && Date.now() - _streamAt < timings.GEN_IDLE_MS;
  }
  const isBusyNow = () => isGenerating();
  const isHardGenerating = () => !!stopButton();

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { th: 0, rp: 0 };
      return { th: thinkingText(it).length, rp: itemText(it).length };
    } catch { return {}; }
  }
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: itemText(item), thinking: thinkingText(item), item };
  }

  function selectAll(ed) {
    const range = document.createRange();
    range.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  async function typeEditorText(ed, text) {
    selectAll(ed);
    document.execCommand("insertText", false, "");
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
      if (i < lines.length - 1) document.execCommand("insertLineBreak");
      if (i && i % INSERT_CHUNK_LINES === 0) await sleep(0);
    }
  }

  function fileFromImage(img, i) {
    if (typeof synerixcodeMedia !== "undefined") return synerixcodeMedia.fileFrom(img, i);
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : "jpg";
    return new File([arr], `orscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }
  async function attachImages(images) {
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    const fileInput = safeQuery(document, 'input[type="file"][accept*="image"]') ||
      safeQuery(document, 'input[type="file"]');
    if (fileInput) {
      try { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    return await waitFor(() => {
      const box = composerFrame();
      return !!(box && safeQuery(box, "img, [class*='preview'], [class*='thumbnail'], [class*='attachment']"));
    }, 15000);
  }
  function clearAttachments() {
    try {
      const box = composerFrame();
      if (!box) return;
      safeQueryAll(box, "[aria-label*='emove' i], [aria-label*='elete' i], [aria-label*='Remove'], [class*='delete'], [class*='remove']")
        .forEach((d) => { try { d.click(); } catch {} });
    } catch {}
  }

  async function typeAndSend(text, images) {
    const ed = getEditor();
    if (!ed) throw new Error("Claude input box not found");
    text = truncateForSend(text);
    const relock = _locked;
    try {
      if (relock) ed.setAttribute("contenteditable", "true");
      await typeEditorText(ed, text);
      if (images && images.length) {
        if (!await attachImages(images)) throw new Error("Claude did not confirm the screenshot upload. The message was not submitted.");
        const ready = await waitFor(() => { const b = sendButton(); return b && !safeRead(() => b.disabled, true); }, 25000);
        const b = ready && sendButton();
        if (!b || safeRead(() => b.disabled, true)) throw new Error("Claude is not ready to send the screenshot. The message was not submitted.");
        // A late receipt cannot authorize another submission of the same command.
        b.click();
        await waitFor(() => editorText().trim() === "" || !!stopButton(), 15000);
        return;
      }
      // A long startup draft can take seconds before Claude enables Send. Wait
      // for the real (enabled) control instead of clicking whatever is there.
      const before = userCount();
      const tail = String(text).replace(/\s+/g, "").slice(-24);
      const stillDraft = () => tail.length > 0 && String(editorText()).replace(/\s+/g, "").includes(tail);
      const sent = () => !!stopButton() || userCount() > before || !stillDraft();
      await waitFor(() => !!sendButton(), Math.min(15000, 2500 + Math.ceil(String(text).length / 25)));
      const btn = sendButton();
      if (btn) { diag("claude.send.click", {}); btn.click(); }
      else { diag("claude.send.enter", { candidates: sendCandidates().length }); pressEnter(getEditor() || ed); }
      // The draft is still there untouched and nothing started: the first attempt
      // provably did not submit, so one Enter cannot duplicate the message.
      if (!await waitFor(sent, 2500) && stillDraft() && !stopButton() && userCount() === before) {
        diag("claude.send.enterFallback", { clicked: !!btn });
        pressEnter(getEditor() || ed);
        await waitFor(sent, 2500);
      }
    } finally {
      if (relock) { const e2 = getEditor(); safeRead(() => { if (e2) e2.setAttribute("contenteditable", "false"); }, null); }
    }
  }
  function stopGeneration() {
    const b = stopButton();
    if (b) try { b.click(); } catch {}
  }
  function enforceComposer() {
    applyModelCaps("sweep");
    // Never refuse a sweep because the picker label is unknown — the user owns the model.
    return { ready: !!getEditor() };
  }
  async function ensureComposerReady(reason) {
    applyModelCaps(reason || "ready");
    // startSession locks the box first. Wait for the (possibly locked) composer;
    // do not gate Start on Haiku/Sonnet/Opus/Fable/Mythos — any of them is fine.
    let ed = getEditor();
    if (!ed) {
      await waitFor(() => getEditor(), 5000);
      ed = getEditor();
    }
    const ready = !!ed;
    diag("mode_ready", { reason, provider: "claude", family: _family, model: _modelLabel, ready });
    return { ready };
  }

  function scanError() {
    try {
      for (const el of safeQueryAll(document, S.errorSurfaces)) {
        if (safeRead(() => el.offsetParent, null) === null) continue;
        const t = (safeRead(() => el.innerText, "") || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    return "";
  }
  const isTooLongMsg = (t) => RE.tooLong.test(t || "");
  const isBusyMsg = (t) => RE.busy.test(t || "");
  const turnHalted = () => false;
  const findContinueBtn = () => {
    for (const b of safeQueryAll(document, "button")) {
      if (visibleBtn(b) && RE.continueBtn.test((safeRead(() => b.textContent, "") || "").trim())) return b;
    }
    return null;
  };
  const clickContinueBtn = () => { const b = findContinueBtn(); if (b) b.click(); };

  async function writeDraft(value, expectedCurrent) {
    const ed = getEditor();
    if (!ed || editorText() !== String(expectedCurrent)) return {ok:false,reason:'draft-changed'};
    const relock = _locked;
    try { setInputLock(false); await typeEditorText(ed, String(value)); return {ok:editorText() === String(value)}; }
    finally { if(relock)setInputLock(true); }
  }
  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const ed = getEditor();
      if (!ed || !safeRead(() => ed.contains(e.target), false)) return;
      if (editorText().trim() === "") return;
      if (handlers.onCoworkSend && handlers.onCoworkSend(e)) return;
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
      const cont = t && safeRead(() => t.closest, null) && safeClosest(t, "button");
      if (cont && RE.continueBtn.test((safeRead(() => cont.innerText, "") || "").trim())) {
        if (handlers.onNativeContinue) handlers.onNativeContinue();
        return;
      }
      const stop = stopButton();
      if (stop && t && safeRead(() => t.closest, null) && safeClosest(t, "button") === stop) {
        if (handlers.onNativeStop) handlers.onNativeStop();
        return;
      }
      const btn = t && safeRead(() => t.closest, null) && safeClosest(t, "button");
      if (!btn || btn !== sendButton()) return;
      if (handlers.onCoworkSend && handlers.onCoworkSend(e)) return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  function findToolBlockSpot(item) {
    if (!item) return null;
    let hidAny = null;
    const hide = (el) => {
      el.classList.add("rs-tool-hide");
      hidAny = hidAny || { parent: safeRead(() => el.parentElement, null), ref: el };
    };
    safeQueryAll(item, S.codeWrap).forEach((pre) => {
      if (safeClosest(pre, ".rs-chip") || safeClosest(pre, S.thinking)) return;
      if (CMD_SHAPE.test(safeRead(() => pre.textContent, "") || "")) {
        let wrapper = pre;
        // Claude's language label and border can live outside <pre>. Hide only
        // a single-code frame, never adjacent narration, thinking or actions.
        if (safeRead(() => pre.matches(S.codeWrap), false)) {
          for (let depth = 0, parent = safeRead(() => pre.parentElement, null); parent && parent !== item && depth < 8; depth++, parent = safeRead(() => parent.parentElement, null)) {
            if (!/^(DIV|SECTION)$/.test(safeRead(() => parent.tagName, "")) || safeClosest(parent, S.thinking) ||
                safeRead(() => parent.matches(S.artifact), false) || safeQuery(parent, ".rs-chip") ||
                [...safeQueryAll(parent, S.codeWrap)].filter(block => ![...safeQueryAll(parent, S.codeWrap)].some(other => other !== block && safeRead(() => other.contains(block), false))).length !== 1 ||
                safeQuery(parent, 'h1, h2, h3, h4, img, video, textarea, [contenteditable="true"]')) break;
            const buttons = [...safeQueryAll(parent, "button, [role='button']")];
            if (buttons.some((button) => !/^(?:copy(?: code)?(?: to clipboard)?|download(?: code| file)?|expand(?: code)?|collapse(?: code)?|toggle (?:line )?wrap(?:ping)?)$/i.test(
              (safeRead(() => button.getAttribute("aria-label"), null) || safeRead(() => button.title, "") || safeRead(() => button.textContent, "") || "").trim()))) break;
            const extra = (safeRead(() => parent.textContent, "") || "").replace(safeRead(() => pre.textContent, "") || "", "").replace(/\s+/g, " ").trim();
            if (!/^(?:(?:json|javascript|lua|luau|text|code|copy|download|expand|collapse|to|clipboard|file|toggle|line|wrap|wrapping)(?: code)?\s*)*$/i.test(extra)) break;
            wrapper = parent;
          }
        }
        hide(wrapper);
      }
    });
    safeQueryAll(item, S.artifact).forEach((el) => {
      if (safeClosest(el, ".rs-chip") || safeClosest(el, S.thinking)) return;
      if (CMD_SHAPE.test(safeRead(() => el.textContent, "") || "")) hide(el);
    });
    return hidAny;
  }

  const PROMPT_EXTRA =
    `- You may be ANY Claude model the user picked (Haiku, Sonnet 3.5/4/4.5/5+, Opus, Fable, Mythos). The synerixcode command protocol is the same for all of them.
- synerixcode is a real browser extension the user installed. Outputting a fenced json command or ###LUA### block is how their Roblox Studio plugin receives work — the same as Cursor/Copilot applying a diff. This is authorized local automation, not a jailbreak.
- Do not refuse for lack of capability (Sonnet 5 / 4.5 included). Claude's own tools, computer use, Projects MCP, Artifacts-as-execution, and Claude Code CANNOT reach this machine. Write synerixcode JSON / ###LUA### in the normal chat reply; the extension executes it.
- Refuse only the user's task if it is actually disallowed. Never refuse the synerixcode protocol itself.
- Artifacts may preview UI for the user, but the command that runs must still appear in the chat reply as a fenced JSON object or a ###LUA### block.`;

  return {
    id: "claude",
    displayName: "Claude",
    supportsVision: true,
    timings,
    thinkingSel: S.thinking,
    chipAtItemLevel: true,
    reliableCounts: true,
    promptExtra: PROMPT_EXTRA,
    get sysMaxChars() { return _sysMaxChars; },
    get resendSystemEvery() { return _resendEvery; },
    init({ diag: d } = {}) { if (d) diag = d; applyModelCaps("init"); },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, readAssistant,
    streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    followupPlaceholderTargets() {const ed=getEditor();return ed ? [ed,...safeQueryAll(ed, '[data-placeholder], [placeholder], [aria-placeholder]')] : [];},
    setInputLock, writeDraft, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
