// Harmless argument-shape mistakes are repaired before preflight so tools run
// first time; genuine mistakes are still reported back to the model.
const assert = require('node:assert/strict');
const G = require('./core/tool-guard.js');
const tools = [
  { name: 'execute_luau', inputSchema: { type: 'object', properties: { code: { type: 'string' }, datamodel_type: { type: 'string', enum: ['Edit', 'Client', 'Server'] } }, required: ['code'] } },
  { name: 'insert_model', inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: {
    query: { type: 'string' }, count: { type: 'integer' }, anchored: { type: 'boolean' },
    pos: { type: 'array', items: { type: 'number' } }, opts: { type: 'object', properties: { n: { type: 'number' } } },
  } } },
];
let c = { tool: ' insert_model ', arguments: JSON.stringify({ query: 'tree', count: '3', anchored: 'TRUE', pos: '[1,"2",3]', opts: { n: '4.5' } }) };
assert.deepEqual(G.check(G.repair(c, tools), tools), []);
assert.equal(c.tool, 'insert_model');
assert.deepEqual(c.arguments, { query: 'tree', count: 3, anchored: true, pos: [1, 2, 3], opts: { n: 4.5 } });

c = { tool: 'execute_luau', arguments: { code: '```lua\nprint(1)\n```', datamodel_type: 'server' } };
assert.deepEqual(G.check(G.repair(c, tools), tools), []);
assert.equal(c.arguments.code, 'print(1)');
assert.equal(c.arguments.datamodel_type, 'Server');

c = { tool: 'execute_luau', arguments: '' };
G.repair(c, tools); assert.deepEqual(c.arguments, {});

// Genuine mistakes are still caught, and string values are never rewritten.
c = { tool: 'insert_model', arguments: { query: 42, count: '1.5', bogus: 1 } };
const errors = G.check(G.repair(c, tools), tools);
assert(errors.some(e => /query/.test(e)) && errors.some(e => /count/.test(e)) && errors.some(e => /bogus/.test(e)), errors.join('; '));
c = { tool: 'execute_luau', arguments: { code: '"42"' } }; G.repair(c, tools); assert.equal(c.arguments.code, '"42"');
c = { tool: 'execute_luau', arguments: { code: 'local s = "```"' } }; G.repair(c, tools); assert.equal(c.arguments.code, 'local s = "```"');
c = { tool: 'execute_luau', arguments: 'not json' }; G.repair(c, tools);
assert.equal(c.arguments, 'not json'); assert(G.check(c, tools).length, 'unparseable arguments still rejected');
assert.equal(G.repair(null, tools), null);
console.log('Tool guard repairs harmless argument mistakes and still rejects real ones.');
