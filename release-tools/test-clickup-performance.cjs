// SPDX-License-Identifier: GPL-3.0-or-later
// Offline Chromium regression: long ClickUp histories must not be re-walked on
// every count/read/poll, sweep or unrelated mutation. Reuses the sanitized DOM,
// route interception and mocked chrome.runtime of test-clickup-browser.cjs.
// No live service, install, packaging, native tools or network is used.
//
// Run from a complete elio source tree:
//   ELIO_CHROMIUM=/usr/local/bin/chromium node release-tools/test-clickup-performance.cjs
// For an overlay before packaging, point ELIO_PERF_ROOT to a complete fixture
// tree and ELIO_PERF_OVERLAY to the overlay. Overrides happen IN MEMORY only;
// every executed JS source hash is recorded. NODE_PATH may point to existing deps.
// ELIO_PERF_REPORT is an optional JSON output path.
// ELIO_PERF_REPORT_ONLY=1 records
// structural failures without failing (useful for reproducible old baselines).
// Timing/heartbeat/long tasks are diagnostic, NOT brittle pass/fail criteria.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(process.env.ELIO_PERF_ROOT || process.cwd());
const overlay = process.env.ELIO_PERF_OVERLAY && path.resolve(process.env.ELIO_PERF_OVERLAY);
const reportOnly = process.env.ELIO_PERF_REPORT_ONLY === '1';
const minimal = process.env.ELIO_PERF_DIAGNOSTIC_UNINSTRUMENTED === '1';
assert(!minimal || reportOnly, 'uninstrumented diagnostic runs cannot count as structural validation');
const reportPath = path.resolve(process.env.ELIO_PERF_REPORT || 'clickup-performance-report.json');
const sizes = (process.env.ELIO_PERF_SIZES || '64,512').split(',').map(Number);
assert(sizes.length && sizes.every(n => Number.isInteger(n) && n >= 16 && n <= 4096), 'valid fixture sizes');
process.chdir(root); // The shared fixture deliberately uses source-relative paths.
const { pageFor } = require(path.join(root, 'release-tools/test-clickup-browser.cjs'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = manifest.content_scripts.find(x => x.js.includes('providers/clickup.js')).js;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sources = files.map(file => {
  const base = fs.readFileSync(path.join(root, file), 'utf8');
  const chosen = overlay && fs.existsSync(path.join(overlay, file)) ? path.join(overlay, file) : path.join(root, file);
  return { file, base, source: fs.readFileSync(chosen, 'utf8'), chosen };
});
const report = {
  schema: 1, validationEligible: !minimal, countersEnabled: !minimal, fixture: 'offline sanitized test-clickup-browser.cjs; active AI-agent thread',
  startedAt: new Date().toISOString(), root, overlay: overlay || null,
  browser: null, payloadCharsPerTurn: 8192, fragmentsPerTurn: 16, pollCycles: 8,
  sourceHashes: Object.fromEntries(sources.map(s => [s.file, { path: s.chosen, sha256: sha256(s.source) }])),
  timingPolicy: 'diagnostic only; structural work budgets and semantic correctness determine pass/fail',
  runs: [], failures: [],
};
function check(ok, message, details) {
  if (!ok) report.failures.push({ message, ...(details === undefined ? {} : { details }) });
}
// Added before page code. Browser primitives remain native; wrappers only count
// actual work. Counters are disabled outside measurement windows. Instrumented
// timings include this fixed overhead; compare structural counts, not wall time.
function installCounters({ minimal }) {
  window.__perf = {
    enabled: false, counts: {}, longTasks: [], heartbeat: [],
    hit(name, n = 1) { if (this.enabled) this.counts[name] = (this.counts[name] || 0) + n; },
    reset() { this.counts = {}; this.longTasks = []; this.heartbeat = []; this.enabled = true; },
  };
  const p = window.__perf;
  let lastBeat = performance.now();
  setInterval(() => { const now = performance.now(); if (p.enabled) p.heartbeat.push(now - lastBeat); lastBeat = now; }, 20);
  if (typeof PerformanceObserver !== 'undefined') {
    const observer = new PerformanceObserver(list => {
      if (p.enabled) for (const e of list.getEntries()) p.longTasks.push({ start: e.startTime, duration: e.duration });
    });
    observer.observe({ type: 'longtask', buffered: false });
  }
  if (minimal) return;
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function(...args) {
    const t0 = performance.now();
    try { return rect.apply(this, args); }
    finally { p.hit('geometryReadCalls'); p.hit('geometryReadMs', performance.now() - t0); }
  };
  const computed = window.getComputedStyle;
  window.getComputedStyle = function(...args) {
    const t0 = performance.now();
    try { return computed.apply(this, args); }
    finally { p.hit('computedStyleCalls'); p.hit('computedStyleMs', performance.now() - t0); }
  };
  for (const proto of [Document.prototype, Element.prototype, DocumentFragment.prototype]) {
    const original = proto.querySelectorAll;
    proto.querySelectorAll = function(selector) {
      const rows = original.call(this, selector);
      if (selector === '[data-test="chat-item-presentational__container"]') {
        p.hit('itemSelectorCalls'); p.hit('itemSelectorRows', rows.length);
      }
      return rows;
    };
  }
  for (const name of ['nodeValue', 'textContent']) {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, name);
    Object.defineProperty(Node.prototype, name, {
      ...descriptor, get() {
        const value = descriptor.get.call(this);
        if (typeof value === 'string') { p.hit(name + 'Reads'); p.hit(name + 'Chars', value.length); }
        return value;
      },
    });
  }
}
function instrumentProvider(source) {
  if (minimal) return source;
  for (const name of ['rawItems', 'allItems', 'itemText', 'classifyText', 'textWithout', 'maskInjectedItems']) {
    const pattern = new RegExp('(function ' + name + '\\([^)]*\\)\\s*\\{)');
    if (pattern.test(source)) source = source.replace(pattern, '$1 window.__perf.hit("' + name + 'Calls");');
  }
  const timed = ['rawItems', 'transcriptSnapshot', 'maskInjectedItems', 'maskPendingItems', 'textWithout', 'activeThread', 'readRole'];
  const wrappers = timed.filter(name => new RegExp('function ' + name + '\\(').test(source)).map(name =>
    '{const fn=' + name + ';' + name + '=function(...args){const t0=performance.now();try{return fn.apply(this,args);}finally{window.__perf.hit("' + name + 'Ms",performance.now()-t0);}};}').join('');
  assert(source.includes("return {\n    id:'clickup'"), 'provider instrumentation seam exists');
  return source.replace("return {\n    id:'clickup'", wrappers + "return {\n    id:'clickup'");
}
function instrumentMain(source) {
  // The existing fixture uses this exact seam to expose startSession/agentLoop.
  assert(source.includes('const TOKEN_CHARS = 4;'), 'main test instrumentation seam exists');
  source = source.replace('const TOKEN_CHARS = 4;',
    'window.fixture={A,startSession,runTool,agentLoop,ui};' +
    'window.__perfCore={A,decorate,scheduleSweep,preHideWholeItems,waitForResponse,rememberExecuted,isRememberedExecuted};' +
    'const TOKEN_CHARS = 4;');
  if (!minimal) source = source.replace(/(classify\(item, next\)\s*\{)/,
    '$1 window.__perf.hit("classifyCalls");');
  if (!minimal) source = source.replace(/(function preHideWholeItems\([^)]*\)\s*\{)/,
    '$1 window.__perf.hit("preHideCalls");');
  return source;
}
function instrumentI18n(source) {
  if (minimal) return source;
  return source.replace(/(function scan\(root\)\s*\{)/,
    '$1 window.__perf.hit("i18nScans");if(root?.closest?.(\'[data-test="chat-thread-container"]\'))window.__perf.hit("i18nHostScans");');
}
function fixtureBrowser(browser) {
  return { newPage: async options => {
    const page = await browser.newPage(options);
    await page.addInitScript(installCounters, { minimal });
    const addScriptTag = page.addScriptTag.bind(page);
    page.addScriptTag = async options => {
      if (!options.content) return addScriptTag(options);
      let source = options.content;
      // pageFor appends provider exposure/timing overrides and modifies one main
      // seam. Detect those exact transformations, never a loose source prefix.
      let found = false;
      for (const entry of sources) {
        const fixtureMain = entry.base.replace('const TOKEN_CHARS = 4;',
          'window.fixture={A,startSession,runTool,agentLoop,ui};const TOKEN_CHARS = 4;');
        if (entry.file === 'providers/clickup.js' && source.startsWith(entry.base + ';window.provider=RSProvider;')) {
          source = instrumentProvider(entry.source) + source.slice(entry.base.length); found = true;
        } else if (source === entry.base || (entry.file === 'core/main.js' && source === fixtureMain)) {
          source = entry.file === 'core/main.js' ? instrumentMain(entry.source)
            : entry.file === 'core/i18n.js' ? instrumentI18n(entry.source) : entry.source;
          found = true;
        }
        if (found) break;
      }
      assert(found, 'every fixture-injected script maps to an exact known production source');
      return addScriptTag({ ...options, content: source });
    };
    return page;
  } };
}
async function cpuMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter(x => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(x.name)).map(x => [x.name, x.value]));
}
async function phase(page, cdp, name, fn, arg) {
  await page.waitForTimeout(80); // drain prior observer/long-task entries
  const before = await cpuMetrics(cdp);
  await page.evaluate(() => window.__perf.reset());
  const start = performance.now();
  const result = await page.evaluate(fn, arg);
  await page.waitForTimeout(70); // collect the final heartbeat and long-task entry
  const metrics = await page.evaluate(() => {
    const p = window.__perf; p.enabled = false;
    const values = p.heartbeat.slice().sort((a, b) => a - b);
    return { counts: p.counts, heartbeatSamples: values.length,
      heartbeatMaxMs: values.at(-1) || 0, heartbeatP95Ms: values[Math.floor(values.length * .95)] || 0,
      longTasks: p.longTasks, longTaskTotalMs: p.longTasks.reduce((n, x) => n + x.duration, 0) };
  });
  const after = await cpuMetrics(cdp);
  return { name, wallMs: performance.now() - start, cpuMs: Object.fromEntries(Object.keys(after).map(k => [k, (after[k] - before[k]) * 1000])), ...metrics, result };
}
async function populate(page, size) {
  const cold = await page.evaluate(({ size, chars, fragments }) => {
    const thread = document.querySelector('#thread'); thread.replaceChildren();
    window.perfExpected = new Map();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < size; i++) {
      const role = i % 2 ? 'assistant' : 'user';
      const prefix = role === 'user' && i % 4 === 0 ? "Output of 'read_file':\n" : `${role} history turn ${i}\n`;
      const suffix = `\nEND-${i}-🧪-完整-data`;
      const text = prefix + ('exact UTF-8 🧪 `code` C:\\fixture\\data\n'.repeat(Math.ceil(chars / 38))).slice(0, chars - prefix.length - suffix.length) + suffix;
      const item = addItem(role, text, String(81100000000000 + i), fragment);
      const editor = item.querySelector('.ql-editor'); editor.replaceChildren();
      const step = Math.ceil(text.length / fragments);
      for (let j = 0; j < text.length; j += step) {
        const span = document.createElement('span'); span.textContent = text.slice(j, j + step); editor.append(span);
      }
      item.dataset.perfIndex = String(i); perfExpected.set(i, text);
    }
    thread.append(fragment);
    addItem('assistant', 'NOT IN ACTIVE THREAD', 'not-active', document.querySelector('#timeline'));
    const unrelated = document.createElement('aside'); unrelated.id = 'perf-unrelated'; document.body.append(unrelated);
    // Synchronous first read after one large root insertion, before the provider's
    // observer callback. Construction cost is outside this cold-read measurement.
    __perf.reset(); const t0 = performance.now();
    const all = provider.allItems(), users = provider.userCount(), assistants = provider.assistantCount();
    const reply = provider.readAssistant().reply, length = provider.snapshot().rp;
    const cold = { wallMs: performance.now() - t0, counts: { ...__perf.counts },
      all: all.length, users, assistants, currentReplyExact: reply === perfExpected.get(size - 1), length };
    __perf.reset(); const decorateT0 = performance.now();
    __perfCore.decorate._didFullSweep = false; __perfCore.decorate.sweep();
    cold.firstFullDecoration = { wallMs: performance.now() - decorateT0, counts: { ...__perf.counts } };
    __perf.enabled = false; return cold;
  }, { size, chars: report.payloadCharsPerTurn, fragments: report.fragmentsPerTurn });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    provider.allItems(); provider.readAssistant(); __perfCore.decorate.sweep();
  });
  await page.waitForTimeout(700); // settle one initial full mask/decorate pass
  return cold;
}
function chars(phase) { return phase.counts.nodeValueChars || 0; }
async function runSize(browser, size) {
  const { page, errors } = await pageFor(fixtureBrowser(browser), true, true);
  page.setDefaultTimeout(120000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const run = { size, phases: [], correctness: {} }; report.runs.push(run);
  try {
    run.cold = await populate(page, size);
    check(run.cold.all === size && run.cold.users === size / 2 && run.cold.assistants === size / 2 && run.cold.currentReplyExact,
      `${size}: cold initial reads preserve full history and current reply`, run.cold);
    check((run.cold.counts.geometryReadCalls || 0) === 0,
      `${size}: route/role/count/text discovery never forces geometric layout`, run.cold.counts);
    check((run.cold.counts.itemSelectorCalls || 0) <= 2, `${size}: cold snapshot is enumerated at most twice`, run.cold.counts);
    check((run.cold.counts.nodeValueChars || 0) <= size * report.payloadCharsPerTurn + 128 * 1024,
      `${size}: cold read walks history at most once plus bounded current reply`, run.cold.counts);
    const counts = await page.evaluate(() => ({ all: provider.allItems().length, users: provider.userCount(), assistants: provider.assistantCount() }));
    check(counts.all === size && counts.users === size / 2 && counts.assistants === size / 2,
      `${size}: complete active-thread history/roles`, counts);
    run.phases.push(await phase(page, cdp, 'steady-provider-polls', async cycles => {
      let last;
      for (let i = 0; i < cycles; i++) {
        last = { users: provider.userCount(), assistants: provider.assistantCount(),
          id: provider.lastAssistantId(), reply: provider.readAssistant().reply, length: provider.snapshot().rp };
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return { users: last.users, assistants: last.assistants, id: last.id, replyChars: last.reply.length, length: last.length };
    }, report.pollCycles));
    run.phases.push(await phase(page, cdp, 'steady-decoration-sweeps', () => {
      for (let i = 0; i < 4; i++) __perfCore.decorate.sweep();
      return { sweeps: 4 };
    }));
    run.phases.push(await phase(page, cdp, 'unrelated-page-mutations', async () => {
      const unrelated = document.querySelector('#perf-unrelated');
      for (let i = 0; i < 8; i++) {
        unrelated.textContent = `host notification ${i}`;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      await new Promise(resolve => setTimeout(resolve, 700));
      return { mutations: 8 };
    }));
    run.phases.push(await phase(page, cdp, 'injected-result-prehide', async () => {
      const raw = "Output of 'read_file':\n" + 'FULL RESULT 🧪\n'.repeat(2500) + 'LOSSLESS-SENTINEL';
      const item = addItem('user', raw, '81199999999998');
      // Explicit read is representative of receipt/count polling immediately
      // after Angular insertion, BEFORE a MutationObserver delivery.
      provider.allItems();
      const immediateMasked = item.hasAttribute('data-rs-clickup-injected') || item.classList.contains('rs-hidden');
      await new Promise(resolve => setTimeout(resolve, 700));
      item.classList.remove('rs-hidden');
      const maskedAfterClassReset = getComputedStyle(item.querySelector('[data-test="chat-item-content-area__message-body"]')).display === 'none';
      return { immediateMasked, maskedAfterClassReset, exactText: provider.itemText(item) === raw, rawChars: raw.length };
    }));
    const poll = run.phases[0], sweep = run.phases[1], unrelated = run.phases[2], prehide = run.phases[3];
    check((poll.counts.itemSelectorCalls || 0) <= 3, `${size}: cached polls enumerate DOM at most three times`, poll.counts);
    check(chars(poll) <= 256 * 1024, `${size}: cached polls do not re-read historical payloads (256 Ki chars)`, poll.counts);
    check((sweep.counts.classifyCalls || 0) <= 4 * 128, `${size}: warm sweeps classify a bounded <=128-turn window`, sweep.counts);
    check(chars(sweep) <= 512 * 1024, `${size}: warm sweeps reuse unchanged text (512 Ki chars)`, sweep.counts);
    check(chars(unrelated) <= 1024 * 1024, `${size}: unrelated mutations do not re-walk full history (1 Mi chars)`, unrelated.counts);
    check(chars(prehide) <= 1024 * 1024, `${size}: one new result does not re-read full history (1 Mi chars)`, prehide.counts);
    check(prehide.result.immediateMasked && prehide.result.maskedAfterClassReset && prehide.result.exactText,
      `${size}: immediate mask, Angular class reset and untruncated result`, prehide.result);
    check(run.phases.every(p => !p.counts.i18nHostScans), `${size}: localization never scans host chat contents`);
    run.correctness = await correctness(page, size);
    for (const [name, ok] of Object.entries(run.correctness)) check(ok === true, `${size}: ${name}`, ok);
    check(errors.length === 0, `${size}: no page exceptions`, errors);
    console.log(JSON.stringify({ size, cold: run.cold, phases: run.phases.map(p => ({ name: p.name, ...p.counts,
      cpuMs: p.cpuMs.TaskDuration, heartbeatMaxMs: p.heartbeatMaxMs, longTasks: p.longTasks.length })), correctness: run.correctness }));
  } catch (error) {
    check(false, `${size}: test exception`, String(error.stack || error));
    console.error(`${size}: ${error.stack || error}`);
  } finally { await cdp.detach(); await page.close(); }
}
async function correctness(page, size) {
  return page.evaluate(async size => {
    const p = provider, core = __perfCore, results = {};
    const row = index => document.querySelector(`[data-perf-index="${index}"]`);
    const content = item => item.querySelector('[data-test="quill-delta-to-html__comment"] .ql-editor');
    const old = row(2); p.itemText(old); p.classifyText(old, '.rs-chip');
    // Old rows are deliberately outside a 120-turn tail in the large fixture.
    const exact = 'Settings\n' + 'LARGE FILE 🧪 C:\\exact\\file.lua\n'.repeat(18000) + 'NEVER-TRUNCATE-尾';
    content(old).replaceChildren(document.createTextNode(exact));
    results.synchronousOldChildReplacement = p.itemText(old) === exact && p.classifyText(old, '.rs-chip') === exact;
    const changed = 'characterData changed 🧪\n' + exact;
    content(old).firstChild.nodeValue = changed;
    results.synchronousOldCharacterData = p.itemText(old) === changed && p.classifyText(old, '.rs-chip') === changed;
    const oldRaw = "Output of 'read_file':\n" + changed;
    content(old).firstChild.nodeValue = oldRaw;
    p.allItems();
    results.oldTurnBecomingResultMasked = old.hasAttribute('data-rs-clickup-injected') && p.itemText(old) === oldRaw;
    globalThis.elioI18n?.setLanguage('es');
    results.localizationPreservesPayload = p.itemText(old) === oldRaw;
    globalThis.elioI18n?.setLanguage('en');
    // A chip's owned text cannot pollute provider text or invalidate correctness.
    const chip = document.createElement('span'); chip.className = 'rs-chip'; chip.textContent = 'OWNED CHIP'; old.append(chip);
    results.ownedChipExcluded = p.itemText(old) === oldRaw;
    chip.remove();
    content(old).textContent = 'My ordinary message after virtualized row reuse';
    p.allItems();
    results.reusedResultRowUnmasked = !old.hasAttribute('data-rs-clickup-injected') && !old.classList.contains('rs-hidden') && p.itemText(old) === 'My ordinary message after virtualized row reuse';
    content(old).textContent = oldRaw; p.allItems();
    const command = '```json\n{"command":"read_file","params":{"path":"perf-fixture.txt"}}\n```';
    const oldAssistant = row(1); content(oldAssistant).textContent = command;
    // Deliver observer work, then ask the normal sweep to process an old edit.
    await new Promise(resolve => setTimeout(resolve, 0));
    const wasStarted = core.A.started;
    core.A.started = true; // command decoration is correctly gated to active sessions
    core.decorate.sweep();
    core.A.started = wasStarted; // no watchdog may dispatch this synthetic old command
    // Existing shared-core sweeps intentionally revisit only the last120 turns.
    // Do not invent an out-of-tail decoration requirement for this cache fix.
    if (size <= 120) results.oldDirtyAssistantDecorated = !!oldAssistant.querySelector('.rs-chip');
    else {
      core.A.started = true; core.decorate.classify(oldAssistant, row(2)); core.A.started = wasStarted;
      results.oldAssistantExplicitClassifyUsesFreshText = !!oldAssistant.querySelector('.rs-chip');
    }
    core.rememberExecuted(oldAssistant);
    results.executedTurnRemembered = core.isRememberedExecuted(oldAssistant, p.itemText(oldAssistant));
    // Semantic attribute changes need the same immediate invalidation as text
    // mutations. Warm both text readers BEFORE each transition; checking only
    // after an observer callback can conceal a takeRecords() correctness gap.
    const thinkingBody = oldAssistant.querySelector('[data-test="quill-delta-to-html__comment"]');
    const thinkingMatches = expected => p.itemText(oldAssistant) === expected && p.classifyText(oldAssistant, '.rs-chip') === expected;
    const afterObserver = () => new Promise(resolve => setTimeout(resolve, 0));
    thinkingMatches(command);
    thinkingBody.setAttribute('data-is-thinking', 'true');
    results.thinkingTrueExcludedSynchronously = thinkingMatches('');
    await afterObserver();
    results.thinkingTrueExcludedAfterCallback = thinkingMatches('');
    // Independently warm an excluded string even on the broken provider. An
    // empty setup text node invalidates through the already-tested childList
    // path; it does not alter the reply or the attribute transition under test.
    thinkingBody.append(document.createTextNode(''));
    thinkingMatches('');
    thinkingBody.setAttribute('data-is-thinking', 'false');
    results.thinkingFalseRestoresTextSynchronously = thinkingMatches(command);
    await afterObserver();
    results.thinkingFalseRestoresTextAfterCallback = thinkingMatches(command);
    thinkingBody.setAttribute('data-is-thinking', 'true');
    thinkingBody.append(document.createTextNode(''));
    thinkingMatches('');
    thinkingBody.removeAttribute('data-is-thinking');
    results.thinkingAttributeRemovalRestoresTextSynchronously = thinkingMatches(command);
    await afterObserver();
    results.thinkingAttributeRemovalRestoresTextAfterCallback = thinkingMatches(command);
    // Role-cache invalidation must be synchronous, including avatar subtree edits.
    const roleItem = row(3), avatar = roleItem.querySelector('cu-chat-user-avatar');
    const originalAvatar = avatar.innerHTML;
    const beforeUsers = p.userCount(), beforeAssistants = p.assistantCount(), beforeReply = p.readAssistant().reply;
    p.isAssistantItem(roleItem); p.itemKey(roleItem); // warm the direct role/key cache
    avatar.innerHTML = '<cu-user-avatar></cu-user-avatar>';
    results.directRoleReadAfterAvatarEdit = p.isUserItem(roleItem) && !p.isAssistantItem(roleItem);
    results.directItemKeyAfterAvatarEdit = p.itemKey(roleItem).startsWith('user:');
    results.synchronousRoleChange = p.userCount() === beforeUsers + 1 && p.assistantCount() === beforeAssistants - 1 && p.isUserItem(roleItem);
    avatar.innerHTML = originalAvatar;
    results.directRoleReadAfterAvatarRestore = p.isAssistantItem(roleItem) && !p.isUserItem(roleItem);
    results.synchronousRoleRestore = p.userCount() === beforeUsers && p.assistantCount() === beforeAssistants && p.isAssistantItem(roleItem) && p.readAssistant().reply === beforeReply;
    const identity = p.itemKey(oldAssistant), route = location.href;
    const owner = oldAssistant.parentElement, clone = owner.cloneNode(true);
    clone.querySelectorAll('.rs-chip').forEach(n => n.remove());
    const clonedItem = clone.querySelector('[data-test="chat-item-presentational__container"]');
    for (const key of ['zloop', 'zResume', 'zresume', 'rs', 'zphase']) delete clonedItem.dataset[key];
    owner.replaceWith(clone);
    results.remountRetainsStableIdentity = p.itemKey(clonedItem) === identity && p.allItems().includes(clonedItem) && !p.allItems().includes(oldAssistant);
    results.remountCannotReplayExecutedTurn = core.isRememberedExecuted(clonedItem, p.itemText(clonedItem));
    history.replaceState({}, '', '/90141771095/chat/r/agent-room/t/perf-other');
    results.dedupeIsConversationScoped = !core.isRememberedExecuted(clonedItem, p.itemText(clonedItem));
    history.replaceState({}, '', route);
    results.returnToRouteRetainsDedupe = core.isRememberedExecuted(clonedItem, p.itemText(clonedItem));
    // A full Angular thread remount cannot retain detached snapshot rows.
    const originalThread = document.querySelector('#thread'), remountedThread = originalThread.cloneNode(true);
    const lastBeforeRemount = p.lastAssistantId(); originalThread.replaceWith(remountedThread);
    const afterRemount = p.allItems();
    results.fullThreadRemountInvalidatesSnapshot = afterRemount.length === size + 1 && afterRemount.every(item => remountedThread.contains(item)) && p.lastAssistantId() === lastBeforeRemount;
    const restoredCommand = row(1);
    results.fullThreadRemountRetainsDedupe = core.isRememberedExecuted(restoredCommand, p.itemText(restoredCommand));
    remountedThread.setAttribute('aria-hidden', 'true');
    results.hiddenThreadExcludedSynchronously = p.allItems().length === 0;
    remountedThread.removeAttribute('aria-hidden');
    results.unhiddenThreadRestoredSynchronously = p.allItems().length === size + 1;
    const host = document.createElement('div');
    remountedThread.before(host); host.append(remountedThread); host.style.display = 'none';
    results.hiddenThreadAncestorExcludedSynchronously = p.allItems().length === 0;
    host.style.display = '';
    results.visibleThreadAncestorRestoredSynchronously = p.allItems().length === size + 1;
    host.before(remountedThread); host.remove();
    // A formerly matching selector no longer matches after an attribute is
    // removed. Both deactivation and reactivation must discard the old snapshot,
    // including its counts/last reply, before any observer callback can run.
    const activeThreadMatches = active => active
      ? p.allItems().length === size + 1 && p.userCount() + p.assistantCount() === size + 1 && p.readAssistant().present
      : p.allItems().length === 0 && p.userCount() === 0 && p.assistantCount() === 0 && !p.readAssistant().present;
    for (const attribute of ['data-brain-prompt-surface', 'data-test']) {
      const originalValue = remountedThread.getAttribute(attribute);
      activeThreadMatches(true);
      remountedThread.removeAttribute(attribute);
      const prefix = attribute === 'data-test' ? 'threadSelectorAttribute' : 'threadSurfaceAttribute';
      results[prefix + 'RemovalExcludesSynchronously'] = activeThreadMatches(false);
      await afterObserver();
      results[prefix + 'RemovalExcludesAfterCallback'] = activeThreadMatches(false);
      remountedThread.setAttribute(attribute, originalValue);
      results[prefix + 'RestoreIncludesSynchronously'] = activeThreadMatches(true);
      await afterObserver();
      results[prefix + 'RestoreIncludesAfterCallback'] = activeThreadMatches(true);
    }
    const selectorRow = row(3), selectorValue = selectorRow.getAttribute('data-test');
    const selectorRowMatches = active => p.allItems().includes(selectorRow) === active && p.allItems().length === size + (active ? 1 : 0);
    selectorRowMatches(true);
    selectorRow.removeAttribute('data-test');
    results.itemSelectorAttributeRemovalExcludesSynchronously = selectorRowMatches(false);
    await afterObserver();
    results.itemSelectorAttributeRemovalExcludesAfterCallback = selectorRowMatches(false);
    selectorRow.setAttribute('data-test', selectorValue);
    results.itemSelectorAttributeRestoreIncludesSynchronously = selectorRowMatches(true);
    await afterObserver();
    results.itemSelectorAttributeRestoreIncludesAfterCallback = selectorRowMatches(true);
    const unknown = addItem('user', 'late author fixture', 'perf-unknown-role');
    const unknownAvatar = unknown.querySelector('cu-chat-user-avatar'); unknownAvatar.replaceChildren();
    const knownCount = p.allItems().length;
    unknownAvatar.innerHTML = '<cu-user-avatar></cu-user-avatar>';
    results.lateAuthorDirectRoleRead = p.isUserItem(unknown);
    results.lateAuthorEntersSnapshot = p.allItems().length === knownCount + 1;
    unknown.parentElement.remove();
    const thread = document.querySelector('#thread'); const saved = [...thread.children];
    thread.replaceChildren();
    addItem('user', 'new route user', 'route-user'); addItem('assistant', 'new route answer', 'route-answer');
    results.immediateReplacementInvalidatesCounts = p.userCount() === 1 && p.assistantCount() === 1 && p.readAssistant().reply === 'new route answer';
    thread.replaceChildren(...saved);
    results.virtualizedHistoryRestoredLosslessly = p.allItems().length === size + 1 && p.itemText(row(2)) === oldRaw && p.lastAssistantId() === 'assistant:' + String(81100000000000 + size - 1);
    // A stale AI header left mounted outside the current human room must not
    // enable this provider. Exercise native/ancestor CSS and accessibility hiding.
    const aiHeader = document.querySelector('[data-test="chat-room-header__title-container"]');
    const headerWrapper = document.createElement('section'); aiHeader.replaceWith(headerWrapper); headerWrapper.append(aiHeader);
    const humanHeader = document.createElement('div'); humanHeader.dataset.test = 'chat-room-header__title-container'; humanHeader.textContent = 'Human room'; document.body.append(humanHeader);
    const scopeCase = (name, apply, restore) => {
      apply(); history.replaceState({}, '', '/90141771095/chat/r/human-' + name);
      results[name] = !p.getEditor() && p.allItems().length === 0;
      restore();
    };
    scopeCase('hiddenAIHeaderRejected', () => aiHeader.hidden = true, () => aiHeader.hidden = false);
    scopeCase('hiddenAIHeaderAncestorRejected', () => headerWrapper.hidden = true, () => headerWrapper.hidden = false);
    scopeCase('displayNoneAIHeaderAncestorRejected', () => headerWrapper.style.display = 'none', () => headerWrapper.style.display = '');
    scopeCase('visibilityHiddenAIHeaderAncestorRejected', () => headerWrapper.style.visibility = 'hidden', () => headerWrapper.style.visibility = '');
    scopeCase('transparentAIHeaderRejected', () => aiHeader.style.opacity = '0', () => aiHeader.style.opacity = '');
    scopeCase('transparentAIHeaderAncestorRejected', () => headerWrapper.style.opacity = '0', () => headerWrapper.style.opacity = '');
    scopeCase('ariaHiddenAIHeaderAncestorRejected', () => headerWrapper.setAttribute('aria-hidden', 'true'), () => headerWrapper.removeAttribute('aria-hidden'));
    headerWrapper.replaceWith(aiHeader); humanHeader.remove(); history.replaceState({}, '', route);
    results.visibleAgentHeaderRestoresCorrectScope = !!p.getEditor() && p.allItems().length === size + 1;
    // Run the real core response watcher with the entire old history still
    // mounted. Fixture timings only shorten idle/stability; Date is not faked.
    const baseline = p.assistantCount(); core.A.sendToken = p.lastAssistantId(); core.A.stop = false;
    addItem('assistant', command, 'perf-fresh-response');
    let watchdog;
    const response = await Promise.race([core.waitForResponse(baseline), new Promise((_, reject) => {
      watchdog = setTimeout(() => { core.A.stop = true; reject(Error('response watcher exceeded 30s fixture safety watchdog')); }, 30000);
    })]).finally(() => clearTimeout(watchdog));
    results.realResponseWatcherReturnsTool = response.kind === 'tool' && !!response.calls?.length;
    results.noNativeToolsInvoked = nativeCalls.length === 0;
    return results;
  }, size);
}
(async () => {
  // Local sandbox provides Chromium here; GitHub runners normally use the
  // Playwright-managed browser installed by CI. Never require a sandbox path.
  const executablePath = process.env.ELIO_CHROMIUM || (fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  try {
    report.browser = await browser.version();
    for (const size of sizes) await runSize(browser, size);
    // Same payload length + same polling workload; historical size alone must
    // not multiply repeated text reads. Additive allowance covers small caches.
    if (report.runs.length > 1 && report.runs.every(r => r.phases.length >= 2)) {
      const small = report.runs[0], large = report.runs.at(-1);
      for (const index of [0, 1]) check(chars(large.phases[index]) <= chars(small.phases[index]) * 2 + 128 * 1024,
        `${large.phases[index].name}: work does not grow with historical payload volume`,
        { smallSize: small.size, largeSize: large.size, smallChars: chars(small.phases[index]), largeChars: chars(large.phases[index]) });
    }
  } finally {
    await browser.close(); report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${minimal ? 'DIAGNOSTIC (not structural validation)' : report.failures.length ? 'FAIL' : 'PASS'} ClickUp performance: ${report.failures.length} structural/correctness failures; ${reportPath}`);
  for (const failure of report.failures) console.log(' - ' + failure.message);
  if (report.failures.length && !reportOnly) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
