// SPDX-License-Identifier: GPL-3.0-or-later
// Real native HTTP/CORS and desktop UI. Figma SDK worker is simulated, not a signed-in Figma session.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawn, spawnSync } = require("node:child_process"),
  { chromium } = require("playwright"),
  { fixture } = require("./test-figma.cjs"),
  { execute } = require("./figma-plugin/code.js"),
  { example } = require("./core/figma.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "elio-figma-live-")),
  out = process.env.ELIO_TEST_OUTPUT || path.join(tmp, "screens"),
  base = "http://127.0.0.1:3000",
  delay = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let agent,
  key,
  token,
  browser,
  log = "";
async function post(route, body, auth = key, origin) {
  const r = await fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + auth,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return { ...data, http: r.status };
}
const api = (v) => post("/api/figma", v),
  worker = (v) =>
    post("/figma-link", { ...v, client_id: "fixture-client" }, token, "null");
(async () => {
  try {
    const net = require("node:net");
    await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", () =>
        reject(Error("Port 3000 busy; refusing to stop another application")),
      );
      s.listen(3000, "127.0.0.1", () => s.close(resolve));
    });
    agent = spawn(
      path.join(__dirname, "agent/target/debug/elio"),
      ["--headless", "--workspace", tmp],
      {
        env: {
          ...process.env,
          HOME: tmp,
          LOCALAPPDATA: tmp,
          XDG_CONFIG_HOME: tmp,
        },
      },
    );
    agent.stdout.on("data", (d) => (log += d));
    agent.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 150; i++) {
      await delay(100);
      const file = path.join(tmp, "elio/bridge-key");
      if (fs.existsSync(file)) {
        key = fs.readFileSync(file, "utf8");
        try {
          if ((await api({ action: "status" })).ok) break;
        } catch {}
      }
    }
    assert(key, log);
    assert.equal(
      (await post("/api/figma", { action: "pair" }, "wrong")).http,
      401,
    );
    const preflight = await fetch(base + "/figma-link", {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), "null");
    assert.equal(
      preflight.headers.get("access-control-allow-private-network"),
      "true",
    );
    token = (await api({ action: "pair" })).pairing_code;
    assert.equal(token.length, 64);
    assert.notEqual(token, key);
    assert.equal(
      (
        await post(
          "/api/vault",
          { action: "list", scope: "project:test" },
          token,
          "null",
        )
      ).http,
      401,
    );
    assert.equal(
      (
        await post(
          "/figma-link",
          { action: "hello", client_id: "other" },
          token,
          "https://evil.test",
        )
      ).http,
      403,
    );
    assert(
      (
        await worker({
          action: "hello",
          document: { name: "Fixture Figma <img>", page: "Design" },
          writable: false,
        })
      ).ok,
    );
    assert.equal(
      (await api({ ...example, request_id: "read-only-edit" })).ok,
      false,
    );
    assert(
      (
        await worker({
          action: "hello",
          document: { name: "Fixture Figma", page: "Design" },
          writable: true,
        })
      ).ok,
    );
    assert((await worker({ action: "heartbeat", writable: true })).ok);
    const f = fixture();
    async function cycle() {
      const r = await worker({ action: "poll", writable: true });
      if (r.command) {
        let result;
        try {
          result = await execute(f, r.command);
        } catch (e) {
          result = { ok: false, error: e.message };
        }
        const completed = await worker({
          action: "complete",
          request_id: r.command.request_id,
          result,
        });
        assert(completed.ok);
        assert(
          (
            await worker({
              action: "complete",
              request_id: r.command.request_id,
              result,
            })
          ).ok,
          "Result ACK retries are idempotent",
        );
        return r.command;
      }
    }
    const queued = await api({ ...example, request_id: "native-demo" });
    assert.equal(queued.state, "queued");
    await cycle();
    const done = await api({ action: "result", request_id: "native-demo" });
    assert.equal(done.state, "succeeded");
    assert(done.result.node_id);
    assert.equal(
      (await api({ ...example, request_id: "native-demo" })).replayed,
      true,
    );
    assert.equal(f.currentPage.children.length, 1);
    assert.equal(
      (await worker({ action: "poll", writable: true })).command,
      null,
    );
    await api({
      action: "export",
      request_id: "native-export",
      node_id: done.result.node_id,
      format: "SVG",
    });
    await cycle();
    assert.equal(
      (await api({ action: "result", request_id: "native-export" })).result
        .mime,
      "image/svg+xml",
    );
    const files = await api({ action: "plugin-files" });
    for (const name of ["manifest.json", "code.js", "ui.html"])
      assert.equal(
        files.files[name],
        fs.readFileSync(path.join(__dirname, "figma-plugin", name), "utf8"),
        "Embedded plugin must match current sources",
      );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "chromium",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1460, height: 1050 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((key) => {
      window.__ELIO_BOOT__ = { key, apiUrl: "http://127.0.0.1:3000" };
    }, key);
    await page.goto(base + "/desktop-ui");
    await page.locator('[data-page="figma"]').click();
    await page.waitForFunction(() =>
      document.querySelector("[data-state]")?.textContent.includes("Connected"),
    );
    const dl = page.waitForEvent("download");
    await page.locator("[data-download]").click();
    const download = await dl;
    const zipPath = path.join(out, "Elio-Figma-Plugin.zip");
    await download.saveAs(zipPath);
    const checked = spawnSync("python3", [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert set(z.namelist())=={'manifest.json','code.js','ui.html'}",
      zipPath,
    ]);
    assert.equal(checked.status, 0, checked.stderr.toString());
    page.once("dialog", (d) => d.accept());
    await page.locator("[data-demo]").click();
    await cycle();
    await page.locator("#figmaWorkspace [data-refresh]").click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-result]")
        ?.textContent.includes("succeeded"),
    );
    await page.screenshot({ path: path.join(out, "elio-figma-connected.png") });
    await page.locator("[data-svg]").click();
    await cycle();
    await page.locator("#figmaWorkspace [data-refresh]").click();
    await page.waitForFunction(
      () => document.querySelector("[data-preview]")?.hidden === false,
    );
    assert.equal(await page.locator("[data-save-image]").isDisabled(), false);
    await page.setViewportSize({ width: 560, height: 950 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: path.join(out, "elio-figma-narrow.png") });
    assert.deepEqual(errors, []);
    await page.locator("[data-revoke]").click();
    assert.equal((await worker({ action: "poll", writable: true })).ok, false);
    assert.equal((await api({ action: "status" })).connected, false);
    await page.close();
    console.log(
      "PASS real Figma bridge HTTP + Chromium: scoped pairing, main API isolation, CORS/private-network preflight, bad origin, read-only permission, once-only delivery, idempotent result ACK, native queue/result/export, embedded plugin parity, plugin ZIP/CRC, real app Figma navigation/demo/result/preview/download, narrow layout, revoke. Figma Plugin API worker simulated; no Figma account or real canvas modified.",
    );
    fs.writeFileSync(
      path.join(out, "test-summary.json"),
      JSON.stringify(
        {
          native: "real Rust HTTP",
          browser: "real Chromium",
          figma: "simulated Plugin API worker, not live Figma",
          checks: "passed",
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    if (agent && agent.exitCode === null) {
      agent.kill("SIGTERM");
      await new Promise((r) => agent.once("exit", r));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
