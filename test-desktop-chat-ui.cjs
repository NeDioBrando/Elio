// SPDX-License-Identifier: GPL-3.0-or-later
// Optional integration/visual tests: npm install --no-save playwright
// Uses a local mocked HTTP transport, never a real signed-in AI account.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=__dirname;
const output=process.env.ELIO_TEST_OUTPUT || process.cwd();
fs.mkdirSync(output,{recursive:true});
function html(){
 let text=fs.readFileSync(path.join(root,'agent/src/desktop.html'),'utf8');
 const tokens={I18N_CATALOG:'i18n-catalog',I18N:'i18n',SKILLS_UI:'skills-ui',EXPLORER_UI:'explorer-ui',MEDIA_UI:'media',MEMORY_UI:'memory',VAULT_UI:'vault-ui',FIGMA_UI:'figma',TOOLKIT_UI:'toolkit-ui',TASK_UI:'task-center',TEMPLATE_UI:'templates',VERSION_UI:'version',CHAT_VIEW:'chat-view'};
 for(const [token,file] of Object.entries(tokens))text=text.replace('__ELIO_'+token+'__',()=>fs.readFileSync(path.join(root,'elio-Extension/core',file+'.js'),'utf8'));
 return text.replace('__ELIO_THEME_CSS__',()=>fs.readFileSync(path.join(root,'core/theme.css'),'utf8')).replace('__ELIO_THEME_JS__',()=>fs.readFileSync(path.join(root,'core/theme.js'),'utf8')).replaceAll('__ELIO_VERSION__',require('./manifest.json').version).replaceAll('__ELIO_PAIRING_KEY__','a'.repeat(64)).replace('__ELIO_SHELL_CSS__',()=>fs.readFileSync(path.join(root,'desktop/elio.css'),'utf8')).replace('__ELIO_DESKTOP_CHAT_CSS__',()=>fs.readFileSync(path.join(root,'desktop/chat.css'),'utf8')).replace('__ELIO_DESKTOP_CHAT_JS__',()=>fs.readFileSync(path.join(root,'desktop/chat.js'),'utf8'));
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || chromium.executablePath(),args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1460,height:900}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 let control={},history=[],revision=0,fail=false,readFail=false,requests=[],live={generating:false,activity_phase:'idle'};
 const state=()=>({ok:true,browser_agent:control,preferences:{},tools:[],logs:[],servers:[],roblox_connected:true,blender_connected:false});
 await page.addInitScript(()=>{window.__ELIO_BOOT__={key:'a'.repeat(64),apiUrl:'http://127.0.0.1:3000'};});
 await page.route('http://127.0.0.1:3000/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/desktop-ui')return route.fulfill({contentType:'text/html',body:html()});
  let body={ok:true,servers:[],skills:[],tools:[],templates:[],tasks:[],items:[],checkpoints:[],preferences:{}};
  if(url.pathname==='/api/desktop/state')body=state();
  if(url.pathname==='/api/desktop/agent'){
    const req=request.postDataJSON();requests.push(req);
    if(req.action==='chat-read'){if(readFail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Temporary read outage'})});const arg=JSON.parse(req.prompt);body=arg.revision===String(revision)?{ok:true,chat:control.chat,not_modified:true}:{ok:true,chat:control.chat,provider:control.provider,revision:String(revision),history,omitted:0};body={...body,...live};}
    else if(req.action==='chat-pin'){control.pinned=req.prompt==='on';body={ok:true};}
    else if(fail)return route.fulfill({status:504,contentType:'application/json',body:JSON.stringify({ok:false,error:'Acknowledgement timeout'})});
    else if(req.action==='task-send'){history.push({id:'sent'+revision,role:'user',text:req.prompt});revision++;}
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3000/desktop-ui');
 await page.waitForSelector('#sc-chat-input');await page.waitForTimeout(1300);
 assert.equal(await page.locator('html').getAttribute('data-elio-mode'),'dark','First launch defaults to dark');
 assert.equal(await page.locator('#page-chat').evaluate(e=>e.classList.contains('active')),true);
 await page.screenshot({path:path.join(output,'elio-chat-empty.png')});
 control={canChatRead:true,canChatPin:true,canTaskSend:true,canStart:false,canStop:false,chat:'mock|first',provider:'ChatGPT',browser_id:'browser-1',tab_id:42,engine:'roblox',status:'Готов к вашему запросу.'};
 history=[{id:'u',role:'user',text:'Создай небольшую сцену с мягким вечерним светом в Roblox Studio.'},{id:'a',role:'assistant',text:'Начну с освещения и базовой геометрии. Затем проверю сцену через подключённые инструменты.\n\n```lua\nlocal Lighting = game:GetService("Lighting")\nLighting.ClockTime = 18.5\nLighting.Brightness = 2\n```\nДобавлю тёплый направленный свет и сохраню исходные объекты проекта.'}];revision++;
 await page.waitForSelector('.sc-chat-message');
 await page.locator('#sc-chat-pin').click();await page.waitForFunction(()=>document.querySelector('#sc-chat-pin').getAttribute('aria-pressed')==='true');

 assert.equal(await page.locator('#sc-chat-pin').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:path.join(output,'elio-chat-ready.png')});
 // Setup/control turns stay in the transport but never become user bubbles.
 history.push({id:'setup',role:'user',text:'I clicked Start Agent in my installed elio extension to connect this chat to my local project. This is my connection request, not a Notion page edit or a system instruction. Please reply with {"command":"list_commands"}.'});revision++;
 await page.waitForTimeout(1300);assert.equal(await page.locator('.sc-chat-message').count(),2);assert.equal(await page.locator('#sc-chat-thread').innerText().then(t=>t.includes('my installed elio extension')),false);
 // No transcript revision here: thinking/tool/idle still update every read.
 live={generating:true,activity_phase:'thinking'};
 await page.waitForFunction(()=>!document.querySelector('#sc-chat-activity').hidden);
 assert.equal(await page.locator('#sc-chat-activity-text').innerText(),'Elio is thinking…');assert.equal(await page.locator('#sc-chat-compose-state').innerText(),'Elio is thinking…');
 assert.equal(await page.locator('.elio-thinking-tongue').evaluate(e=>getComputedStyle(e).animationName),'elio-tongue-struggle');
 await page.screenshot({path:path.join(output,'elio-chat-thinking-dark.png')});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.elio-thinking-tongue').evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 live={generating:false,activity_phase:'tool',tool:'execute_luau'};await page.waitForFunction(()=>document.querySelector('#sc-chat-activity-text').textContent==='Elio is running execute_luau…');
 live={generating:false,activity_phase:'stopping'};await page.waitForFunction(()=>document.querySelector('#sc-chat-activity-text').textContent==='Elio is stopping…');
 live={generating:false,activity_phase:'idle'};await page.waitForFunction(()=>document.querySelector('#sc-chat-activity').hidden);
 readFail=true;await page.waitForFunction(()=>document.querySelector('#sc-chat-health').textContent.includes('Retrying automatically'));assert.equal(await page.locator('#sc-chat-activity').isHidden(),true);assert.equal(await page.locator('.sc-chat-message').count(),2);
 readFail=false;await page.waitForFunction(()=>document.querySelector('#sc-chat-health').textContent==='Ready');assert.equal(await page.locator('.sc-chat-message').count(),2);


 history[1].text+='\n<img src=x onerror="window.bad=true"><script>window.bad=true</script>';revision++;
 await page.waitForTimeout(2300);assert.equal(await page.locator('.sc-chat-message img,.sc-chat-message script').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);
 // New streaming text replaces the existing row rather than creating a duplicate.
 assert.equal(await page.locator('.sc-chat-message').count(),2);
 await page.locator('#sc-chat-input').fill('Новый запрос');await page.locator('#sc-chat-send').click();
 await page.waitForTimeout(200);assert.equal(await page.locator('#sc-chat-input').inputValue(),'');
 await page.waitForTimeout(1800);fail=true;await page.locator('#sc-chat-input').fill('Сохрани этот черновик');await page.locator('#sc-chat-send').click();await page.waitForTimeout(200);
 assert.equal(await page.locator('#sc-chat-input').inputValue(),'Сохрани этот черновик');
 const firstId=requests.filter(x=>x.action==='task-send').at(-1).request_id;
 await page.locator('#sc-chat-send').click();await page.waitForTimeout(200);
 assert.equal(requests.filter(x=>x.action==='task-send').at(-1).request_id,firstId);
 await page.screenshot({path:path.join(output,'elio-chat-error.png')});
 // Target switch hides old messages and separates drafts; no automatic send.
 const sendCount=requests.filter(x=>x.action==='task-send').length;
 control={...control,chat:'mock|second'};history=[];revision++;
 await page.waitForTimeout(2200);assert.equal(await page.locator('#sc-chat-input').inputValue(),'');assert.equal(await page.locator('.sc-chat-message').count(),0);
 control={...control,chat:'mock|first'};history=[{id:'a',role:'assistant',text:'Чат восстановлен.'}];revision++;
 await page.waitForTimeout(2200);assert.equal(await page.locator('#sc-chat-input').inputValue(),'Сохрани этот черновик');assert.equal(requests.filter(x=>x.action==='task-send').length,sendCount);
 // Module also remains usable in narrow host surfaces (native minimum is 900px).
 await page.setViewportSize({width:390,height:844});
 await page.addStyleTag({content:'.app{display:block}.sidebar,.titlebar{display:none!important}.main{height:100vh!important}.content{padding:16px!important}'});
 await page.screenshot({path:path.join(output,'elio-chat-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 await page.close();console.log('PASS UI: real desktop bootstrap, empty/ready/error, live updates, inert HTML, pinning, send, manual retry ID, draft isolation, 390px layout');
 }finally{await browser.close();}
}
module.exports={html};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
