// Dedicated startup regression: local Chromium only, no ClickUp account or bridge.
// The existing browser fixture submits DOM text with Send enabled by default.
// This fixture instead has a separate model, MutationObserver -> delayed model
// propagation, an isEnabled gate, native disabled Send, and optional remounts.
// It models the Quill/Angular acceptance boundary; it is NOT the production app.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const source = fs.readFileSync(process.env.SYNERIXCODE_CLICKUP_PROVIDER || path.join(__dirname, '../providers/clickup.js'), 'utf8');
const reproduce = process.argv.includes('--reproduce');
const html = `<!doctype html><style>body{margin:0}cu-refinement-prompt{display:block;position:fixed;left:100px;bottom:50px;width:700px;padding:20px}.ql-editor{min-height:100px;white-space:pre-wrap}button{height:35px}</style>
<section data-test="chat-thread-container" data-brain-prompt-surface="true" data-id="thread-1"></section>
<cu-refinement-prompt data-test="refinement-prompt"><form class="refinement-prompt-wrapper__form-input-wrapper"><div class="ql-editor" contenteditable="true"><p><br></p></div><button type="button" data-test="refinement-prompt-submit-button" disabled>Send</button></form></cu-refinement-prompt>`;
async function fixture(browser, options = {}) {
  const page = await browser.newPage({viewport: {width: 1100, height: 800}});
  await page.route('**/*', r => r.fulfill({contentType: 'text/html', body: html}));
  await page.goto('https://app.clickup.com/123/ai/brain?conversationId=fixture');
  await page.addScriptTag({content: source + ';window.provider=RSProvider;'});
  await page.evaluate(options => {
    window.trace = []; window.sent = []; window.stopped = false;
    window.options = options; window.model = ''; window.mounts = 0;
    const read = editor => editor.innerText.replace(/\n+$/, '').trim();
    window.mount = () => {
      const frame = document.querySelector('cu-refinement-prompt');
      const editor = frame.querySelector('.ql-editor'), button = frame.querySelector('button');
      const mount = ++mounts; let revision = 0;
      window.editor = editor; window.button = button;
      const observer = new MutationObserver(() => {
        const text = read(editor), rev = ++revision;
        trace.push({event: 'dom', mount, editable: editor.getAttribute('contenteditable')});
        setTimeout(() => {
          if (rev !== revision || !editor.isConnected) return;
          const editable = editor.getAttribute('contenteditable') === 'true';
          trace.push({event: editable ? 'model-accepted' : 'model-rejected-locked', mount});
          // Quill-style user-source updates cannot be accepted while disabled.
          if (!editable) return;
          window.model = text;
          button.disabled = options.nativeDisabled || !text;
          if (options.ariaDisabled) button.setAttribute('aria-disabled', 'true');
        }, options.delay ?? 40);
      });
      observer.observe(editor, {subtree: true, childList: true, characterData: true});
      button.onclick = () => {
        trace.push({event: 'native-click', mount});
        if (button.disabled || !model) throw Error('native Send requires a model');
        sent.push(model);
        if (options.ambiguous) return;
        const wrapper = document.createElement('section'); wrapper.dataset.id = String(80000 + sent.length);
        wrapper.innerHTML = '<div data-test="chat-item-presentational__container"><cu-chat-user-avatar><cu-user-avatar></cu-user-avatar></cu-chat-user-avatar><div data-test="chat-item-content-area__message-body"><div data-test="quill-delta-to-html__comment"></div></div></div>';
        wrapper.querySelector('[data-test="quill-delta-to-html__comment"]').textContent = model;
        document.querySelector('[data-test="chat-thread-container"]').append(wrapper);
        editor.innerHTML = '<p><br></p>'; window.model = ''; button.disabled = true;
      };
    };
    if(options.priorDraft)document.querySelector('.ql-editor').textContent=options.priorDraft;
    mount();
    if(options.priorDraft){window.model=options.priorDraft;button.disabled=false;}
    if(options.initiallyEnabledBlank){
      // A host can briefly retain an accepted model while its DOM is empty.
      // Do not let the next write/click submit that stale model.
      window.model='OLD ACCEPTED MODEL';button.disabled=false;
    }
    provider.init({isStopped: () => stopped, diag: (name, data) => trace.push({event: name, ...data})});
    provider.setInputLock(options.locked !== false);
    // Faster wall-clock deadlines, but genuine event ordering and delayed model
    // updates. 15-second readiness budget becomes 1.5 seconds, not one tick.
    const now = Date.now, origin = now(); Date.now = () => origin + (now() - origin) * 10;
    window.sweep = setInterval(() => {provider.setInputLock(options.locked !== false); provider.enforceComposer();}, 20);
    if (options.remount) setTimeout(() => {
      const old = document.querySelector('cu-refinement-prompt'), next = old.cloneNode(true);
      next.querySelector('.ql-editor').setAttribute('contenteditable', 'true');
      next.querySelector('button').disabled = false; // New view can already be enabled.
      old.replaceWith(next); mount(); trace.push({event: 'remount'});
    }, 35);
    if (options.routeChange) setTimeout(() => history.replaceState({}, '', '?conversationId=other'), 35);
    if (options.stop) setTimeout(() => stopped = true, 35);
    if (options.foreignDraft) setTimeout(() => {editor.textContent = 'A changed draft';}, 35);
    if (options.overlay) {
      const cover = document.createElement('div'); cover.id = 'rs-input-cover';
      cover.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:800px;z-index:100'; document.body.append(cover);
    }
    window.outgoing = provider.startupRequest('local');
    window.resultPromise = provider.typeAndSend(outgoing).then(() => ({ok:true}), e => ({ok:false,error:e.message}));
  }, options);
  return page;
}
async function result(page) {
  return page.evaluate(async () => ({...await resultPromise, sent, trace, model, draft:provider.editorText(), editable:provider.getEditor()?.getAttribute('contenteditable'), locked:provider.getEditor()?.hasAttribute('data-rs-locked'), ambiguous:provider.sendFailureAmbiguous(), retry:provider.sendRetryable(), outgoing}));
}
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.SYNERIXCODE_CHROMIUM || (fs.existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined), args:['--no-sandbox']});
  try {
    for (const delay of (process.argv.includes('--prior-model-only') ? [] : [40, 350])) {
      const page = await fixture(browser, {delay, overlay:true});
      const r = await result(page);
      if (reproduce) {
        assert.equal(r.ok, false); assert.equal(r.sent.length, 0);
        assert(r.trace.some(t => t.event === 'model-rejected-locked'));
        console.log('REPRO delayed model ' + delay + 'ms: ' + JSON.stringify({error:r.error, draftLeft:r.draft.length, trace:r.trace}));
      } else {
        assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.sent, [r.outgoing]);
        assert.equal(r.editable, 'false'); assert.equal(r.locked, true);
        assert(r.trace.some(t => t.event === 'model-accepted'));
        console.log('PASS delayed model ' + delay + 'ms survives repeated lock sweeps');
      }
      await page.close();
    }
    {
      const page = await fixture(browser, {delay:350,priorDraft:'A previously accepted draft'});
      const r = await result(page);
      if(reproduce){assert.deepEqual(r.sent,['A previously accepted draft']); console.log('REPRO initially-enabled Send clicked the OLD model before delayed acceptance');}
      else {assert.equal(r.ok,false,JSON.stringify(r));assert.deepEqual(r.sent,[],JSON.stringify(r));assert.equal(r.draft,'A previously accepted draft');assert.equal(r.ambiguous,false);console.log('PASS existing draft preserved without clicking stale enabled model');}
      await page.close();
    }
    if (reproduce) return;
    {
      const page = await fixture(browser, {delay:350,initiallyEnabledBlank:true});
      const r = await result(page);
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.deepEqual(r.sent, [], 'blank DOM with already-enabled Send must never click the stale host model');
      assert.equal(r.draft, '', 'reject the unsettled host before writing any startup draft');
      assert.equal(r.model, 'OLD ACCEPTED MODEL', 'leave the host model untouched');
      assert(!r.trace.some(t => t.event === 'dom' || t.event === 'native-click'), 'no editor DOM mutation or native Send click');
      assert.equal(r.ambiguous, false); assert.equal(r.retry, false);
      assert.equal(r.editable, 'false'); assert.equal(r.locked, true);
      console.log('PASS blank DOM with initially-enabled Send aborts before any write or click');
      await page.close();
    }
    for (const options of [{remount:true}, {routeChange:true}, {stop:true}, {foreignDraft:true}, {nativeDisabled:true}, {ariaDisabled:true}, {ambiguous:true}]) {
      const page = await fixture(browser, {...options,delay:120}); const r = await result(page);
      assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.retry, false);
      if (options.ambiguous) {assert.equal(r.sent.length, 1); assert.equal(r.ambiguous, true);}
      else assert.equal(r.sent.length, 0, JSON.stringify(r));
      if (options.foreignDraft) assert.equal(r.draft, 'A changed draft');
      if (options.routeChange || options.remount) assert.equal(r.draft, r.outgoing, 'never clean up a changed route/editor');
      if (options.nativeDisabled || options.ariaDisabled || options.stop) assert.equal(r.draft, '', 'restore owned definitely-unsent startup draft');
      assert.equal(r.editable, 'false');
      console.log('PASS startup model safeguard ' + Object.keys(options)[0]); await page.close();
    }
    // Real trusted browser keyboard input must not contaminate a writable model
    // acceptance window, even with no core visual input cover present.
    const page = await fixture(browser, {delay:350});
    await page.waitForTimeout(80); await page.keyboard.type('UNEXPECTED USER INPUT'); await page.keyboard.insertText('UNEXPECTED BEFOREINPUT');
    const r = await result(page); assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.sent, [r.outgoing]);
    console.log('PASS trusted typing cannot alter protected model acceptance'); await page.close();
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
