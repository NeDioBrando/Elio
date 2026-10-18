const fs=require('fs'),crypto=require('crypto'),{parse}=require(process.cwd()+'/release-tools/node_modules/acorn');
function canonical(node){
 if(!node||typeof node!=='object')return node;if(Array.isArray(node))return node.map(canonical);
 if(node.type==='ChainExpression')return canonical(node.expression);
 if(node.type==='CallExpression'&&node.callee.name==='safeRead')return canonical(node.arguments[0].body);
 if(node.type==='CallExpression'&&['safeQuery','safeQueryAll','safeClosest','safeRect'].includes(node.callee.name)){
 const method={safeQuery:'querySelector',safeQueryAll:'querySelectorAll',safeClosest:'closest',safeRect:'getBoundingClientRect'}[node.callee.name];
 return canonical({type:'CallExpression',callee:{type:'MemberExpression',object:node.arguments[0],property:{type:'Identifier',name:method},computed:false},arguments:node.arguments.slice(1)});
 }
 if(node.type==='CallExpression'&&(node.callee.name==='safeStyle'||node.callee.name==='getComputedStyle'||node.callee.type==='MemberExpression'&&node.callee.object.name==='window'&&node.callee.property.name==='getComputedStyle'))return {type:'CallExpression',callee:{type:'Identifier',name:'getComputedStyle'},arguments:canonical(node.arguments)};
 const result={};for(const [k,v]of Object.entries(node))if(!['start','end','raw','optional'].includes(k))result[k]=canonical(v);return result;
}
function functions(source){const ast=parse(source,{ecmaVersion:'latest'}),out={};function walk(n,parent){if(!n?.type)return;
 if(n.type==='FunctionDeclaration'||n.type==='VariableDeclarator'&&['ArrowFunctionExpression','FunctionExpression'].includes(n.init?.type)){
  const name=n.id?.name;if(name&&!['safeRead','safeQuery','safeQueryAll','safeClosest','safeRect','safeStyle','safePredicate','waitBudget'].includes(name))out[name]=JSON.stringify(canonical(n));
 }
 for(const v of Object.values(n))if(Array.isArray(v))v.forEach(x=>walk(x,n));else if(v?.type)walk(v,n);}
 walk(ast);return out;}
// Targeted ChatGPT completion/send recovery changes are exercised by test-stream-completion.
// Notion's verified startup fast path is covered by full-provider native/fallback fixtures.
// Notion block-transcript/result/readiness changes are covered by test-notion-block-transcript and native Chromium/Firefox block-card fixtures.
// Notion pasteRichText is covered by native Chromium/Firefox startup integration: Firefox creates a separate empty clipboard transfer.
// 1.24.12: Notion draftLooksWritten tolerates Notion's own reformatting of elio startup drafts; covered by test-1.24.10-fixes and test-1.24.11-fixes.
const exceptions={chatgpt:new Set(['genActive','unwedgeStop','unwedgeStopPersistently','writeDraft','typeAndSend','attachImages']),notion:new Set(['draftLooksWritten','edText','normalizedDraft','armPendingAutoStart','prepareSessionStart','navigateToFreshAi','openCleanAi','tick','preprocessMutations','sendButton','isCleanAiLanding','isAiThread','isAiLanding','waitFor','chatList','visible','candidateVisible','controlAvailable','typeAndSend','applyLockAttrs','setInputLock','ensureComposerReady','softGenerationSettled','composerFrame','sendReady','sendControlLike','exactSendControl','pasteRichText','hasEndAlignedAncestor','blockAssistantRoots','immutableKey','immutableSelector','renderImmutableChip','syncImmutableChips','collectItems','isUserItem','isAssistantItem','clearImmutableChip','writeRichTextVerified','pasteRichTextChunked','conversationKey','waitLateConfirm','sendLanded']),deepseek:new Set(['waitFor','composerFrame','setTextareaValue','writeDraft']),copilot:new Set(['waitFor','composerFrame']),claude:new Set(['waitFor','typeAndSend','writeDraft','sendButton','allItems','replyRoot','itemText','classifyText']),gemini:new Set(['typeAndSend']),kimi:new Set(['typeAndSend']),qwen:new Set(['typeAndSend'])};
let total=0;for(const name of fs.readdirSync('test-support/provider-baseline').filter(n=>n.endsWith('.js')&&!n.endsWith('-net.js')&&!['media.js','chatgpt-cm.js'].includes(n))){
 const key=name.slice(0,-3),before=functions(fs.readFileSync('test-support/provider-baseline/'+name,'utf8')),after=functions(fs.readFileSync('providers/'+name,'utf8'));
 for(const [fn,ast]of Object.entries(before)){if(fn==='RSProvider'||fn==='waitFor'||fn==='truncateForSend'||name==='qwen-net.js'&&fn==='consume'||exceptions[key]?.has(fn))continue;if(ast!==after[fn])(()=>{throw Error('Unexpected healthy control-flow change: '+name+' > '+fn);})();else total++;}
}
console.log('PASS '+total+' original function bodies preserve healthy control flow after unwrapping guarded reads.');
