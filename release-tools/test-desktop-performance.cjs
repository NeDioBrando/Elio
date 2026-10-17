const {chromium,firefox}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const current=fs.readFileSync('agent/src/desktop.html','utf8');
const baseline=fs.readFileSync('../../development/1.24.2/overlay/agent/src/desktop.html','utf8');
const between=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const renderCode=text=>between(text,'  function Sourcemeta(','  var Blendercheck')+between(text,text.includes("var Recentlogsignature=")?'  var Recentlogsignature=':'  function Renderlogs()','  function Rendersettings()');
const clean=current.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const globals=`var State={tools:[],logs:[]},Toolfilter='All',Toolquery='';function Byid(id){return document.getElementById(id);}function Toarray(v){return Array.from(v);}function Escape(v){var n=document.createElement('span');n.textContent=String(v);return n.innerHTML;}`;
(async()=>{for(const [name,engine] of [['chromium',chromium],['firefox',firefox]]){
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),results={};
 for(const [label,source] of [['before',baseline],['after',current]]){
  await page.setContent(clean);await page.addScriptTag({content:globals+renderCode(source)});
  results[label]=await page.evaluate(()=>{
   document.getElementById('page-tools').classList.add('active');document.getElementById('page-terminal').classList.add('active');
   State.tools=Array.from({length:350},(_,i)=>({name:'tool '+i,source:'Roblox Studio',description:'Useful tool description '+i}));State.logs=Array.from({length:2500},(_,i)=>'INFO '+i);
   Rendertools();Renderlogs();const targets=['toolsGrid','toolFilters','terminal','recent'].map(Byid),observer=new MutationObserver(()=>{});targets.forEach(n=>observer.observe(n,{subtree:true,childList:true,attributes:true,characterData:true}));
   const start=performance.now();for(let i=0;i<40;i++){Rendertools();Renderlogs();}const milliseconds=performance.now()-start,mutations=observer.takeRecords().length;observer.disconnect();return {milliseconds,mutations};
  });
 }
 assert(results.before.mutations>0);assert.equal(results.after.mutations,0,'unchanged panels must preserve DOM, focus and expanded cards');
 await page.evaluate(()=>{const first=Byid('toolsGrid').firstChild;first.setAttribute('aria-expanded','true');first.focus();window.savedCard=first;Rendertools();});
 assert(await page.evaluate(()=>savedCard===Byid('toolsGrid').firstChild&&savedCard.getAttribute('aria-expanded')==='true'&&document.activeElement===savedCard));
 await page.evaluate(()=>{State.tools[0].description='Changed description';Rendertools();});assert(await page.locator('#toolsGrid').innerText().then(t=>t.includes('Changed description')));
 await page.evaluate(()=>{Toolquery='tool 349';Rendertools();});assert.equal(await page.locator('#toolsGrid .toolcard').count(),1);
 await page.evaluate(()=>{const t=Byid('terminal');t.scrollTop=0;window.savedLog=t.children[10];State.logs.push('WARN new line');Renderlogs();});
 assert(await page.evaluate(()=>Byid('terminal').children[10]===savedLog&&Byid('terminal').scrollTop===0));
 await page.evaluate(()=>{State.logs=State.logs.slice(5);Renderlogs();});assert(await page.evaluate(()=>Byid('terminal').children[5]===savedLog));
 await page.evaluate(()=>{State.logs=['replacement'];Renderlogs();});assert.equal(await page.locator('#terminal .logline').innerText(),'replacement');
 await page.evaluate(()=>{State.logs=[];Renderlogs();});assert.equal(await page.locator('#terminal .empty').count(),1);
 await page.evaluate(()=>{Byid('page-terminal').classList.remove('active');State.logs=['deferred'];Renderlogs();});assert.equal(await page.locator('#terminal .empty').count(),1);
 await page.evaluate(()=>{Byid('page-terminal').classList.add('active');Renderlogs();});assert.equal(await page.locator('#terminal .logline').innerText(),'deferred');
 await page.addScriptTag({content:`var PendingMcp={},calls=0;function Api(){calls++;return Promise.resolve({servers:[{id:'sample',name:'Sample',enabled:false,args:[],command:'sample',description:'Sample server'}]});}function Showerror(){}function Refresh(){return Promise.resolve();}`+between(current,'  var Blendercheck','  var Recentlogsignature=')});
 await page.evaluate(()=>{Byid('page-mcp').classList.remove('active');return Loadcatalog();});assert.equal(await page.evaluate(()=>calls),0);
 await page.evaluate(()=>{Byid('page-mcp').classList.add('active');return Promise.all([Loadcatalog(),Loadcatalog()]);});assert.equal(await page.evaluate(()=>calls),1,'concurrent catalogue calls share one request');
 await page.evaluate(()=>Loadcatalog());assert.equal(await page.evaluate(()=>calls),1,'cached catalogue avoids repeated requests');
 await page.evaluate(()=>{State.servers=[{id:'sample',alive:true,tools:7}];return Loadcatalog();});assert(await page.locator('#mcpGrid').innerText().then(t=>t.includes('7 tools available')));
 await page.evaluate(()=>{Catalogat=0;return Loadcatalog();});assert.equal(await page.evaluate(()=>calls),2);
 await page.evaluate(()=>Loadcatalog(true));assert.equal(await page.evaluate(()=>calls),3,'opening page explicitly refreshes catalogue');
 await page.evaluate(()=>document.documentElement.dataset.desktopTheme='cyan');await page.emulateMedia({reducedMotion:'reduce'});
 const colors={low:'rgb(255, 241, 168)',mid:'rgb(255, 197, 107)',high:'rgb(255, 146, 85)',max:'rgb(255, 98, 103)',ultracode:'rgb(197, 161, 249)'};
 for(const level of ['default','low','mid','high','max','ultracode']){
  await page.evaluate(level=>Rendereffort(level),level);assert.equal(await page.locator('#sidebarEffort').getAttribute('data-effort'),level);assert.equal(await page.locator('#sidebarEffort').innerText(),await page.locator('#titleEffort').innerText());
  const color=await page.locator('#titleEffort [data-effort-value]').evaluate(n=>getComputedStyle(n).color);if(level==='ultracode')assert((await page.locator('#titleEffort [data-effort-value]').evaluate(n=>getComputedStyle(n).backgroundImage)).includes('linear-gradient'),'Ultra uses gradient text');else if(colors[level])assert.equal(color,colors[level]);else assert.equal(color,await page.evaluate(()=>{const n=document.createElement('span');n.style.color='var(--orange)';document.body.appendChild(n);const c=getComputedStyle(n).color;n.remove();return c;}));
 }
 await page.evaluate(()=>document.documentElement.dataset.sidebarCollapsed='');assert(await page.locator('#titleEffort').isVisible(),'effort remains visible with collapsed navigation');
 const main=fs.readFileSync('core/main.js','utf8');await page.addStyleTag({path:'overlay.css'});await page.evaluate(()=>{const root=document.createElement('div');root.id='rs-root';root.innerHTML='<div id="rs-effort">Effort: <span>Default</span></div>';document.body.appendChild(root);});
 await page.addScriptTag({content:`var root=document.getElementById('rs-root'),thinkingLevel='default';`+between(main,'    function renderEffort()','    try {')});
 for(const level of Object.keys(colors)){await page.evaluate(level=>{thinkingLevel=level;renderEffort();},level);if(level==='ultracode')assert((await page.locator('#rs-effort span').evaluate(n=>getComputedStyle(n).backgroundImage)).includes('linear-gradient'));else assert.equal(await page.locator('#rs-effort span').evaluate(n=>getComputedStyle(n).color),colors[level]);}
 console.log(JSON.stringify({browser:name,unchangedRefreshes:40,tools:350,logLines:2500,...results,checks:'cache invalidation, incremental/rolling/cleared/hidden logs, catalogue coalescing and freshness, desktop/bar effort colors'}));await browser.close();
}})().catch(e=>{console.error(e);process.exitCode=1;});
