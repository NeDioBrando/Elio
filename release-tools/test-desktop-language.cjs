/* Isolated desktop preference fixture. No real native service, provider, or browser profile.
 * node release-tools/test-desktop-language.cjs [--actual-i18n]
 * Default mode tests the desktop integration against an explicit runtime-contract fixture.
 * --actual-i18n also verifies the parent's core/i18n*.js integration once available.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const vm = require('node:vm');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/vercel/sandbox/node_modules/playwright'); }
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const codes = ['en','es','fr','ru','ar','zh-CN','zh-TW','ja','ko','de','pt-BR','it','hi','tr','pl'];
const actual = process.argv.includes('--actual-i18n');
const htmlSource = read('agent/src/desktop.html');
const main = read('agent/src/main.rs'), build = read('agent/build.rs');
for (const [placeholder, name] of [['__ELIO_I18N_CATALOG__','i18n-catalog.js'],['__ELIO_I18N__','i18n.js']]) {
  assert.equal(main.split(`.replace("${placeholder}",`).length - 1, 2, 'both native HTML handlers inject shared i18n');
  assert(main.includes(`/core/${name}`));
  assert(build.includes(`"${name}"`), 'native rebuild follows shared runtime changes');
  assert.equal(htmlSource.split(placeholder).length - 1, 1);
}
assert(htmlSource.indexOf('I18n.mountStatic(document.body)') < htmlSource.indexOf('elioNotifications.mount('), 'bind static body before user widgets');
assert(htmlSource.includes('Patchpref("rsLanguage", I18n.normalize(Code))'));

// Small test-only adapter for the exact shared runtime API. Not a shipped engine/catalog.
function contractRuntime() {
  const names = [['en','English','English'],['es','Spanish','Español'],['fr','French','Français'],['ru','Russian','Русский'],['ar','Arabic','العربية'],['zh-CN','Chinese (Simplified)','简体中文'],['zh-TW','Chinese (Traditional)','繁體中文'],['ja','Japanese','日本語'],['ko','Korean','한국어'],['de','German','Deutsch'],['pt-BR','Portuguese (Brazil)','Português (Brasil)'],['it','Italian','Italiano'],['hi','Hindi','हिन्दी'],['tr','Turkish','Türkçe'],['pl','Polish','Polski']];
  const languages = names.map(([code,name,nativeName])=>({code,name,nativeName,dir:code==='ar'?'rtl':'ltr'}));
  let language = 'en';
  const bindings = [];
  const normalize = code => languages.some(x=>x.code===code) ? code : 'en';
  const t = source => ({es:{Language:'Idioma',Settings:'Configuración',Appearance:'Apariencia'},ar:{Language:'اللغة',Settings:'الإعدادات',Appearance:'المظهر'}}[language] || {})[source] || source;
  function setLanguage(code) { language=normalize(code); for (const [node,source] of bindings) if(node.isConnected) node.nodeValue=t(source); return language; }
  globalThis.elioI18n = {
    languages, normalize, t, getLanguage:()=>language, setLanguage,
    mountStatic(root) {
      window.__staticMountedBeforeData = ['taskCenter','explorerWorkspace','memorySettings','skillsWorkspace'].every(id=>!document.getElementById(id).children.length);
      const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walk.nextNode()) { const node=walk.currentNode; if(!node.parentElement.closest('[data-i18n-user-content],textarea,input,pre,code,script,style,[contenteditable]') && ['Language','Settings','Appearance'].includes(node.nodeValue)) bindings.push([node,node.nodeValue]); }
      return { disconnect() {} };
    },
    mountPicker(host,{value,onChange}) {
      host.innerHTML='<label>Search languages<input type="search" aria-label="Search languages"></label><label>Language<select aria-label="Language"></select></label><p role="status"></p>';
      const search=host.querySelector('input'),select=host.querySelector('select'),status=host.querySelector('[role=status]');
      let saved=normalize(value);
      function fill() { const query=search.value.toLowerCase(); select.replaceChildren(); for(const entry of languages.filter(x=>!query || `${x.code} ${x.name} ${x.nativeName}`.toLowerCase().includes(query))) {const option=document.createElement('option');option.value=entry.code;option.textContent=`${entry.name} — ${entry.nativeName}`;select.append(option);} if([...select.options].some(x=>x.value===saved))select.value=saved; }
      search.oninput=fill;
      select.onchange=async()=>{const code=select.value;try{await onChange(code);saved=code;setLanguage(code);status.textContent='Saved';}catch(error){select.value=saved;status.textContent=error.message;}};
      fill();return {refresh(code){saved=normalize(code);if([...select.options].some(x=>x.value===saved))select.value=saved;}};
    }
  };
}
let html=htmlSource;
html=html.replace('__ELIO_I18N_CATALOG__',actual?read('core/i18n-catalog.js'):'');
html=html.replace('__ELIO_I18N__',actual?read('core/i18n.js'):`(${contractRuntime.toString()})();`);
for(const [token,file] of Object.entries({SKILLS:'skills-ui.js',EXPLORER:'explorer-ui.js',MEDIA:'media.js',MEMORY:'memory.js',TASK:'task-center.js',TEMPLATE:'templates.js',TOOLKIT:'toolkit-ui.js',VERSION:'version.js'})) html=html.replace(`__ELIO_${token}_UI__`,()=>read(`core/${file}`));
html=html.replace(/__ELIO_VERSION__/g,'1.24.18').replace(/__ELIO_PAIRING_KEY__/g,'fixture-only-key');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script, {filename:'desktop-injected.js'});

(async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'elio-language-fixture-'));
  const prefsPath=path.join(temporary,'settings.json');
  const authored='Settings\nLanguage مرحبا café 你好 C:\\Game\\main.lua';
  let preferences={'rs-engine':'local',rsStopMode:'safe',rsThinkingLevel:'ultracode',rsAutoUpdate:false,rsCustomPrompt:authored,rsAppearance:{theme:'cyan',glow:'strong',gradients:'off'}};
  fs.writeFileSync(prefsPath,JSON.stringify(preferences));
  let failNext=false;
  const posts=[],errors=[];
  const state=()=>({preferences,bridge_connected:true,workspace_ready:true,workspace_root:'C:\\Game\\Settings',tools:[{name:'Settings',description:'Language',source:'User server'}],logs:['Settings','Language'],servers:[],browser_agent:{provider:'Fixture',chat:'fixture-chat',engine:'local',canCoWork:true,canQueue:true,cowork:{enabled:true,pending:[{id:'1',status:'queued',preview:'Settings'}]},activity:[{id:'a',label:'Language',revision:1}],status:'Settings'}});
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    let body={};if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
    if(req.method==='POST') posts.push({url:req.url,body});
    if(req.url==='/' || req.url==='/desktop') {res.writeHead(200,{'Content-Type':'text/html'});return res.end(html);}
    res.setHeader('Content-Type','application/json');
    const reply=value=>res.end(JSON.stringify(value));
    if(req.url==='/api/desktop/preferences') {
      if(failNext){failNext=false;res.statusCode=400;return reply({ok:false,error:'Fixture save refused'});}
      preferences={...preferences,...body};fs.writeFileSync(prefsPath,JSON.stringify(preferences));return reply({ok:true,preferences});
    }
    if(req.url==='/api/desktop/state')return reply(state());
    if(req.url==='/api/desktop/update')return reply({installed:'1.24.18',latest:'1.24.18',state:'idle',release_notes:[]});
    if(req.url==='/api/mcp/catalog')return reply({servers:[{id:'fixture',name:'Settings',description:'Language',command:'C:\\Game\\main.exe',args:['--language','en'],enabled:false}]});
    if(req.url==='/api/desktop/agent')return reply({ok:true,messages:[{role:'result',text:authored}],revision:1});
    if(req.url==='/api/memory')return reply({notes:[],project:'fixture'});
    return reply({ok:true,items:[],skills:[],templates:[],tasks:[],projects:[],servers:[],notes:[]});
  });
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    // Native source defaults to :3000; the fixture boot redirects only to this private local server.
    browser=await playwright.chromium.launch({headless:true,...(process.env.ELIO_TEST_CHROMIUM?{executablePath:process.env.ELIO_TEST_CHROMIUM}:fs.existsSync('/usr/local/bin/chromium')?{executablePath:'/usr/local/bin/chromium'}:{}),args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1360,height:1000}});
    await context.addInitScript(url=>{window.__ELIO_BOOT__={apiUrl:url,key:'fixture-only-key'};},base);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'load'});
    await page.waitForFunction(()=>window.elioDesktop && document.documentElement.dataset.desktopThinking==='ultracode');
    await page.evaluate(()=>elioDesktop.go('settings'));
    const host=page.locator('#desktopLanguagePicker'), select=host.locator('select'), search=host.locator('input[type=search], input[type=text]').first();
    await select.waitFor({state:'visible'});
    assert.equal(await select.inputValue(),'en','old settings without language default to English');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
    assert.equal(await select.locator('option').count(),15);
    assert.deepEqual(await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),codes);
    assert(await page.locator('[data-settings-section="languageSettings"]').evaluate(n=>n.open),'Language defaults expanded');
    const searchBox=await search.boundingBox(),selectBox=await select.boundingBox();
    assert(searchBox.y+searchBox.height<=selectBox.y+1,'search must be ABOVE the real dropdown');
    if(!actual)assert(await page.evaluate(()=>window.__staticMountedBeforeData));
    assert.equal(await page.locator('#customInstructions').inputValue(),authored);
    await search.fill('日本');
    assert((await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('ja'),'search supports native language names');
    await search.fill('');
    for(const code of codes.slice(1)) {
      await select.selectOption(code);
      await page.waitForFunction(code=>document.documentElement.lang===code && elioI18n.getLanguage()===code,code);
      assert.equal(await page.locator('html').getAttribute('dir'),code==='ar'?'rtl':'ltr');
      assert.equal(JSON.parse(fs.readFileSync(prefsPath,'utf8')).rsLanguage,code);
      assert.equal(await page.locator('#customInstructions').inputValue(),authored,'language never rewrites instructions');assert.equal(await page.locator('.brand-word').innerText(),'elio','brand is never translated');
      if(process.env.ELIO_LANGUAGE_SCREENSHOTS && ['es','ar'].includes(code)) {
        const dir=process.env.ELIO_LANGUAGE_SCREENSHOTS;fs.mkdirSync(dir,{recursive:true});
        await page.locator('#languageSettings').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(dir,'desktop-settings-'+code+'.png')});
        if(code==='ar') {await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'desktop-settings-ar-mobile.png')});await page.setViewportSize({width:1360,height:1000});}
      }

      if(code==='ar') {
        assert.equal(await page.locator('#customInstructions').getAttribute('dir'),'auto');
        assert.equal(await page.locator('#explorerWorkspace [data-ex=editor]').evaluate(n=>getComputedStyle(n).direction),'ltr');
        assert.equal(await page.locator('#terminal').evaluate(n=>getComputedStyle(n).direction),'ltr');
        assert.equal(await page.locator('input[type=number]').first().evaluate(n=>getComputedStyle(n).direction),'ltr');
      }
    }
    for(const item of posts.filter(p=>p.body.rsLanguage!==undefined)) {
      assert.equal(item.url,'/api/desktop/preferences');assert.deepEqual(Object.keys(item.body),['rsLanguage']);
    }
    const languagePosts=posts.filter(p=>p.body.rsLanguage!==undefined).length;
    preferences.rsLanguage='fr';await page.evaluate(()=>elioDesktop.refresh());
    assert.equal(await select.inputValue(),'fr','external preference changes refresh the shared picker');
    assert.equal(await page.locator('html').getAttribute('lang'),'fr');
    assert.equal(posts.filter(p=>p.body.rsLanguage!==undefined).length,languagePosts,'refresh never writes a preference');
    preferences.rsLanguage='not-supported';await page.evaluate(()=>elioDesktop.refresh());
    assert.equal(await select.inputValue(),'en');assert.equal(await page.locator('html').getAttribute('lang'),'en');
    preferences.rsLanguage='en';
    failNext=true;await select.selectOption('es');
    await page.waitForFunction(()=>document.getElementById('fatal').textContent.includes('Fixture save refused'));
    await page.waitForFunction(()=>{const node=document.querySelector('#desktopLanguagePicker select');return !node.disabled && node.value==='en';});
    assert.equal(await select.inputValue(),'en','failed saves revert the picker');
    assert.equal(await page.evaluate(()=>elioI18n.getLanguage()),'en','failed save must reject onChange');
    assert.equal(preferences.rsLanguage,'en');
    assert.equal(await page.locator('#homeActivityLabel').innerText(),'Language','user-authored labels are not localized');
    await page.evaluate(()=>elioDesktop.go('tools'));
    assert.equal(await page.locator('#toolsGrid .toolname').first().innerText(),'Settings');
    assert.equal(await page.locator('#toolsGrid .tooldesc').first().innerText(),'Language');
    await page.evaluate(()=>elioDesktop.go('mcp'));
    await page.locator('#mcpGrid .mcpcommand').last().waitFor();
    assert.equal(await page.locator('#mcpGrid .mcpcommand').last().innerText(),'C:\\Game\\main.exe --language en');
    await page.evaluate(()=>elioDesktop.go('settings'));
    await select.selectOption('ar');await page.waitForFunction(()=>document.documentElement.lang==='ar');
    await page.locator('[data-settings-section="languageSettings"] > summary').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('elioSettingsSections')).languageSettings===false);
    preferences=JSON.parse(fs.readFileSync(prefsPath,'utf8'));await page.reload();
    await page.waitForFunction(()=>window.elioDesktop && document.documentElement.lang==='ar');
    await page.evaluate(()=>elioDesktop.go('settings'));
    assert.equal(await select.inputValue(),'ar','language survives desktop reopen');
    assert(!(await page.locator('[data-settings-section="languageSettings"]').evaluate(n=>n.open)),'saved collapsed section is respected on reopen');
    assert.equal(await page.locator('#customInstructions').inputValue(),authored);
    assert.equal(preferences.rsStopMode,'safe');assert.equal(preferences.rsAutoUpdate,false);
    await page.locator('[data-settings-section="languageSettings"] > summary').click();
    await page.locator('[data-page="updates"]').click();
    await page.locator('[data-pref=rsAutoUpdate]').click();
    await page.waitForFunction(()=>document.querySelector('[data-pref=rsAutoUpdate]').classList.contains('on'));
    assert.equal(preferences.rsAutoUpdate,true);assert.equal(preferences.rsLanguage,'ar');assert.equal(preferences.rsCustomPrompt,authored);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(JSON.stringify({ok:true,mode:actual?'actual shared i18n':'isolated runtime contract',languages:codes.length,checks:['native placeholder wiring','initial static bind ordering','English legacy fallback','search above dropdown','native-name search','all choices persisted','external refresh without writes','invalid code fallback','save failure rejection','RTL content isolation','reopen','saved section state','auto-update preservation','unchanged user content']}));
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
