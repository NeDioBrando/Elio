// SPDX-License-Identifier: GPL-3.0-or-later
const DISCORD_URL = "https://discord.gg/FmKY5bXZn";
const THEMES = [];
const POPUP_PALETTES={default:['#5e9fe8','#b8d7ff','#0c1423','94 159 232'],amethyst:['#a571ff','#d7b8ff','#0c0918','165 113 255'],cyan:['#27c1e7','#a5eaff','#041017','39 193 231'],rose:['#f17097','#ffbdd1','#160912','241 112 151'],emerald:['#29c894','#a6f3d1','#05130f','41 200 148'],graphite:['#9caac0','#e0e7f2','#0a0d13','156 170 192'],crimson:['#ef5569','#ffb0bb','#16080c','239 85 105'],ocean:['#4692f6','#a5ceff','#091323','70 146 246'],copper:['#db9066','#f4c4a3','#17110f','219 144 102'],aurora:['#66d3b8','#b4f6e7','#0c151b','102 211 184'],orchid:['#cd89eb','#edc6ff','#150e1c','205 137 235']};
let popupAppearance={theme:'default',glow:'subtle',gradients:'on'};
function applyPopupAppearance(value){
 if(value?.theme==="solar")value={...value,theme:"default"};
 popupAppearance=value&&POPUP_PALETTES[value.theme]?value:{theme:'default',glow:'subtle',gradients:'on'};
 const [accent,light,bg,rgb]=POPUP_PALETTES[popupAppearance.theme],root=document.documentElement;
 root.dataset.palette=popupAppearance.theme;root.dataset.glow=popupAppearance.glow||'subtle';root.dataset.gradients=popupAppearance.gradients||'on';
 const vars={'--bg':bg,'--accent':accent,'--accent-light':light,'--text':'#eef4ff','--text-dim':light,'--text-faint':'#96a0b0','--surface':`color-mix(in srgb, ${bg} 89%, ${accent})`,'--surface-2':`color-mix(in srgb, ${bg} 78%, ${accent})`,'--line':`rgb(${rgb} / .24)`,'--glow':popupAppearance.glow==='off'?'transparent':`rgb(${rgb} / ${popupAppearance.glow==='strong'?'.5':'.22'})`};
 for(const [key,value]of Object.entries(vars))root.style.setProperty(key,value);
}
const SUPPORTED_HOSTS = [
  "app.clickup.com",
  "chat.deepseek.com", "deepseek.com", "chatgpt.com", "chat.openai.com",
  "claude.ai", "claude.com",
  "gemini.google.com", "www.kimi.com", "kimi.com",
  "vani.ai", "www.vani.ai", "c.vani.ai", "chat.z.ai", "chat.qwen.ai", "arena.ai", "freebuff.ai", "freebuff.com", "notion.so", "notion.com",
  "gpt.crax.lol", "use.ai", "www.use.ai", "oxalpha.com", "www.oxalpha.com", "oxalpha.org", "www.oxalpha.org",
  "localhost", "127.0.0.1", "ollama.com",
];
const DEFAULT_AI_URL = "https://chat.deepseek.com/";
const ENGINE_KEY = "rs-engine"; // "roblox" | "local"
const ENGINES = ["roblox", "local"];
const THINKING_LEVELS = ["default", "low", "mid", "high", "max", "ultracode"];
const WORK_MODES = ["fast", "balanced", "thorough"];
const WORK_PRESETS = {
  fast: { thinking: "low", extra: false },
  balanced: { thinking: "mid", extra: false },
  thorough: { thinking: "high", extra: true },
};

const PERM_MODES = ["sandbox", "ask", "full"];
const settings = {
  workMode: "balanced",
  permMode: "sandbox",
  theme: "night",
  extra: false,
  showApproach: false,
  plan: false,
  thinking: "default",
  forge: true,
  autofix: true,
  bg: true,
  sounds: true,
};

async function activeTab() { const tabs=await chrome.tabs.query({active:true,currentWindow:true});return tabs[0]; }
async function getEngine() {try {const tab=await activeTab(); const value=await chrome.runtime.sendMessage({type:"rs-get-engine",tab_id:tab?.id});return value?.engine==="local"?"local":"roblox";}catch{return "roblox";}}
async function setEngine(v) {try {const tab=await activeTab();const value=await chrome.runtime.sendMessage({type:"rs-set-engine",tab_id:tab?.id,engine:v});if(value?.engine)renderEngine(value.engine);}catch{}}
function renderEngine(v) {
  const isLocal = v === "local";
  const rob = document.getElementById("engine-roblox");
  const loc = document.getElementById("engine-local");
  const label = document.getElementById("engine-label");
  const hintRow = document.getElementById("hint-row");
  const restart = document.getElementById("restart");
  // Segmented control: .on class carries the active styling (see popup.html CSS)
  if (rob) rob.classList.toggle("on", !isLocal);
  if (loc) loc.classList.toggle("on",  isLocal);
  if (label) label.textContent = isLocal ? "AgentScript" : "Roblox";
  if (restart) restart.textContent = isLocal ? "⟳ Restart AgentScript server" : "⟳ Restart Roblox server";
  if (hintRow) {
    const engEl = document.getElementById("hint-engine");
    if (engEl) engEl.textContent = isLocal ? "your project folder" : "Roblox Studio";
  }
}

function renderSettings() {
  document.documentElement.dataset.thinking = settings.thinking;
  for (const id of WORK_MODES) {
    const el = document.getElementById("work-" + id);
    if (el) el.classList.toggle("on", settings.workMode === id);
  }
  for (const id of PERM_MODES) {
    const el = document.getElementById("perm-" + id);
    if (el) el.classList.toggle("on", settings.permMode === id);
  }
  for (const id of THEMES) {
    const el = document.getElementById("theme-" + id);
    if (el) el.classList.toggle("on", settings.theme === id);
  }
  document.documentElement.setAttribute("data-theme", settings.theme);
  applyPopupAppearance(popupAppearance);
  const logo = document.getElementById("or-logo");
  if (logo) {
    const names = { night: "Night", "blood-moon": "Blood Moon", sakura: "Sakura", starglaze: "Starglaze", autumn: "Autumn" };
    logo.textContent = "synerixcode";
  }
  const reasoning = document.getElementById("reasoning-level");
  if (reasoning) reasoning.value = settings.thinking;
  const map = [
    ["tgl-extra", settings.extra],
    ["tgl-approach", settings.showApproach],
    ["tgl-plan", settings.plan],
    ["tgl-autofix", settings.autofix],
    ["tgl-bg", settings.bg],
    ["tgl-sounds", settings.sounds],
  ];
  for (const [id, on] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  }
}

async function loadSettings() {
  try {
    const r = await chrome.storage.local.get([
      "rsLanguage", "rsWorkMode", "rsPermMode", "rsTheme", "rsAppearance", "rsSounds", "rsExtraThinking", "rsShowApproach", "rsPlanMode", "rsThinkingLevel", "rsForgeMode", "rsAutoFix", "rsBgMode",
    ]);
    globalThis.synerixcodeI18n?.setLanguage(r.rsLanguage || 'en');
    if (THINKING_LEVELS.includes(r.rsThinkingLevel)) settings.thinking = r.rsThinkingLevel;
    if (WORK_MODES.includes(r.rsWorkMode)) settings.workMode = r.rsWorkMode;
    if (PERM_MODES.includes(r.rsPermMode)) settings.permMode = r.rsPermMode;
    if (THEMES.includes(r.rsTheme)) settings.theme = r.rsTheme;
    applyPopupAppearance(r.rsAppearance);
    if (typeof r.rsSounds === "boolean") settings.sounds = r.rsSounds;
    if (typeof r.rsPlanMode === "boolean") settings.plan = r.rsPlanMode;
    if (typeof r.rsExtraThinking === "boolean") settings.extra = r.rsExtraThinking;
    if (typeof r.rsShowApproach === "boolean") settings.showApproach = r.rsShowApproach;
    if (typeof r.rsForgeMode === "boolean") settings.forge = r.rsForgeMode;
    if (typeof r.rsAutoFix === "boolean") settings.autofix = r.rsAutoFix;
    if (typeof r.rsBgMode === "boolean") settings.bg = r.rsBgMode;
  } catch {}
  renderSettings();
}

async function setTheme(id) {
  if (!THEMES.includes(id)) return;
  settings.theme = id;
  renderSettings();
  try { await chrome.storage.local.set({ rsTheme: id }); } catch {}
}

async function setPermMode(id) {
  if (!PERM_MODES.includes(id)) return;
  settings.permMode = id;
  renderSettings();
  try { await chrome.storage.local.set({ rsPermMode: id }); } catch {}
  try { chrome.runtime.sendMessage({ type: "rs-set-full", enabled: id === "full" }).catch(() => {}); } catch {}
}

async function setWorkMode(id) {
  if (!WORK_MODES.includes(id)) return;
  const p = WORK_PRESETS[id];
  settings.workMode = id;
  settings.extra = p.extra;
  settings.thinking = p.thinking;
  renderSettings();
  try {
    await chrome.storage.local.set({
      rsWorkMode: id,
      rsThinkingLevel: p.thinking,
      rsExtraThinking: p.extra,
    });
  } catch {}
}

async function setFlag(key, field, v) {
  settings[field] = !!v;
  renderSettings();
  try { await chrome.storage.local.set({ [key]: settings[field] }); } catch {}
}

function renderPopupVersion(value) {
  synerixcodeVersion.render(document.getElementById("ver"), chrome.runtime.getManifest().version, value);
}
renderPopupVersion(null);
const runHint = document.getElementById("run-hint");
if (runHint) {
  runHint.textContent = "synerixcode.exe";
}
(async () => {
  try {
    const el = document.getElementById("site-tag");
    if (!el) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || "";
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const names = {
      "chat.deepseek.com": "DeepSeek", "deepseek.com": "DeepSeek",
      "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT",
      "app.clickup.com": "ClickUp Brain", "claude.ai": "Claude", "claude.com": "Claude",
      "gemini.google.com": "Gemini",
      "kimi.com": "Kimi", "kimi.ai": "Kimi",
      "chat.z.ai": "GLM", "chat.qwen.ai": "Qwen",
      "arena.ai": "Arena",
      "freebuff.ai": "Freebuff", "freebuff.com": "Freebuff", "vani.ai": "Vani AI", "www.vani.ai": "Vani AI", "c.vani.ai": "Vani AI", "notion.so": "Notion", "notion.com": "Notion",
      "gpt.crax.lol": "Crax", "localhost": "Ollama", "127.0.0.1": "Ollama",
      "ollama.com": "Ollama",
    };
    el.textContent = names[host] || (SUPPORTED_HOSTS.some((h) => url.includes(h)) ? (host || "Chat") : "Idle");
  } catch {}
})();

function render(s) {
  const dot = document.getElementById("dot");
  const state = document.getElementById("state");
  const tools = document.getElementById("tools");
  const servers = document.getElementById("servers");
  const hintRow = document.getElementById("hint-row");
  const list = s.servers || [];
  // studio===true comes from the bridge's live probe every heartbeat, so it is
  // trustworthy even right after an MV3 worker restart wiped tools/servers.
  // A bridge WebSocket/helper and a real editor connection are different
  // states. Only the fresh editor probe may produce the green connected state.
  const isLocal = s.engine === "local";
  // AgentScript is "ready" whenever the agent process is up: the workspace
  // folder is auto-created at boot, so there is no editor to wait for.
  const editorOk = isLocal ? true : s.roblox_connected === true;
  const mcpOk = !!s.connected;
  const studioOff = mcpOk && !editorOk;
  const ok = mcpOk && editorOk;
  dot.className = "dot " + (s.connected ? (ok ? "on" : "warn") : "");
  state.classList.toggle("ok", ok);
  state.textContent = s.connected
    ? (ok ? (isLocal ? "Connected — AgentScript is ready" : "Connected — Studio is ready")
        : studioOff ? "Studio MCP is off — enable it in Assistant settings"
        : (isLocal ? "Bridge is up — AgentScript ready" : "Bridge is up — open Studio"))
    : "Bridge is offline — run synerixcode.exe";
  tools.textContent = s.connected ? `${s.tools || 0} tools ready` : "Run synerixcode.exe";
  servers.textContent = s.connected
    ? list.map((x) => `${x.alive ? "●" : "○"} ${x.id} (${x.alive ? x.tools + " tools" : "down"})`).join("\n")
    : "";
  if (hintRow) hintRow.style.display = ok ? "none" : "";
  // keep engine toggle in sync from bg status (in case popup opened after toggle)
  if (s.engine) try { const raw = s.engine === "anim" ? "roblox" : s.engine; const e = ENGINES.includes(raw) ? raw : "roblox"; if (typeof renderEngine === "function") renderEngine(e); } catch {}
}

async function refresh() {
  const tab=await activeTab();chrome.runtime.sendMessage({ type: "status",tab_id:tab?.id }, (s) => s && render(s));
}

document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(refresh, 600));
});
document.getElementById("restart").addEventListener("click", async (e) => {
  e.target.textContent = "Restarting…";
  const tab=await activeTab();chrome.runtime.sendMessage({ type: "restart_mcp",tab_id:tab?.id }, () => {
    e.target.textContent = "⟳ Restart Roblox server";
    setTimeout(refresh, 600);
  });
});
document.getElementById("discord")?.addEventListener("click", () => {
  chrome.tabs.create({ url: DISCORD_URL });
});
document.getElementById("ollama")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "🦙 Starting Ollama…";
  // One click: ask the bridge to spawn `ollama serve` if it isn't running,
  // then open the chat page. No API key, no terminal.
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: "ollama_ensure" }); } catch {}
  btn.textContent = "🦙 Ollama";
  btn.disabled = false;
  if (r && !r.ok && /bridge offline/i.test(r.error || "")) {
    btn.title = "Bridge is offline — run synerixcode.exe first, then this button.";
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("ollama.html") });
  setTimeout(() => { btn.textContent = old; }, 1200);
});
document.getElementById("figma-legacy")?.addEventListener("click", () => chrome.tabs.create({ url: "https://www.figma.com/" }));
document.getElementById("meshy-legacy")?.addEventListener("click", () => chrome.tabs.create({ url: "https://www.meshy.ai/" }));
document.getElementById("blender")?.addEventListener("click", () => {
  document.getElementById("settings")?.click();
});
document.getElementById("settings").addEventListener("click", () => {
  // Same mechanism as the Ko-fi button (chrome.tabs), but tries the in-page
  // panel on an already-open supported AI tab first, so opening it doesn't
  // require a conversation to already be started there.
  chrome.tabs.query({}, (tabs) => {
    const active = tabs.find((t) => t.active && t.url && SUPPORTED_HOSTS.some((h) => t.url.includes(h)));
    const anySupported = active || tabs.find((t) => t.url && SUPPORTED_HOSTS.some((h) => t.url.includes(h)));
    if (anySupported) {
      // .catch: the tab's content script may not be injected yet (fresh load /
      // post-reload) — MV3 sendMessage rejects as an unhandled promise then.
      chrome.tabs.sendMessage(anySupported.id, { type: "rs-open-menu" }).catch(() => {});
      chrome.tabs.update(anySupported.id, { active: true });
    } else {
      chrome.tabs.create({ url: DEFAULT_AI_URL });
    }
  });
});

document.getElementById("engine-roblox")?.addEventListener("click", () => setEngine("roblox"));
document.getElementById("engine-local")?.addEventListener("click", () => setEngine("local"));

for (const id of WORK_MODES) {
  document.getElementById("work-" + id)?.addEventListener("click", () => setWorkMode(id));
}
for (const id of PERM_MODES) {
  document.getElementById("perm-" + id)?.addEventListener("click", () => setPermMode(id));
}
for (const id of THEMES) {
  document.getElementById("theme-" + id)?.addEventListener("click", () => setTheme(id));
}
function bindToggle(elId, key, field) {
  const el = document.getElementById(elId);
  if (!el) return;
  const flip = () => setFlag(key, field, !settings[field]);
  el.addEventListener("click", flip);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
  });
}
document.getElementById("reasoning-level")?.addEventListener("change", async (event) => {
  const level = event.target.value;
  if (!THINKING_LEVELS.includes(level)) return;
  settings.thinking = level;
  renderSettings();
  try { await chrome.storage.local.set({ rsThinkingLevel: level }); } catch {}
});
bindToggle("tgl-plan", "rsPlanMode", "plan");
bindToggle("tgl-extra", "rsExtraThinking", "extra");
bindToggle("tgl-approach", "rsShowApproach", "showApproach");
bindToggle("tgl-autofix", "rsAutoFix", "autofix");
bindToggle("tgl-bg", "rsBgMode", "bg");
bindToggle("tgl-sounds", "rsSounds", "sounds");

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes) return;
    if(changes.rsLanguage)globalThis.synerixcodeI18n?.setLanguage(changes.rsLanguage.newValue || 'en');
    if(changes.rsAppearance)applyPopupAppearance(changes.rsAppearance.newValue);
    if (changes.rsWorkMode && WORK_MODES.includes(changes.rsWorkMode.newValue)) settings.workMode = changes.rsWorkMode.newValue;
    if (changes.rsPermMode && PERM_MODES.includes(changes.rsPermMode.newValue)) settings.permMode = changes.rsPermMode.newValue;
    if (changes.rsTheme && THEMES.includes(changes.rsTheme.newValue)) settings.theme = changes.rsTheme.newValue;
    if (changes.rsSounds && typeof changes.rsSounds.newValue === "boolean") settings.sounds = changes.rsSounds.newValue;
    if (changes.rsThinkingLevel && THINKING_LEVELS.includes(changes.rsThinkingLevel.newValue)) settings.thinking = changes.rsThinkingLevel.newValue;
    if (changes.rsPlanMode && typeof changes.rsPlanMode.newValue === "boolean") settings.plan = changes.rsPlanMode.newValue;
    if (changes.rsExtraThinking && typeof changes.rsExtraThinking.newValue === "boolean") settings.extra = changes.rsExtraThinking.newValue;
    if (changes.rsShowApproach && typeof changes.rsShowApproach.newValue === "boolean") settings.showApproach = changes.rsShowApproach.newValue;
    if (changes.rsForgeMode && typeof changes.rsForgeMode.newValue === "boolean") settings.forge = changes.rsForgeMode.newValue;
    if (changes.rsAutoFix && typeof changes.rsAutoFix.newValue === "boolean") settings.autofix = changes.rsAutoFix.newValue;
    if (changes.rsBgMode && typeof changes.rsBgMode.newValue === "boolean") settings.bg = changes.rsBgMode.newValue;
    renderSettings();
  });
} catch {}

getEngine().then(renderEngine);
try {
  const locale=globalThis.synerixcodeI18n;
  locale?.mountStatic(document.body);
  locale?.mountPicker(document.getElementById('popup-language-picker'),{value:'en',onChange:async value=>{await chrome.storage.local.set({rsLanguage:value});}});
  locale?.onChange(value=>{document.documentElement.lang=value;document.documentElement.dir=locale.languages.find(x=>x.code===value).dir;});
} catch {}
loadSettings();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "rs-status") refresh();
  if (msg && msg.type === "rs-engine" && msg.engine) renderEngine(msg.engine);
});
// Styled, keyboard-accessible effort menu. The original select remains the state/event contract.
function synerixcodeMountEffortPicker(select){
 if(!select||select.tagName!=='SELECT')return null;if(select._ultraPicker)return select._ultraPicker;
 const wrap=document.createElement('div');wrap.className='pc-effort-picker';select.before(wrap);wrap.append(select);select.hidden=true;
 const trigger=document.createElement('button');trigger.type='button';trigger.className='pc-effort-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
 const label=document.createElement('span'),arrow=document.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');trigger.append(label,arrow);
 const panel=document.createElement('div');panel.className='pc-effort-options';panel.hidden=true;panel.setAttribute('role','listbox');panel.setAttribute('aria-label','Reasoning effort');
 const options=Array.from(select.options).map(option=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.tabIndex=-1;button.dataset.value=option.value;const text=document.createElement('span');text.textContent=option.textContent;text.classList.toggle('pc-ultra-label',option.value==='ultracode');button.append(text);button.onclick=()=>choose(option.value);panel.append(button);return button;});
 wrap.append(trigger,panel);
 function refresh(){const value=select.value,text=Array.from(select.options).find(o=>o.value===value)?.textContent||'Default';if(label.textContent!==text)label.textContent=text;label.classList.toggle('pc-ultra-label',value==='ultracode');trigger.disabled=select.disabled;trigger.setAttribute('aria-label','Reasoning effort: '+text);for(const b of options)b.setAttribute('aria-selected',String(b.dataset.value===value));}
 function close(focus=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
 function open(index){refresh();if(trigger.disabled)return;const rect=trigger.getBoundingClientRect();wrap.toggleAttribute('data-open-up',innerHeight-rect.bottom<260&&rect.top>260);panel.hidden=false;trigger.setAttribute('aria-expanded','true');(options[index]||options.find(b=>b.dataset.value===select.value)||options[0])?.focus();}
 function choose(value){if(panel.hidden)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();close(true);}
 trigger.onclick=()=>panel.hidden?open():close();trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();open(e.key==='Home'?0:e.key==='End'?options.length-1:undefined);}};
 panel.onkeydown=e=>{const index=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='Tab')close();else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(index>=0)choose(options[index].dataset.value);}};
 const outside=e=>{if(!wrap.contains(e.target))close();};document.addEventListener('pointerdown',outside);select.addEventListener('change',refresh);
 const timer=setInterval(()=>{if(!wrap.isConnected){clearInterval(timer);document.removeEventListener('pointerdown',outside);return;}refresh();},500);refresh();
 return select._ultraPicker={refresh,close};
}

synerixcodeMountEffortPicker(document.getElementById("reasoning-level"));

refresh();
setInterval(refresh, 2000);

