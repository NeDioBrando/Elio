const synerixcodeClarification = (() => {
  const INSTRUCTION = '\nBEFORE ACTING: Assess the request, existing project and constraints first. For a clear task, proceed with targeted work. If materially unclear choices would change the scope, call synerixcode_clarify BEFORE changing anything. Provide 2–3 distinct options with labels and scope, recommend one with a reason, and ask 1–3 necessary questions. This opens a user panel and waits for their answer. Do not pick an option yourself, send reminders, repeat the question, or run other actions while waiting. Continue only from the returned answer. Do not ask for hidden reasoning; give concise practical scope and tradeoffs.\n';
  const DESCRIPTION = 'synerixcode_clarify {question:string, options:[{id:string,label:string,scope:string}] (2–3), recommended_id:string, recommendation:string, questions:[string] (1–3)} — clarify materially unclear work before acting; waits indefinitely without reminders for an explicit answer.';
  // Models often guess near-miss field names (recommend/reason, title/description,
  // a single question string). Map the unambiguous aliases onto the schema so a
  // valid intent is not rejected, and name the exact fields when it still fails.
  function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const value = { ...input }, pick = (...keys) => { for (const key of keys) if (value[key] !== undefined && value[key] !== null && value[key] !== '') return value[key]; return undefined; };
    if (value.question === undefined) value.question = pick('prompt', 'title', 'ask');
    if (Array.isArray(value.options)) value.options = value.options.map((option, index) => {
      if (typeof option === 'string') return { id: 'option_' + (index + 1), label: option.slice(0, 120), scope: option };
      if (!option || typeof option !== 'object') return option;
      const out = { ...option };
      if (out.id === undefined || out.id === null || out.id === '') out.id = out.value ?? out.key ?? ('option_' + (index + 1));
      if (typeof out.id === 'number') out.id = String(out.id);
      if (!out.label) out.label = out.title ?? out.name ?? out.text;
      if (!out.scope) out.scope = out.description ?? out.details ?? out.summary ?? out.label;
      return out;
    });
    let rec = pick('recommended_id', 'recommended', 'recommend', 'recommendation_id', 'recommended_option', 'recommended_option_id', 'default');
    if (rec && typeof rec === 'object') rec = rec.id ?? rec.value;
    if (typeof rec === 'number') rec = String(rec);
    if (typeof rec === 'string' && Array.isArray(value.options) && !value.options.some(option => option && option.id === rec)) {
      const match = value.options.find(option => option && typeof option.label === 'string' && option.label.trim().toLowerCase() === rec.trim().toLowerCase());
      if (match) rec = match.id;
    }
    value.recommended_id = rec;
    const why = value.recommendation !== undefined && !(value.recommendation === value.recommended_id && pick('reason', 'why', 'rationale', 'explanation', 'recommendation_reason')) ? value.recommendation : pick('reason', 'why', 'rationale', 'explanation', 'recommendation_reason');
    value.recommendation = why;
    if (value.questions === undefined) value.questions = pick('clarifying_questions', 'question_list');
    if (typeof value.questions === 'string') value.questions = [value.questions];
    if (value.questions === undefined && typeof value.question === 'string') value.questions = [value.question];
    return value;
  }
  function validate(input) {
    const value = normalize(input);
    const string = (text, max) => typeof text === 'string' && !!text.trim() && text.length <= max;
    if (!value || !string(value.question, 1200) || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 3) throw Error('Provide a question and 2–3 options.');
    if (value.options.some(option => !option || !string(option.id, 60) || !string(option.label, 120) || !string(option.scope, 1800))) throw Error('Each option needs id, label and scope strings.');
    if (new Set(value.options.map(option => option.id)).size !== value.options.length) throw Error('Option ids must be distinct.');
    if (!value.options.some(option => option.id === value.recommended_id) || !string(value.recommendation, 1200)) throw Error('Set recommended_id to one of the option ids (' + value.options.map(option => option.id).join(', ') + ') and recommendation to a short reason.');
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3 || value.questions.some(question => !string(question, 500))) throw Error('Ask 1–3 necessary clarifying questions.');
    return value;
  }
  function create({ document, context, provider, mount, cancelled = () => false, onCancel = () => {}, changed = () => {} }) {
    let pending = null;
    function finish(answer, error) {
      if (!pending) return;
      const current = pending; pending = null;
      try {
        try { clearInterval(current.timer); } catch {}
        try { current.host.remove(); } catch {}
        try { if (current.focus?.isConnected) current.focus.focus(); } catch {}
        try { changed(false); } catch {}
      } finally {
        if (error) current.reject(error); else current.resolve(answer);
      }
    }
    function cancel(reason = 'Clarification cancelled. No option was selected.') {
      const error = new Error(reason); error.name = 'AbortError'; finish(null, error);
    }
    function request(input) {
      const args = validate(input);
      if (pending) throw Error('A clarification is already waiting for an answer.');
      const key = context(), host = document.createElement('div');host.id = 'rs-clarification-host';
      try{const css=document.defaultView.getComputedStyle(document.getElementById('rs-root'));for(const key of ['--rs-text','--rs-muted','--rs-bg','--rs-accent','--pc-bg','--pc-accent']){const value=css.getPropertyValue(key);if(value)host.style.setProperty(key,value);}}catch{}
      const shadow=host.attachShadow({mode:'closed'});
      const style = document.createElement('style');
      style.textContent = ':host{position:fixed;inset:0;z-index:2147483647;color:var(--rs-text,#edf2fa);font:14px/1.5 system-ui,sans-serif}*{box-sizing:border-box}.shade{position:absolute;inset:0;background:#0009;display:grid;place-items:center;padding:20px}.panel{width:min(660px,100%);max-height:calc(100dvh - 40px);overflow:auto;background:var(--pc-bg,var(--rs-bg,#111a26));border:1px solid var(--pc-accent,var(--rs-accent,#ffa83d));border-radius:20px;padding:24px;box-shadow:0 20px 70px #0008;animation:appear .18s ease-out}h2{margin:0 0 8px;font-size:21px;outline:none}p{margin:0 0 16px;overflow-wrap:anywhere}.muted{color:var(--rs-muted,#aab6c6)}.options,.questions{display:grid;gap:12px;margin:18px 0}label{display:grid;gap:7px}.option{grid-template-columns:20px 1fr;border:1px solid #8090a044;border-radius:12px;padding:14px;cursor:pointer;background:#ffffff05}.option:has(input:checked){border-color:var(--pc-accent,var(--rs-accent,#ffa83d));background:#ffa83d14}input[type=radio]{accent-color:var(--pc-accent,var(--rs-accent,#ffa83d));margin:5px 0}strong{display:block}small{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.badge{color:var(--pc-accent,var(--rs-accent,#ffa83d));font-size:12px}textarea{width:100%;min-height:74px;resize:vertical;color:inherit;background:#0003;border:1px solid #8090a066;border-radius:10px;padding:11px;font:inherit}textarea:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--pc-accent,var(--rs-accent,#ffa83d));outline-offset:3px}.actions{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px;position:sticky;bottom:0;padding:14px 0 0;background:var(--pc-bg,var(--rs-bg,#111a26));border-top:1px solid #8090a044}button{border:1px solid #8090a066;border-radius:10px;padding:10px 16px;font:inherit;color:inherit;background:#ffffff08;cursor:pointer}button[type=submit]{background:var(--pc-accent,var(--rs-accent,#ffa83d));color:#111822;font-weight:650}button:disabled{opacity:.45;cursor:default}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.panel{animation:none}}@media(max-width:420px){.shade{padding:12px}.panel{padding:18px;max-height:calc(100dvh - 24px)}.actions button{flex:1}}';
      shadow.append(style);
      const shade = document.createElement('div');shade.className = 'shade';shadow.append(shade);
      const form = document.createElement('form');form.className = 'panel';form.setAttribute('role','dialog');form.setAttribute('aria-modal','true');form.setAttribute('aria-label', provider() + ' is asking you…');shade.append(form);
      const add = (tag, text, parent = form, className = '') => {const node = document.createElement(tag);node.textContent = text;node.className = className;parent.append(node);return node;};
      const heading = add('h2', provider() + ' is asking you…');heading.tabIndex = -1;
      add('p',args.question);add('p','Waiting for a response. Nothing will run until an answer is submitted.',form,'muted');
      const options = add('div','',form,'options');
      for (const option of args.options) {
        const label = add('label','',options,'option'),radio = document.createElement('input');radio.type='radio';radio.name='choice';radio.value=option.id;label.append(radio);
        const body = add('span','',label);add('strong',option.label,body);
        if (option.id === args.recommended_id) add('span','Recommended',body,'badge');
        add('small',option.scope,body);
      }
      add('p','Recommendation: '+args.recommendation);
      const questions = add('div','',form,'questions');
      const answers = args.questions.map(question => {const label=add('label','',questions);add('span',question,label);const input=document.createElement('textarea');input.maxLength=6000;input.required=true;label.append(input);return input;});
      const extraLabel=add('label','');add('span','Additional details or a different approach (optional)',extraLabel);
      const extra=document.createElement('textarea');extra.maxLength=10000;extraLabel.append(extra);
      const actions=add('div','',form,'actions'),stop=add('button','Cancel task',actions),submit=add('button','Submit answer',actions);stop.type='button';submit.type='submit';submit.disabled=true;
      const guard=handler=>event=>{try{return handler(event);}catch(error){finish(null,error);}};
      const valid=()=>!!(form.querySelector('input:checked') || extra.value.trim()) && answers.every(input=>input.value.trim());
      form.addEventListener('input',guard(()=>{submit.disabled=!valid();}));form.addEventListener('change',guard(()=>{submit.disabled=!valid();}));
      stop.addEventListener('click',guard(()=>{cancel();onCancel();}));
      form.addEventListener('submit',guard(event=>{event.preventDefault();if(!valid() || context()!==key){if(context()!==key)cancel('Chat or engine changed. Clarification cancelled.');return;}
        const selected=form.querySelector('input:checked');
        finish({selected_option:selected ? args.options.find(option=>option.id===selected.value) : null,answers:args.questions.map((question,index)=>({question,answer:answers[index].value})),additional_details:extra.value});
      }));
      for(const type of ['beforeinput','input','change','paste','keyup','keypress'])shadow.addEventListener(type,guard(event=>event.stopPropagation()));
      form.addEventListener('keydown',guard(event=>{event.stopPropagation();if(event.key!=='Tab')return;const controls=[heading,...form.querySelectorAll('input,textarea,button')].filter(node=>!node.disabled);const current=form.ownerDocument===document?shadow.activeElement:form.ownerDocument.activeElement;if(event.shiftKey&&current===controls[0]){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&current===controls.at(-1)){event.preventDefault();controls[0].focus();}}));
      return new Promise((resolve,reject)=>{
        pending={resolve,reject,host,focus:document.activeElement,timer:setInterval(()=>{try{if(!host.isConnected || context()!==key || cancelled())cancel('Task stopped, answer panel removed, or chat/engine changed. Clarification cancelled.');}catch(error){finish(null,error);}},500)};
        try {
        // 1.24.13: mount at the root stacking context. A page that turns <body>
        // into its own stacking context (Notion) flattened a body child below
        // synerixcode's <html>-level "Agent is working" cover and Tasks button.
        (mount()||document.documentElement).append(host);changed(true);
        // Site capture handlers see a closed-shadow host as a non-editable div.
        // A script-free frame isolates native answers from page keyboard locks.
        const frame=document.createElement('iframe');frame.title='synerixcode clarification';frame.setAttribute('sandbox','allow-same-origin allow-forms');frame.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent';
        frame.addEventListener('load',()=>{
          if(!pending||pending.host!==host)return;
          try{const pane=frame.contentDocument,sheet=style.cloneNode(true);sheet.textContent=sheet.textContent.replace(':host{','html{')+'body{margin:0}';pane.head.append(sheet);for(const key of ['--rs-text','--rs-muted','--rs-bg','--rs-accent','--pc-bg','--pc-accent']){const value=host.style.getPropertyValue(key);if(value)pane.documentElement.style.setProperty(key,value);}pane.body.append(shade);heading.focus();}catch{try{frame.remove();heading.focus();}catch(error){finish(null,error);}}
        },{once:true});shadow.append(frame);heading.focus();
        } catch(error) { finish(null,error); }
      });
    }
    return {request,cancel,isWaiting:()=>!!pending};
  }
  return {create,validate,normalize,INSTRUCTION,DESCRIPTION};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = synerixcodeClarification;
