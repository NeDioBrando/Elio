const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let level='ultracode';const c=vm.createContext({window:{__rsThinkingLevel:()=>level}});
vm.runInContext(fs.readFileSync('core/ultracode-deepseek.js','utf8')+'\n'+fs.readFileSync('core/ultracode.js','utf8')+'\n'+fs.readFileSync('core/config.js','utf8')+';this.mode=elioUltracode;this.config=RS;',c);
const names=['server-authority','docs-lookup','toolbox','project-layout','map-placement','tunables-config','remote-events','roblox-gotchas','review-for-exploits','datastore-safety','client-ui-safety','luau-accuracy','report-what-you-verified'];
const selected=c.config.buildSystemPrompt({engine:'roblox',providerId:'deepseek'});
for(const name of names)assert(selected.includes('技能：'+name));
for(const rule of ['用户最近一条真实请求的语言','UpdateAsync','加载失败不保存默认值','得到回答前不写代码','不重复询问已批准','Stop Play','反引号字符串插值','启动握手不是项目任务','复用当前有效','每次回复仅一个可执行命令'])assert(selected.includes(rule),rule);
for(const provider of ['notion','chatgpt','claude','gemini',undefined]){const p=c.config.buildSystemPrompt({engine:'roblox',providerId:provider});assert(!p.includes('DeepSeek 专用'));assert(p.includes('Skill: server-authority'));}
assert(!c.config.buildSystemPrompt({engine:'local',providerId:'deepseek'}).includes('DeepSeek 专用'));
for(const effort of ['default','low','mid','high','max']){level=effort;assert(!c.config.buildSystemPrompt({engine:'roblox',providerId:'deepseek'}).includes('ULTRACODE (BETA)'));}
level='ultracode';const first=c.mode.turn('roblox','deepseek','chat-1');assert(first.includes('技能：datastore-safety'));
// Merely constructing a prompt does not mark an undelivered policy as sent.
assert.equal(c.mode.turn('roblox','deepseek','chat-1'),first);
c.mode.confirm('unrelated feedback','roblox','deepseek','chat-1');assert.equal(c.mode.turn('roblox','deepseek','chat-1'),first);
c.mode.confirm(first,'roblox','deepseek','chat-1');assert(c.mode.turn('roblox','deepseek','chat-1').length<200);assert.equal(c.mode.turn('roblox','deepseek','chat-2'),first);
const manifest=JSON.parse(fs.readFileSync('manifest.json'));
for(const entry of manifest.content_scripts.filter(e=>e.js.includes('core/ultracode.js')))assert(entry.js.indexOf('core/ultracode-deepseek.js')<entry.js.indexOf('core/ultracode.js'));
assert.equal(fs.readFileSync('core/ultracode-deepseek.js','utf8'),fs.readFileSync('elio-Extension/core/ultracode-deepseek.js','utf8'));
console.log(`PASS DeepSeek-only Roblox Ultracode, all 13 skills, user-language rule, plan checkpoint, global/local isolation, selection-only activation and delivery-confirmed short reminders. DeepSeek method pack: ${first.length} characters.`);
