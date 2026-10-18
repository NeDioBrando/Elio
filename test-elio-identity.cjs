// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
// Git on Windows may check text out as CRLF. Compare logical source, not checkout bytes.
const normalizeEol=s=>s.replace(/\r\n/g,'\n');
const read=f=>normalizeEol(fs.readFileSync(f,'utf8')),source=read('core/config.js'),main=read('core/main.js'),scope=JSON.parse(read('tools/identity-scope.json'));
// A baseline hash taken after mechanical product renaming and ready-text update.
// Removing ONLY the short new identity sentence must reproduce that exact source.
const withoutIdentity=s=>normalizeEol(s).split(scope.identity_line).join('').split(scope.compact_ack_line).join('').replace('return `Elio project connection','return `elio project connection');
const promptHash=s=>crypto.createHash('sha256').update(withoutIdentity(s)).digest('hex');
assert.equal(promptHash(source),scope.config_without_identity_sha256,'No unrelated prompt edits');
assert.equal(promptHash(source.replace(/\n/g,'\r\n')),scope.config_without_identity_sha256,'CRLF checkout must preserve the prompt-scope check');
assert.notEqual(promptHash(source+'\n// unrelated edit'),scope.config_without_identity_sha256,'Real content changes must still be detected');
const ctx={window:{__rsThinkingLevel:()=> 'default'},console};vm.createContext(ctx);vm.runInContext(source+';this.config=RS;',ctx);
assert.equal(ctx.config.APP_NAME,'Elio');
for(const opts of [{engine:'roblox'},{engine:'local'},{engine:'local',fullAccess:true},{engine:'roblox',maxChars:1},{providerId:'notion',engine:'roblox'},{providerId:'notion',engine:'local'}]){
 const p=ctx.config.buildSystemPrompt(opts);assert(p.includes("You are Elio, the user's AI assistant."),JSON.stringify(opts));
 assert(p.includes('list_commands'));assert(!new RegExp(['synerix'+'code','plaz'+'code'].join('|'),'i').test(p));
 if(opts.providerId!=='notion')assert(p.includes('Elio is ready to assist you.'));
}
const start=main.indexOf('      const readyOk ='),end=main.indexOf('      diag("start.readyReply"',start);assert(start>=0&&end>start);
for(const id of ['chatgpt','notion','deepseek','claude'])for(const [text,ok]of [['Elio is ready to assist you.',true],['Elio is ready to assist you',true],['ELIO_READY',true],['{"command":"delete_path"}',false],['Elio is ready to assist you. {"command":"x"}',false],['Not ready',false]]){
 const c={readyRes:{kind:'text'},readyText:text,P:{id}};vm.createContext(c);vm.runInContext(main.slice(start,end)+'this.ok=readyOk;',c);assert.equal(c.ok,ok,id+': '+text);
}
assert(main.includes('Reply with exactly "Elio is ready to assist you."'));
assert(read('providers/notion.js').includes('content:"Elio is ready to assist you."'));
for(const f of ['core/config.js','core/main.js','providers/notion.js'])assert.equal(read(f),read('elio-Extension/'+f));
console.log('PASS identity: Elio in Roblox/local/compact/Notion prompts; exact ready text; real handshake accepts requested acknowledgement, rejects commands; LF/CRLF prompt-scope hash unchanged; real edits detected; extension parity.');
