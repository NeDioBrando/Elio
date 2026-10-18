// 1.24.12 regressions: memory paste/import, task reference after the real tool
// result, Notion session aliases, screenshot text fallback, Notion-plain startup
// preferences, plan-then-stop, Blender busy/timeout handling, request-file wording,
// UltraGUI skill ids and the desktop auto-update toggle.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8'),notion=fs.readFileSync('providers/notion.js','utf8'),bg=fs.readFileSync('background.js','utf8');
const memory=fs.readFileSync('core/memory.js','utf8'),ultra=fs.readFileSync('core/ultracode.js','utf8');
function fn(src,name){const i=src.indexOf('function '+name+'(');assert(i>=0,name);let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&--d===0)return src.slice(i,k+1);}throw Error(name);}
// Notion-plain preferences: Markdown markers become plain text Notion will not reformat.
const ctx={RSParse:{hasOpenToolBlock:t=>/###\s*LUA|"command"\s*:/.test(t)}};vm.createContext(ctx);
const reLine=main.match(/const PLAN_APPROVAL_RE = .*;/)[0];
vm.runInContext(fn(main,'notionPlainText')+';'+reLine.replace('const ','var ')+';'+fn(main,'looksLikePlanOnly')+';this.np=notionPlainText;this.plan=looksLikePlanOnly;',ctx);
assert.equal(ctx.np('# Title\n- **Bold** item\n2. step\n> quote\n---'),'Title\n• Bold item\n(2) step\nquote\n');
assert.equal(ctx.np('a **b** c'),'a b c');
// Plan-then-stop: an approval question continues, real questions wait, answers do not match.
const steps='\n1. Create the frame\n2. Add the buttons\n3. Wire the scripts\n4. Test on mobile\n';
assert.equal(ctx.plan('## Plan\nHere is how I will build the shop UI for your game.'+steps+'\nShall I proceed?'),true);
assert.equal(ctx.plan('## Plan\nHere is how I will build the shop UI for your game.'+steps),true);
assert.equal(ctx.plan('## Plan\nHere is how I will build the shop UI for your game.'+steps+'\nWhich colour do you want?\nShould it be mobile only?'),false);
assert.equal(ctx.plan('Roblox uses Luau, a typed dialect of Lua. It is fast and runs in Studio and on servers, and it supports gradual typing for big projects too.'),false);
assert(/PLAN_APPROVAL_RE\.test\(lastLine\)/.test(main)&&/planContinues < 2/.test(main),'plan continuation bounded');
// Task reference is appended after the real command result, never before it.
assert(!/command has NOT run yet/.test(main),'no hold-back wording');
assert(/A\.pendingReference=reference/.test(main)&&/One-time task reference \(separate from the command result above/.test(main));
// Session aliases: /chat/<id> and /chat?t=<id> are the same Notion session.
assert(/conversationAliases\(\)/.test(fn(main,'sessionKnown')));
assert(/const conversationAliases = \(\) =>/.test(notion)&&/\/chat\?t=\$\{id\}/.test(notion));
assert(/rememberSession\(key\)/.test(main),'running loop chat remembered');
// Screenshot not taken by Notion: clear own draft, retry once as text with a note.
assert(/notion\.tas\.imageNotTaken/.test(notion)&&/send\.imageTextFallback/.test(main));
// Request file: first sentence kept (core/reliability.js relies on it), plain description.
assert(/The complete elio message is in the attached file \$\{name\}\./.test(notion));
assert(!notion.split('\n').some(l=>!/^\s*\/\//.test(l)&&/preserve its exact commands and instructions/.test(l)));
assert(/only because it is too long to paste/.test(notion));
// Startup tolerant match only for elio's own startup drafts.
assert(/text\.startsWith\("⟦RS-SYS⟧"\) \|\| \/\^Output of \['"\]list_commands\['"\]:\/\.test\(text\)\) draftLooksWritten\.tolerantText = text/.test(notion));
// Memory: keys stay in the note fields, Paste button, multi-file import saved as-is.
assert(/'paste'\]\) root\.addEventListener/.test(memory)&&/event\.stopPropagation\(\)/.test(memory));
assert(/data-memory-paste/.test(memory)&&/navigator\.clipboard\.readText\(\)/.test(memory));
assert(/data-memory-import/.test(memory)&&/accept="\.md,\.markdown,\.json,\.txt/.test(memory)&&/ multiple>/.test(memory));
// Blender: wait for a running command, reconnect if seen before, timeouts are not disconnects.
assert(/blenderWasConnected/.test(bg)&&/Date\.now\(\) \+ 45000/.test(bg));
const blender=fs.readFileSync('agent/src/blender.rs','utf8');
assert(/tokio::time::timeout\(Duration::from_secs\(45\),COMMAND_LOCK\.lock\(\)\)/.test(blender)&&!/COMMAND_LOCK\.try_lock/.test(blender));
// UltraGUI: GUI only, current skill ids exist in the bundle and the native index.
assert(/ScreenGui, BillboardGui and SurfaceGui/.test(ultra)&&/not for 3D models/.test(ultra));
const index=JSON.parse(fs.readFileSync('agent/src/ultragui-index.json','utf8'));
const ids=JSON.stringify(index);
for(const id of [...ultra.matchAll(/bundled-ultragui-([a-z-]+)/g)].map(m=>m[1])){
 assert(fs.existsSync('elio-Extension/ultragui/skills/'+id+'.md'),'skill file '+id);
 assert(ids.includes('bundled-ultragui-'+id)||ids.includes('"'+id+'"'),'index card '+id);
}
// Desktop auto-update toggle.
const html=fs.readFileSync('agent/src/desktop.html','utf8');
assert(/data-pref="rsAutoUpdate"/.test(html));
assert(/fn auto_updates_enabled\(/.test(fs.readFileSync('agent/src/updater.rs','utf8')));
// Ambiguous Notion send that visibly landed continues instead of stopping the turn.
assert(/send\.ambiguousLanded/.test(main)&&/P\.sendFailureAmbiguous\(\) === true && landed\(\)/.test(main));
const iA=main.indexOf('send.ambiguousLanded'),iB=main.indexOf('send.providerUnconfirmed');assert(iA>0&&iA<iB,'landed check precedes the banner');
console.log('1.24.12 fixes: ok');
