// SPDX-License-Identifier: GPL-3.0-or-later
// Real Rust API + Chromium. Runs entirely in a temporary local profile.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process"),
  { chromium } = require("playwright");
const ROOT = __dirname,
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "elio-vault-live-")),
  OUT = process.env.ELIO_TEST_OUTPUT || path.join(TMP, "screens");
fs.mkdirSync(OUT, { recursive: true });
let processHandle,
  key,
  log = "",
  browser;
const base = "http://127.0.0.1:3000";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function start() {
  processHandle = spawn(
    path.join(ROOT, "agent/target/debug/elio"),
    ["--headless", "--workspace", TMP],
    {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TMP,
        LOCALAPPDATA: TMP,
        HOME: TMP,
      },
    },
  );
  processHandle.stdout.on("data", (d) => (log += d));
  processHandle.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    await delay(100);
    const p = path.join(TMP, "elio/bridge-key");
    if (fs.existsSync(p)) {
      key = fs.readFileSync(p, "utf8");
      try {
        const r = await fetch(base + "/", {
          headers: { Authorization: "Bearer " + key },
        });
        if (r.ok) return;
      } catch {}
    }
    if (processHandle.exitCode !== null) break;
  }
  throw Error("Native agent did not start: " + log.slice(-1500));
}
async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await new Promise((r) => processHandle.once("exit", r));
}
async function api(action, extra = {}, scope = "project:Elio Demo") {
  const r = await fetch(base + "/api/vault", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, scope, ...extra }),
  });
  return { status: r.status, ...(await r.json()) };
}
async function save(title, text, category, tags = []) {
  const r = await api("save", {
    title,
    text,
    category,
    tags,
    source: "Verified local integration fixture",
    evidence: ["test-vault-live.cjs"],
    status: "verified",
    chat: "notion|/chat?fixture",
    topic_key: title,
  });
  assert(r.ok, r.error);
  return r.note;
}
(async () => {
  try {
    const net = require("node:net");
    await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", () =>
        reject(Error("Port 3000 is busy; test refuses to stop another app.")),
      );
      s.listen(3000, "127.0.0.1", () => s.close(resolve));
    });
    await start();
    assert.equal(
      (
        await fetch(base + "/api/vault", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/vault", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            Origin: "https://untrusted.example",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      401,
    );
    const inventory = await save(
      "Inventory",
      "## A single source of truth\n\nItems are owned by the server. Views never mutate saved inventory directly.\n\nRelated: [[Data saving]] and [[Server authority]].",
      "Systems",
      ["inventory", "architecture"],
    );
    await save(
      "Data saving",
      "## Keep the promise\n\nSave only validated state. Preserve a last-known-good copy.\n\n[[Inventory]] uses this contract.",
      "Systems",
      ["persistence"],
    );
    await save(
      "Server authority",
      "## Trust boundaries\n\nClients request. Servers validate.\n\nCheck ownership, types and limits before changing [[Inventory]].",
      "Architecture",
      ["networking"],
    );
    await save(
      "Naming conventions",
      "## Names that explain themselves\n\nUse the current project conventions. Preserve public serialized keys.\n\n- Keep names stable\n- Avoid unrelated rewrites\n\nSee [[Server authority]].",
      "Conventions",
      ["style"],
    );
    await save(
      "Lighting direction",
      "## A warm evening\n\nMuted warm neutrals, soft shadows and readable contrast.\n\nReference style for [[Inventory]] UI.",
      "Design",
      ["visual"],
    );
    await save(
      "Save retry lesson",
      "## What actually fixed it\n\nThe retry reuses its operation identity. It does not create a second item.\n\nEvidence: deterministic test with two identical requests.\n\n[[Data saving]] · [[Inventory]]",
      "Lessons",
      ["tested"],
    );
    await save(
      "Future crafting",
      "This is a proposal, not a confirmed system. Connect it to [[Inventory]] only after approval.",
      "Planning",
      ["proposal"],
    );
    const malicious = await api("manual-save", {
      title: "Inert HTML",
      text: '<img src=x onerror="window.bad=true"><script>window.bad=true</script>\n\nSecond paragraph.',
      category: "Tests",
    });
    assert(malicious.ok);
    const capsule = await api("context", { query: "inventory", budget: 4500 });
    assert(capsule.characters <= 4500);
    assert(capsule.context.some((n) => n.id === inventory.id));
    const conflict = await Promise.all([
      api("save", {
        id: inventory.id,
        revision: 1,
        etag: inventory.etag,
        text: inventory.text + "\n\nConcurrency winner A",
      }),
      api("save", {
        id: inventory.id,
        revision: 1,
        etag: inventory.etag,
        text: inventory.text + "\n\nConcurrency winner B",
      }),
    ]);
    assert.equal(conflict.filter((r) => r.ok).length, 1);
    assert.equal(conflict.filter((r) => r.status === 400).length, 1);
    const read = await api("read", { id: inventory.id });
    assert.equal(read.note.revision, 2);
    assert((await api("history", { id: inventory.id })).history.length === 1);
    const unchanged = await api("save", {
      id: inventory.id,
      revision: 2,
      etag: read.note.etag,
      text: read.note.text,
    });
    assert(unchanged.unchanged);
    assert.equal(unchanged.receipt, null);
    await fetch(base + "/api/memory", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "toggle", enabled: false }),
    });
    assert.equal(
      (await api("save", { title: "blocked", text: "no", source: "test" }))
        .status,
      400,
    );
    await fetch(base + "/api/memory", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "toggle", enabled: true }),
    });
    const exported = await api("export");
    assert.equal(
      (await api("manual-import", { files: exported.files }, "project:Copy"))
        .imported,
      8,
    );
    assert.equal(
      (await api("graph", {}, "project:Copy")).edges.length,
      (await api("graph")).edges.length,
    );
    await stop();
    await start();
    assert.equal((await api("list")).total, 8);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "chromium",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1460, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key }) => {
        window.__ELIO_BOOT__ = { key, apiUrl: "http://127.0.0.1:3000" };
      },
      { key },
    );
    await page.goto(base + "/desktop-ui");
    await page.locator('.navbtn[data-page="memory"]').click();
    await page.locator("[data-project]").selectOption("project:Elio Demo");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-count]")?.textContent === "8 / 8 notes",
    );
    await page
      .locator("[data-tree] button")
      .filter({ hasText: "Inventory" })
      .click();
    await page.waitForSelector(".ev-note");
    assert.equal(
      await page.locator(".ev-prose p").first().innerText(),
      "Items are owned by the server. Views never mutate saved inventory directly.",
    );
    await page.evaluate(
      () => (document.querySelector("#content").scrollTop = 0),
    );
    await page.screenshot({ path: path.join(OUT, "elio-memory-note.png") });
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await page
      .getByRole("textbox", {
        name: "Markdown · use [[Note title]] or [[id|label]] for links",
        exact: true,
      })
      .fill("First paragraph.\n\nSecond paragraph.\n\n[[Data saving]]");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("[data-status]").textContent.startsWith("Saved “"),
    );
    assert.equal(
      await page.locator(".ev-prose p").nth(1).innerText(),
      "Second paragraph.",
    );
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".ev-history").length >= 2,
    );
    assert((await page.locator(".ev-history").count()) >= 2);
    await page.screenshot({ path: path.join(OUT, "elio-memory-history.png") });
    await page.locator('[data-view="graph"]').click();
    await page.waitForSelector(".ev-graph circle");
    assert.equal(await page.locator(".ev-graph circle").count(), 8);
    assert((await page.locator(".ev-graph line").count()) > 0);
    await page.screenshot({ path: path.join(OUT, "elio-memory-graph.png") });
    await page.locator(".ev-graph circle").first().press("Enter");
    await page.waitForSelector(".ev-note");
    await page.locator('[data-view="context"]').click();
    await page.waitForSelector(".ev-source");
    await page.screenshot({ path: path.join(OUT, "elio-memory-context.png") });
    await page
      .locator("[data-tree] button")
      .filter({ hasText: "Inert HTML" })
      .click();
    assert.equal(
      await page.locator(".ev-prose img,.ev-prose script").count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.bad), undefined);
    // Unsaved drafts are never replaced by a refresh.
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Unsent draft title");
    await page.locator("[data-refresh]").click();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .inputValue(),
      "Unsent draft title",
    );
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.setViewportSize({ width: 560, height: 950 });
    await page.screenshot({ path: path.join(OUT, "elio-memory-narrow.png") });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1460, height: 1000 });
    await page.evaluate(
      () => (document.documentElement.dataset.elioMode = "light"),
    );
    await page.screenshot({ path: path.join(OUT, "elio-memory-light.png") });
    // New AI writes appear without Refresh; search covers text beyond the preview.
    await save(
      "Live update fixture",
      "x ".repeat(400) + "\n\nuniquelongtailmarker",
      "Tests",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("[data-count]")?.textContent === "9 / 9 notes",
      { timeout: 15000 },
    );
    await page.locator("[data-search]").fill("uniquelongtailmarker");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-count]")?.textContent === "1 / 9 notes",
    );
    assert.equal(
      await page.locator("[data-tree] button").innerText(),
      "Live update fixture",
    );
    await page.locator("[data-search]").fill("");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-count]")?.textContent === "9 / 9 notes",
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "PASS real native vault + Chromium: authentication, origin guard, durable Markdown, exact paragraph rendering, query capsule, graph/backlinks, edit/history, concurrent conflicts, no-op receipts, OFF gate, export/import, restart, inert HTML, keyboard graph, draft preservation, narrow/light UI, live polling, full-body search.",
    );
    fs.writeFileSync(
      path.join(OUT, "native-test-summary.json"),
      JSON.stringify(
        {
          notes: 8,
          backend: "real Rust API",
          browser: "Chromium",
          checks: "passed",
          capsuleCharacters: capsule.characters,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    await stop();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
