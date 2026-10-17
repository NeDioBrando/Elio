const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parse}=require('./release-tools/node_modules/acorn');
const names=['chatgpt','claude','gemini','kimi','qwen'];
function functionSource(name,fn){const text=fs.readFileSync('providers/'+name+'.js','utf8');let found;function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id.name===fn)found=text.slice(n.start,n.end);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(parse(text,{ecmaVersion:'latest'}));assert(found);return found;}
(async()=>{
 let checks=0;
 for(const name of names)for(const phase of ['unlock','write','cleanup']){
  let editable=false,opacity='1',caret='auto',injectingClass=false,clicks=0;
  const fault=()=>{throw Error('fixture fault');};
  const style={get opacity(){return opacity;},set opacity(v){opacity=v;},get caretColor(){return caret;},set caretColor(v){if(name==='chatgpt'&&phase==='unlock'&&v==='transparent')fault();caret=v;}};
  const editor={style,tagName:'DIV',setAttribute(k,v){if(k==='contenteditable'){editable=v==='true';if(phase==='unlock'&&editable)fault();if(phase==='cleanup'&&!editable)fault();}if(k==='readonly'){editable=false;if(phase==='cleanup')fault();}},removeAttribute(){editable=true;if(phase==='unlock')fault();},getAttribute:()=> '1',dispatchEvent:fault};
  const context={getEditor:()=>editor,truncateForSend:x=>x,safeRead:(fn,fallback)=>{try{return fn();}catch{return fallback;}},document:{documentElement:{classList:{add:()=>injectingClass=true,remove:()=>injectingClass=false}}},setEditorText:fault,typeEditorText:fault,editorText:()=>'',rememberSentResponse:()=>{},_nativeSetter:{call:fault},hasPendingAttachment:()=>false,waitFor:async()=>true,sendButton:()=>({click(){clicks++;}}),diag:()=>{},Event:function(){}};
  vm.createContext(context);vm.runInContext('let _locked=true,_injecting=false;'+functionSource(name,'typeAndSend')+';this.send=typeAndSend;this.injecting=()=>_injecting;',context);
  await assert.rejects(context.send('text'),/fixture fault/);
  assert.equal(editable,false,name+' '+phase+' restores editor lock');assert.equal(context.injecting(),false,name+' releases input ownership');assert.equal(injectingClass,false,name+' clears injection class');assert.equal(opacity,'1',name+' restores visibility');assert.equal(clicks,0,name+' does not submit after a write failure');checks++;
 }
 // A failing focus must still relock a temporarily enabled DeepSeek rich editor.
 {const editor={tagName:'DIV',getAttribute:()=> 'false',setAttribute(k,v){this.editable=v;},focus(){throw Error('focus fault');},dispatchEvent(){},editable:'false'};const context={window:{},document:{},InputEvent:function(){},safeRead:(fn,f)=>{try{return fn();}catch{return f;}}};vm.createContext(context);vm.runInContext(functionSource('deepseek','setTextareaValue')+';this.write=setTextareaValue;',context);context.write(editor,'text');assert.equal(editor.editable,'false');checks++;}
 // A delayed screenshot receipt never authorizes another native submission.
 for(const scenario of ['delayed-receipt','upload-failed','not-ready']){
  let clicks=0,waits=0;const editor={setAttribute(){},style:{}};
  const c={getEditor:()=>editor,truncateForSend:x=>x,typeEditorText:async()=>{},attachImages:async()=>scenario!=='upload-failed',waitFor:async()=>++waits===1&&scenario!=='not-ready',sendButton:()=>({disabled:false,click(){clicks++;}}),safeRead:(fn,f)=>{try{return fn();}catch{return f;}},editorText:()=> 'pending',stopButton:()=>null};
  vm.createContext(c);vm.runInContext('let _locked=false;'+functionSource('claude','typeAndSend')+';this.send=typeAndSend;',c);
  if(scenario==='delayed-receipt')await c.send('text',[{}]);else await assert.rejects(c.send('text',[{}]),/not (?:confirm|ready)/);
  assert.equal(clicks,scenario==='delayed-receipt'?1:0,scenario);checks++;
 }
 console.log('PASS '+checks+' input ownership, visibility and lock cleanup failure scenarios.');
})().catch(e=>{console.error(e);process.exitCode=1;});
