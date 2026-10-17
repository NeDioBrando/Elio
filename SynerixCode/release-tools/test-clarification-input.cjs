const {chromium,firefox}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{for(const [name,engine] of Object.entries({chromium,firefox})){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<div id="rs-root"></div>');
  // A hostile site capture handler reproduces the reported keyboard lock.
  await page.evaluate(()=>{for(const type of ['keydown','beforeinput','paste'])document.addEventListener(type,event=>{event.preventDefault();event.stopImmediatePropagation();},true);const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);window.testShadow=shadow;return shadow;};});
  await page.addScriptTag({path:'core/clarification.js'});
  await page.evaluate(()=>{window.answer=null;window.controller=synerixcodeClarification.create({document,context:()=> 'chat-a',provider:()=> 'Test AI',mount:()=>document.body});window.pending=controller.request({question:'Which screen?',options:[{id:'one',label:'This screen',scope:'Update the current screen'},{id:'all',label:'All screens',scope:'Update all screens'}],recommended_id:'one',recommendation:'Begin with this screen',questions:['What should change?']}).then(value=>{window.answer=value;});});
  const frame=await page.waitForEvent('framenavigated',{timeout:1000}).catch(()=>page.frames().find(frame=>frame!==page.mainFrame()));
  assert(frame,'Answer frame mounted');await frame.waitForSelector('textarea');
  await frame.locator('input[value=one]').check();const field=frame.locator('textarea').first();await field.click();await page.keyboard.type('Make the inventory easier to read.');assert.equal(await field.inputValue(),'Make the inventory easier to read.');
  await frame.locator('button[type=submit]').click();await page.waitForFunction(()=>window.answer!==null);assert.equal(await page.evaluate(()=>answer.answers[0].answer),'Make the inventory easier to read.');assert.equal(await page.evaluate(()=>controller.isWaiting()),false);assert.equal(await page.locator('#rs-clarification-host').count(),0);
  console.log('PASS '+name+': trusted typing, selection and answer submission survive site keyboard capture; input panel and pending state released.');
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
