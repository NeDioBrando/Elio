// Quick Node smoke tests for the v1.11 features (run: node test-v111.js). Not shipped.
// Covers: persona removal, the AN (animation) engine prompt branch, the
// image→model template, and the engine-id contract across plumbing files.
const fs = require("fs");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const fakeWindow = {};
const RS = new Function("window", fs.readFileSync(__dirname + "/core/config.js", "utf8") + "; return RS;")(fakeWindow);

ok("persona catalogue removed", !RS.PERSONAS);
ok("persona helper removed", typeof RS.buildPersonaBlock !== "function");

const robloxPrompt = RS.buildSystemPrompt({ siteName: "TestAI" });
ok("roblox prompt has no persona block", robloxPrompt.includes("PERSONA:") === false);
ok("legacy unreal engine falls back to roblox prompt", RS.buildSystemPrompt({ siteName: "TestAI", engine: "unreal" }).includes("execute_luau") || RS.buildSystemPrompt({ siteName: "TestAI", engine: "unreal" }).includes("Roblox"));
ok("legacy unreal engine is not an Unreal prompt", !RS.buildSystemPrompt({ siteName: "TestAI", engine: "unreal" }).includes("Unreal Editor"));
ok("local prompt still builds", /AgentScript|workspace/i.test(RS.buildSystemPrompt({ siteName: "TestAI", engine: "local" })));
ok("legacy anim engine falls back to roblox prompt", RS.buildSystemPrompt({ siteName: "TestAI", engine: "anim" }).includes("execute_luau") || RS.buildSystemPrompt({ siteName: "TestAI", engine: "anim" }).includes("Roblox"));
ok("legacy anim engine is not a dedicated AN prompt", !RS.buildSystemPrompt({ siteName: "TestAI", engine: "anim" }).includes("ANIMATION mode (AN)"));

const robloxAnim = RS.buildSystemPrompt({ siteName: "TestAI", engine: "roblox" });
ok("roblox prompt keeps animation tools", robloxAnim.includes("animation_test") || robloxAnim.includes("animation_*"));
ok("roblox prompt carries SYS_MARKER first", robloxAnim.startsWith(RS.SYS_MARKER));
ok("roblox prompt keeps JSON command contract", robloxAnim.includes('"command"'));

const i2m = RS.buildImageToModelPrompt("a rusty sword", "roblox");
ok("img2model names the flow", i2m.includes("IMAGE TO MODEL"));
ok("img2model includes user notes", i2m.includes("a rusty sword"));
ok("img2model verify step", i2m.includes("screen_capture"));
ok("img2model does not target Unreal", !RS.buildImageToModelPrompt("", "unreal").includes("Unreal Editor"));

const mainSrc = fs.readFileSync(__dirname + "/core/main.js", "utf8");
const bgSrc = fs.readFileSync(__dirname + "/background.js", "utf8");
const popupSrc = fs.readFileSync(__dirname + "/popup.js", "utf8");
ok("background ENGINES is roblox+local", /ENGINES\s*=\s*\[[^\]]*"roblox"[^\]]*"local"[^\]]*\]/.test(bgSrc) && !/const ENGINES\s*=\s*\[[^\]]*"anim"/.test(bgSrc));
ok("background maps non-local WS to 17613", /engine === "local" \? PORT_LOCAL : PORT_ROBLOX/.test(bgSrc));
ok("main activeEngine folds anim into roblox", /const activeEngine[\s\S]{0,400}v === "local" \? "local" : "roblox"/.test(mainSrc));
ok("main setEngine folds anim into roblox", /v==="local" \? "local" : "roblox"/.test(mainSrc));
ok("popup engine list is roblox+local", /ENGINES\s*=\s*\[[^\]]*"roblox"[^\]]*"local"[^\]]*\]/.test(popupSrc) && !/const ENGINES\s*=\s*\[[^\]]*"anim"/.test(popupSrc));
ok("no Unreal engine button in the bar", !mainSrc.includes('data-mode="unreal"'));
ok("no Animation engine button in the bar", !mainSrc.includes('data-mode="anim"'));
ok("execute_luau auto-chunks around 24KB", mainSrc.includes("LUAU_CHUNK_MAX") && mainSrc.includes("wrapLuauChunk"));
ok("luau chunks use long-strings not JSONDecode", mainSrc.includes("function luauLongStr") && !/HttpService:JSONDecode/.test(mainSrc));
const manifest = JSON.parse(fs.readFileSync(__dirname + "/manifest.json", "utf8"));
const [maj, min] = manifest.version.split(".").map(Number);
ok("manifest at 1.11.0 or newer", maj > 1 || min >= 11);
ok("manifest name is elio", manifest.name.includes("elio"));
