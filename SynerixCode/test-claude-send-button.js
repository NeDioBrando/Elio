// 1.24.13: Claude startup "wouldn't take the message after 2 tries" (run: node test-claude-send-button.js).
// Behavioural check in jsdom: a disabled or localized Send control must never make
// synerixcode click the neighbouring voice/model button, and a draft that provably did
// not submit gets exactly one Enter.
const assert = require("node:assert/strict"), fs = require("fs"), { JSDOM } = require("jsdom");
const src = fs.readFileSync(__dirname + "/providers/claude.js", "utf8");

async function scenario({ label = "Send message", enableAfterMs = 0, sendWorks = true, enterWorks = true, extraLast = "Use voice mode" }) {
  const dom = new JSDOM(`<!doctype html><body><main><fieldset><div class="ProseMirror" contenteditable="true"></div>
    <div><button id="model" aria-label="Model: Opus">Opus</button>${label ? `<button id="send" aria-label="${label}" disabled>↑</button>` : ""}<button id="voice" aria-label="${extraLast}">🎙</button></div></fieldset></main></body>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 100, left: 0, width: 40, height: 40, right: 40, bottom: 140 }; };
  const ed = d.querySelector(".ProseMirror"), send = d.getElementById("send");
  const log = [];
  let submitted = 0;
  const submit = () => { if (!ed.textContent) return; submitted++; const u = d.createElement("div"); u.setAttribute("data-testid", "user-message"); u.textContent = ed.textContent; d.querySelector("main").prepend(u); ed.textContent = ""; };
  d.execCommand = (cmd, _ui, value) => { if (cmd === "insertText") ed.textContent += value || ""; if (cmd === "insertLineBreak") ed.textContent += "\n"; return true; };
  if (send) { send.addEventListener("click", () => { log.push("click:send"); if (sendWorks) submit(); }); setTimeout(() => { send.disabled = false; }, enableAfterMs); }
  d.getElementById("voice").addEventListener("click", () => log.push("click:voice"));
  d.getElementById("model").addEventListener("click", () => log.push("click:model"));
  ed.addEventListener("keydown", (e) => { if (e.key === "Enter") { log.push("enter"); if (enterWorks) submit(); } });
  w.eval(src + "\nwindow.__P = RSProvider;");
  const P = w.__P;
  P.init({ diag: () => {} });
  await P.typeAndSend("Output of 'list_commands':\n" + "x".repeat(3000) + "\nReply with exactly synerixcode is ready.", null);
  w.close();
  return { log, submitted };
}

(async () => {
  // 1. Send is still disabled for ~1.2 s after a long draft: wait for it, never click voice/model.
  let r = await scenario({ enableAfterMs: 1200 });
  assert.equal(r.submitted, 1); assert.deepEqual(r.log.filter((x) => x.startsWith("click")), ["click:send"]);
  // 2. German UI label.
  r = await scenario({ label: "Nachricht senden", enableAfterMs: 300 });
  assert.equal(r.submitted, 1); assert.ok(!r.log.includes("click:voice") && !r.log.includes("click:model"));
  // 3. Unknown label (no send control recognised): Enter submits, nothing else clicked.
  r = await scenario({ label: "", extraLast: "Sprachmodus" });
  assert.equal(r.submitted, 1); assert.deepEqual(r.log, ["enter"]);
  // 4. Click did nothing and the draft is untouched: exactly one Enter fallback, one message.
  r = await scenario({ sendWorks: false });
  assert.equal(r.submitted, 1); assert.deepEqual(r.log, ["click:send", "enter"]);
  // 5. Click worked: no extra Enter (never a duplicate).
  r = await scenario({});
  assert.equal(r.submitted, 1); assert.deepEqual(r.log, ["click:send"]);
  console.log("PASS Claude send: waits for enabled Send, localized label, Enter fallback, no wrong-button click, no duplicate");
})().catch((e) => { console.error(e); process.exit(1); });
