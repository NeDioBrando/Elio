const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM('',{url:'https://app.clickup.com/123/ai/brain',runScripts:'outside-only'}),w=dom.window;
try{
  w.eval(fs.readFileSync('providers/clickup.js','utf8')+';window.P=RSProvider;');
  for(const [file,symbol]of [['core/config.js','RS'],['core/ultracode.js','elioUltracode'],['core/memory.js','elioMemory']])w.eval(fs.readFileSync(file,'utf8')+';window.'+symbol+'='+symbol+';');
  w.__rsThinkingLevel=()=> 'ultracode';w.__rsShowApproach=()=>false;
  w.currentProject='project-a';w.personalMemory={automatic:false,entries:Array.from({length:30},(_,i)=>({id:'note-'+i,title:'Preference '+i,text:('Saved context '+i+' ').repeat(200),project:'project-a'}))};
  w.personalMemory.entries.push({id:'other',title:'OTHER PROJECT',text:'Must stay scoped',project:'project-b'});
  w.ui={getCustomPrompt:()=>''};w.elioClarification={INSTRUCTION:'Use elio_clarify for necessary user questions.'};w.A={};
  const main=fs.readFileSync('core/main.js','utf8'),start=main.indexOf('function personalMemoryContext()'),end=main.indexOf('  // ── Periodic system-prompt',start);
  assert(start>0&&end>start);w.eval(main.slice(start,end)+';window.context=personalMemoryContext;window.prompt=systemPrompt;');
  const compact=w.prompt(),notes=w.context();
  assert(compact.includes('ULTRA —'),'selected Ultra policy must remain');assert(!notes.includes('OTHER PROJECT'));
  assert(notes.length<3000,'long saved notes use bounded previews');assert(notes.includes('elio_memory action read, id note-'),'full notes remain addressable');
  const configured=w.P.sysMaxChars;w.P.sysMaxChars=0;const previous=w.prompt();w.P.sysMaxChars=configured;
  assert(compact.length<previous.length-15000,'reduce defaults and note previews without cutting custom instructions');
  const custom='Exact preference 🧪 C:\\project\\a.lua\n'.repeat(2000);w.ui.getCustomPrompt=()=>custom;
  assert(w.prompt().includes(custom.trim()),'large custom preferences remain intact');
  assert(w.P.isPolicyRefusal("I don't run handshakes for anything outside ClickUp."));
  assert(w.P.isPolicyRefusal("I'm not emitting command payloads for an external bridge to execute."));
  assert(!w.P.isPolicyRefusal('I am running the command you requested.'));
  console.log('PASS compact ClickUp defaults and memory reader, exact custom preferences, selected Ultra and model-refusal classification',JSON.stringify({compactChars:compact.length,previousChars:previous.length}));
}finally{w.close();}
