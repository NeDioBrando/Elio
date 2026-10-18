const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const { JSDOM } = require(process.env.ELIO_TEST_JSDOM || 'jsdom');
const dom = new JSDOM('<div id="rs-root"></div><main><article data-agent-service-scroll-anchor="one"><pre data-block-id="tool-one">{"command":"execute_luau"}</pre></article></main>', { url: 'https://app.notion.com/chat', runScripts: 'outside-only' });
try {
  vm.runInContext(fs.readFileSync('providers/notion.js', 'utf8') + ';this.provider=RSProvider;', dom.getInternalVMContext());
  const d = dom.window.document, p = dom.window.provider;
  let item = d.querySelector('article');
  const content = key => [...d.querySelector('#zs-notion-immutable-cards').sheet.cssRules].find(r => r.selectorText === `[data-block-id="${key}"]::before`)?.style.getPropertyValue('content');
  p.renderImmutableChip(item, { label: 'execute_luau', phase: 'run', detail: 'Running in Studio', owned: true });
  assert.match(content('tool-one'), /⏳/);
  p.renderImmutableChip(item, { phase: 'done', detail: 'Execution finished', owned: true });
  assert.match(content('tool-one'), /✓.*Execution finished/);
  // A stale sweep and a React replacement must both retain the final outcome.
  p.renderImmutableChip(item, { phase: 'run', detail: 'processing', owned: true });
  assert.match(content('tool-one'), /✓.*Execution finished/);
  const old = item, fresh = item.cloneNode(true); old.replaceWith(fresh); item = fresh;
  p.renderImmutableChip(item, { phase: 'run', detail: 'processing', owned: true });
  assert.match(content('tool-one'), /✓.*Execution finished/);
  p.renderImmutableChip(old, {});
  assert.match(content('tool-one'), /✓.*Execution finished/);
  const next = item.cloneNode(true); next.setAttribute('data-agent-service-scroll-anchor', 'two'); next.querySelector('pre').setAttribute('data-block-id', 'tool-two'); item.after(next);
  p.renderImmutableChip(next, { label: 'execute_luau', phase: 'run', detail: 'Running in Studio', owned: true });
  assert.match(content('tool-two'), /⏳.*Running in Studio/);
  p.renderImmutableChip(next, { phase: 'err', detail: 'Studio rejected the command', owned: true });
  p.renderImmutableChip(next, { phase: 'idle', detail: 'processing' });
  assert.match(content('tool-two'), /⚠.*Studio rejected/);
  const host = [...d.querySelector('#zs-notion-immutable-cards').sheet.cssRules].find(r => r.selectorText === '[data-block-id="tool-one"]');
  assert.match(host.style.getPropertyValue('padding'), /^8px 0(?:px)?$/);
  assert.equal(host.style.getPropertyValue('height'), 'auto');
  console.log('Notion final tool status survives stale sweeps and response remounts; distinct commands retain independent running/error states and reserved card spacing.');
} finally { dom.window.close(); }
