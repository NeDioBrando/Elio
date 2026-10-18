const fs=require('fs');const {chromium}=require('playwright');
(async()=>{
 const original=fs.readFileSync('agent/src/desktop.html','utf8');
 const themeScript='function Byid(id){return document.getElementById(id)};'+original.slice(original.indexOf('  var Desktopthemes ='),original.indexOf('  function Saveappearance()'));
 const html=original.replaceAll('__ELIO_VERSION__','1.22.1').replace(/<script>[\s\S]*?<\/script>/g,'');
 const mcpScript='var State={servers:[{id:"blender",alive:true,tools:30}],mcp_alive:true};var PendingMcp={};function Escape(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;")};function Toarray(n){return [...n]};function Refresh(){return Promise.resolve()};function Showerror(e){throw e};function Api(path){return Promise.resolve(path==="/api/mcp/catalog"?{servers:[{id:"blender",name:"Blender",enabled:true,command:"uvx",args:["blender-mcp"],description:"Install and enable the Blender MCP addon inside Blender. Keep Blender open, press N, open MCP for Blender, and click Start MCP Server. Enabling here starts the MCP process only; Test Blender connection checks the actual scene response."}]}:{ok:false,error:"Blender did not answer get_scene_info within 8 seconds. Keep Blender open and responsive, close blocking dialogs, then stop and start the MCP server in Blender."})};'+original.slice(original.indexOf('  var Blendercheck ='),original.indexOf('  function Renderlogs()'));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.setContent(html);
 await page.addScriptTag({content:themeScript});
 await page.addScriptTag({content:mcpScript});await page.evaluate(()=>Loadcatalog());
 await page.evaluate(()=>Applyappearance({theme:'default'})); await page.addScriptTag({content:['core/headless-builder.js','core/creator.js','core/creator-ui.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n')+'\nwindow.CreatorUI=elioCreatorUI;'});
 await page.evaluate(async()=>{
  const api=async()=>({ok:true,records:[],feedback:[],text:'Action complete'}),send=async()=>({ok:true}),control=()=>({canTaskSend:true,engine:'roblox'});
  window.ModelWorkspace=CreatorUI.mount(document.getElementById('modelWorkspace'),api,send,send,send,control,{mode:'model'});
  window.UiWorkspace=CreatorUI.mount(document.getElementById('uiWorkspace'),api,send,send,send,control,{mode:'ui'});
  window.KitWorkspace=elioToolkitUI.mount(document.getElementById('toolkitWorkspace'),api,send,()=>({roblox_connected:true,browser_agent:control()}),()=>{});
  window.NoticeWorkspace=elioNotifications.mount(document.getElementById('notificationCenter'),{getItem:()=>null,setItem:()=>{}});
  await Promise.all([ModelWorkspace.refresh(),UiWorkspace.refresh(),KitWorkspace.refresh()]);
 });

 fs.mkdirSync('visual-checks',{recursive:true});
 for(const width of [1440,1024,760]){
  await page.setViewportSize({width,height:960});
  for(const name of ['home','settings','tools','mcp','models','ui','toolkit']){
   await page.evaluate(name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+name));document.querySelectorAll('.navbtn[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===name));},name);
   await page.screenshot({animations:"disabled",path:`visual-checks/${name}-${width}.png`});
   const overflow=await page.evaluate(()=>{const n=document.getElementById('content');return n.scrollWidth>n.clientWidth+1});
   if(overflow)throw Error(`${name} overflows at ${width}`);
  }
 }
 for(const width of [1440,1024,760]) {
  await page.setViewportSize({width,height:1100});
  for(const theme of ['default','ocean','orchid']) {
   await page.evaluate(theme=>{Applyappearance({theme});document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-home'));document.getElementById('homeSupportedAis').open=true;document.getElementById('content').scrollTop=0;},theme);
   await page.locator('#homeSupportedAis').scrollIntoViewIfNeeded();
   const failure=await page.evaluate(()=>{
    const card=document.getElementById('homeSupportedAis'),rect=card.getBoundingClientRect(),buttons=[...card.querySelectorAll('.supported-ai-link')].map(n=>n.getBoundingClientRect()),tasks=document.getElementById('homeTasks').getBoundingClientRect();
    if(card.querySelectorAll('.supported-ai-logo').length!==12)return 'Missing AI artwork';
    for(const svg of card.querySelectorAll('.supported-ai-logo')){const b=svg.getBoundingClientRect();if(b.width!==28||b.height!==28)return 'Incorrect icon frame';for(const image of svg.querySelectorAll('image')){if(!image.getAttribute('href').startsWith('data:image/png;base64,'))return 'External icon dependency';}}
    if(buttons.length!==14||tasks.top<rect.bottom+8)return 'Card order/spacing';
    if(buttons.some(b=>b.left<rect.left||b.right>rect.right||b.width<100))return 'Button width';
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i],b=buttons[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)return 'Buttons overlap';}
    const content=document.getElementById('content');return content.scrollWidth>content.clientWidth+1?'Horizontal overflow':null;
   });if(failure)throw Error('Supported AI layout '+theme+' '+width+': '+failure);
   await page.screenshot({animations:'disabled',path:`visual-checks/supported-ais-${theme}-${width}.png`});
  }
 }
 await page.evaluate(()=>{document.getElementById('homeSupportedAis').open=false;document.getElementById('content').scrollTop=0;});
 for(const width of [1440,1024,760]){
  await page.setViewportSize({width,height:800});
  for(const theme of ['default','ocean','orchid'])for(const name of ['models','ui','toolkit','mcp']){
   await page.evaluate(({theme,name})=>{Applyappearance({theme});document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+name));document.querySelectorAll('.navbtn[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===name));document.getElementById('content').scrollTop=0;},{theme,name});
   const errors=await page.evaluate(name=>{
    const root=document.getElementById('page-'+name),buttons=[...root.querySelectorAll('button')].filter(n=>n.checkVisibility()).map(n=>Object.assign(n.getBoundingClientRect().toJSON(),{label:n.textContent})).filter(r=>r.width>1&&r.height>1),content=document.getElementById('content');
    if(content.scrollWidth>content.clientWidth+1)return 'Horizontal overflow';
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i],b=buttons[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)return 'Button overlap: '+a.label+' / '+b.label;}
    const nav=document.querySelector('.nav'),status=document.querySelector('.side-status'),n=nav.getBoundingClientRect(),s=status.getBoundingClientRect();if(s.width>0&&n.bottom>s.top+1)return 'Sidebar overlap';return null;
   },name);if(errors)throw Error(name+' '+width+' '+theme+' '+errors);
   await page.screenshot({animations:'disabled',path:`visual-checks/${name}-${theme}-${width}.png`});
  }
  await page.evaluate(()=>{NoticeWorkspace.add('Roblox Studio connected','Studio tools are ready for the open place.','success','connected');NoticeWorkspace.add('Toolkit action complete','The last requested action completed.','success','toolkit');NoticeWorkspace.setOpen(true);});
  const bounds=await page.locator('.pc-notice-panel').boundingBox();if(bounds.x<0||bounds.x+bounds.width>width+1||bounds.y+bounds.height>800)throw Error('Notification panel overflow');
  await page.screenshot({animations:'disabled',path:`visual-checks/notifications-${width}.png`});await page.evaluate(()=>NoticeWorkspace.setOpen(false));
 }
 await page.setViewportSize({width:1440,height:960});
 for(const theme of ['ocean','copper','aurora','orchid','solar']){
  await page.evaluate(theme=>{Applyappearance({theme});document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-home'));},theme);
  await page.screenshot({animations:"disabled",path:`visual-checks/theme-${theme}.png`});
 }
 for(const deviceScaleFactor of [1,2]) {
  const sample=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor});
  await sample.setContent(html);await sample.addScriptTag({content:themeScript});
  for(const theme of ['default','ocean','orchid']) {
   for(const active of [false,true]) {
    await sample.evaluate(({theme,active})=>{Applyappearance({theme});document.querySelectorAll('.navbtn[data-page]').forEach(n=>n.classList.toggle('active',active&&n.dataset.page==='settings'));},{theme,active});
    const setting=sample.locator('.navbtn[data-page="settings"]');
    await setting.screenshot({animations:'disabled',path:`visual-checks/settings-icon-${theme}-${active?'selected':'idle'}-${deviceScaleFactor}x.png`});
   }
  }
  await sample.close();
 }
 for(const name of ['home','templates','settings']){
  const icon=page.locator('.navbtn[data-page="'+name+'"] svg');
  await icon.evaluate(n=>{n.style.width='96px';n.style.height='96px'});
  await icon.screenshot({path:`visual-checks/icon-${name}.png`});
 }

 await page.evaluate(()=>document.querySelectorAll(".navbtn svg").forEach(n=>{n.style.width="";n.style.height="";}));
 await page.setViewportSize({width:1440,height:1100});

 await page.evaluate(async()=>{window.CreatorWorkspace=window.ModelWorkspace;await CreatorWorkspace.refresh();});
 for(const width of [1440,1024,760]) {
  await page.setViewportSize({width,height:1100});
  for(const theme of ['default','ocean','orchid']) {
   await page.evaluate(theme=>{Applyappearance({theme});document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-models'));document.getElementById('content').scrollTop=0;},theme);
   await page.screenshot({animations:'disabled',path:`visual-checks/guided-creator-${theme}-${width}.png`});
   const overlap=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('.page.active .pc-create-editor button')].filter(n=>n.checkVisibility());return nodes.some((n,i)=>i>0 && n.getBoundingClientRect().top<nodes[i-1].getBoundingClientRect().bottom+5) && innerWidth>1000;});if(overlap)throw Error('Creator buttons overlap or lack spacing');
   const overflow=await page.evaluate(()=>{const n=document.getElementById('content');return n.scrollWidth>n.clientWidth+1});if(overflow)throw Error('Guided creator horizontal overflow');
   await page.evaluate(()=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-settings'));document.querySelector('.settings-guide').open=true;document.getElementById('content').scrollTop=0;});
   await page.screenshot({animations:'disabled',path:`visual-checks/settings-guide-${theme}-${width}.png`});
   const control=await page.locator('#savedChatsSelect').evaluate(n=>({background:getComputedStyle(n).backgroundColor,scheme:getComputedStyle(n).colorScheme}));if(control.background==='rgb(255, 255, 255)' || control.scheme!=='dark')throw Error('Unstyled saved-chat selector');
   await page.locator('[data-pref="rsToolBudget"]').scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`visual-checks/execution-help-${theme}-${width}.png`});
  }
 }
 const cards=await browser.newPage({viewport:{width:720,height:580}});await cards.setContent('<html><body style="margin:24px;background:#11151c;color:#e7edf6"><div id="rs-menu"><div class="rs-prompt-field"><label>Commands per run</label><input type="number" value="0"><select><option>Saved chat</option></select><button>Save continuation file</button><button>Resume paused task</button></div></div><p>This explanation should remain visible after a tool result.</p><div class="rs-chip"><div class="rs-chip-head"><span class="rs-chip-ic">✓</span><span class="rs-chip-tx">execute_luau</span><span class="rs-chip-dt">complete</span></div></div><div class="rs-chip"><div class="rs-chip-head"><span class="rs-chip-ic">✓</span><span class="rs-chip-tx">execute_luau · result</span></div></div></body></html>');await cards.addStyleTag({content:fs.readFileSync('overlay.css','utf8')});await cards.addStyleTag({content:'#rs-menu{position:static!important;opacity:1!important;transform:none!important;filter:none!important;visibility:visible!important;inset:auto!important;width:100%!important;max-width:none!important;margin:0 0 24px!important}'});await cards.screenshot({path:'visual-checks/extension-controls-command-spacing.png'});const geometry=await cards.locator('.rs-chip').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));if(geometry[1].top<geometry[0].bottom+8)throw Error('Command cards overlap');await cards.close();
 await page.emulateMedia({reducedMotion:'reduce'});
 const motion=await page.locator('.page.active').evaluate(n=>getComputedStyle(n).animationName);if(motion!=='none')throw Error('Reduced motion was ignored');
 const barSource=fs.readFileSync('core/main.js','utf8');
 const barHtml=barSource.slice(barSource.indexOf('<div id="rs-bar">'),barSource.indexOf('<div id="rs-cowork-panel"')).replace(/\$\{BRAND_NAME\}/g,'elio').replace(/\$\{EXT_VERSION\}/g,'1.19.32');
 const sample=await browser.newPage();
 await sample.setContent('<style>body{background:#11151c;margin:20px}.host{max-width:740px;margin:auto}.site-turn{margin:0;text-align:right}p{color:#eee}</style><main class="host"><article class="site-turn"><div class="rs-chip err"><div class="rs-chip-head"><span class="rs-chip-tx">execute_luau · ERROR: '+('Long error text ').repeat(30)+'</span><span class="rs-chip-dt">failed</span></div></div></article><article class="site-turn rs-hidden"><div class="rs-chip result"><div class="rs-chip-head"><span class="rs-chip-tx">execute_luau · result</span></div></div></article><article class="site-turn rs-hidden"><div class="rs-chip err"><div class="rs-chip-head"><span class="rs-chip-tx">result · '+('Wrapped error ').repeat(15)+'</span></div></div></article><p>Connecting a few dots</p><section class="rs-cowork-receipt"><strong>Co-work follow-up · Sent to AI</strong><div>Keep this exact follow-up visible</div></section></main><div id="rs-root">'+barHtml+'</div>');
 await sample.addStyleTag({content:fs.readFileSync('overlay.css','utf8')});
 await sample.addScriptTag({content:fs.readFileSync('core/version.js','utf8')+'\nwindow.VersionUI=elioVersion;'});
 await sample.evaluate(()=>{const bar=document.getElementById('rs-bar');bar.style.position='relative';bar.style.width='100%';});
 for(const width of [1440,760,390]){
  await sample.setViewportSize({width,height:1000});
  for(const engine of ['Chrome/140','Chrome/140 Edg/140','Brave']){
   await sample.evaluate(async engine=>{await VersionUI.detectBrowser(engine==='Brave'?{userAgentData:{brands:[{brand:'Brave'}]}}:{userAgent:engine});VersionUI.render(document.getElementById('rs-bar-version'),'1.19.36',{latest:'1.19.37',checked_at:Date.now()});},engine);
   const error=await sample.evaluate(()=>{
    const chips=[...document.querySelectorAll('.rs-chip')].map(n=>n.getBoundingClientRect());
    for(let i=1;i<chips.length;i++)if(chips[i].top-chips[i-1].bottom<9)return 'Result cards touch/overlap';
    const bar=document.getElementById('rs-bar');if(bar.scrollWidth>bar.clientWidth+1)return 'Outdated bar overflows';
    const buttons=[...bar.querySelectorAll('button')].filter(n=>n.checkVisibility()).map(n=>n.getBoundingClientRect());
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i],b=buttons[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)return 'Bar buttons overlap';}
    return null;
   });if(error)throw Error(width+' '+engine+': '+error);
   await sample.screenshot({path:'visual-checks/chat-spacing-'+width+'-'+(engine.includes('Edg')?'edge':engine==='Brave'?'brave':'chrome')+'.png'});
  }
 }
 const settingsStart=barSource.indexOf('<div class="rs-prompt-field rs-execution-settings"');
 const settingsEnd=barSource.indexOf('<div class="rs-prompt-field"><label for="rs-stop-mode">',settingsStart);
 const settingsHtml=barSource.slice(settingsStart,settingsEnd).replace(/\$\{reliabilitySettings\.rsToolBudget\}/g,'0').replace(/\$\{reliabilitySettings\.rsTaskMinutes\}/g,'30').replace(/\$\{reliabilitySettings\.rsVisualCheck\?'checked':''\}/g,'checked');
 await sample.setContent('<div id="rs-menu"><section class="rs-menu-sec">'+settingsHtml+'</section></div>');
 await sample.addStyleTag({content:fs.readFileSync('overlay.css','utf8')});
 await sample.evaluate(()=>{const menu=document.getElementById('rs-menu');menu.style.cssText='position:relative;inset:auto;width:100%;max-height:none;box-sizing:border-box;filter:none;opacity:1;transform:none;visibility:visible';document.body.style.cssText='margin:16px;background:#111923;color:#edf3ff';});
 for(const width of [390,760]){
  await sample.setViewportSize({width,height:1100});
  const error=await sample.evaluate(()=>{
   const root=document.querySelector('.rs-execution-settings');if(!root)return 'Execution group missing';
   const children=[...root.children].map(n=>n.getBoundingClientRect());
   for(let i=1;i<children.length;i++)if(children[i].top-children[i-1].bottom<10)return 'Execution rows touch';
   for(const row of root.querySelectorAll('.rs-execution-limit')){const a=row.querySelector('label').getBoundingClientRect(),b=row.querySelector('input').getBoundingClientRect();if(b.left-a.right<10)return 'Number label overlaps input';}
   const buttons=[...root.querySelectorAll('button')].map(n=>n.getBoundingClientRect());const a=buttons[0],b=buttons[1];if(a.bottom>b.top&&b.left-a.right<9)return 'Continuation buttons overlap';
   return root.scrollWidth>root.clientWidth+1?'Execution settings overflow':null;
  });if(error)throw Error(width+': '+error);
  await sample.screenshot({path:'visual-checks/execution-bar-settings-'+width+'.png'});
 }
 await sample.setContent('<style>body{background:#111923;color:#edf3ff;margin:20px}main{max-width:700px;margin:auto}pre{margin:0}</style><div id="rs-root"></div><main><article data-agent-service-scroll-anchor="one"><pre data-block-id="one">{"command":"execute_luau"}</pre></article><article data-agent-service-scroll-anchor="two"><pre data-block-id="two">{"command":"execute_luau"}</pre></article></main>');
 await sample.addScriptTag({content:fs.readFileSync('providers/notion.js','utf8')+';window.NotionCards=RSProvider;'});
 await sample.evaluate(()=>{const rows=document.querySelectorAll('article');NotionCards.renderImmutableChip(rows[0],{label:'execute_luau',phase:'done',detail:'Finished successfully',owned:true});NotionCards.renderImmutableChip(rows[1],{label:'execute_luau',phase:'run',detail:'Running in Studio',owned:true});});
 for(const width of [390,760]){
  await sample.setViewportSize({width,height:600});
  const error=await sample.evaluate(()=>{
   const nodes=[...document.querySelectorAll('pre')],a=nodes[0].getBoundingClientRect(),b=nodes[1].getBoundingClientRect();
   const upper=getComputedStyle(nodes[0]),lower=getComputedStyle(nodes[1]);
   if(b.top-a.bottom+parseFloat(upper.paddingBottom)+parseFloat(lower.paddingTop)<15)return 'Notion pseudo cards touch';
   if(!getComputedStyle(nodes[0],'::before').content.includes('Finished successfully'))return 'Notion final status missing';
   return document.documentElement.scrollWidth>innerWidth?'Notion cards overflow':null;
  });if(error)throw Error(width+': '+error);
  await sample.screenshot({path:'visual-checks/notion-tool-spacing-'+width+'.png'});
 }
 await sample.close();
 await page.addScriptTag({path:'core/clarification.js'});
 await page.evaluate(()=>{
  const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=original.call(this,options);if(this.id==='rs-clarification-host')window.ClarificationShadow=root;return root;};
  window.ClarificationPanel=elioClarification.create({document,context:()=> 'visual-chat|roblox',provider:()=> 'Claude',mount:()=>document.body});
 });
 for(const width of [320,390,760,1440])for(const theme of ['default','ocean','orchid']){
  await page.setViewportSize({width,height:900});
  await page.evaluate(theme=>{
   Applyappearance({theme});
   document.documentElement.style.setProperty('--pc-accent',Desktopthemes[theme].accent);
   document.documentElement.style.setProperty('--pc-bg',Desktopthemes[theme].bg);
   ClarificationPanel.request({question:'Which scope should the interface update cover?',options:[{id:'focused',label:'Improve the current screen',scope:'Keep existing functionality and refine the layout, spacing, typography and interaction on the current screen.'},{id:'complete',label:'Update all existing screens',scope:'Extend the same visual improvements across the app while preserving every existing control and workflow.'},{id:'prototype',label:'Review a design first',scope:'Create a visual preview before changing the current interface.'}],recommended_id:'focused',recommendation:'Start with a focused improvement so the existing design and functionality stay easy to review.',questions:['Which screen should be updated first?','Which parts of the current design should stay?']}).catch(()=>{});
  },theme);
  const failure=await page.evaluate(()=>{
   const root=ClarificationShadow,panel=root.querySelector('.panel');
   if(panel.scrollWidth>panel.clientWidth+1)return 'Clarification panel overflows';
   const buttons=[...root.querySelectorAll('.actions button')].map(node=>node.getBoundingClientRect());
   if(buttons.some(rect=>rect.top<0||rect.bottom>innerHeight))return 'Answer/cancel controls are offscreen';
   if(buttons.length!==2||buttons[1].left-buttons[0].right<10)return 'Clarification actions touch or overlap';
   if(root.querySelectorAll('.option').length!==3||root.querySelector('input:checked'))return 'Options missing or automatically selected';
   if(root.querySelector('h2').textContent!=='Claude is asking you…')return 'Provider heading mismatch';
   const rows=[...root.querySelectorAll('.option')].map(node=>node.getBoundingClientRect());
   for(let index=1;index<rows.length;index++)if(rows[index].top-rows[index-1].bottom<10)return 'Scope options touch or overlap';
   return null;
  });if(failure)throw Error(width+' '+theme+': '+failure);
  await page.screenshot({animations:'disabled',path:'visual-checks/clarification-'+theme+'-'+width+'.png'});
  await page.evaluate(()=>ClarificationPanel.cancel());
 }
 await browser.close();console.log('Desktop, chat and clarification panel visual checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
