// Quick Node smoke tests for the v1.15 features (run: node test-v115.js). Not shipped.
const fs = require("fs");
const path = require("path");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const root = __dirname;
const mainSrc = fs.readFileSync(path.join(root, "core/main.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(root, "core/config.js"), "utf8");
const skillSrc = fs.readFileSync(path.join(root, "core/studio_skills.js"), "utf8");
const dailySrc = fs.readFileSync(path.join(root, "core/studio_daily.js"), "utf8");
const opsPy = fs.readFileSync(path.join(root, "blender_ops.py"), "utf8");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "overlay.css"), "utf8");
const manJs = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manJs);

ok("manifest 1.16+", (() => { const [maj, min] = manifest.version.split(".").map(Number); return maj > 1 || min >= 16; })());
ok("glass base opacity readable", cssSrc.includes("rgba(16, 17, 25, 0.82)"));
ok("glass has @supports fallback", cssSrc.includes("@supports not") && cssSrc.includes("rgba(16, 17, 25, 0.96)"));
ok("themes removed from popup", !popupHtml.includes('id="theme-row"') && !popupHtml.includes('id="theme-night"'));
ok("themes removed from page menu", !mainSrc.includes('<span>Theme</span>'));
ok("synerixcode fixed bar styling", cssSrc.includes("synerixcode navy and gold interface") && cssSrc.includes("#rs-bar"));
ok("overlay brand is synerixcode", mainSrc.includes('const BRAND_NAME = "synerixcode"'));
ok("popup brand is synerixcode", popupHtml.includes('id="or-logo">synerixcode<') && popupJs.includes('logo.textContent = "synerixcode"'));
ok("night icon removed", !popupHtml.includes('data-glyph="☾"') && !mainSrc.includes('<span class="rs-menu-glyph">'));
ok("legacy Figma and Meshy options", popupHtml.includes('id="figma-legacy"') && popupHtml.includes('id="meshy-legacy"'));
ok("Notion provider installed", manJs.includes("providers/notion.js") && fs.existsSync(path.join(root,"providers/notion.js")));
ok("actual tool count helper", mainSrc.includes("function actualToolCount()") && mainSrc.includes("const tools = actualToolCount()"));

ok("discord invite overlay", mainSrc.includes("https://discord.gg/FmKY5bXZn") && mainSrc.includes("rs-discord"));
ok("discord invite popup", popupHtml.includes('id="discord"') && popupJs.includes("https://discord.gg/FmKY5bXZn"));
ok("copilot popup shortcut", popupHtml.includes('id="copilot"') && popupJs.includes("https://github.com/copilot"));
ok("copilot in overlay AI_SITES", mainSrc.includes("github.com/copilot"));

ok("sound effects playSfx", mainSrc.includes("function playSfx(") && mainSrc.includes('playSfx("start")') && mainSrc.includes("A._sfxErr"));
ok("sounds persist rsSounds", mainSrc.includes("rsSounds") && popupJs.includes("tgl-sounds"));
ok("popup sounds toggle", popupHtml.includes('id="tgl-sounds"'));

ok("forge rewrite lua", skillSrc.includes("Rewritten Forge language") && skillSrc.includes("forge_hud") && skillSrc.includes("FORGE  ·  PACK"));
ok("forge prompt rewrite", cfgSrc.includes("gold ember") || cfgSrc.includes("#d4a054"));
ok("forge inject on ui_create_component", mainSrc.includes("window.__rsForge") && mainSrc.includes("forge: true"));

ok("plugin_list skill", skillSrc.includes('name: "plugin_list"') && skillSrc.includes("function api.plugin_list"));
ok("plugin_create skill", skillSrc.includes('name: "plugin_create"') && skillSrc.includes("Save as Local Plugin"));
ok("plugin_inspect skill", skillSrc.includes('name: "plugin_inspect"'));
ok("plugin_create in ASK_OPS", mainSrc.includes('"plugin_create"'));
ok("plugin tools in system prompt", cfgSrc.includes("plugin_list") && cfgSrc.includes("plugin_create"));
const guiSrc = fs.readFileSync(path.join(root, "core/studio_gui.js"), "utf8");
const agentSrc = fs.readFileSync(path.join(root, "core/agent_skills.js"), "utf8");
ok("gui mutation suite", guiSrc.includes("ui_set_image") && guiSrc.includes("ui_set_texture") && guiSrc.includes("ui_set_property") && guiSrc.includes("ui_paint") && manJs.includes("studio_gui.js"));
ok("agentscript extras suite", agentSrc.includes("append_file") && agentSrc.includes("replace_in_files") && agentSrc.includes("AgentScriptSkills") && manJs.includes("agent_skills.js"));
ok("gui mutation in system prompt", cfgSrc.includes("GUI MUTATION") && cfgSrc.includes("ui_set_image"));
ok("create prompt uses texture tools", mainSrc.includes("ui_set_image") && mainSrc.includes("ui_set_texture"));
ok("use.ai provider", manJs.includes("use.ai") && manJs.includes("providers/useai.js") && mainSrc.includes("https://use.ai/chat"));
ok("oxalpha provider", manJs.includes("oxalpha.com") && manJs.includes("providers/oxalpha.js") && mainSrc.includes("https://oxalpha.com/chat"));
ok("blender camera align", fs.readFileSync(path.join(root, "blender_ops.py"), "utf8").includes("cmd_align_camera_axis") && fs.readFileSync(path.join(root, "background.js"), "utf8").includes("blender_align_camera"));
ok("ui_build daily", guiSrc.includes("ui_build") && guiSrc.includes("BUILTIN"));
ok("no leftover template backticks in lua lib", !/`plugin`/.test(skillSrc));

ok("popup keeps load-bearing IDs", ["ver","dot","state","tools","servers","hint-row","hint-engine","restart","reconnect","ollama","settings","engine-roblox","engine-local","run-hint","site-tag","engine-label"]
  .every((id) => popupHtml.includes(`id="${id}"`)));
ok("popup has 2 engine segments, no Anim/Unreal", popupHtml.includes("engine-roblox") && popupHtml.includes("engine-local") && !popupHtml.includes("engine-anim") && !popupHtml.includes("engine-unreal"));
ok("persona UI gone from overlay", !mainSrc.includes("Agent persona") && !mainSrc.includes("setPersona(") && !mainSrc.includes('id="rs-persona"'));
ok("persona gone from prompt builder", !cfgSrc.includes("PERSONA: BUILDER") && !cfgSrc.includes("buildPersonaBlock"));
ok("blender MCP connect in menu", mainSrc.includes("blender_connect") && mainSrc.includes("rs-mcp-blender") && !mainSrc.includes("uvx blender-mcp"));
ok("blender disconnect button", mainSrc.includes("rs-mcp-blender-off") && mainSrc.includes("blender_disconnect"));
ok("blender prompt when connected", cfgSrc.includes("BLENDER MCP IS CONNECTED") && cfgSrc.includes("Start MCP Server"));
ok("overlay atelier skin", cssSrc.includes("atelier skin 1.17.12"));
ok("overlay float is a card not a capsule", cssSrc.includes("not a stretched capsule") && cssSrc.includes("border-radius: 18px"));
ok("overlay panels revamp", cssSrc.includes("atelier panels 1.17.13"));
ok("overlay settings menu has photo head", cssSrc.includes(".rs-menu-head") && cssSrc.includes("ui/hero.jpg"));
ok("overlay cards panel painted", cssSrc.includes("#rs-cards-panel::before"));
ok("log-only panel", mainSrc.includes("Run Log") && !mainSrc.includes('data-tab="library"') && !mainSrc.includes('data-tab="uicreator"'));
ok("no motion tab", !mainSrc.includes('data-tab="motion"') && !mainSrc.includes("MOTION_CLIPS") && !mainSrc.includes("motionBuildClip"));
ok("UI Creator removed from interface", !mainSrc.includes('data-tab="uicreator"'));
ok("forge gui toggle removed", !popupHtml.includes('id="tgl-forge"') && !mainSrc.includes('data-mode="forge"'));
ok("robux donation links have explicit amounts", ["2025206972","2026664687","2025386949","2026352931"].every((id) => mainSrc.includes(id)) && mainSrc.includes('aria-label="Donate ${label}"') && !mainSrc.includes("fillRobuxPrices") && !mainSrc.includes("1865342947") && !mainSrc.includes("ko-fi.com") && !popupHtml.includes('id="kofi"'));
ok("setup card 1.17.19", cssSrc.includes("setup card 1.17.19") && mainSrc.includes('setupCard.id = "rs-setup"') && mainSrc.includes('id="rs-setup-tutorial"') && !mainSrc.includes("<b>AN</b> animation"));
ok("chat gui atelier composer", fs.readFileSync(path.join(root, "ollama.html"), "utf8").includes("Ask Ollama") && fs.readFileSync(path.join(root, "ollama.html"), "utf8").includes("ui/hero.jpg"));
ok("manifest exposes ui photos", JSON.stringify(manifest).includes("ui/*.jpg"));
ok("sharp edges on overlay chrome", cssSrc.includes("sharp edges 1.17.15") && cssSrc.includes("border-radius: 4px !important"));

ok("mode lock SYSTEM_STATE", mainSrc.includes("MODE LOCK:") && mainSrc.includes("ENGINE=${eng}") && mainSrc.includes('name === "synerixcode_status"'));
ok("work mode does not clobber extra thinking", mainSrc.includes('toast("Work mode: "') && mainSrc.includes("Extra Thinking stays") && !mainSrc.includes("fast: { thinking: \"low\", extra: false }"));
ok("engine switch ignores echo", mainSrc.includes("lastManualEngineAt < 5000") && mainSrc.includes("restart the agent so it uses this engine"));
ok("plan mode toggle + prompt", mainSrc.includes('data-mode="plan"') && mainSrc.includes("function setPlanMode") && mainSrc.includes("PLAN=${plan}") && cfgSrc.includes("PLAN MODE (user enabled)") && cfgSrc.includes("production code"));
ok("cards RNG button", mainSrc.includes('id="rs-cards-rng"') && mainSrc.includes("function runRngTopic") && mainSrc.includes('+1 Keyboard') && mainSrc.includes("Survive the Apocalypse") && cssSrc.includes("#rs-cards-rng"));
ok("script_read_analysis alias", mainSrc.includes('script_read_analysis: "script_analysis"') && mainSrc.includes("remapToolName") && skillSrc.includes("alias: script_read_analysis") && skillSrc.includes("SKIP[cn]"));
ok("analysis no loadstring / no task.wait false positive", skillSrc.includes("luauUnbalanced") && skillSrc.includes("bareCall") && skillSrc.includes(":WaitForChild%s*(%b())") && !skillSrc.includes('src:find("[^%w_]wait%s*%(")'));
ok("new studio daily commands", dailySrc.includes("script_set_source") && dailySrc.includes("weld_constraint") && dailySrc.includes("humanoid_set") && dailySrc.includes("instance_move") && dailySrc.includes("tag_remove"));
ok("new blender commands", opsPy.includes("def cmd_scale") && opsPy.includes("def cmd_bevel") && opsPy.includes("def cmd_keyframe_insert") && opsPy.includes("def cmd_track_to") && bg.includes("blender_subdivision") && bg.includes("blender_add_armature"));
const fbSrc = fs.readFileSync(path.join(root, "providers/freebuff.js"), "utf8");
ok("freebuff slow-chat not treated as hung", fbSrc.includes("PRESTART_MS: 180000") && fbSrc.includes("GEN_IDLE_MS: 14000") && fbSrc.includes("GEN_STOP_GRACE_MS: 12000") && fbSrc.includes("function busyChrome") && fbSrc.includes("return true;") && mainSrc.includes("T.PRESTART_MS") && mainSrc.includes("T.GEN_STOP_GRACE_MS") && !fbSrc.includes("unstableWarning"));
ok("synerixcode_screenshot send-to-self", mainSrc.includes('name === "synerixcode_screenshot"') && mainSrc.includes('type: "capture_tab"') && mainSrc.includes('screenshot: "synerixcode_screenshot"') && mainSrc.includes("A.pendingImages = shots") && bg.includes('case "capture_tab"') && cfgSrc.includes("synerixcode_screenshot") && manJs.includes("1.18.7"));
ok("condo lock is condo-topic only", mainSrc.includes("function isCondoTopic") && mainSrc.includes("function punishCondo") && mainSrc.includes("CONDO LOCK") && mainSrc.includes("enforceCondo") && mainSrc.includes("rsCondoLock") && mainSrc.includes("condo-topic ONLY") && cfgSrc.includes("never build Roblox condo games"));
const plusSrc = fs.readFileSync(path.join(root, "core/studio_plus.js"), "utf8");
const claudeSrc = fs.readFileSync(path.join(root, "providers/claude.js"), "utf8");
ok("automatic debugger", mainSrc.includes("function attachAutoDebug") && mainSrc.includes("[AUTO DEBUG]") && mainSrc.includes("setAutoDebug") && cfgSrc.includes("AUTOMATIC DEBUGGER") && mainSrc.includes("synerixcode_debug"));
ok("undo transaction button", mainSrc.includes('id="rs-undo"') && mainSrc.includes("function wrapStudioTxn") && mainSrc.includes("function undoStudioTxn") && mainSrc.includes("ChangeHistoryService"));
ok("context compression", mainSrc.includes("function compressToolFeedback") && mainSrc.includes("synerixcode context compression"));
ok("multi-agent", mainSrc.includes("setMultiAgent") && mainSrc.includes('name === "synerixcode_agent"') && cfgSrc.includes("MULTI-AGENT") && mainSrc.includes("planner") && mainSrc.includes("reviewer"));
ok("studio plus 40 commands file", plusSrc.includes("size_set") && plusSrc.includes("hinge_create") && plusSrc.includes("jump_pad") && manJs.includes("studio_plus.js") && manJs.includes("1.18.7"));
ok("developer product create", mainSrc.includes("function createDeveloperProduct") && mainSrc.includes("create_dev_product") && bg.includes("function robloxCreateDevProduct") && plusSrc.includes("developer_product_create") && cfgSrc.includes("developer_product_create") && manJs.includes("*.roblox.com"));
ok("v18 version", manifest.version === "1.18.7");
ok("devproduct reaches game", mainSrc.includes("function studioUniverseIds") && bg.includes("function robloxResolveUniverse") && bg.includes("develop.roblox.com/v1/user/universes"));
ok("claude sonnet5 no-refuse", claudeSrc.includes("sonnet5") && claudeSrc.includes("authorized local automation") && mainSrc.includes("function isCapabilityRefuse") && cfgSrc.includes("capabilityRefuse"));
ok("bridge reconnect retry", bg.includes("waitForConnection(20000)") && bg.includes('r.kind === "disconnected"'));
ok("request understanding in prompts", cfgSrc.includes("UNDERSTAND THE REQUEST") && cfgSrc.includes("PERFECT CREATION") && cfgSrc.includes("implied systems") && cfgSrc.includes("function wrapTaskPrompt") && cfgSrc.includes("creationFocus"));
ok("task wrap + create rider", mainSrc.includes("RS.wrapTaskPrompt") && mainSrc.includes("RS.FEEDBACK.creationFocus") && mainSrc.includes("UNDERSTAND THE REQUEST: WHAT TO BUILD"));

if (process.exitCode) {
  console.log("\nSome v1.16 checks failed.");
} else {
  console.log("\nAll v1.16 checks passed.");
}
