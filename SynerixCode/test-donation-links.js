const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),main=fs.readFileSync('core/main.js','utf8');
const expected=[
 [50,'2025206972','https://www.roblox.com/game-pass/2025206972/synerixcode-small-donation'],
 [100,'2026664687','https://www.roblox.com/game-pass/2026664687/synerixcode-medium-donation'],
 [500,'2025386949','https://www.roblox.com/game-pass/2025386949/synerixcode-Large-Donation'],
 [1000,'2026352931','https://www.roblox.com/game-pass/2026352931/synerixcode-Massive-Donation-much-love']];
const array=main.match(/const ROBUX_PASSES = \[[\s\S]*?\n  \];/)[0];
const render=main.slice(main.indexOf('      let passes = "";'),main.indexOf('      const esc = (s) =>',main.indexOf('      let passes = "";')));
const html=vm.runInNewContext(array+'\n'+render+'\npasses');
const doc=new JSDOM(html).window.document,buttons=[...doc.querySelectorAll('.rs-tip-rbx')];
assert.equal(buttons.length,4);
for(let i=0;i<4;i++){const [amount,id,url]=expected[i],b=buttons[i],label=amount.toLocaleString('en-US')+' Robux';assert.equal(b.dataset.u,url);assert.equal(b.dataset.pass,id);assert.equal(b.querySelector('.rs-rbx-amt').textContent,label);assert.equal(b.getAttribute('aria-label'),'Donate '+label);}
assert(!main.includes('fillRobuxPrices'),'no failed network lookup may erase configured amount');
assert(!/1941228530|1941336506|1940736510|1941672495/.test(main),'old donation links removed');
assert.equal(main,fs.readFileSync('synerixcode-Extension/core/main.js','utf8'));
console.log('PASS all four exact donation URLs and immediately readable amounts in shared bar settings');
const htmlSource=fs.readFileSync('agent/src/desktop.html','utf8'),rust=fs.readFileSync('agent/src/gui.rs','utf8');
const desktop=new JSDOM(htmlSource),nav=[...desktop.window.document.querySelectorAll('.navbtn')].map(n=>n.dataset.page);
assert.equal(nav[nav.indexOf('templates')+1],'donations');assert.equal(nav[nav.indexOf('donations')+1],'terminal');
const entries=[...desktop.window.document.querySelectorAll('#page-donations .donation-entry')];assert.equal(entries.length,4);
for(let i=0;i<4;i++){const [amount,id,url]=expected[i],entry=entries[i],key=['small','medium','large','massive'][i],label=['Small','Medium','Large','Massive'][i],a=entry.querySelector('a');assert(entry.querySelector('h2').textContent.startsWith(label+' Donation:'));assert.equal(entry.querySelector('.donation-amount').textContent,amount.toLocaleString('en-US')+' Robux');assert.equal(a.href,url);assert.equal(a.textContent,url);assert.equal(a.target,'_blank');assert.equal(a.dataset.ipc,'open:donation-'+key);assert(a.rel.includes('noopener'));assert(rust.includes('"open:donation-'+key+'" => Some("'+url+'")'));}
assert(rust.includes('donation_url(body).or_else(|| supported_ai_url(body))'));
assert(rust.includes('std::process::Command::new("rundll32.exe")')&&rust.includes('std::process::Command::new("/usr/bin/open")'),'reuse native OS default-browser dispatch');
const start=htmlSource.indexOf('    Toarray(document.querySelectorAll("[data-ipc]"))'),end=htmlSource.indexOf('    var Dragbar =',start),binding=htmlSource.slice(start,end);
const ipcStart=htmlSource.indexOf('  function Ipc(Message)'),ipcEnd=htmlSource.indexOf('  var Notificationui=',ipcStart),ipcCode=htmlSource.slice(ipcStart,ipcEnd);
for(const native of [false,true]){
 const dom=new JSDOM(htmlSource,{runScripts:'outside-only'}),calls=[];if(native)dom.window.ipc={postMessage:m=>calls.push(m)};
 dom.window.eval('function Toarray(v){return Array.from(v);}\n'+ipcCode+'\n'+binding);
 for(const a of dom.window.document.querySelectorAll('#page-donations a')){const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true});a.dispatchEvent(event);assert.equal(event.defaultPrevented,native,'native IPC intercepts navigation; browser-hosted dashboard retains actual href');}
 assert.deepEqual(calls,native?['small','medium','large','massive'].map(x=>'open:donation-'+x):[]);dom.window.close();
}
console.log('PASS Donations page order, requested headings/URLs, amounts, safe browser fallback and native default-browser IPC');
