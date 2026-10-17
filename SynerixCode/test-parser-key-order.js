// Tool-call formats that 1.19.35 dropped although the command was complete:
// name after params, a trailing comma, and NO-BREAK SPACE between tokens. Each
// cost a parse-error retry turn (or ended the run as plain text).
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('core/parser.js','utf8')+';globalThis.P=RSParse;',c);const P=c.P;
const one=(t)=>{const r=P.parseToolCalls(t);assert.equal(r.length,1,t);return JSON.parse(JSON.stringify(r[0]));};
assert.deepEqual(one('{"params":{"code":"print(1)"},"command":"execute_luau"}'),{tool:'execute_luau',arguments:{code:'print(1)'}});
assert.deepEqual(one('Running it now:\n```json\n{"params":{"code":"local t = {a={}}"},"command":"execute_luau"}\n```'),{tool:'execute_luau',arguments:{code:'local t = {a={}}'}});
assert.deepEqual(one('{"arguments":{"path":"game.Workspace.S"},"tool":"read_script"}'),{tool:'read_script',arguments:{path:'game.Workspace.S'}});
assert.deepEqual(one('{"command":"read_script","params":{"path":"a",},}'),{tool:'read_script',arguments:{path:'a'}});
assert.deepEqual(one('{"command":"x","params":{"list":[1,2,],"s":"keep, ]"}}'),{tool:'x',arguments:{list:[1,2],s:'keep, ]'}},'commas inside strings are untouched');
assert.deepEqual(one('{"command":\u00a0"list_commands",\u00a0"params":\u00a0{}}'),{tool:'list_commands',arguments:{}});
assert.equal(one('{"command":"x","params":{"s":"a\u00a0b"}}').arguments.s,'a\u00a0b','NBSP inside strings is preserved');
// Streaming: the outer object is still open although params already closed.
assert.equal(P.hasOpenToolBlock('{"params":{"code":"print(1)"},"command":"execute_lu'),true);
assert.equal(P.hasOpenToolBlock('{"params":{"code":"print(1)"},"command":"execute_luau"}'),false);
assert.equal(P.hasOpenToolBlock('{"command":"list_commands"}'),false);
assert.equal(P.hasOpenToolBlock('{"command":"multi_edit","params":{"edits":[{"a":1}'),true);
// Unchanged behaviour.
assert.equal(P.parseToolCalls('I used {braces} in prose and no command.').length,0);
assert.equal(P.parseToolCalls('{"command":"a"} then {"command":"b"}')[0].tool,'a','first command still wins');
assert.equal(P.salvageCutOff('{"command":"x","params":{"a":1,'),null,'cut-off after a comma is still refused');
console.log('PASS: parser accepts params-first, trailing-comma and NBSP-spaced commands; streaming detection follows the outer object.');
