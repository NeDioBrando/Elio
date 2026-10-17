// Smoke tests for the virtual animation command builder and embedded Luau API.
const fs = require("fs");
const vm = require("vm");

vm.runInThisContext(fs.readFileSync("core/animlib.js", "utf8"), { filename: "core/animlib.js" });

let failed = 0;
function ok(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed++;
}

const required = {
  select_rig: { path: "Workspace.R15" },
  clear_rig_selection: {},
  create: { name: "wave", duration: 1 },
  open: { name: "wave" },
  import: { path: "Workspace.Rig.Wave" },
  set_length: { duration: 1 },
  set_settings: { loop: true, priority: "Action" },
  set_pose: { t: 0, poses: [{ bone: "LeftUpperArm", rot: [0, 0, 30] }] },
  add_keyframe: { t: 0.5 },
  update_keyframe: { t: 0.5, poses: [{ bone: "LeftUpperArm", rot: [0, 0, 30] }] },
  delete_keyframe: { t: 0.5 },
  move_keyframe: { from_t: 0, to_t: 0.5 },
  clone_keyframe: { from_t: 0, to_t: 0.5 },
  set_easing: { t: 0, style: "CubicV2", direction: "Out" },
  set_marker: { t: 0.5, name: "Footstep", value: "left" },
  delete_marker: { t: 0.5, name: "Footstep" },
  preview: { duration: 1 },
  simulate: { t: 0, all: true },
  map_axes: { angle: 30, filter: ["LeftUpperLeg", "RightUpperLeg"] },
  test: {},
  stop_preview: {},
  close: {},
  apply: { t: 0 },
  rebuild: {},
  inspect: {},
  list: {},
  reset: {},
};

for (const op of RSAnim.ANIM_OPS) {
  const built = RSAnim.buildLuau(op, required[op]);
  ok(`${op} builds Luau`, !!built.code && !built.err);
}

const lua = RSAnim.ANIM_LIB_LUA;
ok("advertised import is dispatched", /import\s*=\s*api\.import/.test(lua));
ok("advertised rebuild is dispatched", /rebuild\s*=\s*api\.rebuild/.test(lua));
ok("stop preview is dispatched", /stop_preview\s*=\s*api\.resets/.test(lua));
ok("close session is dispatched", /close\s*=\s*api\.resets/.test(lua));
ok("numeric simulation is dispatched", /simulate\s*=\s*api\.simulate/.test(lua));
ok("axis mapping is dispatched", /map_axes\s*=\s*api\.map_axes/.test(lua));
ok("pose edits upsert a keyframe", /set_pose\s*=\s*function\(a\) return api\.keyframe\(a, true\)/.test(lua));
ok("constraint posing uses the stored child part", /b\.part1\.CFrame = map\[b\.index\]/.test(lua));
ok("Motor6D preview writes joint transforms", /b\.kind == "Motor6D" or b\.kind == "AnimationConstraint"/.test(lua));
ok("preview state persists across commands", /PreviewToken/.test(lua) && !/local LOOP_RUNNING/.test(lua));
ok("native animation settings are dispatched", /set_settings\s*=\s*api\.set_settings/.test(lua));
ok("keyframe cloning is dispatched", /clone_keyframe\s*=\s*api\.clone_keyframe/.test(lua));
ok("keyframe markers are dispatched", /set_marker\s*=\s*api\.set_marker/.test(lua) && /delete_marker\s*=\s*api\.delete_marker/.test(lua));
ok("native pose easing is dispatched", /set_easing\s*=\s*api\.set_easing/.test(lua));
ok("explicit rig choice is dispatched", /select_rig\s*=\s*api\.select_rig/.test(lua));
ok("invalid numeric pose values are rejected", !!RSAnim.buildLuau("set_pose", { t: 0, poses: [{ bone: "LeftUpperArm", rot: [0, "x", 0] }] }).err);

process.exitCode = failed ? 1 : 0;