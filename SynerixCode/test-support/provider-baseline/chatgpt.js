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
//    vision is disabled here (supportsVision: false) rather than working only
//    part of the day. ChatGPT announces the quota walls itself, in the thread.
// eslint-disable-next-line no-unused-vars
const RSProvider = (() => {
  "use strict";
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
    get STABLE_MS() { return document.querySelector(S.workItem) ? 45000 : 9000; },
    RESPONSE_TIMEOUT_MS: 300000,
  };

  // ── Turn classification ───────────────────────────────────────────────────
  const role = (item) => {
    if (!item || !item.getAttribute) return null;
    if (item.matches && item.matches(S.workItem)) {
      const key = item.getAttribute("data-chatgpt-search-unit-key") || "";
      const match = key.match(/:(user|assistant)$/);
      if (match) return match[1];
      const author = item.querySelector('[data-conversation-role]');
      if (author && author.closest(S.workItem) === item) return author.getAttribute('data-conversation-role');
      return null;
    }
    const own = item.getAttribute("data-message-author-role") ||
      item.getAttribute("data-conversation-role") ||
      item.getAttribute("data-role") ||
      item.getAttribute("data-message-author");
    if (own === S.userRole || own === S.assistantRole) return own;
    const turn = item.getAttribute("data-turn");
    if (turn === S.userRole || turn === S.assistantRole) return turn;
    const conversation = item.getAttribute("data-conversation-role");
    if (conversation === S.userRole || conversation === S.assistantRole) return conversation;
    const nested = item.querySelector && item.querySelector(S.msg);
    if (nested) {
      const nestedRole = nested.getAttribute("data-message-author-role") ||
        nested.getAttribute("data-conversation-role") ||
        nested.getAttribute("data-role") ||
        nested.getAttribute("data-message-author");
      if (nestedRole === S.userRole || nestedRole === S.assistantRole) return nestedRole;
    }
    if (item.matches && item.matches("[data-user-message-bubble]")) return S.userRole;
    if (item.querySelector && item.querySelector("[data-user-message-bubble]")) return S.userRole;
    if (item.matches && item.matches(S.reply)) return S.assistantRole;
    if (item.querySelector && item.querySelector(S.reply)) return S.assistantRole;
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
    if (!root || !root.querySelector || !root.querySelector(".cm-content")) return;
    try { document.dispatchEvent(new CustomEvent("rs-cm-sync")); } catch {}
  }
  function textWithout(root, excludeSel) {
    if (!root) return "";
    syncCM(root);
    let t = "";
    const breakLine = () => { if (t && !t.endsWith("\n")) t += "\n"; };
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (excludeSel && n.matches && n.matches(excludeSel)) return;
      if (n.tagName === "BR") { t += "\n"; return; }
      // The editor's TRUE document, published by the MAIN-world tap. This is the
      // only complete source for a long block - take it and skip the subtree.
      if (n.classList && n.classList.contains("cm-content")) {
        const full = n.getAttribute("data-rs-cm");
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
      if (n.classList && n.classList.contains("cm-line")) {
        for (const c of n.childNodes) walk(c);
        t += "\n";
        return;
      }
      const isBlock = BLOCK_TAGS.test(n.tagName);
      if (isBlock) breakLine();
      for (const c of n.childNodes) walk(c);
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
    if (item.matches && item.matches(S.workItem)) {
      return [...item.querySelectorAll(S.workReply)]
        .filter((node) => node.closest(S.workItem) === item);
    }
    const out = [];
    if (item.matches && item.matches(S.reply)) out.push(item);
    if (item.querySelectorAll) out.push(...item.querySelectorAll(S.reply));
    const unique = [...new Set(out)];
    // ChatGPT sometimes nests .prose inside .markdown (or vice versa). Reading
    // both duplicates the same response and can make command text look malformed.
    // Keep only the outermost reply surface; it contains the complete rendered
    // answer, including code blocks that live beside the inner prose node.
    const top = unique.filter((node) => !unique.some((other) => {
      if (other === node || !other || !other.contains) return false;
      try { return other.contains(node); } catch { return false; }
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
      .filter((m) => !(excludeSel && m.closest && m.closest(excludeSel)))
      .map((m) => textWithout(m, excludeSel)).join("\n").trim();
    // Work separates the final reply from its heading, reasoning and tool panels.
    // Never use the whole-item fallback for those grouped turns.
    if (item.matches && item.matches(S.workItem)) return reply;
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
      try { scope = (item.closest && item.closest(S.turn)) || (item.closest && item.closest("[data-turn-key]")); } catch {}
      if (scope && scope !== item && scope.querySelectorAll) {
        const userSel = "[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']";
        const candidates = scope.querySelectorAll("pre, code, .markdown, .prose, .markdown-new-styling, [data-message-content]");
        for (const node of candidates) {
          try {
            if (excludeSel && node.closest && node.closest(excludeSel)) continue;
            if (node.closest && node.closest(userSel)) continue;
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
    if (!signal || !signal.closest) return signal;
    const work = signal.closest(S.workItem);
    if (work && !work.closest("#rs-root")) return work;
    const roleNode = signal.closest(S.msg);
    if (roleNode && !roleNode.closest("#rs-root")) return roleNode;
    const keyed = signal.closest("[data-turn-key]");
    if (keyed && !keyed.closest("#rs-root")) {
      // A current ChatGPT renderer can put the USER and ASSISTANT halves under
      // one shared data-turn-key. Split ONLY those mixed keyed wrappers. A normal
      // keyed wrapper contains one message and must stay the item root (older
      // ChatGPT builds use exactly that shape).
      let mixed = false;
      try {
        const hasUser = !!keyed.querySelector("[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']");
        const hasAssistant = !!keyed.querySelector(".markdown, .prose, .markdown-new-styling, [data-message-content], [data-message-author-role='assistant'], [data-conversation-role='assistant'], [data-role='assistant'], [data-message-author='assistant']");
        mixed = hasUser && hasAssistant;
      } catch {}
      if (mixed && signal !== keyed) {
        let cur = signal;
        while (cur && cur.parentElement && cur.parentElement !== keyed) cur = cur.parentElement;
        if (cur && cur !== keyed) return cur;
      }
      return keyed;
    }
    const outer = signal.closest(S.turn);
    if (outer && signal !== outer) {
      let cur = signal;
      while (cur && cur.parentElement && cur.parentElement !== outer) cur = cur.parentElement;
      if (cur && cur !== outer) return cur;
    }
    return signal.parentElement || signal;
  }

  let activityControlsStyle;
  function setActivityFolded(item, folded) {
    item.dataset.rsActivityFolded = folded ? '1' : '0';
    const turn = item.closest(S.turn);
    if (!turn) return;
    if (!activityControlsStyle || !activityControlsStyle.isConnected) {
      activityControlsStyle = document.createElement('style');
      activityControlsStyle.textContent = '[data-rs-activity-controls-folded="1"]{display:none!important}[data-rs-activity-turn-folded="1"]{min-height:0!important;padding-top:0!important;padding-bottom:0!important;margin-top:0!important;margin-bottom:0!important;gap:0!important}';
      document.documentElement.appendChild(activityControlsStyle);
    }
    const other = [...turn.querySelectorAll(S.msg)].some(node=>node !== item && !item.contains(node) && node.dataset.rsActivityFolded !== '1');
    turn.dataset.rsActivityTurnFolded = folded && !other ? '1' : '0';
    const actions = turn.querySelectorAll('button[data-testid$="-turn-action-button"],button[aria-label="Copy"],button[aria-label="Read aloud"],button[aria-label="Good response"],button[aria-label="Bad response"]');
    for (const button of actions) {
      const owner = button.closest(S.msg);
      if (other && owner !== item && !(owner && item.contains(owner))) continue;
      // Hide only the action strip, never the virtualized conversation wrapper
      // or a sibling user's message. Keep React-owned children in place.
      let strip = button;
      for (let parent = button.parentElement; parent && parent !== turn && parent !== item; parent = parent.parentElement) {
        if (parent.querySelector('[data-message-author-role],.markdown,.prose,.rs-chip,.rs-chat-activity')) break;
        strip = parent;
      }
      strip.dataset.rsActivityControlsFolded = folded ? '1' : '0';
    }
  }
  const allItems = () => {
    const signals = [...document.querySelectorAll(`${S.msg}, [data-user-message-bubble], ${S.reply}, ${S.workItem}`)]
      .filter((e) => !e.closest("#rs-root"));
    const items = [];
    const seen = new Set();
    for (const signal of signals) {
      const root = itemRoot(signal);
      if (!root || seen.has(root) || root.closest("#rs-root")) continue;
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
      try { if (parent.contains) return parent.contains(child); } catch {}
      for (let n = child.parentElement; n; n = n.parentElement) if (n === parent) return true;
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
    const nodes = [...document.querySelectorAll(S.editor)].filter((e) => !e.closest("#rs-root"));
    // Work's composer can be a textarea or a textbox outside a <form>, with
    // "Work with ChatGPT" as its only stable cue. Do not mistake a transcript
    // code editor or an unrelated search field for the chat composer.
    const workCue = /work with chatgpt|message chatgpt|ask chatgpt/i;
    const workNodes = [...document.querySelectorAll("textarea, [role='textbox'], [contenteditable]")]
      .filter((e) => !e.closest("#rs-root") && !e.closest(S.turn) &&
        !e.closest(S.workItem) && !e.closest("[data-message-author-role]") &&
        workCue.test([e.getAttribute("placeholder"), e.getAttribute("data-placeholder"),
          e.getAttribute("aria-placeholder"), e.getAttribute("aria-label"),
          e.parentElement && e.parentElement.getAttribute("data-placeholder"),
          (e.textContent || "").trim().slice(0, 80)].filter(Boolean).join(" ")));
    for (const e of workNodes) if (!nodes.includes(e)) nodes.unshift(e);
    const visible = nodes.find((e) => {
      try {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
      } catch { return false; }
    });
    return visible || nodes[0] || null;
  };
  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (e.tagName === "TEXTAREA" || e.tagName === "INPUT") return e.value || "";
    return e.textContent || "";
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
    if (!item || !item.getAttribute) return null;
    if (item.matches && item.matches(S.workItem)) {
      const ids = (item.getAttribute("data-chatgpt-search-message-ids") || "").trim().split(/\s+/).filter(Boolean);
      return ids.length ? [...new Set(ids)].join(" ") : item.getAttribute("data-chatgpt-search-unit-key");
    }
    const nested = item.querySelector && item.querySelector("[data-message-id], [data-turn-key]");
    const keyed = item.closest && item.closest("[data-turn-key]");
    const outer = item.closest && item.closest(S.turn);
    const direct = item.getAttribute("data-message-id") ||
      item.getAttribute("data-turn-id") ||
      item.getAttribute("data-testid") ||
      item.id ||
      (nested && nested.getAttribute("data-message-id")) ||
      (outer && (outer.getAttribute("data-turn-id") || outer.getAttribute("data-testid")));
    if (direct) return direct;
    // The 2026-09 renderer groups user + assistant content under one stable
    // data-turn-key. Prefix the role so the assistant identity cannot collide
    // with the user half of the same grouped turn.
    const groupedKey = item.getAttribute("data-turn-key") ||
      (nested && nested.getAttribute("data-turn-key")) ||
      (keyed && keyed.getAttribute("data-turn-key")) ||
      (outer && outer.getAttribute("data-turn-key"));
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
    return ed ? (ed.closest("form") || ed.parentElement) : null;
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
    return ed.closest("[class*='prosemirror-parent']") || ed;
  };

  // Keep the anchor on the actual rounded composer card. ChatGPT re-renders the
  // composer subtree on every keystroke, so the bar stays in #rs-root instead of
  // being inserted into React-managed DOM. `barOutside` tells the core to position
  // the fixed bar just above this card without adding padding or changing its size.
  let followupStyle = null;
  const followupNodes = new Set();
  function setFollowupMode(on) {
    const ed = getEditor(), frame = barAnchor();
    const matches = on && frame ? [...frame.querySelectorAll('span, p, div')].filter(node =>
      !node.children.length && /^(?:Work with ChatGPT|Message ChatGPT|Ask anything)$/i.test((node.textContent || '').trim()) &&
      (!ed || !ed.contains(node)) && node.getAttribute('contenteditable') !== 'true' && !node.closest('#rs-root')) : [];
    for (const node of followupNodes) if (!matches.includes(node)) { node.removeAttribute('data-rs-followup-label'); followupNodes.delete(node); }
    if (!matches.length) return;
    if (!followupStyle) {
      followupStyle = document.createElement('style');
      followupStyle.textContent = '[data-rs-followup-label]{font-size:0!important}[data-rs-followup-label]::after{content:"Follow up";font-size:var(--rs-followup-size,14px);color:inherit}';
      document.documentElement.appendChild(followupStyle);
    }
    for (const node of matches) {
      if (!followupNodes.has(node)) node.style.setProperty('--rs-followup-size',getComputedStyle(node).fontSize || '14px');
      node.setAttribute('data-rs-followup-label','1');followupNodes.add(node);
    }
  }
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    const er = ed.getBoundingClientRect();
    const control = submitButton();
    const heightLimit = Math.max(220, er.height + 180);
    const candidates = [];
    for (let node = ed.parentElement, depth = 0; node && depth < 10 && node !== document.body && node !== document.documentElement; node = node.parentElement, depth++) {
      const rect = node.getBoundingClientRect();
      // A form can wrap the whole Work page; a text-scroller can cover only
      // the typed text. Neither is the rounded composer card we anchor above.
      if (!rect.width || !rect.height || rect.height > heightLimit || rect.left > er.left + 2 || rect.right < er.right - 2) continue;
      if (control && !node.contains(control)) continue;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const semantic = node.matches("[data-testid='composer'], [data-testid='composer-container'], [data-composer-surface], [class*='composer-surface']");
      const rounded = Math.max(parseFloat(style.borderTopLeftRadius)||0,parseFloat(style.borderTopRightRadius)||0) >= 10;
      candidates.push({node,semantic,rounded});
    }
    const card = candidates.find(candidate => candidate.rounded) || candidates.find(candidate => candidate.semantic);
    if (card) return card.node;
    // Keep the established form fallback only when it is a bounded composer.
    const form = candidates.find(candidate => candidate.node.tagName === 'FORM');
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
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") ed.readOnly = on;
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
    if (!b || !b.getAttribute) return false;
    if (/stop/i.test(b.getAttribute("data-testid") || "")) return true;
    const label = [b.getAttribute("aria-label"), b.getAttribute("title"), b.innerText].filter(Boolean).join(" ");
    return STOP_RE.test(label);
  };
  const submitButton = () => {
    const form = composerFrame();
    const candidates = [...document.querySelectorAll(S.submitBtn)];
    if (form) candidates.push(...form.querySelectorAll(
      "button[type='submit'], button[aria-label*='send' i], button[data-testid*='send' i], button[aria-label*='stop' i], button[data-testid*='stop' i]"
    ));
    else {
      const ed = getEditor();
      // Work can mount its textbox without a form. Keep the fallback local to
      // that composer so unrelated page buttons cannot submit a message.
      for (let box = ed && ed.parentElement, depth = 0; box && depth < 5; box = box.parentElement, depth++) {
        candidates.push(...box.querySelectorAll(
          "button[aria-label*='send' i], button[data-testid*='send' i], button[aria-label*='stop' i], button[data-testid*='stop' i]"));
        if (candidates.length > 1) break;
      }
    }
    return candidates.find((b) => b.offsetParent !== null && (!form || form.contains(b))) || null;
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
    if (!item || !item.querySelectorAll) return "";
    return [...item.querySelectorAll(S.thinking)]
      .filter((node) => !node.closest(".rs-chip") &&
        (!(item.matches && item.matches(S.workItem)) || node.closest(S.workItem) === item))
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
      if (!item || stopButton() || document.querySelector(S.workItem)) return false;
      if (item.getAttribute && item.getAttribute("data-message-author-role") === S.userRole) return false;
      const turn = item.closest && item.closest(S.turn);
      if (!turn || turn.contains(getEditor())) return false;
      return !!turn.querySelector(TURN_DONE_SEL);
    } catch { return false; }
  }

  const WEDGE_MS = 10000;
  let _stopSince = 0;
  function genActive() {
    sampleStream();
    const stop = !!stopButton();
    const now = Date.now();
    if (stop && !assistantText(lastAssistant()).trim()) {
      // A fresh Work chat has no search unit until its first turn renders.
      // The Stop control is already present while that turn is still thinking.
      return true;
    }
    if (stop && document.querySelector(S.workItem)) {
      // Work can reason after the final-answer node appears. Wait for its
      // answer or thinking stream to settle before consuming a command.
      return grewWithin(45000);
    }
    if (stop) {
      if (!_stopSince) _stopSince = now;
      // Trust the stop button while the stream advances, or just after it
      // appeared (generation spinning up). Frozen past WEDGE_MS ⇒ treat as done.
      return (now - _streamAt < WEDGE_MS) || (now - _stopSince < 2000);
    }
    _stopSince = 0;
    if (now - _streamAt >= 250 && turnComplete()) return false;
    return grewWithin(timings.GEN_IDLE_MS);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton();

  // Clicking the frozen stop returns the control to its send role, so the pending
  // injection can go out. Guarded by genActive so a genuinely live generation is
  // NEVER aborted - during a real stream every attempt below is refused.
  function unwedgeStop() {
    const stop = stopButton();
    if (stop && !genActive() && !document.querySelector(S.workItem)) {
      diag("send.unwedge", {});
      try { stop.click(); } catch {}
      return true;
    }
    return false;
  }

  // One attempt is not enough: genActive() latches true for 2s from the FIRST
  // moment it sees a stop button (_stopSince), so an attempt made right after the
  // page or the turn came up is refused by that latch alone. Retry across the
  // window, then confirm the send role actually came back. (Same reasoning as
  // gemini.js, where a single attempt let the system prompt sit in the composer.)
  async function unwedgeStopPersistently(totalMs = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < totalMs) {
      if (sendButton()) return true;
      if (unwedgeStop() && await waitFor(() => !!sendButton(), 1500)) return true;
      await sleep(250);
    }
    return !!sendButton();
  }

  // ChatGPT exposes no reliable per-turn "stopped" marker → never halted.
  const turnHalted = () => false;

  // ── Truncation "Continue generating" button ───────────────────────────────
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
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
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
    return await waitFor(() => (ed.textContent || "").trim().length > 0, 3000);
  }

  // Fallback: type it. Yielding does not make this faster - it keeps the page
  // alive while it happens, so the user can still click (and Stop still works).
  async function typeEditorText(ed, text) {
    const raw = String(text);
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      ed.focus();
      const setter = Object.getOwnPropertyDescriptor(
        ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
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
    const oldOpacity = ed.style.opacity;
    const oldCaret = ed.style.caretColor;
    try { document.documentElement.classList.add("rs-chatgpt-injecting"); } catch {}
    // Internal synerixcode messages are implementation detail. Keep the composer
    // visually blank while they are inserted so the user does not watch a huge
    // system prompt or tool result appear to be pasted into their chat box.
    ed.style.opacity = "0";
    ed.style.caretColor = "transparent";
    if (relock) {
      if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") ed.readOnly = false;
      else ed.setAttribute("contenteditable", "true");
    }
    try {
      await setEditorText(ed, text);
      // Attach images LAST, right before the send click - see gemini.js/deepseek.js
      // typeAndSend for why (attaching first and then retyping the text can sever
      // the site's binding between the pending upload and the message sent).
      if (images && images.length) {
        try { await attachImages(images); } catch {}
        // ChatGPT disables the send button while an upload is still in flight, so
        // poll the click instead of gating on a specific "upload done" node.
        const t0 = Date.now();
        while (Date.now() - t0 < 25000) {
          const b = sendButton();
          if (b && !b.disabled) { try { b.click(); } catch {} }
          if (await waitFor(() => editorText().trim() === "" || !!stopButton(), 1200)) return;
        }
        return;
      }
      // Wait for the control to be in its SEND role (proof ProseMirror registered
      // the text, and that no generation is in flight).
      await waitFor(() => !!sendButton(), 1500);
      // Still not a send button? Either a generation really is running (in which
      // case unwedge refuses and we fall through), or the control is stuck in its
      // stop role with nothing generating - the case that stranded the result.
      if (!sendButton()) await unwedgeStopPersistently();
      const btn = sendButton();
      // Disabled send = a quota wall, not a wedge. Clicking it does nothing and
      // Enter is refused too, so return now and let scanError surface the reason
      // instead of burning the caller's retries in silence.
      if (btn && btn.disabled) { diag("send.disabled", {}); return; }
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
        e2.style.opacity = oldOpacity;
        e2.style.caretColor = oldCaret;
        if (relock) {
          if (e2.tagName === "TEXTAREA" || e2.tagName === "INPUT") e2.readOnly = true;
          else e2.setAttribute("contenteditable", "false");
        }
      }
    }
  }

  function clearEditor() {
    const ed = getEditor();
    if (!ed) return false;
    try {
      if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
        const setter = Object.getOwnPropertyDescriptor(
          ed.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
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
      const boxes = [...document.querySelectorAll("textarea, [role='textbox'], [contenteditable]")];
      diag("composer.missing", { candidates: boxes.length,
        outsideTranscript: boxes.filter((e) => !e.closest(S.turn) && !e.closest(S.workItem)).length,
        forms: document.querySelectorAll("form").length });
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
    return !!b && !isStopBtn(b) && b.disabled;
  };
  // The nastier variant: the control is stuck in its STOP role AND disabled,
  // while nothing is generating. unwedgeStop() cannot help - clicking a disabled
  // button does nothing - and neither does any DOM-side nudge: an input event,
  // blur+focus and a real edit were all tried live and left it at
  // "stop-button (disabled)". Only reloading the page clears it, so the honest
  // move is to say so instead of silently retrying forever.
  const composerWedged = () => {
    const b = submitButton();
    return !!b && isStopBtn(b) && b.disabled && !genActive();
  };
  function pausedNotice() {
    // Only walk the DOM once the cheap signal (a disabled send) already says
    // something is wrong.
    for (const el of document.querySelectorAll("div,p,section")) {
      if (el.offsetParent === null || el.children.length > 6) continue;
      const t = (el.innerText || "").trim();
      if (t.length > 12 && t.length < 400 && RE.paused.test(t)) return t.slice(0, 240);
    }
    return null;
  }
  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        if (el.closest(S.msg)) continue; // model content, not UI chrome
        const t = (el.innerText || "").trim();
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
    const ed = getEditor();
    if (!ed || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    // The real upload input (validated live 2026-08); the generic selector is a
    // fallback in case the testid is renamed.
    const fileInput = document.querySelector('input[data-testid="upload-photos-input"]') ||
      document.querySelector('input[type="file"]');
    if (fileInput) {
      try { fileInput.files = dt.files; fileInput.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    // An upload preview appearing near the composer is the success signal.
    return await waitFor(() => {
      const box = composerFrame();
      return !!(box && box.querySelector("img, video, [class*='preview'], [class*='thumbnail'], [class*='attachment'], [class*='file-preview']"));
    }, 15000);
  }
  function clearAttachments() {
    try {
      const box = composerFrame();
      if (!box) return;
      box.querySelectorAll("[aria-label*='upprimer'], [aria-label*='emove'], [aria-label*='Remove'], [class*='delete'], [class*='remove']")
        .forEach((d) => { try { d.click(); } catch {} });
    } catch {}
  }

  // ── New chat navigation ───────────────────────────────────────────────────
  function findNewChatButton() {
    return document.querySelector('a[data-testid="create-new-chat-button"]') ||
      [...document.querySelectorAll('a[href="/"], button')].find(
        (a) => a.offsetParent !== null && /new chat|nouvelle discussion|nouveau chat/i.test(a.getAttribute("aria-label") || a.textContent || "")
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
    setInputLock(false);
    try { await typeEditorText(ed, String(value)); return {ok:editorText() === String(value)}; }
    finally { if(relock)setInputLock(true); }
  }
  function installSendHooks(handlers) {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const ed = getEditor();
        if (!ed || !ed.contains(e.target)) return;
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
        const cont = t && t.closest && t.closest("button");
        if (cont && RE.continueBtn.test((cont.innerText || "").trim())) {
          handlers.onNativeContinue();
          return;
        }
        // Stop is tested FIRST: it is the same node as send, just in its other
        // role, so a stop click would otherwise read as a user send.
        const stop = t && t.closest && t.closest(S.stopBtn);
        if (stop) { handlers.onNativeStop(); return; }
        const btn = t && t.closest && t.closest(S.submitBtn);
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
      hidAny = hidAny || { parent: el.parentElement, ref: el };
    };
    for (const mc of replies) {
      // 1. Fenced code blocks carrying a command.
      mc.querySelectorAll(S.codeWrap).forEach((pre) => {
        if (pre.closest(".rs-chip")) return;
        if (CMD_SHAPE.test(pre.textContent || "")) {
          const card = pre.closest('[class*="CodeBlock-"]');
          hide(card && mc.contains(card) ? card : pre, mc);
        }
      });
      // 2. Bare top-level blocks with an inline command (no <pre> inside).
      const kids = [...mc.children];
      kids.forEach((el) => {
        if (el.classList.contains("rs-chip") || el.querySelector(S.codeWrap)) return;
        const t = el.textContent || "";
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
        if (el.classList.contains("rs-chip")) continue;
        const t = el.textContent || "";
        if (!CMD_OPEN.test(t)) continue;
        if (CMD_CLOSE.test(t)) { hide(el, mc); ranged++; continue; } // all in one node
        for (let j = i; j < kids.length; j++) {
          const k = kids[j];
          if (k.classList.contains("rs-chip")) continue;
          hide(k, mc); ranged++;
          if (CMD_CLOSE.test(k.textContent || "")) { i = j; break; }
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
        const body = kids.filter((k) => !k.classList.contains("rs-chip"));
        if (body.length && body.every((k) => k.classList.contains("rs-tool-hide"))) {
          mc.classList.add("rs-cmd-mask-all");
        }
      }
    }
    // ChatGPT can render the fenced block beside .markdown under the same turn.
    // Match assistantText's sibling read without touching user-pasted JSON.
    let scope = null;
    try { scope = (item.closest && item.closest(S.turn)) || (item.closest && item.closest("[data-turn-key]")); } catch {}
    if (scope && scope !== item && scope.querySelectorAll) {
      const userSel = "[data-user-message-bubble], [data-message-author-role='user'], [data-conversation-role='user'], [data-role='user'], [data-message-author='user']";
      for (const pre of scope.querySelectorAll("pre")) {
        try {
          if (pre.closest(".rs-chip") || pre.closest(userSel) || replies.some((mc) => mc === pre || (mc.contains && mc.contains(pre)))) continue;
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
    // Vision OFF, deliberately (NOT a leftover DeepSeek-style tab rule: DeepSeek
    // unified its models in 2026-09 and its getter is capability-based now).
    // ChatGPT's free tier caps
    // image/file input separately from messages ("les fichiers, les images et
    // l'analyse sont indisponibles jusqu'à la réinitialisation de votre quota"),
    // so screen_capture would work sometimes and fail the rest of the time - the
    // worst kind of behaviour to hand a model. The core blocks the vision tools
    // outright instead (see main.js VISION_TOOLS).
    // Keep ChatGPT bootstrap comfortably below the provider's fast one-shot
    // ProseMirror insertion threshold. The full cross-provider prompt is much
    // larger; ChatGPT does not need that cost because list_commands supplies the
    // live schemas on demand and the compact prompt preserves the command rules.
    sysMaxChars: 14000,
    supportsVision: false,
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
    followupPlaceholderTargets() {const ed=getEditor();return ed ? [ed,...ed.querySelectorAll('[data-placeholder], [placeholder], [aria-placeholder]')] : [];},
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
