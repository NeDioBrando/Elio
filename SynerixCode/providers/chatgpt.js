// SPDX-License-Identifier: GPL-3.0-or-later
// providers/chatgpt.js - the OpenAI ChatGPT (chatgpt.com) provider.
// Exports the same RSProvider interface as providers/deepseek.js and
// providers/gemini.js; the core (core/main.js) is provider-agnostic. To DISABLE
// ChatGPT support, remove this file from manifest.json (and its URL from
// background.js PROVIDER_URLS + manifest host_permissions + popup.js
// SUPPORTED_HOSTS + main.js AI_SITES).
//
// ChatGPT DOM notes (re-validated live, 2026-08 - chatgpt.com, logged in, fr-FR):
//  - React app. One message = a <div data-message-author-role="user|assistant">
//    carrying a stable data-message-id (a UUID). There is NO <article> wrapper
//    anymore, so these elements alternate in DOM order and map 1:1 onto the
//    core's turn expectations. We treat each data-message-author-role div as one
//    "turn item". Long chats DO get virtualized, so every "is this a new reply"
//    test goes through the id (itemKey / lastAssistantId), never through counts.
//  - The reply markdown lives in <div class="markdown">. ChatGPT does NOT prefix
//    text with a screen-reader label (unlike Gemini), but textContent is still
//    NOT usable: code blocks are CodeMirror (.cm-line per line, zero "\n" text
//    nodes), so textContent returns the whole script on one line. Always read a
//    reply through textWithout() - see the note there; this was the single
//    biggest cause of failed tool calls (2026-08).
//    Reasoning (thinking models) renders OUTSIDE .markdown, so reading only the
//    .markdown naturally excludes drafts the model writes while reasoning.
//  - The composer is a ProseMirror contenteditable: <div id="prompt-textarea"
//    class="ProseMirror" contenteditable="true">. innerHTML assignment is unsafe;
//    inject text via select-all + document.execCommand("insertText") (validated
//    to update ProseMirror/React state and enable the send button).
//  - The send button is #composer-submit-button (data-testid="send-button"); it
//    appears only once the composer has text. While generating, a stop button
//    data-testid="stop-button" is present for the ENTIRE generation (including
//    any reasoning phase) - a reliable single signal, like Gemini's stop icon.
//  - Fenced code blocks render as ONE outer <pre> inside .markdown (holding the
//    language label + copy bar + the code). A FENCED ###LUA###…###END_LUA### /
//    JSON command block is therefore one atomic <pre>, and hiding it is simple.
//    But the model does not always fence it: seen live 2026-08, a 208-line
//    ###LUA### block written as plain prose was rendered as 68 SIBLING nodes
//    (<p> for the flush lines, <pre> for the indented ones), and only the first
//    carried the marker - so a per-element match hid the opener and left the
//    whole script on screen. findToolBlockSpot hides the marker-to-marker RANGE
//    for that shape; see there.
//  - Image upload: <input type="file" data-testid="upload-photos-input">.
//  - "Analyser" (Think) is a per-message toggle pill in the composer - a <button>
//    with aria-pressed, class __composer-pill. We deliberately do NOT drive it:
//    like the model picker, the reasoning mode is the user's choice. On the free
//    tier it is quota-capped ("l'analyse sont indisponibles jusqu'à la
//    réinitialisation de votre quota"), and when the quota is out the pill stays
//    pressed but the reply comes back non-reasoning - which is harmless here.
//  - NOT YET ESTABLISHED: whether a reasoning-mode reply renders its thinking in
//    a container outside .markdown, and what selects it. Every reply observed so
//    far (2026-08, free tier) had no such element, so `thinkingSel` is not
//    exported. If reasoning ever quotes a command block, the core's
//    "raw command still visible" probe could flap - that is the symptom to watch
//    for, and the fix is to export thinkingSel here (see deepseek.js).
//  - New chat: <a data-testid="create-new-chat-button" href="/">. A blank new
//    chat is exactly "/"; a conversation is /c/<id>.
//  - ChatGPT's free tier caps messages, and caps image/file input SEPARATELY, so
//    image uploads are available when the current account has quota. Verify the
//    attachment before submitting; surface quota walls instead of sending text-only.
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
  let diag = () => {}; // injected by core via init()

  const S = {
    msg: "[data-message-author-role], [data-conversation-role], [data-role], [data-message-author]",
    turn: "[data-testid^='conversation-turn-'], article[data-turn], section[data-turn]",
    userRole: "user",
    assistantRole: "assistant",
    reply: ".markdown, .prose, .markdown-new-styling, [data-message-content]",
    workItem: "[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]",
    workReply: '[data-markdown-text-style="assistant-message"]',
    thinking: '[data-markdown-text-style="thinking"], [data-testid="thinking-status"], [data-testid*="reasoning" i]', 
    editor: "#prompt-textarea, [data-testid='prompt-textarea'], [data-testid='composer-input'], [contenteditable='true'][data-lexical-editor='true'], form[data-chatgpt-composer] [data-composer-markdown][contenteditable='true'][role='textbox'], form[data-chatgpt-composer] [role='textbox'], form [contenteditable]:not([contenteditable='false'])",
    // The ONE submit control; its data-testid says whether it is currently a
    // send or a stop button (see isStopBtn). Id first - it survives testid churn.
    submitBtn: "#composer-submit-button, button[data-testid='send-button'], button[data-testid='stop-button']",
    // Kept for installSendHooks, which needs to recognise a click on the native
    // stop control wherever it lives.
    stopBtn: "button[data-testid='stop-button']",
    codeWrap: "pre",
    // composer frame: the <form> that wraps the ProseMirror editor.
    errorSurfaces: '[role="alert"],[data-testid*="error"],[class*="error-message"]',
  };

  const RE = {
    contextLimit: new RegExp(
      [
        "conversation.{0,20}(too long|trop long)",
        "context.{0,20}(limit|exceeded|d\\u00e9pass\\u00e9)",
        "maximum.{0,20}(context|length)",
        "(token|context).{0,10}limit",
        "the message you submitted was too long",
        "le message.{0,30}trop long",
      ].join("|"),
      "i"
    ),
    tooLong: /conversation .{0,20}(too long|getting too long|trop longue)|message you submitted was too long/i,
    // ChatGPT errors / rate limits ("something went wrong", "you've reached our
    // limit of messages", quota walls). Kept SHORT-message-gated by the core.
    busy: /something went wrong|une erreur s.est produite|try again later|réessayer plus tard|reached.{0,20}limit of messages|limite de messages|usage cap|temporarily unavailable/i,
    // The native "Continue generating" affordance after a length truncation.
    continueBtn: /^(continue generating|continuer (?:à|a) générer|continue)$/i,
    // Quota wall / paused conversation. Seen live (fr): "Chat en pause jusqu'à la
    // réinitialisation du quota à 23:03 - Vous avez épuisé le quota de chats avec
    // fichiers ou images."
    paused: /chat en pause|conversation.{0,15}(en pause|paused)|quota de chats|r[ée]initialisation du quota|you.{0,3}ve (?:hit|reached).{0,20}limit|quota (?:reset|exceeded)|out of (?:messages|credits)/i,
  };

  // ChatGPT streams continuously with a hard stop-button signal for the WHOLE
  // generation (including reasoning), so windows can be tight like Gemini.
  const timings = {
    GEN_IDLE_MS: 1500,
    REASON_IDLE_MS: 12000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 90000,
    get STABLE_MS() { return safeQuery(document, S.workItem) ? 45000 : 9000; },
    RESPONSE_TIMEOUT_MS: 300000,
  };

  // ── Turn classification ───────────────────────────────────────────────────
  const role = (item) => {
    if (!item || !safeRead(() => item.getAttribute, null)) return null;
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.workItem), false)) {
      const key = safeRead(() => item.getAttribute("data-chatgpt-search-unit-key"), null) || "";
      const match = key.match(/:(user|assistant)$/);
      if (match) return match[1];
      const author = safeQuery(item, '[data-conversation-role]');
      if (author && safeClosest(author, S.workItem) === item) return safeRead(() => author.getAttribute('data-conversation-role'), null);
      return null;
    }
    const own = safeRead(() => item.getAttribute("data-message-author-role"), null) ||
      safeRead(() => item.getAttribute("data-conversation-role"), null) ||
      safeRead(() => item.getAttribute("data-role"), null) ||
      safeRead(() => item.getAttribute("data-message-author"), null);
    if (own === S.userRole || own === S.assistantRole) return own;
    const turn = safeRead(() => item.getAttribute("data-turn"), null);
    if (turn === S.userRole || turn === S.assistantRole) return turn;
    const conversation = safeRead(() => item.getAttribute("data-conversation-role"), null);
    if (conversation === S.userRole || conversation === S.assistantRole) return conversation;
    const nested = safeRead(() => item.querySelector, null) && safeQuery(item, S.msg);
    if (nested) {
      const nestedRole = safeRead(() => nested.getAttribute("data-message-author-role"), null) ||
        safeRead(() => nested.getAttribute("data-conversation-role"), null) ||
        safeRead(() => nested.getAttribute("data-role"), null) ||
        safeRead(() => nested.getAttribute("data-message-author"), null);
      if (nestedRole === S.userRole || nestedRole === S.assistantRole) return nestedRole;
    }
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches("[data-user-message-bubble]"), false)) return S.userRole;
    if (safeRead(() => item.querySelector, null) && safeQuery(item, "[data-user-message-bubble]")) return S.userRole;
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.reply), false)) return S.assistantRole;
    if (safeRead(() => item.querySelector, null) && safeQuery(item, S.reply)) return S.assistantRole;
    return null;
  };
  const isUserItem = (item) => role(item) === S.userRole;
  const isAssistantItem = (item) => role(item) === S.assistantRole;

  // Text extraction that can skip our own chip (and any excluded subtree).
  //
  // CRITICAL: this must NOT be `textContent`. ChatGPT renders fenced code blocks
  // with CodeMirror - <div class="cm-content"> holding ONE <div class="cm-line">
  // per line - and there is not a single "\n" text node in the whole block.
  // textContent therefore returns the entire script glued onto ONE line:
  //   "###LUA###local total = 0local count = 1000for i = 1, count do…"
  // Measured live 2026-08 on a 479-line block: textContent 8917 chars with 0
  // newlines; joining the .cm-line children gave 9395 chars, both markers intact
  // (CodeMirror renders every line here - no viewport virtualization observed,
  // checked up to 479 lines). That collapse is what broke MOST tool calls in a
  // real session: the core's parser saw the opening marker fused to the first
  // statement and reported "Failed to parse command code / your code block was
  // empty", and on the runs that did execute, Roblox reported every error at
  // "AssistantCommand:1" because the whole script really was one line.
  // So: emit a newline for every cm-line (even an empty one - blank lines must
  // survive or reported line numbers shift), for <br>, and at block boundaries
  // (which also gives the unfenced-prose shape a usable line structure).
  //
  // Joining the .cm-line nodes is still not enough on its own: CodeMirror renders
  // LONG LINES only partially, so a big block's DOM text stops early (measured:
  // 2339 of 10040 chars, and a sibling block cut off mid-JSON). The real document
  // lives in CodeMirror's state, behind a page-world expando a content script
  // cannot see - providers/chatgpt-cm.js runs in the MAIN world and republishes it
  // into data-rs-cm. syncCM() asks for a refresh; the listener is synchronous, so
  // the attribute is current the moment dispatchEvent returns. If that script is
  // absent the attribute is too, and we fall back to the .cm-line join (which is
  // correct for anything under ~4000 chars).
  const BLOCK_TAGS = /^(?:P|DIV|PRE|LI|UL|OL|BLOCKQUOTE|H[1-6]|TABLE|TR|SECTION|ARTICLE|HR)$/;
  let _cmWarned = false;
  function syncCM(root) {
    if (!root || !safeRead(() => root.querySelector, null) || !safeQuery(root, ".cm-content")) return;
    try { document.dispatchEvent(new CustomEvent("rs-cm-sync")); } catch {}
  }
  function textWithout(root, excludeSel) {
    if (!root) return "";
    syncCM(root);
    let t = "";
    const breakLine = () => { if (t && !t.endsWith("\n")) t += "\n"; };
    const walk = (n) => {
      if (safeRead(() => n.nodeType, 0) === 3) { t += safeRead(() => n.nodeValue, ""); return; }
      if (safeRead(() => n.nodeType, 0) !== 1) return;
      if (excludeSel && safeRead(() => n.matches, null) && safeRead(() => n.matches(excludeSel), false)) return;
      if (safeRead(() => n.tagName, "") === "BR") { t += "\n"; return; }
      // The editor's TRUE document, published by the MAIN-world tap. This is the
      // only complete source for a long block - take it and skip the subtree.
      if (n.classList && safeRead(() => n.classList.contains("cm-content"), false)) {
        const full = safeRead(() => n.getAttribute("data-rs-cm"), null);
        if (full !== null) {
          breakLine();
          t += full;
          breakLine();
          return;
        }
        if (!_cmWarned) {
          _cmWarned = true;
          diag("cm.noTap", { note: "chatgpt-cm.js not loaded; long code blocks may be truncated" });
        }
        // fall through to the .cm-line walk below
      }
      // One CodeMirror line = one source line, ALWAYS terminated - an empty
      // .cm-line is a blank line in the source and must not be swallowed.
      if (n.classList && safeRead(() => n.classList.contains("cm-line"), false)) {
        for (const c of safeRead(() => n.childNodes, [])) walk(c);
        t += "\n";
        return;
      }
      const isBlock = BLOCK_TAGS.test(safeRead(() => n.tagName, ""));
      if (isBlock) breakLine();
      for (const c of safeRead(() => n.childNodes, [])) walk(c);
      if (isBlock) breakLine();
    };
    walk(root);
    return t;
  }

  // Non-reasoning reply text only: join the .markdown container(s). Reasoning
  // renders outside .markdown, so this never sees tool blocks the model merely
  // drafts while thinking.
  const COMMANDISH_TEXT = /"(?:command|tool)"\s*:\s*"|###\s*(?:lua|mcp_tool)/i;

  const replyNodes = (item) => {
    if (!item) return [];
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.workItem), false)) {
      return [...safeQueryAll(item, S.workReply)]
        .filter((node) => safeClosest(node, S.workItem) === item);
    }
    const out = [];
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.reply), false)) out.push(item);
    if (safeRead(() => item.querySelectorAll, null)) out.push(...safeQueryAll(item, S.reply));
    const unique = [...new Set(out)];
    // ChatGPT sometimes nests .prose inside .markdown (or vice versa). Reading
    // both duplicates the same response and can make command text look malformed.
    // Keep only the outermost reply surface; it contains the complete rendered
    // answer, including code blocks that live beside the inner prose node.
    const top = unique.filter((node) => !unique.some((other) => {
      if (other === node || !other || !safeRead(() => other.contains, null)) return false;
      try { return safeRead(() => other.contains(node), false); } catch { return false; }
    }));
    // Current ChatGPT A/B renderer can expose only a role-bearing
    // data-conversation-role node with no .markdown wrapper. In that shape the
    // role node itself is the response surface, so falling back to it is safer
    // than reporting an empty reply forever.
    if (!top.length && isAssistantItem(item)) top.push(item);
    return top;
  };

  function assistantText(item, excludeSel) {
    if (!item) return "";
    const reply = replyNodes(item)
      .filter((m) => !(excludeSel && safeRead(() => m.closest, null) && safeClosest(m, excludeSel)))
      .map((m) => textWithout(m, excludeSel)).join("\n").trim();
    // Work separates the final reply from its heading, reasoning and tool panels.
    // Never use the whole-item fallback for those grouped turns.
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.workItem), false)) return reply;
    // 2026-09 ChatGPT sometimes renders the fenced command OUTSIDE the .markdown/
    // .prose node while keeping it inside the same assistant item. The user can
    // visibly see the JSON, but reading only replyNodes() returns the short prose
    // around it (or the previous READY sentence), so the core classifies the turn
    // as plain text. Read the whole assistant item as a command-only fallback.
    const whole = textWithout(item, excludeSel).trim();
    if (COMMANDISH_TEXT.test(whole) && !COMMANDISH_TEXT.test(reply)) return whole;

    // A second current layout puts the fenced code block beside the inner assistant
    // item under the shared conversation-turn/data-turn-key wrapper. Do NOT make
    // that outer wrapper the item we hide/decorate (ChatGPT virtualizes it), but it
    // is safe to READ command-shaped descendants from it. Explicitly reject anything
    // inside a user bubble/role so a user who pasted a JSON example can never cause
    // synerixcode to execute their own text as if it came from the assistant.
    if (!COMMANDISH_TEXT.test(reply)) {
      let scope = null;
      try { scope = (safeRead(() => item.closest, null) && safeClosest(item, S.turn)) || (safeRead(() => item.closest, null) && safeClosest(item, "[data-turn-key]")); } catch {}
      if (scope && scope !== item && safeRead(() => scope.querySelectorAll, null)) {
        const userSel = "[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']";
        const candidates = safeQueryAll(scope, "pre, code, .markdown, .prose, .markdown-new-styling, [data-message-content]");
        for (const node of candidates) {
          try {
            if (excludeSel && safeRead(() => node.closest, null) && safeClosest(node, excludeSel)) continue;
            if (safeRead(() => node.closest, null) && safeClosest(node, userSel)) continue;
          } catch {}
          const text = textWithout(node, excludeSel).trim();
          if (COMMANDISH_TEXT.test(text)) return text;
        }
      }
    }
    return reply || whole;
  }

  function itemText(item) {
    if (!item) return "";
    if (isAssistantItem(item)) return assistantText(item);
    return textWithout(item);
  }

  function classifyText(item, excludeSel) {
    if (isAssistantItem(item)) return assistantText(item, excludeSel);
    return textWithout(item, excludeSel);
  }

  // ── DOM primitives ────────────────────────────────────────────────────────
  // Do NOT use ChatGPT's outer conversation-turn wrapper as the item we hide or
  // decorate. Current ChatGPT virtualizes/recycles that wrapper; collapsing it
  // with .rs-hidden can make the turn disappear from the DOM while a reply is
  // still streaming, which leaves bootstrap stuck at users:0/results:0 forever.
  // Instead start from the actual role-bearing content and climb only to the
  // nearest INNER stable message container. This preserves the site's outer
  // layout/virtualization node while still giving synerixcode a real DOM element to
  // mask and decorate.
  function itemRoot(signal) {
    if (!signal || !safeRead(() => signal.closest, null)) return signal;
    const work = safeClosest(signal, S.workItem);
    if (work && !safeClosest(work, "#rs-root")) return work;
    const roleNode = safeClosest(signal, S.msg);
    if (roleNode && !safeClosest(roleNode, "#rs-root")) return roleNode;
    const keyed = safeClosest(signal, "[data-turn-key]");
    if (keyed && !safeClosest(keyed, "#rs-root")) {
      // A current ChatGPT renderer can put the USER and ASSISTANT halves under
      // one shared data-turn-key. Split ONLY those mixed keyed wrappers. A normal
      // keyed wrapper contains one message and must stay the item root (older
      // ChatGPT builds use exactly that shape).
      let mixed = false;
      try {
        const hasUser = !!safeQuery(keyed, "[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']");
        const hasAssistant = !!safeQuery(keyed, ".markdown, .prose, .markdown-new-styling, [data-message-content], [data-message-author-role='assistant'], [data-conversation-role='assistant'], [data-role='assistant'], [data-message-author='assistant']");
        mixed = hasUser && hasAssistant;
      } catch {}
      if (mixed && signal !== keyed) {
        let cur = signal;
        while (cur && safeRead(() => cur.parentElement, null) && safeRead(() => cur.parentElement, null) !== keyed) cur = safeRead(() => cur.parentElement, null);
        if (cur && cur !== keyed) return cur;
      }
      return keyed;
    }
    const outer = safeClosest(signal, S.turn);
    if (outer && signal !== outer) {
      let cur = signal;
      while (cur && safeRead(() => cur.parentElement, null) && safeRead(() => cur.parentElement, null) !== outer) cur = safeRead(() => cur.parentElement, null);
      if (cur && cur !== outer) return cur;
    }
    return safeRead(() => signal.parentElement, null) || signal;
  }

  let activityControlsStyle;
  function setActivityFolded(item, folded) {
    item.dataset.rsActivityFolded = folded ? '1' : '0';
    const turn = safeClosest(item, S.turn);
    if (!turn) return;
    if (!activityControlsStyle || !safeRead(() => activityControlsStyle.isConnected, false)) {
      activityControlsStyle = document.createElement('style');
      activityControlsStyle.textContent = '[data-rs-activity-controls-folded="1"]{display:none!important}[data-rs-activity-turn-folded="1"]{min-height:0!important;padding-top:0!important;padding-bottom:0!important;margin-top:0!important;margin-bottom:0!important;gap:0!important}';
      document.documentElement.appendChild(activityControlsStyle);
    }
    const other = [...safeQueryAll(turn, S.msg)].some(node=>node !== item && !safeRead(() => item.contains(node), false) && node.dataset.rsActivityFolded !== '1');
    turn.dataset.rsActivityTurnFolded = folded && !other ? '1' : '0';
    const actions = safeQueryAll(turn, 'button[data-testid$="-turn-action-button"],button[aria-label="Copy"],button[aria-label="Read aloud"],button[aria-label="Good response"],button[aria-label="Bad response"]');
    for (const button of actions) {
      const owner = safeClosest(button, S.msg);
      if (other && owner !== item && !(owner && safeRead(() => item.contains(owner), false))) continue;
      // Hide only the action strip, never the virtualized conversation wrapper
      // or a sibling user's message. Keep React-owned children in place.
      let strip = button;
      for (let parent = safeRead(() => button.parentElement, null); parent && parent !== turn && parent !== item; parent = safeRead(() => parent.parentElement, null)) {
        if (safeQuery(parent, '[data-message-author-role],.markdown,.prose,.rs-chip,.rs-chat-activity')) break;
        strip = parent;
      }
      strip.dataset.rsActivityControlsFolded = folded ? '1' : '0';
    }
  }
  const allItems = () => {
    const signals = [...safeQueryAll(document, `${S.msg}, [data-user-message-bubble], ${S.reply}, ${S.workItem}`)]
      .filter((e) => !safeClosest(e, "#rs-root"));
    const items = [];
    const seen = new Set();
    for (const signal of signals) {
      const root = itemRoot(signal);
      if (!root || seen.has(root) || safeClosest(root, "#rs-root")) continue;
      seen.add(root);
      items.push(root);
    }
    // ChatGPT's current renderer can nest TWO role-bearing elements for the SAME
    // message (for example an outer data-conversation-role wrapper and an inner
    // data-message-author-role node). Treating both as separate turns makes one
    // real assistant reply count as two: the chip sweep decorates one node while
    // lastAssistant()/waitForResponse read the other. Keep the innermost same-role
    // node, which is the one closest to the actual message content, and discard
    // only its redundant same-role ancestors. Different-role nesting is preserved.
    const contains = (parent, child) => {
      if (!parent || !child || parent === child) return false;
      try { if (safeRead(() => parent.contains, null)) return safeRead(() => parent.contains(child), false); } catch {}
      for (let n = safeRead(() => child.parentElement, null); n; n = safeRead(() => n.parentElement, null)) if (n === parent) return true;
      return false;
    };
    return items.filter((item) => {
      const r = role(item);
      if (!r) return true;
      return !items.some((other) => other !== item && role(other) === r && contains(item, other));
    });
  };
  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const getEditor = () => {
    const nodes = [...safeQueryAll(document, S.editor)].filter((e) => !safeClosest(e, "#rs-root"));
    // Work's composer can be a textarea or a textbox outside a <form>, with
    // "Work with ChatGPT" as its only stable cue. Do not mistake a transcript
    // code editor or an unrelated search field for the chat composer.
    const workCue = /work with chatgpt|message chatgpt|ask chatgpt/i;
    const workNodes = [...safeQueryAll(document, "textarea, [role='textbox'], [contenteditable]")]
      .filter((e) => !safeClosest(e, "#rs-root") && !safeClosest(e, S.turn) &&
        !safeClosest(e, S.workItem) && !safeClosest(e, "[data-message-author-role]") &&
        workCue.test([safeRead(() => e.getAttribute("placeholder"), null), safeRead(() => e.getAttribute("data-placeholder"), null),
          safeRead(() => e.getAttribute("aria-placeholder"), null), safeRead(() => e.getAttribute("aria-label"), null),
          safeRead(() => e.parentElement, null) && safeRead(() => safeRead(() => e.parentElement, null).getAttribute("data-placeholder"), null),
          (safeRead(() => e.textContent, "") || "").trim().slice(0, 80)].filter(Boolean).join(" ")));
    for (const e of workNodes) if (!nodes.includes(e)) nodes.unshift(e);
    const visible = nodes.find((e) => {
      try {
        const r = safeRect(e);
        return r.width > 0 && r.height > 0 && safeStyle(e).visibility !== "hidden";
      } catch { return false; }
    });
    return visible || nodes[0] || null;
  };
  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (safeRead(() => e.tagName, "") === "TEXTAREA" || safeRead(() => e.tagName, "") === "INPUT") return safeRead(() => e.value, "") || "";
    return safeRead(() => e.textContent, "") || "";
  };

  const lastAssistant = () => {
    const it = assistantItems();
    return it.length ? it[it.length - 1] : null;
  };
  // Stable per-turn identity (a UUID assigned at message creation, present while
  // streaming). ChatGPT VIRTUALIZES long conversations - older turns are detached
  // from the DOM as you scroll - so assistantCount() goes flat/drops and a
  // count-based "new reply" test stalls until the user scrolls. Identity of the
  // LAST node is virtualization-proof: we never count detached siblings.
  // The core also uses itemKey to dedupe turns (turnKey) so a scrolled-back old
  // command can't collide with a current one on its list index. It is a UUID, not
  // a monotonic number, so the core's numeric "old id" shortcut simply doesn't
  // apply here (Number(uuid) is NaN and that guard is skipped) - the
  // settled-history guard covers the same case provider-agnostically.
  const itemKey = (item) => {
    if (!item || !safeRead(() => item.getAttribute, null)) return null;
    if (safeRead(() => item.matches, null) && safeRead(() => item.matches(S.workItem), false)) {
      const ids = (safeRead(() => item.getAttribute("data-chatgpt-search-message-ids"), null) || "").trim().split(/\s+/).filter(Boolean);
      return ids.length ? [...new Set(ids)].join(" ") : safeRead(() => item.getAttribute("data-chatgpt-search-unit-key"), null);
    }
    const nested = safeRead(() => item.querySelector, null) && safeQuery(item, "[data-message-id], [data-turn-key]");
    const keyed = safeRead(() => item.closest, null) && safeClosest(item, "[data-turn-key]");
    const outer = safeRead(() => item.closest, null) && safeClosest(item, S.turn);
    const direct = safeRead(() => item.getAttribute("data-message-id"), null) ||
      safeRead(() => item.getAttribute("data-turn-id"), null) ||
      safeRead(() => item.getAttribute("data-testid"), null) ||
      safeRead(() => item.id, "") ||
      (nested && safeRead(() => nested.getAttribute("data-message-id"), null)) ||
      (outer && (safeRead(() => outer.getAttribute("data-turn-id"), null) || safeRead(() => outer.getAttribute("data-testid"), null)));
    if (direct) return direct;
    // The 2026-09 renderer groups user + assistant content under one stable
    // data-turn-key. Prefix the role so the assistant identity cannot collide
    // with the user half of the same grouped turn.
    const groupedKey = safeRead(() => item.getAttribute("data-turn-key"), null) ||
      (nested && safeRead(() => nested.getAttribute("data-turn-key"), null)) ||
      (keyed && safeRead(() => keyed.getAttribute("data-turn-key"), null)) ||
      (outer && safeRead(() => outer.getAttribute("data-turn-key"), null));
    return groupedKey ? `${role(item) || "turn"}:${groupedKey}` : null;
  };
  const lastAssistantId = () => itemKey(lastAssistant());

  const chatIsEmpty = () => allItems().length === 0;
  // A genuinely fresh chat: the "/" route (a conversation is /c/<id>), composer
  // rendered, no turns. An existing conversation that is still loading has a
  // /c/<id> path, so it never gates.
  const isFreshChat = () =>
    chatIsEmpty() && location.pathname === "/" && !!getEditor();

  // The composer box the Start gate hides as one unit (the form around the editor).
  const composerFrame = () => {
    const ed = getEditor();
    return ed ? (safeClosest(ed, "form") || safeRead(() => ed.parentElement, null)) : null;
  };

  // The scrollable band that actually shows the typed text. The editor node
  // itself GROWS with its content (this box scrolls it, max ~245px), so sizing
  // the "Agent is working…" cover to the editor and clamping it left a strip of
  // raw result peeking above and below the cover on a big send. Covering this box
  // instead matches exactly what is visible. It is its own grid cell, so the "+"
  // button and the right-hand icons stay outside the cover and remain usable.
  const coverTarget = () => {
    const ed = getEditor();
    if (!ed) return null;
    return safeClosest(ed, "[class*='prosemirror-parent']") || ed;
  };

  // Keep the anchor on the actual rounded composer card. ChatGPT re-renders the
  // composer subtree on every keystroke, so the bar stays in #rs-root instead of
  // being inserted into React-managed DOM. `barOutside` tells the core to position
  // the fixed bar just above this card without adding padding or changing its size.
  let followupStyle = null;
  const followupNodes = new Set();
  function setFollowupMode(on) {
    const ed = getEditor(), frame = barAnchor();
    const matches = on && frame ? [...safeQueryAll(frame, 'span, p, div')].filter(node =>
      !safeRead(() => node.children, []).length && /^(?:Work with ChatGPT|Message ChatGPT|Ask anything)$/i.test((safeRead(() => node.textContent, "") || '').trim()) &&
      (!ed || !safeRead(() => ed.contains(node), false)) && safeRead(() => node.getAttribute('contenteditable'), null) !== 'true' && !safeClosest(node, '#rs-root')) : [];
    for (const node of followupNodes) if (!matches.includes(node)) { node.removeAttribute('data-rs-followup-label'); followupNodes.delete(node); }
    if (!matches.length) return;
    if (!followupStyle) {
      followupStyle = document.createElement('style');
      followupStyle.textContent = '[data-rs-followup-label]{font-size:0!important}[data-rs-followup-label]::after{content:"Follow up";font-size:var(--rs-followup-size,14px);color:inherit}';
      document.documentElement.appendChild(followupStyle);
    }
    for (const node of matches) {
      if (!followupNodes.has(node)) node.style.setProperty('--rs-followup-size',safeStyle(node).fontSize || '14px');
      node.setAttribute('data-rs-followup-label','1');followupNodes.add(node);
    }
  }
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    const er = safeRect(ed);
    const control = submitButton();
    const heightLimit = Math.max(220, er.height + 180);
    const candidates = [];
    for (let node = safeRead(() => ed.parentElement, null), depth = 0; node && depth < 10 && node !== document.body && node !== document.documentElement; node = safeRead(() => node.parentElement, null), depth++) {
      const rect = safeRect(node);
      // A form can wrap the whole Work page; a text-scroller can cover only
      // the typed text. Neither is the rounded composer card we anchor above.
      if (!rect.width || !rect.height || rect.height > heightLimit || rect.left > er.left + 2 || rect.right < er.right - 2) continue;
      if (control && !safeRead(() => node.contains(control), false)) continue;
      const style = safeStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const semantic = safeRead(() => node.matches("[data-testid='composer'], [data-testid='composer-container'], [data-composer-surface], [class*='composer-surface']"), false);
      const rounded = Math.max(parseFloat(style.borderTopLeftRadius)||0,parseFloat(style.borderTopRightRadius)||0) >= 10;
      candidates.push({node,semantic,rounded});
    }
    const card = candidates.find(candidate => candidate.rounded) || candidates.find(candidate => candidate.semantic);
    if (card) return card.node;
    // Keep the established form fallback only when it is a bounded composer.
    const form = candidates.find(candidate => safeRead(() => candidate.node.tagName, "") === 'FORM');
    return form ? form.node : (candidates[0] ? candidates[0].node : ed);
  }

  // ── Input lock ────────────────────────────────────────────────────────────
  // ProseMirror is a contenteditable: flipping contenteditable=false blocks the
  // user, but typeAndSend temporarily re-enables it so our own injection works.
  let _locked = false;
  function setInputLock(on) {
    _locked = on;
    const ed = getEditor();
    if (!ed) return;
    if (safeRead(() => ed.tagName, "") === "TEXTAREA" || safeRead(() => ed.tagName, "") === "INPUT") ed.readOnly = on;
    else ed.setAttribute("contenteditable", on ? "false" : "true");
    if (on) ed.setAttribute("data-rs-locked", "1");
    else ed.removeAttribute("data-rs-locked");
  }

  // ── Action buttons (send / stop) ──────────────────────────────────────────
  // ChatGPT's composer has ONE submit control, #composer-submit-button, that
  // FLIPS ROLE in place: data-testid="send-button" when idle,
  // data-testid="stop-button" (aria-label "Interrompre la réponse") while
  // generating. Validated live: the two selectors matched the SAME node. So the
  // send button must be tested by ROLE, never by presence - otherwise
  // sendButton() cheerfully returns the stop square and every guarded click is
  // refused. That is exactly what stranded a tool result in the composer and
  // raised "ChatGPT did not accept the injected message after 4 attempts".
  const STOP_RE = /(?:^|\b)(stop|cancel|interrompre|arr[êe]ter|keskeyt[äa]|lopeta)(?:\b|$)/i;
  const isStopBtn = (b) => {
    if (!b || !safeRead(() => b.getAttribute, null)) return false;
    if (/stop/i.test(safeRead(() => b.getAttribute("data-testid"), null) || "")) return true;
    const label = [safeRead(() => b.getAttribute("aria-label"), null), safeRead(() => b.getAttribute("title"), null), safeRead(() => b.innerText, "")].filter(Boolean).join(" ");
    return STOP_RE.test(label);
  };
  const submitButton = () => {
    const form = composerFrame();
    const candidates = [...safeQueryAll(document, S.submitBtn)];
    if (form) candidates.push(...safeQueryAll(form, "button[type='submit'], button[aria-label*='send' i], button[data-testid*='send' i], button[aria-label*='stop' i], button[data-testid*='stop' i]"));
    else {
      const ed = getEditor();
      // Work can mount its textbox without a form. Keep the fallback local to
      // that composer so unrelated page buttons cannot submit a message.
      for (let box = ed && safeRead(() => ed.parentElement, null), depth = 0; box && depth < 5; box = safeRead(() => box.parentElement, null), depth++) {
        candidates.push(...safeQueryAll(box, "button[aria-label*='send' i], button[data-testid*='send' i], button[aria-label*='stop' i], button[data-testid*='stop' i]"));
        if (candidates.length > 1) break;
      }
    }
    return candidates.find((b) => safeRead(() => b.offsetParent, null) !== null && (!form || safeRead(() => form.contains(b), false))) || null;
  };
  const sendButton = () => {
    const b = submitButton();
    return b && !isStopBtn(b) ? b : null;
  };
  const stopButton = () => {
    const b = submitButton();
    return b && isStopBtn(b) ? b : null;
  };

  // ── Generation detection ──────────────────────────────────────────────────
  // The stop button is present for the ENTIRE generation, so detection is simple.
  // Growth tracking covers the instants around start/end AND the wedged-stop case
  // - which DOES happen on ChatGPT (seen live: the reply had finished, yet the
  // submit control stayed in its "Interrompre la réponse" role, so every send was
  // refused and the tool result was stranded in the composer). See unwedgeStop.
  function thinkingText(item) {
    if (!item || !safeRead(() => item.querySelectorAll, null)) return "";
    return [...safeQueryAll(item, S.thinking)]
      .filter((node) => !safeClosest(node, ".rs-chip") &&
        (!(safeRead(() => item.matches, null) && safeRead(() => item.matches(S.workItem), false)) || safeClosest(node, S.workItem) === item))
      .map((node) => textWithout(node, ".rs-chip")).join("\n").trim();
  }
  function streamText(item) {
    if (!item) return "";
    const thinking = thinkingText(item);
    return assistantText(item, ".rs-chip") + (thinking ? "\n" + thinking : "");
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

  // A finished ChatGPT reply renders its action strip (Copy, Good/Bad response,
  // Read aloud) once streaming ends; while a reply or its reasoning is still
  // running the strip is absent and Stop owns the composer. Stop gone plus the
  // strip on THIS assistant turn is a definitive completion signal, so the
  // watcher need not wait out the 1.5 s growth window after every turn (it was
  // most of the per-turn and startup overhead). Without the strip, or in a Work
  // chat, the conservative growth window still decides.
  const TURN_DONE_SEL = 'button[data-testid="copy-turn-action-button"],button[data-testid="good-response-turn-action-button"],button[data-testid="bad-response-turn-action-button"],button[data-testid="voice-play-turn-action-button"]';
  function turnComplete(item = lastAssistant()) {
    try {
      if (!item || stopButton() || safeQuery(document, S.workItem)) return false;
      if (safeRead(() => item.getAttribute, null) && safeRead(() => item.getAttribute("data-message-author-role"), null) === S.userRole) return false;
      const turn = safeRead(() => item.closest, null) && safeClosest(item, S.turn);
      if (!turn || safeRead(() => turn.contains(getEditor()), false)) return false;
      return !!safeQuery(turn, TURN_DONE_SEL);
    } catch { return false; }
  }

  function genActive() {
    sampleStream();
    // A native Stop control owns the composer even during a long reasoning or
    // token pause. Silence is not proof the answer finished.
    if (stopButton()) return true;
    if (Date.now() - _streamAt >= 250 && turnComplete()) return false;
    return grewWithin(timings.GEN_IDLE_MS);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton();

  // ChatGPT exposes no reliable per-turn "stopped" marker → never halted.
  const turnHalted = () => false;

  // ── Truncation "Continue generating" button ───────────────────────────────
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

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { th: 0, rp: 0 };
      return { th: thinkingText(it).length, rp: assistantText(it, ".rs-chip").length };
    } catch { return {}; }
  }

  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return {
      present: true,
      reply: assistantText(item, ".rs-chip"),
      thinking: thinkingText(item),
      item,
    };
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

  // ── Sending ───────────────────────────────────────────────────────────────
  // ProseMirror listens to the browser's native editing pipeline, so
  // document.execCommand("insertText") over a select-all reliably replaces the
  // content and fires the input events that enable the send button. Validated
  // live on chatgpt.com.
  // ChatGPT's ProseMirror has the same failure mode as Gemini's Quill: inserting
  // a large result is one uninterruptible synchronous burst on the main thread.
  // Measured live on chatgpt.com, 2026-08:
  //   - one insertText of a 1500-line / 60k-char string: tab frozen >45s, nothing
  //     clickable, no repaint, Stop button dead.
  //   - LINE COUNT is the entire cost, not size: a single 120 000-char line
  //     inserts in 13ms, because each line becomes its own ProseMirror block and
  //     every insert re-renders the document. So the char cap can stay generous
  //     and the line cap is the real lever.
  //   - line-by-line with a yield every N lines, 1200 lines: N=120 -> 11.9s total
  //     with a 4.4s worst freeze; N=25 -> 7.9s total with a 1.0s worst freeze.
  //   - a synthetic PASTE of the same 1200 lines is far faster (18ms), but it is
  //     UNUSABLE here: ChatGPT turns a pasted message into a file attachment on
  //     send. See pasteEditorText for the full story. Typing it is.
  // ChatGPT's own hard input cap, MEASURED live 2026-08-14 (not a guess, and not
  // the perf limit below): the composer's submit button silently goes `disabled`
  // once the editor holds more than ~139 300 characters - 139 300 sends, 139 500
  // does not, reproducible across repeats. It is a CLIENT-side gate, so an
  // oversized message is not rejected with a visible "too long" error, it simply
  // cannot be sent at all; nothing in the bundles exposes the constant, so the
  // boundary was bracketed by filling the editor and reading button.disabled.
  // 120 000 is kept as our cap: it is chosen for the freeze cost documented
  // above, and it happens to sit comfortably under the real ceiling, so a result
  // we are willing to send is always a result ChatGPT will accept.
  const SEND_HARD_CAP = 139300;  // measured; for reference and headroom checks
  const SEND_MAX_CHARS = 120000; // characters are essentially free (see above)
  const SEND_MAX_LINES = 600;    // the line count is what costs, and we type it
  const INSERT_CHUNK_LINES = 25; // measured sweet spot: 3.0s total, 0.4s worst freeze
  const BULK_INSERT_MAX_LINES = 220; // small/medium internal sends are faster as one native edit
  const BULK_INSERT_MAX_CHARS = 40000;

  function truncateForSend(text) {
    if(typeof window.__rsLimitOutgoing==="function")return window.__rsLimitOutgoing(text);
    if (!text) return text;
    const lines = String(text).split("\n");
    if (text.length <= SEND_MAX_CHARS && lines.length <= SEND_MAX_LINES) return text;
    const marker = (what) =>
      `\n\n[…synerixcode: result truncated (${what}) so it can be pasted into ` +
      `ChatGPT's composer without freezing the page. Do NOT re-run the command; ` +
      `work with the head and tail shown here…]\n\n`;
    let out, note;
    if (lines.length > SEND_MAX_LINES) {
      const head = Math.floor(SEND_MAX_LINES * 0.85);
      const tail = SEND_MAX_LINES - head;
      note = `${lines.length - SEND_MAX_LINES} of ${lines.length} lines omitted`;
      out = lines.slice(0, head).join("\n") + marker(note) + lines.slice(lines.length - tail).join("\n");
    } else {
      out = text;
    }
    if (out.length > SEND_MAX_CHARS) {
      const budget = SEND_MAX_CHARS - 300;
      const head = Math.floor(budget * 0.85);
      note = `${out.length - budget} of ${out.length} characters omitted`;
      out = out.slice(0, head) + marker(note) + out.slice(out.length - (budget - head));
    }
    diag("send.truncated", { from: text.length, to: out.length, lines: lines.length });
    return out;
  }

  // Select the whole composer, so whatever we insert REPLACES its contents.
  function selectAll(ed) {
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // DO NOT USE for injected sends - kept only for reference/fallback.
  //
  // A synthetic paste is by far the fastest way to fill this composer (18ms for
  // 1200 lines vs 7.9s of typing) - but ChatGPT REMEMBERS that the content was
  // pasted and, on submit, materialises it as a "Texte collé.txt" / "Pasted
  // text.txt" DOCUMENT ATTACHMENT instead of an inline message. Seen live: the
  // system prompt went out as a file, which burns the free tier's SEPARATE
  // "chats with files or images" quota and then paused the whole conversation
  // ("Chat en pause jusqu'à la réinitialisation du quota").
  //
  // The conversion is not visible at paste time - the text really is in the
  // composer, and pasting up to 400 lines / 20k chars showed no attachment chip.
  // It happens at SEND. So there is nothing to detect and fall back from: the
  // only safe path is to never paste an injected message in the first place.
  async function pasteEditorText(ed, text) {
    selectAll(ed);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    // ProseMirror applies the paste asynchronously; confirm it actually landed
    // before reporting success, so the caller can fall back if it did not.
    const want = text.trim();
    if (!want) return true;
    return await waitFor(() => (safeRead(() => ed.textContent, "") || "").trim().length > 0, 3000);
  }

  // Fallback: type it. Yielding does not make this faster - it keeps the page
  // alive while it happens, so the user can still click (and Stop still works).
  async function typeEditorText(ed, text) {
    const raw = String(text);
    if (safeRead(() => ed.tagName, "") === "TEXTAREA" || safeRead(() => ed.tagName, "") === "INPUT") {
      ed.focus();
      const setter = Object.getOwnPropertyDescriptor(
        safeRead(() => ed.tagName, "") === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value").set;
      setter.call(ed, raw);
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const lines = raw.split("\n");
    selectAll(ed);

    // For the bootstrap and other moderate internal messages, one native
    // insertText is dramatically faster than rebuilding ProseMirror one line at
    // a time. Large results keep the yielded line-by-line path below so they do
    // not freeze the tab for tens of seconds.
    if (lines.length <= BULK_INSERT_MAX_LINES && raw.length <= BULK_INSERT_MAX_CHARS) {
      const t0 = Date.now();
      const ok = document.execCommand("insertText", false, raw);
      await sleep(0);
      const got = editorText().trim();
      const tail = raw.trim().slice(-30);
      if (ok && got && (!tail || got.includes(tail))) {
        diag("send.bulkInsert", { lines: lines.length, chars: raw.length, ms: Date.now() - t0 });
        return;
      }
      // If ChatGPT rejected the bulk edit, replace whatever partial text landed
      // and fall back to the proven line-by-line path.
      selectAll(ed);
    }

    const t0 = Date.now();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
      // insertLineBreak, never a synthetic Enter: Enter is what SENDS on ChatGPT.
      if (i < lines.length - 1) document.execCommand("insertLineBreak");
      if (i && i % INSERT_CHUNK_LINES === 0) await sleep(0);
    }
    if (lines.length > INSERT_CHUNK_LINES) diag("send.insertDone", { lines: lines.length, ms: Date.now() - t0 });
  }

  // Typing is the ONLY path for injected sends: it is slower, but it produces a
  // real inline message instead of a file attachment (see pasteEditorText).
  async function setEditorText(ed, text) {
    await typeEditorText(ed, text);
  }

  async function typeAndSend(text, images) {
    const ed = getEditor();
    if (!ed) throw new Error("ChatGPT input box not found");
    text = truncateForSend(text);
    const relock = _locked;
    const oldOpacity = safeRead(() => ed.style.opacity, "");
    const oldCaret = safeRead(() => ed.style.caretColor, "");
    try {
      try { document.documentElement.classList.add("rs-chatgpt-injecting"); } catch {}
      // Internal synerixcode messages are implementation detail. Keep the composer
      // visually blank while they are inserted so the user does not watch a huge
      // system prompt or tool result appear to be pasted into their chat box.
      ed.style.opacity = "0";
      ed.style.caretColor = "transparent";
      if (relock) {
        if (safeRead(() => ed.tagName, "") === "TEXTAREA" || safeRead(() => ed.tagName, "") === "INPUT") ed.readOnly = false;
        else ed.setAttribute("contenteditable", "true");
      }
      await setEditorText(ed, text);
      // Attach images LAST, right before the send click - see gemini.js/deepseek.js
      // typeAndSend for why (attaching first and then retyping the text can sever
      // the site's binding between the pending upload and the message sent).
      if (images && images.length) {
        if (!await attachImages(images)) throw new Error('ChatGPT did not confirm the screenshot upload. Check its file/image quota or upload error; the message was not submitted.');
        const ready = await waitFor(() => !!sendButton() && !safeRead(() => sendButton().disabled, true), 25000);
        const button = ready && sendButton();
        if (!button || safeRead(() => button.disabled, true)) throw new Error('ChatGPT is not ready to send the uploaded screenshot. The message was not submitted.');
        // Commit exactly once. A delayed receipt never authorizes another click.
        button.click();
        await waitFor(() => editorText().trim() === "" || !!stopButton(), 15000);
        return;
      }
      // Wait for the control to be in its SEND role (proof ProseMirror registered
      // the text, and that no generation is in flight).
      await waitFor(() => !!sendButton(), 1500);
      // Still not a send button? Either a generation really is running (in which
      // case unwedge refuses and we fall through), or the control is stuck in its
      // stop role with nothing generating - the case that stranded the result.
      if (!sendButton()) await waitFor(() => !!sendButton() && !stopButton(), 4000);
      const btn = sendButton();
      // Disabled send = a quota wall, not a wedge. Clicking it does nothing and
      // Enter is refused too, so return now and let scanError surface the reason
      // instead of burning the caller's retries in silence.
      if (btn && safeRead(() => btn.disabled, true)) { diag("send.disabled", {}); return; }
      if (btn) {
        btn.click();
        await waitFor(() => editorText().trim() === "" || !!stopButton(), 1200);
        return;
      }
      // Stop can outlast the recovery wait during Work reasoning. Enter is
      // not a safe send fallback while that control still owns the composer.
      if (stopButton()) { diag("send.busy", {}); return; }
      // Fallback: Enter sends in ChatGPT's composer.
      const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      ed.dispatchEvent(new KeyboardEvent("keydown", o));
      ed.dispatchEvent(new KeyboardEvent("keyup", o));
      await waitFor(() => editorText().trim() === "" || !!stopButton(), 1200);
    } finally {
      try { document.documentElement.classList.remove("rs-chatgpt-injecting"); } catch {}
      const e2 = getEditor();
      if (e2) {
        safeRead(() => { e2.style.opacity = oldOpacity; }, null);
        safeRead(() => { e2.style.caretColor = oldCaret; }, null);
        if (relock) {
          if (safeRead(() => e2.tagName, "") === "TEXTAREA" || safeRead(() => e2.tagName, "") === "INPUT") safeRead(() => { e2.readOnly = true; }, null);
          else safeRead(() => e2.setAttribute("contenteditable", "false"), null);
        }
      }
    }
  }

  function clearEditor() {
    const ed = getEditor();
    if (!ed) return false;
    try {
      if (safeRead(() => ed.tagName, "") === "TEXTAREA" || safeRead(() => ed.tagName, "") === "INPUT") {
        const setter = Object.getOwnPropertyDescriptor(
          safeRead(() => ed.tagName, "") === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          "value").set;
        setter.call(ed, "");
        ed.dispatchEvent(new Event("input", { bubbles: true }));
        return editorText().trim() === "";
      }
      selectAll(ed);
      document.execCommand("insertText", false, "");
      return editorText().trim() === "";
    } catch {
      return false;
    }
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) try { b.click(); } catch {}
  }

  // No site modes to enforce on ChatGPT (model picker is left to the user).
  function enforceComposer() { return { ready: true }; }
  async function ensureComposerReady(reason) {
    diag("mode_ready", { reason, provider: "chatgpt" });
    const ed = getEditor();
    if (!ed) {
      const boxes = [...safeQueryAll(document, "textarea, [role='textbox'], [contenteditable]")];
      diag("composer.missing", { candidates: boxes.length,
        outsideTranscript: boxes.filter((e) => !safeClosest(e, S.turn) && !safeClosest(e, S.workItem)).length,
        forms: safeQueryAll(document, "form").length });
    }
    return { ready: !!ed };
  }

  // ── Error / limit detection (site chrome only) ────────────────────────────
  // A quota wall does NOT surface as an error banner: ChatGPT simply DISABLES the
  // send button (disabled=true, opacity .35, still in its send role) and prints a
  // "Chat en pause jusqu'à la réinitialisation du quota" notice. Nothing throws,
  // so without this the loop keeps re-typing into a composer that can never be
  // submitted and the bar sits on "running" forever - which is exactly what has
  // to be avoided. Reported as a normal site error so the core can end the turn
  // and tell the user.
  const sendIsDisabled = () => {
    const b = submitButton();
    return !!b && !isStopBtn(b) && safeRead(() => b.disabled, true);
  };
  // The nastier variant: the control is stuck in its STOP role AND disabled,
  // while nothing is generating. unwedgeStop() cannot help - clicking a disabled
  // button does nothing - and neither does any DOM-side nudge: an input event,
  // blur+focus and a real edit were all tried live and left it at
  // "stop-button (disabled)". Only reloading the page clears it, so the honest
  // move is to say so instead of silently retrying forever.
  const composerWedged = () => {
    const b = submitButton();
    return !!b && isStopBtn(b) && safeRead(() => b.disabled, true) && !genActive();
  };
  function pausedNotice() {
    // Only walk the DOM once the cheap signal (a disabled send) already says
    // something is wrong.
    for (const el of safeQueryAll(document, "div,p,section")) {
      if (safeRead(() => el.offsetParent, null) === null || safeRead(() => el.children, []).length > 6) continue;
      const t = (safeRead(() => el.innerText, "") || "").trim();
      if (t.length > 12 && t.length < 400 && RE.paused.test(t)) return t.slice(0, 240);
    }
    return null;
  }
  function scanError() {
    try {
      for (const el of safeQueryAll(document, S.errorSurfaces)) {
        if (safeRead(() => el.offsetParent, null) === null) continue;
        if (safeClosest(el, S.msg)) continue; // model content, not UI chrome
        const t = (safeRead(() => el.innerText, "") || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
      // Composer has our text but ChatGPT refuses to accept it.
      if (editorText().trim() !== "") {
        if (composerWedged()) {
          return "ChatGPT's composer is stuck on \"stop\" and won't send - reload the page to recover this conversation.";
        }
        if (sendIsDisabled()) {
          return pausedNotice() ||
            "ChatGPT will not accept the message - its send button is disabled (quota reached, or the chat is paused).";
        }
      }
    } catch {}
    if (!getEditor()) return "The input box disappeared (session ended?).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text);

  // ── Image attachment (best effort: paste + hidden file input) ─────────────
  function fileFromImage(img, i) {
    if (typeof synerixcodeMedia !== "undefined") return synerixcodeMedia.fileFrom(img, i);
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : "jpg";
    return new File([arr], `robloxscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }
  async function attachImages(images) {
    const ed = getEditor(), box = composerFrame();
    if (!ed || !box || !images || !images.length || images.length > 4) return false;
    const selector = "img, video, [class*='preview'], [class*='thumbnail'], [class*='attachment'], [class*='file-preview']";
    const existing = new Set(safeQueryAll(box, selector));
    const dt = new DataTransfer();
    try { images.forEach((img, i) => dt.items.add(fileFromImage(img, i))); } catch { return false; }
    if (dt.items.length !== images.length) return false;
    const fileInput = safeQuery(document, 'input[data-testid="upload-photos-input"]') || safeQuery(box, 'input[type="file"][accept*="image"]');
    ed.focus();
    // Pick one upload transport. Sending both paste and file-change duplicates
    // uploads on bundles that accept each of them.
    try {
      if (fileInput) { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); }
      else ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch { return false; }
    return await waitFor(() => safeQueryAll(composerFrame(), selector).some(node => {
      if (existing.has(node)) return false;
      if (safeRead(() => node.tagName, "") === "IMG" || safeRead(() => node.tagName, "") === "VIDEO") {
        const src = safeRead(() => node.getAttribute("src"), "") || "";
        return /^(?:blob:|data:image\/)/.test(src) || !!safeClosest(node, "[class*='preview'], [class*='thumbnail'], [class*='attachment'], [class*='file-preview']");
      }
      return true;
    }), 15000);
  }
  function clearAttachments() {
    try {
      const box = composerFrame();
      if (!box) return;
      safeQueryAll(box, "[aria-label*='upprimer'], [aria-label*='emove'], [aria-label*='Remove'], [class*='delete'], [class*='remove']")
        .forEach((d) => { try { d.click(); } catch {} });
    } catch {}
  }

  // ── New chat navigation ───────────────────────────────────────────────────
  function findNewChatButton() {
    return safeQuery(document, 'a[data-testid="create-new-chat-button"]') ||
      [...safeQueryAll(document, 'a[href="/"], button')].find(
        (a) => safeRead(() => a.offsetParent, null) !== null && /new chat|nouvelle discussion|nouveau chat/i.test(safeRead(() => a.getAttribute("aria-label"), null) || safeRead(() => a.textContent, "") || "")
      ) || null;
  }
  async function openNewChat() {
    const btn = findNewChatButton();
    if (!btn) return false;
    const prevPath = location.pathname;
    try { btn.click(); } catch {}
    await waitFor(() => location.pathname !== prevPath && chatIsEmpty() && !!getEditor(), 6000);
    await waitFor(() => chatIsEmpty() && !!getEditor(), 2000);
    return true;
  }

  // "/" = a fresh chat whose conversation id is not assigned yet → "" (transient)
  // so the core never persists it as "started"; /c/<id> = a real conversation.
  const conversationKey = () => {
    const m = String(location.pathname || "").match(/(?:^|\/)c\/[^/?#]+/);
    return m ? (m[0].startsWith("/") ? m[0] : "/" + m[0]) : "";
  };

  // ── ChatGPT-only system-prompt rules ──────────────────────────────────────
  // Appended to the shared system prompt via core/config.js's `providerNotes`
  // hook, so no other provider sees a word of this.
  //
  // Why ChatGPT needs the image rule and the others don't: ChatGPT reaches for
  // its own image GENERATION on any turn that carries an image, and answers by
  // producing a new picture instead of doing the Roblox work the image was
  // meant to illustrate. Its native image tool also runs in the sandbox that
  // cannot touch the user's project, so a generated image is a dead end here.
  const PROMPT_EXTRA = `- WHEN THE USER SENDS AN IMAGE: by default it is REFERENCE MATERIAL for the work they want done in their project - a screenshot of a bug, a mockup of the UI they want, a photo of the thing to build, a picture of what is wrong in Studio. Look at it, use it to understand what they want, and then do that work with the synerixcode commands. Do NOT generate a new image from it, and do NOT treat it as an image-editing request. Only generate an image when the user EXPLICITLY asks you to create, generate, draw or edit one ("make me an image of...", "generate a texture", "edit this picture"). If what they want from the image is genuinely unclear, ask them in one short sentence rather than guessing - and never guess "they want a picture".`;

  // ── User-send interception ────────────────────────────────────────────────
  async function writeDraft(value, expectedCurrent) {
    const ed = getEditor();
    if (!ed || editorText() !== String(expectedCurrent)) return {ok:false,reason:'draft-changed'};
    const relock = _locked;
    try { setInputLock(false); await typeEditorText(ed, String(value)); return {ok:editorText() === String(value)}; }
    finally { if(relock)setInputLock(true); }
  }
  function installSendHooks(handlers) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const ed = getEditor();
        if (!ed || !safeRead(() => ed.contains(e.target), false)) return;
        if (editorText().trim() === "") return;
        if (handlers.onCoworkSend && handlers.onCoworkSend(e)) return;
        if (handlers.isBlocked()) return;
        // No session yet → nudge toward Start, but NEVER block the send. The
        // user is entitled to just chat with ChatGPT; the extension is opt-in.
        // This used to preventDefault + stopImmediatePropagation (ported from an
        // older, stricter pattern), which made a blank ChatGPT tab impossible to
        // type in until an agent was started - a regression against every other
        // provider. Matches deepseek.js: "nudge only; never block plain chat".
        if (!handlers.isStarted()) {
          if (!chatIsEmpty()) return; // existing conversation → not ours to gate
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
        // Native "Continue generating" = a clear intent to RESUME after truncation.
        const cont = t && safeRead(() => t.closest, null) && safeClosest(t, "button");
        if (cont && RE.continueBtn.test((safeRead(() => cont.innerText, "") || "").trim())) {
          handlers.onNativeContinue();
          return;
        }
        // Stop is tested FIRST: it is the same node as send, just in its other
        // role, so a stop click would otherwise read as a user send.
        const stop = t && safeRead(() => t.closest, null) && safeClosest(t, S.stopBtn);
        if (stop) { handlers.onNativeStop(); return; }
        const btn = t && safeRead(() => t.closest, null) && safeClosest(t, S.submitBtn);
        if (!btn || isStopBtn(btn)) return;
        if (handlers.onCoworkSend && handlers.onCoworkSend(e)) return;
        if (handlers.isBlocked()) return;
        // Same as the keydown path: nudge, never block (see the comment there).
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

  // ── Tool-block location for camouflage ────────────────────────────────────
  // ChatGPT wraps each fenced code block in ONE <pre> inside .markdown (markers
  // and JSON survive intact in textContent), so a whole ###LUA###…###END_LUA###
  // or JSON command block is one atomic <pre>. Hide every <pre> in the reply
  // whose text carries a command shape, plus any bare top-level paragraph that
  // holds an inline command (the model is told to use code blocks, but this
  // catches a stray inline one). React re-creates these nodes on every token, so
  // - like Gemini - we also mark the .markdown container with .rs-cmd-mask; the
  // overlay.css rule keeps every recreated <pre> hidden with no flash.
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  // Marker pair, for the UNFENCED case below. Kept separate from CMD_SHAPE so the
  // opener test can't also match the closer.
  const CMD_OPEN = /###\s*(?:LUA|MCP_TOOL)\s*###/i;
  const CMD_CLOSE = /###\s*END_(?:LUA|MCP_TOOL)\s*###/i;

  function findToolBlockSpot(item /*, chip */) {
    const replies = replyNodes(item);
    let hidAny = null;
    const hide = (el, mc) => {
      el.classList.add("rs-tool-hide");
      if (mc) mc.classList.add("rs-cmd-mask");
      hidAny = hidAny || { parent: safeRead(() => el.parentElement, null), ref: el };
    };
    for (const mc of replies) {
      // 1. Fenced code blocks carrying a command.
      safeQueryAll(mc, S.codeWrap).forEach((pre) => {
        if (safeClosest(pre, ".rs-chip")) return;
        if (CMD_SHAPE.test(safeRead(() => pre.textContent, "") || "")) {
          const card = safeClosest(pre, '[class*="CodeBlock-"]');
          hide(card && safeRead(() => mc.contains(card), false) ? card : pre, mc);
        }
      });
      // 2. Bare top-level blocks with an inline command (no <pre> inside).
      const kids = [...safeRead(() => mc.children, [])];
      kids.forEach((el) => {
        if (safeRead(() => el.classList.contains("rs-chip"), false) || safeQuery(el, S.codeWrap)) return;
        const t = safeRead(() => el.textContent, "") || "";
        if (t.length < 600 && CMD_SHAPE.test(t)) hide(el, null);
      });
      // 3. UNFENCED command block spanning MANY siblings. Seen live 2026-08: the
      // model wrote ###LUA###…###END_LUA### as plain prose instead of a fenced
      // block, so ChatGPT's markdown renderer split a 208-line payload into 68
      // sibling <p>/<pre> nodes. Only the first one carries the marker, so the
      // per-element tests above hid the opener and left the whole script on
      // screen. Hide the RANGE: from the opener to the sibling holding the
      // closer (inclusive). Un-closed (still streaming) ⇒ hide to the end, so
      // there is no flash of raw code while it types.
      let ranged = 0;
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (safeRead(() => el.classList.contains("rs-chip"), false)) continue;
        const t = safeRead(() => el.textContent, "") || "";
        if (!CMD_OPEN.test(t)) continue;
        if (CMD_CLOSE.test(t)) { hide(el, mc); ranged++; continue; } // all in one node
        for (let j = i; j < kids.length; j++) {
          const k = kids[j];
          if (safeRead(() => k.classList.contains("rs-chip"), false)) continue;
          hide(k, mc); ranged++;
          if (CMD_CLOSE.test(safeRead(() => k.textContent, "") || "")) { i = j; break; }
        }
      }
      // Anti-reflash for the ranged case. .rs-cmd-mask only re-hides recreated
      // <pre>; the <p> siblings of an unfenced block carry nothing but their
      // per-element class, which React wipes on every token. When the range
      // covers the WHOLE reply (the observed shape - the message IS the command),
      // mark the container so every child stays hidden through re-renders. If any
      // real prose sits outside the range, we do NOT: hiding it would eat the
      // model's actual answer, and a per-token flash is the lesser evil.
      if (ranged) {
        const body = kids.filter((k) => !safeRead(() => k.classList.contains("rs-chip"), false));
        if (body.length && body.every((k) => safeRead(() => k.classList.contains("rs-tool-hide"), false))) {
          mc.classList.add("rs-cmd-mask-all");
        }
      }
    }
    // ChatGPT can render the fenced block beside .markdown under the same turn.
    // Match assistantText's sibling read without touching user-pasted JSON.
    let scope = null;
    try { scope = (safeRead(() => item.closest, null) && safeClosest(item, S.turn)) || (safeRead(() => item.closest, null) && safeClosest(item, "[data-turn-key]")); } catch {}
    if (scope && scope !== item && safeRead(() => scope.querySelectorAll, null)) {
      const userSel = "[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']";
      for (const pre of safeQueryAll(scope, "pre")) {
        try {
          if (safeClosest(pre, ".rs-chip") || safeClosest(pre, userSel) || replies.some((mc) => mc === pre || (safeRead(() => mc.contains, null) && safeRead(() => mc.contains(pre), false)))) continue;
        } catch { continue; }
        if (CMD_SHAPE.test(textWithout(pre))) hide(pre, null);
      }
    }
    return hidAny;
  }

  return {
    id: "chatgpt",
    displayName: "ChatGPT",
    timings,
    // Exported for test-chatgpt.js (the Node smoke test drives it against a stub
    // DOM). The core reads replies through itemText/classifyText, not this.
    textWithout,
    // Screenshot attachments are supported; upload/receipt checks enforce actual
    // availability instead of treating every ChatGPT account as image-blind.
    // Keep ChatGPT bootstrap comfortably below the provider's fast one-shot
    // ProseMirror insertion threshold. The full cross-provider prompt is much
    // larger; ChatGPT does not need that cost because list_commands supplies the
    // live schemas on demand and the compact prompt preserves the command rules.
    sysMaxChars: 14000,
    supportsVision: true,
    // No coverOffsetY: the cover is centred on coverTarget(), the scrolling text
    // band, whose rect centre already lines up with the composer's icons. (Sizing
    // it to the EDITOR needed a -paddingBottom/2 nudge, because that node carries
    // bottom padding as growth headroom - covering the band removes the need.)
    // React re-renders a turn's content subtree on every token, wiping any chip
    // placed inside it. Anchor chips at the turn-element level (the stable
    // data-message-author-role div), where they survive those re-renders.
    chipAtItemLevel: true,
    // ChatGPT's turn elements are semantic (data-message-author-role) and carry
    // a stable id, so the core's "has THIS send produced its reply turn yet?"
    // gate is trustworthy here - it keys off lastAssistantId, which survives the
    // list virtualization that would break a count-based test.
    reliableCounts: true,
    // No unstableWarning: the free-tier caps are real, but the pill it renders is
    // a permanently-visible floating element and it sat ON TOP of ChatGPT's own
    // Settings dialog (seen live). ChatGPT already says so itself, in the thread,
    // when a quota runs out - that is a better place for the message than a badge
    // that outranks the site's modals.
    init({ diag: d } = {}) {
      if (d) diag = d;
      // Version beacon: stamp the loaded build onto <html> so a reload can be
      // confirmed from the page (read document.documentElement.dataset.rsGptVer).
      try { document.documentElement.setAttribute("data-rs-gpt-ver", "2026-09-26_shared-turn-command-readiness"); } catch {}
    },
    // turns
    allItems, isUserItem, isAssistantItem, itemText, classifyText, setActivityFolded,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor,
    barOutside: true,
    // Cover the scrolling text band, and lift the core's 200px clamp past that
    // band's own ~245px ceiling so a full composer is covered edge to edge.
    coverTarget,
    coverMaxH: 280,
    setFollowupMode,
    followupPlaceholderTargets() {const ed=getEditor();return ed ? [ed,...safeQueryAll(ed, '[data-placeholder], [placeholder], [aria-placeholder]')] : [];},
    setInputLock, writeDraft, typeAndSend, clearEditor, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating, turnComplete,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    // actions
    attachImages, clearAttachments, openNewChat, conversationKey,
    installSendHooks, findToolBlockSpot,
    promptExtra: PROMPT_EXTRA,
    thinkingSel: S.thinking,
    // ChatGPT summarises its own context aggressively and loses the "an
    // extension executes this" part, then refuses to call commands at all. No
    // other provider has shown this, so no other provider sets these - they
    // stay on the single bootstrap prompt.
    resendSystemEvery: 6,   // user turns between re-statements
    // Ceiling for "result + system-prompt rider". Measured against the real cap
    // (SEND_HARD_CAP) rather than our 120k perf cap: the rider is added AFTER
    // truncateForSend, so budgeting at 120k would needlessly defer the rider for
    // every result over ~109k even though ChatGPT would accept the pair fine.
    // The margin absorbs the rider growing with a long user custom prompt.
    sendCharBudget: SEND_HARD_CAP - 4000,
  };
})();
