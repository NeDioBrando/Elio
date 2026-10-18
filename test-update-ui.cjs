// SPDX-License-Identifier: GPL-3.0-or-later
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {html}=require('./test-desktop-chat-ui.cjs');
const output=process.env.SYNERIXCODE_TEST_OUTPUT||process.cwd();fs.mkdirSync(output,{recursive:true});
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
 try{
 let status={current:'1.0.1',latest:'1.0.2',outdated:true,phase:'available',supported:true},installs=0,checks=0;
 const page=await browser.newPage({viewport:{width:1460,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.__SYNERIXCODE_BOOT__={key:'a'.repeat(64),apiUrl:'http://127.0.0.1:3000'});
 await page.route('http://127.0.0.1:3000/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/desktop-ui')return route.fulfill({contentType:'text/html',body:html().replaceAll('1.0.0','1.0.1')});
  let body={ok:true,servers:[],tools:[],templates:[],items:[],preferences:{},checkpoints:[]};
  if(url.pathname==='/api/desktop/state')body={ok:true,version:'1.0.1',update:status,browser_agent:{},preferences:{},tools:[],logs:[],servers:[]};
  if(url.pathname==='/api/updates/install'){installs++;status={...status,phase:'downloading',installing:true,downloaded:40,size:100};}
  if(url.pathname==='/api/updates/check')checks++;
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:3000/desktop-ui');
 await page.waitForFunction(()=>document.querySelector('#nativeUpdateNotice')?.innerText.includes('Outdated'));
 assert.match(await page.locator('#sidebarVersion').innerText(),/1.0.1.*Outdated/);
 await page.screenshot({path:path.join(output,'synerix-update-native-outdated.png')});
 await page.locator('#nativeUpdateNotice button').click();await page.waitForFunction(()=>document.querySelector('#nativeUpdateNotice').innerText.includes('40%'));
 assert.equal(installs,1);assert(await page.locator('#nativeUpdateNotice button').isDisabled());
 assert(!(await page.locator('#nativeUpdateNotice').innerText()).includes('Запрос принят.'));
 await page.screenshot({path:path.join(output,'synerix-update-native-progress.png')});
 status={current:'1.0.1',phase:'error',error:'Тест: нет соединения с GitHub.'};await page.waitForFunction(()=>document.querySelector('#nativeUpdateNotice').innerText.includes('Не удалось проверить'));
 await page.locator('#nativeUpdateNotice button').click();assert.equal(checks,1);
 await page.screenshot({path:path.join(output,'synerix-update-native-error.png')});
 await page.close();
 // Exercise the very same browser UI widget against the same status model.
 const web=await browser.newPage({viewport:{width:1280,height:800}});web.on('pageerror',e=>errors.push(e.message));
 await web.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f5f5;font:16px system-ui;color:#272727"><main style="max-width:680px;margin:180px auto;padding:24px"><h1>Тестовый интерфейс ИИ</h1><p>Панель обновления SynerixCode показана поверх страницы независимо от состояния чата.</p><label>Сообщение<textarea style="display:block;width:100%;height:100px"></textarea></label></main><div id="host"></div></body></html>');
 await web.addScriptTag({content:fs.readFileSync(path.join(__dirname,'core/version.js'),'utf8')});
 await web.evaluate(()=>{window.testStatus={current:'1.0.1',latest:'1.0.2',outdated:true,supported:true,phase:'available'};window.testCalls=[];synerixcodeVersion.mount(document.querySelector('#host'),{current:'1.0.1',floating:true,interval:100,getStatus:async()=>window.testStatus,invoke:async action=>{window.testCalls.push(action);}});});
 await web.waitForSelector('#host button');assert.match(await web.locator('#host').innerText(),/Версия устарела · Outdated/);
 await web.locator('#host button').click();assert.deepEqual(await web.evaluate(()=>window.testCalls),['install']);
 await web.screenshot({path:path.join(output,'synerix-update-browser-outdated.png')});
 await web.evaluate(()=>window.testStatus={current:'1.0.2',latest:'1.0.2',outdated:false,phase:'current'});
 await web.waitForFunction(()=>document.querySelector('#host button').textContent==='Перезагрузить расширение');
 await web.screenshot({path:path.join(output,'synerix-update-browser-reload.png')});
 await web.setViewportSize({width:390,height:844});await web.screenshot({path:path.join(output,'synerix-update-browser-mobile.png')});
 assert.equal(await web.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await web.close();
 assert.deepEqual(errors,[]);
 console.log('PASS update UI: actual native shell, Outdated/version labels, one-click dispatch, progress disable, check errors, shared browser widget, extension-reload state, 390px');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
