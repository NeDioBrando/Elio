// Regression tests for deep motion/VFX discovery and fidelity-safe integration.
const fs = require("fs");
const vm = require("vm");

let failed = 0;
function ok(name, condition, detail) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `  → ${detail}`}`);
  if (!condition) failed++;
}

function load(file, symbol) {
  const src = fs.readFileSync(file, "utf8");
  const ctx = { console };
  vm.createContext(ctx);
  return { api: vm.runInContext(`${src}\n;${symbol};`, ctx, { filename: file }), src };
}

const tools = load("core/motion-tools.js", "ZSMotionTools");
const interchange = load("core/motion-interchange.js", "ZSMotionInterchange");

const scan = tools.api.compileScan({ action: "scan" });
ok("deep scan compiles", scan.ok && scan.code.includes("motion_scan v2"), scan.error);
ok("scan covers storage and live containers",
  ["ServerStorage", "ReplicatedStorage", "Workspace", "StarterPlayer", "StarterGui", "StarterPack", "ReplicatedFirst", "SoundService", "Lighting", "PluginGuiService"]
    .every(name => scan.request.scopes.some(path => path.endsWith(name))));
ok("scan groups effect roots", scan.code.includes("counts.effects") && scan.code.includes('FX[cls]then cand,kind=d,"vfx"'));
ok("scan identifies rigs and asset bundles", scan.code.includes('cand,kind=d,"rig"') && scan.code.includes('ASSET[cls]then cand,kind=d,"asset_bundle"') && scan.code.includes("counts.geometry"));
ok("scan recommends controller-safe rig handling", scan.code.includes("inspect_rig_and_existing_controller") && scan.code.includes("inspect_then_copy_exact_source"));
ok("scan fingerprints and deduplicates", scan.code.includes("fingerprint") && scan.code.includes("duplicate_of") && scan.code.includes("include_duplicates"));
ok("scan reports disabled effects and asset IDs", scan.code.includes("disabled_effects") && scan.code.includes("asset_ids"));
ok("scan identifies Moon/plugin exports", scan.code.includes("moon_animator_export") && scan.code.includes("plugin_tagged_export"));
ok("scan catches legacy and modern effects", ["ParticleEmitter", "Beam", "Trail", "Fire", "Smoke", "Sparkles", "PointLight", "SpotLight", "SurfaceLight", "Highlight", "Sound"].every(x => scan.code.includes(x)));

const spaced = tools.api.compileScan({ action: "read_vfx", path: "game.ReplicatedStorage.VFX Library.Fire Burst" });
ok("paths with spaces compile", spaced.ok, spaced.error);
ok("read_vfx is root-inclusive", spaced.code.includes("local all={root}"));
ok("read_vfx preserves detailed properties", spaced.code.includes("FlipbookLayout") && spaced.code.includes("VelocityInheritance") && spaced.code.includes("MeshId"));
const animation = tools.api.compileScan({ action: "read_animation", path: "game.ServerStorage.Moon Animator Saves.Run Cycle" });
ok("animation paths with spaces compile", animation.ok, animation.error);
ok("animation reader handles IDs, keyframes, and curves", animation.code.includes('root:IsA("Animation")') && animation.code.includes('root:IsA("CurveAnimation")') && animation.code.includes('root:IsA("KeyframeSequence")'));
ok("unsafe roots are rejected", !tools.api.compileScan({ action: "read_vfx", path: "game.CoreGui.Secret" }).ok);

const copy = interchange.api.compileCopy({
  action_id: "copy-fire-1", build_id: "fire-v1", kind: "vfx",
  source_path: "game.ReplicatedStorage.VFX Library.Fire Burst",
  target_parent: "game.ServerStorage", root_name: "FireBurst"
});
ok("exact bundle copy compiles", copy.ok, copy.error);
ok("copy verifies source and clone fingerprints", copy.code.includes("manifestHash") && copy.code.includes("sourceSignature") && copy.code.includes("cloneSignature") && copy.code.includes("verified_fidelity"));
ok("copy rejects scripted VFX", copy.code.includes("VFX export contains a script; exact copy refused"));
ok("copy remains replay-safe", copy.code.includes("synerixcodeMotionLedger") && copy.code.includes("ActionId"));

const integrate = interchange.api.compileIntegration({
  action_id: "integrate-fire-1", build_id: "motion-v1", profile: "skill",
  target_parent: "game.ServerStorage", module_name: "FireMotion",
  animation_id: "123456", vfx_path: "game.ReplicatedStorage.VFX Library.Fire Burst",
  marker_bindings: [{ marker: "Impact", effect_path: "game.ReplicatedStorage.VFX Library.Fire Burst", emit_count: 25, duration: 0.5 }]
});
const runtime = interchange.api._test.runtimeSource("{}");
ok("motion integration compiles", integrate.ok, integrate.error);
ok("runtime reuses effect instances", runtime.includes("effect_slots") && runtime.includes("slot.generation") && runtime.includes("state.effect_slots[key]"));
ok("runtime resets sounds instead of layering", runtime.includes("d:Stop() d.TimePosition=0 d:Play()"));
ok("runtime refuses scripts inside VFX source", runtime.includes('d:IsA("LuaSourceContainer")'));
ok("runtime keeps one actor state", runtime.includes('active=setmetatable({}, {__mode="k"})') && runtime.includes('cleanup(actor,"replaced")'));
ok("actor removal cleanup reason is intact", runtime.includes('cleanup(actor,"actor_removed")'));

process.exitCode = failed ? 1 : 0;
