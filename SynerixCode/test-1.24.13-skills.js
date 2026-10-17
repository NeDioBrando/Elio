// 1.24.13: skill cards get a favourite star and delete button, the page gets
// Delete all (keeps bundled references and favourites), and the AI no longer
// floods the library with duplicate automatic candidates.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<div id="host"></div>',{runScripts:'outside-only',url:'http://localhost',pretendToBeVisual:true}),w=dom.window;w.TextEncoder=TextEncoder;
 w.eval(fs.readFileSync('core/skills-ui.js','utf8')+';window.Skills=synerixcodeSkillsUI;');
 const starters=JSON.parse(fs.readFileSync('agent/src/starter-skills-index.json','utf8'));
 const candidate=(id,title)=>({id,title,description:'Candidate from observable tool steps.',domain:'roblox',scope:'',steps:['execute_luau'],pitfalls:[],verification:[],confirmed:false,enabled:false,revision:1,community:false});
 let records=[...starters,candidate('task-1','Back up the full current map, terrain and lighting'),candidate('task-2','Planning project work'),{...candidate('skill-style','Use tabs for indentation'),enabled:true},{id:'global-workflow-x',title:'Shared lesson',description:'auto',domain:'local',scope:'',steps:['x'],pitfalls:[],verification:['y'],confirmed:true,enabled:false,revision:1,community:true}];
 const calls=[];
 const api=async r=>{calls.push(r);
  if(r.action==='list')return{ok:true,skills:JSON.parse(JSON.stringify(records))};
  if(r.action==='export')return{ok:true,skill:{...records.find(s=>s.id===r.id)}};
  if(r.action==='favorite'){const s=records.find(x=>x.id===r.id);s.favorite=r.favorite;return{ok:true,skill:{...s}};}
  if(r.action==='delete'){const s=records.find(x=>x.id===r.id);assert.equal(r.revision,s.revision);records=records.filter(x=>x.id!==r.id);return{ok:true};}
  if(r.action==='delete_all'){const before=records.length;records=records.filter(s=>s.favorite||/^(starter-syphodev-|bundled-ultragui-|global-workflow-)/.test(s.id));return{ok:true,removed:before-records.length,kept:records.length};}
  throw Error('Unexpected request '+r.action);};
 w.setInterval=()=>1;const host=w.document.getElementById('host');host.getClientRects=()=>[{}];
 const ui=w.Skills.mount(host,api,async()=>{},()=>({}),async()=>{},async()=>({tasks:[]}));
 const field=n=>host.querySelector('[data-sk="'+n+'"]'),flush=()=>new Promise(r=>setTimeout(r,15));
 const card=id=>host.querySelector('[data-sk-card="'+id+'"]');
 await ui.refresh();
 assert.equal(host.querySelectorAll('[data-sk-card]').length,records.length);
 // Every card: select button first, then star left of delete in a top-right group.
 for(const id of ['task-1','starter-syphodev-roblox-code']){const c=card(id);const buttons=[...c.querySelectorAll('button')];assert.equal(buttons.length,3);assert(buttons[1].hasAttribute('data-sk-favorite'));assert(buttons[2].hasAttribute('data-sk-remove'));assert.equal(buttons[1].parentElement.className,'sk-actions');assert.equal(buttons[1].parentElement,buttons[2].parentElement);}
 assert.match(host.innerHTML,/\.sk-actions\{position:absolute;top:8px;right:8px;display:flex;gap:12px\}/,'icons sit in the top-right corner and are spaced apart');
 assert.equal(field('delete-all').textContent,'Delete all');
 // Favourite toggles, persists through the agent and moves the card to the top.
 card('skill-style').querySelector('[data-sk-favorite]').click();await flush();
 assert.equal(JSON.stringify(calls.at(-1)),JSON.stringify({action:'favorite',id:'skill-style',favorite:true}));
 assert.equal(card('skill-style').querySelector('[data-sk-favorite]').getAttribute('aria-pressed'),'true');
 assert.equal(host.querySelector('[data-sk-card]').dataset.skCard,'skill-style','favourites are listed first');
 assert.match(card('skill-style').textContent,/Favourite/);
 // Delete needs a second click; the first only arms it.
 const del=()=>card('task-2').querySelector('[data-sk-remove]');
 del().click();await flush();assert(records.some(s=>s.id==='task-2'),'first click never deletes');assert.equal(del().textContent,'Delete?');assert.match(field('status').textContent,/again/);
 del().click();await flush();assert(!records.some(s=>s.id==='task-2'));assert.equal(card('task-2'),null);assert.match(field('status').textContent,/Deleted/);
 // Selecting a card and deleting it clears the editor.
 card('task-1').querySelector('button').click();await flush();assert.equal(field('delete').hidden,false);
 // Delete all: arm, confirm, keep starters + favourites + shared workflows.
 field('delete-all').click();await flush();assert(!calls.some(c=>c.action==='delete_all'),'first click only asks');assert.match(field('delete-all').textContent,/Confirm: delete 1 skill$/);
 field('delete-all').click();await flush();
 assert(calls.some(c=>c.action==='delete_all'));assert.equal(field('delete-all').textContent,'Delete all');
 assert(records.some(s=>s.id==='skill-style'),'favourite kept');assert(!records.some(s=>s.id==='task-1'));
 assert.equal(records.filter(s=>s.id.startsWith('starter-syphodev-')).length,11,'the 11 bundled starter skills stay');
 assert.equal(field('delete').hidden,true,'a deleted selection is cleared');assert.match(field('status').textContent,/Deleted 1 skill\. Kept/);
 field('delete-all').click();await flush();assert.match(field('status').textContent,/Nothing to delete/);assert.equal(calls.filter(c=>c.action==='delete_all').length,1);
 // Favourites can be removed again.
 card('skill-style').querySelector('[data-sk-favorite]').click();await flush();assert.equal(card('skill-style').querySelector('[data-sk-favorite]').getAttribute('aria-pressed'),'false');
 // AI side: suggestions instead of silent saving, no duplicate cards, genre-aware use.
 const main=fs.readFileSync('core/main.js','utf8'),config=fs.readFileSync('core/config.js','utf8'),rust=fs.readFileSync('agent/src/skills.rs','utf8');
 assert.match(main,/call action suggest once/);assert.match(main,/user_approved:\{type:'boolean'/);assert.match(main,/enabled:args\.user_approved===true\|\|!!previous\?\.enabled/);
 assert.match(main,/already exists \(id "\+twin\.id/);assert.match(main,/simulator and a battlegrounds game need different structure/);
 assert.match(config,/offer it once with synerixcode_skills action suggest/);
 assert.match(rust,/automatic task candidates are off/);assert.match(rust,/"delete_all"=>/);assert.match(rust,/"favorite"=>/);
 console.log('1.24.13 skills: favourites, delete, delete all and candidate limits pass');
})().catch(error=>{console.error(error);process.exit(1);});
