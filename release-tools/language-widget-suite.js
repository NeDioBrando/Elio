async function widgetSuite(config) {
 const result={assertions:0,widgets:[],observed:[]}, I=globalThis.synerixcodeI18n, catalog=globalThis.synerixcodeLocaleData?.en||{}, seen=new Map();
 const check=(ok,label)=>{result.assertions++;if(!ok)throw Error(label);};
 const equal=(a,b,label)=>check(a===b,`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const userMarker='[data-i18n-user-content]';
 const excluded='style,script,pre,code,kbd,samp,[contenteditable],[data-i18n-user-content]';
 let current='';
 const observe=root=>{for(const n of [root,...root.querySelectorAll('*')]){if(n.closest(excluded))continue;for(const attr of ['title','aria-label','placeholder']){const v=n.getAttribute(attr);if(v)add(v);}if(n.matches('input,textarea'))continue;for(const c of n.childNodes)if(c.nodeType===3)add(c.nodeValue);}function add(s){s=s.replace(/\s+/g,' ').trim();if(s&&!Object.hasOwn(catalog,s)){const key=current+'\0'+s;seen.set(key,{file:current,text:s});}}};
 if(I){const mount=I.mountStatic;I.mountStatic=root=>{observe(root);return mount(root);};I.setLanguage(config.startLanguage||'en');}
 const host=(id,file)=>{current=file;const h=document.createElement('section');h.id=id;h.setAttribute('data-i18n-user-content','');document.body.append(h);return h;};
 const release=h=>{h.removeAttribute('data-i18n-user-content');I?.mountStatic(h);};
 const switchTo=async(lang)=>{I?.setLanguage(lang);await tick();};
 const untranslated=(n,text,label)=>{check(!!n,label+' node');equal(n.textContent,text,label);check(!!n.closest(userMarker),label+' explicit guard');};
 const es=(english)=>config.runtime?(globalThis.synerixcodeLocaleData.es[english]||english):english;
 const button=(h,label)=>[...h.querySelectorAll('button')].find(b=>b.textContent===label||b.textContent===es(label));
 const click=async b=>{check(!!b,'button present');await b.onclick();await tick();};
 const toggle=async row=>{check(!!row,'row present');row.open=true;await row.ontoggle();await tick();};
 const cycles=async fn=>{for(const lang of ['es','en','es']){await switchTo(lang);fn(lang);}};
 const skill={id:'user-home',title:'Home',description:'Save',domain:'all',scope:'Settings',steps:['Home','Save','Settings'],pitfalls:['Save'],verification:['Settings'],confirmed:true,enabled:true,revision:1};
 {
  const h=host('skillsWorkspace','skills-ui.js');let fail=false,saved;
  const api=async r=>{if(fail)throw Error('Save');if(r.action==='list')return {ok:true,skills:[skill]};if(r.action==='list_deleted')return {ok:true,skills:[{...skill,id:'deleted-home'}],trash_revision:1};if(r.action==='export')return {ok:true,skill};if(r.action==='save'){saved=r.skill;return {ok:true,skill:r.skill};}return {ok:true,skill};};
  const widget=synerixcodeSkillsUI.mount(h,api,async()=>({ok:true}),()=>({}),async()=>{},async()=>({tasks:[{id:'task',status:'worked',label:'Settings'}]}));release(h);await widget.refresh();await tick();
  const q=s=>h.querySelector(`[data-sk="${s}"]`);
  await click(h.querySelector('[data-sk-card]>.softbtn'));
  await cycles(lang=>{equal(h.querySelector('h3').textContent,config.runtime&&lang==='es'?es('Skills'):'Skills','skills builtin');untranslated(h.querySelector('[data-sk-card] strong'),'Home','skill name');untranslated(h.querySelector('[data-sk-card] .softbtn span'),'Save','skill description');untranslated(q('form-title'),'Home','editor skill title');untranslated(q('detail-title'),'Home','reference title');untranslated(q('detail-description'),'Save','reference description');equal(q('title').value,'Home','skill title input');equal(q('scope').value,'Settings','skill scope input');equal(q('steps').value,'Home\nSave\nSettings','skill instructions input');equal(q('save').textContent,config.runtime&&lang==='es'?es('Save'):'Save','save action translated');check(!q('save').closest(userMarker),'save action exposed');untranslated(q('tasks').querySelector('option'),'Settings','completed task name');for(const n of q('detail-method').querySelectorAll('li'))check(!!n.closest(userMarker),'instruction list guarded');});
  await click(q('save'));equal(saved.title,'Home','save original title');equal(saved.description,'Save','save original description');equal(saved.steps.join('|'),'Home|Save|Settings','save original instructions');
  await click(q('tab-deleted'));untranslated(h.querySelector('[data-sk-deleted] strong'),'Home','deleted title');untranslated(h.querySelector('[data-sk-deleted] p'),'Save','deleted description');equal(h.querySelector('[data-sk-restore]').textContent,es('Restore'),'restore translated');
  await click(q('new'));check(!q('form-title').hasAttribute('data-i18n-user-content'),'new editor title exposed again');fail=true;await widget.refresh();equal(q('status').textContent,'Save','skill external error preserved');result.widgets.push('skills');
 }
 {
  const h=host('templateLibrary','templates.js');let fail=false;
  const api=async r=>{if(fail)throw Error('Settings');if(r.action==='list')return {ok:true,templates:[{id:'t',name:'Home',description:'Save',scripts:1}]};if(r.action==='read')return r.path?{ok:true,source:'Settings',next_offset:null}:{ok:true,scripts:[{path:'Save',class:'Home',script_id:'s'}]};if(r.action==='match')return {ok:true,matches:[{name:'Home',path:'Save',source:'Settings',preview_limited:true}]};return {ok:true,message:'Save'};};
  const widget=synerixcodeTemplates.mount(h,api);release(h);await widget.refresh();const row=[...h.querySelectorAll('details')].find(n=>n.querySelector('summary')?.textContent==='Home · 1 scripts');await toggle(row);const script=[...row.querySelectorAll('details')][0];await toggle(script);
  const fi=h.querySelector('input[type=file]');Object.defineProperty(fi,'files',{value:[{name:'Home'}],configurable:true});fi.onchange();
  await click(button(h,'Search templates'));
  await cycles(()=>{untranslated(row.querySelector('summary'),'Home · 1 scripts','template name');untranslated(row.querySelector('p'),'Save','template description');untranslated(script.querySelector('summary'),'Save · Home','script path/class');untranslated(script.querySelector('pre'),'Settings','script source');check([...h.querySelectorAll('span')].some(n=>n.textContent==='Home'&&n.closest(userMarker)),'selected filename guard');check(!!button(h,'Delete saved template')&&!button(h,'Delete saved template').closest(userMarker),'template delete action exposed');});
  if(I){equal(button(h,'Delete saved template')?.textContent,es('Delete saved template'),'template action translated with real catalog');}
  fail=true;await widget.refresh();equal(h.querySelector('[role=status]').textContent,'Settings','template external error preserved');result.widgets.push('templates');
 }
 {
  const h=host('explorerWorkspace','explorer-ui.js');let fail=false;
  const api=async r=>{if(fail)throw Error('Home');if(r.action==='tree')return {session:'session',nodes:[{id:'n',name:'Home',class:'Settings',children:false,script:false}]};return {session:'session',script:false,path:'Save',properties:{Home:'Save',Settings:'Home',ClassName:'Settings'}};};
  const widget=synerixcodeExplorerUI.mount(h,api,()=>({rsExplorerAutoSync:false}),async()=>{});release(h);await widget.refresh();await h.querySelector('.explorer-node').onclick({target:h.querySelector('.explorer-node-label')});
  const q=s=>h.querySelector(`[data-ex="${s}"]`);
  await cycles(lang=>{equal(h.querySelector('h1').textContent,config.runtime&&lang==='es'?es('Explorer'):'Explorer','explorer builtin');untranslated(h.querySelector('.explorer-node-label'),'Home','object name');untranslated(h.querySelector('.explorer-node-class'),'Settings','object class');untranslated(q('selection'),'Home','selected object name');untranslated(q('path'),'Save','selected object path');untranslated(q('kind'),'Settings','selected object class');untranslated(q('properties').querySelector('label span'),'Home','property name');equal(q('properties').querySelector('input').value,'Save','property user value');check(!q('push').closest(userMarker),'push action exposed');});
  fail=true;await widget.refresh();equal(q('status').textContent,'Home','explorer external error preserved');check(!q('selection').hasAttribute('data-i18n-user-content'),'empty selected label exposed again');result.widgets.push('explorer');
 }
 {
  const h=host('toolkitWorkspace','toolkit-ui.js');let fail=false,last;
  const api=async r=>{last=r;if(fail)throw Error('Settings');if(r.action==='backups')return {ok:true,records:[{id:'b',name:'Home',created:1,bytes:200}]};return {ok:true,text:'Save'};};
  const widget=synerixcodeToolkitUI.mount(h,api,async()=>({ok:true,text:'Home'}),()=>({roblox_connected:true,browser_agent:{canTaskSend:true,engine:'roblox'}}),()=>{},()=>{});release(h);await widget.refresh();
  await cycles(lang=>{check(h.querySelector('.pc-kit-backup span').textContent.startsWith('Home · '),'backup name unchanged');check(h.querySelector('.pc-kit-backup span').matches(userMarker),'backup guard');equal([...h.querySelectorAll('option')].find(o=>o.value==='Medium').textContent,config.runtime&&lang==='es'?es('Medium'):'Medium','toolkit built-in choice');check(!button(h,'Restore this backup').closest(userMarker),'restore backup exposed');});
  await click(button(h,'Run health check'));equal(h.querySelector('pre').textContent,'Save','tool result collision preserved');await click(button(h,'Sunny day'));equal(last.preset,'Sunny day','request uses English preset not label');fail=true;await widget.refresh();equal(h.querySelector('pre').textContent,'Settings','toolkit error collision preserved');
  const nh=host('notificationsFixture','toolkit-ui.js');const storage={getItem:()=>JSON.stringify([{id:'a',title:'Home',message:'Save',kind:'info',time:1}]),setItem:()=>{}};const notices=synerixcodeNotifications.mount(nh,storage);release(nh);notices.add('Settings','Home');
  await cycles(lang=>{const row=nh.querySelector('.pc-notice-item');untranslated(row.querySelector('strong'),'Settings','notification title');untranslated(row.querySelector('p'),'Home','notification result');equal(button(nh,lang==='es'&&config.runtime?es('Close'):'Close')?.textContent,lang==='es'&&config.runtime?es('Close'):'Close','notification close translated');});result.widgets.push('toolkit+notifications');
 }
 {
  const h=host('taskCenter','task-center.js');let fail=false;
  const task={id:'a',status:'worked',label:'Home',engine:'local',started:'Settings',warnings:['Save'],steps:['Home'],changes:[{kind:'Save',path:'Settings'}],can_revert:true,can_resume:true};
  const api=async r=>{if(fail)throw Error('Save');return r.action==='details'?{ok:true,details:{files:[{path:'Home',before:'Save',after:'Settings',kind:'local',can_restore:true}]}}:{ok:true,project:'Settings',protected:['Home'],tasks:[task]};};
  const widget=synerixcodeTaskCenter.mount(h,api,async()=>({ok:true}));release(h);await widget.refresh();const row=[...h.querySelectorAll('details')].find(n=>n.querySelector('summary')?.textContent==='worked · Home · AgentScript');await toggle(row);await click(button(row,'View before / after'));
  await cycles(lang=>{untranslated(row.querySelector('summary'),'worked · Home · AgentScript','task title');untranslated(row.querySelector('.pc-task-warning'),'Save','task warning');untranslated(row.querySelector('pre'),'Save','before source');untranslated(row.querySelectorAll('pre')[1],'Settings','after source');check([...h.querySelectorAll('span')].some(n=>n.textContent==='Home'&&n.matches(userMarker)),'protected path guarded');equal(button(h,lang==='es'&&config.runtime?es('Remove'):'Remove')?.textContent,lang==='es'&&config.runtime?es('Remove'):'Remove','remove protected path translated');check(!button(row,'Revert this task').closest(userMarker),'task revert exposed');});fail=true;await widget.refresh();equal(h.querySelector('.pc-task-status').textContent,'Save','task external error preserved');result.widgets.push('tasks');
 }
 {
  const h=host('memorySettings','memory.js');let fail=false;
  const api=async()=>{if(fail)throw Error('Home');return {automatic:true,entries:[{id:1,title:'Home',text:'Save',project:'Settings',source:'Home'}]};};
  const widget=synerixcodeMemory.mount(h,api,{exportChat:async()=>({ok:true,chat_id:'c',history:[]}),importChat:async()=>({ok:true})});release(h);await widget.refresh();await tick();
  await cycles(lang=>{untranslated(h.querySelector('[data-memory-entry] strong'),'Home','memory title');untranslated(h.querySelector('[data-memory-entry] small'),'Project: Settings · Home','memory source/project');equal(h.querySelector('[data-entry-text]').value,'Save','memory text input');equal(h.querySelector('[data-entry-title]').value,'Home','memory title input');equal(button(h,lang==='es'&&config.runtime?es('Remove'):'Remove')?.textContent,lang==='es'&&config.runtime?es('Remove'):'Remove','memory remove translated');check(!button(h,'Save edit').closest(userMarker),'memory save exposed');check(!h.querySelector('[data-transfer-export]').closest(userMarker),'memory transfer exposed');});fail=true;await widget.refresh();equal(h.querySelector('[data-memory-status]').textContent,'Home','memory external error preserved');result.widgets.push('memory');
 }

 // RTL interface must not impose RTL on source editors, and authored text chooses its own direction.
 await switchTo('ar');
 if(I)equal(document.querySelector('#explorerWorkspace').dir,'rtl','explorer UI remains RTL');
 for(const selector of ['#explorerWorkspace [data-ex=editor]','#explorerWorkspace [data-ex=studio]','#skillsWorkspace [data-sk=instructions]','#skillsWorkspace [data-sk=public]','#toolkitWorkspace textarea[aria-label="Luau code"]','#toolkitWorkspace .pc-kit-output','#taskCenter pre','#templateLibrary pre']){
  const actualSelector=selector.replace('aria-label="Luau code"','aria-label="'+(I?I.t('Luau code'):'Luau code')+'"');const field=document.querySelector(actualSelector);check(!!field,'technical field '+selector);equal(field.dir,'ltr','technical direction '+selector);check(field.matches(userMarker),'technical user-content guard '+selector);
 }
 for(const selector of ['#skillsWorkspace [data-sk=title]','#skillsWorkspace [data-sk=steps]','#templateLibrary textarea','#taskCenter textarea','#memorySettings [data-entry-title]','#memorySettings [data-entry-text]','#memorySettings [data-memory-new]','#memorySettings [data-transfer-text]']){equal(document.querySelector(selector).dir,'auto','author direction '+selector);}
 result.observed=[...seen.values()];return result;
}
