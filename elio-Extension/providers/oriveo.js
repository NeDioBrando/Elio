// SPDX-License-Identifier: GPL-3.0-or-later
// Oriveo browser chat adapter. Selectors verified against the live web UI.
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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let diag = () => {};
  const S = {
    editor: '[class*="InputComposer_wrap"] textarea[class*="InputComposer_textarea"]',
    body: '[class*="MessageBubble_bubble"]',
    thinking: '[class*="ReasoningBlock"], [class*="ThinkingBlock"], [data-quote-block="thinking"]',
    errors: '[role="alert"], [class*="ErrorBanner"], [class*="errorMessage"], [data-sonner-toast]',
  };
  const timings = {GEN_IDLE_MS: 2000, REASON_IDLE_MS: 30000, WARMUP_MS: 90000,
    REASON_NOREPLY_MS: 180000, STABLE_MS: 12000, RESPONSE_TIMEOUT_MS: 720000};
  function visible(el) {
    if (!el || safeClosest(el, '#rs-root')) return false;
    const r = safeRect(el);
    if (r.width < 1 || r.height < 1) return false;
    return !hidden(el);
  }
  // CSS-hidden duplicate mobile/desktop trees are excluded; scrolled-off turns are not.
  function hidden(el) {
    for (let n = el; n && safeRead(() => n.nodeType, 0) === 1; n = safeRead(() => n.parentElement, null)) {
      if (safeRead(() => n.hasAttribute('hidden'), true) || safeRead(() => n.getAttribute('aria-hidden'), 'true') === 'true') return true;
      const style = safeStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    return false;
  }
  function getEditor() { return safeQueryAll(document, S.editor).find(visible) || null; }
  function editorText() { return safeRead(() => getEditor().value, '') || ''; }
  function composerFrame() { return safeClosest(getEditor(), '[class*="InputComposer_wrap"]'); }
  const barAnchor = composerFrame;
  function control(label) {
    return safeQueryAll(composerFrame(), 'button[aria-label]').find(b =>
      safeRead(() => b.getAttribute('aria-label'), '') === label && visible(b)) || null;
  }
  const sendButton = () => control('Send');
  const stopButton = () => control('Stop generating');
  function roleOf(item) { return safeRead(() => item.getAttribute('data-message-role'), '') || safeRead(() => item.getAttribute('data-role'), ''); }
  const isUserItem = item => roleOf(item) === 'user';
  const isAssistantItem = item => roleOf(item) === 'assistant';
  function allItems() {
    let roots = safeQueryAll(document, '[data-message-id][data-message-role="user"], [data-message-id][data-message-role="assistant"]');
    if (!roots.length) roots = safeQueryAll(document, '[role="article"][data-role="user"], [role="article"][data-role="assistant"]');
    const seen = new Set();
    return roots.filter(el => {
      if (hidden(el) || safeClosest(el, '#rs-root')) return false;
      const key = safeRead(() => el.getAttribute('data-message-id'), '') || el;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function textWithout(root, excludeSel) {
    if (!root) return '';
    const skip = '.rs-chip, #rs-root, button, svg, [class*="CodeBlock_header"], [class*="MessageActions"], [class*="TypingIndicator"], ' + S.thinking + (excludeSel ? ', ' + excludeSel : '');
    function walk(n) {
      if (safeRead(() => n.nodeType, 0) === 3) return safeRead(() => n.nodeValue, '') || '';
      if (safeRead(() => n.nodeType, 0) !== 1 || safeRead(() => n.matches(skip), true)) return '';
      const tag = safeRead(() => n.tagName, '');
      if (tag === 'BR') return '\n';
      if (tag === 'PRE') {
        const code = safeQuery(n, 'code') || n;
        const language = (safeRead(() => code.className, '').match(/\blanguage-([\w+-]+)/) || [,''])[1];
        const text = safeRead(() => code.textContent, '') || '';
        const fence = '`'.repeat(Math.max(3, ...((text.match(/`+/g) || []).map(s => s.length + 1))));
        return '\n\n' + fence + language + '\n' + text.replace(/\n$/, '') + '\n' + fence + '\n\n';
      }
      const content = Array.from(safeRead(() => n.childNodes, [])).map(walk).join('');
      if (tag === 'LI') return '\n- ' + content.trim() + '\n';
      if (/^(P|H[1-6]|BLOCKQUOTE)$/.test(tag)) return '\n\n' + content.trim() + '\n\n';
      if (/^(DIV|UL|OL|SECTION|ARTICLE|TR)$/.test(tag)) return '\n' + content + '\n';
      if (/^(TD|TH)$/.test(tag)) return content + '\t';
      return content;
    }
    // Collapse layout whitespace outside fences only. Code contents remain byte-for-byte.
    let fence = '', blanks = 0;
    return walk(root).split('\n').filter(line => {
      const marker = line.match(/^(`{3,})([^`]*)$/);
      if (marker && (!fence || (marker[1] === fence && !marker[2].trim()))) {
        fence = fence ? '' : marker[1]; blanks = 0; return true;
      }
      if (fence) return true;
      if (!line.trim()) return ++blanks <= 1;
      blanks = 0; return true;
    }).join('\n').trim();
  }
  function classifyText(item, excludeSel) {
    const body = safeQuery(item, S.body);
    if (!body || (excludeSel && safeClosest(body, excludeSel))) return '';
    return textWithout(body, excludeSel);
  }
  const itemText = item => classifyText(item);
  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => assistantItems().slice(-1)[0] || null;
  const ids = new WeakMap(); let nextId = 0;
  function itemKey(item) {
    if (!item) return null;
    const id = safeRead(() => item.getAttribute('data-message-id'), '');
    if (id) return 'oriveo:' + id;
    if (!ids.has(item)) ids.set(item, 'oriveo:local:' + ++nextId);
    return ids.get(item);
  }
  const lastAssistantId = () => itemKey(lastAssistant());
  const streamLen = item => itemText(item === undefined ? lastAssistant() : item).length;
  function readAssistant() {
    const item = lastAssistant();
    return {present: !!item, reply: itemText(item), thinking: '', item};
  }
  const snapshot = () => ({th: 0, rp: streamLen()});
  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  function conversationKey() {
    const match = safeRead(() => location.pathname, '').match(/^\/chat\/([A-Za-z0-9_-]+)\/?$/);
    return match ? match[1] : '';
  }
  // The site's Stop button is authoritative even during long, quiet reasoning.
  function isHardGenerating() {
    if (stopButton()) return true;
    const item = lastAssistant();
    return !!safeQueryAll(item, '[aria-label="Generating"][class*="TypingIndicator"]').find(el => !hidden(el));
  }
  const isGenerating = isHardGenerating, isBusyNow = isHardGenerating;
  function stopGeneration() { const b = stopButton(); if (b) b.click(); }
  const locks = new WeakMap();
  function setInputLock(on) {
    const ed = getEditor(); if (!ed) return;
    if (on && !locks.has(ed)) {
      locks.set(ed, {readOnly: ed.readOnly, placeholder: safeRead(() => ed.getAttribute('placeholder'), null)});
      ed.readOnly = true;
      ed.setAttribute('placeholder', '⏳ Agent working… please wait');
    } else if (!on && locks.has(ed)) {
      const before = locks.get(ed); ed.readOnly = before.readOnly;
      if (before.placeholder === null) ed.removeAttribute('placeholder');
      else ed.setAttribute('placeholder', before.placeholder);
      locks.delete(ed);
    }
  }
  async function waitFor(pred, timeout) {
    const budget = waitBudget(timeout, 120), t0 = Date.now();
    for (let poll = 0; poll < budget.polls && Date.now() - t0 < budget.ms; poll++) {
      if (safePredicate(pred)) return true;
      await sleep(120);
    }
    return false;
  }
  // Text chat is verified. Do not claim image upload from a hidden document input.
  async function attachImages(images) {
    if (!images || !images.length) return false;
    throw new Error('Oriveo image upload is not supported by this Elio adapter. The selected model may be text-only; no message was sent.');
  }
  function clearAttachments() {}
  let sending = false;
  async function typeAndSend(text, images) {
    if (sending || isHardGenerating()) throw new Error('Oriveo is already sending or generating. Wait for completion.');
    if (images && images.length) await attachImages(images);
    const editor = getEditor();
    if (!editor || editor.disabled) throw new Error('Oriveo chat box is unavailable. Open app.oriveoai.com/chat.');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Oriveo message is empty.');
    if (editorText().trim()) throw new Error('Oriveo has an unsent draft. It was preserved; clear or send it first.');
    const payload = typeof window.__rsLimitOutgoing === 'function' ? window.__rsLimitOutgoing(text) : text;
    if (payload.length > 120000) throw new Error('Oriveo message exceeds Elio’s 120000-character safety limit. Split the result.');
    sending = true;
    try {
      const before = new Set(allItems().filter(isUserItem).map(itemKey));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, payload);
      editor.dispatchEvent(new Event('input', {bubbles: true}));
      const ready = await waitFor(() => { const b = sendButton(); return b && !b.disabled && safeRead(() => b.getAttribute('aria-disabled'), 'true') !== 'true'; }, 3000);
      if (!ready || editorText() !== payload) throw new Error('Oriveo Send is not ready. The draft was left in place; nothing was clicked.');
      const b = sendButton();
      if (!b || b.disabled || isHardGenerating()) throw new Error('Oriveo composer changed before sending. No retry was attempted.');
      diag('oriveo.send', {characters: payload.length});
      b.click();
      const sent = await waitFor(() => isHardGenerating() || allItems().some(item => isUserItem(item) && !before.has(itemKey(item)) && itemText(item).trim() === payload.trim()), 10000);
      if (!sent) throw new Error('Oriveo did not confirm receipt. Completion is uncertain; inspect the chat before retrying. The message was not sent again.');
    } finally { sending = false; }
  }
  function loginGatePresent() { return /^\/(login|signin|signup)(\/|$)/.test(safeRead(() => location.pathname, '')); }
  function modeWarning() {
    if (loginGatePresent()) return '<b>Oriveo</b> — sign in, then open the chat.';
    return getEditor() ? '' : '<b>Oriveo</b> — open <b>app.oriveoai.com/chat</b>.';
  }
  function scanError() {
    for (const el of safeQueryAll(document, S.errors)) {
      if (!visible(el) || safeClosest(el, '[data-message-id], #rs-root')) continue;
      const text = safeRead(() => el.textContent, '').trim();
      if (text && text.length < 1000) return text.slice(0, 300);
    }
    return null;
  }
  const isTooLongMsg = text => /context.{0,20}(limit|exceeded|length)|too (long|many tokens)|token.{0,12}limit/i.test(text);
  const isBusyMsg = text => /rate limit|too many requests|quota|credits|usage limit|try again later|temporarily unavailable|server.{0,10}busy/i.test(text);
  const turnHalted = () => false, findContinueBtn = () => null, clickContinueBtn = () => false;
  function installSendHooks(handlers) {
    function notify() {
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) { if (chatIsEmpty()) handlers.onBlockedAttempt(); return; }
      handlers.onUserMessage(assistantCount());
    }
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || sending) return;
      const ed = getEditor();
      if (ed !== e.target || ed.disabled || ed.readOnly || !editorText().trim() || isHardGenerating()) return;
      notify();
    }, true);
    document.addEventListener('click', e => {
      const b = safeClosest(e.target, 'button');
      if (!b || b.disabled) return;
      if (b === stopButton()) { handlers.onNativeStop(); return; }
      if (!sending && b === sendButton() && editorText().trim()) notify();
    }, true);
  }
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item) {
    const body = safeQuery(item, S.body); let spot = null;
    for (const pre of safeQueryAll(body, 'pre')) {
      if (safeClosest(pre, '.rs-chip') || !CMD_SHAPE.test(safeRead(() => pre.textContent, ''))) continue;
      const wrapper = safeClosest(pre, '[class*="CodeBlock_wrapper"]') || pre;
      wrapper.classList.add('rs-tool-hide');
      item.classList.add('rs-cmd-mask');
      if (!spot) spot = {parent: safeRead(() => wrapper.parentElement, null), ref: wrapper};
    }
    return spot;
  }
  return {
    id: 'oriveo', displayName: 'Oriveo', supportsVision: false, timings, thinkingSel: S.thinking,
    init({diag: d} = {}) { if (d) diag = d; diag('oriveo.init', {hasEditor: !!getEditor(), login: loginGatePresent()}); },
    allItems, isUserItem, isAssistantItem, itemText, classifyText, assistantCount, userCount,
    lastAssistant, lastAssistantId, itemKey, readAssistant, streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor, setInputLock,
    typeAndSend, stopGeneration, isGenerating, isBusyNow, isHardGenerating,
    enforceComposer() { return {ready: !!getEditor()}; },
    async ensureComposerReady() { return {ready: !!getEditor() && !loginGatePresent()}; },
    turnHalted, findContinueBtn, clickContinueBtn, scanError, isTooLongMsg, isBusyMsg,
    modeWarning, loginGatePresent, attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
