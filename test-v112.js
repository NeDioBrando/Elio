// Quick Node smoke tests for the v1.12 features (run: node test-v112.js). Not shipped.
// Covers: background-tab mode plumbing, the crax redesign fix, the dead-turn
// retry, MCP auto-heal, card copy, and the popup contract.
const fs = require("fs");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const mainSrc = fs.readFileSync(__dirname + "/core/main.js", "utf8");
const bgSrc = fs.readFileSync(__dirname + "/background.js", "utf8");
const craxSrc = fs.readFileSync(__dirname + "/providers/crax.js", "utf8");
const cfgSrc = fs.readFileSync(__dirname + "/core/config.js", "utf8");
const popupHtml = fs.readFileSync(__dirname + "/popup.html", "utf8");
const cssSrc = fs.readFileSync(__dirname + "/overlay.css", "utf8");
const dsSrc = fs.readFileSync(__dirname + "/providers/deepseek.js", "utf8");

// ── Background-tab mode ──────────────────────────────────────────────────────
// v1.12.2: the Web-Worker ticker was REMOVED (it was the one novel mechanism
// correlated with the "site crashes/freeze" reports). Timing is all-native.
ok("worker ticker is gone", !mainSrc.includes("tickerWorker") && !mainSrc.includes("degradeTimers"));
// 1.19.36: sleep stays a native setTimeout; background wakes may only resolve
// sleeps whose deadline already passed (test-unattended-run.js).
ok("sleep is a plain native timer", /function sleep\(ms\) \{\s*if \(ms <= 0\) return Promise\.resolve\(\);\s*return new Promise\(\(r\) => \{\s*const s = \{ at: Date\.now\(\) \+ ms, r \};\s*_sleepers\.add\(s\);\s*setTimeout\(\(\) => \{ if \(_sleepers\.delete\(s\)\) r\(\); \}, ms\);/.test(mainSrc.replace(/\r/g, "")) && /if \(now >= s\.at\)/.test(mainSrc));
ok("rsInterval exists and is used", mainSrc.includes("function rsInterval(") && (mainSrc.match(/rsInterval\(/g) || []).length >= 5);
ok("waitForResponse slides deadlines while hidden+bgMode", mainSrc.includes("lastHiddenCheck") && mainSrc.includes("document.hidden && !A.stop && bgMode"));
ok("waitVisible bypasses park in bg mode", /if \(bgMode\) return true; \/\/ background mode/.test(mainSrc));
ok("parkHidden returns 0 in bg mode", /if \(bgMode\) return 0;/.test(mainSrc));
ok("send gate respects bg mode", /if \(document\.hidden && !bgMode\) \{[\s\S]{0,120}send\.waitVisible/.test(mainSrc));
ok("watchdog respects bg mode", /document\.hidden && !bgMode/.test(mainSrc));
ok("bg mode persists as rsBgMode", mainSrc.includes("rsBgMode") && mainSrc.includes("Work in background tabs"));
ok("setBgMode toggles + toasts", mainSrc.includes("function setBgMode("));

// ── v1.12.2 freeze failsafes ─────────────────────────────────────────────────
ok("bootstrap lock/cover inside try (finally always releases)", /A\.starting = true;[\s\S]{0,800}const alive = [\s\S]{0,700}try \{[\s\S]{0,1400}setInputLock\(true\)/.test(mainSrc.replace(/\r/g, "")));
ok("stale-bootstrap abort after 120s", mainSrc.includes("start.staleAborted") && mainSrc.includes("_startingSince"));
ok("stuck-injecting clear after 60s", mainSrc.includes("inject.staleCleared") && mainSrc.includes("_injectingSince"));
ok("unlock failsafe skips while an owner is live", /!A\.running && !A\.starting && !A\.injecting/.test(mainSrc));

// ── Dead-turn stability ──────────────────────────────────────────────────────
ok("deadTurn feedback exists", cfgSrc.includes("deadTurn:"));
ok("loop retries dead turns once", /deadRetries < 1/.test(mainSrc) && mainSrc.includes("loop.deadRetry"));
ok("retry budget refills on healthy turn", /deadRetries = 0; \/\/ healthy turn/.test(mainSrc));
ok("late-reply rescue before empty", mainSrc.includes("empty.lateRescue"));

// ── Crax redesign fix ────────────────────────────────────────────────────────
ok("crax targets new composer", craxSrc.includes('"#promptInput, #chatField"'));
ok("crax targets composer-bar/form", craxSrc.includes('.composer-bar, #composer, #chatInput'));
ok("crax detects auth gate", craxSrc.includes("authGatePresent") && craxSrc.includes("section.auth"));
ok("crax modeWarning gates start", craxSrc.includes("modeWarning()") && craxSrc.includes("log in with your access key"));
ok("crax exports modeWarning", /modeWarning, authGatePresent,/.test(craxSrc));

// ── MCP auto-heal + repair ───────────────────────────────────────────────────
ok("background auto-heals dead MCP helper", bgSrc.includes("auto-restarting Studio MCP") && bgSrc.includes("mcpDownStreak"));
ok("heal only on studio engines, never mid-tool", (/engine === "roblox" \|\| engine === "anim"/.test(bgSrc) || /engine === "roblox"/.test(bgSrc)) && bgSrc.includes("!toolPending"));
ok("menu has Repair Studio link", mainSrc.includes('id="rs-mcp-repair"'));

// ── Cards ────────────────────────────────────────────────────────────────────
ok("library cards have copy button", mainSrc.includes("rs-lib-copy") && mainSrc.includes("Prompt copied"));
ok("copy intercepts before send", /closest\("\.rs-lib-copy"\)[\s\S]{0,900}runLibraryCard/.test(mainSrc));

// ── Popup + blank-look fixes ────────────────────────────────────────────────
ok("popup keeps all load-bearing IDs", ["ver","dot","state","tools","servers","hint-row","hint-engine","restart","reconnect","ollama","settings","engine-roblox","engine-local","run-hint","site-tag","engine-label"]
  .every(id => popupHtml.includes(`id="${id}"`)));
ok("popup has 2 engine segments, no Anim/Unreal", popupHtml.includes("engine-roblox") && popupHtml.includes("engine-local") && !popupHtml.includes("engine-anim") && !popupHtml.includes("engine-unreal"));
ok("glass has @supports fallback", cssSrc.includes("@supports not") && cssSrc.includes("rgba(16, 17, 25, 0.96)"));
ok("glass base opacity readable", cssSrc.includes("rgba(16, 17, 25, 0.82)"));

// ── Version ──────────────────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(__dirname + "/manifest.json", "utf8"));
const [maj12, min12] = manifest.version.split(".").map(Number);
ok("manifest at 1.12.0 or newer", maj12 > 1 || min12 >= 12);

// ── DeepSeek 2026 UI ────────────────────────────────────────────────────────
ok("deepseek send button has fallbacks", dsSrc.includes("getSendBtn") && dsSrc.includes("contenteditable"));
// 2026-09: DeepSeek unified Instant/Expert/Vision into one model and deleted the
// picker. Start is model-tab agnostic (readiness is the EDITOR, never a radio), a
// legacy user-chosen Vision tab is still respected, and when no picker exists the
// session starts without waiting for one.
ok("deepseek start does not require Expert radios",
  dsSrc.includes("const ready = !!getEditor()") && !/ready\s*=\s*[^;]*expertFound/.test(dsSrc));
ok("deepseek start respects a legacy user-chosen Vision tab", dsSrc.includes("if (!isVisionSelected())") && dsSrc.includes("const isVisionSelected ="));
ok("deepseek start does not wait for a deleted picker", dsSrc.includes("const legacyPicker"));
ok("deepseek user detect survives hashed-class churn", dsSrc.includes("data-message-author-role") && dsSrc.includes("leftGap"));
ok("deepseek stamps 2026-09 UI beacon", /2026-09_(new-ui|unified-model)/.test(dsSrc));

// ── v1.12.1 hotfix: the "site crashes after starting agent" freeze ──────────
// (v1.12.2 removed the worker entirely - the degrade assertions became moot.)
ok("SendAbortedError exists + thrown on dead send", mainSrc.includes("class SendAbortedError") && mainSrc.includes("throw new SendAbortedError"));
ok("agentLoop swallows SendAbortedError", mainSrc.includes("loop.sendAborted"));
ok("startSession swallows SendAbortedError", mainSrc.includes("start.sendAborted"));
ok("composer-unlock failsafe in meter loop", mainSrc.includes("_lastUnlockSweep") && mainSrc.includes("P.setInputLock(false); } catch {}"));
ok("error hook filters on chrome-extension origin", mainSrc.includes("chrome-extension://"));
// crax v1.12.1: the redesigned site (verified against its own script.js)
ok("crax targets .msg/.bubble turns", craxSrc.includes('".msg, .chat-msg"') && craxSrc.includes('".bubble, .chat-msg__text"'));
ok("crax generation via is-streaming", craxSrc.includes("is-streaming"));
ok("crax stop clicks the send button", /stopGeneration\(\)[\s\S]{0,400}is-streaming/.test(craxSrc));
ok("crax excludes reasoning from parsing", craxSrc.includes('thinkingSel: ".reasoning-bubble"'));
ok("crax form-submit fallback", craxSrc.includes("requestSubmit"));
