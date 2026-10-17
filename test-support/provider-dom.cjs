// Extract the real adapter's read helpers when a fixture evaluates one function.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const installed = new WeakSet();
function prelude(source = fs.readFileSync(path.join(__dirname, '../providers/chatgpt.js'), 'utf8')) {
  const begin = source.indexOf('  let domReadErrors = 0;');
  const end = source.indexOf('\n  }', source.indexOf('  function waitBudget(', begin)) + 4;
  if (begin < 0 || end <= begin) throw new Error('Provider DOM helpers missing');
  return source.slice(begin, end) + '\n';
}
function runInContext(code, context, ...options) {
  if (/safeRead|safeQuery|safeClosest|safeRect|safeStyle|safePredicate|waitBudget/.test(code) && !code.includes('let domReadErrors =') && !installed.has(context)) {
    vm.runInContext(prelude(), context);
    installed.add(context);
  }
  return vm.runInContext(code, context, ...options);
}
module.exports = {prelude, runInContext};
