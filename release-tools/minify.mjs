// SPDX-License-Identifier: GPL-3.0-or-later
// npm install --prefix release-tools terser@5.44.0 acorn@8.15.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { minify } from 'terser';
import { parse } from 'acorn';
const root = path.resolve(process.argv[2]);
function ast(source) {
  return JSON.stringify(parse(source, {ecmaVersion:'latest',sourceType:'script'}), function(key,value) {
    if (key === 'key' && this.type === 'Property' && !this.computed && (value.type === 'Identifier' || value.type === 'Literal')) return {type:'PropertyKey',value:String(value.type === 'Identifier' ? value.name : value.value)};
    if (key === 'start' || key === 'end' || key === 'loc' || (key === 'raw' && this.type === 'Literal') || (key === 'shorthand' && this.type === 'Property')) return undefined;
    return value;
  });
}
const report = [];
for (const base of [root,path.join(root,'elio-Extension')]) {
  const paths = ['background.js','popup.js','ollama-page.js'];
  for (const folder of ['core','providers']) for (const name of fs.readdirSync(path.join(base,folder))) if (name.endsWith('.js')) paths.push(folder+'/'+name);
  for (const name of paths) {
    const file=path.join(base,name);if (!fs.existsSync(file)) continue;
    const source=fs.readFileSync(file,'utf8');
    const result=await minify(source,{ecma:2022,compress:false,mangle:false,keep_fnames:true,keep_classnames:true,format:{comments:/^!|@license|@preserve|SPDX/}});
    if (!result.code) throw Error('No production script: '+file);
    const identical = ast(source)===ast(result.code);
    const output = identical ? result.code+'\n' : source;
    fs.writeFileSync(file,output);
    report.push({file:path.relative(root,file),original_bytes:Buffer.byteLength(source),production_bytes:Buffer.byteLength(output),sha256:crypto.createHash('sha256').update(output).digest('hex'),ast_unchanged:true,minified:identical});
  }
}
fs.writeFileSync(path.join(root,'production-build.json'),JSON.stringify({terser:'5.44.0',acorn:'8.15.0',compress:false,mangle:false,files:report},null,2)+'\n');
console.log('Conservative minification verified identical parsed structure for '+report.length+' scripts.');
