// SPDX-License-Identifier: GPL-3.0-or-later
// providers/notion.js - the Notion AI provider (EXPERIMENTAL).
// Same RSProvider interface the core (core/main.js) drives. Notion's class
// names are hashed/obfuscated, so every lookup here is tag-agnostic with
// layered fallbacks and loud diagnostics: when a lookup misses on the live
// site, the console says WHICH one, so a follow-up patch can add the exact
// selector instead of guessing again.
//
// Live-bundle/DOM invariants used here:
//  - Only /ai and /chat... are AI surfaces; normal /p/... documents are not.
//  - The full-page composer is a textarea/input or rich-text editable with a
//    local AI placeholder/send control; candidate classes themselves are hashed.
//  - Transcript events expose data-agent-service-scroll-anchor. User events
//    align flex-end, assistant events flex-start, and centered rows are status.
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

  let diag = () => {};
  let needsComposer = () => false;
  let isStopped = () => false;
  let isSessionActive = () => false;
  let requestStart = () => {};

  const _txt = (el) => (el && safeRead(() => el.textContent, "") || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el || !safeRead(() => el.isConnected, false)) return false;
    if (safeRead(() => el.hidden, true)) return false;
    try {
      const r = safeRect(el);
      if (r.readFailed) return false;
      if (r.width > 0 && r.height > 0) return true;
      const st = safeStyle(el);
      return st.display !== "none" && st.visibility !== "hidden";
    } catch { return false; }
  };
  const ariaOf = (el) => (safeRead(() => el.getAttribute, null) && (safeRead(() => el.getAttribute("aria-label"), null) || "")) || "";
  // Notion implements its composer controls as focusable DIVs with role=button,
  // not native <button> elements (live: agent-send-message-button).
  const CONTROL_SEL = "button, [role='button']";
  const controlDisabled = (el) => !el || safeRead(() => el.disabled, true) === true ||
    (safeRead(() => el.getAttribute, null) && safeRead(() => el.getAttribute("aria-disabled"), null) === "true");

  // Notion has TWO completely different editable surfaces on app.notion.com:
  // normal page blocks (/p/...) and the full-page AI chat (/ai + /chat).  A page
  // block is also contenteditable, but pressing Enter there creates another page
  // block; it is NOT an AI composer.  v2.3.4 accidentally selected those blocks
  // after Notion's login redirect landed on /p/Welcome-to-Notion..., then typed
  // the whole system prompt into the page and waited forever for a reply.
  //
  // The current Notion bundle declares /ai as the new-chat landing route and
  // /chat (or /chat/:id) as an existing AI thread.  Treat ONLY those routes as
  // an AI surface.  This is deliberately strict: a false negative produces a
  // useful "composer not ready" error; a false positive can overwrite a page.
  // Route model (1.24.10). Notion has used two URL shapes for the full-page AI:
  //   /ai                  new-chat landing (older bundles)
  //   /chat/<id>           existing thread (older bundles)
  //   /chat                new-chat landing (current bundles)
  //   /chat?t=<id>         existing thread (current bundles; the id is a query
  //                        parameter, so every thread has the SAME pathname)
  // A thread is recognised by an id, never by the bare pathname. Unknown
  // benign query parameters (view/workspace flags) never make a landing dirty;
  // only parameters that Notion executes as launch payloads do.
  const AI_LANDING_RE = /^\/ai\/?$/;
  const AI_CHAT_PATH_RE = /^\/chat(?:\/|$)/;
  const AI_CHAT_ID_PATH_RE = /^\/chat\/[^/]+/;
  const THREAD_PARAM_RE = /^(?:t|thread|threadid|thread_id|chat|chatid|chat_id)$/i;
  const LAUNCH_PAYLOAD_PARAM_RE = /^(?:q|aq|prompt|message|usermessage|defaultusermessage|aiaction|ai_action|targetconfig|target_config|autosubmit|auto_submit|autosend|submit)$/i;
  function routeParams() {
    try { return new URLSearchParams(location.search || ""); } catch { return new URLSearchParams(""); }
  }
  const isChatPath = () => AI_CHAT_PATH_RE.test(location.pathname || "");
  function threadId() {
    try {
      const path = location.pathname || "";
      if (AI_CHAT_ID_PATH_RE.test(path)) return path.split("/")[2] || "";
      if (!isChatPath()) return "";
      for (const [k, v] of routeParams()) if (THREAD_PARAM_RE.test(k) && v) return v;
    } catch {}
    return "";
  }
  function hasLaunchPayload() {
    try {
      for (const [k, v] of routeParams()) if (LAUNCH_PAYLOAD_PARAM_RE.test(k) && v !== "") return true;
    } catch {}
    return false;
  }
  const isAiThread = () => isChatPath() && !!threadId();
  const isAiLanding = () => AI_LANDING_RE.test(location.pathname || "") || (isChatPath() && !threadId());
  const isAiSurface = () => isAiLanding() || isAiThread();
  const routeKey = () => `${location.pathname || ""}${location.search || ""}`;
  // Notion treats /ai query parameters as executable launch payloads. Current
  // bundles map q, aq and defaultUserMessage to an automatically submitted first
  // message, and aiAction/targetConfig can launch a native workspace action.
  // Example seen live: "Summarize this workspace to help me get started" raced
  // our Roblox bootstrap and became the first turn. A elio session must
  // start from a payload-free landing so its only first request is our
  // bootstrap and its first command is list_commands.
  const isCleanAiLanding = () => isAiLanding() && !hasLaunchPayload();

  // ── composer ─────────────────────────────────────────────────────────────
  // Notion AI (app.notion.com/ai) uses an obfuscated, hashed-class DOM where the
  // composer is NOT reliably a bare [contenteditable] div. The original v2.3.0
  // provider only looked for [contenteditable], which returned null on the real
  // /ai page (diag: notion.providerLoaded editor:false items:0) - so Start
  // silently did nothing. Broaden detection to every common rich-text/chat
  // composer surface (contenteditable, ProseMirror/Tiptap, role=textbox,
  // textarea) and rank candidates by how chat-like they are, so the right node
  // is picked even when Notion's classes are hashed.
  // Composer detection is memoised: the core calls findEditorRaw() from status,
  // metering, sweeps and every send hook. On a long Notion chat, a broad editor
  // scan touches every historical contenteditable block and can force thousands
  // of layout reads at the exact moment the user presses Enter. A connected
  // positive composer is stable for the lifetime of this route, so retain it
  // until Notion actually detaches it; negative results stay briefly cached so a
  // lazily mounting composer is still discovered quickly.
  let _editorCache = null, _editorAt = 0, _candAt = 0, _candCache = [];
  let _editorRoute = "", _lastEditorLogged = null;
  let _frameCache = null, _frameEditor = null;
  let _phCache = null, _phAt = 0; let _phAttrEditor = null;
  const EDITOR_SEL =
    "textarea, input[type='text'], input[type='search'], [contenteditable], " +
    ".ProseMirror, .tiptap, [role='textbox']";
  // Text currently shown by Notion's full-page AI composer. Keep older wording
  // as fallbacks because Notion A/B-tests this copy.
  const COMPOSER_TEXT_RE = /(do anything with|anything with ai|ask notion ai|ask ai|ask anything|what would you like|message.*(?:ai|notion)|start typing|reply to|your message|frag(?:e)? notion[-\s]?(?:ki|ai)|frage.*(?:ki|notion)|demande[rz]? .*notion|pregunta.*notion|pergunte.*notion)/i;
  // Placeholder wording that is only trusted as an attribute on (or labelling)
  // the composer: as free text, AI replies also say "How can I help...".
  const COMPOSER_PLACEHOLDER_RE = /how can i help|wie kann ich (?:dir|ihnen) helfen|was m[öo]chtest du|frag(?:e)? (?:die )?ki|ki etwas fragen|comment puis-je|comment (?:puis|peux).*aider|c[óo]mo puedo ayudar|como posso ajudar/i;
  const isTextControl = (el) => !!el && /^(INPUT|TEXTAREA)$/.test(safeRead(() => el.tagName, "") || "");

  function resetEditorCacheForRoute() {
    const key = routeKey();
    if (key === _editorRoute) return;
    _editorRoute = key;
    _editorCache = null; _editorAt = 0;
    _candCache = []; _candAt = 0;
    _phCache = null; _phAt = 0; _phAttrEditor = null;
    _frameCache = null; _frameEditor = null;
    _lastEditorLogged = null;
  }
  function candidateVisible(el) {
    if (!el || !safeRead(() => el.isConnected, false) || safeRead(() => el.hidden, true)) return false;
    try {
      // One geometry read only. The old visible() + second rect pair doubled the
      // forced-layout cost for every historical editor candidate.
      const r = safeRect(el);
      // Ignore off-screen history, hidden measurement inputs and 1px a11y shims.
      return r.width >= 80 && r.height >= 12 && r.bottom > 0 && r.top < innerHeight + 120;
    } catch { return false; }
  }
  function editableNode(el) {
    if (!el) return null;
    if (safeRead(() => el.matches, null) && safeRead(() => el.matches(EDITOR_SEL), false)) return el;
    return (safeRead(() => el.closest, null) && safeClosest(el, EDITOR_SEL)) || null;
  }
  function editableNear(el) {
    if (!el) return null;
    const direct = editableNode(el);
    if (direct) return direct;
    // The visible placeholder can be a sibling overlay rather than an attribute
    // on the textarea. Walk only a few local wrappers and look inside each one.
    let n = safeRead(() => el.parentElement, null);
    for (let i = 0; n && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      const own = editableNode(n);
      if (own) return own;
      const inside = safeRead(() => n.querySelector, null) && safeQuery(n, EDITOR_SEL);
      if (inside) return inside;
    }
    return null;
  }
  // Fast path for the stable full-page wording seen on the live composer. Keep
  // this deliberately narrower than COMPOSER_TEXT_RE: generic "Ask AI" controls
  // can also exist inside transcript cards and must still go through ranking.
  const DIRECT_PLACEHOLDER_SEL =
    "[data-placeholder*='do anything with' i], [aria-placeholder*='do anything with' i], " +
    "[placeholder*='do anything with' i], [aria-label*='do anything with' i], " +
    "[data-placeholder*='ask notion ai' i], [aria-placeholder*='ask notion ai' i], " +
    "[placeholder*='ask notion ai' i], [aria-label*='ask notion ai' i], " +
    "[data-placeholder*='anything with ai' i], [aria-placeholder*='anything with ai' i], " +
    "[placeholder*='anything with ai' i], [aria-label*='anything with ai' i], " +
    "[data-placeholder*='notion-ki' i], [aria-placeholder*='notion-ki' i], [placeholder*='notion-ki' i], [aria-label*='notion-ki' i], " +
    // Attribute-only: as free text "How can I help" also appears in AI replies.
    "[data-placeholder*='how can i help' i], [aria-placeholder*='how can i help' i], [placeholder*='how can i help' i]";
  function directPlaceholderEditable() {
    if (!isAiSurface()) return null;
    let best = null, bestBottom = -Infinity;
    try {
      for (const n of safeQueryAll(document, DIRECT_PLACEHOLDER_SEL)) {
        if (safeRead(() => n.closest, null) && safeClosest(n, "#rs-root")) continue;
        const ed = editableNear(n);
        if (!ed || !safeRead(() => ed.isConnected, false) || !candidateVisible(ed)) continue;
        let bottom = 0;
        try { bottom = safeRect(ed).bottom; } catch {}
        if (!best || bottom > bestBottom) { best = ed; bestBottom = bottom; }
      }
    } catch {}
    if (best) _phAttrEditor = best; // attribute selector match: composer evidence
    return best;
  }
  function placeholderEditable() {
    if (!isAiSurface()) return null;
    const now = Date.now();
    if (_phAt && now - _phAt < 900) return _phCache && safeRead(() => _phCache.isConnected, false) ? _phCache : null;
    _phAt = now; _phCache = null; _phAttrEditor = null;
    // First use attributes/labels. This is cheap and catches normal textarea
    // builds even when the composer mounts a few seconds after the page shell.
    try {
      // Do not append EDITOR_SEL here: historical Notion blocks are themselves
      // contenteditable, yet without a placeholder/label they cannot identify
      // the composer. Including them made this supposedly targeted pass walk the
      // entire transcript on every cache miss.
      const nodes = safeQueryAll(document, "[data-placeholder], [aria-placeholder], [placeholder], [aria-label]");
      for (const n of nodes) {
        if (safeRead(() => n.closest, null) && safeClosest(n, "#rs-root")) continue;
        const hint = ((safeRead(() => n.getAttribute("data-placeholder"), null) || "") + " " +
          (safeRead(() => n.getAttribute("aria-placeholder"), null) || "") + " " +
          (safeRead(() => n.getAttribute("placeholder"), null) || "") + " " +
          (safeRead(() => n.getAttribute("aria-label"), null) || "")).slice(0, 180);
        if (!COMPOSER_TEXT_RE.test(hint) && !COMPOSER_PLACEHOLDER_RE.test(hint)) continue;
        const ed = editableNear(n);
        if (ed && safeRead(() => ed.isConnected, false) && candidateVisible(ed)) {
          // Attribute evidence (placeholder/label) is strong enough for ranking;
          // the text-node and focus fallbacks below are not.
          _phCache = ed; _phAttrEditor = ed; return ed;
        }
      }
    } catch {}
    // Some builds render "Do anything with AI…" as a plain overlay <div>.
    // Inspect a bounded number of text nodes and search only the local wrapper;
    // never fall back to that plain div itself (it cannot accept input).
    try {
      const root = document.body || document.documentElement;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n, seen = 0;
      while ((n = walker.nextNode()) && ++seen <= 1400) {
        const text = (safeRead(() => n.nodeValue, "") || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 100 || !COMPOSER_TEXT_RE.test(text)) continue;
        const ed = editableNear(safeRead(() => n.parentElement, null));
        if (ed && safeRead(() => ed.isConnected, false) && candidateVisible(ed) && !(safeRead(() => ed.closest, null) && safeClosest(ed, "#rs-root"))) {
          _phCache = ed; return ed;
        }
      }
    } catch {}
    // Focus is a useful final signal, but ONLY on an actual AI route. This avoids
    // turning a focused normal Notion page block into the AI composer.
    const ae = document.activeElement;
    if (ae && safeRead(() => ae.isConnected, false) && !(safeRead(() => ae.closest, null) && safeClosest(ae, "#rs-root"))) {
      const ed = editableNode(ae);
      if (ed && candidateVisible(ed)) { _phCache = ed; return ed; }
    }
    return null;
  }
  function editorCandidates() {
    resetEditorCacheForRoute();
    if (!isAiSurface()) return [];
    const now = Date.now();
    if (_candAt && now - _candAt < 350) return _candCache;
    // The live composer carries a strong AI placeholder. Resolve that targeted
    // path before the broad EDITOR_SEL fallback so a normal send never inspects
    // thousands of historical contenteditable response blocks.
    const direct = directPlaceholderEditable();
    if (direct) {
      _candAt = now; _candCache = [direct];
      return _candCache;
    }
    const out = [];
    const push = (e) => {
      if (e && safeRead(() => e.isConnected, false) && !(safeRead(() => e.closest, null) && safeClosest(e, "#rs-root")) &&
          candidateVisible(e) && !out.includes(e)) out.push(e);
    };
    try { safeQueryAll(document, EDITOR_SEL).forEach(push); } catch {}
    // Open shadow roots are uncommon here, but probing a bounded host set is
    // cheap insurance. (Closed roots are intentionally impossible to pierce.)
    try {
      let hosts = 0;
      for (const h of safeQueryAll(document, "div, section, main")) {
        if (++hosts > 220) break;
        if (h.shadowRoot) safeQueryAll(h.shadowRoot, EDITOR_SEL).forEach(push);
      }
    } catch {}
    const ph = placeholderEditable();
    if (ph) push(ph);
    _candAt = now; _candCache = out;
    return out;
  }
  function editorHintScore(e) {
    let s = 0;
    if (safeRead(() => e.tagName, "") === "TEXTAREA") s += 8; // current full-page Agent build
    else if (safeRead(() => e.tagName, "") === "INPUT") s += 4;
    if (e.isContentEditable || (safeRead(() => e.getAttribute, null) && /^(true|plaintext-only)$/i.test(safeRead(() => e.getAttribute("contenteditable"), null) || ""))) s += 2;
    if (safeRead(() => e.hasAttribute, null) && (safeRead(() => e.hasAttribute("data-zs-lock-ce"), false) || safeRead(() => e.hasAttribute("data-zs-lock-ro"), false))) s += 4;
    if (safeRead(() => e.matches, null) && safeRead(() => e.matches(".ProseMirror, .tiptap, [role='textbox']"), false)) s += 3;
    const ph = ((safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("placeholder"), null) || "")) + " " +
                (safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("data-placeholder"), null) || "")) + " " +
                (safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("aria-placeholder"), null) || "")) + " " +
                (safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("aria-label"), null) || "")) + " " +
                (safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("data-zs-lock-ph"), null) || "")) + " " +
                (safeRead(() => e.getAttribute, null) && (safeRead(() => e.getAttribute("data-zs-lock-dp"), null) || ""))).slice(0, 240);
    // 1.22.1: a placeholder/label attribute on a nearby node already tied this
    // editor to the composer (placeholderEditable), so it counts like one on
    // the editor itself. Attribute-only: reply text never sets _phAttrEditor.
    const attrPlaceholder = !!_phAttrEditor && _phAttrEditor === e && safeRead(() => e.isConnected, false);
    const strongComposerHint = COMPOSER_TEXT_RE.test(ph) || COMPOSER_PLACEHOLDER_RE.test(ph) || attrPlaceholder;
    if (strongComposerHint) s += 9;
    let definitiveSend = false;
    if (/(ask|send|message|chat|\bai\b)/i.test(ph)) s += 3;
    // Notion uses content-editable-leaf-rtl for both page blocks and its AI
    // composer. A placeholder can be an adjacent overlay, not an attribute on
    // the editor, so inspect the local wrapper before applying the penalty.
    for (let n = safeRead(() => e.parentElement, null), i = 0; n && i < 3; n = safeRead(() => n.parentElement, null), i++) {
      // Notion's own composer send control (stable data-testid) within three
      // wrappers is definitive: the editor is the AI composer even when Notion
      // A/B-tests placeholder copy that COMPOSER_TEXT_RE does not know yet.
      if (safeRead(() => n.querySelector, null) && safeQuery(n, "[data-testid='agent-chat-send-button'], [data-testid='agent-send-message-button']")) { s += 4; definitiveSend = true; break; }
    }
    for (let n = safeRead(() => e.parentElement, null), i = 0; n && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      if (safeRead(() => n.querySelector, null) && [...safeQueryAll(n, CONTROL_SEL)].some((b) =>
        SEND_RE.test(ariaOf(b)) || SEND_RE.test(safeRead(() => b.getAttribute("data-testid"), null) || "") ||
        SEND_RE.test(safeRead(() => b.title, "") || "") || STOP_RE.test(ariaOf(b)))) { s += 5; break; }
    }
    let nearbyComposerHint = false;
    for (let n = safeRead(() => e.parentElement, null), i = 0; n && i < 4; n = safeRead(() => n.parentElement, null), i++) {
      if (COMPOSER_TEXT_RE.test((safeRead(() => n.textContent, "") || "").slice(0, 220))) {
        nearbyComposerHint = true; s += 7; break;
      }
    }
    // Notion's own send-button test id is definitive (see above), so it also
    // lifts the page-block penalty. Before 1.22.1 the penalty won, the composer
    // was not found ("phEditable":true,"editor":false) and an accepted message
    // could end as "Message was not confirmed".
    if (/content-editable-leaf/i.test(String(safeRead(() => e.className, "") || "")) &&
        !strongComposerHint && !nearbyComposerHint && !definitiveSend) s -= 12;
    return s;
  }
  function findEditorRaw() {
    // Absolutely never inspect normal Notion page editors. This one guard fixes
    // the exact /p/Welcome-to-Notion false positive in the v2.3.4 console trace.
    resetEditorCacheForRoute();
    if (!isAiSurface()) return null;
    const now = Date.now();
    // Reuse the live composer without enumerating historical editables. React
    // can hide the landing composer while keeping it connected; that node must
    // not win over the replacement composer during startup.
    if (_editorCache && candidateVisible(_editorCache) && !safeRead(() => _editorCache.disabled, true) &&
        (isTextControl(_editorCache) || safeRead(() => _editorCache.getAttribute("contenteditable"), null) !== "false")) return _editorCache;
    if (_editorCache) {
      _editorCache = null; _editorAt = 0;
      _frameCache = null; _frameEditor = null;
      // Do not let the shorter candidate/placeholder caches hand the detached
      // editor straight back during the same React remount tick.
      _candCache = []; _candAt = 0;
      _phCache = null; _phAt = 0; _phAttrEditor = null;
    }
    // Negative results are cached briefly. v2.3.4 only cached positives, so a
    // missing composer still caused a full DOM scan on every mutation.
    if (_editorAt && now - _editorAt < 1200) return null;
    const cands = editorCandidates();
    if (!cands.length) { _editorAt = now; _editorCache = null; return null; }
    const scored = cands.map((c) => {
      let bottom = 0;
      try { bottom = safeRect(c).bottom; } catch {}
      return { c, s: editorHintScore(c), bottom };
    });
    scored.sort((a, b) => (b.s - a.s) || (b.bottom - a.bottom));
    // Require real composer evidence. A generic Notion search input scores 4;
    // a real textarea plus its AI placeholder/local send control scores 9+.
    if (scored[0].s < 9) { _editorAt = now; _editorCache = null; return null; }
    const top = scored[0].c;
    _editorCache = top; _editorAt = now;
    if (_lastEditorLogged !== top) {
      _lastEditorLogged = top;
      try {
        diag("notion.editor.found", {
          tag: safeRead(() => top.tagName, ""), type: safeRead(() => top.getAttribute, null) && safeRead(() => top.getAttribute("type"), null),
          editable: safeRead(() => top.getAttribute, null) && safeRead(() => top.getAttribute("contenteditable"), null),
          role: safeRead(() => top.getAttribute, null) && safeRead(() => top.getAttribute("role"), null),
          placeholder: safeRead(() => top.getAttribute, null) && (safeRead(() => top.getAttribute("placeholder"), null) || safeRead(() => top.getAttribute("data-placeholder"), null)),
          cls: String(safeRead(() => top.className, "") || "").slice(0, 60), hint: scored[0].s,
          cands: cands.length, bottom: Math.round(scored[0].bottom), path: location.pathname,
        });
      } catch {}
    }
    return top;
  }
  const getEditor = () => {
    const e = findEditorRaw();
    if (!e || safeRead(() => e.disabled, true)) return null;
    if (isTextControl(e)) return e;
    return safeRead(() => e.getAttribute("contenteditable"), null) !== "false" ? e : null;
  };
  const edText = (e) => {
    if (!e) return "";
    if (isTextControl(e)) return safeRead(() => e.value, "") || "";
    // Notion renders emoji as <img class="notion-emoji" alt="✅">, which textContent
    // silently omits (live Oct 2026: every emoji vanished from the read-back, so a
    // fully written draft looked truncated and Start aborted leaving it in the
    // composer). Read the alt text back in document order.
    return safeRead(() => {
      if (!e.querySelector || !e.querySelector("img.notion-emoji")) return e.textContent || "";
      let out = "";
      const walker = document.createTreeWalker(e, 5); // SHOW_ELEMENT | SHOW_TEXT
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.tagName === "IMG" && n.classList && n.classList.contains("notion-emoji")) out += n.getAttribute("alt") || "";
      }
      return out;
    }, "") || "";
  };
  const editorText = (el) => edText(el || findEditorRaw());
  function composerFrame() {
    if (!isAiSurface()) return null;
    const e = findEditorRaw();
    if (!e) return null;
    const hasCommit = n => controlsIn(n).some(control => controlAvailable(control) && (sendControlLike(control) || stopControlLike(control)));
    if (_frameEditor === e && _frameCache && safeRead(() => _frameCache.isConnected, false) &&
        safeRead(() => _frameCache.contains(e), false) && hasCommit(_frameCache)) return _frameCache;
    let fallback = safeRead(() => e.parentElement, null), chosen = null;
    // A long retained protocol draft can make its composer taller than 360px.
    // Find its own semantic send/stop controls rather than rejecting that frame.
    for (let n = fallback, i = 0; n && n !== document.body && i < 7; n = safeRead(() => n.parentElement, null), i++) {
      if (hasCommit(n)) { chosen = n; break; }
    }
    if (!chosen) {
      const semantic = safeClosest(e, 'form, [role="region"], [role="main"], main');
      // Skip wide page boundaries with several composers: never borrow another chat's send control.
      if (semantic && hasCommit(semantic) && safeQueryAll(semantic, 'textarea, [contenteditable="true"], [role="textbox"]').filter(node => node !== e && !safeRead(() => e.contains(node), false) && !safeRead(() => node.contains(e), false)).length === 0) chosen = semantic;
    }
    _frameEditor = e;
    _frameCache = chosen;
    return chosen || fallback;
  }

  // ── send / stop ──────────────────────────────────────────────────────────
  const SEND_RE = /send|submit|senden|abschicken|envoyer|enviar/i;
  const STOP_RE = /(?:^|\b)(?:stop|cancel|interrupt|arr[êe]ter|stoppen|anhalten|abbrechen)(?:\b|$)/i;
  const controlsIn = (root) => root ? [...safeQueryAll(root, CONTROL_SEL)] : [];
  const sendControlLike = (b) => !!b &&
    (/^(?:agent-send-message-button|agent-chat-send-button)$/.test(safeRead(() => b.getAttribute("data-testid"), null) || "") ||
     SEND_RE.test(ariaOf(b)) || SEND_RE.test(safeRead(() => b.getAttribute("data-testid"), null) || "") ||
     SEND_RE.test(safeRead(() => b.title, "") || ""));
  const stopControlLike = (b) => {
    if (!b) return false;
    const text = _txt(b), testId = safeRead(() => b.getAttribute("data-testid"), null) || "";
    return /agent-(?:stop|interrupt)/i.test(testId) ||
      STOP_RE.test(ariaOf(b)) || STOP_RE.test(testId) || STOP_RE.test(safeRead(() => b.title, "") || "") ||
      (STOP_RE.test(text) && text.length <= 40);
  };
  const exactSendControl = (frame, controls) => {
    const exact = (controls || controlsIn(frame)).filter(b =>
      /^(?:agent-send-message-button|agent-chat-send-button)$/.test(safeRead(() => b.getAttribute("data-testid"), null) || ""));
    return exact.find(b => controlAvailable(b) && !controlDisabled(b)) || exact.find(controlAvailable) || null;
  };
  function controlAvailable(el) {
    if (!el || !safeRead(() => el.isConnected, false)) return false;
    if (!safeRead(() => document.hidden, true)) return visible(el);
    // Background tabs can report a zero viewport rectangle even for the live
    // composer. Preserve CSS visibility checks while omitting only geometry.
    try {
      const s = safeStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity || 1) !== 0;
    } catch { return false; }
  }
  function sendButton() {
    if (!isAiSurface()) return null;
    const frame = composerFrame();
    if (!frame) return null; // never search every control on a normal Notion page
    const controls = controlsIn(frame);
    // Stable selectors from the live full-page composer come first. Its blue
    // arrow is <div role=button>, data-testid=agent-chat-send-button (or
    // agent-send-message-button in earlier Notion bundles),
    // aria-label="Submit AI message" — querying only <button> stranded drafts.
    const exact = exactSendControl(frame, controls);
    if (exact) return controlAvailable(exact) && !controlDisabled(exact) ? exact : null;
    const named = controls.find((b) => sendControlLike(b) && controlAvailable(b) && !controlDisabled(b));
    if (named) return named;
    // Notion renamed/relabelled the send arrow (no stable test id, no
    // send/submit wording): fall back to weighted structural scoring.
    return inferSendControl();
  }
  // Heuristic last resort for a relabelled send control. Only used when the
  // composer already holds a draft (so a real send control MUST be enabled), no
  // named control matched, and exactly one nearby icon button clearly stands out.
  // Every click is still verified by the receipt logic; a wrong guess is
  // reported as an unconfirmed send, never retried blindly.
  const NOT_SEND_LABEL_RE = /attach|upload|add\b|plus|mic|voice|dictat|record|model|menu|more|setting|search|tool|mention|@|file|image|photo|emoji|stop|cancel|interrupt|close|dismiss|remove|delete|clear|copy|expand|collapse|source|connect|web|think|mode|slash|command/i;
  function inferSendControl() {
    try {
      const ed = findEditorRaw();
      if (!ed || !edText(ed).trim()) return null;
      const er = safeRect(ed);
      for (let n = safeRead(() => ed.parentElement, null), depth = 0; n && n !== document.body && depth < 7; n = safeRead(() => n.parentElement, null), depth++) {
        const scored = [];
        const controls = controlsIn(n).filter((b) => !safeClosest(b, "#rs-root") && !safeRead(() => b.contains(ed), false) && !safeRead(() => ed.contains(b), false));
        controls.forEach((b, index) => {
          if (!controlAvailable(b) || controlDisabled(b)) return;
          const label = (ariaOf(b) + " " + (safeRead(() => b.getAttribute("data-testid"), null) || "") + " " + (safeRead(() => b.title, "") || "")).trim();
          const text = _txt(b);
          if (NOT_SEND_LABEL_RE.test(label) || text.length > 2) return;
          if (safeRead(() => b.getAttribute("aria-haspopup"), null) || safeRead(() => b.getAttribute("aria-expanded"), null) !== null) return;
          const r = safeRect(b);
          if (!r.width || !r.height || r.width > 64 || r.height > 64) return;
          let score = 0;
          if (safeQuery(b, "svg, img")) score += 2;
          if (safeRead(() => b.type, "") === "submit") score += 4;
          if (Math.abs(r.width - r.height) <= 4) score += 2;
          if (r.left >= er.left + er.width * 0.5) score += 2;
          if (r.bottom >= er.top) score += 1;
          if (index === controls.length - 1) score += 2;
          if (/ask|go\b|run|post|reply|enter|arrow|up\b|submit|send/i.test(label)) score += 3;
          scored.push({ b, score });
        });
        if (!scored.length) continue;
        scored.sort((a, c) => c.score - a.score);
        const best = scored[0], next = scored[1];
        if (best.score >= 6 && (!next || best.score - next.score >= 2)) {
          diag("notion.send.inferredControl", { score: best.score, depth, label: ariaOf(best.b).slice(0, 40), testid: (safeRead(() => best.b.getAttribute("data-testid"), null) || "").slice(0, 60) });
          return best.b;
        }
        return null;
      }
    } catch {}
    return null;
  }
  function stopButton() {
    if (!isAiSurface()) return null;
    const frame = composerFrame();
    if (!frame) return null;
    return controlsIn(frame).find((b) =>
      stopControlLike(b) && controlAvailable(b) && !controlDisabled(b)) || null;
  }

  // ── transcript ───────────────────────────────────────────────────────────
  const AI_MARK_RE = /\b(GPT|ChatGPT|Claude|Opus|Sonnet|Haiku|Astra|Gemini|LLaMA|Notion AI|AI)\b/i;
  const AI_AFFORD_RE = /copy|regenerate|retry|like|dislike|good response|thumbs/i;
  // This is a stable semantic attribute from Notion's current Agent bundle. It
  // is attached to every transcript row, while all CSS class names are hashed:
  //   data-agent-service-scroll-anchor="<event key>"
  // User rows are flex-end; assistant rows are flex-start; status rows center.
  // Using it fixes v2.3.4's `items:0` even when messages were visibly on screen.
  const AGENT_ROW_SEL = "[data-agent-service-scroll-anchor]";
  const _alignCache = new WeakMap();
  function rowAlign(row) {
    if (!row) return "";
    const inline = safeRead(() => row.style && row.style.justifyContent, "");
    if (inline) return inline;
    const cached = _alignCache.get(row);
    if (cached) return cached;
    let v = "";
    try { v = safeStyle(row).justifyContent || ""; } catch {}
    if (v) _alignCache.set(row, v);
    return v;
  }
  function rawAgentRows() {
    if (!isAiSurface()) return [];
    let rows = [];
    try { rows = [...safeQueryAll(document, AGENT_ROW_SEL)]; } catch { return []; }
    // Tool-detail rows may carry the same anchor inside a top-level message row;
    // only expose top-level transcript events to the core.
    return rows.filter((r) =>
      !(safeRead(() => r.closest, null) && safeClosest(r, "#rs-root")) &&
      !(safeRead(() => r.parentElement, null) && safeRead(() => safeRead(() => r.parentElement, null).closest, null) && safeClosest(safeRead(() => r.parentElement, null), AGENT_ROW_SEL)));
  }
  function agentMessageRows(rows = rawAgentRows()) {
    return rows.filter((r) => {
      const align = rowAlign(r);
      if (align === "flex-end") return true; // user message (including hidden system prompt)
      if (align !== "flex-start") return false; // centered status/progress row
      const key = (safeRead(() => r.getAttribute("data-agent-service-scroll-anchor"), null) || "").toLowerCase();
      if (/^(running-placeholder|interrupting|interrupt-sent):/.test(key)) return false;
      // An assistant message enters the DOM before its first token. Omit that
      // empty shell until text arrives; generation state still comes from Stop.
      return !!(_txt(r) || safeQuery(r, "pre, code, img, [aria-label*='copy' i], [aria-label*='response' i]"));
    });
  }

  // Live fallback (Notion full-page chat, September 2026): the rendered chat
  // has neither agent-service anchor attribute above. Every assistant answer is
  // instead a self-contained Notion block editor root:
  //   [data-content-editable-root=true].whenContentEditable
  // with one or more [data-block-id] children. The user's captured list_commands
  // reply used exactly this structure. Keep this route-gated and structural so
  // ordinary /p document roots can never enter the transcript.
  const BLOCK_RESPONSE_ROOT_SEL = "[data-content-editable-root='true']";
  const _endAlignedCache = new WeakMap();
  function hasEndAlignedAncestor(el) {
    const now = Date.now(), cached = _endAlignedCache.get(el);
    // A positive user-bubble alignment is stable. Recheck an initial negative
    // once after mount, because Notion can apply wrapper layout a tick later;
    // after two negatives this historical assistant no longer needs style walks.
    if (cached && cached.parent === safeRead(() => el.parentElement, null) &&
        (now - cached.at < 1500 || (!cached.value && cached.checks >= 2))) return cached.value;
    for (let n = el, i = 0; n && n !== document.body && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      let jc = safeRead(() => n.style && n.style.justifyContent, "") || "", fd = safeRead(() => n.style && n.style.flexDirection, "") || "";
      try {
        const cs = safeStyle(n);
        if (!jc) jc = cs.justifyContent || "";
        if (!fd) fd = cs.flexDirection || "";
      } catch {}
      // A column flex-end container merely pins the transcript to the bottom;
      // only horizontal end alignment identifies a user bubble.
      if ((jc === "flex-end" || jc === "end") && !/^column/.test(fd)) {
        _endAlignedCache.set(el, { value: true, parent: safeRead(() => el.parentElement, null), at: now, checks: (cached?.checks || 0) + 1 });
        return true;
      }
    }
    _endAlignedCache.set(el, { value: false, parent: safeRead(() => el.parentElement, null), at: now, checks: (cached?.checks || 0) + 1 });
    return false;
  }
  const _blockUserItems = new WeakSet();
  function blockAssistantRoots() {
    if (!isChatPath()) return [];
    let roots = [];
    try { roots = [...safeQueryAll(document, BLOCK_RESPONSE_ROOT_SEL)]; }
    catch { return []; }
    const ed = findEditorRaw();
    const frame = composerFrame();
    return roots.filter((r) => {
      if (!safeRead(() => r.isConnected, false) || (safeRead(() => r.closest, null) && safeClosest(r, "#rs-root"))) return false;
      if ((ed && (r === ed || safeRead(() => r.contains(ed), false) || safeRead(() => ed.contains(r), false))) ||
          (frame && safeRead(() => frame.contains(r), false))) return false;
      // A nested editor root is a block detail, not a second chat turn.
      if (safeRead(() => r.parentElement, null) && safeClosest(safeRead(() => r.parentElement, null), BLOCK_RESPONSE_ROOT_SEL)) return false;
      if (!safeQuery(r, "[data-block-id]")) return false;
      // Avoid whitespace-normalizing every historical response on each scan.
      // Native textContent plus a one-character non-whitespace probe is enough
      // for inclusion and marker checks; actual parsing happens only on the
      // current/previously-unseen turns in core.
      const text = safeRead(() => r.textContent, "") || "";
      if (!/\S/.test(text) && !safeQuery(r, "img, video, pre, code")) return false;
      // Both sides of newer threads use block editors. Keep user turns in
      // the transcript too: their result envelopes prove session readiness and
      // need whole-bubble masking, while genuine requests supply task goals.
      if (hasEndAlignedAncestor(r)) _blockUserItems.add(r);
      else _blockUserItems.delete(r);
      return true;
    });
  }
  function blockTranscriptItems() {
    const roots = blockAssistantRoots();
    const ed = findEditorRaw(), frame = composerFrame();
    // Plain user bubbles have no editor/block ID. Inspect semantic user rows
    // and end-aligned wrappers, not every div/style in a long conversation.
    const candidates = safeQueryAll(document,
      '[data-message-role="user"], [data-role="user"], [style*="justify-content"]');
    const users = [], userSet = new WeakSet();
    for (const item of candidates) {
      if (safeClosest(item, "#rs-root") || (frame && safeRead(() => frame.contains(item), false)) ||
          (ed && (item === ed || safeRead(() => item.contains(ed), false))) ||
          safeClosest(item, BLOCK_RESPONSE_ROOT_SEL) || safeQuery(item, BLOCK_RESPONSE_ROOT_SEL)) continue;
      const role = safeRead(() => item.getAttribute("data-message-role") || item.getAttribute("data-role"), "");
      const css = safeStyle(item), align = safeRead(() => item.style.justifyContent, "") || css.justifyContent || "";
      if (!/user|human/i.test(role) && (!(align === "flex-end" || align === "end") || /^column/.test(css.flexDirection || ""))) continue;
      if (!/\S/.test(safeRead(() => item.textContent, "")) && !safeQuery(item, "img")) continue;
      let nested = false;
      for (let parent = safeRead(() => item.parentElement, null); parent && parent !== document.body; parent = safeRead(() => parent.parentElement, null)) {
        if (userSet.has(parent)) { nested = true; break; }
      }
      if (nested) continue;
      _blockUserItems.add(item); userSet.add(item); users.push(item);
    }
    return [...roots, ...users].sort((a, b) => safeRead(() => a.compareDocumentPosition(b) & 2, false) ? 1 : -1);
  }

  // Notion's DOM-lock removes/reverts children inserted under
  // .whenContentEditable and floods the console. Render command status without
  // touching that subtree: a stylesheet in #rs-root replaces only the command
  // block's visual children with a CSS pseudo-card. The underlying text remains
  // intact for parsing, and any surrounding assistant prose remains visible.
  const _immutableItemKey = new WeakMap();
  const _immutableItemBlock = new WeakMap();
  const _immutableItemCard = new WeakMap();
  const _immutableCards = new Map();
  const _immutableDirty = new Set();
  let _immutableStyle = null, _immutableStyleTimer = 0, _immutableCompactTimer = 0;
  let _immutableCssomFailed = false, _immutableBubbleSeq = 0;
  const cssQuoted = (v) => String(v || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, (q) => "\\" + q);
  const cssAttr = (v) => cssQuoted(v);
  const cssText = (v) => cssQuoted(v).replace(/[\r\n]+/g, " ");
  function immutableCommandBlock(item) {
    if (!item) return null;
    const blocks = [...safeQueryAll(item, "[data-block-id]")];
    return blocks.find((b) => {
      const t = _txt(b);
      return /["']command["']\s*:\s*["']/i.test(t) ||
        /###\s*(?:LUA|LUAU)\s*###/i.test(t) || /<tool_call>/i.test(t);
    }) || blocks[0] || null;
  }
  function immutableKey(item) {
    if (!item) return "";
    let cached = _immutableItemKey.get(item) || "";
    const remembered = _immutableItemCard.get(item);
    if (cached.startsWith("bubble:") && remembered && safeRead(() => item.isConnected, false) && !immutableSameTurn(remembered, item, cached)) {
      forgetImmutableItem(item, remembered); cached = "";
    }
    if (cached.startsWith("bubble:") && safeRead(() => item.getAttribute("data-elio-notion-card"), null) === cached.slice(7)) return cached;
    if (cached.startsWith("row:")) {
      const anchor = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null);
      if (anchor) return "row:" + anchor;
    }
    const cachedBlock = _immutableItemBlock.get(item);
    // Timer/detail updates hit this path several times per second while a giant
    // JSON edit is running. Its known block and ID are stable; do not enumerate
    // every child block and normalize the full script just to rediscover them.
    if (cachedBlock && safeRead(() => cachedBlock.isConnected, false) && safeRead(() => item.contains(cachedBlock), false)) {
      const current = safeRead(() => cachedBlock.getAttribute("data-block-id"), null) || "";
      if (current) {
        if (current !== cached) _immutableItemKey.set(item, current);
        return current;
      }
    }
    // Notion may recycle an outer response root. Rescan only after the retained
    // block detached; the mutation preprocessor migrates its selector pre-paint.
    const block = immutableCommandBlock(item);
    const blockId = block && safeRead(() => block.getAttribute("data-block-id"), null);
    // Plain JSON can be a semantic message with no Notion code-block ID.
    const rowId = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null);
    const current = blockId || (rowId ? "row:" + rowId : "");
    if (block) _immutableItemBlock.set(item, block);
    if (current && current !== cached) _immutableItemKey.set(item, current);
    return current;
  }
  function ensureImmutableStyle() {
    if (_immutableStyle && safeRead(() => _immutableStyle.isConnected, false)) return _immutableStyle;
    const style = document.createElement("style");
    style.id = "zs-notion-immutable-cards";
    // The stylesheet itself is extension-owned too. If core has not mounted its
    // isolated root yet, defer rather than attaching anything to Notion's tree.
    const host = safeRead(() => document.getElementById("rs-root"), null);
    if (!host) return null;
    try { host.appendChild(style); } catch { return null; }
    _immutableStyle = style;
    _immutableCssomFailed = false;
    // A recreated #rs-root gives us a new CSSStyleSheet. Reinsert each retained
    // card once; subsequent phase/timer updates remain O(1).
    for (const [key, card] of _immutableCards) {
      card.sheet = null; card.rules = null;
      _immutableDirty.add(key);
    }
    return style;
  }
  async function collectExportHistory(capture) {
    const route=routeKey(), items=allItems();
    if(!items.length)return;
    let scroller=safeRead(() => items[0].parentElement, null);
    while(scroller && scroller!==document.body){
      const css=safeStyle(scroller);
      if(/auto|scroll/.test(css.overflowY) && safeRead(() => scroller.scrollHeight, 0)>safeRead(() => scroller.clientHeight, 0)+20)break;
      scroller=safeRead(() => scroller.parentElement, null);
    }
    if(!scroller||scroller===document.body)scroller=document.scrollingElement;
    if(!scroller)return;
    const original=safeRead(() => scroller.scrollTop, 0),deadline=Date.now()+3000;let quiet=0,lastCount=-1;
    try{
      while(Date.now()<deadline && route===routeKey()){
        scroller.scrollTop=Math.max(0,safeRead(() => scroller.scrollTop, 0)-Math.max(200,safeRead(() => scroller.clientHeight, 0)*.8));
        await sleep(180);invalidateItems();const count=capture().length;
        quiet=safeRead(() => scroller.scrollTop, 0)===0 && count===lastCount?quiet+1:0;lastCount=count;
        if(quiet>=3)break;
      }
    }finally{if(route===routeKey())scroller.scrollTop=original;}
  }
  function renderReadyAcknowledgement(item) {
    if (!item) return;
    const row = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null);
    const key = row ? "row:" + row : immutableKey(item);
    const root = safeRead(() => document.getElementById("rs-root"), null);
    if (!key || !root) return;
    const selector = immutableSelector(key);
    const style = document.createElement("style");
    style.textContent = selector + '{font-size:0!important}' + selector + '>*{display:none!important}' + selector + '::after{content:"Elio is ready to assist you.";display:block;font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif;color:inherit}';
    root.appendChild(style);
  }
  function immutableVisual(card) {
    const icon = card.phase === "run" ? "⏳" : card.phase === "err" ? "⚠" : card.phase === "idle" ? "○" : "✓";
    const detail = card.detail ? ` · ${card.detail}` : "";
    const color = card.phase === "err" ? "#ef8b8b" : card.phase === "run" ? "#8fa7ff" : card.phase === "idle" ? "#a8a8b0" : "#6fd0a7";
    return { color, label: cssText(`${icon} ${card.label || "command"}${detail}`) };
  }
  function immutableSelector(key) {
    return key.startsWith("row:")
      ? `[data-agent-service-scroll-anchor="${cssAttr(key.slice(4))}"]`
      : key.startsWith("bubble:") ? `[data-elio-notion-card="${cssAttr(key.slice(7))}"]`
      : `[data-block-id="${cssAttr(key)}"]`;
  }
  function immutableRuleText(key, card) {
    const sel = immutableSelector(key);
    const { color, label } = immutableVisual(card);
    return `${sel}{font-size:0!important;color:transparent!important;min-height:58px!important;` +
      `display:block!important;height:auto!important;box-sizing:border-box!important;padding:8px 0!important;border:0!important;` +
      `border-radius:0!important;background:transparent!important}` +
      `${sel}>*{display:none!important}` +
      `${sel}::before{content:"${label}";display:block!important;font:600 13px/22px ui-sans-serif,-apple-system,"Segoe UI",sans-serif!important;` +
      `box-sizing:border-box!important;padding:9px 12px!important;border:1px solid color-mix(in srgb,${color} 38%,transparent)!important;border-radius:10px!important;background:color-mix(in srgb,${color} 8%,transparent)!important;` +
      `letter-spacing:.1px!important;color:${color}!important;white-space:normal!important;text-align:left!important;overflow-wrap:anywhere!important}`;
  }
  function insertImmutableRules(style, key, card) {
    const sheet = style && style.sheet;
    if (!sheet || typeof sheet.insertRule !== "function") return false;
    const sel = immutableSelector(key);
    try {
      let i = sheet.cssRules.length;
      sheet.insertRule(`${sel}{font-size:0!important;color:transparent!important;min-height:58px!important;display:block!important;height:auto!important;box-sizing:border-box!important;padding:8px 0!important;border:0!important;border-radius:0!important;background:transparent!important}`, i);
      const hostRule = sheet.cssRules[i];
      i = sheet.cssRules.length;
      sheet.insertRule(`${sel}>*{display:none!important}`, i);
      i = sheet.cssRules.length;
      sheet.insertRule(`${sel}::before{display:block!important;box-sizing:border-box!important;padding:9px 12px!important;border-radius:10px!important;font:600 13px/22px ui-sans-serif,-apple-system,"Segoe UI",sans-serif!important;letter-spacing:.1px!important;white-space:normal!important;text-align:left!important;overflow-wrap:anywhere!important}`, i);
      card.sheet = sheet;
      card.rules = { host: hostRule, before: sheet.cssRules[i] };
      return true;
    } catch {
      card.sheet = null; card.rules = null;
      return false;
    }
  }
  function updateImmutableRule(style, key, card) {
    const sheet = style && style.sheet;
    if (!sheet) return false;
    if (card.sheet !== sheet || !card.rules) {
      if (!insertImmutableRules(style, key, card)) return false;
    }
    const { color, label } = immutableVisual(card);
    try {
      const hs = card.rules.host.style, bs = card.rules.before.style;
      bs.setProperty("border", `1px solid color-mix(in srgb,${color} 38%,transparent)`, "important");
      bs.setProperty("background", `color-mix(in srgb,${color} 8%,transparent)`, "important");
      bs.setProperty("content", `"${label}"`, "important");
      bs.setProperty("color", color, "important");
      return true;
    } catch { return false; }
  }
  function rebuildImmutableFallback(style) {
    _immutableCssomFailed = true;
    style.textContent = [..._immutableCards].map(([key, card]) => immutableRuleText(key, card)).join("\n");
    for (const card of _immutableCards.values()) { card.sheet = null; card.rules = null; }
  }
  function flushImmutableStyles() {
    if (_immutableStyleTimer) clearTimeout(_immutableStyleTimer);
    _immutableStyleTimer = 0;
    const style = ensureImmutableStyle();
    if (!style) return;
    if (_immutableCssomFailed) { rebuildImmutableFallback(style); _immutableDirty.clear(); return; }
    const dirty = [..._immutableDirty];
    _immutableDirty.clear();
    for (const key of dirty) {
      const card = _immutableCards.get(key);
      if (card && !updateImmutableRule(style, key, card)) {
        rebuildImmutableFallback(style);
        _immutableDirty.clear();
        return;
      }
    }
  }
  function markImmutableStyle(key, immediate) {
    if (key) _immutableDirty.add(key);
    if (immediate) { flushImmutableStyles(); return; }
    if (_immutableStyleTimer) return;
    _immutableStyleTimer = setTimeout(flushImmutableStyles, 350);
  }
  function compactImmutableStyles() {
    if (_immutableCompactTimer) clearTimeout(_immutableCompactTimer);
    _immutableCompactTimer = 0;
    const style = ensureImmutableStyle();
    if (!style) return;
    // Removal/key migration is uncommon. Rebuild once after the streaming DOM
    // settles; keeping stale selectors briefly is harmless and avoids a frame in
    // which the old rules are gone before the replacement block's rules exist.
    try {
      const sheet = style.sheet;
      if (sheet && typeof sheet.deleteRule === "function") {
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) sheet.deleteRule(i);
      } else style.textContent = "";
    } catch { style.textContent = ""; }
    _immutableCssomFailed = false;
    for (const [key, card] of _immutableCards) {
      card.sheet = null; card.rules = null;
      _immutableDirty.add(key);
    }
    flushImmutableStyles();
  }
  function scheduleImmutableCompaction(delay = 1400) {
    if (_immutableCompactTimer) clearTimeout(_immutableCompactTimer);
    _immutableCompactTimer = setTimeout(compactImmutableStyles, delay);
  }
  // React can recycle an outer response element for ANOTHER turn. DOM identity,
  // tool name and recency do not identify a message. Bind cards to the thread and
  // semantic row; block-only layouts additionally need the preceding user turn.
  const _immutableBoundaryIds = new WeakMap();
  let _immutableBoundarySeq = 0;
  function immutableTurnIdentity(item) {
    const chat = conversationKey() || location.pathname || "";
    const row = safeClosest(item, AGENT_ROW_SEL);
    const anchor = row && safeRead(() => row.getAttribute("data-agent-service-scroll-anchor"), "");
    const user = isUserItem(item);
    if (anchor) return { chat, anchor, user, boundary: "", command: "" };
    let boundary = "";
    let items = allItems();
    let index = items.indexOf(item);
    if (index < 0) { items = collectItems(); index = items.indexOf(item); }
    for (let i = index - 1; i >= 0; i--) {
      if (!isUserItem(items[i])) continue;
      const previous = items[i];
      const block = safeQuery(previous, "[data-block-id]");
      boundary = safeRead(() => previous.getAttribute("data-agent-service-scroll-anchor"), "") ||
        (block && safeRead(() => block.getAttribute("data-block-id"), "")) || "";
      if (!boundary) {
        if (!_immutableBoundaryIds.has(previous)) _immutableBoundaryIds.set(previous, "node:" + (++_immutableBoundarySeq));
        boundary = _immutableBoundaryIds.get(previous);
      }
      break;
    }
    const block = immutableCommandBlock(item);
    const command = safeRead(() => (block || item).textContent, "").slice(0, 256).trim();
    return { chat, anchor: "", user, boundary, command };
  }
  function immutableSameTurn(card, item, key) {
    if (!card || !card.identity) return false;
    const before = card.identity, after = immutableTurnIdentity(item);
    if (before.chat !== after.chat || before.user !== after.user) return false;
    if (before.anchor || after.anchor) return !!before.anchor && before.anchor === after.anchor;
    // Stable block IDs survive ordinary remounts. A fresh ID needs evidence of
    // the same user boundary AND command; ambiguous orphan spinners stay put.
    if (before.boundary !== after.boundary) return false;
    const sameCommand = !!before.command && !!after.command &&
      (before.command.startsWith(after.command) || after.command.startsWith(before.command));
    if (card.key === key) return !key.startsWith("bubble:") || sameCommand;
    return !!before.boundary && sameCommand;
  }
  function forgetImmutableItem(item, card) {
    // Remove only extension-owned references/attributes, never transcript content.
    if (card && card.key.startsWith("bubble:") && safeRead(() => item.getAttribute("data-elio-notion-card"), "") === card.key.slice(7)) {
      try { item.removeAttribute("data-elio-notion-card"); } catch {}
    }
    _immutableItemCard.delete(item);
    _immutableItemKey.delete(item);
    _immutableItemBlock.delete(item);
    if (card && card.item === item) card.item = null;
  }
  function migrateImmutableCard(item, card, key) {
    if (!card || !key || !immutableSameTurn(card, item, key)) return null;
    if (card.key === key) return refreshImmutableCardRef(item, card);
    const oldKey = card.key;
    if (oldKey) _immutableCards.delete(oldKey);
    card.key = key;
    card.item = item;
    card.block = _immutableItemBlock.get(item) || card.block || null;
    card.sheet = null;
    card.rules = null;
    card.missingAt = 0;
    card.cleared = false;
    _immutableCards.set(key, card);
    _immutableItemCard.set(item, card);
    // Insert the replacement selector synchronously, BEFORE stale selectors are
    // compacted. MutationObservers run before paint, so a Notion block-ID swap
    // never exposes the raw JSON for one sweep/frame.
    markImmutableStyle(key, true);
    scheduleImmutableCompaction();
    return card;
  }
  function renderImmutableChip(item, opts = {}) {
    let key = immutableKey(item);
    if (opts.whole && safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null)) {
      key = "row:" + safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null);
      _immutableItemKey.set(item, key);
    }
    if (opts.whole && isUserItem(item) && !key.startsWith("row:")) {
      // Attribute-only ownership leaves React's locked child tree untouched.
      // Mask the entire result, including text/code spread over several blocks.
      let id = safeRead(() => item.getAttribute("data-elio-notion-card"), null);
      if (!id) {
        id = Date.now().toString(36) + "-" + String(++_immutableBubbleSeq);
        try { item.setAttribute("data-elio-notion-card", id); } catch { return; }
      }
      key = "bubble:" + id; _immutableItemKey.set(item, key);
    }
    if (!key) return;
    let byItem = _immutableItemCard.get(item) || null;
    if (byItem && (byItem.cleared || (safeRead(() => item.isConnected, false) && !immutableSameTurn(byItem, item, key)))) byItem = null;
    // The core may still hold the old response node when Notion has already
    // remounted it. Never migrate an active card BACK to a disconnected block.
    if (byItem && !safeRead(() => item.isConnected, false) && byItem.key) key = byItem.key;
    if (byItem && byItem.key && byItem.key !== key && safeRead(() => item.isConnected, false)) {
      byItem = migrateImmutableCard(item, byItem, key);
    }
    let prev = _immutableCards.get(key) || byItem || null;
    if (prev && safeRead(() => item.isConnected, false) && !immutableSameTurn(prev, item, key)) prev = null;
    // A full response-root remount can assign a fresh block ID. Recover only
    // a verified same-turn card, including its final outcome; never select an
    // orphan merely because it is recent or runs the same tool.
    if (!prev && safeRead(() => item.isConnected, false)) {
      const wanted = opts.label || "";
      const orphan = [..._immutableCards.values()].reverse().find((card) =>
        card && immutableSameTurn(card, item, key) &&
        card.item && !safeRead(() => card.item.isConnected, false) &&
        (card.owned || Date.now() - (card.updatedAt || 0) < 15000) &&
        (!wanted || !card.label || card.label === wanted || card.label === "command"));
      if (orphan) prev = byItem = migrateImmutableCard(item, orphan, key);
    }
    prev = prev || {};
    // A turn executes once. React may replay an earlier running decoration
    // after completion; retain the final outcome for this same command key.
    const staleRunning = prev.owned && /^(done|err)$/.test(prev.phase || "") &&
      /^(run|idle)$/.test(opts.phase || "");
    if (staleRunning) opts = { ...opts, phase: prev.phase, detail: prev.detail, label: prev.label };
    const liveItem = safeRead(() => item.isConnected, false) ? item : (prev.item || item);
    const liveBlock = safeRead(() => item.isConnected, false)
      ? (_immutableItemBlock.get(item) || prev.block || null)
      : (prev.block || _immutableItemBlock.get(item) || null);
    const next = {
      key,
      identity: prev.identity || immutableTurnIdentity(liveItem),
      label: opts.label || prev.label || "command",
      detail: opts.detail != null ? opts.detail : (prev.detail || ""),
      phase: opts.phase || prev.phase || "idle",
      owned: opts.owned != null ? !!opts.owned : !!prev.owned,
      item: liveItem,
      block: liveBlock,
      sheet: prev.sheet || null,
      rules: prev.rules || null,
      missingAt: 0,
      missingSignatureAt: 0,
      cleared: false,
      updatedAt: Date.now(),
    };
    const changed = prev.label !== next.label || prev.detail !== next.detail ||
      prev.phase !== next.phase || prev.owned !== next.owned;
    _immutableCards.set(key, next);
    _immutableItemCard.set(item, next);
    if (liveItem && liveItem !== item) _immutableItemCard.set(liveItem, next);
    if (changed || !_immutableStyle || !safeRead(() => _immutableStyle.isConnected, false)) markImmutableStyle(key, true);
  }
  function refreshImmutableCardRef(item, card) {
    if (!card || !item) return card;
    card.item = item;
    card.block = _immutableItemBlock.get(item) || card.block || null;
    _immutableItemCard.set(item, card);
    return card;
  }
  function immutableCardFor(item, key) {
    if (!item || !key) return null;
    let card = _immutableCards.get(key) || _immutableItemCard.get(item) || null;
    if (card && card.cleared) return null;
    if (card && !safeRead(() => item.isConnected, false)) return card;
    if (card && !immutableSameTurn(card, item, key)) return null;
    if (card && card.key && card.key !== key) card = migrateImmutableCard(item, card, key);
    return refreshImmutableCardRef(item, card);
  }
  function updateImmutableChipDetail(item, detail) {
    const key = immutableKey(item), card = immutableCardFor(item, key);
    // The growth-tolerant generation signal can remain true briefly after a tool
    // settles; never let that meter overwrite a final done/error summary.
    if (!card || card.phase === "done" || card.phase === "err" || card.detail === detail) return;
    card.detail = detail || ""; markImmutableStyle(card.key || key, false);
  }
  function updateImmutableChipLabel(item, label) {
    const key = immutableKey(item), card = immutableCardFor(item, key);
    if (!card || card.phase === "done" || card.phase === "err" || !label || card.label === label) return;
    card.label = label; markImmutableStyle(card.key || key, true);
  }
  function immutableChipOwned(item) {
    const key = immutableKey(item), card = immutableCardFor(item, key);
    return !!(card && card.owned);
  }
  function clearImmutableChip(item, options = {}) {
    const key = immutableKey(item);
    const card = immutableCardFor(item, key);
    if (!card) return;
    if (options.force) {
      if (key.startsWith("bubble:")) {
        try { item.removeAttribute("data-elio-notion-card"); } catch {}
        _immutableItemKey.delete(item);
      }
      card.cleared = true;
      _immutableCards.delete(card.key || key);
      _immutableItemCard.delete(item);
      scheduleImmutableCompaction();
      return;
    }
    const now = Date.now();
    const currentStreaming = item === lastAssistant() && (stopButton() || grewWithin(9000));
    // Notion temporarily empties/rebuilds a large code block while syntax
    // highlighting lands. A single empty read must not remove its stylesheet and
    // expose raw JSON; retain until generation is genuinely quiet for a grace.
    if (card.owned || ((card.phase === "run" || card.phase === "idle") && currentStreaming)) {
      if (!card.missingSignatureAt) card.missingSignatureAt = now;
      if (card.owned || stopButton() || now - card.missingSignatureAt < 6000) return;
    }
    card.cleared = true;
    _immutableCards.delete(card.key || key);
    _immutableItemCard.delete(item);
    scheduleImmutableCompaction();
  }
  function syncImmutableChips() {
    let changed = false;
    const now = Date.now();
    for (const [key, card] of [..._immutableCards]) {
      // Each card already knows its exact host block. A document-wide selector
      // per historical command made cleanup O(cards × page size) every sweep.
      if (key.startsWith("row:") || key.startsWith("bubble:")) {
        const row = key.startsWith("bubble:") && safeRead(() => card.item.isConnected, false)
          ? card.item : safeQuery(document, immutableSelector(key));
        if (row && immutableSameTurn(card, row, key)) { card.item = row; _immutableItemCard.set(row, card); _immutableItemKey.set(row, key); card.missingAt = 0; continue; }
        if (row && key.startsWith("bubble:")) forgetImmutableItem(row, card);
      }
      const block = card && card.block;
      const exists = !!(block && safeRead(() => block.isConnected, false) &&
        safeRead(() => block.getAttribute, null) && safeRead(() => block.getAttribute("data-block-id"), null) === key);
      if (exists) { card.missingAt = 0; continue; }
      // If the outer response survived but Notion replaced its code block, migrate
      // synchronously and retain the card's phase/ownership under the new ID.
      const item = card && card.item;
      if (item && safeRead(() => item.isConnected, false)) {
        const replacement = immutableCommandBlock(item);
        const replacementKey = replacement && safeRead(() => replacement.getAttribute("data-block-id"), null);
        if (replacementKey && immutableSameTurn(card, item, replacementKey)) {
          _immutableItemBlock.set(item, replacement);
          _immutableItemKey.set(item, replacementKey);
          card.block = replacement;
          card.missingAt = 0;
          _immutableItemCard.set(item, card);
          if (replacementKey !== key) migrateImmutableCard(item, card, replacementKey);
          continue;
        }
      }
      if (!card.missingAt) card.missingAt = now;
      // A response/root swap can span several animation frames. Keep its stable
      // selector so a same-ID remount remains masked before the next sweep reowns
      // it; only compact truly absent cards after a quiet grace.
      if (now - card.missingAt < (card.owned ? 15000 : 5000)) continue;
      if (card) card.cleared = true;
      _immutableCards.delete(key);
      changed = true;
    }
    if (changed) scheduleImmutableCompaction();
  }
  const FAST_TOOL_SIGNATURE_RE = /["'](?:command|tool)["']\s*:\s*["']|###\s*(?:LUA|LUAU|MCP_TOOL)\s*###|<tool_call>/i;
  function preprocessMutations(records, state = {}) {
    if (!records || !records.length || !isChatPath()) return;
    const roots = new Set();
    const transcriptSel = `${BLOCK_RESPONSE_ROOT_SEL}, ${AGENT_ROW_SEL}`;
    const addNode = (node) => {
      if (!node || safeRead(() => node.nodeType, 0) !== 1) return;
      try {
        if (safeRead(() => node.matches, null) && safeRead(() => node.matches(transcriptSel), false)) roots.add(node);
        const closest = safeRead(() => node.closest, null) && safeClosest(node, transcriptSel);
        if (closest) roots.add(closest);
        if (safeRead(() => node.querySelectorAll, null)) {
          for (const root of safeQueryAll(node, transcriptSel)) roots.add(root);
        }
      } catch {}
    };
    for (const r of records) {
      addNode(r.target && (safeRead(() => r.target.nodeType, 0) === 1 ? r.target : safeRead(() => r.target.parentElement, null)));
      for (const node of r.addedNodes || []) addNode(node);
    }
    for (const item of roots) {
      if (!item || !safeRead(() => item.isConnected, false) || safeClosest(item, "#rs-root")) continue;
      const remembered = _immutableItemCard.get(item);
      let existing = remembered && !remembered.cleared ? remembered : null;
      if (existing && !immutableSameTurn(existing, item, immutableKey(item))) {
        forgetImmutableItem(item, existing); existing = null;
      }
      // Normal token churn inside the same block needs no work: its CSS selector
      // is already active. Only a block/root replacement needs synchronous rekey.
      if (existing && existing.block && safeRead(() => existing.block.isConnected, false) && safeRead(() => item.contains(existing.block), false) &&
          safeRead(() => existing.block.getAttribute("data-block-id"), null) === existing.key) continue;
      if (existing) {
        renderImmutableChip(item, {});
        continue;
      }
      if (!state.active || !isAssistantItem(item)) continue; // never mask user examples
      const text = transcriptText(item);
      if (!FAST_TOOL_SIGNATURE_RE.test(text)) continue;
      const match = text.match(/["'](?:command|tool)["']\s*:\s*["']([^"']+)/i);
      renderImmutableChip(item, {
        label: match && match[1] || "command",
        detail: "processing",
        phase: "run",
        owned: false,
      });
    }
  }

  let _chatListCache = null, _chatListAt = 0, _chatListRoute = "";
  function chatList() {
    if (!isAiSurface()) return null;
    const route = routeKey();
    if (route !== _chatListRoute) {
      _chatListRoute = route; _chatListCache = null; _chatListAt = 0;
    }
    const raw = rawAgentRows();
    if (raw.length) {
      // Find the nearest scrolling ancestor of a real row. This is used only for
      // positioning/fallback; allItems reads the semantic rows directly.
      for (let n = safeRead(() => raw[0].parentElement, null); n && n !== document.body; n = safeRead(() => n.parentElement, null)) {
        try {
          const st = safeStyle(n);
          if (/auto|scroll/.test(st.overflowY)) return n;
        } catch {}
      }
      return safeRead(() => raw[0].parentElement, null);
    }
    const e = findEditorRaw();
    if (e) {
      for (let n = safeRead(() => e.parentElement, null); n && n !== document.body; n = safeRead(() => n.parentElement, null)) {
        try {
          const st = safeStyle(n);
          if (/auto|scroll/.test(st.overflowY) && safeRead(() => n.children, []).length) return n;
        } catch {}
      }
      return safeClosest(e, '[role="main"], [role="region"], main, form') || safeRead(() => e.parentElement, null);
    }
    // Legacy fallback, throttled and capped. Never runs outside /ai or /chat.
    const now = Date.now();
    if (_chatListCache && now - _chatListAt < 1500) return _chatListCache;
    _chatListAt = now;
    let found = null, scanned = 0;
    for (const n of safeQueryAll(document, "div")) {
      if (++scanned > 300) break;
      try {
        const st = safeStyle(n);
        if (!/auto|scroll/.test(st.overflowY) || !safeRead(() => n.children, []).length) continue;
        if (safeQuery(n, "[data-message-role], [data-testid*='message' i]")) { found = n; break; }
      } catch {}
    }
    _chatListCache = found;
    return found;
  }
  let _itemsMode = "none";
  function collectItems() {
    if (!isAiSurface()) { _itemsMode = "none"; return []; }
    const raw = rawAgentRows();
    if (raw.length) { _itemsMode = "agent"; return agentMessageRows(raw); }
    // New full-page threads include block-editor replies and plain user bubbles.
    // Keep explicit transcript structures; Send controls are never message rows.
    if (isChatPath()) { _itemsMode = "block"; return blockTranscriptItems(); }
    // /ai is the explicit new-chat landing page. Its suggestion/recent-chat
    // cards are not transcript turns and must never make the blank-chat gate fail.
    if (isAiLanding()) { _itemsMode = "landing"; return []; }
    _itemsMode = "legacy";
    const list = chatList();
    if (!list) return [];
    const rows = [...safeQueryAll(list, "[data-message-role], [data-testid*='message' i]")];
    if (rows.length) return rows.filter((r) => !safeClosest(r, "#rs-root"));
    // Last-resort legacy layout: direct children, excluding the composer.
    const ed = findEditorRaw();
    return [...safeRead(() => list.children, [])].filter((c) =>
      !safeClosest(c, "#rs-root") && !(ed && safeRead(() => c.contains(ed), false)) && (_txt(c) || safeQuery(c, "pre, code")));
  }
  // Core asks for counts, the last turn, generation state and sweep items through
  // separate calls—often in the same tick. The transcript NODE LIST changes only
  // when top-level turns mount/unmount; live token text remains readable through
  // retained element references. A 700ms time-only cache still rescanned a deep
  // idle chat ~1.4 times/second from the meter. Keep it until a semantic turn
  // mutation invalidates it, with a 15s safety refresh for unknown DOM variants.
  let _itemsCache = [], _itemsAt = 0, _itemsRoute = "", _itemsDirty = true;
  const ITEMS_CACHE_MS = 15000;
  function allItems() {
    if (!isAiSurface()) return [];
    const route = routeKey(), now = Date.now();
    if (route !== _itemsRoute) _itemsDirty = true;
    const connected = _itemsCache.length === 0 || _itemsCache.every((item) => item && safeRead(() => item.isConnected, false));
    if (!_itemsDirty && route === _itemsRoute && connected && now - _itemsAt < (_itemsCache.length ? ITEMS_CACHE_MS : 500)) return _itemsCache;
    _itemsRoute = route;
    _itemsAt = now;
    _itemsDirty = false;
    _itemsCache = collectItems();
    return _itemsCache;
  }
  function ignoreMutationRecords(records) {
    if (!records || !records.length) return false;
    const ed = _editorCache && safeRead(() => _editorCache.isConnected, false) ? _editorCache : null;
    const frame = _frameCache && safeRead(() => _frameCache.isConnected, false) ? _frameCache : null;
    if (!ed && !frame) return false;
    const transcriptSel = `${AGENT_ROW_SEL}, ${BLOCK_RESPONSE_ROOT_SEL}`;
    return records.every((r) => {
      const target = r.target && (safeRead(() => r.target.nodeType, 0) === 1 ? r.target : safeRead(() => r.target.parentElement, null));
      if (!target) return false;
      try {
        // Never suppress a real turn mount or stream mutation even if a future
        // Notion layout places the composer and transcript under one small frame.
        if (safeRead(() => target.closest, null) && safeClosest(target, transcriptSel)) return false;
        for (const node of [...(r.addedNodes || []), ...(r.removedNodes || [])]) {
          if (safeRead(() => node.nodeType, 0) === 1 &&
              ((safeRead(() => node.matches, null) && safeRead(() => node.matches(transcriptSel), false)) ||
               (safeRead(() => node.querySelector, null) && safeQuery(node, transcriptSel)))) return false;
        }
      } catch {}
      return !!((ed && (target === ed || safeRead(() => ed.contains(target), false))) ||
        (frame && (target === frame || safeRead(() => frame.contains(target), false))));
    });
  }
  function invalidateItems(records) {
    if (!records || !records.length) { _itemsDirty = true; return; }
    const semantic = (node) => {
      if (!node || (safeRead(() => node.nodeType, 0) !== 1 && safeRead(() => node.nodeType, 0) !== 11)) return false;
      try {
        return (safeRead(() => node.matches, null) && safeRead(() => node.matches(`${AGENT_ROW_SEL}, ${BLOCK_RESPONSE_ROOT_SEL}`), false)) ||
          !!(safeRead(() => node.querySelector, null) && safeQuery(node, `${AGENT_ROW_SEL}, ${BLOCK_RESPONSE_ROOT_SEL}`));
      } catch { return false; }
    };
    for (const r of records) {
      if ([...(r.addedNodes || []), ...(r.removedNodes || [])].some(semantic)) {
        _itemsDirty = true; return;
      }
      const target = r.target && (safeRead(() => r.target.nodeType, 0) === 1 ? r.target : safeRead(() => r.target.parentElement, null));
      if (!target || (safeRead(() => target.closest, null) && safeClosest(target, "#rs-root"))) continue;
      let root = null;
      try { root = safeRead(() => target.closest, null) && safeClosest(target, `${AGENT_ROW_SEL}, ${BLOCK_RESPONSE_ROOT_SEL}`); } catch {}
      // A blank response shell is omitted until its first text/block appears.
      // Its child mutation must invalidate until that root joins the cached list;
      // ordinary streaming inside an already-known root does not change the list.
      if (root && !_itemsCache.includes(root)) { _itemsDirty = true; return; }
      // Only the obsolete no-semantic-rows fallback needs broad invalidation.
      if (_itemsMode === "legacy") { _itemsDirty = true; return; }
    }
  }
  function isUserItem(item) {
    if (!item) return false;
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(AGENT_ROW_SEL), false)) return rowAlign(item) === "flex-end";
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(BLOCK_RESPONSE_ROOT_SEL), false)) return hasEndAlignedAncestor(item);
    if (_blockUserItems.has(item)) return true;
    const role = safeRead(() => item.getAttribute, null) && (safeRead(() => item.getAttribute("data-message-role"), null) ||
      safeRead(() => item.getAttribute("data-role"), null) || "");
    if (role) return /user|human/i.test(role);
    const t = _txt(item);
    if (!t) return false;
    if (safeQuery(item, "[aria-label]")) {
      const aff = [...safeQueryAll(item, "[aria-label]")].some((b) => AI_AFFORD_RE.test(ariaOf(b)));
      if (aff) return false;
    }
    if (AI_MARK_RE.test(t.slice(0, 160))) return false;
    return true;
  }
  function isAssistantItem(item) {
    if (!item) return false;
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(AGENT_ROW_SEL), false)) return rowAlign(item) === "flex-start";
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(BLOCK_RESPONSE_ROOT_SEL), false)) return !hasEndAlignedAncestor(item);
    if (_blockUserItems.has(item)) return false;
    return !isUserItem(item);
  }
  let _roleItemsRef = null, _assistantItemsCache = [], _userItemsCache = [];
  function roleItems() {
    const items = allItems();
    if (items !== _roleItemsRef) {
      _roleItemsRef = items;
      _assistantItemsCache = items.filter(isAssistantItem);
      _userItemsCache = items.filter(isUserItem);
    }
    return { assistants: _assistantItemsCache, users: _userItemsCache };
  }
  const assistantItems = () => roleItems().assistants;
  const assistantCount = () => roleItems().assistants.length;
  const userCount = () => roleItems().users.length;
  const lastAssistant = () => {
    const it = roleItems().assistants;
    return it.length ? it[it.length - 1] : null;
  };
  const _idMap = new WeakMap();
  let _idSeq = 0;
  function lastAssistantId() {
    const it = lastAssistant();
    if (!it) return null;
    const stable = safeRead(() => it.getAttribute, null) && safeRead(() => it.getAttribute("data-agent-service-scroll-anchor"), null);
    if (stable) return stable;
    const block = safeRead(() => it.querySelector, null) && safeQuery(it, "[data-block-id]");
    const blockId = block && safeRead(() => block.getAttribute("data-block-id"), null);
    if (blockId) return `block:${blockId}`;
    let id = _idMap.get(it);
    if (!id) { id = ++_idSeq; _idMap.set(it, id); }
    return id;
  }

  // Unlike mutable providers, Notion never receives a .zs-chip or masking class
  // inside its locked transcript. Native textContent is therefore the exact raw
  // assistant text and is much cheaper than recursively walking every text node.
  // A response-watcher iteration asks for the same current text through generation,
  // read, identity, snapshot and meter paths in one task. Reading a very large
  // script from the DOM each time is costly, so share it for this microtask only;
  // the cache expires before any later DOM mutation/timer can be observed.
  const _transcriptTextCache = new WeakMap();
  let _textReadEpoch = 1, _textEpochQueued = false;
  function transcriptText(item) {
    if (!item) return "";
    const cached = _transcriptTextCache.get(item);
    if (cached && cached.epoch === _textReadEpoch) return cached.text;
    // Preserve native block boundaries without layout-dependent innerText.
    // Inline spans must remain contiguous; pre/code text must remain byte-faithful.
    const codeBlocks=[];
    function read(node, inPre=false) {
      try {
      if(node.nodeType===3)return node.nodeValue||'';
      if(node.nodeType!==1)return '';
      if(node.matches?.('.rs-chip,.rs-memory-receipt,[data-elio-ui],script,style'))return '';
      const tag=node.tagName.toLowerCase();if(tag==='br')return '\n';
      if(tag==='img' && node.classList.contains('notion-emoji'))return node.getAttribute('alt')||'';
      if(tag==='pre'){const index=codeBlocks.push(node.textContent||'')-1;return '\n\uE000ELIO_PRE_'+index+'\uE001\n';}
      const block=/^(?:p|div|section|article|h[1-6]|ul|ol|li|blockquote|tr|table)$/.test(tag)||node.classList?.contains('notion-selectable');
      let value='';for(const child of node.childNodes)value+=read(child,inPre||tag==='code');
      if(tag==='td'||tag==='th')value+='\t';
      return block&&!inPre ? '\n'+value+'\n' : value;
      } catch { return ''; }
    }
    const text=read(item).replace(/\n{3,}/g,'\n\n').trim().replace(/\uE000ELIO_PRE_(\d+)\uE001/g,(_,i)=>codeBlocks[Number(i)]||'');
    _transcriptTextCache.set(item, { epoch: _textReadEpoch, text });
    if (!_textEpochQueued) {
      _textEpochQueued = true;
      const clear = () => { _textEpochQueued = false; _textReadEpoch++; };
      if (typeof queueMicrotask === "function") queueMicrotask(clear);
      else Promise.resolve().then(clear);
    }
    return text;
  }
  const itemText = (item) => transcriptText(item);
  const classifyText = (item, _excludeSel) => transcriptText(item);
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: transcriptText(item).trim(), thinking: "", item };
  }
  function streamText(item) {
    const it = item === undefined ? lastAssistant() : item;
    return transcriptText(it);
  }
  const streamLen = (item) => streamText(item).length;
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
  function snapshot() {
    try {
      const it = lastAssistant();
      return { th: 0, rp: it ? (safeRead(() => it.textContent, "") || "").length : 0 };
    } catch { return {}; }
  }

  // ── generation state ─────────────────────────────────────────────────────
  let _stopSince = 0;
  function genActive() {
    sampleStream();
    const stop = !!stopButton();
    const now = Date.now();
    if (stop) {
      if (!_stopSince) _stopSince = now;
      // Trust a continuously present stop button for 5 min (long planning),
      // same policy as the Arena provider after v2.2.5.
      return (now - _stopSince < 300000) || (now - _streamAt < 300000);
    }
    _stopSince = 0;
    return grewWithin(9000);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  function startupReplySettled() {
    sampleStream();
    if (stopButton() || activeWorkflowProgress(lastAssistant())) return false;
    const reply = streamText(lastAssistant());
    if (Date.now() - _streamAt < 1500) return false;
    if (typeof RSParse === "undefined" || RSParse.hasOpenToolBlock(reply)) return !genActive();
    // This hook is used only after startup parsed and ran the closed tool call.
    return RSParse.parseToolCalls(reply).length > 0 || !genActive();
  }
  const isHardGenerating = () => !!stopButton();

  // Notion renders active agent/tool work in a separate centered status row
  // (not in the assistant response root). allItems intentionally excludes those
  // rows, so core used to see a closed get_game_tree JSON block that had stopped
  // growing, miss the still-live workflow row, and click Stop after four seconds
  // with the misleading "left it processing" recovery. Surface that native
  // progress separately: it postpones only no-progress recovery clocks and never
  // changes normal response settlement or any Studio/MCP deadline.
  const ACTIVE_WORKFLOW_KEY_RE = /^(?:running-placeholder|working|thinking|processing|tool-running|tool-call-running)(?::|$)/i;
  const ACTIVE_WORKFLOW_TEXT_RE = /\b(?:thinking|working|processing|running|searching|reading|writing|creating|building|editing|checking|executing|generating|using (?:a |the )?tool)\b/i;
  let _workflowProbeAt = 0, _workflowProbeItem = null, _workflowProbeValue = false;
  function activeWorkflowProgress(item) {
    if (!isAiSurface()) return false;
    const now = Date.now();
    if (item === _workflowProbeItem && now - _workflowProbeAt < 350) return _workflowProbeValue;
    _workflowProbeAt = now; _workflowProbeItem = item; _workflowProbeValue = false;
    const rows = rawAgentRows();
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - 10); i--) {
      const row = rows[i];
      if (!row || !safeRead(() => row.isConnected, false) || safeClosest(row, "#rs-root")) continue;
      const key = (safeRead(() => row.getAttribute("data-agent-service-scroll-anchor"), null) || "").toLowerCase();
      const align = rowAlign(row);
      if ((align === "flex-start" || align === "flex-end") && !ACTIVE_WORKFLOW_KEY_RE.test(key)) break;
      const statusRow = align !== "flex-start" && align !== "flex-end";
      const text = _txt(row).slice(0, 500);
      if ((ACTIVE_WORKFLOW_KEY_RE.test(key) || (statusRow && ACTIVE_WORKFLOW_TEXT_RE.test(text))) && visible(row)) {
        _workflowProbeValue = true; return true;
      }
    }
    // Current full-page block-editor layout has no agent-service anchors. Honor
    // only explicit busy/progress semantics inside the current response itself;
    // never infer activity from a generic spinner elsewhere on a Notion page.
    try {
      for (const el of item ? safeQueryAll(item, "[aria-busy='true'], [role='progressbar'], [data-state='loading'], " +
        "[data-testid*='progress' i], [data-testid*='loading' i], [data-testid*='thinking' i]") : []) {
        if (!safeClosest(el, "#rs-root") && visible(el)) {
          _workflowProbeValue = true; return true;
        }
      }
    } catch {}
    return false;
  }

  // Notion's short recoveries are useful for ordinary dead turns, but a
  // requested Figma/UI build can legitimately deliberate longer before its
  // first visible command token. Protect only that current human request (or an
  // already-visible Figma companion command); injected elio result/recovery
  // turns are skipped so they cannot accidentally broaden the exemption. Core
  // applies this to both the ordinary 45-second no-progress path and the separate
  // four-second closed-command thinking-tail path.
  function suppressThinkingWatchdog(_item, reply) {
    if (/"(?:command|tool)"\s*:\s*"web_figma_(?:apply|export|handoff)"/i.test(String(reply || ""))) {
      return true;
    }
    const users = roleItems().users;
    for (let i = users.length - 1; i >= 0; i--) {
      const text = transcriptText(users[i]).trim();
      if (!text) continue;
      if ((typeof ZSParse !== "undefined" && ZSParse.isInjectedFeedback(text)) ||
          text.includes(RS.SYS_MARKER) || /^\(System .* from elio\b/i.test(text)) continue;
      if (RS.isLongUiRequest && RS.isLongUiRequest(text)) return true;
      // A manual "continue" after a provider interruption is still the same UI
      // task. Only walk past an exact short continuation; any substantive newer
      // request owns its own watchdog decision and cannot inherit the exemption.
      if (RS.isShortContinuation && RS.isShortContinuation(text)) continue;
      return false;
    }
    return false;
  }

  const FINAL_TURN_ACTION_RE = /regenerate|retry response|good response|bad response|thumbs?\s*(?:up|down)|helpful|erneut generieren|neu generieren|antwort erneut|gute antwort|schlechte antwort|hilfreich|daumen|r[ée]g[ée]n[ée]rer|bonne r[ée]ponse|mauvaise r[ée]ponse|regenerar|buena respuesta|mala respuesta|resposta boa|resposta ruim|再生成|重新生成|有帮助|有幫助|다시 생성|좋은 답변|나쁜 답변/i;
  // Scan labelled controls in this response only. The old English-only selector
  // discarded otherwise valid Helpful controls and localized completion actions.
  const FINAL_TURN_ACTION_SEL = "button[aria-label], button[title], [role='button'][aria-label], [role='button'][title]";
  const _finalActionCache = new WeakMap();
  function hasFinalTurnAction(item) {
    if (!item) return false;
    const now = Date.now(), cached = _finalActionCache.get(item);
    if (cached && now - cached.at < 500) return safeRead(() => cached.value, "");
    let value = false;
    // Only trust controls inside this response root. A parent can contain every
    // historical response, where an older Regenerate button would be a dangerous
    // false completion signal for the current still-streaming turn.
    for (let n = item, depth = 0; n && depth < 1; n = safeRead(() => n.parentElement, null), depth++) {
      try {
        for (const el of safeQueryAll(n, FINAL_TURN_ACTION_SEL)) {
          const label = `${ariaOf(el)} ${safeRead(() => el.title, "") || ""}`;
          if (FINAL_TURN_ACTION_RE.test(label) && visible(el)) { value = true; break; }
        }
      } catch {}
      if (value) break;
    }
    _finalActionCache.set(item, { at: now, value });
    return value;
  }
  // Notion's growth-tolerant signal deliberately remains true for nine seconds
  // after its last token because the native Stop control can briefly remount. For
  // a CLOSED command (core separately rejects open/incomplete command blocks),
  // no native Stop plus several seconds of unchanged text is enough to end that
  // residual tail safely. A final-only Regenerate/feedback action is even stronger
  // and also safely settles plain prose. This removes ~4-8 seconds from tool turns
  // without shortening a live command or touching Studio's actual tool timeout.
  function softGenerationSettled(item, reply, idleMs) {
    if (!item || stopButton() || activeWorkflowProgress(item)) return false;
    const readyAcknowledgement = /^(?:ELIO_READY|Elio is ready to assist you|elio is ready|elio ist bereit)[.!]?$/i.test(String(reply || "").replace(/[`*#]/g, "").trim());
    const finalAction = idleMs >= 500 && hasFinalTurnAction(item);
    // A closed, append-only command cannot grow internally after its top-level
    // close token. Plain prose can legitimately continue after a long network
    // pause, so it only gets the accelerated path when Notion exposes a response-
    // final action; otherwise preserve the original nine-second growth window.
    if (!readyAcknowledgement && !finalAction && !FAST_TOOL_SIGNATURE_RE.test(String(reply || ""))) return false;
    const threshold = readyAcknowledgement ? 700 : finalAction ? 700 : 4500;
    if (idleMs < threshold) return false;
    _streamAt = 0;
    _stopSince = 0;
    return true;
  }

  const activityFoldRules = new Map();
  let activityFoldStyle;
  function setActivityFolded(item, folded) {
    const row = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null), key = row ? "row:" + row : immutableKey(item);
    if (!key) return;
    const selector = immutableSelector(key);
    if (activityFoldRules.has(selector) === folded) return;
    if (folded) activityFoldRules.set(selector, true); else activityFoldRules.delete(selector);
    if (!activityFoldStyle || !safeRead(() => activityFoldStyle.isConnected, false)) { activityFoldStyle=document.createElement("style");document.documentElement.appendChild(activityFoldStyle); }
    activityFoldStyle.textContent=[...activityFoldRules.keys()].map(selector => selector + selector + '{height:0!important;max-height:0!important;min-height:0!important;padding:0!important;border:0!important;overflow:hidden!important;opacity:0!important}').join("\n");
  }
  function mountActivitySummary(item, node) {
    const row = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null);
    const key = row ? "row:" + row : immutableKey(item);
    if (!key) return null;
    const selector = immutableSelector(key), target = safeQuery(document, selector);
    if (!target) return null;
    const style = document.createElement("style"), nativeMargin = parseFloat(safeStyle(target).marginTop) || 0;
    document.documentElement.append(style, node);
    node.classList.add("rs-chat-activity-external");
    let height = -1, frame = 0;
    const place = () => {
      if (!safeRead(() => node.isConnected, false)) return;
      const live = safeQuery(document, selector);
      if (!live) { node.hidden = true;return; }
      node.hidden = false;
      const rect = safeRect(live);
      node.style.width = Math.max(160, rect.width) + "px";
      const nextHeight = Math.ceil(safeRect(node).height) + 8;
      if (height !== nextHeight) { height = nextHeight;style.textContent = selector + '{margin-top:' + (nativeMargin + height) + 'px!important}'; }
      const updated = safeRect(live);
      node.style.left = updated.left + "px";node.style.top = (updated.top - height) + "px";
      node.style.visibility = updated.bottom < 0 || updated.top - height > innerHeight ? "hidden" : "visible";
    };
    const schedule = () => { cancelAnimationFrame(frame);frame=requestAnimationFrame(place); };
    window.addEventListener("scroll",schedule,true);window.addEventListener("resize",schedule);
    return {place,dispose(){cancelAnimationFrame(frame);window.removeEventListener("scroll",schedule,true);window.removeEventListener("resize",schedule);style.remove();node.remove();}};
  }

  // ── input lock (same semantics as Arena) ─────────────────────────────────
  let _lockWanted = false, _lockTimer = null, _selfWrite = false;
  let _chunkAppendRejected = false;
  const _lockedEditors = new Set();
  const LOCK_PLACEHOLDER = "⏳ Agent working… please wait";
  const MISSING_ATTR = "__zs_missing__";
  function saveAttrOnce(ed, attr, store) {
    if (safeRead(() => ed.hasAttribute(store), false)) return;
    ed.setAttribute(store, safeRead(() => ed.hasAttribute(attr), false) ? (safeRead(() => ed.getAttribute(attr), null) || "") : MISSING_ATTR);
  }
  function restoreAttr(ed, attr, store) {
    if (!safeRead(() => ed.hasAttribute(store), false)) return;
    const v = safeRead(() => ed.getAttribute(store), null);
    if (v === MISSING_ATTR) ed.removeAttribute(attr); else ed.setAttribute(attr, v || "");
    ed.removeAttribute(store);
  }
  function applyLockAttrs(ed) {
    if (!ed) return;
    if (isTextControl(ed)) {
      _lockedEditors.add(ed);
      saveAttrOnce(ed, "aria-disabled", "data-zs-lock-ad");
      if (!safeRead(() => ed.hasAttribute("data-zs-lock-ro"), false)) ed.setAttribute("data-zs-lock-ro", safeRead(() => ed.readOnly, true) ? "1" : "0");
      saveAttrOnce(ed, "placeholder", "data-zs-lock-ph");
      ed.readOnly = true;
      ed.setAttribute("placeholder", LOCK_PLACEHOLDER);
      ed.setAttribute("aria-disabled", "true");
    }
    // The rich editor is React-owned. The cover and trusted-event capture below
    // guard it without mutating its placeholder, editability, or readonly state.
  }
  const lockDrifted = (ed) => !!ed && isTextControl(ed) && !safeRead(() => ed.readOnly, true);
  function enforceLock() {
    if (!_lockWanted) return;
    const ed = findEditorRaw();
    if (lockDrifted(ed)) applyLockAttrs(ed);
  }
  const LOCK_NAV = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Escape"];
  function onLockedInput(e) {
    if (!_lockWanted || _selfWrite || !e.isTrusted) return;
    const ed = findEditorRaw();
    if (!ed) return;
    const t = e.target;
    const control = t && safeRead(() => t.closest, null) && safeClosest(t, CONTROL_SEL);
    const sendClick = e.type === "click" && control && safeRead(() => composerFrame()?.contains(control), false) && sendControlLike(control) && !stopControlLike(control);
    if (!sendClick && !(t === ed || (t && safeRead(() => t.nodeType, 0) === 1 && safeRead(() => ed.contains(t), false)))) return;
    if (e.type === "keydown") {
      const k = e.key || "";
      if (LOCK_NAV.indexOf(k) !== -1) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const lk = k.toLowerCase();
        if (lk === "c" || lk === "a") return;
      }
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  try {
    document.addEventListener("click", onLockedInput, true);
    document.addEventListener("paste", onLockedInput, true);
    document.addEventListener("drop", onLockedInput, true);
    document.addEventListener("keydown", onLockedInput, true);
    document.addEventListener("beforeinput", onLockedInput, true);
  } catch {}
  function setInputLock(on) {
    _lockWanted = !!on;
    const ed = findEditorRaw();
    if (on) {
      applyLockAttrs(ed);
      if (!_lockTimer) _lockTimer = setInterval(enforceLock, 250);
      return;
    }
    if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; }
    // Restore every editor we touched, including hidden/detached React nodes.
    // A reused node must not inherit a lock from a failed or cancelled startup.
    if (ed) _lockedEditors.add(ed);
    for (const locked of _lockedEditors) {
      try {
        if (isTextControl(locked)) {
          const ro = safeRead(() => locked.getAttribute("data-zs-lock-ro"), null);
          if (ro != null) locked.readOnly = ro === "1";
          locked.removeAttribute("data-zs-lock-ro");
          restoreAttr(locked, "placeholder", "data-zs-lock-ph");
        } else {
          restoreAttr(locked, "contenteditable", "data-zs-lock-ce");
          restoreAttr(locked, "data-placeholder", "data-zs-lock-dp");
          restoreAttr(locked, "aria-readonly", "data-zs-lock-ar");
        }
        restoreAttr(locked, "aria-disabled", "data-zs-lock-ad");
        locked.classList.remove("zs-typing");
      } catch {}
    }
    _lockedEditors.clear();
  }

  // ── typing + sending ─────────────────────────────────────────────────────
  function setRichText(el, v) {
    // Support both controlled native textareas and Notion's live rich-text DIV.
    // Native controls need their prototype value setter so React sees the edit.
    if (isTextControl(el)) {
      el.focus();
      const wasReadOnly = !!safeRead(() => el.readOnly, true);
      if (wasReadOnly) el.readOnly = false;
      _selfWrite = true;
      try {
        const proto = safeRead(() => el.tagName, "") === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        try {
          const I = window.InputEvent || null;
          el.dispatchEvent(I
            ? new I("input", { bubbles: true, inputType: "insertText", data: v })
            : new window.Event("input", { bubbles: true }));
        } catch { try { el.dispatchEvent(new window.Event("input", { bubbles: true })); } catch {} }
      } finally {
        _selfWrite = false;
        if (wasReadOnly) el.readOnly = true;
      }
      return "input";
    }
    // Chromium's native edit emits its own input event. Do not dispatch a
    // second model transaction or replace the DOM owned by Notion/React.
    if (safeRead(() => el.getAttribute("contenteditable"), null) === "false") return "rejected";
    el.focus();
    _selfWrite = true;
    try {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges(); selection.addRange(range);
      return document.execCommand("insertText", false, v) ? "insertText" : "rejected";
    } catch { return "rejected"; }
    finally { _selfWrite = false; }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A large native insert can block the page for many seconds (a live Windows
  // trace: 38,089 characters froze the tab for 17 s) and Notion then renders the
  // new blocks over the following moments. Two fixed 140 ms looks therefore saw a
  // partially rendered draft (37,362 of 38,089 characters) and rejected a write
  // that was still landing. Poll until the complete draft is visible twice in a
  // row, and give up only when the text has stopped changing for a size-scaled
  // window or the overall budget is spent. Never succeeds on a changed draft.
  async function writeRichTextVerified(el, value) {
    const route = safeRead(() => window.location.href, "");
    const started = Date.now();
    const intendedProfile = draftProfile(value);
    // An editor that refuses the native edit gets the original short look; only an
    // accepted insert earns the size-scaled settle window.
    const accepted = setRichText(el, value) !== "rejected";
    const budgetMs = accepted ? Math.min(25000, 1500 + Math.ceil(value.length / 3)) : 700;
    const stableMs = accepted ? Math.min(4000, 500 + Math.ceil(value.length / 12)) : 280;
    let retained = false, matches = 0, polls = 0, lastLen = -1, lastChangeAt = Date.now(), finalChars = 0;
    try {
      while (Date.now() - started < budgetMs) {
        await sleep(140);
        polls++;
        if (isStopped() || safeRead(() => window.location.href, "") !== route) break;
        const live = findEditorRaw();
        const text = safeRead(() => live && live.isConnected, false) ? edText(live) : "";
        finalChars = text.length;
        if (text.length !== lastLen) { lastLen = text.length; lastChangeAt = Date.now(); }
        if (text && draftLooksWritten(text, value, intendedProfile)) {
          if (++matches >= 2) { retained = true; break; }
          continue;
        }
        matches = 0;
        // Stopped growing and still wrong: a changed/truncated draft, not a slow render.
        if (Date.now() - lastChangeAt >= stableMs) break;
      }
    } catch {}
    const info = { retained, expectedChars: value.length, retainedChars: finalChars || edText(el).length,
      polls, ms: Date.now() - started };
    if (!retained) {
      // Show WHERE Notion's read-back first differs so a rewritten character is
      // identifiable from a single debug report.
      try {
        const a = intendedProfile.compact, b = draftProfile(edText(findEditorRaw() || el)).compact;
        let i = 0; while (i < a.length && a[i] === b[i]) i++;
        info.firstDiff = i; info.want = a.slice(Math.max(0, i - 12), i + 12); info.got = b.slice(Math.max(0, i - 12), i + 12);
      } catch {}
    }
    diag("notion.write.native", info);
    return retained;
  }
  // True only for an editor that is empty or holds a strict prefix of the draft we
  // just wrote (the composer was empty and locked before the write), in which case
  // clearing it destroys nothing the user typed. Anything else is left untouched.
  async function clearOwnedPartialDraft(text) {
    let ed = findEditorRaw();
    if (!ed) return false;
    const current = edText(ed);
    if (!current.trim()) return true;
    const have = draftProfile(current).compact, want = draftProfile(text).compact;
    // 1.24.10: Notion can also rewrite our Markdown-like startup lines into
    // blocks; a draft recognisably transformed from this exact text is ours too.
    if ((!have || !want.startsWith(have)) && !ownTransformedDraft(current, text) && !ownPartialDraft(current, text)) return false;
    for (let attempt = 0; attempt < 3 && !isStopped(); attempt++) {
      ed = findEditorRaw();
      if (!ed) return false;
      setRichText(ed, "");
      if (edText(ed).trim()) {
        _selfWrite = true;
        try {
          const sel = window.getSelection(), range = document.createRange();
          range.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(range);
          document.execCommand("delete");
        } catch {} finally { _selfWrite = false; }
      }
      if (await waitFor(() => { const e = findEditorRaw(); return !!e && !edText(e).trim(); }, 2000)) {
        diag("notion.write.partialCleared", { chars: current.length });
        return true;
      }
    }
    return false;
  }
  function literalPasteHtml(value) {
    const escaped = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return '<pre><code>' + escaped + '</code></pre>';
  }
  async function pasteRichText(el, value, literal = true, append = false, expected = value, delay = 200, settle = 0) {
    const route=safeRead(() => window.location.href, "");
    // Let the controlled editor's paste handler update its document model.
    // DOM-only writes can be reverted by the next Notion React render.
    if (!window.DataTransfer || !window.ClipboardEvent) return false;
    el.focus();
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(el);
    if(append)range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
    const data = new window.DataTransfer();
    data.setData("text/plain", value);
    // HTML text avoids Notion treating tool output as Markdown and consuming
    // literal markers. Retention checks still reject any changed/truncated draft.
    if (literal) data.setData("text/html", literalPasteHtml(value));
    _selfWrite = true;
    try {
      const event = new window.ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: data,
      });
      // Firefox constructs its own native transfer instead of using the
      // supplied one. Populate that interface; isolated-world expandos cannot
      // carry clipboard data reliably to the page's editor handler.
      const transfer = safeRead(() => event.clipboardData, null);
      if (!transfer) return false;
      if (safeRead(() => transfer.getData("text/plain"), "") !== value) {
        transfer.setData("text/plain", value);
        if (literal) transfer.setData("text/html", literalPasteHtml(value));
      }
      if (safeRead(() => transfer.getData("text/plain"), "") !== value) return false;
      el.dispatchEvent(event);
    } catch { return false; }
    finally { _selfWrite = false; }
    // Check after renders, not just synchronously after the DOM changes.
    let accepted = false;
    if (settle > 0) {
      // Slow editors apply a paste late (a loaded Notion tab can take seconds to
      // reconcile). Poll until the complete expected text is visible on two
      // consecutive reads, up to the settle budget, instead of two fixed checks.
      const until = Date.now() + settle;
      let hits = 0;
      while (Date.now() < until && !isStopped()) {
        await sleep(delay);
        const live = findEditorRaw();
        if (safeRead(() => window.location.href, "") !== route) break;
        hits = !!safeRead(() => live.isConnected, false) && draftLooksWritten(edText(live), expected) ? hits + 1 : 0;
        if (hits >= 2) { accepted = true; break; }
      }
    } else {
      await sleep(delay);
      const current=findEditorRaw();
      const first=!!safeRead(() => current.isConnected,false) && draftLooksWritten(edText(current),expected);
      await sleep(delay);
      const live=findEditorRaw();
      accepted=!!first && !isStopped() && safeRead(() => window.location.href, "")===route && !!safeRead(() => live.isConnected,false) && draftLooksWritten(edText(live),expected);
    }
    diag(accepted ? "notion.write.pasteAccepted" : "notion.write.pasteRejected", {
      expectedChars: value.length, retainedChars: edText(el).length, connected: safeRead(() => el.isConnected, false),
      sameEditor: findEditorRaw() === el, literal,
      expectedTotalChars: expected.length,
      compactMatch: draftProfile(edText(el)).compact === draftProfile(expected).compact,
    });
    return accepted;
  }
  async function pasteRichTextChunked(el,value,deadline=Date.now()+12000){
    let offset=0,prefix='';
    const route=safeRead(() => window.location.href,'');
    while(offset<value.length){
      const live=findEditorRaw();
      if(live!==el){if(!safeRead(() => live.isConnected,false)||!draftLooksWritten(edText(live),prefix))return false;el=live;}
      if(isStopped()||safeRead(() => window.location.href,'')!==route||!safeRead(() => el.isConnected, false)||Date.now()>=deadline)return false;
      let end=Math.min(value.length,offset+600),lines=0;
      for(let at=offset;at<end;at++)if(value[at]==='\n'&&++lines>=12){end=at+1;break;}
      if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
      const chunk=value.slice(offset,end),before=prefix;prefix+=chunk;
      let ok=await pasteRichText(el,chunk,true,offset>0,prefix,40,3000);
      if(!ok&&!isStopped()&&Date.now()<deadline){
        // A paste Notion ignored leaves the editor exactly at the previous prefix.
        // Re-send that one chunk once; any other state (late/partial/changed) is not
        // retried, so text can never be appended twice.
        const cur=findEditorRaw();
        if(cur&&safeRead(() => cur.isConnected,false)&&(offset===0?!edText(cur).trim():draftProfile(edText(cur)).compact===draftProfile(before).compact)){
          diag('notion.write.pasteRetry',{offset,chunkChars:chunk.length});
          el=cur;ok=await pasteRichText(el,chunk,true,offset>0,prefix,40,3000);
        }
      }
      if(!ok){
        // Remember that this editor ignored an appended chunk: later startup
        // sends in this tab go straight to the protocol file instead of waiting.
        if(offset>0)_chunkAppendRejected=true;
        const actual=edText(el);if(actual&&draftLooksWritten(actual,prefix))setRichText(el,'');
        diag('notion.write.smallPasteRejected',{offset,chars:value.length,retainedChars:edText(el).length});return false;
      }
      offset=end;
    }
    diag('notion.write.smallPasteAccepted',{chars:value.length});return draftLooksWritten(edText(el),value);
  }
  async function setRichTextChunked(el, value, chunkSize) {
    const deadline = Date.now() + 5000;
    const first = Math.min(48, chunkSize);
    const chunks = [value.slice(0, first)];
    for (let i = first; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
    let prefix = "", accepted = "";
    for (let i = 0; i < chunks.length; i++) {
      if (!safeRead(() => el.isConnected, false) || isStopped() || Date.now() >= deadline) break;
      el.focus();
      // React can move the selection while reconciling a rich-text leaf.
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(el);
      if (i > 0) range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
      _selfWrite = true;
      let ok = false;
      try { ok = document.execCommand("insertText", false, chunks[i]); } catch {}
      finally { _selfWrite = false; }
      prefix += chunks[i];
      await sleep(i === 0 || i === chunks.length - 1 ? 160 : 35);
      if (!ok || !draftLooksWritten(edText(el), prefix)) {
        diag("notion.write.chunkRejected", { index: i, total: chunks.length, chunkSize,
          insertedChars: prefix.length, retainedChars: edText(el).length, connected: safeRead(() => el.isConnected, false) });
        const remaining = edText(el);
        if (safeRead(() => el.isConnected, false) && remaining &&
            (draftLooksWritten(remaining, prefix) || (accepted && draftLooksWritten(remaining, accepted)))) {
          setRichText(el, "");
        }
        return "chunkRejected";
      }
      accepted = prefix;
    }
    return prefix.length === value.length ? "chunkedInsertText" : "chunkRejected";
  }
  async function waitFor(pred, timeout) {
    const budget = waitBudget(timeout, 100), t0 = Date.now();
    for (let poll = 0; poll < budget.polls && Date.now() - t0 < budget.ms; poll++) {
      const result = safePredicate(pred);
      if (result) return true;
      await sleep(100);
    }
    return safePredicate(pred);
  }
  function sendReady() {
    if (!isAiSurface()) return false;
    const ed = findEditorRaw();
    if (!ed) return false;
    if (sendButton()) return true;
    // Mounted-but-disabled controls must settle before a commit. Do not bypass
    // them with Enter or mistake an old hidden control for the live send button.
    if (controlsIn(composerFrame()).some(b => sendControlLike(b) || stopControlLike(b))) return false;
    return isTextControl(ed) && edText(ed).trim() !== "";
  }
  function normalizedDraft(text) {
    return String(text || "")
      .replace(/[\u200B-\u200D\u2060\uFEFF\uFE0E\uFE0F]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      // Notion's composer smart-quotes a typed quote (live Oct 2026: the final
      // `."` of the startup digest read back as `.”`). Fold typographic quotes so
      // that representation-only change never reads as a corrupted draft.
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
  function draftProfile(text) {
    const raw = String(text || "");
    const normalized = normalizedDraft(raw);
    return { raw, normalized, compact: normalized.replace(/\s+/g, "") };
  }
  // Markdown-insensitive compact form: Notion renders/inserts list markers,
  // emphasis and code marks as formatting, so those characters can vanish.
  const looseCompact = (text) => String(text || "").replace(/[\s\u200B-\u200D\u2060\uFEFF*_`#>~|\\-]/g, "");
  // True when `actual` is recognisably the extension's own write of `intended`
  // with only formatting characters consumed: same opening, an in-order
  // subsequence of the intended text, few foreign characters and most content.
  function ownTransformedDraft(actual, intended) {
    const a = looseCompact(actual), i = looseCompact(intended);
    if (a.length < 16 || i.length < 16 || a.slice(0, 16) !== i.slice(0, 16)) return false;
    let at = 0, extra = 0;
    for (const ch of a) {
      const hit = i.indexOf(ch, at);
      if (hit < 0 || hit - at > 64) { if (++extra > Math.max(8, a.length / 100)) return false; continue; }
      at = hit + 1;
    }
    return a.length >= i.length * 0.6;
  }
  // 1.24.11: a chunked startup paste can stop part-way (Notion accepted the
  // first chunks, then ignored an append). What remains is the opening of our
  // own locked draft, possibly reformatted; it is ours to clear.
  function ownPartialDraft(actual, intended) {
    const a = looseCompact(actual), i = looseCompact(intended);
    if (a.length < 16 || i.length < 16) return false;
    if (i.startsWith(a)) return true;
    const head = String(intended || "").slice(0, String(actual || "").length + 200);
    return ownTransformedDraft(actual, head);
  }
  function receiptMatchesSend(receiptText, sentText) {
    if (receiptText === sentText || (sentText.length >= 32 && receiptText.includes(sentText))) return true;
    // Notion shows each line as its own block (textContent has no separator)
    // and renders Markdown, so compare without whitespace/formatting marks.
    const r = looseCompact(receiptText), s = looseCompact(sentText);
    if (s.length < 16) return false;
    if (r === s || (s.length >= 32 && r.includes(s))) return true;
    // Long messages can be collapsed in the bubble; a matching opening of a new
    // row is enough (old rows are excluded by their pre-send receipt keys).
    return s.length >= 400 && r.length >= 160 && s.startsWith(r.slice(0, 160)) && r.startsWith(s.slice(0, 160));
  }
  // 1.24.12: Notion's composer turns Markdown line markers and **bold** into
  // formatting (live: the startup message stalled in the chat box because the
  // read-back lost "- " and "**"). Only for the locked, extension-owned startup
  // draft, accept a read-back that differs from the intended text solely by
  // those representation changes. Words, identifiers and order must match.
  const notionMarkupCompact = (text, intended) => normalizedDraft(intended
    ? String(text || "").split(/\r\n?|\n/).map(line => line.replace(/^\s*(?:[-*+•]|\d{1,3}[.)]|#{1,6}|>|\[[ xX]?\])\s+/, "")).join("\n")
    : text).replace(/\*\*/g, "").replace(/\s+/g, "");
  function formattedDraftMatches(actual, intended) {
    const i = notionMarkupCompact(intended, true);
    return i.length >= 16 && notionMarkupCompact(actual, false) === i;
  }
  function draftLooksWritten(actual, intended, intendedProfile, actualProfile) {
    const a = String(actual || ""), i = String(intended || "");
    if (a === i) return true;
    if (draftLooksWritten.tolerantText != null && i === draftLooksWritten.tolerantText && formattedDraftMatches(a, i)) return true;
    if (!i) return !a;
    const ap = actualProfile || draftProfile(a);
    const ip = intendedProfile || draftProfile(i);
    const an = ap.normalized, inn = ip.normalized;
    if (an === inn) return true;
    // Notion's rich editor can represent a newline as a block boundary while
    // textContent exposes NO separator at that boundary (`caption:\n{json}` reads
    // back as `caption:{json}`). This is especially important for short tool
    // results: the previous length-tolerance applied only at 256+ characters, so
    // a perfectly visible result was classified as "not typed", Send was never
    // clicked, and the draft remained in the user's composer. During this check
    // the composer is locked and the text is extension-owned, so equality after
    // removing representation-only whitespace is a safe proof of a complete write.
    const compactActual = ap.compact;
    const compactIntended = ip.compact;
    if (compactIntended && compactActual === compactIntended) return true;
    return false;
  }
  // Draft-only path for explicit user-clicked composer helpers. This deliberately
  // does not mark the text as an injected tool-result draft, click Send, dispatch
  // Enter, or alter attachments. The exact pre-write value is a compare-and-set
  // guard against erasing text typed after the menu first read the composer.
  function writeDraft(value, expectedCurrent) {
    if (!isAiSurface()) return { ok: false, reason: "wrong-surface" };
    const editor = getEditor();
    if (!editor || !safeRead(() => editor.isConnected, false)) return { ok: false, reason: "composer-unavailable" };
    const before = edText(editor);
    if (before !== String(expectedCurrent == null ? "" : expectedCurrent)) {
      return { ok: false, reason: "draft-changed" };
    }
    const intended = String(value == null ? "" : value);
    setRichText(editor, intended);
    const live = safeRead(() => editor.isConnected, false) ? editor : findEditorRaw();
    const after = edText(live);
    if (draftLooksWritten(after, intended)) return { ok: true, reason: "" };
    if (live && safeRead(() => live.isConnected, false)) setRichText(live, before);
    return { ok: false, reason: "write-not-verified" };
  }
  // After the complete write was verified once, the eight-second Send-enable
  // wait only needs to notice React discarding/replacing that owned draft. Avoid
  // repeatedly normalizing and compacting a 50k+ script every 100ms while the
  // blue arrow enables; length plus edge/interior samples catch hydration rewrites.
  function draftStillPresent(editor, written) {
    if (!editor || !safeRead(() => editor.isConnected, false)) return false;
    const current = edText(editor);
    if (!current) return false;
    if (current === written) return true;
    const tolerance = Math.max(12, Math.ceil(written.length * 0.02));
    if (Math.abs(current.length - written.length) > tolerance) return false;
    const edge = Math.min(96, written.length, current.length);
    if (current.slice(0, edge) !== written.slice(0, edge) ||
        current.slice(-edge) !== written.slice(-edge)) return false;
    // Sample the interior too, so an equal-length React rewrite cannot silently
    // corrupt the middle while preserving both ends.
    for (const fraction of [0.25, 0.5, 0.75]) {
      const at = Math.max(0, Math.floor((written.length - edge) * fraction));
      if (current.slice(at, at + edge) !== written.slice(at, at + edge)) return false;
    }
    return true;
  }

  const PENDING_DRAFT_KEY = "zs:notion:pending-injected-draft:v1";
  function draftHash(text) {
    let h = 2166136261;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i); h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }
  function readPendingDraft() {
    try {
      const v = JSON.parse(sessionStorage.getItem(PENDING_DRAFT_KEY) || "null");
      return v && typeof v.at === "number" ? v : null;
    } catch { return null; }
  }
  function markPendingDraft(text) {
    const s = String(text || "");
    try { sessionStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({
      at: Date.now(), len: s.length, hash: draftHash(s), prefix: s.slice(0, 80),
    })); } catch {}
  }
  function clearPendingDraft() {
    try { sessionStorage.removeItem(PENDING_DRAFT_KEY); } catch {}
  }
  function markerMatchesDraft(marker, text) {
    const s = String(text || "");
    return !!marker && marker.len === s.length && marker.hash === draftHash(s);
  }
  // Repair an injected draft left behind by an interrupted/reloaded older build.
  // The legacy prefix is uniquely generated by runTool; normal user drafts are
  // never cleared. The marker covers every future injected message without
  // storing a 27k command catalogue in sessionStorage.
  function armStaleDraftCleanup() {
    let tries = 0;
    const armedAt = Date.now();
    const tick = () => {
      const ed = findEditorRaw();
      if (!ed) {
        if (++tries < 50) setTimeout(tick, 400);
        return;
      }
      const text = edText(ed);
      const marker = readPendingDraft();
      // Only consume a marker that predates this content-script instance. A
      // fresh marker may be written by auto-resumed startup before this lazy
      // cleanup tick runs; clearing that would erase an active send.
      const staleMarker = marker && marker.at <= armedAt ? marker : null;
      // Older builds cleared the ownership marker even when verification rejected
      // a short newline-normalized result, leaving no hash to recover on reload.
      // `Output of '<tool>':` is the extension's exact feedback envelope; clear a
      // draft beginning with it so the failure shown in v2.3.11 does not survive
      // installation of this fix. This also subsumes the old long-list special case.
      const legacyFeedback = (!marker || marker.at <= armedAt) && text.length > 24 &&
        /^Output of ['"][A-Za-z0-9_.\/-]+['"]:/i.test(text.trimStart());
      if (legacyFeedback || markerMatchesDraft(staleMarker, text)) {
        setRichText(ed, "");
        diag("notion.draft.staleCleared", { chars: text.length, legacy: legacyFeedback, path: location.pathname });
      }
      // Empty/different content means an OLD send landed or the user replaced
      // it. Never remove a marker created after this cleanup was armed.
      if (!marker || marker.at <= armedAt) clearPendingDraft();
    };
    setTimeout(tick, 0);
  }

  function dispatchEnter(el) {
    _selfWrite = true;
    try {
      const K = window.KeyboardEvent;
      const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new K("keydown", o));
      el.dispatchEvent(new K("keypress", o));
      el.dispatchEvent(new K("keyup", o));
    } finally { _selfWrite = false; }
  }
  let _lastSend = null;
  let _sendFailureAmbiguous = false;
  let _sendFailureDetail = "";
  // True only when typeAndSend gave up BEFORE its single commit click (the
  // composer was not ready, a draft write was discarded, the editor remounted).
  // Nothing reached Notion, so core may safely try that delivery once more.
  let _sendRetryable = false;
  const sendFailureDetail = () => _sendFailureDetail;
  const sendFailureAmbiguous = () => _sendFailureAmbiguous;
  const sendRetryable = () => _sendRetryable && !_sendFailureAmbiguous;
  // After the normal 15-second acknowledgement window, Notion sometimes shows
  // the submitted row (or starts replying) much later under load. When the
  // draft has already left the composer, keep watching this much longer
  // before calling the commit ambiguous. Never clicks Send again.
  const LATE_CONFIRM_MS = 30000;
  async function waitLateConfirm(ms) {
    const until = Date.now() + ms;
    if (_lastSend) _lastSend.confirmUntil = Math.max(_lastSend.confirmUntil, until + 1000);
    for (let remaining = Math.ceil(ms / 250); remaining > 0 && Date.now() < until; remaining--) {
      if (isStopped()) return false;
      if (sendLanded()) return true;
      await sleep(250);
    }
    return sendLanded();
  }
  function userReceipts() {
    // Read semantic rows directly: a virtualizer can reuse both the row count
    // and a DOM node while changing its event key and message text.
    const rows = rawAgentRows();
    return (rows.length ? rows.filter(isUserItem) : roleItems().users).map((row) => {
      let identity = safeRead(() => row.getAttribute("data-agent-service-scroll-anchor"), null) || safeRead(() => row.getAttribute("data-block-id"), null);
      if (!identity) {
        identity = _idMap.get(row);
        if (!identity) { identity = ++_idSeq; _idMap.set(row, identity); }
      }
      const text = normalizedDraft(transcriptText(row));
      return { key: JSON.stringify([identity, text]), text };
    });
  }
  function sendLanded() {
    if (!_lastSend || Date.now() > _lastSend.confirmUntil) return false;
    // The first message turns Notion's /ai landing page into /chat. The old
    // textarea can disappear before the replacement mounts, so route change is
    // definitive proof of acceptance even while no editor exists for a moment.
    if (_lastSend.route !== routeKey() && isAiThread()) return true;
    const receipts = userReceipts();
    if (receipts.some((receipt) => !_lastSend.receipts.has(receipt.key) && receiptMatchesSend(receipt.text, _lastSend.text))) return true;
    // Virtualized transcripts need not increase their user-row count. Like the
    // other chat providers, recognize a consumed draft and a new reply/Stop
    // state. A disappearing editor or a hydration-cleared draft alone is not
    // proof: keep those sends ambiguous and never submit the same turn twice.
    const ed = findEditorRaw();
    if (ed && !edText(ed).trim()) {
      const freshReply = lastAssistantId() !== _lastSend.assistantId && !!lastAssistant();
      if ((!_lastSend.generating && isHardGenerating()) || freshReply) return true;
    }
    return false;
  }
  async function typeAndSend(text, images, options = {}) {
    const outer = draftLooksWritten.tolerantText == null;
    try { return await typeAndSendOnce(text, images, options); }
    finally { if (outer) draftLooksWritten.tolerantText = null; }
  }
  async function typeAndSendOnce(text, images, options = {}) {
    _sendFailureAmbiguous = false;
    _sendFailureDetail = "";
    _sendRetryable = false;
    if (!isAiSurface()) {
      diag("notion.tas.blockedRoute", { path: location.pathname });
      return false;
    }
    // A healthy controlled editor can retain a native edit without the upload
    // and indexing delay of a file. Verify it across renders before committing.
    // Clipboard pastes still use the exact file fallback for large payloads.
    const initialEditor = findEditorRaw();
    let verifiedNativeEditor = null;
    if (!options.protocolFile && initialEditor && !isTextControl(initialEditor) &&
        (text.length > 2500 || text.split("\n").length > 60)) {
      if (hasPendingAttachment() && !_ownedAttachment) {
        _sendFailureDetail = "Notion already has draft attachments. Open a fresh Notion AI chat or remove those draft attachments, then Start again. elio kept them unchanged.";
        diag("notion.protocol.foreignAttachments", {}); return false;
      }
      if (isStopped()) return false;
      const startupPayload = text.startsWith("⟦RS-SYS⟧") || /^Output of ['"][A-Za-z0-9_.\/-]+['"]:/.test(text);
      if (startupPayload && _lockWanted && !hasPendingAttachment() && !edText(initialEditor) &&
          !(Array.isArray(images) && images.length) && text.length <= 131072) {
        // Only the startup handshake text, never ordinary tool results/code.
        if (text.startsWith("⟦RS-SYS⟧") || /^Output of ['"]list_commands['"]:/.test(text)) draftLooksWritten.tolerantText = text;
        if (await writeRichTextVerified(initialEditor, text)) verifiedNativeEditor = findEditorRaw();
        // Some Notion builds reject native bulk writes and never finish file
        // uploads. Use small clipboard transactions only for this locked startup
        // draft; each prefix and the complete message must survive reconciliation.
        // A leftover partial of our own write (strict prefix of this exact draft in
        // the composer that was empty before) is cleared first; anything else is kept.
        else if (!isStopped() && !_chunkAppendRejected && text.length <= 131072 && await clearOwnedPartialDraft(text) &&
                 await pasteRichTextChunked(findEditorRaw() || initialEditor, text, Date.now()+60000)) verifiedNativeEditor = findEditorRaw();
        // 1.24.11: a failed chunked paste can leave the opening of our own draft
        // behind. That partial copy blocked every later send in this chat, so
        // clear it (only when recognisably ours) and use the protocol file below.
        if (!verifiedNativeEditor && edText(findEditorRaw() || initialEditor) &&
            (isStopped() || !(await clearOwnedPartialDraft(text)))) {
          // A changed/remounted draft is not proof that our complete edit landed.
          // Preserve it rather than overwrite unknown content with a fallback.
          _sendFailureDetail = "Notion changed the message before its complete contents could be verified. No message was sent. Check the remaining draft before retrying.";
          return false;
        }
        diag("notion.start.nativeDraft", { retained: !!verifiedNativeEditor, chars: text.length });
      }
      if (!verifiedNativeEditor) {
      const resultHeader = /^(?:\[elio retained the COMPLETE result\.[^\n]*\]\s*)?(Output of ['"][^\n]+)/.exec(text);
      const resultFile = !!resultHeader;
      const name = `elio_${resultFile ? "tool_result" : "protocol"}_${Date.now()}_${++_imageSeq}.txt`;
      const files = [new File([text], name, { type: "text/plain" })];
      if (Array.isArray(images)) {
        if (images.length > 3) { _sendFailureDetail="Notion allows this protocol file with up to three screenshots in one message."; return false; }
        try { images.forEach((image,index)=>files.push(screenshotFile(image,index))); }
        catch { return false; }
      }
      // Notion occasionally ignores a staged file or leaves its upload spinner
      // running. Nothing has been submitted at that point, so retrying is safe:
      // remove only this exact elio file, pause, and stage it again,
      // alternating the file-input and composer-drop transports.
      let attached = false, attempts = 0;
      for (let attempt = 1; attempt <= PROTOCOL_ATTACH_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          if (isStopped() || !PROTOCOL_RETRYABLE.has(_lastAttachFailure)) break;
          diag("notion.protocol.retry", { attempt, reason: _lastAttachFailure, filename: name });
          removeNamedAttachments(files.map((file) => file.name));
          await sleep(PROTOCOL_RETRY_DELAYS[attempt - 2] || 10000);
          await waitFor(() => isStopped() || !hasPendingAttachment(), 4000);
          if (isStopped()) break;
          if (hasPendingAttachment()) { _lastAttachFailure = "foreign"; break; }
        }
        attempts = attempt;
        if (await attachFiles(files, { waitForText: true, preferDrop: attempt % 2 === 0 })) { attached = true; break; }
      }
      if (!attached) {
        diag("notion.protocol.attachFailed", { attempts, reason: _lastAttachFailure });
        _sendFailureDetail = `Notion did not finish the protocol file upload after ${attempts} attempt${attempts === 1 ? "" : "s"}. elio did not submit or repeat the message. Check the attachment spinner or upload error, remove the stalled elio attachment if it remains, then retry in a fresh Notion AI chat. In Edge or Brave, also verify the extension’s site access.`;
        return false;
      }
      const header = resultHeader;
      const lead = header ? header[1].slice(0,200) : (text.startsWith("⟦RS-SYS⟧") ? "⟦RS-SYS⟧" : "elio protocol message");
      // 1.24.12: describe the attachment plainly (what it is, why it is a file)
      // instead of "preserve its exact commands and instructions", which reads
      // like an injected instruction to Notion's reviewer. The first sentence is
      // unchanged because other elio code recognises it.
      const instruction = options.userPrompt
        ? `Follow-up request\nThe complete request is in the attached file ${name}. It is my own message, attached as a text file only because it is too long to paste. Please read it and continue the current task.`
        : `${lead}\nThe complete elio message is in the attached file ${name}. It was attached as a plain text file only because it is too long to paste into the chat. ${resultFile ? "It is the output of the command you requested earlier in this chat. Please read it and continue the current task using that output; do not restart it." : text.startsWith("⟦RS-SYS⟧") ? "It is my elio connection message: the available command list and my project preferences. Please read it and reply as it describes. Do not claim readiness until the enclosed startup handshake is complete." : "It is an Elio service message for the current task, not a new connection request. Read the attachment in the context of the current task; do not restart the startup handshake."}`;
      diag("notion.protocol.file", { chars:text.length, filename:name });
      const sent = await typeAndSend(instruction, null, { ...options, protocolFile:true });
      if (!sent && _ownedAttachment) clearAttachments();
      return sent;
      }
    }
    const deadline = Date.now() + 30000;
    let ownedDraft = null;
    const intendedProfile = draftProfile(text);
    const hasImages = Array.isArray(images) && images.length > 0;
    const hasAttachments = hasImages || !!options.protocolFile;
    if (hasImages && images.length > 4) {
      diag("notion.tas.tooManyImages", { count: images.length });
      return false;
    }
    const maxAttempts = Math.max(1, Number(options.attempts) || (isAiLanding() ? 6 : 3));
    const editorWaitMs = Math.max(100, Number(options.editorWaitMs) || 4000);
    const readyWaitMs = Math.max(200, Number(options.readyWaitMs) || 8000);
    const sentWaitMs = Math.max(200, Number(options.sentWaitMs) || 15000);
    const retryDelayMs = Math.max(0, options.retryDelayMs == null ? 500 : Number(options.retryDelayMs));
    for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
      // Only pre-commit retries reach this point. Space failed writes while the
      // landing editor initializes; an ambiguous commit still returns below.
      if (attempt) await sleep(Math.min(retryDelayMs * Math.pow(2, attempt - 1), 1500));
      if (isStopped()) { clearAttachments(); break; }
      let editor = findEditorRaw();
      if (!editor) {
        await waitFor(() => !!findEditorRaw(), editorWaitMs);
        editor = findEditorRaw();
      }
      if (!editor) {
        diag("notion.tas.editorMissing", { attempt, waitedMs: editorWaitMs });
        break; // repeating the same full wait cannot send without a composer
      }
      const chunkSize = [256, 48, 16][Math.min(attempt, 2)];
      let writeMethod;
      const largePaste=text.length>2500||text.split('\n').length>60;
      // Literal HTML code protects internal protocol payloads. Human follow-ups
      // use the site's ordinary plain-text paste so they are not red code pills.
      const retainedNative = verifiedNativeEditor === editor && draftLooksWritten(edText(editor), text) && !hasPendingAttachment();
      let pasted = retainedNative || (!isTextControl(editor) && await pasteRichText(editor, text, !options.userPrompt));
      if (!pasted && !largePaste && !isTextControl(editor) && Date.now() < deadline) pasted = await pasteRichText(editor, text, false);
      if (_lockWanted && safeRead(() => editor.isConnected, false)) ownedDraft = { editor, text: edText(editor) };
      if (Date.now() >= deadline) { diag("notion.tas.deadline", { attempt }); break; }
      if (pasted) {
        writeMethod = retainedNative ? "nativeVerified" : "paste";
      } else {
        if (largePaste && !isTextControl(editor)) {
          const retained = edText(editor);
          diag("notion.write.largePasteFailed", { attempt, retainedChars: retained.length, expectedChars: text.length });
          if (!retained && attempt === 0 && !isStopped()) continue;
          break;
        }
        // Repeating hundreds of tiny inserts while hydration discards every
        // draft cannot warm up the editor. Retry paste first, then retain the
        // existing insertion fallback on the final attempt.
        if (!isTextControl(editor) && isAiLanding() && !edText(editor).trim() && attempt + 1 < maxAttempts) {
          diag("notion.write.initializing", { attempt, remaining: maxAttempts - attempt - 1 });
          continue;
        }
        // A hydrated/remounted composer may replace the one that received paste.
        editor = findEditorRaw();
        if (!editor || isStopped()) continue;
        writeMethod = !isTextControl(editor) && text.length > 512 && typeof document.execCommand === "function"
          ? (await writeRichTextVerified(editor, text) ? "insertText" : "rejected") : setRichText(editor, text);
      }
      const actualDraft = edText(editor);
      if (_lockWanted && safeRead(() => editor.isConnected, false)) ownedDraft = { editor, text: actualDraft };
      const actualProfile = draftProfile(actualDraft);
      const typed = writeMethod !== "chunkRejected" && writeMethod !== "rejected" &&
        draftLooksWritten(actualDraft, text, intendedProfile, actualProfile);
      if (typed) markPendingDraft(actualDraft);
      diag("notion.tas.typed", {
        typed, attempt, tag: safeRead(() => editor.tagName, ""), writeMethod, chars: actualDraft.length,
        expectedChars: intendedProfile.raw.length,
        normalizedMatch: actualProfile.normalized === intendedProfile.normalized,
        path: location.pathname,
      });
      if (!typed) continue;
      // React occasionally discards the first programmatic draft while its new
      // /ai editor is still hydrating (live trace: 12,940 chars → 0). Retry as
      // soon as that happens rather than burning the full eight-second enable
      // window before the second, successful write.
      await waitFor(() => sendReady() || !draftStillPresent(editor, actualDraft), readyWaitMs);
      const ready = sendReady();
      if (!ready) {
        const frame = composerFrame();
        const rawSend = exactSendControl(frame) || controlsIn(frame).find(sendControlLike);
        diag("notion.tas.notReady", {
          attempt, chars: edText(editor).length, editorConnected: safeRead(() => editor.isConnected, false),
          sameEditor: findEditorRaw() === editor, sendFound: !!rawSend,
          sendTestId: rawSend && safeRead(() => rawSend.getAttribute("data-testid"), null),
          ariaDisabled: rawSend && safeRead(() => rawSend.getAttribute("aria-disabled"), null),
          tabIndex: rawSend && safeRead(() => rawSend.getAttribute("tabindex"), null), path: location.pathname,
        });
        continue;
      }
      // Attach the browser capture only after the owned text draft is ready and
      // before the one commit click. Never send screenshot feedback as text-only.
      if (hasImages) {
        if (_attachedImages === images && !hasPendingAttachment()) {
          _attachedImages = null; _ownedAttachment = null;
        }
        if (_attachedImages !== images) {
          const attached = await attachImages(images);
          diag("notion.tas.attached", { attached, count: images.length, attempt });
          if (!attached || isStopped()) { clearAttachments(); break; }
        }
        if (!safeRead(() => editor.isConnected, false) || !draftStillPresent(editor, actualDraft)) {
          // Still pre-click: reacquire/retype without staging a duplicate file.
          continue;
        }
        const uploaded = await waitFor(() => isStopped() || (!attachmentBusy() && sendReady()), 6000);
        if (!uploaded || isStopped()) { clearAttachments(); break; }
      }
      const sb = sendButton();
      if (!sb) {
        diag("notion.tas.noSendControl", { controls: controlsIn(composerFrame()).slice(0, 8).map((b) => ({
          tag: safeRead(() => b.tagName, ""), role: safeRead(() => b.getAttribute("role"), null), testid: safeRead(() => b.getAttribute("data-testid"), null),
          label: ariaOf(b).slice(0, 60), disabled: controlDisabled(b),
        })) });
      }
      const sentBudget = safeRead(() => document.hidden, true) ? Math.max(sentWaitMs, 15000) : sentWaitMs;
      _lastSend = { at: Date.now(), confirmUntil: Date.now() + sentBudget + 1000,
        route: routeKey(), users: userCount(), assistantId: lastAssistantId(),
        generating: isHardGenerating(), editor, text: normalizedDraft(text),
        receipts: new Set(userReceipts().map((receipt) => receipt.key)) };
      // From this point a site handler may accept the commit even if the DOM
      // acknowledgement is delayed/lost. Never authorize a retry unless the
      // provider later proves acceptance and returns true.
      _sendFailureAmbiguous = true;
      if (sb) {
        // Keep our synthetic click out of the user-send interception hook. The
        // hook must block a real user click while startup owns the composer,
        // but blocking this click is exactly what stranded list_commands.
        _selfWrite = true;
        try { sb.click(); } catch {}
        finally { _selfWrite = false; }
      } else dispatchEnter(editor);
      // Background tabs can throttle React acknowledgement/timer work. The
      // commit still happens at most once; only wait longer for proof before
      // classifying that one click as ambiguous.
      let sent = await waitFor(() => sendLanded() || isStopped(), sentBudget);
      if (!sent && !isStopped()) {
        // Late acknowledgement: only when the draft is no longer sitting in the
        // composer (Notion consumed it). A draft that is still there was not
        // taken and keeps the original timing.
        const lateMs = options.lateConfirmMs != null ? Math.max(0, Number(options.lateConfirmMs) || 0)
          : (options.sentWaitMs != null ? 0 : LATE_CONFIRM_MS);
        const now = findEditorRaw();
        const consumed = !now || !draftStillPresent(now, actualDraft);
        if (lateMs && consumed) {
          diag("notion.tas.lateConfirmWait", { attempt, waitMs: lateMs });
          sent = await waitLateConfirm(lateMs);
          diag("notion.tas.lateConfirm", { sent: !!sent && !isStopped() });
        }
      }
      diag("notion.tas.sent", { sent: !!sent && !isStopped(), attempt, via: sb ? "control" : "enter", path: location.pathname });
      if (sent && !isStopped()) {
        _sendFailureAmbiguous = false;
        // A successful Notion send normally consumes the staged preview. Verify
        // that composer cleanup; if a bundle leaves the owned card behind, remove
        // only that card before releasing transaction bookkeeping.
        if (hasAttachments) {
          await waitFor(() => !hasPendingAttachment(), 1500);
          if (hasPendingAttachment()) clearAttachments();
          else { _attachedImages = null; _ownedAttachment = null; }
        } else {
          _attachedImages = null; _ownedAttachment = null;
        }
        clearPendingDraft();
        return true;
      }
      // 1.24.12: when our complete draft AND its screenshot are both still
      // sitting in the composer after the whole confirmation window, Notion did
      // not take the click (it empties the composer on every accepted send).
      // That is a provable non-send: clear only our own draft/attachment and let
      // the caller deliver the result again instead of stopping the task.
      if (!isStopped() && hasImages) {
        const still = findEditorRaw();
        if (still && draftLooksWritten(edText(still), text) && hasPendingAttachment() && !sendLanded()) {
          clearAttachments(); setRichText(still, ""); clearPendingDraft();
          _sendFailureAmbiguous = false; _sendRetryable = true;
          _sendFailureDetail = "Notion did not accept the screenshot message. elio removed its own draft and attachment.";
          diag("notion.tas.imageNotTaken", { attempt });
          return false;
        }
      }
      // There was one commit attempt. Never click Send a second time when its
      // acknowledgement is ambiguous; clear an attachment only if it visibly
      // remains in the composer and clear only the exact owned draft.
      if (hasAttachments && hasPendingAttachment()) clearAttachments();
      else { _attachedImages = null; _ownedAttachment = null; }
      const afterClick = findEditorRaw();
      if (afterClick && draftLooksWritten(edText(afterClick), text)) setRichText(afterClick, "");
      clearPendingDraft();
      diag("notion.tas.ambiguousCommit", { stopped: isStopped(), attempt });
      return false;
    }
    // Never strand a 20k+ internal tool result in the user's composer. Clear
    // only if the draft still exactly equals what this send attempt inserted.
    const leftover = findEditorRaw();
    let draftCleared = false;
    if (leftover && edText(leftover) && (draftLooksWritten(edText(leftover), text) || (_lockWanted && ownedDraft && leftover === ownedDraft.editor && edText(leftover) === ownedDraft.text))) {
      setRichText(leftover, ""); draftCleared = true;
    }
    clearPendingDraft();
    if (_ownedAttachment) clearAttachments();
    // Every exit that reaches this point happened before the one commit click.
    _sendRetryable = !_sendFailureAmbiguous && !isStopped();
    diag("notion.tas.failed", { path: location.pathname, draftCleared, retryable: _sendRetryable });
    return false;
  }
  async function recoverInternalError(text) {
    // A short, explicit recovery turn can succeed when the original large result
    // failed to process/send. It uses the same verified single-message path, so
    // it cannot overlap a still-running Studio call or synthesize duplicate sends.
    diag("notion.recoveryNudge.start", { chars: String(text || "").length });
    const sent = await typeAndSend(text, null, {
      attempts: 1, editorWaitMs: 1200, readyWaitMs: 3000,
      sentWaitMs: 2200, retryDelayMs: 0,
    });
    diag("notion.recoveryNudge.end", { sent: !!sent });
    return !!sent;
  }

  function stopGeneration() {
    const sb = stopButton();
    if (sb) {
      _selfWrite = true;
      try { sb.click(); return true; } catch {}
      finally { _selfWrite = false; }
    }
    return false;
  }

  // ── misc interface + fresh-chat routing ──────────────────────────────────
  // /ai is Notion's official new-chat landing route; /chat is a persisted
  // thread. Starting from /chat or a normal /p page must navigate to /ai first.
  const PENDING_START_KEY = "zs:notion:pending-start:v1";
  function readPendingStart() {
    try {
      const v = JSON.parse(sessionStorage.getItem(PENDING_START_KEY) || "null");
      return v && typeof v.at === "number" ? v : null;
    } catch { return null; }
  }
  function writePendingStart(v) {
    try { sessionStorage.setItem(PENDING_START_KEY, JSON.stringify(v)); } catch {}
  }
  function clearPendingStart() {
    try { sessionStorage.removeItem(PENDING_START_KEY); } catch {}
  }
  // Labels of Notion's own "start a new AI chat" controls. Matched against the
  // control's aria-label, title or short visible text; localized variants are
  // included so a non-English UI still uses Notion's router instead of a hard
  // navigation.
  const NEW_CHAT_LABEL_RE = /^(?:new (?:ai |agent |notion ai )?chat(?: with (?:ai|notion ai|agent))?|new thread|start (?:a )?new chat|nuevo chat|nueva conversaci[oó]n|neuer chat|neue unterhaltung|nouvelle (?:discussion|conversation)|nouveau chat|novo chat|nova conversa)$/i;
  const NEW_CHAT_TESTID_RE = /(?:new|start)[-_ ]?(?:ai[-_ ]?|agent[-_ ]?)?chat|new[-_ ]?thread/i;
  // Notion's router target for a fresh chat. /ai is the older landing; /chat is
  // the current one. A hard navigation tries /ai first (still served by every
  // bundle seen so far, redirecting where needed) and falls back to /chat.
  function cleanAiUrls() {
    return [new URL("/ai", location.origin).href, new URL("/chat", location.origin).href];
  }
  function isCleanAiHref(url) {
    if (url.origin !== location.origin || url.hash) return false;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path !== "/ai" && path !== "/chat") return false;
    for (const [k, v] of url.searchParams) if (LAUNCH_PAYLOAD_PARAM_RE.test(k) || (THREAD_PARAM_RE.test(k) && v)) return false;
    return true;
  }
  function openCleanAi(attempt = 0) {
    // Let Notion's own router open its new-chat page when it exposes a clean
    // link. A hard navigation can be intercepted by a failing service-worker
    // fetch even while the current workspace page is already running.
    for (const link of safeQueryAll(document, "a[href]")) {
      try {
        if (safeRead(() => link.target, "") === "_blank") continue;
        const url = new URL(link.href, location.href);
        if (!isCleanAiHref(url)) continue;
        const rect = safeRect(link);
        if (!rect.width || !rect.height || safeStyle(link).visibility === "hidden") continue;
        diag("notion.start.nativeAiLink", { path: url.pathname });
        link.click();
        return;
      } catch {}
    }
    for (const control of safeQueryAll(document, "button, [role='button'], [role='menuitem'], a")) {
      try {
        if (safeClosest(control, "#rs-root")) continue;
        const label = (safeRead(() => control.getAttribute("aria-label"), null) || safeRead(() => control.getAttribute("title"), null) ||
          (safeRead(() => control.textContent, "") || "").trim()).replace(/\s+/g, " ").trim();
        const testId = safeRead(() => control.getAttribute("data-testid"), null) || "";
        if (!NEW_CHAT_LABEL_RE.test(label) && !NEW_CHAT_TESTID_RE.test(testId)) continue;
        if (controlDisabled(control)) continue;
        const rect = safeRect(control);
        if (!rect.width || !rect.height || safeStyle(control).visibility === "hidden") continue;
        diag("notion.start.nativeAiControl", { label: label.slice(0, 40), testId: testId.slice(0, 60) });
        control.click();
        return;
      } catch {}
    }
    const urls = cleanAiUrls();
    const target = urls[Math.min(urls.length - 1, Math.max(0, attempt))];
    try { location.assign(target); }
    catch { try { location.href = target; } catch {} }
  }
  function navigateToFreshAi(reason) {
    const prev = readPendingStart();
    const now = Date.now();
    const state = {
      at: prev && now - prev.at < 120000 ? prev.at : now,
      navs: (prev && prev.navs || 0) + 1,
      lastNav: now,
      reason: reason || "startup",
    };
    writePendingStart(state);
    diag("notion.start.navigate", { from: routeKey(), to: state.navs > 1 ? "/chat" : "/ai", navs: state.navs, reason });
    openCleanAi(state.navs - 1);
    return { ready: false, navigating: true };
  }
  // Called by core BEFORE it injects anything. It guarantees the target is the
  // empty /ai landing page, so Start can never write into a normal Notion doc or
  // reuse an old AI conversation.
  async function prepareSessionStart(reason) {
    if (!isCleanAiLanding() || !chatIsEmpty()) {
      const why = isAiLanding() ? "clear-launch-payload" : (reason || "startup");
      diag("notion.start.requireCleanLanding", {
        path: location.pathname, hasSearch: !!location.search, hasHash: !!location.hash,
        landing: isAiLanding(), thread: !!threadId(), payload: hasLaunchPayload(), empty: chatIsEmpty(),
        composer: !!findEditorRaw(), params: [...routeParams().keys()].slice(0, 8).join(","),
      });
      return navigateToFreshAi(why);
    }
    const state = await ensureComposerReady(reason || "startup");
    if (state.ready) clearPendingStart();
    diag("notion.start.prepared", { ready: !!state.ready, path: location.pathname });
    return state;
  }
  function armPendingAutoStart() {
    if (!readPendingStart()) return;
    let fired = false;
    const startedAt = Date.now();
    const tick = () => {
      if (fired) return;
      const p = readPendingStart();
      if (!p) { fired = true; clearInterval(iv); return; }
      if (isStopped() || isSessionActive()) {
        clearPendingStart(); fired = true; clearInterval(iv); return;
      }
      const now = Date.now();
      if (now - p.at > 120000 || now - startedAt > 120000) {
        clearPendingStart(); fired = true; clearInterval(iv);
        diag("notion.start.pendingExpired", { path: location.pathname, navs: p.navs });
        return;
      }
      if (isCleanAiLanding()) {
        if (!findEditorRaw() && !(now - startedAt >= PROVISIONAL_AFTER_MS && adoptProvisionalEditor("autoResume"))) return;
        clearPendingStart(); fired = true; clearInterval(iv);
        diag("notion.start.autoResume", { path: location.pathname, waited: now - startedAt });
        setTimeout(() => { if (!isStopped() && !isSessionActive()) requestStart(); }, 150);
        return;
      }
      // A stale launch payload survived an SPA navigation. Do not let its
      // defaultUserMessage race the bootstrap; retry the literal /ai URL.
      if (isAiLanding() && now - (p.lastNav || 0) > 1500) {
        if ((p.navs || 0) >= 3) {
          clearPendingStart(); fired = true; clearInterval(iv);
          diag("notion.start.recleanFailed", { navs: p.navs });
          return;
        }
        p.navs = (p.navs || 0) + 1; p.lastNav = now; writePendingStart(p);
        diag("notion.start.recleanLanding", { navs: p.navs });
        openCleanAi(p.navs - 1);
        return;
      }
      // Let Notion's login page complete naturally. If it drops the redirect and
      // lands on Welcome (/p/...), retry /ai once the app has settled.
      if (/^\/(?:login|signup)(?:\/|$)/.test(location.pathname || "")) return;
      if (now - (p.lastNav || 0) > 7000 && (p.navs || 0) < 3) {
        p.navs = (p.navs || 0) + 1; p.lastNav = now; writePendingStart(p);
        diag("notion.start.renavigate", { from: routeKey(), navs: p.navs });
        openCleanAi(p.navs - 1);
      }
    };
    const iv = setInterval(tick, 350);
    setTimeout(tick, 0);
  }

  const chatIsEmpty = () => !isAiSurface() || allItems().length === 0;
  const isFreshChat = () => isAiLanding() && chatIsEmpty() && !!findEditorRaw();
  // Keep the bar in #rs-root rather than Notion's React tree. A temporary fixed
  // anchor is used only during the lazy /ai or /chat composer mount; normal
  // pages, databases, settings, login, and every non-AI route return no anchor.
  let _navBarAnchor = null, _navCardAt = 0, _navCardRect = null;
  // Geometry only: when the composer is on screen but has not been confirmed
  // as the typing target yet (slow mount, unfamiliar placeholder, layouts with
  // a sidebar or side panel), seat the temporary anchor on that visible card
  // so the bar sits on top of the chat box instead of at the viewport centre.
  // Typing still waits for findEditorRaw's full evidence.
  // Notion's send button carries stable test ids even when its placeholder text
  // changes. Seat the bar on the card around it so it sits on the chat box.
  function notionSendCardRect() {
    const vh = window.innerHeight || 0;
    const sends = safeQueryAll(document, '[data-testid="agent-chat-send-button"], [data-testid="agent-send-message-button"], [aria-label="Submit AI message"]');
    for (const b of sends) {
      if (safeRead(() => b.closest, null) && safeClosest(b, '[id^="rs-"]')) continue;
      for (let n = safeRead(() => b.parentElement, null), i = 0; n && n !== document.body && i < 8; n = safeRead(() => n.parentElement, null), i++) {
        let r; try { r = safeRect(n); } catch { break; }
        if (!r || r.width < 260 || r.height < 40 || r.height > 360 || r.bottom < vh * 0.3) continue;
        if (!safeQuery(n, '[contenteditable="true"], textarea, [role="textbox"]')) continue;
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
    return null;
  }
  function mainColumnCss() {
    const main = safeQuery(document, 'main, [role="main"], .notion-frame');
    let r = null; try { r = main && safeRect(main); } catch {}
    if (!r || r.width < 320) return null;
    const w = Math.min(560, r.width - 24);
    return "position:fixed;left:" + Math.round(r.left + r.width / 2) + "px;bottom:18px;transform:translateX(-50%);" +
      "width:" + Math.round(w) + "px;height:46px;box-sizing:border-box;pointer-events:none;opacity:0;z-index:-1";
  }
  function visibleComposerCardRect() {
    const now = Date.now();
    if (_navCardAt && now - _navCardAt < 300) return _navCardRect;
    _navCardAt = now; _navCardRect = null;
    const vh = window.innerHeight || 0;
    let best = null, bestScore = -Infinity, bestBottom = -Infinity;
    for (const e of editorCandidates()) {
      let r; try { r = safeRect(e); } catch { continue; }
      if (!r || !r.width || !r.height || r.bottom < vh * 0.4 || r.top > vh) continue;
      const score = editorHintScore(e);
      if (score > bestScore || (score === bestScore && r.bottom > bestBottom)) { best = e; bestScore = score; bestBottom = r.bottom; }
    }
    if (!best || bestScore < 5) { _navCardRect = notionSendCardRect(); return _navCardRect; }
    for (let n = safeRead(() => best.parentElement, null), i = 0; n && n !== document.body && i < 7; n = safeRead(() => n.parentElement, null), i++) {
      let r; try { r = safeRect(n); } catch { break; }
      if (!r || r.width < 260 || r.height < 40 || r.height > 360) continue;
      const controls = safeRead(() => n.querySelectorAll, null) ? [...safeQueryAll(n, CONTROL_SEL)] : [];
      if (controls.some((b) => SEND_RE.test(ariaOf(b)) || STOP_RE.test(ariaOf(b)) ||
          SEND_RE.test(safeRead(() => b.getAttribute("data-testid"), null) || "") || SEND_RE.test(safeRead(() => b.title, "") || "") || safeRead(() => b.type, "") === "submit")) {
        _navCardRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        return _navCardRect;
      }
    }
    _navCardRect = notionSendCardRect();
    return _navCardRect;
  }
  const NAV_ANCHOR_CENTERED = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
    "width:min(560px,calc(100vw - 24px));height:46px;box-sizing:border-box;" +
    "pointer-events:none;opacity:0;z-index:-1";
  function seatNavAnchor(a) {
    let css = NAV_ANCHOR_CENTERED;
    try { css = mainColumnCss() || css; } catch {}
    let card = null; try { card = visibleComposerCardRect(); } catch {}
    if (card) css = "position:fixed;left:" + Math.round(card.left) + "px;top:" + Math.round(card.top) + "px;width:" +
      Math.round(card.width) + "px;height:" + Math.round(card.height) + "px;box-sizing:border-box;pointer-events:none;opacity:0;z-index:-1";
    if (a.dataset.rsSeat !== css) { a.dataset.rsSeat = css; a.style.cssText = css; }
    return a;
  }
  function standaloneNavAnchor() {
    if (_navBarAnchor && safeRead(() => _navBarAnchor.isConnected, false)) return seatNavAnchor(_navBarAnchor);
    const a = document.createElement("div");
    a.id = "zs-notion-nav-anchor";
    a.setAttribute("aria-hidden", "true");
    a.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
      "width:min(560px,calc(100vw - 24px));height:46px;box-sizing:border-box;" +
      "pointer-events:none;opacity:0;z-index:-1";
    try { (document.body || document.documentElement).appendChild(a); } catch {}
    _navBarAnchor = a;
    return seatNavAnchor(a);
  }
  // Reserve a real composer strip instead of floating over the last reply.
  // Only our stylesheet changes; React-owned DOM and editor attributes stay intact.
  let barSpaceStyle = null, barSpaceFrame = null, barSpacePadding = 0, barSpaceHeight = 0;
  function reserveBarSpace(frame, pixels) {
    if (!frame || frame === _navBarAnchor || !safeRead(() => frame.isConnected, false)) {
      if (barSpaceStyle) barSpaceStyle.textContent = "";
      barSpaceFrame = null;
      return false;
    }
    if (!barSpaceStyle || !safeRead(() => barSpaceStyle.isConnected, false)) {
      barSpaceStyle = document.createElement("style");document.documentElement.appendChild(barSpaceStyle);
    }
    if (barSpaceFrame !== frame) {
      barSpaceStyle.textContent = "";
      const css = safeStyle(frame);
      barSpacePadding = parseFloat(css.paddingTop) || 0;
      barSpaceHeight = safeRect(frame).height;
      barSpaceFrame = frame;
    }
    const parts = [];
    for (let node = frame; node && node !== document.documentElement; node = safeRead(() => node.parentElement, null)) {
      let index = 1;
      for (let sibling = safeRead(() => node.previousElementSibling, null); sibling; sibling = safeRead(() => sibling.previousElementSibling, null)) if (safeRead(() => sibling.tagName, "") === safeRead(() => node.tagName, "")) index++;
      parts.unshift(safeRead(() => node.tagName, "").toLowerCase() + ":nth-of-type(" + index + ")");
    }
    const rule = "html>" + parts.join(">") + "{box-sizing:border-box!important;padding-top:" + (barSpacePadding + pixels) + "px!important;min-height:" + (barSpaceHeight + pixels) + "px!important}";
    if (safeRead(() => barSpaceStyle.textContent, "") !== rule) barSpaceStyle.textContent = rule;
    return true;
  }
  function barAnchor() {
    if (isAiSurface()) {
      const frame = composerFrame();
      if (frame) {
        if (_navBarAnchor) { try { _navBarAnchor.remove(); } catch {} _navBarAnchor = null; }
        return frame;
      }
      // Notion mounts the full-page AI editor several seconds after the shell.
      // Keep Start visible at the safe standalone position during that gap;
      // ensureComposerReady will wait for the genuine editor before typing.
      return standaloneNavAnchor();
    }
    if (_navBarAnchor) { try { _navBarAnchor.remove(); } catch {} _navBarAnchor = null; }
    return null;
  }
  // Cover a bounded composer card, never an ancestor that can grow over the page.
  const coverTarget = () => {
    const editor = getEditor(), frame = composerFrame();
    if (stopButton()) return editor;
    if (editor && frame && safeRead(() => frame.contains(editor), false)) {
      const rect = safeRect(frame);
      if (rect.width >= 200 && rect.height >= 36 && rect.height <= 200) return frame;
    }
    return editor;
  };
  const modeWarning = () => null;
  const captchaPresent = () => false;
  // Settings opens above the AI chat without changing its route. Do not let
  // the floating bar cover settings actions, including nested model controls.
  function overlayBlocking() {
    const shown = (node) => {
      if (!node || !safeRead(() => node.isConnected, false) || safeClosest(node, '[id^="rs-"], [aria-hidden="true"]')) return false;
      for (let el = node; el; el = safeRead(() => el.parentElement, null)) {
        if (safeRead(() => el.hidden, true)) return false;
        const style = safeStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      }
      return visible(node);
    };
    const searchMarkers = safeQueryAll(document, 'input[placeholder*="search settings" i], [aria-label*="search settings" i], [aria-placeholder*="search settings" i]');
    for (const marker of searchMarkers) if (shown(marker)) return true;
    const dialogs = safeQueryAll(document, '[role="dialog"], [aria-modal="true"]');
    for (const dialog of dialogs) {
      if (!shown(dialog)) continue;
      const label = [safeRead(() => dialog.getAttribute("aria-label"), null), safeRead(() => dialog.getAttribute("data-testid"), null)].filter(Boolean).join(" ");
      if (/\bsettings\b|restrict models from notion agent/i.test(label)) return true;
      const labelledBy = (safeRead(() => dialog.getAttribute("aria-labelledby"), null) || "").split(/\s+/).filter(Boolean);
      const titles = labelledBy.map(id => safeRead(() => document.getElementById(id), null)).concat(Array.from(safeQueryAll(dialog, 'h1, h2, h3, [role="heading"]')));
      if (titles.some(title => shown(title) && /^(?:settings|preferences|restrict models from notion agent)$/i.test(_txt(title)))) return true;
    }
    return false;
  }
  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;
  const scanError = () => null;
  const isTooLongMsg = () => false;
  const isBusyMsg = () => false;
  // ── Browser screenshot attachment ────────────────────────────────────────
  // Notion AI accepts images through a composer-scoped file input. Stage only
  // bounded browser captures, prove that a new preview mounted and finished
  // uploading, and remove only previews owned by this provider transaction if
  // the message is stopped/rejected before submission.
  let _attachedImages = null;
  let _imageSeq = 0;
  let _ownedAttachment = null;
  // Why the last attachFiles() call failed; only upload timeouts are retried.
  let _lastAttachFailure = "";
  const PROTOCOL_ATTACH_ATTEMPTS = 4;
  const PROTOCOL_RETRY_DELAYS = [1500, 4000, 10000];
  const PROTOCOL_RETRYABLE = new Set(["preview", "busy"]);
  function removeNamedAttachments(names) {
    // Name-scoped: unique elio filenames never match a user's attachment.
    const nodes = attachmentNodes().filter((node) => {
      const hay = `${_txt(node)} ${ariaOf(node)} ${safeRead(() => node.getAttribute, null) && (safeRead(() => node.getAttribute("title"), null) || "")}`;
      return names.some((name) => hay.includes(name));
    });
    if (!_ownedAttachment && !nodes.length) return;
    const owned = _ownedAttachment || { id: ++_imageSeq, files: [], names: [], nodes: [] };
    _ownedAttachment = { ...owned, names: [...new Set([...(owned.names || []), ...names])], nodes: [...new Set([...(owned.nodes || []), ...nodes])] };
    clearAttachments();
  }
  function attachmentScope() {
    const frame = composerFrame(), editor = findEditorRaw();
    if (!frame || !editor) return frame;
    let scope = frame;
    const width = safeRect(frame).width;
    // File cards can be siblings of the smaller editor/send-control frame.
    // Expand only within the local composer, never into transcript history.
    for (let parent = safeRead(() => frame.parentElement, null), depth = 0; parent && parent !== document.body && depth < 3; parent = safeRead(() => parent.parentElement, null), depth++) {
      const rect = safeRect(parent);
      if (rect.height > 640 || rect.width > width + 160 || rect.width < width - 48 ||
          safeQuery(parent, "[data-agent-service-scroll-anchor]") ||
          [...safeQueryAll(parent, "[contenteditable], textarea")].some((node) => node !== editor && !safeClosest(node, "#rs-root"))) break;
      scope = parent;
    }
    return scope;
  }
  const attachmentFileInput = (textFile = false) => {
    const frame = attachmentScope();
    if (!frame) return null;
    const local = [...safeQueryAll(frame, 'input[type="file"]')];
    const candidates = local.length ? local : [...safeQueryAll(document, 'input[type="file"]')].filter((input) => {
      if (safeRead(() => input.closest, null) && safeClosest(input, "#rs-root")) return false;
      const accept = (safeRead(() => input.getAttribute("accept"), null) || "").toLowerCase();
      if (textFile ? /(?:text\/plain|\.txt|\*\/\*)/.test(accept) : /(?:image|\.png|\.jpe?g|\.webp)/.test(accept)) return true;
      if (accept) return false;
      const r = safeRead(() => input.getBoundingClientRect, null) ? safeRect(input) : null;
      return !r || r.bottom >= innerHeight * 0.45;
    });
    if(textFile) return candidates.find(input=>{const accept=(safeRead(() => input.getAttribute("accept"), null)||"").toLowerCase();return !accept || /(?:text\/plain|\.txt|\*\/\*)/.test(accept);}) || null;
    return candidates.find((input) => /(?:image|\.png|\.jpe?g|\.webp)/i.test(safeRead(() => input.getAttribute("accept"), null) || "")) || candidates[0] || null;
  };
  const attachmentNodes = () => {
    const frame = attachmentScope();
    if (!frame) return [];
    const selector = [
      "img[src^='blob:']", "img[src^='data:image/']", "figure img",
      "[data-testid*='attachment' i]", "[data-testid*='upload' i]",
      "[aria-label*='attachment' i]", "[aria-label*='remove file' i]",
      "[aria-label*='remove image' i]",
    ].join(",");
    try {
      const nodes=[...safeQueryAll(frame, selector)];
      // Plain-text attachment cards can have no image or stable test ID.
      let scanned=0;
      for (const node of safeQueryAll(frame, "span, div, [role='listitem']")) {
        if (++scanned > 160) break;
        if ((safeRead(() => node.closest, null) && safeClosest(node, "#rs-root")) || safeRead(() => node.contains(findEditorRaw()), false)) continue;
        // Notion may split a filename over spans or replace its middle with an
        // ellipsis. A reserved elio prefix plus extension identifies that
        // preview without requiring the full unique filename to be visible.
        const labels = [_txt(node), safeRead(() => node.getAttribute("title"), null) || "", ariaOf(node)];
        if (labels.some((label) => label.length < 180 && /^(?:elio_(?:protocol|tool_result|web_capture)_[\w.\u2026 -]+\s*\.(?:txt|png|jpe?g|webp)|pasted text(?:\s*\(\d+\))?(?:\.txt)?)$/i.test(label.trim()))) nodes.push(node);
      }
      return [...new Set(nodes)];
    } catch { return []; }
  };
  const hasPendingAttachment = () => attachmentNodes().length > 0;
  const attachmentBusy = () => {
    const frame = attachmentScope();
    if (!frame) return false;
    try {
      const previews = attachmentNodes();
      return [...safeQueryAll(frame, "[role='progressbar'], progress, [aria-busy='true'], [data-state='uploading']")]
        .some((node) => visible(node) && (previews.some((preview) => safeRead(() => node.contains(preview), false) || safeRead(() => preview.contains(node), false)) ||
          /(?:upload|attach|file|image|progress)/i.test(
            `${ariaOf(node)} ${safeRead(() => node.getAttribute("data-testid"), null) || ""} ${_txt(safeRead(() => node.parentElement, null)).slice(0, 160)}`)));
    } catch { return false; }
  };
  function screenshotFile(img, index) {
    const mime = String(img && img.mimeType || "image/jpeg").toLowerCase();
    if (!/^image\/(?:jpeg|png|webp)$/.test(mime)) throw new Error("unsupported screenshot MIME type");
    const encoded = String(img && img.data || "");
    if (!encoded || encoded.length > 8 * 1024 * 1024) throw new Error("browser screenshot is missing or exceeds the attachment bound");
    const binary = atob(encoded);
    if (!binary.length || binary.length > 6 * 1024 * 1024) throw new Error("decoded browser screenshot exceeds the 6 MB attachment bound");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if ((mime === "image/jpeg" && !jpeg) || (mime === "image/png" && !png) || (mime === "image/webp" && !webp)) {
      throw new Error("browser screenshot bytes do not match the declared image type");
    }
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    return new File([bytes], `elio_web_capture_${Date.now()}_${index}.${ext}`, { type: mime });
  }
  async function attachImages(images, options = {}) {
    if (!Array.isArray(images) || !images.length || images.length > 4) return false;
    let files;
    try { files=images.map(screenshotFile); } catch { return false; }
    const attached=await attachFiles(files,options);
    if (attached) _attachedImages=images;
    return attached;
  }
  async function attachFiles(files, options = {}) {
    const stopped = typeof options.stopped === "function" ? options.stopped : isStopped;
    _lastAttachFailure = "unstaged";
    if (!isAiSurface() || !Array.isArray(files) || !files.length || files.length > 4 || stopped()) return false;
    if (hasPendingAttachment() && !_ownedAttachment) {
      _lastAttachFailure = "foreign";
      diag("notion.attach.foreignPending", { count: attachmentNodes().length });
      return false; // never remove or mix with a user's pre-existing draft file
    }
    if (_ownedAttachment) clearAttachments();
    const frame = composerFrame();
    if (!frame) return false;
    const before = new Set(attachmentNodes());
    const dt = new DataTransfer();
    const names = [];
    try {
      files.forEach((file) => {
        names.push(file.name);
        dt.items.add(file);
      });
    } catch (error) {
      diag("notion.attach.fileError", { error: String(error && error.message || error) });
      return false;
    }
    if (dt.items.length !== files.length || stopped()) return false;
    const textFile=files.some(file=>file.type==="text/plain");
    let input = options.preferDrop && typeof window.DragEvent === "function" ? null : attachmentFileInput(textFile);
    if (!input && !options.waitForText) {
      // Protocol files use the existing direct-drop path without opening the general plus menu.
      // Some Notion bundles lazily mount the input after the local Attach button
      // is opened. Restrict this click to a clearly-labelled composer control.
      const opener = controlsIn(frame).find((control) =>
        /(?:attach|add|upload).*(?:file|image)|(?:file|image).*(?:attach|add|upload)/i.test(
          `${ariaOf(control)} ${safeRead(() => control.title, "") || ""} ${safeRead(() => control.getAttribute("data-testid"), null) || ""}`));
      if (opener && visible(opener) && !controlDisabled(opener)) {
        _selfWrite = true;
        try { opener.click(); } catch {} finally { _selfWrite = false; }
        await waitFor(() => !!attachmentFileInput() || stopped(), 1600);
        input = attachmentFileInput(textFile);
      }
    }
    if (stopped()) return false;
    let staged = false, mode = "";
    if (input) {
      try {
        input.files = dt.files;
        _selfWrite = true;
        try {
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
          input.dispatchEvent(new window.Event("change", { bubbles: true }));
        } finally { _selfWrite = false; }
        staged = true; mode = "file-input";
      } catch (error) {
        diag("notion.attach.inputError", { error: String(error && error.message || error) });
      }
    }
    if (!staged) {
      // Safe fallback for bundles whose upload input lives in an inaccessible
      // portal: dispatch one normal file drop to the composer, never to history.
      try {
        // Native DragEvent fields cross Chrome's isolated-world boundary;
        // expando properties on a generic Event are invisible to page handlers.
        if (typeof window.DragEvent !== "function") throw new Error("Native file-drop events unavailable");
        const dispatchDropEvent = (type) => {
          const event = new window.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
          if (!event.dataTransfer) throw new Error("Native file-drop data unavailable");
          _selfWrite = true;
          try { frame.dispatchEvent(event); } finally { _selfWrite = false; }
        };
        try {
          for (const type of ["dragenter", "dragover", "drop"]) dispatchDropEvent(type);
        } finally {
          // Clear the site's drag overlay/cursor even if it rejects the drop.
          dispatchDropEvent("dragleave");
        }
        staged = true; mode = "composer-drop";
      } catch (error) {
        diag("notion.attach.dropError", { error: String(error && error.message || error) });
      }
    }
    if (!staged) return false;
    diag("notion.attach.staged", { mode, count: files.length });
    const preview = await waitFor(() => stopped() || attachmentNodes().some((node) => !before.has(node)), options.waitForText ? 45000 : 15000);
    const ownedNodes = attachmentNodes().filter((node) => !before.has(node));
    if (!preview || stopped() || !ownedNodes.length) {
      const scope = attachmentScope();
      diag("notion.attach.previewMissing", { stopped: stopped(), frameTag: safeRead(() => frame.tagName, ""),
        scopeTag: scope && safeRead(() => scope.tagName, ""), owned: ownedNodes.length,
        labels: scope ? [...safeQueryAll(scope, "span, [title], [aria-label]")].filter((node) =>
          !safeClosest(node, "#rs-root") && /elio_|pasted text/i.test(`${_txt(node)} ${safeRead(() => node.getAttribute("title"), null) || ""} ${ariaOf(node)}`))
          .slice(0, 6).map((node) => ({ text: _txt(node).slice(0, 100), title: (safeRead(() => node.getAttribute("title"), null) || "").slice(0, 100) })) : [] });
      _lastAttachFailure = stopped() ? "stopped" : "preview";
      _ownedAttachment = { id: ++_imageSeq, files, names, nodes: ownedNodes };
      clearAttachments();
      return false;
    }
    _ownedAttachment = { id: ++_imageSeq, files, names, nodes: ownedNodes };
    _attachedImages = files;
    // Give an upload indicator one render tick to mount, then require it to be
    // absent and the normal send control to be ready before submission.
    await sleep(250);
    const ready = await waitFor(() => stopped() || (!attachmentBusy() && hasPendingAttachment() && (options.waitForText || sendReady())), options.waitForText ? 60000 : 20000);
    diag("notion.attach.ready", { ready: !!ready && !stopped(), count: ownedNodes.length, busy: attachmentBusy() });
    if (!ready || stopped()) {
      _lastAttachFailure = stopped() ? "stopped" : "busy";
      clearAttachments();
      return false;
    }
    _lastAttachFailure = "";
    return true;
  }
  function clearAttachments() {
    const owned = _ownedAttachment;
    _attachedImages = null;
    _ownedAttachment = null;
    if (!owned) return;
    const frame = attachmentScope();
    if (!frame) return;
    const removeLike = (control) => /(?:remove|delete|dismiss|clear).*(?:file|image|attachment)|(?:file|image|attachment).*(?:remove|delete|dismiss|clear)/i.test(
      `${ariaOf(control)} ${safeRead(() => control.title, "") || ""} ${safeRead(() => control.getAttribute("data-testid"), null) || ""}`) ||
      /^(?:remove|delete|dismiss|clear|close|x|\u00d7|\u2715)$/i.test((ariaOf(control) || safeRead(() => control.title, "") || _txt(control)).trim()) ||
      (!ariaOf(control) && !safeRead(() => control.title, "") && !_txt(control) && !!safeQuery(control, "svg") &&
        safeRect(control).width > 0 && safeRect(control).width <= 40 &&
        safeRect(control).height > 0 && safeRect(control).height <= 40);
    const cardRoot = (node) => {
      const editor = findEditorRaw();
      for (let root = node, depth = 0; root && safeRead(() => frame.contains(root), false) && depth < 5; root = safeRead(() => root.parentElement, null), depth++) {
        if (safeRead(() => root.contains(editor), false)) break;
        if (safeRead(() => root.matches("[data-testid*='attachment' i], [data-testid*='upload' i], figure, li, [role='listitem']"), false) ||
            controlsIn(root).some(removeLike)) return root;
      }
      return safeRead(() => node.parentElement, null) || node;
    };
    const roots = new Set();
    for (const node of owned.nodes || []) {
      if (!node || !safeRead(() => node.isConnected, false) || !safeRead(() => frame.contains(node), false)) continue;
      roots.add(cardRoot(node));
    }
    const controls = [];
    for (const root of roots) {
      if (safeRead(() => root.matches, null) && safeRead(() => root.matches(CONTROL_SEL), false) && removeLike(root)) controls.push(root);
      if (safeRead(() => root.querySelectorAll, null)) controls.push(...[...safeQueryAll(root, CONTROL_SEL)].filter(removeLike));
    }
    if (!controls.length) {
      controls.push(...controlsIn(frame).filter((control) => removeLike(control) &&
        owned.names.some((name) => `${_txt(safeRead(() => control.parentElement, null))} ${ariaOf(control)}`.includes(name))));
    }
    for (const control of [...new Set(controls)]) {
      _selfWrite = true;
      try { control.click(); } catch {} finally { _selfWrite = false; }
    }
    try {
      const input = attachmentFileInput();
      if (input) input.value = "";
    } catch {}
    // A stopped upload can mount its preview a tick after the change/drop event.
    // Run two name-scoped cleanup passes; the unique elio filename means these
    // can never target a user's unrelated attachment.
    const delayedCleanup = () => {
      const currentFrame = attachmentScope();
      if (!currentFrame) return;
      const lateRoots = new Set();
      for (const node of attachmentNodes()) {
        const hay = `${_txt(node)} ${ariaOf(node)} ${safeRead(() => node.getAttribute, null) && (safeRead(() => node.getAttribute("alt"), null) || safeRead(() => node.getAttribute("title"), null) || safeRead(() => node.getAttribute("src"), null) || "")}`;
        if (!owned.names.some((name) => hay.includes(name))) continue;
        lateRoots.add(cardRoot(node));
      }
      for (const root of lateRoots) {
        const late = safeRead(() => root.querySelectorAll, null) ? [...safeQueryAll(root, CONTROL_SEL)].find(removeLike) : null;
        if (!late) continue;
        _selfWrite = true;
        try { late.click(); } catch {} finally { _selfWrite = false; }
      }
    };
    setTimeout(delayedCleanup, 400);
    setTimeout(delayedCleanup, 1400);
    diag("notion.attach.cleared", { controls: controls.length, id: safeRead(() => owned.id, "") });
  }
  const conversationKey = () => {
    try {
      // Every new chat shares /ai, so it must stay a transient/falsy key. Notion
      // assigns a stable /chat URL as soon as the first message is accepted.
      // Query and sidebar changes do not identify a different saved chat.
      // Current bundles keep the thread id in ?t=, so the pathname alone is the
      // same for every chat; include the id (and keep older /chat/<id> paths).
      const id = threadId();
      return id ? `${location.pathname || ""}${AI_CHAT_ID_PATH_RE.test(location.pathname || "") ? "" : "?t=" + id}` : "";
    } catch { return ""; }
  };
  // Both URL shapes Notion uses for the same saved thread.
  const conversationAliases = () => {
    try { const id = threadId(); return id ? [`/chat/${id}`, `/chat?t=${id}`] : []; } catch { return []; }
  };
  function enforceComposer() {
    if (!isAiSurface()) return { ready: false, editor: false };
    const ed = findEditorRaw();
    if (!ed) return { ready: false, editor: false };
    return { ready: true, editor: true };
  }
  // After this grace period, a visible, enabled editable in the lower part of
  // an AI route that sits inside a card with its own send/stop control is
  // accepted as the composer. Before this, Start waited the full 60s (and the
  // pending auto-start 120s) whenever Notion changed its placeholder wording.
  const PROVISIONAL_AFTER_MS = 5000;
  // 1.20.0: after this long, accept a weaker (but still send-button-adjacent)
  // composer. Edge hydrates Notion's editor with fewer hints than Chrome.
  const PROVISIONAL_RELAXED_AFTER_MS = 15000;
  let _composerWaitStart = 0;
  function provisionalEditor() {
    if (!isAiSurface()) return null;
    // Edge can report innerHeight 0 for a restored/sleeping or prerendered tab;
    // a 0 viewport previously rejected every candidate (r.top > 0).
    const vh = window.innerHeight || (document.documentElement && safeRead(() => document.documentElement.clientHeight, 0)) || 100000;
    const relaxed = _composerWaitStart && Date.now() - _composerWaitStart >= PROVISIONAL_RELAXED_AFTER_MS;
    let best = null, bestScore = -Infinity, bestBottom = -Infinity;
    for (const e of editorCandidates()) {
      if (!e || safeRead(() => e.disabled, true)) continue;
      if (!isTextControl(e) && safeRead(() => e.getAttribute, null) && safeRead(() => e.getAttribute("contenteditable"), null) === "false") continue;
      let r; try { r = safeRect(e); } catch { continue; }
      if (!r || !r.width || !r.height || r.bottom < vh * 0.4 || r.top > vh) continue;
      const s = editorHintScore(e);
      if (s > bestScore || (s === bestScore && r.bottom > bestBottom)) { best = e; bestScore = s; bestBottom = r.bottom; }
    }
    if (!best || bestScore < (relaxed ? 4 : 7)) return null;
    for (let n = safeRead(() => best.parentElement, null), i = 0; n && n !== document.body && i < (relaxed ? 10 : 7); n = safeRead(() => n.parentElement, null), i++) {
      const ctrls = safeRead(() => n.querySelectorAll, null) ? [...safeQueryAll(n, CONTROL_SEL)] : [];
      if (ctrls.some((b) => sendControlLike(b) || stopControlLike(b) || safeRead(() => b.type, "") === "submit")) return best;
      if (relaxed && safeRead(() => n.querySelector, null) && safeQuery(n, '[data-testid="agent-chat-send-button"],[data-testid="agent-send-message-button"]')) return best;
    }
    return null;
  }
  function adoptProvisionalEditor(reason) {
    const e = provisionalEditor();
    if (!e) return null;
    _editorCache = e; _editorAt = Date.now();
    _frameCache = null; _frameEditor = null;
    try { diag("notion.editor.provisional", { reason, tag: safeRead(() => e.tagName, ""), hint: editorHintScore(e), path: location.pathname }); } catch {}
    return e;
  }
  const COMPOSER_WAIT_MS = 60000;
  async function ensureComposerReady(reason) {
    if (!isAiSurface()) {
      diag("notion.composer.wrongRoute", { reason, path: location.pathname });
      return { ready: false, editor: false, error: "Notion AI chat is not open." };
    }
    let ed = findEditorRaw();
    if (!ed) {
      diag("notion.composer.waiting", { reason, path: location.pathname });
      const t0 = Date.now();
      _composerWaitStart = t0;
      // Edge (enhanced security without JIT, efficiency mode, a restored
      // sleeping tab) can take far longer than Chrome to hydrate Notion's
      // editor after the page shell paints. 20s failed those cold starts.
      while (!ed && !isStopped() && isAiSurface() && Date.now() - t0 < COMPOSER_WAIT_MS) {
        await waitFor(() => isStopped() || !!findEditorRaw() || !isAiSurface(), 1000);
        ed = findEditorRaw();
        if (!ed && Date.now() - t0 >= (typeof PROVISIONAL_AFTER_MS === "number" ? PROVISIONAL_AFTER_MS : 5000) &&
            typeof adoptProvisionalEditor === "function") ed = adoptProvisionalEditor(reason);
      }
      _composerWaitStart = 0;
      diag("notion.composer.waited", { found: !!ed, ms: Date.now() - t0, reason, path: location.pathname });
    }
    return { ready: !!ed && !isStopped(), editor: !!ed,
      error: ed ? "" : "Notion did not load its AI editor at " + (location.pathname || "/ai") + " after 60 seconds. Open a new AI chat in Notion, then retry; if that page itself fails to load, reload Notion. On Microsoft Edge, also turn off Efficiency mode / sleeping tabs for notion.so." };
  }

  const findToolBlockSpot = () => null;
  function installSendHooks(hooks) {
    const dispatchUserMessage = () => {
      // Snapshot BEFORE Notion handles the trusted event. Its new assistant
      // shell can mount inside the historical 50ms defer; capturing afterward
      // made core mistake that shell for the pre-send turn and wait forever.
      const base = assistantCount();
      const preSendToken = lastAssistantId();
      setTimeout(() => {
        hooks.onUserMessage && hooks.onUserMessage(base, preSendToken);
      }, 50);
    };
    document.addEventListener("keydown", (e) => {
      if (_selfWrite || !e.isTrusted) return;
      if (e.key !== "Enter" || e.shiftKey) return;
      const ed = findEditorRaw();
      if (!ed || !(e.target === ed || (e.target && safeRead(() => ed.contains(e.target), false)))) return;
      if (hooks.onCoworkSend && hooks.onCoworkSend(e)) return;
      if (hooks.isBlocked && hooks.isBlocked()) {
        e.preventDefault(); e.stopPropagation();
        hooks.onBlockedAttempt && hooks.onBlockedAttempt();
        return;
      }
      dispatchUserMessage();
    }, true);
    document.addEventListener("click", (e) => {
      if (_selfWrite || !e.isTrusted) return;
      const b = e.target && safeRead(() => e.target.closest, null) ? safeClosest(e.target, CONTROL_SEL) : null;
      if (!b || (!sendControlLike(b) && !stopControlLike(b))) return;
      // Classify the control we already have instead of calling stopButton() and
      // sendButton(), both of which used to rediscover the composer at the exact
      // moment of a blue-arrow click. Limit it to the cached composer frame so a
      // similarly-labelled button elsewhere in Notion cannot trigger the loop.
      const frame = composerFrame();
      if (!frame || !safeRead(() => frame.contains(b), false)) return;
      if (stopControlLike(b)) {
        setTimeout(() => { hooks.onNativeStop && hooks.onNativeStop(); }, 0);
        return;
      }
      if (hooks.onCoworkSend && hooks.onCoworkSend(e)) return;
      if (hooks.isBlocked && hooks.isBlocked()) {
        e.preventDefault(); e.stopPropagation();
        hooks.onBlockedAttempt && hooks.onBlockedAttempt();
        return;
      }
      dispatchUserMessage();
    }, true);
  }

  const timings = {
    WARMUP_MS: 90000,
    PRE_START_MS: 90000,
    STABLE_MS: 15000,
    GEN_IDLE_MS: 9000,
    REASON_NOREPLY_MS: 180000,
    RESPONSE_TIMEOUT_MS: 900000,
  };

  return {
    id: "notion",
    displayName: "Notion AI",
    supportsVision: true,
    // Never auto-launch the agent loop on a user's plain, unstarted chat. The
    // loop only runs after "Start Roblox agent" has bootstrapped this thread.
    autoResumeUnstarted: false,
    // Require the same real list_commands -> catalogue -> READY handshake as
    // the working chat providers; native Notion tool calls are not bridge calls.
    startupReplyAsCode: true,
    compactStartup: true,
    settleStartupReply: true,
    startupReplySettled,
    sysMaxChars: 8000,
    // Never spend a 90-second response window after all send attempts failed.
    failHardOnSendFailure: true,
    authoritativeSendResult: true,
    backgroundAgentSupported: true,
    // Never append chips/classes under Notion's DOM-locked response editor.
    immutableTranscript: true,
    mountActivitySummary, setActivityFolded, renderReadyAcknowledgement, collectExportHistory,
    activityItemKey: item => safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null) || immutableKey(item),
    itemKey: item => safeRead(() => safeClosest(item, AGENT_ROW_SEL)?.getAttribute("data-agent-service-scroll-anchor"), null) || null,
    canRenderImmutableChip: (item, opts) => !opts.whole || isUserItem(item) || !!safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), null),
    immutableChipPresent: (item) => !!immutableCardFor(item, immutableKey(item)),
    renderImmutableChip, updateImmutableChipDetail, updateImmutableChipLabel,
    immutableChipOwned, clearImmutableChip, syncImmutableChips, preprocessMutations,
    // Notion streams through a very mutation-heavy block editor. Bound global
    // work while keeping command detection/status comfortably sub-second.
    sweepThrottleMs: 500,
    periodicSweepMs: 3000,
    meterIntervalMs: 400,
    responseSettleMs: 250,
    // User-selected aggressive fast-turn policy: if Notion keeps its native
    // thinking/Stop state but emits no visible answer progress for 45 seconds,
    // core stops only that AI turn and asks for the next command immediately.
    // Studio tools run in a separate phase and keep their original timeouts.
    thinkingNoProgressMs: 0,
    respectNativeGeneration: true,
    responsePending: activeWorkflowProgress,
    requireFreshResponse: true,
    responseRemountGraceMs: 15000,
    emptyReplyGraceMs: 15000,
    // Does not alter ordinary prose-answer speed. It only finalizes a complete,
    // parseable elio command whose visible text has stopped growing while
    // Notion incorrectly leaves the card/native thinking state alive.
    closedToolNoProgressMs: 4000,
    thinkingStopWaitMs: 7000,
    thinkingRecoveryLimit: 3,
    barTrackIntervalMs: 250,
    barOutside: true, reserveBarSpace,
    observeCharacterData: true,
    mutationAttributeFilter: ["data-block-id"],
    timings,
    chipAtItemLevel: false,
    chipAnchor(item) { return item; },
    chipAppend: true,
    reliableCounts: false,
    // Notion's own tools (page search/edit, database ops) act on Notion's
    // cloud workspace - they can never touch the user's Roblox Studio.
    promptExtra:
      "You are running inside Notion AI. Notion's OWN tools (page search, " +
      "page/database editing, web search...) act on Notion's cloud workspace " +
      "and can NEVER read or change the user's Roblox Studio. ANYTHING Roblox " +
      "- checking studio state, reading/searching/editing scripts, running " +
      "Luau, inspecting the game tree - happens ONLY through the elio " +
      "JSON/###LUA### commands described above; those are intercepted by the " +
      "extension in the user's browser and executed on their machine. A " +
      "Notion tool call aimed at Roblox ALWAYS fails and wastes the turn. " +
      "Always write each command as PLAIN TEXT in the reply body, NEVER " +
      "inside a Notion tool call. If the user's message is informational - " +
      "reference material to read and remember, or a request to " +
      "summarize/explain/answer - reply directly and promptly: no Roblox " +
      "planning, no commands, no prolonged deliberation. SPEED IS REQUIRED " +
      "for Roblox work too: never restart broad planning or use prolonged/deep " +
      "deliberation between tool results. Think only enough to choose the next " +
      "safe action, then immediately output exactly one elio command. After " +
      "each result, issue the next command without re-summarizing or re-analyzing " +
      "the whole task. Continue one command per reply until done, then report in " +
      "one short sentence.",
    init({ diag: d, needsComposer: nc, isStopped: stopped, isSessionActive: active, requestStart: rs } = {}) {
      if (d) diag = d;
      if (nc) needsComposer = nc;
      if (stopped) isStopped = stopped;
      if (active) isSessionActive = active;
      if (rs) requestStart = rs;
      armStaleDraftCleanup();
      // Resume a Start click after the deliberate /chat-or-/p → /ai navigation.
      armPendingAutoStart();
      // Deferred: the core's diag reads loop state that does not exist yet at
      // P.init time.
      setTimeout(() => {
        try {
          const cands = editorCandidates();
          diag("notion.providerLoaded", {
            editor: !!findEditorRaw(), items: allItems().length,
            url: routeKey(), surface: isAiSurface(), landing: isAiLanding(),
            anchors: rawAgentRows().length, blockRoots: blockAssistantRoots().length, cands: cands.length,
            tags: cands.map((c) => safeRead(() => c.tagName, "")).join(","),
          });
        } catch {}
      }, 0);
      // Deeper probe after Notion's lazy AI chunks have had time to mount.
      setTimeout(() => {
        try {
          // A normal /p document can contain thousands of editable blocks. The
          // strict route guard already tells us everything useful there, so do
          // not run even this one-shot selector probe outside the AI surface.
          if (!isAiSurface()) {
            diag("notion.dom.probe", { url: routeKey(), surface: false, skipped: true });
            return;
          }
          const q = (s) => { try { return safeQueryAll(document, s).length; } catch { return 0; } };
          const ph = placeholderEditable();
          const ed = findEditorRaw();
          diag("notion.dom.probe", {
            url: routeKey(), surface: isAiSurface(), landing: isAiLanding(), thread: isAiThread(),
            ce: q("[contenteditable]"), mirror: q(".ProseMirror"), tip: q(".tiptap"),
            box: q("[role='textbox']"), ta: q("textarea"), input: q("input"),
            dp: q("[data-placeholder]"), focusable: q("[contenteditable='true'], [contenteditable='plaintext-only']"),
            iframes: q("iframe"), anchors: q(AGENT_ROW_SEL), blockRoots: q(BLOCK_RESPONSE_ROOT_SEL), items: allItems().length,
            phEditable: !!ph, editor: !!ed,
            editorTag: ed ? `${safeRead(() => ed.tagName, "")}.${String(safeRead(() => ed.className, "") || "").slice(0, 50)}` : "",
            phTag: ph ? `${safeRead(() => ph.tagName, "")}.${String(safeRead(() => ph.className, "") || "").slice(0, 50)}` : "",
            active: (document.activeElement && safeRead(() => document.activeElement.tagName, "")) || "",
          });
        } catch {}
      }, 4000);
    },
    allItems, invalidateItems, ignoreMutationRecords, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, readAssistant,
    streamLen, snapshot,
    getEditor, getEditorRaw: findEditorRaw, sendButton, editorText, sendLanded, sendFailureAmbiguous, sendFailureDetail, sendRetryable,
    chatIsEmpty, isFreshChat, composerFrame, barAnchor, coverTarget,
    followupPlaceholderTargets() {const ed=getEditor();return ed ? [ed,...safeQueryAll(ed, '[data-placeholder], [placeholder], [aria-placeholder]')] : [];},
    setInputLock, writeDraft, typeAndSend, recoverInternalError, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating, activeWorkflowProgress, suppressThinkingWatchdog, softGenerationSettled,
    enforceComposer, ensureComposerReady, prepareSessionStart, modeWarning, captchaPresent,
    overlayBlocking, turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    attachImages, clearAttachments, hasPendingAttachment, conversationKey, conversationAliases,
    installSendHooks, findToolBlockSpot,
  };
})();
