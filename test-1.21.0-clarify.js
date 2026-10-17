// 1.21.0 regression: synerixcode_clarify rejected near-miss field names
// (recommend/reason) forever, so the agent hit "Repeated tool failures".
const assert = require('assert');
const C = require('./core/clarification.js');
const base = { question: 'Which scope?', options: [{ id: 'a', label: 'One screen', scope: 'Only the current screen.' }, { id: 'b', label: 'All screens', scope: 'Every screen.' }], questions: ['Keep the colours?'] };
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('ok - ' + name); };
ok('canonical fields still validate', () => { const v = C.validate({ ...base, recommended_id: 'a', recommendation: 'Smallest change.' }); assert.strictEqual(v.recommended_id, 'a'); });
ok('recommend + reason aliases accepted', () => { const v = C.validate({ ...base, recommend: 'a', reason: 'Smallest change.' }); assert.strictEqual(v.recommended_id, 'a'); assert.strictEqual(v.recommendation, 'Smallest change.'); });
ok('recommendation holding the id plus reason', () => { const v = C.validate({ ...base, recommendation: 'b', recommended_id: 'b', reason: 'Consistent.' }); assert.strictEqual(v.recommendation, 'Consistent.'); });
ok('recommendation by label', () => { const v = C.validate({ ...base, recommended: 'All screens', rationale: 'Consistent.' }); assert.strictEqual(v.recommended_id, 'b'); });
ok('title/description options and string question', () => { const v = C.validate({ question: 'Q?', options: [{ id: 1, title: 'X', description: 'x' }, { id: 2, title: 'Y', description: 'y' }], recommended_id: 1, why: 'Fast.', questions: 'Anything else?' }); assert.deepStrictEqual(v.questions, ['Anything else?']); assert.strictEqual(v.recommended_id, '1'); });
ok('missing recommendation names the exact fields', () => { assert.throws(() => C.validate({ ...base }), /recommended_id.*\(a, b\).*recommendation/); });
ok('unknown recommended id still rejected', () => { assert.throws(() => C.validate({ ...base, recommended_id: 'zzz', recommendation: 'r' })); });
console.log(passed + ' passed');
