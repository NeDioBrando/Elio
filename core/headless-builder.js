// SPDX-License-Identifier: GPL-3.0-or-later
// core/headless-builder.js - strict, deterministic JSON/DOM-blueprint compiler
// for headless Roblox Instance construction. It never opens a browser tab,
// invokes a website, uploads an asset, or touches Studio UI. The compiler first
// validates and simulates the full hierarchy locally, then emits one bounded
// transactional Luau program for the existing execute_luau transport.
// eslint-disable-next-line no-unused-vars
const ZSHeadlessBuilder = (() => {
  "use strict";

  const FORMAT_VERSION = 1;
  const MAX_REQUEST_CHARS = 60000;
  const MAX_NODES = 120;
  const MAX_PROPERTIES = 64;
  const MAX_ATTRIBUTES = 32;
  const MAX_DEPTH = 32;
  const MAX_STRING = 12000;
  const IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
  const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const PROPERTY_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
  const NAME_RE = /^[^\u0000-\u001f\u007f.]{1,100}$/;
  const PATH_RE = /^game(?:\.[A-Za-z_][A-Za-z0-9_]*){1,15}$/;
  const BLOCKED_PROPERTIES = new Set(["Name", "Parent", "Source", "LinkedSource", "ScriptGuid", "UniqueId", "HistoryId"]);
  const RESERVED_ATTRIBUTES = new Set(["elioBuildId", "elioNodeId", "elioActionId", "elioActionLedger"]);
  const ASSET_PROPERTIES = new Set(["Image", "Video", "MeshId", "TextureId", "TextureID", "Texture"]);

  const UI_CLASSES = new Set([
    "ScreenGui", "BillboardGui", "SurfaceGui", "Frame", "ScrollingFrame", "CanvasGroup",
    "TextLabel", "TextButton", "TextBox", "ImageLabel", "ImageButton", "ViewportFrame",
    "VideoFrame", "Folder", "UICorner", "UIStroke", "UIGradient", "UIPadding", "UIListLayout",
    "UIGridLayout", "UIPageLayout", "UITableLayout", "UIAspectRatioConstraint", "UIScale",
    "UISizeConstraint", "UITextSizeConstraint", "UIFlexItem",
  ]);
  const MODEL_CLASSES = new Set([
    "Model", "Folder", "Part", "WedgePart", "CornerWedgePart", "TrussPart", "Seat", "VehicleSeat",
    "SpawnLocation", "MeshPart", "UnionOperation", "Attachment", "WeldConstraint", "Motor6D",
    "SpecialMesh", "BlockMesh", "CylinderMesh", "Decal", "Texture", "SurfaceAppearance",
    "PointLight", "SpotLight", "SurfaceLight", "ParticleEmitter", "Beam", "Trail", "Highlight",
    "Sound", "Smoke", "Fire", "Sparkles",
    "ProximityPrompt", "ClickDetector", "Humanoid", "AnimationController", "Bone",
    "BallSocketConstraint", "HingeConstraint", "RopeConstraint", "RodConstraint", "SpringConstraint",
    "AlignPosition", "AlignOrientation", "LinearVelocity", "AngularVelocity", "VectorForce",
  ]);
  // A 3D assembly can legitimately carry SurfaceGui/BillboardGui labels and
  // native UI decorators on its parts. Root restrictions still require a
  // Model/Folder, so this does not let model mode target or replace StarterGui.
  for (const className of UI_CLASSES) if (className !== "ScreenGui") MODEL_CLASSES.add(className);
  const ROOT_CLASSES = {
    ui: new Set(["ScreenGui", "BillboardGui", "SurfaceGui"]),
    model: new Set(["Model", "Folder"]),
  };
  const TARGET_PREFIXES = {
    ui: ["game.StarterGui", "game.ReplicatedStorage"],
    model: ["game.Workspace", "game.ReplicatedStorage", "game.ServerStorage"],
  };
  const VALUE_TYPES = new Set([
    "Color3", "Vector2", "Vector3", "UDim", "UDim2", "CFrame", "Enum", "Ref", "Rect",
    "NumberRange", "NumberSequence", "ColorSequence", "BrickColor", "Nil",
  ]);

  const TOOL = Object.freeze({
    name: "headless_build", server: "roblox",
    description: "Validate, dry-run, and transactionally create or patch an owned Roblox UI/model hierarchy from structured JSON or an optional inline-HTML UI blueprint. Runs headlessly through Studio with no Figma, Meshy, browser tab, import menu, or visible Studio UI. Use stable build_id/root_name across bounded passes; action_id is exactly-once idempotency.",
    inputSchema: {
      type: "object",
      required: ["action_id", "build_id", "mode", "operation", "target_parent", "root_name"],
      additionalProperties: false,
      properties: {
        action_id: { type: "string", description: "Unique id for this exact mutation; reuse only to recover the same ambiguous result" },
        build_id: { type: "string", description: "Stable owner id reused across every refinement pass for this one UI/model" },
        mode: { type: "string", enum: ["ui", "model"] },
        operation: { type: "string", enum: ["replace", "patch"], description: "replace atomically swaps one owned root; patch updates/creates/deletes node ids inside it" },
        target_parent: { type: "string", description: "Exact safe game dot-path: UI under StarterGui/ReplicatedStorage; model under Workspace/ReplicatedStorage/ServerStorage" },
        root_name: { type: "string", description: "Stable root name; an unrelated same-name instance is never replaced" },
        root_id: { type: "string", description: "Required for replace nodes; defaults to root" },
        nodes: {
          type: "array",
          description: "1-120 flat node records. replace: every node needs id/class and exactly one root; parent references another id. patch: existing records omit create/class/parent; new records set create=true plus class/parent.",
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" }, create: { type: "boolean" }, class: { type: "string" },
              name: { type: "string" }, parent: { type: "string" },
              properties: { type: "object" }, attributes: { type: "object" },
            },
          },
        },
        delete_ids: { type: "array", items: { type: "string" }, description: "Patch-only non-root owned node ids to delete at commit" },
        html: { type: "string", description: "Replace/UI-only inert HTML blueprint. Inline CSS flex/grid/padding/colors/type/radii is converted locally; scripts, handlers, URLs, and style/link tags are rejected." },
        viewport: { type: "object", description: "Optional HTML pixel reference size: {width,height}; defaults to 1920x1080" },
      },
    },
  });

  function error(message) { return { error: String(message) }; }
  function ownObject(value) {
    // Object.prototype identity differs across content-script/test VM realms.
    // The tag check accepts an ordinary cross-realm JSON object while still
    // rejecting arrays, dates, DOM nodes, class instances, and functions.
    return !!value && typeof value === "object" && !Array.isArray(value) &&
      Object.prototype.toString.call(value) === "[object Object]";
  }
  function cleanString(value, label, max = MAX_STRING) {
    if (typeof value !== "string") throw new Error(`${label} must be a string`);
    if (!value.length || value.length > max) throw new Error(`${label} must contain 1-${max} characters`);
    if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} contains an unsafe control character`);
    return value;
  }
  function finite(value, label, min = -1e9, max = 1e9) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be a finite number from ${min} to ${max}`);
    return Object.is(n, -0) ? 0 : n;
  }
  function exactKeys(obj, allowed, label) {
    for (const key of Object.keys(obj)) if (!allowed.has(key)) throw new Error(`${label} has unknown key '${key}'`);
  }
  function samePrefix(path, prefixes) {
    return prefixes.some((prefix) => path === prefix || path.startsWith(prefix + "."));
  }
  function normalizeColor(raw, label) {
    if (typeof raw.hex === "string") {
      const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw.hex.trim());
      if (!m) throw new Error(`${label}.hex must be #RRGGBB or #RRGGBBAA`);
      return {
        type: "Color3",
        r: parseInt(m[1].slice(0, 2), 16) / 255,
        g: parseInt(m[1].slice(2, 4), 16) / 255,
        b: parseInt(m[1].slice(4, 6), 16) / 255,
      };
    }
    return {
      type: "Color3",
      r: finite(raw.r, `${label}.r`, 0, 1),
      g: finite(raw.g, `${label}.g`, 0, 1),
      b: finite(raw.b, `${label}.b`, 0, 1),
    };
  }
  function normalizeValue(value, label, refs) {
    if (value === null) return { type: "Nil" };
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return finite(value, label);
    if (typeof value === "string") return cleanString(value, label);
    if (!ownObject(value)) throw new Error(`${label} must be a scalar or a typed Roblox value object`);
    const type = cleanString(value.type, `${label}.type`, 32);
    if (!VALUE_TYPES.has(type)) throw new Error(`${label}.type '${type}' is unsupported`);
    if (type === "Nil") return { type };
    if (type === "Color3") return normalizeColor(value, label);
    if (type === "Vector2") return { type, x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`) };
    if (type === "Vector3") return { type, x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`), z: finite(value.z, `${label}.z`) };
    if (type === "UDim") return { type, scale: finite(value.scale, `${label}.scale`, -1000, 1000), offset: finite(value.offset, `${label}.offset`) };
    if (type === "UDim2") return {
      type,
      xs: finite(value.xScale != null ? value.xScale : value.xs, `${label}.xScale`, -1000, 1000),
      xo: finite(value.xOffset != null ? value.xOffset : value.xo, `${label}.xOffset`),
      ys: finite(value.yScale != null ? value.yScale : value.ys, `${label}.yScale`, -1000, 1000),
      yo: finite(value.yOffset != null ? value.yOffset : value.yo, `${label}.yOffset`),
    };
    if (type === "CFrame") return {
      type, x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`), z: finite(value.z, `${label}.z`),
      rx: finite(value.rx || 0, `${label}.rx`, -360000, 360000),
      ry: finite(value.ry || 0, `${label}.ry`, -360000, 360000),
      rz: finite(value.rz || 0, `${label}.rz`, -360000, 360000),
    };
    if (type === "Enum") {
      const enumValue = cleanString(value.value, `${label}.value`, 100);
      if (!/^Enum\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(enumValue)) throw new Error(`${label}.value must look like Enum.Font.Gotham`);
      return { type, value: enumValue.slice(5) };
    }
    if (type === "Ref") {
      const id = cleanString(value.id, `${label}.id`, 64);
      if (!NODE_ID_RE.test(id)) throw new Error(`${label}.id is invalid`);
      refs.add(id);
      return { type, id };
    }
    if (type === "Rect") return {
      type,
      minX: finite(value.minX, `${label}.minX`), minY: finite(value.minY, `${label}.minY`),
      maxX: finite(value.maxX, `${label}.maxX`), maxY: finite(value.maxY, `${label}.maxY`),
    };
    if (type === "NumberRange") {
      const min = finite(value.min, `${label}.min`), max = finite(value.max == null ? value.min : value.max, `${label}.max`);
      if (max < min) throw new Error(`${label}.max cannot be less than min`);
      return { type, min, max };
    }
    if (type === "BrickColor") return { type, name: cleanString(value.name, `${label}.name`, 80) };
    if (type === "NumberSequence") {
      if (!Array.isArray(value.keypoints) || !value.keypoints.length || value.keypoints.length > 32) throw new Error(`${label}.keypoints must contain 1-32 records`);
      const keypoints = value.keypoints.map((point, index) => {
        if (!ownObject(point)) throw new Error(`${label}.keypoints[${index}] must be an object`);
        return {
          time: finite(point.time, `${label}.keypoints[${index}].time`, 0, 1),
          value: finite(point.value, `${label}.keypoints[${index}].value`),
          envelope: finite(point.envelope || 0, `${label}.keypoints[${index}].envelope`, 0, 1e9),
        };
      }).sort((a, b) => a.time - b.time);
      if (keypoints[0].time !== 0 || keypoints[keypoints.length - 1].time !== 1) throw new Error(`${label} must start at time 0 and end at time 1`);
      for (let index = 1; index < keypoints.length; index++) if (keypoints[index].time <= keypoints[index - 1].time) throw new Error(`${label} keypoint times must be strictly increasing`);
      return { type, keypoints };
    }
    if (type === "ColorSequence") {
      if (!Array.isArray(value.keypoints) || !value.keypoints.length || value.keypoints.length > 32) throw new Error(`${label}.keypoints must contain 1-32 records`);
      const keypoints = value.keypoints.map((point, index) => {
        if (!ownObject(point)) throw new Error(`${label}.keypoints[${index}] must be an object`);
        return {
          time: finite(point.time, `${label}.keypoints[${index}].time`, 0, 1),
          color: normalizeColor(point.color || {}, `${label}.keypoints[${index}].color`),
        };
      }).sort((a, b) => a.time - b.time);
      if (keypoints[0].time !== 0 || keypoints[keypoints.length - 1].time !== 1) throw new Error(`${label} must start at time 0 and end at time 1`);
      for (let index = 1; index < keypoints.length; index++) if (keypoints[index].time <= keypoints[index - 1].time) throw new Error(`${label} keypoint times must be strictly increasing`);
      return { type, keypoints };
    }
    throw new Error(`${label}.type '${type}' is unsupported`);
  }

  function expectedValueType(className, property) {
    if (/^(?:Frame|ScrollingFrame|CanvasGroup|TextLabel|TextButton|TextBox|ImageLabel|ImageButton|ViewportFrame|VideoFrame)$/.test(className)) {
      if (property === "Size" || property === "Position") return "UDim2";
      if (property === "AnchorPoint") return "Vector2";
    }
    if (/^(?:Part|WedgePart|CornerWedgePart|TrussPart|Seat|VehicleSeat|SpawnLocation|MeshPart|UnionOperation)$/.test(className)) {
      if (property === "Size" || property === "Position" || property === "Orientation" || property === "AssemblyLinearVelocity" || property === "AssemblyAngularVelocity") return "Vector3";
      if (property === "CFrame" || property === "PivotOffset") return "CFrame";
      if (property === "Color") return "Color3";
    }
    if ((className === "UIGradient" || /^(?:ParticleEmitter|Beam|Trail)$/.test(className)) && property === "Color") return "ColorSequence";
    if ((className === "UIGradient" || /^(?:ParticleEmitter|Beam|Trail)$/.test(className)) && property === "Transparency") return "NumberSequence";
    if (className === "ParticleEmitter" && property === "Size") return "NumberSequence";
    if (/Color3$/.test(property) || property === "Color") return "Color3";
    if (className === "UICorner" && property === "CornerRadius") return "UDim";
    if (className === "UIPadding" && /^Padding/.test(property)) return "UDim";
    if (className === "UIListLayout" && property === "Padding") return "UDim";
    if (className === "UIGridLayout" && (property === "CellSize" || property === "CellPadding")) return "UDim2";
    if (className === "UIGradient" && property === "Offset") return "Vector2";
    return "";
  }
  function valueKind(value) {
    if (value && typeof value === "object" && typeof value.type === "string") return value.type;
    return typeof value;
  }
  function normalizeMap(raw, label, refs, className, attributes = false) {
    if (raw == null) return {};
    if (!ownObject(raw)) throw new Error(`${label} must be an object`);
    const entries = Object.keys(raw).sort();
    const limit = attributes ? MAX_ATTRIBUTES : MAX_PROPERTIES;
    if (entries.length > limit) throw new Error(`${label} is limited to ${limit} entries`);
    const out = {};
    for (const key of entries) {
      if (!PROPERTY_RE.test(key)) throw new Error(`${label} key '${key}' is invalid`);
      if (!attributes && BLOCKED_PROPERTIES.has(key)) throw new Error(`${label}.${key} is blocked; hierarchy and script source are handled by dedicated fields/tools`);
      const normalized = normalizeValue(raw[key], `${label}.${key}`, refs);
      if (attributes && RESERVED_ATTRIBUTES.has(key)) throw new Error(`${label}.${key} is reserved for ownership/idempotency enforcement`);
      if (attributes && /^(?:Ref|Enum|NumberSequence|ColorSequence)$/.test(valueKind(normalized))) {
        throw new Error(`${label}.${key} uses a value type Roblox attributes cannot safely store`);
      }
      if (!attributes) {
        if (ASSET_PROPERTIES.has(key) && typeof normalized === "string" && normalized &&
            !/^(?:rbxassetid:\/\/\d+|rbxasset:\/\/textures\/[A-Za-z0-9_./ -]+|rbxthumb:\/\/[^\s]+|https:\/\/(?:www\.)?roblox\.com\/asset\/\?id=\d+)$/i.test(normalized)) {
          throw new Error(`${label}.${key} must be empty or a Roblox asset/content URI; arbitrary external URLs are blocked`);
        }
        const expected = expectedValueType(className, key);
        const actual = valueKind(normalized);
        if (expected && actual !== expected) {
          const hint = expected === "ColorSequence" && actual === "Color3"
            ? `. ${className}.${key} uses {"type":"ColorSequence","keypoints":[{"time":0,"color":${JSON.stringify(normalized)}},{"time":1,"color":${JSON.stringify(normalized)}}]}. This example keeps your color constant; use different endpoint colors for a gradient. Correct the value and resubmit; do not reread unrelated scripts.`
            : "";
          throw new Error(`${label}.${key} requires ${expected}, not ${actual}${hint}`);
        }
        if (actual === "Nil") throw new Error(`${label}.${key} cannot be null; omit it instead`);
      }
      out[key] = normalized;
    }
    return out;
  }

  function parseLength(value, viewport, axis) {
    const text = String(value || "").trim().toLowerCase();
    let m = /^(-?\d+(?:\.\d+)?)%$/.exec(text);
    if (m) return { scale: Number(m[1]) / 100, offset: 0 };
    m = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(text);
    if (m) return { scale: 0, offset: Number(m[1]) };
    m = /^(-?\d+(?:\.\d+)?)v([wh])$/.exec(text);
    if (m) return { scale: 0, offset: Number(m[1]) / 100 * viewport[m[2] === "w" ? "width" : "height"] };
    return axis === "size" ? { scale: 1, offset: 0 } : { scale: 0, offset: 0 };
  }
  function cssColor(value) {
    const text = String(value || "").trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      return { color: normalizeColor({ hex: h.slice(0, 6) }, "css color"), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text);
    if (!m) return null;
    return {
      color: { type: "Color3", r: Math.min(255, Number(m[1])) / 255, g: Math.min(255, Number(m[2])) / 255, b: Math.min(255, Number(m[3])) / 255 },
      alpha: m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4]))),
    };
  }
  function directText(el) {
    return [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue || "").join(" ").replace(/\s+/g, " ").trim();
  }
  function safeHtmlBlueprint(args) {
    if (typeof DOMParser === "undefined") throw new Error("inline HTML blueprint parsing is unavailable in this environment; use nodes JSON instead");
    if (args.mode !== "ui" || args.operation !== "replace") throw new Error("html is supported only for mode=ui and operation=replace");
    const html = cleanString(args.html, "html", 40000);
    if (/<\s*(?:script|style|link|iframe|object|embed|svg|canvas|video|audio)\b/i.test(html) || /\son[a-z]+\s*=/i.test(html) || /(?:javascript|data|file):/i.test(html)) {
      throw new Error("html contains a blocked executable, external-resource, event-handler, or active-content construct");
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (doc.querySelector("parsererror")) throw new Error("html could not be parsed");
    const viewport = ownObject(args.viewport) ? {
      width: finite(args.viewport.width || 1920, "viewport.width", 100, 16384),
      height: finite(args.viewport.height || 1080, "viewport.height", 100, 16384),
    } : { width: 1920, height: 1080 };
    const nodes = [{ id: args.root_id || "root", class: "ScreenGui", name: args.root_name, properties: { ResetOnSpawn: false, IgnoreGuiInset: true } }];
    const used = new Set([nodes[0].id]);
    let serial = 0;
    const makeId = (el) => {
      const source = String(el.getAttribute("data-node-id") || el.id || `${el.tagName.toLowerCase()}_${++serial}`).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56) || `node_${++serial}`;
      let id = /^[A-Za-z0-9]/.test(source) ? source : `n_${source}`;
      let suffix = 2;
      while (used.has(id)) id = `${source.slice(0, 50)}_${suffix++}`;
      used.add(id); return id;
    };
    const visit = (el, parentId) => {
      if (nodes.length >= MAX_NODES) throw new Error(`html expands beyond ${MAX_NODES} Roblox instances`);
      const tag = el.tagName.toLowerCase();
      const style = el.style;
      let className = /^(button)$/.test(tag) ? "TextButton" : /^(input|textarea)$/.test(tag) ? "TextBox" :
        tag === "img" ? "ImageLabel" : /^(p|span|label|h[1-6])$/.test(tag) ? "TextLabel" : "Frame";
      if (style.opacity && Number(style.opacity) < 1 && className === "Frame") className = "CanvasGroup";
      const id = makeId(el);
      const name = String(el.getAttribute("data-name") || el.id || tag).replace(/[.\u0000-\u001f\u007f]/g, "_").slice(0, 100) || id;
      const x = parseLength(style.left || el.getAttribute("data-x") || "0", viewport, "position");
      const y = parseLength(style.top || el.getAttribute("data-y") || "0", viewport, "position");
      const w = parseLength(style.width || el.getAttribute("width") || "100%", viewport, "size");
      const h = parseLength(style.height || el.getAttribute("height") || (/^h[1-6]$/.test(tag) ? "56px" : /^(p|span|label|button|input|textarea)$/.test(tag) ? "40px" : "100%"), viewport, "size");
      const properties = {
        Position: { type: "UDim2", xScale: x.scale, xOffset: x.offset, yScale: y.scale, yOffset: y.offset },
        Size: { type: "UDim2", xScale: w.scale, xOffset: w.offset, yScale: h.scale, yOffset: h.offset },
        BorderSizePixel: 0,
      };
      const background = cssColor(style.backgroundColor || el.getAttribute("data-background"));
      if (background) {
        properties.BackgroundColor3 = background.color;
        properties.BackgroundTransparency = 1 - background.alpha;
      } else properties.BackgroundTransparency = className === "Frame" || className === "CanvasGroup" ? 1 : 0;
      if (className === "CanvasGroup") properties.GroupTransparency = 1 - Math.max(0, Math.min(1, Number(style.opacity) || 1));
      if (style.overflow === "hidden") properties.ClipsDescendants = true;
      if (style.zIndex || el.getAttribute("data-z-index")) properties.ZIndex = Math.round(finite(style.zIndex || el.getAttribute("data-z-index"), `${id}.zIndex`, -10000, 10000));
      if (style.transform) {
        const match = /rotate\(\s*(-?[\d.]+)deg\s*\)/i.exec(style.transform);
        if (match) properties.Rotation = Number(match[1]);
      }
      if (/^Text/.test(className)) {
        const text = tag === "input" || tag === "textarea" ? String(el.getAttribute("placeholder") || el.getAttribute("value") || "") : directText(el);
        properties.Text = text || String(el.getAttribute("aria-label") || "");
        properties.TextSize = finite(parseFloat(style.fontSize) || (/^h1$/.test(tag) ? 36 : /^h[2-3]$/.test(tag) ? 28 : 16), `${id}.fontSize`, 1, 200);
        properties.Font = { type: "Enum", value: Number(style.fontWeight) >= 700 || /bold/i.test(style.fontWeight) ? "Enum.Font.GothamBold" : Number(style.fontWeight) >= 500 ? "Enum.Font.GothamMedium" : "Enum.Font.Gotham" };
        properties.TextWrapped = style.whiteSpace !== "nowrap";
        properties.TextXAlignment = { type: "Enum", value: style.textAlign === "center" ? "Enum.TextXAlignment.Center" : style.textAlign === "right" ? "Enum.TextXAlignment.Right" : "Enum.TextXAlignment.Left" };
        const color = cssColor(style.color || el.getAttribute("data-color"));
        if (color) { properties.TextColor3 = color.color; properties.TextTransparency = 1 - color.alpha; }
        if (className === "TextButton") properties.AutoButtonColor = false;
        if (className === "TextBox") properties.ClearTextOnFocus = false;
      }
      if (className === "ImageLabel") {
        properties.Image = String(el.getAttribute("src") || "");
        properties.ScaleType = { type: "Enum", value: "Enum.ScaleType.Fit" };
      }
      nodes.push({ id, class: className, name, parent: parentId, properties });
      const radius = parseFloat(style.borderRadius);
      if (Number.isFinite(radius) && radius > 0) nodes.push({ id: `${id}_corner`, class: "UICorner", name: "Corner", parent: id, properties: { CornerRadius: { type: "UDim", scale: 0, offset: radius } } });
      const borderWidth = parseFloat(style.borderWidth);
      const borderColor = cssColor(style.borderColor);
      if (Number.isFinite(borderWidth) && borderWidth > 0 && borderColor) nodes.push({ id: `${id}_stroke`, class: "UIStroke", name: "Stroke", parent: id, properties: { Thickness: borderWidth, Color: borderColor.color, Transparency: 1 - borderColor.alpha } });
      const paddingText = style.padding || "";
      if (paddingText) {
        const values = paddingText.split(/\s+/).map((v) => parseFloat(v)).filter(Number.isFinite);
        const top = values[0] || 0, right = values[1] == null ? top : values[1], bottom = values[2] == null ? top : values[2], left = values[3] == null ? right : values[3];
        nodes.push({ id: `${id}_padding`, class: "UIPadding", name: "Padding", parent: id, properties: {
          PaddingTop: { type: "UDim", scale: 0, offset: top }, PaddingRight: { type: "UDim", scale: 0, offset: right },
          PaddingBottom: { type: "UDim", scale: 0, offset: bottom }, PaddingLeft: { type: "UDim", scale: 0, offset: left },
        } });
      }
      if (style.display === "flex") {
        const horizontal = style.flexDirection === "row" || style.flexDirection === "row-reverse";
        const horizontalSource = horizontal ? style.justifyContent : style.alignItems;
        const verticalSource = horizontal ? style.alignItems : style.justifyContent;
        nodes.push({ id: `${id}_layout`, class: "UIListLayout", name: "Layout", parent: id, properties: {
          FillDirection: { type: "Enum", value: horizontal ? "Enum.FillDirection.Horizontal" : "Enum.FillDirection.Vertical" },
          HorizontalAlignment: { type: "Enum", value: horizontalSource === "center" ? "Enum.HorizontalAlignment.Center" : horizontalSource === "flex-end" ? "Enum.HorizontalAlignment.Right" : "Enum.HorizontalAlignment.Left" },
          VerticalAlignment: { type: "Enum", value: verticalSource === "center" ? "Enum.VerticalAlignment.Center" : verticalSource === "flex-end" ? "Enum.VerticalAlignment.Bottom" : "Enum.VerticalAlignment.Top" },
          SortOrder: { type: "Enum", value: "Enum.SortOrder.LayoutOrder" },
          Padding: { type: "UDim", scale: 0, offset: parseFloat(style.gap) || 0 },
        } });
      } else if (style.display === "grid") {
        const repeated = /repeat\(\s*(\d+)/i.exec(style.gridTemplateColumns || "");
        const columns = Math.max(1, Number(el.getAttribute("data-columns")) || (repeated ? Number(repeated[1]) : 0) || (style.gridTemplateColumns.match(/(?:\d+(?:\.\d+)?fr|\S+)/g) || []).length || 2);
        const gap = parseFloat(style.gap) || 0;
        nodes.push({ id: `${id}_grid`, class: "UIGridLayout", name: "Grid", parent: id, properties: {
          CellSize: { type: "UDim2", xScale: 1 / columns, xOffset: -gap * (columns - 1) / columns, yScale: 0, yOffset: Number(el.getAttribute("data-cell-height")) || 100 },
          CellPadding: { type: "UDim2", xScale: 0, xOffset: gap, yScale: 0, yOffset: gap },
          SortOrder: { type: "Enum", value: "Enum.SortOrder.LayoutOrder" },
        } });
      }
      for (const child of el.children) visit(child, id);
    };
    for (const child of doc.body.children) visit(child, nodes[0].id);
    return nodes;
  }

  function normalizeRequest(args) {
    if (!ownObject(args)) throw new Error("params must be an object");
    const rawChars = JSON.stringify(args).length;
    if (rawChars > MAX_REQUEST_CHARS) throw new Error(`request is ${rawChars} characters; split it into bounded passes below ${MAX_REQUEST_CHARS}`);
    exactKeys(args, new Set(["action_id", "build_id", "mode", "operation", "target_parent", "root_name", "root_id", "nodes", "delete_ids", "html", "viewport"]), "params");
    const actionId = cleanString(args.action_id, "action_id", 96);
    const buildId = cleanString(args.build_id, "build_id", 96);
    if (!IDENT_RE.test(actionId) || !IDENT_RE.test(buildId)) throw new Error("action_id and build_id must start alphanumeric and contain only letters, digits, dot, underscore, colon, or hyphen");
    const mode = args.mode;
    const operation = args.operation;
    if (mode !== "ui" && mode !== "model") throw new Error("mode must be ui or model");
    if (operation !== "replace" && operation !== "patch") throw new Error("operation must be replace or patch");
    const targetParent = cleanString(args.target_parent, "target_parent", 300);
    if (!PATH_RE.test(targetParent) || !samePrefix(targetParent, TARGET_PREFIXES[mode])) throw new Error(`target_parent is not an allowed ${mode} game path`);
    const rootName = cleanString(args.root_name, "root_name", 100);
    if (!NAME_RE.test(rootName)) throw new Error("root_name cannot contain dots or control characters");
    const rootId = args.root_id == null ? "root" : cleanString(args.root_id, "root_id", 64);
    if (!NODE_ID_RE.test(rootId)) throw new Error("root_id is invalid");
    let rawNodes = args.html != null ? safeHtmlBlueprint({ ...args, mode, operation, root_name: rootName, root_id: rootId }) : args.nodes;
    if (!Array.isArray(rawNodes) || !rawNodes.length || rawNodes.length > MAX_NODES) throw new Error(`nodes must contain 1-${MAX_NODES} records`);
    if (args.html != null && args.nodes != null) throw new Error("use either html or nodes, not both");
    const classes = mode === "ui" ? UI_CLASSES : MODEL_CLASSES;
    const refs = new Set();
    const ids = new Set();
    const nodes = rawNodes.map((raw, index) => {
      if (!ownObject(raw)) throw new Error(`nodes[${index}] must be an object`);
      exactKeys(raw, new Set(["id", "create", "class", "name", "parent", "properties", "attributes"]), `nodes[${index}]`);
      const id = cleanString(raw.id, `nodes[${index}].id`, 64);
      if (!NODE_ID_RE.test(id) || ids.has(id)) throw new Error(`nodes[${index}].id '${id}' is invalid or duplicated`);
      ids.add(id);
      const create = operation === "replace" ? true : raw.create === true;
      if (operation === "replace" && raw.create != null && raw.create !== true) throw new Error(`nodes[${index}].create cannot be false during replace`);
      let className = raw.class == null ? "" : cleanString(raw.class, `nodes[${index}].class`, 64);
      if (create && (!className || !classes.has(className))) throw new Error(`nodes[${index}].class '${className || "missing"}' is not allowed in ${mode} mode`);
      if (!create && className) throw new Error(`nodes[${index}] updates an existing id and must omit class`);
      let parent = raw.parent == null ? "" : cleanString(raw.parent, `nodes[${index}].parent`, 64);
      if (parent && !NODE_ID_RE.test(parent)) throw new Error(`nodes[${index}].parent is invalid`);
      if (operation === "patch" && create && !parent) throw new Error(`nodes[${index}] is a patch create and requires parent`);
      if (operation === "patch" && !create && parent) throw new Error(`nodes[${index}] updates an existing id and cannot move it; omit parent`);
      const name = raw.name == null ? "" : cleanString(raw.name, `nodes[${index}].name`, 100);
      if (name && !NAME_RE.test(name)) throw new Error(`nodes[${index}].name cannot contain dots or control characters`);
      const properties = normalizeMap(raw.properties, `nodes[${index}].properties`, refs, className, false);
      const attributes = normalizeMap(raw.attributes, `nodes[${index}].attributes`, refs, className, true);
      return { id, create, class: className, name, parent, properties, attributes };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let ordered = nodes;
    if (operation === "replace") {
      const roots = nodes.filter((node) => !node.parent);
      if (roots.length !== 1 || roots[0].id !== rootId) throw new Error(`replace requires exactly one parentless node whose id is root_id '${rootId}'`);
      if (!ROOT_CLASSES[mode].has(roots[0].class)) throw new Error(`${mode} root class must be one of: ${[...ROOT_CLASSES[mode]].join(", ")}`);
      if (roots[0].name && roots[0].name !== rootName) throw new Error("the replace root node name must match root_name");
      roots[0].name = rootName;
      for (const node of nodes) if (node.parent && !byId.has(node.parent)) throw new Error(`node '${node.id}' references missing parent '${node.parent}'`);
      const visiting = new Set(), done = new Set(), depth = new Map();
      const walk = (id) => {
        if (visiting.has(id)) throw new Error(`hierarchy contains a parent cycle at '${id}'`);
        if (done.has(id)) return depth.get(id);
        visiting.add(id);
        const node = byId.get(id);
        const d = node.parent ? walk(node.parent) + 1 : 0;
        if (d > MAX_DEPTH) throw new Error(`hierarchy depth exceeds ${MAX_DEPTH} at '${id}'`);
        visiting.delete(id); done.add(id); depth.set(id, d); return d;
      };
      for (const node of nodes) walk(node.id);
      ordered = [...nodes].sort((a, b) => depth.get(a.id) - depth.get(b.id) || a.id.localeCompare(b.id));
    } else {
      if (args.html != null) throw new Error("html cannot be used for patch");
      const creates = new Set(nodes.filter((node) => node.create).map((node) => node.id));
      const visiting = new Set(), done = new Set(), depth = new Map();
      const walk = (id) => {
        if (visiting.has(id)) throw new Error(`patch creates contain a parent cycle at '${id}'`);
        if (done.has(id)) return depth.get(id);
        visiting.add(id);
        const node = byId.get(id);
        const d = node && node.create && creates.has(node.parent) ? walk(node.parent) + 1 : 0;
        if (d > MAX_DEPTH) throw new Error(`patch create depth exceeds ${MAX_DEPTH} at '${id}'`);
        visiting.delete(id); done.add(id); depth.set(id, d); return d;
      };
      for (const id of creates) walk(id);
      ordered = [...nodes].sort((a, b) => (a.create === b.create ? (depth.get(a.id) || 0) - (depth.get(b.id) || 0) || a.id.localeCompare(b.id) : a.create ? 1 : -1));
    }
    for (const ref of refs) {
      if (operation === "replace" && !byId.has(ref)) throw new Error(`typed Ref '${ref}' does not exist in the replacement hierarchy`);
    }
    const rawDeletes = args.delete_ids == null ? [] : args.delete_ids;
    if (!Array.isArray(rawDeletes) || rawDeletes.length > MAX_NODES) throw new Error(`delete_ids must be an array with at most ${MAX_NODES} ids`);
    const deleteIds = [];
    const deleteSet = new Set();
    for (let index = 0; index < rawDeletes.length; index++) {
      const id = cleanString(rawDeletes[index], `delete_ids[${index}]`, 64);
      if (!NODE_ID_RE.test(id) || deleteSet.has(id)) throw new Error(`delete_ids[${index}] is invalid or duplicated`);
      if (id === rootId) throw new Error("delete_ids cannot delete the owned root; use a new confirmed replace request instead");
      if (byId.has(id)) throw new Error(`node '${id}' cannot be updated/created and deleted in the same batch`);
      deleteSet.add(id); deleteIds.push(id);
    }
    if (operation === "replace" && deleteIds.length) throw new Error("delete_ids is patch-only");
    return {
      version: FORMAT_VERSION, action_id: actionId, build_id: buildId, mode, operation,
      target_parent: targetParent, root_name: rootName, root_id: rootId,
      nodes: ordered, delete_ids: deleteIds,
    };
  }

  function longBracket(text) {
    for (let equals = 0; equals < 12; equals++) {
      const pad = "=".repeat(equals), close = `]${pad}]`;
      if (!text.includes(close)) return `[${pad}[${text}]${pad}]`;
    }
    throw new Error("request contains an unsupported long-bracket delimiter sequence");
  }

  function luauProgram(request) {
    const json = JSON.stringify(request);
    return `local HttpService = game:GetService("HttpService")
local request = HttpService:JSONDecode(${longBracket(json)})
local BUILD_ATTR = "elioBuildId"
local NODE_ATTR = "elioNodeId"
local ACTION_ATTR = "elioActionId"
local LEDGER_ATTR = "elioActionLedger"
local function respond(value) return HttpService:JSONEncode(value) end
local function resolvePath(path)
  local current = game
  local first = true
  for segment in string.gmatch(path, "[^.]+") do
    if first then
      if segment ~= "game" then return nil, "path must begin with game" end
      first = false
    else
      local nextValue = nil
      if current == game then
        local ok, service = pcall(function() return game:GetService(segment) end)
        if ok then nextValue = service end
      end
      if not nextValue then nextValue = current:FindFirstChild(segment) end
      if not nextValue then return nil, "missing path segment " .. segment end
      current = nextValue
    end
  end
  return current
end
local function oneNamed(parent, name)
  local found = nil
  for _, child in ipairs(parent:GetChildren()) do
    if child.Name == name then
      if found then return nil, "multiple children named " .. name end
      found = child
    end
  end
  return found, nil
end
local function collectOwned(root)
  local refs = {}
  for _, object in ipairs(root:GetDescendants()) do
    local id = object:GetAttribute(NODE_ATTR)
    if type(id) == "string" and id ~= "" then
      if refs[id] then return nil, "duplicate owned node id " .. id end
      refs[id] = object
    end
  end
  local rootId = root:GetAttribute(NODE_ATTR)
  if type(rootId) == "string" and rootId ~= "" then
    if refs[rootId] and refs[rootId] ~= root then return nil, "duplicate root node id " .. rootId end
    refs[rootId] = root
  end
  return refs
end
local function decodeValue(raw, refs)
  if type(raw) ~= "table" or type(raw.type) ~= "string" then return raw end
  local kind = raw.type
  if kind == "Nil" then return nil end
  if kind == "Color3" then return Color3.new(raw.r, raw.g, raw.b) end
  if kind == "Vector2" then return Vector2.new(raw.x, raw.y) end
  if kind == "Vector3" then return Vector3.new(raw.x, raw.y, raw.z) end
  if kind == "UDim" then return UDim.new(raw.scale, raw.offset) end
  if kind == "UDim2" then return UDim2.new(raw.xs, raw.xo, raw.ys, raw.yo) end
  if kind == "CFrame" then return CFrame.new(raw.x, raw.y, raw.z) * CFrame.fromOrientation(math.rad(raw.rx), math.rad(raw.ry), math.rad(raw.rz)) end
  if kind == "Enum" then
    local enumType, enumItem = string.match(raw.value, "^([A-Za-z][A-Za-z0-9]*)%.([A-Za-z][A-Za-z0-9]*)$")
    if not enumType or not Enum[enumType] or not Enum[enumType][enumItem] then error("invalid enum " .. tostring(raw.value)) end
    return Enum[enumType][enumItem]
  end
  if kind == "Ref" then
    local target = refs[raw.id]
    if not target then error("missing Ref " .. tostring(raw.id)) end
    return target
  end
  if kind == "Rect" then return Rect.new(raw.minX, raw.minY, raw.maxX, raw.maxY) end
  if kind == "NumberRange" then return NumberRange.new(raw.min, raw.max) end
  if kind == "BrickColor" then return BrickColor.new(raw.name) end
  if kind == "NumberSequence" then
    local points = {}
    for _, point in ipairs(raw.keypoints) do table.insert(points, NumberSequenceKeypoint.new(point.time, point.value, point.envelope)) end
    return NumberSequence.new(points)
  end
  if kind == "ColorSequence" then
    local points = {}
    for _, point in ipairs(raw.keypoints) do table.insert(points, ColorSequenceKeypoint.new(point.time, decodeValue(point.color, refs))) end
    return ColorSequence.new(points)
  end
  error("unsupported typed value " .. tostring(kind))
end
local function applyProperties(object, values, refs)
  for property, raw in pairs(values or {}) do object[property] = decodeValue(raw, refs) end
end
local function applyAttributes(object, values, refs)
  for attribute, raw in pairs(values or {}) do object:SetAttribute(attribute, decodeValue(raw, refs)) end
end
local function actionLedger(root)
  local raw = root and root:GetAttribute(LEDGER_ATTR)
  if type(raw) ~= "string" or raw == "" then return {} end
  local ok, decoded = pcall(function() return HttpService:JSONDecode(raw) end)
  if not ok or type(decoded) ~= "table" then return {} end
  local out = {}
  for _, value in ipairs(decoded) do if type(value) == "string" then table.insert(out, value) end end
  return out
end
local function hasAction(root, actionId)
  if not root then return false end
  if root:GetAttribute(ACTION_ATTR) == actionId then return true end
  for _, value in ipairs(actionLedger(root)) do if value == actionId then return true end end
  return false
end
local function recordAction(root, actionId, inherited)
  local ledger = inherited or actionLedger(root)
  local nextLedger = {}
  for _, value in ipairs(ledger) do if value ~= actionId then table.insert(nextLedger, value) end end
  table.insert(nextLedger, actionId)
  while #nextLedger > 32 do table.remove(nextLedger, 1) end
  root:SetAttribute(ACTION_ATTR, actionId)
  root:SetAttribute(LEDGER_ATTR, HttpService:JSONEncode(nextLedger))
end
local targetParent, pathError = resolvePath(request.target_parent)
if not targetParent then return respond({ok=false, kind="PATH", error=pathError, published=false}) end
local existing, nameError = oneNamed(targetParent, request.root_name)
if nameError then return respond({ok=false, kind="AMBIGUOUS_ROOT", error=nameError, published=false}) end
if existing and existing:GetAttribute(BUILD_ATTR) ~= request.build_id then
  return respond({ok=false, kind="OWNERSHIP", error="same-name root exists but is not owned by this build_id", published=false})
end
if hasAction(existing, request.action_id) then
  return respond({ok=true, duplicate=true, operation=request.operation, action_id=request.action_id, build_id=request.build_id, root_path=request.target_parent .. "." .. request.root_name, published=false})
end
if request.operation == "replace" then
  local objects = {}
  local stagedRoot = nil
  local ok, result = xpcall(function()
    for _, node in ipairs(request.nodes) do
      local object = Instance.new(node.class)
      object.Name = node.name ~= "" and node.name or node.id
      object:SetAttribute(BUILD_ATTR, request.build_id)
      object:SetAttribute(NODE_ATTR, node.id)
      objects[node.id] = object
    end
    stagedRoot = objects[request.root_id]
    for _, node in ipairs(request.nodes) do
      applyProperties(objects[node.id], node.properties, objects)
      applyAttributes(objects[node.id], node.attributes, objects)
    end
    for _, node in ipairs(request.nodes) do
      if node.parent ~= "" then objects[node.id].Parent = objects[node.parent] end
    end
    recordAction(stagedRoot, request.action_id, existing and actionLedger(existing) or {})
    stagedRoot.Parent = targetParent
    if existing then
      local removed, removeError = pcall(function() existing:Destroy() end)
      if not removed then
        stagedRoot.Parent = nil
        error("could not retire previous owned root: " .. tostring(removeError))
      end
    end
    return {ok=true, duplicate=false, operation="replace", action_id=request.action_id, build_id=request.build_id, nodes_created=#request.nodes, nodes_updated=0, nodes_deleted=existing and 1 or 0, runtime_property_probe=true, ownership_verified=true, hierarchy_verified=true, root_path=request.target_parent .. "." .. request.root_name, published=false}
  end, debug.traceback)
  if not ok then
    if stagedRoot then pcall(function() stagedRoot:Destroy() end) end
    for _, object in pairs(objects) do if object.Parent == nil then pcall(function() object:Destroy() end) end end
    return respond({ok=false, kind="APPLY", error=tostring(result), rolled_back=true, published=false})
  end
  return respond(result)
end
if not existing then return respond({ok=false, kind="MISSING_ROOT", error="patch requires the existing owned root", published=false}) end
local refs, collectError = collectOwned(existing)
if not refs then return respond({ok=false, kind="OWNERSHIP", error=collectError, published=false}) end
if refs[request.root_id] ~= existing then return respond({ok=false, kind="OWNERSHIP", error="root_id does not identify the owned root", published=false}) end
local created = {}
local rollbacks = {}
local function rollback()
  for index = #rollbacks, 1, -1 do pcall(rollbacks[index]) end
  for _, object in pairs(created) do pcall(function() object:Destroy() end) end
end
local ok, result = xpcall(function()
  for _, node in ipairs(request.nodes) do
    if node.create then
      if refs[node.id] then error("patch create id already exists: " .. node.id) end
      local object = Instance.new(node.class)
      object.Name = node.name ~= "" and node.name or node.id
      object:SetAttribute(BUILD_ATTR, request.build_id)
      object:SetAttribute(NODE_ATTR, node.id)
      created[node.id] = object
      refs[node.id] = object
    else
      if not refs[node.id] then error("patch update id does not exist: " .. node.id) end
    end
  end
  for _, node in ipairs(request.nodes) do
    local object = refs[node.id]
    if node.create then
      applyProperties(object, node.properties, refs)
      applyAttributes(object, node.attributes, refs)
    else
      local probe = Instance.new(object.ClassName)
      local probeOk, probeError = pcall(function()
        applyProperties(probe, node.properties, refs)
        applyAttributes(probe, node.attributes, refs)
      end)
      probe:Destroy()
      if not probeOk then error("property dry-run failed for " .. node.id .. ": " .. tostring(probeError)) end
    end
  end
  for _, id in ipairs(request.delete_ids) do
    if not refs[id] then error("delete id does not exist: " .. id) end
    if refs[id] == existing then error("owned root cannot be deleted by patch") end
  end
  for _, node in ipairs(request.nodes) do
    if not node.create then
      local object = refs[node.id]
      if node.name ~= "" and node.name ~= object.Name then
        local oldName = object.Name
        table.insert(rollbacks, function() object.Name = oldName end)
        object.Name = node.name
      end
      for property, raw in pairs(node.properties or {}) do
        local oldValue = object[property]
        table.insert(rollbacks, function() object[property] = oldValue end)
        object[property] = decodeValue(raw, refs)
      end
      for attribute, raw in pairs(node.attributes or {}) do
        local oldValue = object:GetAttribute(attribute)
        table.insert(rollbacks, function() object:SetAttribute(attribute, oldValue) end)
        object:SetAttribute(attribute, decodeValue(raw, refs))
      end
    end
  end
  for _, node in ipairs(request.nodes) do
    if node.create then
      local parent = refs[node.parent]
      if not parent then error("patch create parent does not exist: " .. node.parent) end
      created[node.id].Parent = parent
    end
  end
  local pendingDeletes = {}
  for _, id in ipairs(request.delete_ids) do
    local object = refs[id]
    local oldParent = object.Parent
    table.insert(rollbacks, function() object.Parent = oldParent end)
    object.Parent = nil
    table.insert(pendingDeletes, object)
  end
  recordAction(existing, request.action_id)
  for _, object in ipairs(pendingDeletes) do object:Destroy() end
  local createdCount, updatedCount = 0, 0
  for _, node in ipairs(request.nodes) do if node.create then createdCount += 1 else updatedCount += 1 end end
  return {ok=true, duplicate=false, operation="patch", action_id=request.action_id, build_id=request.build_id, nodes_created=createdCount, nodes_updated=updatedCount, nodes_deleted=#request.delete_ids, runtime_property_probe=true, ownership_verified=true, hierarchy_verified=true, root_path=request.target_parent .. "." .. request.root_name, published=false}
end, debug.traceback)
if not ok then rollback(); return respond({ok=false, kind="APPLY", error=tostring(result), rolled_back=true, published=false}) end
return respond(result)`;
  }

  function compile(args) {
    try {
      const request = normalizeRequest(args);
      const code = luauProgram(request);
      return {
        ok: true,
        request,
        code,
        verification: {
          request_chars: JSON.stringify(request).length,
          luau_chars: code.length,
          nodes: request.nodes.length,
          hierarchy: "acyclic and depth-bounded",
          values: "typed and finite",
          ownership: "stable build/root/node ids",
          transaction: request.operation === "replace" ? "nil-parent stage then owned-root swap" : "property probe plus rollback ledger",
          visible_ui: false,
          web_pairing: false,
        },
      };
    } catch (caught) {
      return error(caught && caught.message || caught);
    }
  }

  function formatResult(payload, compiled) {
    if (!payload) return "";
    if (payload.ok === false) {
      const rollback = payload.rolled_back ? " The staged mutation was rolled back." : " No unverified replacement is reported.";
      return `ERROR applying 'headless_build' (${payload.kind || "BUILD"}): ${String(payload.error || "headless build failed").replace(/\s+/g, " ").slice(0, 1200)}.${rollback}`;
    }
    const duplicate = payload.duplicate ? "Exactly-once replay detected; no second mutation ran." :
      `Created ${Number(payload.nodes_created) || 0}, updated ${Number(payload.nodes_updated) || 0}, deleted ${Number(payload.nodes_deleted) || 0}.`;
    const verify = compiled && compiled.verification || {};
    return `Output of 'headless_build':\n${duplicate}\nRoot: ${payload.root_path}\nBackend Structural Analysis: ${verify.nodes || 0} nodes; ${verify.hierarchy || "validated hierarchy"}; ${verify.values || "validated values"}.\nJSON Tool Execution Block: ${payload.operation} applied under stable build_id ${payload.build_id}; published=false.\nVerification Loop Log: ownership=${payload.ownership_verified !== false ? "verified" : "unknown"}; runtime_property_probe=${payload.runtime_property_probe !== false ? "passed" : "not-needed"}; transaction=${verify.transaction || "verified"}; visible_browser=false; figma_or_meshy=false.`;
  }

  return Object.freeze({
    FORMAT_VERSION, MAX_REQUEST_CHARS, MAX_NODES, MAX_DEPTH,
    TOOL, compile, formatResult,
  });
})();
