const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const d=new JSDOM(fs.readFileSync('agent/src/desktop.html','utf8')).window.document;
const names=['chatgpt','deepseek','claude','gemini','kimi','glm','qwen','arena','freebuff','oxalpha','notion','ollama'];
for(const name of names){const button=d.querySelector('#homeSupportedAis [data-ipc="open:'+name+'"]');const mark=button.querySelector('.supported-ai-mark');assert(mark.querySelector('svg.supported-ai-logo'),name+' must show artwork rather than initials');assert.equal(mark.textContent.trim(),'');assert(button.querySelector('strong').textContent.trim());assert(!mark.querySelector('[href^="http"]'),'Logo must work offline');}
for(const name of ['chatgpt','deepseek','claude']){const recommended=d.querySelector('.hero-ai-links [data-ipc="open:'+name+'"] svg').cloneNode(true),all=d.querySelector('#homeSupportedAis [data-ipc="open:'+name+'"] svg').cloneNode(true);recommended.removeAttribute('class');all.removeAttribute('class');assert.equal(all.outerHTML,recommended.outerHTML,name+' must reuse the existing logo');}
for(const [name,initials] of [['clickup','CU'],['crax','CR'],['useai','UA']])assert.equal(d.querySelector('#homeSupportedAis [data-ipc="open:'+name+'"] .supported-ai-mark').textContent,initials);
assert.equal(d.querySelectorAll('#homeSupportedAis .supported-ai-link').length,15);
assert.equal(d.querySelectorAll('#homeSupportedAis .supported-ai-logo').length,12);
console.log('Twelve supplied/reused offline AI logos, unchanged fallbacks, recommended-logo parity and registered link roster passed.');
