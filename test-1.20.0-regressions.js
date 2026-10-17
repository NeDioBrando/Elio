const {runInContext: runProviderFixture} = require('./test-support/provider-dom.cjs');
// SPDX-License-Identifier: GPL-3.0-or-later
// 1.20.0 regressions. Every assertion here fails against 1.19.39.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const root = __dirname;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
function check(name, fn) { fn(); passed++; console.log("ok - " + name); }

for (const base of ["", "synerixcode-Extension/"]) {
  for (const rel of ["core/main.js", "providers/notion.js"]) {
    const p = base + rel;
    if (!fs.existsSync(path.join(root, p))) continue;
    check("syntax " + p, () => { new vm.Script(read(p), { filename: p }); });
  }
}

const main = read("core/main.js");
const notion = read("providers/notion.js");

check("cut-off commands do not stop the run after 3 failures", () => {
  assert.ok(!/Repeated incomplete commands", "No malformed command ran\. The agent paused after three failures/.test(main));
  assert.ok(/const MAX_INVALID_TOOL_ATTEMPTS = 6/.test(main));
  assert.ok(/invalidToolAttempts >= MAX_INVALID_TOOL_ATTEMPTS\) \{ ui\.banner\("warn", "Repeated incomplete commands"/.test(main));
});
check("repeated cut-off commands get a split-the-edit hint", () => {
  assert.ok(/invalidToolAttempts >= SPLIT_HINT_AFTER && typeof parseFeedback === "string" \? parseFeedback \+ SPLIT_HINT/.test(main));
  assert.ok(/Split the change into several much smaller commands/.test(main));
});
check("attachment/large sends are never auto-retried", () => {
  assert.ok(/!retriedUnsent && !\(images && images\.length\) && payloadText\.length < 4000/.test(main));
});

// Behavioural check of the Notion provisional composer under an Edge-like
// zero viewport, executed against the real source of provisionalEditor.
check("Notion provisional composer survives innerHeight 0 (Edge)", () => {
  const start = notion.indexOf("  const PROVISIONAL_AFTER_MS = 5000;");
  const end = notion.indexOf("  function adoptProvisionalEditor(");
  assert.ok(start > 0 && end > start);
  const src = notion.slice(start, end);
  const send = { type: "button", tag: "send" };
  const parent = { querySelectorAll: () => [send], querySelector: () => null, parentElement: null };
  const editor = { tagName: "DIV", disabled: false, parentElement: parent, getAttribute: () => "true",
    getBoundingClientRect: () => ({ width: 600, height: 40, top: 700, bottom: 740 }) };
  const sandbox = { window: { innerHeight: 0 }, document: { documentElement: { clientHeight: 900 }, body: {} }, Date,
    isAiSurface: () => true, editorCandidates: () => [editor], isTextControl: () => false, editorHintScore: () => 9,
    CONTROL_SEL: "button", sendControlLike: (b) => b === send, stopControlLike: () => false };
  vm.createContext(sandbox);
  runProviderFixture(src + "\nthis.__pe = provisionalEditor;", sandbox);
  assert.strictEqual(sandbox.__pe(), editor);
});
check("Notion composer has a relaxed late acceptance for Edge", () => {
  assert.ok(/const PROVISIONAL_RELAXED_AFTER_MS = 15000;/.test(notion));
  assert.ok(/bestScore < \(relaxed \? 4 : 7\)/.test(notion));
  assert.ok(/_composerWaitStart = t0;/.test(notion));
});

const upd = read("agent/src/updater.rs");
check("updater falls back on transport errors and 5xx", () => {
  assert.ok(!/\.timeout\(Duration::from_secs\(15\)\)\.send\(\)\.await\?;/.test(upd));
  assert.ok(/let Some\(response\) = response else \{ return official_asset_fallback\(ver, hash, macos\); \};/.test(upd));
  assert.ok(/Ok\(r\) if r\.status\(\)\.is_server_error\(\) => \{ break; \}/.test(upd));
  assert.ok(/if s\.available \{ s\.error=None; s\.check_error=None; s\.message="Update ready\./.test(upd), "Update ready must clear a stale failure (no contradictory overlay)");
  assert.ok(!/if status >= 500 \|\| official_rate_limited/.test(upd), "a 5xx metadata reply must not skip the record check directly");
});
const rs = read("agent/src/main.rs");
check("Studio detection tolerates empty state text and single misses", () => {
  assert.ok(/fn studio_should_drop\(was_connected: bool, misses: u32, helper_dead: bool\)/.test(rs));
  assert.ok(!/if text\.is_empty\(\) \|\| text\.contains\("Unable to find an active Studio instance"\)/.test(rs));
  assert.ok(/Duration::from_secs\(20\), async \{/.test(rs));
});
console.log(passed + " passed");
