// 1.21.0 regression: saved memory notes have titles; Engram settings card removed.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = __dirname; let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok', name); } catch (e) { failed++; console.log('FAIL', name, e.message); } }
const src = fs.readFileSync(path.join(root, 'core/memory.js'), 'utf8');
const ext = fs.readFileSync(path.join(root, 'synerixcode-Extension/core/memory.js'), 'utf8');
const ctx = { module: { exports: {} } }; vm.createContext(ctx); vm.runInContext(src, ctx);
const M = ctx.module.exports;
t('copies in sync', () => assert.strictEqual(src, ext));
t('titleOf uses saved title', () => assert.strictEqual(M.titleOf({ title: ' UI fonts ', text: 'x' }), 'UI fonts'));
t('titleOf derives from first line for old notes', () => assert.strictEqual(M.titleOf({ text: '\n  Combat cooldown\nmore' }), 'Combat cooldown'));
t('titleOf cuts long lines', () => assert.strictEqual(M.titleOf({ text: 'a'.repeat(80) }).length, 61));
t('prompt shows titles', () => { const p = M.prompt({ automatic: true, entries: [{ id: 3, title: 'Fonts', text: 'Use Gotham', project: '' }] }); assert(p.includes('[3] Fonts: Use Gotham')); assert(p.includes('a short title')); });
t('read list includes title', () => { const r = M.read({ entries: [{ id: 1, text: 'Hello world', source: 's' }] }, { action: 'list' }); assert.strictEqual(r.entries[0].title, 'Hello world'); });
t('mount has title inputs and simple layout', () => { assert(src.includes('data-entry-title')); assert(src.includes('data-memory-new-title')); assert(src.includes("createElement('details'); row.setAttribute('data-memory-entry'")); assert(src.includes("title:title.value,text:text.value")); });
t('transfer section collapsed', () => assert(src.includes('<summary>Save or move memory and chats</summary>')));
const html = fs.readFileSync(path.join(root, 'agent/src/desktop.html'), 'utf8');
t('desktop has no Engram UI', () => { assert(!/engram/i.test(html)); assert(html.includes('id="memorySettings"')); });
t('desktop keeps saved chat logs', () => { for (const id of ['savedChatsRefresh', 'savedChatsSelect', 'savedChatsDownload', 'savedChatsStatus']) assert(html.includes('id="' + id + '"'), id); });
t('desktop inline script compiles', () => { const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]); assert(scripts.length); scripts.forEach(s => new vm.Script(s)); });
const main = fs.readFileSync(path.join(root, 'core/main.js'), 'utf8');
t('AI memory tool accepts a title', () => { assert(main.includes("title:{type:'string'},text:{type:'string'}")); assert(main.includes("{action:'remember',title:typeof args.title==='string'")); });
t('main.js compiles', () => new vm.Script(main));
t('memory.js compiles', () => new vm.Script(src));
console.log(`${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
