// SPDX-License-Identifier: GPL-3.0-or-later
// synerixcode-owned interface text only. Never translates host websites, chat,
// user values, tool names/protocols, source code, or external-service errors.
(function(global){
'use strict';
const languages=Object.freeze([
 {code:'en',name:'English',nativeName:'English',dir:'ltr'},
 {code:'es',name:'Spanish',nativeName:'Español',dir:'ltr'},
 {code:'fr',name:'French',nativeName:'Français',dir:'ltr'},
 {code:'ru',name:'Russian',nativeName:'Русский',dir:'ltr'},
 {code:'ar',name:'Arabic',nativeName:'العربية',dir:'rtl'},
 {code:'zh-CN',name:'Chinese (Simplified)',nativeName:'简体中文',dir:'ltr'},
 {code:'zh-TW',name:'Chinese (Traditional)',nativeName:'繁體中文',dir:'ltr'},
 {code:'ja',name:'Japanese',nativeName:'日本語',dir:'ltr'},
 {code:'ko',name:'Korean',nativeName:'한국어',dir:'ltr'},
 {code:'de',name:'German',nativeName:'Deutsch',dir:'ltr'},
 {code:'pt-BR',name:'Portuguese (Brazil)',nativeName:'Português (Brasil)',dir:'ltr'},
 {code:'it',name:'Italian',nativeName:'Italiano',dir:'ltr'},
 {code:'hi',name:'Hindi',nativeName:'हिन्दी',dir:'ltr'},
 {code:'tr',name:'Turkish',nativeName:'Türkçe',dir:'ltr'},
 {code:'pl',name:'Polish',nativeName:'Polski',dir:'ltr'}
]);
const normalize=code=>languages.find(x=>x.code===code)?.code||'en';
const key=text=>String(text??'').replace(/\s+/g,' ').trim();
const data=()=>global.synerixcodeLocaleData||{en:{}};
const has=source=>Object.prototype.hasOwnProperty.call(data().en||{},key(source));
let language='en';const bindings=new Set(),nodeBindings=new WeakMap(),mounts=new WeakMap(),owners=new Set(),pickers=new Set(),listeners=new Set();
const EXCLUDE='.brand-word,.pc-ultra-label,script,style,textarea,input,pre,code,kbd,samp,[contenteditable],[data-i18n-user-content],[data-pc-language-options],.rs-mcp-info,.rs-task-title,.rs-task-label,.rs-tool-raw,.rs-tool-output,.rs-template-name,.rs-memory-content,.rs-lib-card,.rs-cowork-item,.rs-task-row,[data-prompt-index]';
const SAFE_NEW='button,label,option,summary,[data-pc-i18n],[data-synerixcode-version],#rs-action,#rs-status,#rs-state,#titleEffort,#sidebarEffort';
const excluded=node=>{const e=node.nodeType===1?node:node.parentElement;return !e||!!e.closest(EXCLUDE);};
function t(source,values){
 const k=key(source),value=(data()[language]||{})[k];let result=typeof value==='string'&&value?value:String(source??'');
 if(values)result=result.replace(/\{([A-Za-z0-9_]+)\}/g,(m,k)=>Object.prototype.hasOwnProperty.call(values,k)?String(values[k]):m);
 return result;
}
function addBinding(node,attr){
 if(excluded(node)&&!(attr&&['placeholder','aria-label'].includes(attr)&&node.matches?.('input,textarea')&&!node.parentElement?.closest('[data-i18n-user-content]')))return;
 const raw=attr?node.getAttribute(attr):node.nodeValue;if(!raw||!has(raw))return;
 let list=nodeBindings.get(node);if(!list){list=new Map();nodeBindings.set(node,list);}const id=attr||'text';
 if(list.has(id)){applyBinding(list.get(id));return;}
 const b={node,attr,source:key(raw),raw,last:raw};list.set(id,b);bindings.add(b);applyBinding(b);
}
function applyBinding(b){
 const node=b.node;if(!node.isConnected||(excluded(node)&&!(b.attr&&['placeholder','aria-label'].includes(b.attr)&&node.matches?.('input,textarea')&&!node.parentElement?.closest('[data-i18n-user-content]'))))return;
 const current=b.attr?node.getAttribute(b.attr):node.nodeValue;
 if(current!==b.last){if(!has(current))return;b.source=key(current);b.raw=current;}
 const translated=t(b.source),leading=b.raw.match(/^\s*/)?.[0]||'',trailing=b.raw.match(/\s*$/)?.[0]||'';
 const next=language==='en'?b.raw:leading+translated+trailing;
 if(current!==next){if(b.attr)node.setAttribute(b.attr,next);else node.nodeValue=next;}b.last=next;
}
function scan(root){
 if(!root||excluded(root))return;
 if(root.nodeType===3){addBinding(root);return;}
 const doc=root.ownerDocument||global.document;
 if(!doc)return;
 for(const e of [root,...root.querySelectorAll('*')]){
  if(excluded(e)){if(e.matches?.('input,textarea'))for(const attr of ['placeholder','aria-label'])if(e.hasAttribute(attr))addBinding(e,attr);continue;}
  for(const attr of ['title','aria-label','placeholder'])if(e.hasAttribute?.(attr))addBinding(e,attr);
  for(const n of e.childNodes||[])if(n.nodeType===3)addBinding(n);
 }
}
function ensureStyles(doc){
 if(doc.getElementById('pc-language-styles'))return;
 const style=doc.createElement('style');style.id='pc-language-styles';style.textContent=`
 .language-card .settings-summary p{font-size:14px!important;line-height:1.5!important}
 .pc-language-picker{display:grid;gap:10px;min-width:0;width:100%;max-width:520px;font-family:inherit}
 .pc-language-picker label{display:block;font-size:14px;font-weight:600;line-height:1.5}
 .pc-language-picker input,.pc-language-picker select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--rs-border,rgba(160,175,195,.5));border-radius:8px;background:var(--rs-bg,#151a22);color:var(--rs-text,#f4f6fb);font:inherit;font-size:16px;line-height:1.5}
 .pc-language-picker select option{background:#151a22;color:#f4f6fb}
 .pc-language-picker :is(input,select):focus-visible{outline:2px solid #e9ba53;outline-offset:2px}
 .pc-language-picker small{font-size:14px;line-height:1.5;color:inherit;opacity:.85}
 [data-pc-locale] :is(pre,code,kbd,samp){direction:ltr;unicode-bidi:isolate;text-align:start}
 @media(forced-colors:active){.pc-language-picker :is(input,select){background:Canvas;color:CanvasText;border-color:ButtonText}}
 `;(doc.head||doc.documentElement).append(style);
}
function applyOwner(root){if(!root.isConnected)return;const lang=languages.find(x=>x.code===language);root.setAttribute('lang',language);root.setAttribute('dir',lang.dir);root.setAttribute('data-pc-locale',language);}
function mountStatic(root){
 if(!root)return null;ensureStyles(root.ownerDocument||global.document);owners.add(root);applyOwner(root);scan(root);
 if(mounts.has(root))return mounts.get(root);
 let busy=false;
 const observer=new MutationObserver(records=>{
  if(busy)return;busy=true;
  try{
   for(const record of records){
    if(record.type==='characterData'){const b=nodeBindings.get(record.target)?.get('text');if(b)applyBinding(b);}
    if(record.type==='attributes'){const b=nodeBindings.get(record.target)?.get(record.attributeName);if(b)applyBinding(b);}
    if(record.type==='childList'){
     // New user data is never generally scanned. Only explicit UI controls or
     // marked built-in roots are eligible after the initial static snapshot.
     if(record.target.nodeType===1&&record.target.matches(SAFE_NEW)&&!excluded(record.target))scan(record.target);
     for(const n of record.addedNodes)if(n.nodeType===1&&!excluded(n)){
      if(n.matches(SAFE_NEW))scan(n);
      for(const e of n.querySelectorAll(SAFE_NEW))scan(e);
     }
    }
   }
   for(const b of bindings)if(!b.node.isConnected)bindings.delete(b);
  }finally{busy=false;}
 });observer.observe(root,{subtree:true,characterData:true,childList:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});
 const result={refresh:()=>scan(root),disconnect(){observer.disconnect();owners.delete(root);mounts.delete(root);}};mounts.set(root,result);return result;
}
function setLanguage(value){
 const next=normalize(value);language=next;
 for(const owner of owners){if(owner.isConnected)applyOwner(owner);else owners.delete(owner);}
 for(const b of bindings){if(b.node.isConnected)applyBinding(b);else bindings.delete(b);}
 for(const picker of pickers){if(picker.host.isConnected)picker.refresh(next);else pickers.delete(picker);}
 for(const fn of listeners)try{fn(next);}catch{}
 return next;
}
function fold(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();}
let pickerId=0;
function mountPicker(host,options={}){
 if(!host)return null;if(host._pcLanguagePicker){host._pcLanguagePicker.refresh(options.value||language);return host._pcLanguagePicker;}
 ensureStyles(host.ownerDocument);host.classList.add('pc-language-picker');host.setAttribute('data-pc-language-picker','');
 const doc=host.ownerDocument,id='pc-language-'+(++pickerId),searchLabel=doc.createElement('label'),search=doc.createElement('input'),label=doc.createElement('label'),select=doc.createElement('select'),status=doc.createElement('small'),help=doc.createElement('small');
 search.id=id+'-search';search.type='search';search.autocomplete='off';search.dir='auto';searchLabel.htmlFor=search.id;
 select.id=id+'-select';select.setAttribute('data-pc-language-options','');label.htmlFor=select.id;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 let value=normalize(options.value||language),saving=false,saveError=false;
 function fill(){
  const q=fold(search.value);const filtered=languages.filter(x=>fold(x.name+' '+x.nativeName+' '+x.code).includes(q));
  select.replaceChildren();
  // Filtering must never select/save a different language by itself.
  for(const lang of languages.filter(x=>x.code===value||filtered.includes(x))){const o=doc.createElement('option');o.value=lang.code;o.textContent=lang.nativeName===lang.name?lang.name:lang.nativeName+' — '+lang.name;o.lang=lang.code;o.dir=lang.dir;select.append(o);}
  select.value=value;select.disabled=saving||!filtered.length;
  searchLabel.textContent=t('Search languages');search.placeholder=t('Search by name or language code');label.textContent=t('Interface language');help.textContent=t('Changes synerixcode’s interface in the desktop app and extension.');
  status.textContent=saving?t('Saving language…'):saveError?t('Language could not be saved. Try again.'):!filtered.length?t('No languages found.'):'';
 }
 search.addEventListener('input',fill);
 select.addEventListener('change',async()=>{if(saving)return;const prior=value,next=normalize(select.value);saving=true;saveError=false;fill();try{if(options.onChange)await options.onChange(next);value=next;setLanguage(next);}catch{value=prior;select.value=prior;saveError=true;}finally{saving=false;fill();}});
 host.append(searchLabel,search,label,select,status,help);
 const picker={host,refresh(next){value=normalize(next);fill();},get value(){return value;},destroy(){pickers.delete(picker);host.replaceChildren();delete host._pcLanguagePicker;}};
 host._pcLanguagePicker=picker;pickers.add(picker);fill();return picker;
}
const api={languages,normalize,t,setLanguage,getLanguage:()=>language,mountStatic,mountPicker,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
global.synerixcodeI18n=api;
})(globalThis);
