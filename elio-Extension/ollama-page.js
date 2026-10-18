// SPDX-License-Identifier: GPL-3.0-or-later
// Surface ANY runtime error visibly in the status dot instead of a dead page.
window.addEventListener('error', function(e){
  var s=document.getElementById('status');
  if(s){ s.textContent = '\u25cf JS error: ' + (e.message||'unknown'); s.className='off'; }
});
window.addEventListener('unhandledrejection', function(e){
  var s=document.getElementById('status'); var r=e.reason;
  if(s){ s.textContent = '\u25cf ' + String((r&&r.message)||r||'promise error').slice(0,60); s.className='off'; }
});
// ollama-page.js - page logic for ollama.html (external file: extension CSP forbids inline scripts).
// ── Ollama local chat — talks to 127.0.0.1:11434 via the background proxy ──
const $ = (id) => document.getElementById(id);
const chatEl=$('chat'), inputEl=$('chat-input'), formEl=$('chatForm'),
      barModelBtn=$('barModelBtn'), barName=barModelBtn.querySelector('.bName'),
      modelListEl=$('modelList'), statusEl=$('status'), sendBtn=$('sendBtn');

let history=[];
let selectedModel = (()=>{ try{return localStorage.getItem('rs-ollama-model');}catch{return null;} })();
let modelsCache = [];
let listOpen=false;

function saveSel(){ try{ localStorage.setItem('rs-ollama-model', selectedModel);}catch{} }
function updateLabels(){
  const label = selectedModel || 'Select model';
  barName.textContent = label;
  barName.title = selectedModel || '';
}
async function bgMsg(msg){
  return new Promise((res)=>{
    try{ chrome.runtime.sendMessage(msg, (r)=> res(r||{ok:false,error:'no response'})); }catch(e){ res({ok:false,error:String(e)}); }
  });
}

// ── Popover rendering (single shared element, never rebuilt while open) ──
function renderModelList(){
  // Guard: don't wipe the list out from under an open popover mid-hover/click.
  // Only swap contents when closed; when open, defer to next close.
  if(listOpen){ pendingRender=true; return; }
  pendingRender=false;
  modelListEl.innerHTML='';
  if(!modelsCache.length){
    const e=document.createElement('div');
    e.style.cssText='padding:14px;color:#9aa0a6;font-size:12px;text-align:center';
    e.textContent='No models found — run: ollama pull qwen2.5-coder';
    modelListEl.appendChild(e);
    return;
  }
  modelsCache.forEach(m=>{
    const name=m.name||m.model;
    const det=m.details||{};
    const meta=[det.parameter_size, det.family, det.quantization_level].filter(Boolean).join(' · ');
    const item=document.createElement('div');
    item.className='modelItem'+(name===selectedModel?' active':'');
    item.dataset.model=name;
    item.innerHTML=`<div class="mName">${name}</div><div class="mMeta">${meta||'local model'}</div>`;
    modelListEl.appendChild(item);
  });
}
let pendingRender=false;

// Position the single popover under (or above) whichever trigger was clicked.
function openPicker(anchorEl){
  renderModelList();
  modelListEl.classList.add('open');
  listOpen=true;
  const r=anchorEl.getBoundingClientRect();
  const listW=320;
  // Prefer BELOW the anchor; flip above if not enough room (chatbar case).
  const below = r.bottom + 8;
  const spaceBelow = window.innerHeight - below;
  modelListEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - listW - 8)) + 'px';
  if(spaceBelow > 400 || spaceBelow > r.top){
    modelListEl.style.top = below+'px';
    modelListEl.style.bottom='auto';
  } else {
    modelListEl.style.bottom = (window.innerHeight - r.top + 8)+'px';
    modelListEl.style.top='auto';
  }
}
function closePicker(){
  modelListEl.classList.remove('open');
  listOpen=false;
  if(pendingRender) renderModelList();
}

// Event DELEGATION — survives any DOM churn, one set of listeners total.
document.addEventListener('click', (e)=>{
  const trig = e.target.closest('#barModelBtn');
  const opt  = e.target.closest('.modelItem');
  if(trig){
    e.preventDefault();
    listOpen ? closePicker() : openPicker(trig);
    return;
  }
  if(opt){
    selectedModel = opt.dataset.model;
    saveSel(); updateLabels(); closePicker();
    return;
  }
  // click anywhere else closes it
  if(listOpen && !e.target.closest('#modelList')) closePicker();
}, false);

// ── Model fetch ──
async function refreshModels(){
  let r = await bgMsg({type:'ollama_list_models'});
  if(!r || !r.ok){
    try{
      const res = await fetch('http://127.0.0.1:11434/api/tags', {signal: AbortSignal.timeout(5000)});
      r = {ok:true, models:(await res.json()).models||[]};
    }catch(e){ r={ok:false,error:String(e)}; }
  }
  if(r.ok && Array.isArray(r.models) && r.models.length){
    modelsCache = r.models;
    if(!modelsCache.some(m=> (m.name||m.model)===selectedModel)){
      // prefer a coder model by default if present
      const pref = modelsCache.find(m=>/coder|code/i.test(m.name||m.model));
      selectedModel = (pref||modelsCache[0]).name||(pref||modelsCache[0]).model;
      saveSel();
    }
    updateLabels();
    statusEl.textContent='● '+modelsCache.length+' models';
    statusEl.className='on';
    $('offlineCard').style.display='none';
    chatEl.style.display='';
    $('composer').style.display='';
    if(!listOpen) renderModelList();
  } else {
    modelsCache=[];
    statusEl.textContent='● offline';
    statusEl.className='off';
    $('offlineCard').style.display='block';
    chatEl.style.display='none';
    $('composer').style.display='none';
    if(!listOpen) renderModelList();
  }
}

// ── Chat ──
let busy = false;              // a request is in flight — nothing else may send
const sendQueue = [];          // turns that arrived while busy (agent feedback!)
function addMessage(role, text){
  const wrap=document.createElement('div');
  wrap.className='message'; wrap.dataset.role=role;
  wrap.dataset.messageId='m-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const bubble=document.createElement('div'); bubble.className='bubble';
  const md=document.createElement('div'); md.className='markdown'; md.textContent=text;
  bubble.appendChild(md); wrap.appendChild(bubble);
  chatEl.appendChild(wrap); chatEl.scrollTop=chatEl.scrollHeight;
  return md;
}
function setBusy(v){
  busy = v;
  sendBtn.disabled = v;
  sendBtn.innerHTML = v
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  sendBtn.setAttribute('aria-label', v ? 'Generating…' : 'Send');
  inputEl.placeholder = v ? 'Ollama is thinking…' : 'Ask Ollama…';
}
// Entry point used by BOTH the user (submit) and the agent loop (typeAndSend).
function submitTurn(text){
  if (busy) {
    // NEVER drop or interleave: the agent loop's tool results MUST reach the
    // model in order, so queue and drain sequentially after the current turn.
    sendQueue.push(text);
    inputEl.value=''; autoResize();
    return;
  }
  setBusy(true);
  sendToOllama(text).finally(async ()=>{
    while (sendQueue.length){
      const next = sendQueue.shift();
      await sendToOllama(next);
    }
    setBusy(false);
  });
}
async function sendToOllama(text){
  const isSys = text.trim().startsWith('⟦RS-SYS⟧') || text.trim().startsWith('⟦US-SYS⟧');
  history.push({role:isSys?'system':'user', content:text});
  if(!isSys || text.length<400) addMessage('user', text);
  const md=addMessage('assistant','…');
  inputEl.value=''; autoResize();
  const messages=history.slice(-20);
  const r=await bgMsg({type:'ollama_chat', model:selectedModel, messages});

  // Structured failure handling — stale/deleted model, server down, etc.
  if(!(r && r.ok)){
    const kind = r && r.errKind;
    if(kind === 'model_not_found'){
      md.textContent = `⚠ ${r.error}\n\nAuto-switching to an installed model…`;
      // Self-heal: refresh list, pick a valid model, save + relabel, retry once.
      await refreshModels();
      if(selectedModel && modelsCache.some(m=>(m.name||m.model)===selectedModel)){
        md.textContent += `\n✓ Switched to "${selectedModel}" — sending again…`;
        // Replace the failed user turn's pending answer with a real retry.
        const r2 = await bgMsg({type:'ollama_chat', model:selectedModel, messages});
        if(r2 && r2.ok){
          md.textContent = r2.text;
          history.push({role:'assistant', content:r2.text});
        } else {
          md.textContent += `\n⚠ Retry failed too: ${(r2&&r2.error)||'unknown'}`;
        }
      } else {
        md.textContent += `\nNo models installed at all. Pull one:\n    ollama pull qwen2.5-coder`;
      }
    } else if(kind === 'no_server'){
      md.textContent = `⚠ ${r.error}\nClick "▶ Start Ollama for me" below, or run ollama serve manually.`;
    } else {
      md.textContent = 'Error: '+((r&&r.error)||'request failed');
    }
    sendBtn.disabled=false;
    chatEl.scrollTop=chatEl.scrollHeight;
    document.documentElement.setAttribute('data-rs-ollama-last', String(Date.now()));
    return;
  }

  // Server may have silently substituted when no model was given — sync label.
  if(r.model && r.model !== selectedModel){ selectedModel=r.model; saveSel(); updateLabels(); }
  md.textContent=r.text;
  history.push({role:'assistant', content:r.text});
  sendBtn.disabled=false;
  chatEl.scrollTop=chatEl.scrollHeight;
  document.documentElement.setAttribute('data-rs-ollama-last', String(Date.now()));
}
function autoResize(){ inputEl.style.height='auto'; inputEl.style.height=Math.min(inputEl.scrollHeight,120)+'px'; }
inputEl.addEventListener('input', autoResize);
formEl.addEventListener('submit',(e)=>{ e.preventDefault(); const t=inputEl.value.trim(); if(t) submitTurn(t); });
inputEl.addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); const t=inputEl.value.trim(); if(t) submitTurn(t); } });

// One-click start from the offline card
$('startOllamaBtn').addEventListener('click', async ()=>{
  const b=$('startOllamaBtn');
  b.disabled=true; b.textContent='Starting…';
  const r=await bgMsg({type:'ollama_ensure'});
  if(r&&r.up){ b.textContent='Connected ✓'; setTimeout(()=>{ $('offlineCard').style.display='none'; chatEl.style.display=''; $('composer').style.display=''; },300); await refreshModels(); }
  else { b.textContent='Could not start — install ollama.com'; setTimeout(()=>{ b.disabled=false; b.textContent='▶ Start Ollama for me'; },3000); }
});

// Self-heal poll ONLY while offline (never churns the open dropdown)
setInterval(()=>{ if(statusEl.classList.contains('off')) refreshModels(); }, 4000);

try{ localStorage.removeItem('rs-ollama-theme'); }catch{}
document.documentElement.removeAttribute('data-theme');
updateLabels();
refreshModels();
window.__ollamaHistory=()=>history;
window.__ollamaModel=()=>selectedModel;
window.__ollamaBusy=()=>busy;
console.log('[ollama] page ready — delegation active');
