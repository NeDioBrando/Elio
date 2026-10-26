// SPDX-License-Identifier: GPL-3.0-or-later
// Plugin API contract harness, not a signed-in Figma session.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const plugin = require("./figma-plugin/code.js"),
  design = require("./core/figma.js");
let serial = 0;
function fixture() {
  const records = new Map(),
    fonts = [];
  class Node {
    constructor(type) {
      this.type = type;
      this.id = "n:" + ++serial;
      this.name = type;
      this.width = 100;
      this.height = 100;
      this.x = 0;
      this.y = 0;
      this.removed = false;
      this.data = {};
      this.children = ["PAGE", "FRAME", "COMPONENT"].includes(type)
        ? []
        : undefined;
      this.fills = [];
      this.strokes = [];
      this.opacity = 1;
      this.cornerRadius = 0;
      this.strokeWeight = 1;
      this.clipsContent = false;
      this.layoutMode = "NONE";
      this.primaryAxisAlignItems = "MIN";
      this.counterAxisAlignItems = "MIN";
      this.primaryAxisSizingMode = "FIXED";
      this.counterAxisSizingMode = "FIXED";
      this.layoutSizingHorizontal = "FIXED";
      this.layoutSizingVertical = "FIXED";
      this.itemSpacing = 0;
      for (const k of [
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
      ])
        this[k] = 0;
      records.set(this.id, this);
    }
    appendChild(n) {
      if (!this.children) throw Error("Not a container");
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      this.children.push(n);
      n.parent = this;
    }
    setPluginData(k, v) {
      this.data[k] = v;
    }
    getPluginData(k) {
      return this.data[k] || "";
    }
    resize(w, h) {
      this.width = w;
      this.height = h;
    }
    findAll(pred) {
      const all = [];
      for (const n of this.children || []) {
        if (pred(n)) all.push(n);
        all.push(...n.findAll(pred));
      }
      return all;
    }
    remove() {
      if (this.parent)
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
      for (const c of [...(this.children || [])]) c.remove();
      this.removed = true;
      records.delete(this.id);
    }
    async exportAsync() {
      return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
  }
  const page = new Node("PAGE");
  page.name = "UI fixtures";
  page.selection = [];
  const create = (t) => {
    const n = new Node(t);
    page.appendChild(n);
    return n;
  };
  return {
    fonts,
    records,
    root: { name: "Design fixture" },
    currentPage: page,
    viewport: { center: { x: 500, y: 500 }, scrollAndZoomIntoView() {} },
    loadFontAsync: async (f) => {
      if (f.family === "Missing") throw Error("Missing font");
      fonts.push(f);
    },
    createFrame: () => create("FRAME"),
    createComponent: () => create("COMPONENT"),
    createRectangle: () => create("RECTANGLE"),
    createEllipse: () => create("ELLIPSE"),
    createText: () => create("TEXT"),
    createNodeFromSvg: (svg) => {
      if (svg.includes("MALFORMED")) throw Error("Bad SVG");
      return create("FRAME");
    },
    getNodeByIdAsync: async (id) => records.get(id),
    base64Encode: (b) => Buffer.from(b).toString("base64"),
  };
}
module.exports = { fixture };
if (require.main === module)
  (async () => {
    const f = fixture(),
      original = f.createRectangle();
    original.name = "User content";
    const cmd = {
      ...structuredClone(design.example),
      request_id: "design-1",
      fingerprint: "digest-1",
    };
    const created = await plugin.execute(f, cmd);
    assert(created.ok);
    assert.equal(f.currentPage.children.length, 2);
    assert(!original.removed);
    const first = f.records.get(created.node_id);
    assert.equal(first.layoutMode, "VERTICAL");
    assert.equal(f.fonts.length, 3);
    assert(first.findAll((n) => n.type === "COMPONENT").length === 1);
    assert(
      first
        .findAll((n) => n.type === "TEXT")
        .some((n) => n.characters === "Start creating"),
    );
    const replay = await plugin.execute(f, cmd);
    assert.equal(replay.node_id, created.node_id);
    assert(replay.replayed);
    assert.equal(f.currentPage.children.length, 2);
    await assert.rejects(
      plugin.execute(f, { ...cmd, fingerprint: "different" }),
      /reused/,
    );
    const before = first.id;
    const next = {
      ...structuredClone(cmd),
      request_id: "design-2",
      fingerprint: "digest-2",
    };
    next.nodes[1].svg = "<svg>MALFORMED</svg>";
    await assert.rejects(plugin.execute(f, next), /Bad SVG/);
    assert.equal(f.currentPage.children.length, 2);
    assert(f.records.has(before), "Old design survives a failed staging pass");
    next.nodes[1].svg = cmd.nodes[1].svg;
    next.nodes.find((n) => n.type === "TEXT").fontFamily = "Missing";
    await assert.rejects(plugin.execute(f, next), /Missing font/);
    assert.equal(f.currentPage.children.length, 2);
    next.nodes.find((n) => n.type === "TEXT").fontFamily = "Inter";
    const updated = await plugin.execute(f, next);
    assert(updated.ok);
    assert(!f.records.has(before));
    assert(!original.removed);
    const root = f.records.get(updated.node_id),
      foreign = f.createRectangle();
    root.appendChild(foreign);
    await assert.rejects(
      plugin.execute(f, {
        ...next,
        request_id: "design-3",
        fingerprint: "digest-3",
      }),
      /user-added layers/,
    );
    assert(!foreign.removed);
    const read = await plugin.execute(f, {
      action: "read",
      request_id: "read-1",
      node_id: root.id,
    });
    assert(read.nodes.length);
    const exported = await plugin.execute(f, {
      action: "export",
      request_id: "export-1",
      node_id: root.id,
      format: "SVG",
    });
    assert(exported.base64);
    assert.equal(exported.mime, "image/svg+xml");
    for (const svg of [
      "<svg><script/></svg>",
      '<svg><image href="http://x"/></svg>',
      '<svg onload="bad()"/>',
      "<svg><foreignObject/></svg>",
      "<svg><style/></svg>",
      '<svg><use href="#id"/></svg>',
      "<!DOCTYPE svg><svg/>",
    ]) {
      const bad = structuredClone(cmd);
      bad.nodes[1].svg = svg;
      assert.throws(() => plugin.validate(bad));
    }
    const bad = structuredClone(cmd);
    bad.nodes[1].parent = "missing";
    assert.throws(() => plugin.validate(bad));
    bad.nodes[1].parent = "screen";
    bad.nodes[0].width = Infinity;
    assert.throws(() => plugin.validate(bad));
    const switching = fixture(),
      another = fixture();
    switching.loadFontAsync = async () => {
      switching.currentPage = another.currentPage;
    };
    await assert.rejects(plugin.execute(switching, cmd), /Active page changed/);
    assert.equal(
      another.currentPage.children.length,
      0,
      "No writes after a page switch during async font loading",
    );
    const large = fixture();
    for (let i = 0; i < 20; i++) {
      const frame = large.createFrame();
      for (let j = 0; j < 50; j++) frame.appendChild(large.createRectangle());
    }
    const bounded = await plugin.execute(large, {
      action: "read",
      request_id: "large-read",
    });
    let count = 0;
    const walk = (n) => {
      if (n.id) count++;
      for (const c of n.children || []) walk(c);
    };
    bounded.nodes.forEach(walk);
    assert(count <= 240, "Read shares one node budget across all roots");
    const { JSDOM } = require("jsdom");
    const d = new JSDOM('<section id="root"></section>', {
      runScripts: "outside-only",
    });
    vm.runInContext(
      fs.readFileSync("core/figma.js", "utf8"),
      d.getInternalVMContext(),
    );
    const calls = [];
    d.window.elioFigma.mount(
      d.window.document.querySelector("#root"),
      async (v) => {
        calls.push(v);
        return { ok: true, connected: false, jobs: [] };
      },
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls[0].action, "status");
    assert(d.window.document.querySelector("[data-demo]").disabled);
    d.window.close();
    for (const file of [
      "core/main.js",
      "core/figma.js",
      "background.js",
      "manifest.json",
    ])
      assert.equal(
        fs.readFileSync(file, "utf8"),
        fs.readFileSync("elio-Extension/" + file, "utf8"),
      );
    const manifest = JSON.parse(fs.readFileSync("manifest.json"));
    for (const c of manifest.content_scripts)
      if (c.js?.includes("core/main.js"))
        assert(c.js.indexOf("core/figma.js") < c.js.indexOf("core/main.js"));
    const source = fs.readFileSync("core/main.js", "utf8"),
      start = source.indexOf('    if (name === "elio_figma") {'),
      end = source.indexOf('    if (name === "elio_vault") {', start);
    const handler = new Function(
      "name",
      "args",
      "bg",
      "return (async()=>{" + source.slice(start, end) + "})()",
    );
    let forwarded;
    assert.match(
      await handler("elio_figma", { action: "pair" }, () => {
        throw Error("should not forward");
      }),
      /ERROR/,
    );
    const queued = await handler(
      "elio_figma",
      { action: "apply" },
      async (req) => {
        forwarded = req;
        return { ok: true, state: "queued" };
      },
    );
    assert.equal(forwarded.type, "figma");
    assert.match(queued, /queued/);
    const compact = await handler(
      "elio_figma",
      { action: "result", request_id: "export" },
      async () => ({
        ok: true,
        state: "succeeded",
        result: { ok: true, base64: "x".repeat(100000), mime: "image/png" },
      }),
    );
    assert(compact.length < 1000);
    assert(!compact.includes("xxxxxxxx"));
    assert.match(compact, /asset_available/);
    // No bridge-tools branch must still advertise the Figma tool.
    const a = source.indexOf("  async function ensureTools("),
      b = source.indexOf("\n  function luauLiteral", a),
      ctx = {
        A: { toolList: [], toolNames: new Set() },
        refreshPersonalMemory: async () => {},
        TOOLS_TTL_MS: 10000,
        bg: async () => ({ ok: false, error: "Studio offline" }),
        diag() {},
        syncDesktopToolSnapshot() {},
        elioFigma: design,
        Date,
        Set,
      };
    vm.createContext(ctx);
    vm.runInContext(source.slice(a, b) + ";globalThis.run=ensureTools;", ctx);
    await ctx.run(true);
    assert(ctx.A.toolNames.has("elio_figma"));
    console.log(
      "PASS Figma contracts: native editable layer mapping, Auto Layout/components/text/SVG, font preflight, staged rollback, user-layer preservation, idempotency, unsafe SVG rejection, bounded reads/export, UI bootstrap, schema/manifest parity, guarded dispatch, Figma available with Studio offline. Plugin API is simulated here; real Figma Desktop still needs acceptance testing.",
    );
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
