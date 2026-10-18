// SPDX-License-Identifier: GPL-3.0-or-later
// 1.24.13: keep the host page from hijacking clipboard and edit shortcuts in
// elio's own text boxes (prompt enhancer, Co-work, memory, menus).
// Some sites (Notion) install page-wide handlers that cancel paste/edit events
// for anything outside their editor, so pasting into the prompt enhancer did
// nothing. This file runs at document_start, before any page script, so its
// window capture listener is the first to see every event. For trusted events
// whose target is a elio text control it stops propagation (never the
// browser default), so the native paste/copy/cut/undo still happens and the
// page never sees it. Page elements, synthetic events and every other key are
// untouched.
(() => {
  'use strict';
  if (typeof window === 'undefined' || window.__elioInputIsolation) return;
  window.__elioInputIsolation = true;
  const OWN = '#rs-root,#rs-input-cover,#rs-setup-tutorial,#rs-tutorial,.rs-continuation-offer,.rs-shot-overlay';
  const TEXT = 'textarea,input:not([type]),input[type=text],input[type=search],input[type=url],input[type=email],input[type=number],input[type=password],input[type=tel]';
  function ownTextControl(event) {
    let node = (event.composedPath && event.composedPath()[0]) || event.target;
    if (node && node.nodeType !== 1) node = node.parentElement;
    if (!node || typeof node.closest !== 'function' || !node.closest(OWN)) return null;
    return node.matches(TEXT) || node.isContentEditable ? node : null;
  }
  const editShortcut = event => ((event.ctrlKey || event.metaKey) && !event.altKey && /^[vcxazy]$/i.test(event.key || '')) ||
    (event.key === 'Insert' && (event.shiftKey || event.ctrlKey));
  const carriesFiles = event => Array.from((event.clipboardData && event.clipboardData.items) || []).some(item => item.kind === 'file');
  function guard(event) {
    if (!event.isTrusted || !ownTextControl(event)) return;
    if (event.type === 'keydown' && !editShortcut(event)) return;
    // Pasted files keep reaching elio's media panel handlers.
    if (event.type === 'paste' && carriesFiles(event)) return;
    event.stopImmediatePropagation();
  }
  for (const type of ['keydown', 'paste', 'copy', 'cut', 'beforeinput']) window.addEventListener(type, guard, true);
  if (typeof module !== 'undefined' && module.exports) module.exports = { ownTextControl, editShortcut };
})();
