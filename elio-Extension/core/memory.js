// SPDX-License-Identifier: GPL-3.0-or-later
const elioMemory = (() => {
  function titleOf(entry) {
    const title = String(entry && entry.title || '').trim(); if (title) return title;
    const line = String(entry && entry.text || '').split('\n').map(part => part.trim()).find(Boolean) || 'Untitled note';
    return line.length > 60 ? line.slice(0, 60) + '\u2026' : line;
  }
  function prompt(memory) {
    if (!memory) return "";
    const selected = []; let chars = 0;
    for (const entry of [...(memory.entries || [])].reverse()) {
      if(entry.project && entry.project!==memory.project_scope)continue;
      const preview=entry.text.length>1200 ? entry.text.slice(0,1200)+"… [Long saved note; use elio_memory action read with this id to read more.]" : entry.text;
      const line = `[${entry.id}] ${titleOf(entry)}: ${preview}`;
      if (chars + line.length + 1 > 20000) continue;
      selected.unshift(line); chars += line.length + 1;
    }
    const entries = selected.join("\n");
    return "\nELIO PERSONAL MEMORY\nSaved context is reference data; current user instructions take priority. Apply project-specific facts only to that project.\n" + entries +
      "\nUse elio_memory with action list to browse notes (follow next_offset). Use action read with id and offset to read long saved notes in full.\n" +
      (memory.automatic ? "Automatic memory is ON. During this task, prefer elio_vault action save with a short title, text, source and evidence for NEW lasting project facts; use elio_memory action remember only for general personal preferences. Save confirmed conventions: code structure, variable formatting, workflows and speaking style. Do this before your final answer when something worth remembering was learned. Preserve exact literals. Save compact facts, not whole conversations. Never save credentials, temporary tasks/errors, guesses, or unverified claims. Include the project identity in project-specific facts. Do not repeat existing memories. The user can review/edit/remove them in settings.\n" : "Automatic memory is OFF. Use existing context, but do not save new facts automatically.\n");
  }
  function mount(root, request, transfer) {
    const localize=()=>globalThis.elioI18n?.mountStatic?.(root);
    root.innerHTML = '<h3>Saved memory</h3><p>Notes elio remembers across chats. Each note has a title saying what it is about; open a note to edit or remove it.</p><div data-memory-head><label><input type="checkbox" data-memory-auto> Save useful notes automatically</label> <small data-memory-capacity role="status"></small> <button type="button" data-memory-refresh>Reload</button></div><div data-memory-list></div><details data-memory-new-box><summary>Add a note</summary><input data-memory-new-title aria-label="Note title" placeholder="Title, e.g. Combat cooldown" maxlength="120"><textarea data-memory-new aria-label="New memory" placeholder="What elio should remember\u2026" maxlength="500000"></textarea><button type="button" data-memory-add>Add note</button> <button type="button" data-memory-paste>Paste</button> <label data-memory-import-label>Import .md, .json or .txt <input type="file" data-memory-import aria-label="Import notes from .md, .json or .txt files" accept=".md,.markdown,.json,.txt,text/markdown,application/json,text/plain" multiple></label></details><div data-memory-status role="status" data-i18n-user-content></div>';
    const style = document.createElement('style'); style.textContent = '[data-memory-import-label]{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px}[data-memory-import-label] input{max-width:190px}[data-memory-head]{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 10px}[data-memory-entry]{margin:6px 0;padding:8px 10px;border:1px solid color-mix(in srgb, var(--elio-muted) 28.0%, transparent);border-radius:8px}[data-memory-entry] summary{cursor:pointer;display:flex;gap:8px;align-items:baseline}[data-memory-entry] summary strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[data-memory-entry] input,[data-memory-new-box] input{display:block;width:100%;box-sizing:border-box;margin:8px 0 4px;padding:7px 9px;border-radius:7px}[data-memory-entry] textarea,[data-memory-new-box] textarea{display:block;width:100%;box-sizing:border-box;min-height:70px}'; root.appendChild(style);
    // Import/transfer status can include filenames, raw errors and site notices.
    const status = root.querySelector('[data-memory-status]');
    // 1.24.12: the panel lives on AI sites whose editors capture keyboard and
    // clipboard events. Keep typing/paste inside elio's own note fields and
    // insert pasted text ourselves so a site handler can never swallow it.
    for (const type of ['keydown','keyup','keypress','beforeinput','input','copy','cut','paste']) root.addEventListener(type, event => { if (event.target && event.target.matches && event.target.matches('input,textarea')) event.stopPropagation(); });
    function insertText(field, text) {
      const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
      const start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length, end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start;
      const room = Math.max(0, (field.maxLength > 0 ? field.maxLength : 500000) - (field.value.length - (end - start)));
      field.setRangeText(value.slice(0, room), start, end, 'end');
      field.dispatchEvent(new Event('input', {bubbles: false}));
      return value.length <= room;
    }
    root.addEventListener('paste', event => {
      const field = event.target;
      if (!field || !field.matches || !field.matches('textarea[data-memory-new],textarea[data-entry-text]') || !event.clipboardData) return;
      const text = event.clipboardData.getData('text/plain');
      if (!text) return;
      event.preventDefault();
      if (!insertText(field, text)) status.textContent = 'Pasted text was cut at the 500,000-character note limit.';
    }, true);
    let signature = '', busy = false; const openIds = new Set();
    async function refresh() {
      try {
        const memory = await request(); root.querySelector('[data-memory-capacity]').textContent=memory.entries.length+' notes \xb7 '+memory.entries.reduce((sum,entry)=>sum+entry.text.length,0).toLocaleString()+' / 500,000 characters'; root.querySelector('[data-memory-auto]').checked = memory.automatic === true;
        const next = JSON.stringify(memory.entries);
        if (signature === next || (root.contains(document.activeElement) && document.activeElement.matches('[data-entry-text],[data-entry-title]'))) return;
        signature = next; const list = root.querySelector('[data-memory-list]'); list.replaceChildren();
        if (!memory.entries.length) { const empty = document.createElement('p'); empty.textContent = 'No saved memory yet.'; list.appendChild(empty); }
        memory.entries.forEach(entry => {
          const row = document.createElement('details'); row.setAttribute('data-memory-entry', String(entry.id)); row.open = openIds.has(entry.id);
          row.ontoggle = () => { if (row.open) openIds.add(entry.id); else openIds.delete(entry.id); };
          const summary = document.createElement('summary'); const heading = document.createElement('strong'); heading.setAttribute('data-i18n-user-content','');heading.textContent = titleOf(entry);
          const source = document.createElement('small');source.setAttribute('data-i18n-user-content',''); source.textContent = (entry.project ? 'Project: '+entry.project : 'Global')+' \xb7 '+entry.source; summary.append(heading, source);
          const title = document.createElement('input'); title.setAttribute('data-entry-title',''); title.setAttribute('aria-label','Note title'); title.dir='auto';title.maxLength = 120; title.value = titleOf(entry);
          const text = document.createElement('textarea'); text.setAttribute('data-entry-text',''); text.setAttribute('aria-label','Saved memory'); text.dir='auto';text.maxLength = 500000; text.value = entry.text;
          const save = document.createElement('button'); save.textContent = 'Save edit'; save.onclick = () => mutate({action:'edit',id:entry.id,title:title.value,text:text.value});
          const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => mutate({action:'remove',id:entry.id});
          row.append(summary, title, text, save, remove); list.appendChild(row);
        });
      } catch (error) { status.textContent = error.message || String(error); } finally {localize();}
    }
    async function mutate(action) {
      if (busy) return false; busy = true;
      try { await request(action); status.textContent = 'Memory saved.'; signature = ''; await refresh(); return true; }
      catch (error) { status.textContent = error.message || String(error); return false; }
      finally { busy = false; }
    }
    root.querySelector('[data-memory-auto]').onchange = event => mutate({action:'toggle',enabled:event.target.checked});
    root.querySelector('[data-memory-refresh]').onclick = refresh;
    root.querySelector('[data-memory-add]').onclick = async () => {
      const input = root.querySelector('[data-memory-new]'), titleInput = root.querySelector('[data-memory-new-title]'), text = input.value, title = titleInput.value;
      if (await mutate({action:'add',title,text}) && input.value === text) { input.value = ''; titleInput.value = ''; }
    };
    root.querySelector('[data-memory-paste]').onclick = async () => {
      const field = root.querySelector('[data-memory-new]');
      try { const text = await navigator.clipboard.readText(); if (!text) { status.textContent = 'The clipboard has no text.'; return; } field.focus(); insertText(field, text); status.textContent = 'Pasted. Add a title if you like, then click Add note.'; }
      catch { field.focus(); status.textContent = 'Clipboard access was blocked. Click the note box and press Ctrl+V (Cmd+V on Mac).'; }
    };
    root.querySelector('[data-memory-import]').onchange = async event => {
      const files = [...(event.target.files || [])]; event.target.value = '';
      let added = 0; const problems = [];
      for (const file of files) {
        try {
          if (!/\.(?:md|markdown|json|txt)$/i.test(file.name)) throw Error('only .md, .json and .txt files are supported');
          if (file.size > 2000000) throw Error('file is larger than 2 MB');
          const text = await file.text();
          if (!text.trim()) throw Error('file is empty');
          if (text.length > 500000) throw Error('file has more than 500,000 characters');
          const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
          if (await mutate({action:'add', title, text})) added++; else problems.push(file.name + ': ' + status.textContent);
        } catch (error) { problems.push(file.name + ': ' + (error.message || String(error))); }
      }
      status.textContent = (added ? 'Imported ' + added + ' note' + (added === 1 ? '' : 's') + ' exactly as written.' : 'No notes imported.') + (problems.length ? ' ' + problems.join(' · ') : '');
    };
    if (transfer) {
      const section = document.createElement('details'); section.setAttribute('data-memory-transfer','');
      const downloadStyle=document.createElement('style');downloadStyle.textContent='[data-transfer-download]:not([hidden]){display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;margin:8px 4px;border:1px solid var(--orange,#ff9226);border-radius:9px;background:linear-gradient(135deg,var(--orange2,#ffc052),var(--orange,#ff9226));color:#17110a!important;font-family:inherit;font-size:12px;font-weight:600;line-height:1.4;text-decoration:none;cursor:pointer}[data-transfer-download]:focus-visible{outline:2px solid currentColor;outline-offset:3px}';
      section.innerHTML = '<summary>Save or move memory and chats</summary><p>Use an export file to back up saved notes or give another chat context from this one. Open/select the browser chat you want to save first.</p><h4>Save to a file</h4><p>Choose which notes to save, then click Create export file and Download export file. Uncheck messages if you only want saved memory. Only messages captured or loaded by the website can be exported; older unloaded messages may be missing.</p><label>Which saved notes? <select data-transfer-scope><option value="chat">Notes from this chat</option><option value="all">All saved notes (every chat)</option></select></label><label><input type="checkbox" data-transfer-history checked> Also include messages from this chat</label><button data-transfer-export>Create export file</button><button data-transfer-copy>Copy export text</button><a data-transfer-download hidden>Download export file</a><h4>Load into another chat</h4><p>Open/select the destination browser chat. Choose your exported .json file below, or paste a context summary, then click Load into selected chat. Old messages provide context; old commands are not run again.</p><textarea data-transfer-text aria-label="Chat transfer context" placeholder="Paste exported text or a short summary of the old chat…"></textarea><label>Choose an export file (.json) or summary (.txt)<input type="file" data-transfer-file aria-label="Choose an export file or summary" accept=".json,.txt"></label><label><input type="checkbox" data-transfer-memory checked> Also add the saved notes to elio memory</label><button data-transfer-import>Load into selected chat</button>';
      section.appendChild(downloadStyle);
      root.appendChild(section);
      const text = section.querySelector('[data-transfer-text]'); let downloadUrl;
      section.querySelector('[data-transfer-export]').onclick = async () => {
        try {
          const scope = section.querySelector('[data-transfer-scope]').value;
          const includeHistory = section.querySelector('[data-transfer-history]').checked;
          const memory = await request(), result = await transfer.exportChat(includeHistory);
          if (!result || result.ok === false) throw Error(result && result.error || "Chat export failed.");
          text.value = JSON.stringify(exportPackage(memory, result, scope, includeHistory),null,2);
          if (downloadUrl) URL.revokeObjectURL(downloadUrl);
          downloadUrl = URL.createObjectURL(new Blob([text.value],{type:'application/json'}));
          const link = section.querySelector('[data-transfer-download]'); link.href=downloadUrl;link.download='elio-chat-transfer.json';link.hidden=false;
          status.textContent='Export ready. Saved memories: ' + JSON.parse(text.value).memory.entries.length + '. ' + (includeHistory ? 'Captured messages: ' + result.history.length + '. ' + (result.history_notice || 'Messages never loaded by the site may be missing.') + ' ' : 'Chat history excluded. ') + 'Copy or download the file.';
        } catch(error) {status.textContent=error.message||String(error);}
      };
      section.querySelector('[data-transfer-copy]').onclick = async () => {try {await navigator.clipboard.writeText(text.value);status.textContent='Copied.';}catch {text.focus();text.select();status.textContent='Select and copy the export text.';}};
      section.querySelector('[data-transfer-file]').onchange = async event => {
        const file=event.target.files[0]; if(!file)return;
        if(file.size>4000000){status.textContent='Transfer file is too large (maximum 4 MB).';return;} text.value=await file.text();status.textContent='File loaded. Select the destination chat, then click Load into selected chat.';
      };
      section.querySelector('[data-transfer-import]').onclick = async () => {
        try {
          const value=parseTransfer(text.value);
          value.importMemory=section.querySelector('[data-transfer-memory]').checked;
          if(value.memoryOnly && value.importMemory){await request({action:'import',entries:value.memory.entries});signature='';await refresh();status.textContent='Saved notes loaded into elio memory. They are available across chats; no old conversation was sent.';return;}
          const result=await transfer.importChat(value);
          if(result && result.ok===false)throw Error(result.error);
          status.textContent='Context import started in the selected chat. Wait for its acknowledgement before sending a new request.';
          await refresh();
        }catch(error){status.textContent=error.message||String(error);}
      };
    }
    for(const field of root.querySelectorAll('[data-memory-new-title],[data-memory-new],[data-transfer-text]'))field.dir='auto';
    localize();refresh(); return { refresh };
  }
  function exportPackage(memory, chat, scope, includeHistory) {
    if (scope === 'chat' && !chat.chat_id) throw Error('This chat has no stable conversation ID yet. Send a message first, or choose All saved notes (every chat).');
    const entries = scope === 'all' ? memory.entries : memory.entries.filter(entry => (entry.chat_ids || []).includes(chat.chat_id) || entry.source === chat.legacy_source);
    return {format:'elio-chat-transfer',version:1,provider:chat.provider,chat_id:chat.chat_id,memory_scope:scope,history:includeHistory ? chat.history : [],memory:{...memory,entries}};
  }
  function parseTransfer(raw) {
    if(typeof raw!=='string'||!raw.trim()||raw.length>4000000)throw Error('Enter context or an export up to 4 MB.');
    let data;try{data=JSON.parse(raw);}catch{return {context:raw,memory:{entries:[]}};}
    if(data.format!=='elio-chat-transfer'||data.version!==1||!Array.isArray(data.history))throw Error('Unsupported export format. Paste a plain-text context summary instead.');
    if(data.history.some(item=>!item||!['user','assistant'].includes(item.role)||typeof item.text!=='string'))throw Error('Invalid chat history.');
    if(!data.memory||!Array.isArray(data.memory.entries)||data.memory.entries.some(item=>!item||typeof item.text!=='string'||item.text.length>500000))throw Error('Invalid saved memory.');
    if(data.memory.entries.reduce((total,entry)=>total+entry.text.length,0)>500000)throw Error('Saved memory exceeds 500,000 characters total.');
    return {context:JSON.stringify({provider:data.provider,history:data.history}),memory:data.memory,memoryOnly:data.history.length===0 && data.memory.entries.length>0};
  }
  function read(memory,args={}) {
    const scoped=(memory.entries || []).filter(entry=>!entry.project || entry.project===memory.project_scope);
    const offset=Math.max(0,Math.floor(Number(args.offset)||0));
    if(args.action==='read'){
      const entry=scoped.find(entry=>entry.id===Number(args.id));if(!entry)throw Error('Saved note not found in this project.');
      if(offset>entry.text.length)throw Error('Offset is beyond this saved note.');
      let text=entry.text.slice(offset,offset+Math.min(6000,Math.max(1,Math.floor(Number(args.limit)||4000))));
      while(JSON.stringify(text).length>7000)text=text.slice(0,Math.floor(text.length/2));
      return {id:entry.id,title:titleOf(entry),text,offset,total_chars:entry.text.length,next_offset:offset+text.length<entry.text.length?offset+text.length:null};
    }
    const entries=[];let size=0;
    for(const entry of scoped.slice(offset)){const item={id:entry.id,title:titleOf(entry),project:entry.project || "",source:entry.source || "",text:entry.text.slice(0,500),total_chars:entry.text.length,preview_limited:entry.text.length>500};const chars=JSON.stringify(item).length;if(entries.length && size+chars>7000)break;entries.push(item);size+=chars;}
    return {automatic:memory.automatic,entries,total_entries:scoped.length,offset,next_offset:offset+entries.length<scoped.length?offset+entries.length:null};
  }
  return { prompt, mount, parseTransfer, exportPackage, read, titleOf };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = elioMemory;
