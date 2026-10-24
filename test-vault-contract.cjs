// SPDX-License-Identifier: GPL-3.0-or-later
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  { JSDOM } = require("jsdom");
(async () => {
  const dom = new JSDOM(
    '<div id="turn"><div data-block-id="1"><p>Первый <strong>абзац</strong>.</p><p>Второй абзац<br>с переносом.</p><ul><li>Первый пункт</li><li>Второй пункт</li></ul><pre>local x = 1\n\n\nreturn x</pre><div class="rs-chip">Extension UI</div></div></div>',
    {
      url: "https://app.notion.com/chat?t=fixture",
      runScripts: "outside-only",
    },
  );
  const w = dom.window;
  vm.runInContext(
    fs.readFileSync("providers/notion.js", "utf8") +
      ";globalThis.P=RSProvider;",
    dom.getInternalVMContext(),
  );
  const text = w.P.itemText(w.document.querySelector("#turn"));
  assert.match(text, /Первый абзац\.\n+Второй абзац\nс переносом\./);
  assert.match(text, /Первый пункт\n+Второй пункт/);
  assert(text.includes("local x = 1\n\n\nreturn x"));
  assert(!text.includes("Extension UI"));
  vm.runInContext(
    fs.readFileSync("desktop/chat.js", "utf8"),
    dom.getInternalVMContext(),
  );
  const rendered = w.document.createElement("div");
  w.elioDesktopChat.renderText(
    rendered,
    "Первый абзац.\n\nВторой абзац.\nСтрока.\n\n```lua\nlocal x=1\n\nreturn x\n```",
  );
  assert.equal(rendered.querySelectorAll("p").length, 2);
  assert.equal(rendered.querySelectorAll("pre").length, 1);
  assert.equal(
    rendered.querySelectorAll("p")[1].textContent,
    "Второй абзац.\nСтрока.",
  );
  assert(rendered.querySelector("code").textContent.includes("\n\n"));
  const view = require("./core/chat-view.js"),
    receipt = {
      id: "memory-1:2",
      title: "Сохранение 🐔 <img onerror=bad>",
      operation: "added",
    };
  const raw =
    "Output of 'elio_vault':\n" +
    JSON.stringify({ ok: true, receipt }) +
    "\n[SYSTEM_STATE: example]";
  const row = view.present({ id: "r", role: "user", text: raw });
  assert.equal(row.memory_receipt.title, receipt.title);
  assert.equal(
    view.present({ id: "bad", role: "user", text: raw, phase: "err" })
      .memory_receipt,
    null,
  );
  assert.equal(
    view.memoryReceipt(
      "Output of 'search':\n" + JSON.stringify({ ok: true, receipt }),
    ),
    null,
  );
  assert.equal(
    view.memoryReceipt(
      "Output of 'elio_vault':\n" + JSON.stringify({ ok: false, receipt }),
    ),
    null,
  );
  const main = fs.readFileSync("core/main.js", "utf8"),
    start = main.indexOf('    if (name === "elio_vault") {'),
    end = main.indexOf('    if (name === "elio_engram") {', start),
    snippet = main.slice(start, end);
  const execute = new Function(
    "name",
    "args",
    "P",
    "bg",
    "engramScope",
    "showMemoryReceipt",
    "currentProject",
    `return (async()=>{${snippet}})()`,
  );
  let notices = [],
    calls = [];
  const P = { id: "notion", conversationKey: () => "/chat?test" };
  const bg = async (req) => {
    calls.push(req);
    return req.type === "checkpoints"
      ? { ok: true, project: "Test" }
      : {
          ok: true,
          note: {
            id: "id",
            title: "T",
            text: "x".repeat(60000),
            revision: 1,
            etag: "etag",
            status: "unreviewed",
          },
          receipt,
        };
  };
  const result = await execute(
    "elio_vault",
    { action: "save", scope: "project:Wrong", text: "fact", source: "test" },
    P,
    bg,
    () => "project:Test",
    (r) => notices.push(r),
    "",
  );
  assert(
    result.length < 1000,
    "Save returns a compact receipt, not 64K of echoed memory",
  );
  assert.equal(calls[1].request.scope, "project:Test");
  assert.equal(notices.length, 1);
  notices = [];
  const failed = await execute(
    "elio_vault",
    { action: "save" },
    P,
    async (req) =>
      req.type === "checkpoints"
        ? { ok: true }
        : { ok: false, error: "Conflict" },
    () => "project:Test",
    (r) => notices.push(r),
    "",
  );
  assert.match(failed, /Conflict/);
  assert.equal(notices.length, 0);
  const fresh = await execute(
    "elio_vault",
    { action: "read" },
    { ...P, conversationKey: () => "" },
    bg,
    () => "",
    () => {},
    "",
  );
  assert.match(fresh, /Open a saved chat/);
  let wrongScopeCall = false;
  const unresolved = await execute(
    "elio_vault",
    { action: "save" },
    P,
    async (req) => {
      if (req.type === "checkpoints")
        return { ok: false, error: "Disconnected" };
      wrongScopeCall = true;
      return { ok: true };
    },
    () => "project:Old",
    () => {},
    "",
  );
  assert.match(unresolved, /Could not resolve the active project/);
  assert.equal(
    wrongScopeCall,
    false,
    "Never use a stale project after a context failure",
  );
  for (const file of [
    "core/config.js",
    "core/main.js",
    "core/memory.js",
    "core/chat-view.js",
    "core/vault-ui.js",
    "providers/notion.js",
    "background.js",
  ])
    assert.equal(
      fs.readFileSync(file, "utf8"),
      fs.readFileSync("elio-Extension/" + file, "utf8"),
      file + " must match packaged extension",
    );
  vm.runInContext(
    fs.readFileSync("core/vault-ui.js", "utf8"),
    dom.getInternalVMContext(),
  );
  const vaultRoot = w.document.createElement("section"),
    saved = [];
  w.document.body.append(vaultRoot);
  w.confirm = () => true;
  const longLegacy = "🐔".repeat(25000);
  const ui = w.elioVaultUI.mount(
    vaultRoot,
    async (req) => {
      if (req.action === "projects")
        return { ok: true, projects: ["project:Test"] };
      if (req.action === "state")
        return { ok: true, version: String(saved.length), automatic: true };
      if (req.action === "list")
        return { ok: true, notes: saved, next_offset: null };
      if (req.action === "manual-save") {
        assert.equal(req.scope, "project:Test");
        assert(Buffer.byteLength(req.text) <= 64000);
        saved.push({
          ...req,
          id: String(saved.length),
          aliases: [],
          status: "unreviewed",
        });
        return { ok: true };
      }
      throw Error("Unexpected UI request " + req.action);
    },
    {
      context: async () => ({ scope: "project:Test" }),
      legacy: async () => [
        { id: "legacy-1", title: "Long note", text: longLegacy },
        {
          id: "elsewhere",
          project: "Other",
          title: "Wrong project",
          text: "Do not import",
        },
      ],
    },
  );
  for (
    let i = 0;
    i < 20 && !vaultRoot.querySelector("[data-status]").textContent;
    i++
  )
    await new Promise((r) => setTimeout(r, 5));
  await vaultRoot.querySelector("[data-import]").onclick();
  assert.equal(saved.length, 3);
  assert.equal(saved.map((n) => n.text).join(""), longLegacy);
  await vaultRoot.querySelector("[data-import]").onclick();
  assert.equal(saved.length, 3, "Old-note import is idempotent");
  ui.destroy();
  dom.window.close();
  console.log(
    "PASS vault contracts: production Notion block boundaries, inline spans, list/BR/code preservation, desktop paragraphs, confirmed-only receipts, compact save replies, bound project scope, conflicts, fresh-chat guard, extension parity, Unicode-safe long-note import and duplicate prevention.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
