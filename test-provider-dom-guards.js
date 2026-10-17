const fs=require('node:fs'),assert=require('node:assert/strict'),{parse}=require('./release-tools/node_modules/acorn');
const guardedMethods=new Set(['querySelector','querySelectorAll','closest','getBoundingClientRect','getComputedStyle','getAttribute','hasAttribute','matches','contains','compareDocumentPosition']);
let reads=0,finallyBlocks=0;
for(const name of fs.readdirSync('providers').filter(n=>n.endsWith('.js'))){
 const ast=parse(fs.readFileSync('providers/'+name,'utf8'),{ecmaVersion:'latest'});
 function walk(n,ancestors=[]){if(!n?.type)return;
  if(n.type==='CallExpression'){
   const method=n.callee.type==='Identifier'?(n.callee.name==='getComputedStyle'?n.callee.name:''):n.callee.type==='MemberExpression'?n.callee.property.name:'';
   if(guardedMethods.has(method)){
    const caught=ancestors.some(a=>a.type==='TryStatement'&&n.start>=a.block.start&&n.end<=a.block.end&&a.handler||a.type==='CallExpression'&&a.callee.name==='safeRead');
    assert(caught,name+' unguarded '+method+' at '+n.start);reads++;
   }
  }
  if(n.type==='MemberExpression'&&n.property.name==='title'){assert(ancestors.some(a=>a.type==='CallExpression'&&a.callee.name==='safeRead'),name+' unguarded tooltip read');}
  if(n.type==='BlockStatement')for(let i=0;i<n.body.length;i++){
   const statement=n.body[i],assignment=statement.expression;
   if(assignment?.type==='AssignmentExpression'&&assignment.left.name==='_selfWrite'&&assignment.right.value===true){
    let j=i+1;while(n.body[j]?.type==='VariableDeclaration'&&n.body[j].declarations.every(d=>d.init?.type==='Literal'))j++;const next=n.body[j];assert(next?.type==='TryStatement'&&next.finalizer,name+' selfWrite must immediately enter try/finally');
    let released=false;const scan=x=>{if(!x||typeof x!=='object')return;if(x.type==='AssignmentExpression'&&x.left.name==='_selfWrite'&&x.right.value===false)released=true;for(const v of Object.values(x))if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')scan(v);};scan(next.finalizer);assert(released,name+' finally must release selfWrite');finallyBlocks++;
   }
  }
  for(const v of Object.values(n))if(Array.isArray(v))v.forEach(c=>walk(c,[...ancestors,n]));else if(v?.type)walk(v,[...ancestors,n]);
 }
 walk(ast);
}
assert.equal(finallyBlocks,13,'Every Notion selfWrite control region is protected');
console.log('PASS '+reads+' guarded query/layout/attribute reads and '+finallyBlocks+' input-control finally regions.');
