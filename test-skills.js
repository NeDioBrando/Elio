// Smoke tests for RobloxScript Studio Skills & Virtual Tool Suite.
const fs = require("fs");
const vm = require("vm");

vm.runInThisContext(fs.readFileSync("core/studio_skills.js", "utf8"), { filename: "core/studio_skills.js" });
vm.runInThisContext(fs.readFileSync("core/studio_daily.js", "utf8"), { filename: "core/studio_daily.js" });
vm.runInThisContext(fs.readFileSync("core/studio_gui.js", "utf8"), { filename: "core/studio_gui.js" });
vm.runInThisContext(fs.readFileSync("core/studio_plus.js", "utf8"), { filename: "core/studio_plus.js" });
vm.runInThisContext(fs.readFileSync("core/agent_skills.js", "utf8"), { filename: "core/agent_skills.js" });

let failed = 0;
function ok(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed++;
}

const sampleArgs = {
  lighting_set_preset: { preset: "cyberpunk", clock_time: 20 },
  lighting_inspect: {},
  lighting_setup_day_night: { cycle_duration_seconds: 300, start_time: 8 },
  ui_create_screen: { name: "HUD", reset_on_spawn: false },
  ui_create_component: { screen_name: "HUD", component_type: "card_inventory", card_count: 8, title: "Inventory" },
  ui_inspect: { screen_name: "HUD" },
  fx_create_emitter: { parent_path: "Workspace.Torch.Part", preset: "fire", rate: 30 },
  fx_create_light: { parent_path: "Workspace.Lamp", light_type: "PointLight", brightness: 2.5, color: "warm_candle" },
  fx_create_vfx: { parent_path: "Workspace.Part", effect: "fire_aura", scale: 1 },
  fx_create_beam: { parent_path: "Workspace.Part", target_path: "Workspace.Target", width0: 0.6 },
  fx_create_trail: { parent_path: "Workspace.Sword.Blade" },
  fx_create_explosion: { parent_path: "Workspace", blast_radius: 12, blast_pressure: 8000 },
  audio_setup_sound_hierarchy: {},
  audio_create_sound: { parent_path: "Workspace", sound_id: "9114223120", volume: 0.8 },
  terrain_fill_region: { material: "Grass", cframe: [0, 10, 0], size: [32, 16, 32], shape: "block" },
  terrain_clear: { cframe: [0, 10, 0], size: [32, 16, 32] },
  camera_set_style: { style: "isometric", distance: 35, fov: 65 },
  diagnostics_audit: {},
  diagnostics_fix_common: { anchor_static_parts: true, enable_streaming: true, set_future_lighting: true },
  datastore_setup: { store_name: "PlayerData", currency_name: "Coins", autosave_interval: 60 },
  leaderboard_setup: { store_name: "GlobalLeaderboard", title: "Top Players", board_path: "Workspace.Leaderboard" },
  remote_setup: { namespace: "GameEvents", events: ["OnDamage","OnReward"] },
  npc_spawn_pathfinding: { rig_name: "NPC_Dummy", cframe: [0,10,0], target: [40,10,40], speed: 12, behavior: "loop" },
  proximity_setup: { target_path: "Workspace.Chest", action_text: "Open", hold_duration: 0, reward_coins: 10 },
  tween_create: { target_path: "Workspace.Part", property: "Transparency", to: "0.5", duration: 1, easing: "Sine" },
  marketplace_setup: { gamepass_id: 12345, reward: "Coins +100" },
  teams_setup: { teams: ["Red","Blue"], auto_assign: true },
  asset_bridge_import: { asset: "rbxassetid://123", source: "roblox", target_engine: "unreal", dest: "/Game/Imported" },
  web_fetch: { url: "https://example.com" },
  web_search: { query: "Roblox Studio" },
  plugin_list: {},
  plugin_inspect: { path: "PluginGuiService.ORWidget" },
  plugin_create: { name: "ORPlugin", title: "elio" },
  ui_set_image: { path: "StarterGui.HUD.Icon", image: "rbxassetid://123" },
  ui_set_texture: { path: "StarterGui.HUD", texture: "rbxassetid://123" },
  ui_set_text: { path: "StarterGui.HUD.Title", text: "Hello" },
  ui_set_color: { path: "StarterGui.HUD.Panel", background: [20, 20, 24] },
  ui_set_size: { path: "StarterGui.HUD.Panel", size: [0, 200, 0, 80] },
  ui_set_position: { path: "StarterGui.HUD.Panel", position: [0, 20, 0, 20] },
  ui_set_font: { path: "StarterGui.HUD", font: "Gotham" },
  ui_set_corner: { path: "StarterGui.HUD.Panel", radius: 8 },
  ui_set_stroke: { path: "StarterGui.HUD.Panel", color: [255, 255, 255], thickness: 1 },
  ui_set_gradient: { path: "StarterGui.HUD.Panel", color0: [20, 20, 24], color1: [40, 40, 50] },
  ui_set_padding: { path: "StarterGui.HUD.Panel", pixels: 8 },
  ui_set_layout: { path: "StarterGui.HUD.List", layout: "list" },
  ui_set_visible: { path: "StarterGui.HUD.Panel", visible: true },
  ui_set_property: { path: "StarterGui.HUD.Icon", property: "Image", value: "rbxassetid://1" },
  ui_paint: { path: "StarterGui.HUD", background: [18, 18, 22], image: "rbxassetid://1" },
  ui_add_element: { parent: "StarterGui.HUD", class_name: "ImageLabel", name: "Icon", image: "rbxassetid://1" },
  ui_set_scale: { path: "StarterGui.HUD", scale: 1 },
  ui_list_tree: { path: "StarterGui" },
  ui_apply_theme: { path: "StarterGui.HUD", theme: "dark" },
  ui_set_slice: { path: "StarterGui.HUD.Icon", slice: [12, 12, 12, 12] },
  ui_bind_button: { path: "StarterGui.HUD.Close", action: "print" },
  decal_set: { path: "Workspace.Part", texture: "rbxassetid://1", face: "Front" },
  mesh_set_texture: { path: "Workspace.Mesh", texture: "rbxassetid://1" },
  surface_gui_create: { path: "Workspace.Part", image: "rbxassetid://1" },
  ui_build: { screen: "ELIO_HUD", title: "HUD", widgets: [{ class_name: "ImageLabel", name: "Panel", image: "panel", size: [0, 200, 0, 80] }] },
  ui_clone: { path: "StarterGui.HUD.Panel" },
  ui_clear_children: { path: "StarterGui.HUD.Panel" },
  ui_set_anchor: { path: "StarterGui.HUD.Panel", x: 0.5, y: 0.5 },
  ui_bring_to_front: { path: "StarterGui.HUD" },
  size_set: { path: "Workspace.Part", size: [4, 1, 4] },
  hinge_create: { part0: "Workspace.A", part1: "Workspace.B" },
  jump_pad: { position: [0, 1, 0], power: 60 },
  atmosphere_set: { density: 0.3 },
  get_property: { path: "Workspace.Part", property: "Name" },
  developer_product_create: { name: "Extra Life", price: 25, description: "An extra life" },
  developer_product_list: {},
};

for (const op of RobloxScriptSkills.SKILL_OPS) {
  const built = RobloxScriptSkills.buildLuau(op, sampleArgs[op] || {});
  ok(`${op} builds Luau`, !!built.code && !built.err);
}

const lua = RobloxScriptSkills.SKILLS_LIB_LUA;
ok("lighting_set_preset is dispatched", /lighting_set_preset\s*=\s*api\.lighting_set_preset/.test(lua));
ok("lighting_inspect is dispatched", /lighting_inspect\s*=\s*api\.lighting_inspect/.test(lua));
ok("ui_create_component is dispatched", /ui_create_component\s*=\s*api\.ui_create_component/.test(lua));
ok("fx_create_emitter is dispatched", /fx_create_emitter\s*=\s*api\.fx_create_emitter/.test(lua));
ok("audio_setup_sound_hierarchy is dispatched", /audio_setup_sound_hierarchy\s*=\s*api\.audio_setup_sound_hierarchy/.test(lua));
ok("terrain_fill_region is dispatched", /terrain_fill_region\s*=\s*api\.terrain_fill_region/.test(lua));
ok("camera_set_style is dispatched", /camera_set_style\s*=\s*api\.camera_set_style/.test(lua));
ok("diagnostics_audit is dispatched", /diagnostics_audit\s*=\s*api\.diagnostics_audit/.test(lua));
ok("diagnostics_fix_common is dispatched", /diagnostics_fix_common\s*=\s*api\.diagnostics_fix_common/.test(lua));
ok("datastore_setup is dispatched", /datastore_setup\s*=\s*api\.datastore_setup/.test(lua));
ok("leaderboard_setup is dispatched", /leaderboard_setup\s*=\s*api\.leaderboard_setup/.test(lua));
ok("remote_setup is dispatched", /remote_setup\s*=\s*api\.remote_setup/.test(lua));
ok("npc_spawn_pathfinding is dispatched", /npc_spawn_pathfinding\s*=\s*api\.npc_spawn_pathfinding/.test(lua));
ok("proximity_setup is dispatched", /proximity_setup\s*=\s*api\.proximity_setup/.test(lua));
ok("tween_create is dispatched", /tween_create\s*=\s*api\.tween_create/.test(lua));
ok("marketplace_setup is dispatched", /marketplace_setup\s*=\s*api\.marketplace_setup/.test(lua));
ok("teams_setup is dispatched", /teams_setup\s*=\s*api\.teams_setup/.test(lua));

ok("fx_create_vfx is dispatched", /fx_create_vfx\s*=\s*api\.fx_create_vfx/.test(lua));
ok("fx_create_beam is dispatched", /fx_create_beam\s*=\s*api\.fx_create_beam/.test(lua));
ok("fx_create_trail is dispatched", /fx_create_trail\s*=\s*api\.fx_create_trail/.test(lua));
ok("fx_create_explosion is dispatched", /fx_create_explosion\s*=\s*api\.fx_create_explosion/.test(lua));
ok("catalogue description contains skill tools", RobloxScriptSkills.describeCommands().length > 20);
ok("script_analysis is dispatched", /script_analysis\s*=\s*api\.script_analysis/.test(lua));
ok("plugin_list is dispatched", /plugin_list\s*=\s*api\.plugin_list/.test(lua));
ok("plugin_inspect is dispatched", /plugin_inspect\s*=\s*api\.plugin_inspect/.test(lua));
ok("plugin_create is dispatched", /plugin_create\s*=\s*api\.plugin_create/.test(lua));
ok("skill count is 34+", RobloxScriptSkills.SKILL_OPS.length >= 50);
ok("daily studio commands exist", RobloxScriptSkills.SKILL_OPS.includes("part_create") && RobloxScriptSkills.SKILL_OPS.includes("tool_create") && RobloxScriptSkills.SKILL_OPS.includes("selection_info"));
ok("gui mutation tools exist", RobloxScriptSkills.SKILL_OPS.includes("ui_set_image") && RobloxScriptSkills.SKILL_OPS.includes("ui_set_texture") && RobloxScriptSkills.SKILL_OPS.includes("ui_set_property") && RobloxScriptSkills.SKILL_OPS.includes("ui_paint") && RobloxScriptSkills.SKILL_OPS.includes("ui_build"));
ok("gui skill count 70+", RobloxScriptSkills.SKILL_OPS.length >= 70);
ok("agentscript extras exist", typeof AgentScriptSkills !== "undefined" && AgentScriptSkills.SKILL_OPS.length >= 20 && AgentScriptSkills.SKILL_OPS.includes("append_file") && AgentScriptSkills.SKILL_OPS.includes("replace_in_files"));
ok("agentscript describe", AgentScriptSkills.describeCommands().length > 20);
ok("daily extras rename/reparent", RobloxScriptSkills.SKILL_OPS.includes("instance_rename") && RobloxScriptSkills.SKILL_OPS.includes("instance_reparent") && RobloxScriptSkills.SKILL_OPS.includes("selection_set") && RobloxScriptSkills.SKILL_OPS.includes("script_append") && RobloxScriptSkills.SKILL_OPS.includes("camera_look_at") && RobloxScriptSkills.SKILL_OPS.includes("highlight_add"));
ok("daily extras 1.17.28", RobloxScriptSkills.SKILL_OPS.includes("script_set_source") && RobloxScriptSkills.SKILL_OPS.includes("script_list") && RobloxScriptSkills.SKILL_OPS.includes("weld_constraint") && RobloxScriptSkills.SKILL_OPS.includes("humanoid_set") && RobloxScriptSkills.SKILL_OPS.includes("instance_move") && RobloxScriptSkills.SKILL_OPS.includes("tag_remove"));
ok("gui extras clone/front", RobloxScriptSkills.SKILL_OPS.includes("ui_clone") && RobloxScriptSkills.SKILL_OPS.includes("ui_clear_children") && RobloxScriptSkills.SKILL_OPS.includes("ui_bring_to_front") && RobloxScriptSkills.SKILL_OPS.includes("ui_set_anchor"));
ok("agentscript extras 2", AgentScriptSkills.SKILL_OPS.includes("read_range") && AgentScriptSkills.SKILL_OPS.includes("replace_once") && AgentScriptSkills.SKILL_OPS.includes("env_info"));
ok("plus 40 studio commands", ["size_set","color_set","cframe_set","hinge_create","spring_create","rope_create","jump_pad","speed_pad","spawn_box","ladder_create","atmosphere_set","bloom_set","walkspeed_set","teleport_to","get_property","set_property","scale_model","ungroup_model","fire_add","remote_event_create"].every((n) => RobloxScriptSkills.SKILL_OPS.includes(n)) && RobloxScriptSkills.SKILL_OPS.length >= 140);
ok("developer_product_create skill", RobloxScriptSkills.SKILL_OPS.includes("developer_product_create") && RobloxScriptSkills.SKILL_OPS.includes("developer_product_list"));

process.exitCode = failed ? 1 : 0;
