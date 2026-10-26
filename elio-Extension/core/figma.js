// SPDX-License-Identifier: GPL-3.0-or-later
(function (g) {
  "use strict";
  const props = {
    id: { type: "string" },
    type: {
      type: "string",
      enum: ["FRAME", "COMPONENT", "RECTANGLE", "ELLIPSE", "TEXT", "SVG"],
    },
    parent: { type: "string" },
    name: { type: "string" },
    svg: { type: "string", maxLength: 64000 },
    text: { type: "string", maxLength: 16000 },
    fontFamily: { type: "string" },
    fontStyle: { type: "string" },
    fill: { type: "string" },
    stroke: { type: "string" },
    textAlignHorizontal: {
      type: "string",
      enum: ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"],
    },
    layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"] },
    primaryAxisAlignItems: {
      type: "string",
      enum: ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"],
    },
    counterAxisAlignItems: {
      type: "string",
      enum: ["MIN", "CENTER", "MAX", "BASELINE"],
    },
    primaryAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"] },
    counterAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"] },
    layoutSizingHorizontal: { type: "string", enum: ["FIXED", "HUG", "FILL"] },
    layoutSizingVertical: { type: "string", enum: ["FIXED", "HUG", "FILL"] },
    clipsContent: { type: "boolean" },
  };
  for (const key of [
    "x",
    "y",
    "width",
    "height",
    "fontSize",
    "strokeWeight",
    "cornerRadius",
    "opacity",
    "itemSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ])
    props[key] = { type: "number" };
  const tool = {
    name: "elio_figma",
    server: "elio",
    description:
      "Create real editable Figma UI and vector icons through Elio Link plugin, independently of Roblox. First status, then read (request_id) and result(request_id) to inspect selected file. apply creates/replaces ONLY an Elio-owned root by stable build_id; send the complete 1–120 node tree. First node root FRAME/COMPONENT, others reference an earlier FRAME/COMPONENT parent id. Use Auto Layout, deliberate typography, spacing, accessible palette and native TEXT/COMPONENT layers. Icons use self-contained static SVG. Do not import arbitrary remote SVG/assets. x/y/width/height are pixels; fill/stroke #RRGGBB; fonts must exist in Figma (Inter default). Read before revisions; preserve user-added layers. apply/export/read are asynchronous: queued/running is NOT success; poll result with same request_id. No automatic mutation retries after unknown; read file first. export requires node_id and SVG/PNG; returns base64. Never claim visual quality based only on creation receipt. No Roblox transfer.",
    inputSchema: {
      type: "object",
      required: ["action"],
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["status", "read", "apply", "export", "result"],
        },
        request_id: {
          type: "string",
          description:
            "Unique stable ID for exact request; reuse only to retrieve/recover that same request",
        },
        build_id: { type: "string" },
        node_id: { type: "string" },
        format: { type: "string", enum: ["SVG", "PNG"] },
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 120,
          items: {
            type: "object",
            required: ["id", "type"],
            additionalProperties: false,
            properties: props,
          },
        },
      },
    },
  };
  const example = {
    action: "apply",
    build_id: "elio-link-demo",
    nodes: [
      {
        id: "screen",
        type: "FRAME",
        name: "Elio · UI connection test",
        width: 420,
        height: 280,
        fill: "#24221d",
        cornerRadius: 24,
        layoutMode: "VERTICAL",
        itemSpacing: 18,
        paddingTop: 28,
        paddingLeft: 28,
        paddingRight: 28,
        paddingBottom: 28,
      },
      {
        id: "icon",
        parent: "screen",
        type: "SVG",
        name: "Spark icon",
        width: 32,
        height: 32,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 3L19 12L28 16L19 20L16 29L12 20L3 16L12 12Z" fill="#bda98a"/></svg>',
      },
      {
        id: "title",
        parent: "screen",
        type: "TEXT",
        text: "A calmer creative space",
        fontSize: 25,
        fontStyle: "Bold",
        fill: "#e4ddcf",
        width: 360,
      },
      {
        id: "body",
        parent: "screen",
        type: "TEXT",
        text: "Editable layers. Real Auto Layout. Your design, not a screenshot.",
        fontSize: 15,
        fill: "#b8ac96",
        width: 360,
      },
      {
        id: "button",
        parent: "screen",
        type: "COMPONENT",
        name: "Button / Primary",
        width: 180,
        height: 44,
        fill: "#bda98a",
        cornerRadius: 10,
        layoutMode: "HORIZONTAL",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "CENTER",
      },
      {
        id: "button-label",
        parent: "button",
        type: "TEXT",
        text: "Start creating",
        fontSize: 14,
        fontStyle: "Medium",
        fill: "#24221d",
      },
    ],
  };
  function zip(files) {
    const enc = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    const crc = (data) => {
      let c = ~0;
      for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
      return ~c >>> 0;
    };
    function record(size, signature) {
      const a = new Uint8Array(size),
        d = new DataView(a.buffer);
      d.setUint32(0, signature, true);
      return [a, d];
    }
    for (const [name, text] of Object.entries(files)) {
      const n = enc.encode(name),
        b = enc.encode(text),
        checksum = crc(b),
        [h, d] = record(30, 0x04034b50);
      d.setUint16(4, 20, true);
      d.setUint32(14, checksum, true);
      d.setUint32(18, b.length, true);
      d.setUint32(22, b.length, true);
      d.setUint16(26, n.length, true);
      parts.push(h, n, b);
      const [c, v] = record(46, 0x02014b50);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint32(16, checksum, true);
      v.setUint32(20, b.length, true);
      v.setUint32(24, b.length, true);
      v.setUint16(28, n.length, true);
      v.setUint32(42, offset, true);
      central.push(c, n);
      offset += h.length + n.length + b.length;
    }
    const length = central.reduce((n, a) => n + a.length, 0),
      [end, e] = record(22, 0x06054b50);
    e.setUint16(8, Object.keys(files).length, true);
    e.setUint16(10, Object.keys(files).length, true);
    e.setUint32(12, length, true);
    e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }
  function mount(root, api) {
    root.innerHTML =
      '<style>.ef{max-width:1050px;line-height:1.65}.ef h1{font:600 32px Georgia}.ef h2{font:23px Georgia}.ef section{padding:22px;border:1px solid var(--elio-line,#514b40);border-radius:16px;margin:16px 0;background:var(--elio-surface,#302c25)}.ef button,.ef input{font:inherit;color:inherit;background:var(--elio-canvas,#24221d);border:1px solid var(--elio-line,#514b40);padding:10px 14px;border-radius:9px;margin:4px;max-width:100%}.ef button{cursor:pointer}.ef pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto}.ef input{width:320px}.ef .muted{color:var(--elio-muted,#b8ac96)}.ef img{max-width:100%;max-height:500px}</style><div class="ef"><div class="muted">ELIO · DESIGN CONNECTION</div><h1>Figma, with a creative partner.</h1><p>Create editable UI, native components and vector icons. Roblox is not involved.</p><section><h2>1 · Install Elio Link</h2><p>Download the plugin, extract it, then in <b>Figma Desktop</b> open Plugins → Development → Import plugin from manifest and select its manifest.json.</p><button data-download>Download Figma plugin</button><p class="muted">Uses the official Plugin API. Not an official Figma MCP client. The remote MCP currently requires an approved client; the desktop MCP does not write to the canvas.</p></section><section><h2>2 · Connect this file</h2><p>Open Elio Link in a draft design file. Generate a code here, paste it into the plugin and click Connect. Enable <b>Allow edits</b> in the plugin when ready.</p><button data-pair>Generate pairing code</button><input data-code type="password" readonly aria-label="Figma pairing code" autocomplete="off"><button data-copy>Copy code</button><button data-revoke>Revoke connection</button><p class="muted">A separate, temporary capability. It cannot access your other Elio APIs. It is not your Figma account password or the main Elio pairing key.</p></section><section><h2>3 · Design in chat</h2><p>Ask Elio to create a screen or icon in the connected Figma file. Elio can inspect layers, create a named design, refine its own design and export SVG or PNG.</p><button data-refresh>Refresh status</button><button data-demo>Create test card in Figma</button><button data-svg disabled>Preview / export SVG</button><button data-png disabled>Preview / export PNG</button><button data-save-image disabled>Download export</button><pre data-state>Not connected.</pre><div data-jobs></div><pre data-result></pre><img data-preview hidden alt="Exported Figma design preview"></section><p data-message role="status"></p></div>';
    const q = (k) => root.querySelector("[data-" + k + "]");
    let activeJob = "",
      objectUrl = "",
      exportNode = "",
      exportBlob = null,
      exportFormat = "";
    const say = (s) => (q("message").textContent = s);
    const run = async (v) => {
      const r = await api(v);
      if (!r?.ok) throw Error(r?.error || "Figma connection failed");
      return r;
    };
    function download(blob, name) {
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function refresh() {
      try {
        const r = await run({ action: "status" });
        q("state").textContent = r.connected
          ? (r.writable
              ? "Connected · editing enabled"
              : "Connected · read-only") +
            "\n" +
            (r.document?.name || "") +
            " / " +
            (r.document?.page || "")
          : "Not connected. Keep the Figma plugin open.";
        q("demo").disabled = !r.writable;
        q("jobs").replaceChildren();
        for (const j of (r.jobs || []).slice(-12)) {
          const b = document.createElement("button");
          b.textContent = j.request_id + " · " + j.state;
          b.onclick = () => result(j.request_id);
          q("jobs").append(b);
        }
        if (activeJob) await result(activeJob);
      } catch (e) {
        say(e.message);
      }
    }
    async function result(id) {
      const r = await run({ action: "result", request_id: id });
      q("result").textContent = JSON.stringify(
        r,
        (k, v) => (k === "base64" ? "[image data]" : v),
        2,
      );
      if (["succeeded", "failed", "unknown", "expired"].includes(r.state))
        activeJob = "";
      const image = r.result;
      if (r.state === "succeeded" && image?.node_id) {
        exportNode = image.node_id;
        q("svg").disabled = false;
        q("png").disabled = false;
      }
      if (
        image?.ok &&
        image.base64 &&
        ["image/png", "image/svg+xml"].includes(image.mime)
      ) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        exportBlob = new Blob(
          [Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0))],
          { type: image.mime },
        );
        exportFormat = image.format.toLowerCase();
        q("save-image").disabled = false;
        objectUrl = URL.createObjectURL(exportBlob);
        q("preview").src = objectUrl;
        q("preview").hidden = false;
      }
      return r;
    }
    q("download").onclick = async () => {
      try {
        const r = await run({ action: "plugin-files" });
        download(zip(r.files), "Elio-Figma-Plugin.zip");
        say("Extract the ZIP and import manifest.json in Figma Desktop.");
      } catch (e) {
        say(e.message);
      }
    };
    q("pair").onclick = async () => {
      try {
        const r = await run({ action: "pair" });
        q("code").value = r.pairing_code;
        say(
          "Paste the code in Elio Link. It expires in 4 hours or when Elio restarts.",
        );
        await refresh();
      } catch (e) {
        say(e.message);
      }
    };
    q("copy").onclick = async () => {
      try {
        if (!q("code").value) throw Error("Generate a code first");
        await navigator.clipboard.writeText(q("code").value);
        say("Code copied.");
      } catch (e) {
        q("code").type = "text";
        q("code").select();
        say("Copy the selected code, then paste it into the Figma plugin.");
      }
    };
    q("revoke").onclick = async () => {
      try {
        await run({ action: "revoke" });
        q("code").value = "";
        await refresh();
        say(
          "Connection revoked. Running edits may already have completed; inspect the file before retrying.",
        );
      } catch (e) {
        say(e.message);
      }
    };
    q("refresh").onclick = refresh;
    for (const format of ["SVG", "PNG"])
      q(format.toLowerCase()).onclick = async () => {
        try {
          const r = await run({
            action: "export",
            request_id: "export-" + crypto.randomUUID(),
            node_id: exportNode,
            format,
          });
          activeJob = r.request_id;
          await refresh();
        } catch (e) {
          say(e.message);
        }
      };
    q("save-image").onclick = () => {
      if (exportBlob) download(exportBlob, "elio-figma-export." + exportFormat);
    };
    q("demo").onclick = async () => {
      if (
        !confirm(
          "Create an Elio test card in the connected Figma page? A prior Elio demo may be replaced; other designs are preserved.",
        )
      )
        return;
      try {
        const r = await run({
          ...example,
          request_id: "demo-" + crypto.randomUUID(),
        });
        activeJob = r.request_id;
        say("Queued, not yet created. Waiting for the plugin result.");
        await refresh();
      } catch (e) {
        say(e.message);
      }
    };
    refresh();
    return { refresh, poll: refresh };
  }
  g.elioFigma = { tool, example, mount, zip };
  if (typeof module !== "undefined") module.exports = g.elioFigma;
})(globalThis);
