// SPDX-License-Identifier: GPL-3.0-or-later
const synerixcodeExplorerUI=(()=>{
 'use strict';
 function mount(host,api,preferences,setPreference){
  // Snapshot only owned UI; user/tool data is marked before it enters the DOM.
  const localize=()=>globalThis.synerixcodeI18n?.mountStatic?.(host);
  host.innerHTML=`<div class="explorer-heading"><div><span class="eyebrow">YOUR WORKSPACE</span><h1>Explorer</h1><p>Browse your game’s objects and scripts in one place.</p></div><span class="explorer-source-badge">Roblox Studio</span></div>
  <div class="explorer-toolbar"><div class="explorer-sync-tools"><button class="softbtn" data-ex="refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8"/></svg>Sync Studio</button><label class="explorer-auto"><input type="checkbox" data-ex="auto" checked> Auto-sync <b data-ex="auto-label">ON</b></label></div><div class="explorer-sync-actions"><button class="softbtn" data-ex="compare" disabled>Compare with Studio</button><button class="accentbtn" data-ex="push" disabled>Push changes</button></div></div>
  <div class="explorer-layout"><aside class="explorer-tree-panel"><div class="explorer-tree-heading"><strong>Game hierarchy</strong><span>OBJECTS &amp; SCRIPTS</span></div><label class="explorer-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input data-ex="filter" placeholder="Search loaded objects…" aria-label="Filter Explorer"></label><div data-ex="tree" role="tree" aria-label="Game Explorer"></div></aside>
  <section class="explorer-detail-panel"><header class="explorer-detail-heading"><div><span class="explorer-detail-title" data-ex="selection">Object details</span><div data-ex="path">Select a script or object</div></div><span class="explorer-class-badge" data-ex="kind">INSPECT</span></header><div class="explorer-empty" data-ex="empty"><div class="explorer-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5v9l-9 5-9-5V8zm0 10 9-5m-9 5L3 8m9 5v9"/></svg></div><h2>Your game, in focus</h2><p>Select an object to inspect its properties,<br>or open a script to edit its source.</p><span>Expand the game hierarchy to get started</span></div><div class="explorer-editor" hidden><pre data-ex="lines" dir="ltr" data-i18n-user-content aria-hidden="true">1</pre><textarea data-ex="editor" dir="ltr" data-i18n-user-content aria-label="Script source" spellcheck="false" disabled></textarea></div><details data-ex="comparison" class="explorer-comparison" hidden><summary>Current Studio source — merge changes into your draft</summary><pre data-ex="studio" dir="ltr" data-i18n-user-content></pre></details><div data-ex="properties" class="explorer-properties" hidden></div><footer class="explorer-detail-footer"><span>Changes checked before syncing</span><kbd>Ctrl / ⌘ + S to sync</kbd></footer></section></div><div class="explorer-status"><span class="explorer-status-dot" aria-hidden="true"></span><span data-ex="status" role="status" data-i18n-user-content>Connect Studio to load your game.</span></div>`;
  const find=name=>host.querySelector('[data-ex="'+name+'"]');
  find('filter').dir='auto';find('path').dir='ltr';find('selection').dir='auto';find('kind').dir='ltr';
  const editor=find('editor'),tree=find('tree'),auto=find('auto'),status=find('status');
  let session='',selected=null,expected='',busy=false,blocked=false,timer=null,epoch=0,active=true;
  const key=()=>selected?'synerixcode-explorer-draft:'+session+':'+selected.id:'';
  const dirty=()=>!!selected&&editor.value!==expected;
  function message(text){status.textContent=text;find('push').disabled=busy||!dirty();find('compare').disabled=busy||!selected;}
  function store(){try{if(dirty())localStorage.setItem(key(),JSON.stringify({expected,source:editor.value,path:find('path').textContent}));else localStorage.removeItem(key());}catch{message('Draft storage unavailable. Keep this editor open until you push.');}}
  function lines(){find('lines').textContent=Array.from({length:editor.value.split('\n').length},(_,i)=>i+1).join('\n');}
  function renderProperties(properties){
   const container=find('properties');container.replaceChildren();
   for(const name of Object.keys(properties)){
    const value=properties[name],row=document.createElement('label'),label=document.createElement('span'),controls=document.createElement('div');row.className='explorer-property';row.setAttribute('data-i18n-user-content','');label.textContent=name;row.append(label,controls);container.append(row);
    const update=next=>{let draft;try{draft=JSON.parse(editor.value);}catch{return;}draft[name]=next;editor.value=JSON.stringify(draft,null,2);editor.dispatchEvent(new Event('input',{bubbles:true}));};
    if(Array.isArray(value)){
     if(name.includes('Color')){const input=document.createElement('input');input.type='color';input.value='#'+value.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');input.setAttribute('aria-label',name);input.oninput=()=>update([1,3,5].map(start=>parseInt(input.value.slice(start,start+2),16)/255));controls.append(input);}
     else {const axes=value.length===4?['X scale','X offset','Y scale','Y offset']:['X','Y','Z'];const inputs=value.map((component,index)=>{const input=document.createElement('input');input.type='number';input.step='any';input.value=component;input.setAttribute('aria-label',name+' '+axes[index]);input.title=axes[index];controls.append(input);return input;});for(const input of inputs)input.oninput=()=>update(inputs.map(i=>Number(i.value)));}
    }else{
     const input=document.createElement(name==='Text'?'textarea':'input');input.dir=name==='Text'?'auto':'ltr';input.setAttribute('aria-label',name);if(typeof value==='boolean'){input.type='checkbox';input.checked=value;input.onchange=()=>update(input.checked);}else {if(typeof value==='number'){input.type='number';input.step='any';}input.value=value;input.oninput=()=>update(typeof value==='number'?Number(input.value):input.value);}input.disabled=name==='ClassName';controls.append(input);
    }
   }
  }
  async function push(){
   clearTimeout(timer);if(busy||!dirty()||!selected||!active)return;
   const id=selected.id,context=session,base=expected,source=editor.value,isScript=!!selected.script;
   let dispatched=false;busy=true;message('Syncing to Studio…');
   try{
    const request=isScript?{action:'write',id,session:context,expected:base,source}:{action:'write',id,session:context,properties:JSON.parse(source),expected_properties:JSON.parse(base)};
    dispatched=true;const result=await api(request);
    if(session!==context||selected?.id!==id)return;
    if(result.session!==context||(isScript&&result.source!==source))throw Error('Studio source does not match this edit. Reload and merge before retrying.');
    const accepted=isScript?source:JSON.stringify(result.properties,null,2);
    if(editor.value===source&&!isScript){editor.value=accepted;lines();renderProperties(result.properties);}
    if(result.path){find('path').setAttribute('data-i18n-user-content','');find('path').textContent=result.path;}expected=accepted;blocked=false;store();message(dirty()?'New edits waiting to sync':'In sync with Studio');
   }catch(error){blocked=dispatched;message(String(error.message||error)+' Your draft is preserved.');}
   finally{busy=false;find('push').disabled=!dirty();find('compare').disabled=!selected;if(dirty()&&!blocked&&auto.checked&&active)timer=setTimeout(push,700);}
  }
  async function select(node){
   if(busy){message('Wait for the current push to finish.');return;}
   clearTimeout(timer);store();const generation=++epoch;
   try{
    const result=await api({action:'read',id:node.id,session});if(generation!==epoch)return;
    selected={...node,script:!!result.script};expected=result.script?result.source:JSON.stringify(result.properties,null,2);blocked=false;
    for(const name of ['path','selection','kind'])find(name).setAttribute('data-i18n-user-content','');
    find('path').textContent=result.path||node.name;find('selection').textContent=node.name;find('kind').textContent=result.script?'SCRIPT':node.class||'OBJECT';find('empty').hidden=true;editor.value=expected;editor.disabled=false;
    find('properties').hidden=!!result.script;if(!result.script)renderProperties(result.properties);editor.setAttribute('aria-label',result.script?'Script source':'Object properties JSON');
    host.querySelector('.explorer-editor').hidden=!result.script;
    let saved;try{saved=JSON.parse(localStorage.getItem(key())||'null');}catch{}
    if(saved&&typeof saved.source==='string'){editor.value=saved.source;if(typeof saved.expected==='string')expected=saved.expected;blocked=true;message('Restored local draft. Compare with Studio, merge changes and push manually.');}else message(result.script?'In sync with Studio':'Object properties');
    if(!result.script){try{renderProperties(JSON.parse(editor.value));}catch{}}find('comparison').hidden=true;lines();find('push').disabled=!dirty();find('compare').disabled=false;
    tree.querySelectorAll('[aria-selected]').forEach(row=>row.setAttribute('aria-selected',String(row.dataset.id===node.id)));
   }catch(error){message(error.message||String(error));}
  }
  async function children(id,parent,offset=0){
   const generation=epoch,result=await api({action:'tree',id,session:session||undefined,offset});
   if(generation!==epoch)return;
   if(session&&result.session!==session){message('Studio session changed. Refresh Explorer.');return;}
   session=result.session;
   const fragment=document.createDocumentFragment();
   for(const node of result.nodes){
    const wrap=document.createElement('div'),row=document.createElement('button'),group=document.createElement('div');
    row.type='button';row.setAttribute('role','treeitem');row.setAttribute('aria-selected','false');row.dataset.id=node.id;row.dataset.name=node.name.toLowerCase();row.className='explorer-node';
    const twist=document.createElement('span');twist.textContent=node.children?'▸':' ';twist.setAttribute('aria-hidden','true');
    const icon=document.createElement('span');icon.className='explorer-node-icon';icon.setAttribute('aria-hidden','true');
    const shape=node.script?'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h5':node.class==='Folder'?'M3 7V5h7l2 3h9v12H3z':'m12 3 9 5v9l-9 5-9-5V8zm0 10 9-5m-9 5L3 8m9 5v9';
    icon.innerHTML='<svg viewBox="0 0 24 24"><path d="'+shape+'"/></svg>';
    row.dataset.kind=node.script?'script':node.class==='Folder'?'folder':'object';
    const label=document.createElement('span');label.className='explorer-node-label';label.setAttribute('data-i18n-user-content','');label.textContent=node.name;
    const kind=document.createElement('span');kind.className='explorer-node-class';kind.setAttribute('data-i18n-user-content','');kind.textContent=node.class||'';
    row.append(twist,icon,label,kind);if(node.children)row.setAttribute('aria-expanded','false');group.setAttribute('role','group');group.hidden=true;wrap.append(row,group);fragment.append(wrap);
    let loaded=false;
    row.onclick=async event=>{
     if(node.children&&event.target===twist){group.hidden=!group.hidden;row.setAttribute('aria-expanded',String(!group.hidden));twist.textContent=group.hidden?'▸':'▾';if(!loaded){loaded=true;try{await children(node.id,group);}catch(error){loaded=false;message(error.message||String(error));}}}
     else await select(node);
    };
   }
   parent.append(fragment);
   if(result.next_offset!=null){const more=document.createElement('button');more.textContent='Load more objects';more.onclick=async()=>{more.disabled=true;try{await children(id,parent,result.next_offset);more.remove();}catch(error){more.disabled=false;message(error.message||String(error));}};parent.append(more);}localize();
  }
  async function refresh(){
   active=true;clearTimeout(timer);if(busy){message('Wait for the current push to finish.');return;}
   store();++epoch;selected=null;expected='';session='';tree.replaceChildren();editor.disabled=true;editor.value='';lines();find('push').disabled=true;find('compare').disabled=true;find('empty').hidden=false;find('properties').hidden=true;find('comparison').hidden=true;host.querySelector('.explorer-editor').hidden=true;for(const name of ['path','selection','kind'])find(name).removeAttribute('data-i18n-user-content');find('path').textContent='Select a script or object';find('selection').textContent='Object details';find('kind').textContent='INSPECT';
   auto.checked=preferences().rsExplorerAutoSync!==false;find('auto-label').textContent=auto.checked?'ON':'OFF';
   try{await children('root',tree);message('Game loaded. Expand objects to browse scripts.');}catch(error){message(error.message||String(error));}finally{localize();}
  }
  editor.addEventListener('input',()=>{lines();store();message('Local edits waiting to sync');clearTimeout(timer);if(auto.checked&&!blocked&&active)timer=setTimeout(push,700);});
  editor.addEventListener('scroll',()=>find('lines').scrollTop=editor.scrollTop);
  editor.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();void push();}});
  auto.onchange=()=>{find('auto-label').textContent=auto.checked?'ON':'OFF';void setPreference({rsExplorerAutoSync:auto.checked}).catch(error=>message(error.message||String(error)));clearTimeout(timer);if(auto.checked&&dirty()&&!blocked)timer=setTimeout(push,700);localize();};
  find('filter').oninput=()=>{const query=find('filter').value.toLowerCase();tree.querySelectorAll('.explorer-node').forEach(row=>{row.hidden=!!query&&!row.dataset.name.includes(query);});};
  find('compare').onclick=async()=>{if(!selected||busy)return;const id=selected.id,context=session;try{const latest=await api({action:'read',id,session:context});if(selected?.id!==id||session!==context||latest.session!==context)return;const latestText=latest.script?latest.source:JSON.stringify(latest.properties,null,2);find('studio').textContent=latestText;find('comparison').hidden=false;find('comparison').open=true;expected=latestText;blocked=true;store();message('Compare the Studio source below with your draft. Merge changes, then push manually.');}catch(error){message(error.message||String(error));}};
  find('push').onclick=push;find('refresh').onclick=refresh;
  localize();return {refresh,pause(){active=false;clearTimeout(timer);store();},push};
 }
 return {mount};
})();
if(typeof module!=='undefined')module.exports=synerixcodeExplorerUI;
