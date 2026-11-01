// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic UI transport fixture; live backend coverage is separate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{html}=require('./test-desktop-chat-ui.cjs');
const out=process.env.ELIO_TEST_OUTPUT||'/data/elio-ui-qa';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1460,height:950}}),errors=[],writes=[];
 let pin='',chat='notion|/chat?elio',fail=false,slow=false,populated=false,colorMode='dark';
 const note={id:'architecture',title:'Project architecture',category:'Engineering',status:'unreviewed',tags:['Elio','architecture'],aliases:[],evidence:['Local fixture for layout validation'],source:'Development notes',revision:1,etag:'fixture',updated:'2026-11-01',text:'## A clear boundary\n\nThe vault selection belongs to the chat, not to the project assignment.\n\n- Keep saved notes in their original vault.\n- Use explicit source labels for every context capsule.\n- Fall back to automatic routing only when the user chooses Auto.',pinned:true};
 const context=()=>({ok:true,project:'Game',vault_scope:pin||'project:Game',vault_mode:pin?'manual':'auto'});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('http://127.0.0.1:3000/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/desktop-ui')return route.fulfill({contentType:'text/html',body:html()});
  const req=route.request().postDataJSON()||{};
  let body={ok:true,preferences:{rsLanguage:'en',rsColorMode:colorMode},version:'1.0.1',servers:[],skills:[],tools:[],templates:[],tasks:[],items:[],nodes:[],checkpoints:[],logs:[],browser_agent:{canChatRead:true,canChatPin:true,canTaskSend:true,provider:'Notion',chat,browser_id:'test',tab_id:1},roblox_connected:true,bridge_connected:true,workspace_ready:true,workspace_root:'C:\\Elio',update:{current:'1.0.1',latest:'1.0.1',phase:'current'}};
  if(u.pathname==='/api/vault'&&['selection','select'].includes(req.action)){
   body=context();if(req.action==='select'){writes.push(req);if(slow)await new Promise(r=>setTimeout(r,650));if(fail)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'Selection could not be saved'})});pin=req.scope;body=context();}
  }
  if(u.pathname==='/api/vault'&&!['selection','select'].includes(req.action)){
   body={ok:true,notes:populated?[note]:[],next_offset:null,version:populated?'v2':'v1',automatic:true,nodes:[],edges:[]};
   if(req.action==='read')body={ok:true,note,backlinks:[],unresolved_links:[]};
   if(req.action==='projects')body={ok:true,projects:['project:Game','project:Elio','chat:notion|/chat?other']};
   if(req.action==='context')body={ok:true,scope:req.scope,context:[],characters:0,budget:4500};
  }
  if(u.pathname==='/api/desktop/agent')body={ok:true,chat,provider:'Notion',revision:'1',history:[{id:'u',role:'user',text:'Add a manual vault selector.'},{id:'a',role:'assistant',text:'The selected vault is isolated from the automatic project assignment.\n\nMemory reads and writes use your pinned source.'}]};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3000/desktop-ui');await page.locator('[data-page=memory]').click();
 const source=page.locator('[data-agent-source]');await source.filter({hasText:'Auto'}).waitFor();
 await page.locator('[data-project]').selectOption('project:Elio');assert.equal(await source.textContent(),'Auto · Game','browsing does not pin');
 slow=true;await page.locator('[data-pin]').click();assert(await page.locator('[data-pin]').isDisabled());await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Pinned · Elio');slow=false;
 assert.equal(writes.length,1);assert.equal(writes[0].chat,chat);assert.equal(pin,'project:Elio');
 await page.reload();await page.locator('[data-page=memory]').click();await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Pinned · Elio');
 fail=true;await page.locator('[data-unpin]').click();await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('could not be saved'));assert.equal(pin,'project:Elio');assert.equal(await source.textContent(),'Pinned · Elio');fail=false;
 await page.locator('[data-unpin]').click();await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Auto · Game');assert.equal(pin,'');
 await page.locator('[data-project]').selectOption('project:Elio');await page.locator('[data-pin]').click();await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Pinned · Elio');
 // Pin changes are visible even if the note-version fingerprint is unchanged.
 pin='';await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Auto · Game');
 pin='project:Elio';await page.waitForFunction(()=>document.querySelector('[data-agent-source]').textContent==='Pinned · Elio');
 for(const mode of ['dark','light']){colorMode=mode;await page.evaluate(m=>elioTheme.apply(m),mode);for(const width of [1460,390]){await page.setViewportSize({width,height:width===390?844:950});for(const view of ['home','memory']){await page.locator('[data-page='+view+']').click();await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,view+' document overflow');const region=page.locator('#page-'+view);assert.equal(await region.evaluate(n=>n.scrollWidth>n.clientWidth+1),false,view+' region overflow');assert.equal(await page.locator('html').getAttribute('data-elio-mode'),mode);if(view==='home'){const material=await page.locator('#page-home .hero').evaluate(n=>({filter:getComputedStyle(n).backdropFilter,fill:getComputedStyle(n).backgroundColor,edge:getComputedStyle(n).boxShadow}));assert(material.filter.includes('blur(24px)'),'visible glass material keeps backdrop blur');assert(material.fill.includes('0.46')||material.fill.includes('0.5'),'glass is translucent, not a solid recolor');assert(material.edge.includes('inset'),'glass has inset edge highlights');}await page.mouse.move(width-5,10);await page.screenshot({path:path.join(out,`${mode}-${view}-${width}.png`)});}}}
 await page.setViewportSize({width:1460,height:950});colorMode='dark';await page.evaluate(()=>elioTheme.apply('dark'));for(const view of ['settings','chat']){await page.locator('[data-page='+view+']').click();await page.waitForTimeout(350);await page.screenshot({path:path.join(out,`dark-${view}-1460.png`)});}
 populated=true;await page.locator('[data-page=memory]').click();await page.locator('#vaultWorkspace [data-refresh]').click();await page.locator('[data-tree] button').filter({hasText:'Project architecture'}).click();await page.locator('.ev-prose').waitFor();await page.screenshot({path:path.join(out,'dark-memory-note.png')});
 await page.evaluate(()=>elioI18n.setLanguage('ru'));await page.waitForFunction(()=>document.querySelector('[data-source-title]').textContent==='Источник памяти ИИ');assert.equal(await page.locator('[data-source-title]').textContent(),'Источник памяти ИИ');assert.equal(await page.locator('.ev-note > h2').textContent(),'Project architecture');await page.evaluate(()=>elioI18n.setLanguage('en'));
 await page.getByRole('button',{name:'Edit note',exact:true}).click();colorMode='light';await page.evaluate(()=>elioTheme.apply('light'));await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'light-memory-editor.png')});
 await page.locator('[aria-label=Title]').fill('Unsent edit');page.once('dialog',d=>d.dismiss());await page.locator('[data-unpin]').click();assert.equal(pin,'project:Elio','unsaved edits can cancel selection');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.page.active').evaluate(n=>getComputedStyle(n).animationName),'none');
 assert.deepEqual(errors,[]);console.log('PASS vault UI: browse vs pin, saved-chat binding, double-submit guard, persistence, failed-save rollback, Auto reset; dark/light home+memory at 1460/390px, reduced motion.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
