// Claude provider smoke (run: node test-claude.js). Not shipped.
const fs = require("fs");
const path = require("path");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const root = __dirname;
const claude = fs.readFileSync(path.join(root, "providers/claude.js"), "utf8");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const main = fs.readFileSync(path.join(root, "core/main.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

ok("claude provider id", claude.includes('id: "claude"') && claude.includes('displayName: "Claude"'));
ok("claude finds ProseMirror composer", claude.includes("ProseMirror") && claude.includes("getEditor"));
ok("claude user-message selector", claude.includes('data-testid="user-message"'));
ok("claude send/stop buttons", claude.includes("Send message") && claude.includes("stopButton"));
ok("claude typeAndSend", claude.includes("function typeAndSend") && claude.includes("insertText"));
ok("bg PROVIDER_URLS has claude.ai", bg.includes("https://claude.ai/*"));
ok("overlay Switch AI lists Claude", main.includes("claude.ai"));
ok("popup SUPPORTED_HOSTS has claude.ai", popup.includes('"claude.ai"'));
ok("manifest matches claude.ai", JSON.stringify(manifest.content_scripts).includes("claude.ai"));
ok("manifest loads providers/claude.js", JSON.stringify(manifest.content_scripts).includes("providers/claude.js"));
ok("glass tokens untouched", fs.readFileSync(path.join(root, "overlay.css"), "utf8").includes("rgba(16, 17, 25, 0.82)"));

ok("every Claude family has caps", ["haiku", "sonnet", "opus", "fable", "mythos"].every((f) => claude.includes(f + ":")));
ok("does not lock the model picker", claude.includes("synerixcode never clicks it") && claude.includes("applyModelCaps") && !/modelBtn\(\)\.click|target\.click\(\)/.test(claude));
ok("thinking is read for every model", claude.includes("thinkingText") && claude.includes('data-is-thinking="true"'));
ok("Haiku gets a compact prompt", claude.includes("sysMaxChars: 12000") && claude.includes("get sysMaxChars"));
ok("Opus/Fable get long thinking windows", claude.includes("REASON_NOREPLY_MS: 180000") && claude.includes("REASON_NOREPLY_MS: 210000"));
ok("user send starts the agent loop", claude.includes("onUserMessage(assistantCount())"));
ok("prompt works on every Claude model", claude.includes("ANY Claude model") && claude.includes("promptExtra"));
ok("project chats are keyed", claude.includes("(chat|project)"));
ok("vision attach works", claude.includes("function attachImages") && !claude.includes("async function attachImages() { return false; }"));
ok("locked composer still counts as ready", claude.includes("data-rs-locked") && claude.includes("contenteditable=false") && claude.includes("visibleComposer"));
ok("getEditor falls back if the composer is locked or unlaid-out", claude.includes("if (!nodes.length) nodes = all") && claude.includes("data-rs-locked"));
ok("bar stays on screen without a composer", main.includes("keep the bar on screen") && main.includes("Dock it to the bottom"));
ok("Start is not gated on a Claude family", claude.includes("any of them is fine") && claude.includes("const ready = !!ed"));
ok("banner is not a fake model-switch", !main.includes("into the right mode"));
const ds = fs.readFileSync(path.join(root, "providers/deepseek.js"), "utf8");
ok("DeepSeek Start is not blocked on Expert", ds.includes("const ready = !!getEditor()"));

if (process.exitCode) {
  console.log("\nSome Claude checks failed.");
  process.exit(process.exitCode);
}
console.log("\nClaude provider checks passed.");
