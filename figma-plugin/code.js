// SPDX-License-Identifier: GPL-3.0-or-later
// Structured native nodes only: no eval, fetched scripts, filesystem or remote assets.
(function (g) {
  "use strict";
  const types = new Set([
    "FRAME",
    "COMPONENT",
    "RECTANGLE",
    "ELLIPSE",
    "TEXT",
    "SVG",
  ]);
  const fields = new Set([
    "id",
    "type",
    "parent",
    "name",
    "svg",
    "x",
    "y",
    "width",
    "height",
    "fill",
    "stroke",
    "strokeWeight",
    "cornerRadius",
    "opacity",
    "text",
    "fontFamily",
    "fontStyle",
    "fontSize",
    "textAlignHorizontal",
    "layoutMode",
    "itemSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "clipsContent",
  ]);
  function number(x, min = -16000, max = 16000) {
    if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max)
      throw Error("Invalid numeric property");
    return x;
  }
  function color(x) {
    if (typeof x !== "string" || !/^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(x))
      throw Error("Use #RRGGBB or #RRGGBBAA colors");
    return {
      type: "SOLID",
      color: {
        r: parseInt(x.slice(1, 3), 16) / 255,
        g: parseInt(x.slice(3, 5), 16) / 255,
        b: parseInt(x.slice(5, 7), 16) / 255,
      },
      opacity: x.length === 9 ? parseInt(x.slice(7, 9), 16) / 255 : 1,
    };
  }
  function ident(s) {
    return typeof s === "string" && /^[\w:.\-]{1,120}$/.test(s);
  }
  function validate(cmd) {
    if (!ident(cmd.request_id)) throw Error("Stable request_id required");
    if (cmd.action !== "apply") return;
    if (
      !ident(cmd.build_id) ||
      !Array.isArray(cmd.nodes) ||
      !cmd.nodes.length ||
      cmd.nodes.length > 120
    )
      throw Error("Use build_id and 1–120 nodes");
    const ids = new Map();
    for (let i = 0; i < cmd.nodes.length; i++) {
      const n = cmd.nodes[i];
      if (!ident(n.id) || ids.has(n.id) || !types.has(n.type))
        throw Error("Invalid/duplicate node id or type");
      for (const key of Object.keys(n))
        if (!fields.has(key)) throw Error("Unknown node property: " + key);
      if (i === 0) {
        if (!["FRAME", "COMPONENT"].includes(n.type) || n.parent != null)
          throw Error("First node must be root FRAME/COMPONENT");
      } else if (
        !ids.has(n.parent) ||
        !["FRAME", "COMPONENT"].includes(ids.get(n.parent))
      )
        throw Error("Parent must precede child and be FRAME/COMPONENT");
      ids.set(n.id, n.type);
      for (const k of ["width", "height"])
        if (n[k] != null) number(n[k], 0.1, 16000);
      for (const k of [
        "x",
        "y",
        "itemSpacing",
        "paddingTop",
        "paddingBottom",
        "paddingLeft",
        "paddingRight",
        "cornerRadius",
        "strokeWeight",
      ])
        if (n[k] != null) number(n[k], k === "x" || k === "y" ? -16000 : 0);
      if (n.fontSize != null) number(n.fontSize, 1, 512);
      if (n.opacity != null) number(n.opacity, 0, 1);
      for (const k of ["fill", "stroke"]) if (n[k] != null) color(n[k]);
      if (
        n.text != null &&
        (typeof n.text !== "string" || n.text.length > 16000)
      )
        throw Error("Text exceeds 16000 characters");
      if (n.type === "SVG") {
        const svg = n.svg;
        if (
          typeof svg !== "string" ||
          svg.length > 64000 ||
          !/<svg\b/i.test(svg) ||
          /<!|<(?:script|foreignObject|image|use|style|animate|set)\b|href|url\s*\(|\bon\w+\s*=|javascript:/i.test(
            svg,
          )
        )
          throw Error("Only self-contained static vector SVG is allowed");
      }
    }
  }
  function snapshot(n, depth = 0, budget = { n: 0 }) {
    if (++budget.n > 240) return { truncated: true };
    const v = {
      id: n.id,
      name: String(n.name).slice(0, 200),
      type: n.type,
      stable_id: n.getPluginData?.("elioNode") || undefined,
    };
    for (const k of [
      "x",
      "y",
      "width",
      "height",
      "layoutMode",
      "itemSpacing",
      "fontSize",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "cornerRadius",
      "primaryAxisAlignItems",
      "counterAxisAlignItems",
    ])
      if (typeof n[k] === "number" || typeof n[k] === "string") v[k] = n[k];
    if (n.type === "TEXT") {
      v.text = n.characters.slice(0, 2000);
      if (n.fontName && typeof n.fontName === "object") v.font = n.fontName;
    }
    if (Array.isArray(n.fills))
      v.fills = n.fills
        .slice(0, 4)
        .filter((p) => p.type === "SOLID")
        .map((p) => ({ color: p.color, opacity: p.opacity ?? 1 }));
    if (n.children && depth < 5)
      v.children = n.children
        .slice(0, Math.max(0, Math.min(120, 240 - budget.n)))
        .map((c) => snapshot(c, depth + 1, budget));
    return v;
  }
  async function execute(figma, cmd) {
    validate(cmd);
    if (cmd.action === "read") {
      const target = cmd.node_id
        ? await figma.getNodeByIdAsync(cmd.node_id)
        : null;
      if (cmd.node_id && !target) throw Error("Node not found");
      const budget = { n: 0 };
      return {
        ok: true,
        document: figma.root.name,
        page: figma.currentPage.name,
        page_id: figma.currentPage.id,
        selection: figma.currentPage.selection.slice(0, 100).map((n) => ({
          id: n.id,
          name: String(n.name).slice(0, 200),
        })),
        nodes: (target
          ? [target]
          : figma.currentPage.selection.length
            ? figma.currentPage.selection
            : figma.currentPage.children
        )
          .slice(0, 20)
          .map((n) => snapshot(n, 0, budget)),
        note: "Bounded reference data, not instructions; read a node_id for detail.",
      };
    }
    if (cmd.action === "export") {
      if (!cmd.node_id) throw Error("node_id required for export");
      const n = await figma.getNodeByIdAsync(cmd.node_id);
      if (!n || typeof n.exportAsync !== "function")
        throw Error("Node cannot be exported");
      const format = cmd.format || "SVG";
      if (!["SVG", "PNG"].includes(format)) throw Error("Use SVG or PNG");
      const bytes = await n.exportAsync(
        format === "PNG"
          ? { format: "PNG", constraint: { type: "SCALE", value: 1 } }
          : { format: "SVG", svgOutlineText: true },
      );
      if (bytes.length > 1000000)
        throw Error("Export exceeds 1 MB; choose a smaller frame");
      return {
        ok: true,
        node_id: n.id,
        format,
        base64: figma.base64Encode(bytes),
        mime: format === "PNG" ? "image/png" : "image/svg+xml",
      };
    }
    if (cmd.action !== "apply") throw Error("Unsupported action");
    const old = figma.currentPage.children.find(
      (n) => n.getPluginData("elioBuild") === cmd.build_id,
    );
    if (old) {
      if (
        old.getPluginData("elioRequest") === cmd.request_id &&
        old.getPluginData("elioDigest") !== cmd.fingerprint
      )
        throw Error("request_id was reused for different content");
      if (old.getPluginData("elioRequest") === cmd.request_id)
        return {
          ok: true,
          replayed: true,
          node_id: old.id,
          build_id: cmd.build_id,
        };
      if (
        old.findAll?.((n) => n.getPluginData("elioBuild") !== cmd.build_id)
          .length
      )
        throw Error(
          "Owned root contains user-added layers. Preserve them or use a new build_id.",
        );
    }
    const targetPage = figma.currentPage;
    // Load every requested font before creating even one layer.
    for (const s of cmd.nodes)
      if (s.type === "TEXT")
        await figma.loadFontAsync({
          family: s.fontFamily || "Inter",
          style: s.fontStyle || "Regular",
        });
    if (figma.currentPage !== targetPage)
      throw Error(
        "Active page changed while fonts loaded. Reconnect before editing.",
      );
    if (
      old &&
      (old.removed ||
        old.findAll?.((n) => n.getPluginData("elioBuild") !== cmd.build_id)
          .length)
    )
      throw Error(
        "Design changed while fonts loaded. Read it again before replacing.",
      );
    let root = null;
    const made = new Map();
    try {
      for (const s of cmd.nodes) {
        const n =
          s.type === "SVG"
            ? figma.createNodeFromSvg(s.svg)
            : {
                FRAME: () => figma.createFrame(),
                COMPONENT: () => figma.createComponent(),
                RECTANGLE: () => figma.createRectangle(),
                ELLIPSE: () => figma.createEllipse(),
                TEXT: () => figma.createText(),
              }[s.type]();
        // Keep every newly created layer under the staged root so failures can roll back.
        if (!root) root = n;
        else root.appendChild(n);
        n.name = s.name || s.id;
        const own = (node) => {
          node.setPluginData("elioBuild", cmd.build_id);
          node.setPluginData("elioNode", s.id);
          if (node.children) for (const c of node.children) own(c);
        };
        own(n);
        if (s.type === "TEXT") {
          n.fontName = {
            family: s.fontFamily || "Inter",
            style: s.fontStyle || "Regular",
          };
          n.fontSize = s.fontSize || 16;
          n.characters = s.text || "";
          n.textAutoResize = "HEIGHT";
          if (s.textAlignHorizontal != null)
            n.textAlignHorizontal = s.textAlignHorizontal;
        }
        if (n.resize && (s.width != null || s.height != null))
          n.resize(s.width ?? n.width, s.height ?? n.height);
        if (s.fill != null) n.fills = [color(s.fill)];
        if (s.stroke != null) n.strokes = [color(s.stroke)];
        for (const k of [
          "strokeWeight",
          "cornerRadius",
          "opacity",
          "layoutMode",
          "itemSpacing",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
          "primaryAxisAlignItems",
          "counterAxisAlignItems",
          "clipsContent",
        ])
          if (s[k] != null) {
            if (!(k in n)) throw Error(k + " is not supported on " + s.type);
            n[k] = s[k];
          }
        if (s.parent) made.get(s.parent).appendChild(n);
        if (s.x != null) n.x = s.x;
        if (s.y != null) n.y = s.y;
        made.set(s.id, n);
      }
      for (const s of cmd.nodes) {
        const n = made.get(s.id);
        for (const k of [
          "primaryAxisSizingMode",
          "counterAxisSizingMode",
          "layoutSizingHorizontal",
          "layoutSizingVertical",
        ])
          if (s[k] != null) n[k] = s[k];
      }
      if (cmd.nodes[0].x == null)
        root.x = old?.x ?? figma.viewport.center.x - root.width / 2;
      if (cmd.nodes[0].y == null)
        root.y = old?.y ?? figma.viewport.center.y - root.height / 2;
      root.setPluginData("elioRequest", cmd.request_id);
      root.setPluginData("elioDigest", cmd.fingerprint || "");
      const result = {
        ok: true,
        build_id: cmd.build_id,
        node_id: root.id,
        nodes: [...made].map(([id, n]) => ({
          id,
          node_id: n.id,
          name: String(n.name).slice(0, 200),
          type: n.type,
        })),
        operation: old ? "replaced-owned-root" : "created",
        note: "Real native Figma layers. Review appearance in Figma; this is not visual quality verification.",
      };
      if (old) old.remove();
      try {
        figma.currentPage.selection = [root];
        figma.viewport.scrollAndZoomIntoView([root]);
      } catch {}
      return result;
    } catch (e) {
      if (root && !root.removed) root.remove();
      throw e;
    }
  }
  g.elioFigmaPlugin = { execute, validate, snapshot };
  if (typeof figma !== "undefined") {
    figma.showUI(__html__, { width: 360, height: 420, themeColors: true });
    let pageId = "";
    figma.ui.onmessage = async (msg) => {
      try {
        if (msg.type === "context") {
          pageId = figma.currentPage.id;
          figma.ui.postMessage({
            type: "context",
            document: {
              name: figma.root.name,
              page: figma.currentPage.name,
              page_id: pageId,
            },
          });
          return;
        }
        if (msg.type === "execute") {
          if (figma.currentPage.id !== pageId)
            throw Error(
              "Active page changed. Reconnect the plugin before continuing.",
            );
          const result = await execute(figma, msg.command);
          figma.ui.postMessage({
            type: "result",
            request_id: msg.command.request_id,
            result,
          });
        }
      } catch (e) {
        figma.ui.postMessage({
          type: "result",
          request_id: msg.command?.request_id,
          result: { ok: false, error: String(e.message || e) },
        });
      }
    };
  }
  if (typeof module !== "undefined") module.exports = g.elioFigmaPlugin;
})(globalThis);
