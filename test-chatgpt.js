// Quick Node smoke test for providers/chatgpt.js (run: node test-chatgpt.js).
// Not shipped.
//
// Why this exists: every ChatGPT bug fixed in 1.5.1 was a READING bug, not a
// parsing one - the parser was fine, the text handed to it was wrong. ChatGPT
// renders code blocks with CodeMirror, which emits one element per line and NO
// newline characters at all, so a naive read glued a whole script onto one line
// ("your code block was empty"), and past a few thousand characters CodeMirror
// stops rendering the rest of a long line, so commands ran truncated. Those are
// exactly the regressions this file guards.
//
// The provider is a browser IIFE, so it is evaluated here against a minimal
// stub DOM (below) - just enough of the Node/Element surface that textWithout
// walks. No jsdom, no npm install: the repo has no dependencies and this test
// keeps it that way.
const fs = require("fs");

// ── Stub DOM ────────────────────────────────────────────────────────────────
// el("div", {class, attrs}, children) / txt("…"). Only the members textWithout
// touches are implemented; anything else stays undefined on purpose so a future
// change that needs more DOM fails loudly here instead of silently passing.
function txt(v) {
  return { nodeType: 3, nodeValue: v, childNodes: [] };
}
function el(tag, opts, children) {
  const o = opts || {};
  const classes = (o.class || "").split(/\s+/).filter(Boolean);
  const attrs = o.attrs || {};
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: (children || []).map((c) => (typeof c === "string" ? txt(c) : c)),
    classList: { contains: (c) => classes.includes(c) },
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    matches: (sel) => classes.some((c) => sel.split(",").map((s) => s.trim()).includes("." + c)),
  };
  node.querySelector = (sel) => {
    const hit = (n) => {
      if (n.nodeType !== 1) return null;
      if (n.matches(sel)) return n;
      for (const c of n.childNodes) { const r = hit(c); if (r) return r; }
      return null;
    };
    for (const c of node.childNodes) { const r = hit(c); if (r) return r; }
    return null;
  };
  return node;
}

// ── Load the provider against the stub globals ──────────────────────────────
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  dispatchEvent: () => {},
  documentElement: { classList: { contains: () => false } },
  body: null,
};
global.window = { location: { pathname: "/" }, addEventListener: () => {} };
global.location = global.window.location;
global.CustomEvent = class { constructor(t) { this.type = t; } };
global.MutationObserver = class { observe() {} disconnect() {} };
global.getComputedStyle = () => ({});
const P = new Function(
  fs.readFileSync(__dirname + "/providers/chatgpt.js", "utf8") + "; return RSProvider;"
)();

const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

// ── The CodeMirror line collapse (the 1.5.1 headline bug) ───────────────────
// A code block is <div class="cm-content"> with one <div class="cm-line"> per
// source line and no newline text nodes anywhere. Reading it with textContent
// returns `###LUA###return 1+1###END_LUA###` - one line, unparseable. Every
// cm-line must terminate.
const cmBlock = (lines, attrs) =>
  el("div", { class: "cm-content", attrs: attrs || {} },
     lines.map((l) => el("div", { class: "cm-line" }, l === "" ? [] : [l])));

const collapsed = P.textWithout(cmBlock(["###LUA###", "return 1+1", "###END_LUA###"]));
ok("cm-lines are newline-terminated", collapsed.includes("###LUA###\nreturn 1+1\n###END_LUA###"));

// A blank source line is an EMPTY cm-line. Swallowing it shifts every Luau
// error line number reported afterwards, so it must survive as "\n".
const blanks = P.textWithout(cmBlock(["local a = 1", "", "return a"]));
ok("empty cm-line survives as a blank line", /local a = 1\n\nreturn a/.test(blanks));

// ── The MAIN-world tap wins over the rendered lines ─────────────────────────
// Past ~2000-4000 chars CodeMirror renders only PART of a long line, so the
// visible lines are a truncated copy. providers/chatgpt-cm.js publishes the
// editor's true document on data-rs-cm; when present it must be used verbatim
// and the (short) rendered subtree ignored - this is what made a 21k-character
// command stop executing cut off.
const full = '{"command":"multi_edit","params":{"edits":[{"old_string":"a","new_string":"' + "x".repeat(5000) + '"}]}}';
const tapped = P.textWithout(cmBlock(['{"command":"multi_edit","params":{"edits":[{"old_str'], { "data-rs-cm": full }));
ok("data-rs-cm tap is preferred over rendered lines", tapped.includes(full));
ok("tapped block parses as JSON", (() => {
  const s = tapped.slice(tapped.indexOf("{"), tapped.lastIndexOf("}") + 1);
  try { return JSON.parse(s).params.edits[0].new_string.length === 5000; } catch { return false; }
})());
// An EMPTY tap value is still a real document (an empty editor), not a missing
// attribute: getAttribute must be checked against null, never falsiness.
const emptyTap = P.textWithout(cmBlock(["stale rendered text"], { "data-rs-cm": "" }));
ok("empty tap value is honoured, not treated as absent", !emptyTap.includes("stale"));

// ── Ordinary prose is untouched ─────────────────────────────────────────────
// Block elements break lines; inline text must not gain stray newlines, or the
// core's marker matching sees a shape the model never wrote.
const prose = P.textWithout(
  el("div", {}, [
    el("p", {}, ["Running the command now:"]),
    el("p", {}, ["Done ", el("strong", {}, ["with"]), " no gaps."]),
  ])
);
ok("blocks separate, inline text stays joined", /Running the command now:\nDone with no gaps\./.test(prose));
// (A block closes with a trailing newline of its own - hence the optional \n.)
ok("a <br> is a newline", /^a\nb\n?$/.test(P.textWithout(el("p", {}, ["a", el("br", {}), "b"]))));

// ── excludeSel ──────────────────────────────────────────────────────────────
// The core passes ".rs-chip" so its own injected chip never counts as model
// output (a chip echoing a tool name would otherwise re-trigger the call).
const withChip = P.textWithout(
  el("div", {}, [el("p", {}, ["real reply"]), el("div", { class: "rs-chip" }, ["execute_luau · 2s"])]),
  ".rs-chip"
);
ok("excluded subtree is skipped", withChip.includes("real reply") && !withChip.includes("execute_luau"));

// ── Current ChatGPT inner turn containers ──────────────────────────────────
// ChatGPT may virtualize the OUTER conversation-turn wrapper. elio should
// enumerate from real content signals and return the nearest inner stable
// data-turn-key/message container instead, so hiding a system/result turn does
// not collapse the outer virtualization node.
function innerTurn(kind, key) {
  const root = {
    id: "",
    parentElement: null,
    getAttribute: (n) => n === "data-turn-key" ? key : null,
    matches: () => false,
    closest: (sel) => sel === "[data-turn-key]" ? root : null,
    querySelector: (sel) => {
      if (kind === "user" && sel.includes("data-user-message-bubble")) return signal;
      if (kind === "assistant" && sel.includes(".markdown")) return signal;
      return null;
    },
    querySelectorAll: (sel) => kind === "assistant" && sel.includes(".markdown") ? [signal] : [],
  };
  const signal = {
    parentElement: root,
    matches: (sel) => kind === "assistant" ? sel === ".markdown" : sel === "[data-user-message-bubble]",
    closest: (sel) => {
      if (sel === "[data-message-author-role]") return null;
      if (sel === "[data-turn-key]") return root;
      if (sel === "#rs-root") return null;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null,
  };
  return { root, signal };
}
const userTurn = innerTurn("user", "u-key");
const assistantTurn = innerTurn("assistant", "a-key");
global.document.querySelectorAll = (sel) =>
  sel.includes("data-user-message-bubble") && sel.includes(".markdown")
    ? [userTurn.signal, assistantTurn.signal]
    : [];
ok("inner ChatGPT turns are counted", P.userCount() === 1 && P.assistantCount() === 1);
ok("inner roots classify user/assistant", P.isUserItem(userTurn.root) && P.isAssistantItem(assistantTurn.root));
ok("inner turn key is stable", P.itemKey(assistantTurn.root) === "assistant:a-key");

// ── 2026-09 grouped renderer ───────────────────────────────────────────────
// Current ChatGPT can group both halves of an exchange under one data-turn-key
// and mark the assistant content with data-conversation-role instead of
// data-message-author-role. Some A/B variants also omit the .markdown wrapper.
// The role node itself must therefore be a valid readable assistant item, and
// its identity must be role-prefixed so it cannot collide with the user half.
const groupedRoot = {
  parentElement: null,
  getAttribute: (n) => n === "data-turn-key" ? "group-key" : null,
  closest: (sel) => sel === "[data-turn-key]" ? groupedRoot : null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
const groupedAssistant = el("div", { attrs: { "data-conversation-role": "assistant" } }, [
  '{"command":"list_commands","params":{}}'
]);
groupedAssistant.parentElement = groupedRoot;
groupedAssistant.closest = (sel) => {
  if (sel.includes("[data-conversation-role]")) return groupedAssistant;
  if (sel === "[data-turn-key]") return groupedRoot;
  if (sel === "#rs-root") return null;
  return null;
};
ok("grouped assistant role is detected", P.isAssistantItem(groupedAssistant));
ok("grouped assistant text falls back to role node", P.itemText(groupedAssistant).includes('"command":"list_commands"'));
ok("grouped assistant key is role-prefixed", P.itemKey(groupedAssistant) === "assistant:group-key");
const previousQuerySelectorAll = global.document.querySelectorAll;
global.document.querySelectorAll = (sel) => sel.includes("[data-conversation-role]") ? [groupedAssistant] : [];
ok("grouped renderer assistant is enumerated", P.assistantCount() === 1);
ok("grouped renderer assistant id advances", P.lastAssistantId() === "assistant:group-key");
ok("grouped renderer reply is readable", P.readAssistant().reply.includes('"command":"list_commands"'));
global.document.querySelectorAll = previousQuerySelectorAll;

// Fresh Work chats show Stop while reasoning before a search unit exists.
const freshStop = { offsetParent: {}, getAttribute: (name) => name === "data-testid" ? "stop-button" : null };
const queryBeforeFreshStop = global.document.querySelector;
const queryAllBeforeFreshStop = global.document.querySelectorAll;
global.document.querySelector = () => null;
global.document.querySelectorAll = (sel) => sel.includes("composer-submit-button") ? [freshStop] : [];
ok("fresh Work reasoning remains generating before its first unit", P.isGenerating());
global.document.querySelector = queryBeforeFreshStop;
global.document.querySelectorAll = queryAllBeforeFreshStop;

// ── Work layout: separate search units and final-answer container ──────────
const workSelector = "[data-chatgpt-search-unit-key][data-chatgpt-search-message-ids]";
function workUnit(kind, n) {
  const unit = el("div", { attrs: {
    "data-chatgpt-search-unit-key": `fallback-turn-${n}:${kind === "user" ? 0 : 1}:${kind}`,
    "data-chatgpt-search-message-ids": kind === "assistant" ? `reply-${n} reply-${n}` : `user-${n}`,
  } }, []);
  unit.matches = (sel) => sel === workSelector;
  unit.closest = (sel) => sel === workSelector ? unit : null;
  return unit;
}
const workUser = workUnit("user", 0);
const workAssistant = workUnit("assistant", 0);
const workFinal = el("div", { attrs: { "data-markdown-text-style": "assistant-message" } }, ['{"command":"list_commands"}']);
const workThought = el("div", { attrs: { "data-markdown-text-style": "thinking" } }, ['{"command":"unsafe_thought"}']);
workFinal.closest = (sel) => sel === workSelector ? workAssistant : null;
workThought.closest = (sel) => sel === workSelector ? workAssistant : (sel === ".rs-chip" ? null : null);
workAssistant.querySelectorAll = (sel) => sel.includes('assistant-message') ? [workFinal] : sel.includes('thinking') ? [workThought] : [];
const beforeWork = global.document.querySelectorAll;
global.document.querySelectorAll = (sel) => sel.includes("data-chatgpt-search-unit-key") ? [workUser, workAssistant] : [];
ok("Work units are separate turns", P.userCount() === 1 && P.assistantCount() === 1);
ok("Work reply identity is stable", P.lastAssistantId() === "reply-0");
ok("Work final command is readable", P.readAssistant().reply.includes('"command":"list_commands"'));
ok("Work thought is not a command", !P.readAssistant().reply.includes("unsafe_thought") && P.readAssistant().thinking.includes("unsafe_thought"));
const workPre = el("pre", {}, ['{"command":"list_commands"}']);
workPre.textContent = '{"command":"list_commands"}';
const workCard = el("div", { class: "CodeBlock-test" }, [workPre]);
workCard.classList.add = (name) => { workCard.hiddenClass = name; };
workCard.querySelector = () => workPre;
workPre.closest = (sel) => sel.includes("CodeBlock-") ? workCard : null;
workFinal.childNodes = [workCard];
workFinal.children = [workCard];
workFinal.contains = (node) => node === workCard || node === workPre;
workFinal.querySelectorAll = (sel) => sel === "pre" ? [workPre] : [];
workFinal.classList.add = () => {};
ok("Work command hides its whole code card", !!P.findToolBlockSpot(workAssistant) && workCard.hiddenClass === "rs-tool-hide");
global.document.querySelectorAll = beforeWork;

// ── Nested same-role wrappers must collapse to one real turn ────────────────
// Current ChatGPT may put data-conversation-role="assistant" on an outer node
// and data-message-author-role="assistant" on the inner message node. They are
// one reply, not two assistant turns.
const nestedOuter = {
  parentElement: null,
  getAttribute: (n) => n === "data-conversation-role" ? "assistant" : null,
  matches: () => false,
  closest: (sel) => sel.includes("data-conversation-role") ? nestedOuter : (sel === "#rs-root" ? null : null),
  querySelector: () => nestedInner,
  querySelectorAll: () => [nestedInner],
};
const nestedInner = {
  parentElement: nestedOuter,
  getAttribute: (n) => n === "data-message-author-role" ? "assistant" : null,
  matches: () => false,
  closest: (sel) => {
    if (sel.includes("data-message-author-role")) return nestedInner;
    if (sel.includes("data-conversation-role")) return nestedOuter;
    if (sel === "#rs-root") return null;
    return null;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
};
const beforeNested = global.document.querySelectorAll;
global.document.querySelectorAll = (sel) => sel.includes("data-message-author-role") ? [nestedOuter, nestedInner] : [];
ok("nested same-role wrappers count as one assistant", P.assistantCount() === 1);
ok("nested same-role wrapper keeps inner assistant", P.lastAssistant() === nestedInner);
global.document.querySelectorAll = beforeNested;

// ── Shared data-turn-key with separate user/assistant children ──────────────
// Current ChatGPT can group one exchange under a single keyed wrapper. The
// fallback itemRoot must return each half's child, not the shared wrapper, or
// role() sees the nested user first and the assistant command disappears.
const sharedTurn = {
  parentElement: null,
  getAttribute: (n) => n === "data-turn-key" ? "shared-key" : null,
  closest: (sel) => sel === "[data-turn-key]" ? sharedTurn : (sel === "#rs-root" ? null : null),
  querySelector: (sel) => {
    if (sel.includes("data-user-message-bubble") || sel.includes("='user'")) return sharedUserSignal;
    if (sel.includes(".markdown") || sel.includes("='assistant'")) return sharedAssistantSignal;
    return null;
  },
  querySelectorAll: () => [],
};
const sharedUserChild = {
  parentElement: sharedTurn,
  getAttribute: () => null,
  matches: () => false,
  closest: (sel) => sel === "[data-turn-key]" ? sharedTurn : (sel === "#rs-root" ? null : null),
  querySelector: (sel) => sel.includes("data-user-message-bubble") ? sharedUserSignal : null,
  querySelectorAll: () => [],
};
const sharedAssistantChild = {
  parentElement: sharedTurn,
  getAttribute: () => null,
  matches: () => false,
  closest: (sel) => sel === "[data-turn-key]" ? sharedTurn : (sel === "#rs-root" ? null : null),
  querySelector: (sel) => sel.includes(".markdown") ? sharedAssistantSignal : null,
  querySelectorAll: (sel) => sel.includes(".markdown") ? [sharedAssistantSignal] : [],
};
const sharedUserSignal = {
  nodeType: 1, tagName: "DIV", childNodes: [txt("build it")], parentElement: sharedUserChild,
  getAttribute: () => null,
  matches: (sel) => sel === "[data-user-message-bubble]",
  closest: (sel) => sel === "[data-turn-key]" ? sharedTurn : (sel === "#rs-root" ? null : null),
  querySelector: () => null, querySelectorAll: () => [],
};
const sharedAssistantSignal = {
  nodeType: 1, tagName: "DIV", childNodes: [txt('{"command":"list_commands"}')], parentElement: sharedAssistantChild,
  classList: { contains: (c) => c === "markdown" },
  getAttribute: () => null,
  matches: (sel) => sel.split(",").map((x) => x.trim()).includes(".markdown"),
  closest: (sel) => sel === "[data-turn-key]" ? sharedTurn : (sel === "#rs-root" ? null : null),
  querySelector: () => null, querySelectorAll: () => [],
};
const beforeShared = global.document.querySelectorAll;
global.document.querySelectorAll = (sel) => sel.includes("data-user-message-bubble") && sel.includes(".markdown")
  ? [sharedUserSignal, sharedAssistantSignal] : [];
ok("shared keyed exchange keeps separate user and assistant items", P.userCount() === 1 && P.assistantCount() === 1);
ok("shared keyed assistant is the current last assistant", P.lastAssistant() === sharedAssistantChild);
ok("shared keyed assistant command is readable", P.readAssistant().reply.includes('"command":"list_commands"'));
ok("shared keyed assistant id stays role-prefixed", P.lastAssistantId() === "assistant:shared-key");
global.document.querySelectorAll = beforeShared;

// ── Command rendered beside, not inside, the normal prose surface ──────────
// Some ChatGPT renderers put the code block beside .prose. Reading only .prose
// returns normal text and the visible JSON is missed. The whole-item fallback
// must recover the command without affecting ordinary prose-only replies.
const sideProse = el("div", { class: "prose" }, ["Running it now."]);
const sideCode = el("pre", {}, ['{"command":"list_commands"}']);
const sideItem = el("div", { attrs: { "data-conversation-role": "assistant" } }, [sideProse, sideCode]);
sideItem.querySelectorAll = (sel) => sel.includes(".prose") ? [sideProse] : [];
sideItem.querySelector = (sel) => sel.includes(".prose") ? sideProse : null;
ok("assistant whole-item fallback recovers sibling command block", P.itemText(sideItem).includes('"command":"list_commands"'));

// ── Command beside the inner assistant item under an outer turn ────────────
const outerAssistantProse = el("div", { class: "prose" }, ["Running it now."]);
const outerAssistantCode = el("pre", {}, ['{"command":"get_studio_state"}']);
outerAssistantCode.closest = () => null;
const outerUserCode = el("pre", {}, ['{"command":"should_not_run"}']);
outerUserCode.closest = (sel) => sel.includes("data-user-message-bubble") ? {} : null;
const outerTurn = {
  querySelectorAll: () => [outerUserCode, outerAssistantCode],
};
const outerAssistantItem = el("div", { attrs: { "data-conversation-role": "assistant" } }, [outerAssistantProse]);
outerAssistantItem.querySelectorAll = (sel) => sel.includes(".prose") ? [outerAssistantProse] : [];
outerAssistantItem.querySelector = (sel) => sel.includes(".prose") ? outerAssistantProse : null;
outerAssistantItem.closest = (sel) => sel.includes("conversation-turn-") ? outerTurn : null;
const outerRead = P.itemText(outerAssistantItem);
ok("outer-turn fallback reads assistant sibling command", outerRead.includes('"command":"get_studio_state"'));
ok("outer-turn fallback rejects user JSON", !outerRead.includes("should_not_run"));
outerAssistantProse.children = [];
outerAssistantProse.querySelectorAll = () => [];
outerAssistantCode.classList.add = (name) => { outerAssistantCode.hiddenClass = name; };
outerUserCode.classList.add = (name) => { outerUserCode.hiddenClass = name; };
outerAssistantCode.parentElement = outerTurn;
ok("sibling assistant command is camouflaged", !!P.findToolBlockSpot(outerAssistantItem) && outerAssistantCode.hiddenClass === "rs-tool-hide");
ok("sibling user JSON is never camouflaged", !outerUserCode.hiddenClass);
