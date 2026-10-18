// SPDX-License-Identifier: GPL-3.0-or-later
const elioTaskCenter = (() => {
  const workflows = [
    ['Build → Test → Fix', 'Complete my current request. Inspect the affected systems, make the smallest change, then use available tools to verify it. Test client and server behavior where relevant and supported. Fix confirmed failures within two review cycles. Report what actually passed and what still needs testing.'],
    ['Refresh project map', 'Inspect this project using the available read-only tools. Build a concise map of the main scripts, systems, remotes, dependencies and naming conventions. Do not modify gameplay. Save durable architecture facts in project memory when enabled; distinguish confirmed facts from assumptions.'],
    ['Audit remotes', 'Inspect the project’s RemoteEvents and RemoteFunctions. Check server-side validation, permissions and rate limits. Report confirmed issues with exact paths; do not change working code until I request fixes.'],
    ['Check animation markers', 'Inspect the existing animation marker names and their connected effect handlers. Check timing, duplicate connections, cleanup and missing handlers. Preserve the working start/throw/follow/dismiss sequence. Report the findings without changing unrelated systems.'],
  ];
  function mount(container, request, send) {
    let busy = false;
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
    // Mixed status messages can contain raw external errors; never catalog-match them.
    const localize=()=>globalThis.elioI18n?.mountStatic?.(container);
    const user=(tag,text)=>{const n=el(tag,text);n.setAttribute('data-i18n-user-content','');n.dir=tag==='pre'?'ltr':'auto';return n;};
    const status = el('div', '', 'pc-task-status'), list = el('div'), refresh = el('button', 'Refresh task history'); refresh.type = 'button';
    status.setAttribute('data-i18n-user-content','');
    const intro = el('p', 'AgentScript file backups persist across restarts. Studio restore uses verified undo records in the open Studio session. Later edits or unsupported operations block automatic restore.');
    const workflowBox = el('details'), workflowTitle = el('summary', 'Reusable workflows'); workflowBox.appendChild(workflowTitle);
    for (const [name, prompt] of workflows) { const button = el('button', name); button.type = 'button'; button.onclick = () => launch(prompt); workflowBox.appendChild(button); }
    const custom = el('textarea');custom.dir='auto'; custom.placeholder = 'Save your own workflow prompt…'; custom.maxLength = 8000; custom.setAttribute('aria-label', 'Custom workflow');
    const saveWorkflow = el('button', 'Save workflow'), runWorkflow = el('button', 'Run saved workflow'); saveWorkflow.type = runWorkflow.type = 'button';
    try { custom.value = localStorage.getItem('elioSavedWorkflow') || ''; } catch {}
    saveWorkflow.onclick = () => { try { localStorage.setItem('elioSavedWorkflow', custom.value);status.textContent = 'Workflow saved on this device.'; } catch { status.textContent = 'Could not save this workflow.'; } };
    runWorkflow.onclick = () => launch(custom.value); workflowBox.append(custom, saveWorkflow, runWorkflow);
    const protectionBox=el('details'),protectionTitle=el('summary','Protected systems');
    const engine=el('select');for(const value of ['local','roblox']){const option=el('option',value==='local'?'AgentScript':'RobloxScript');option.value=value;engine.appendChild(option);}
    const path=el('input');path.dir='ltr';path.placeholder='Script, file or folder path';path.maxLength=500;path.setAttribute('aria-label','Protected path');
    const protect=el('button','Protect path');protect.type='button';const protectedList=el('div');
    protectionBox.append(protectionTitle,el('p','AgentScript pauses writes to listed paths. Studio protection pauses mutating commands until you approve that task, because arbitrary Luau can compute its targets.'),engine,path,protect,protectedList);
    protect.onclick=async()=>{try{const result=await request({action:'protect',engine:engine.value,path:path.value});if(!result?.ok)throw Error(result?.error);path.value='';await update();}catch(error){status.textContent=error.message||String(error);}};
    const projectBox=el('details'),projectTitle=el('summary','Project memory scope');const project=el('input');project.dir='auto';project.placeholder='Project name (empty = global only)';project.maxLength=80;project.setAttribute('aria-label','Project memory scope');const projectSave=el('button','Save chat project');projectSave.type='button';projectBox.append(projectTitle,el('p','Give related chats the same project name. They share project facts plus global preferences; other projects stay separate. Existing memories remain global.'),project,projectSave);
    projectSave.onclick=async()=>{try{const result=await request({action:'project',project:project.value});if(!result?.ok)throw Error(result?.error);status.textContent='Project scope saved. New memories follow this scope.';}catch(error){status.textContent=error.message||String(error);}};
    container.append(intro, projectBox, workflowBox, protectionBox, refresh, status, list);
    container.classList.add('pc-task-center');
    const style = el('style'); style.textContent = '.pc-task-center{font:13px/1.5 system-ui;color:inherit}.pc-task-center p{color:inherit;opacity:.75}.pc-task-center button{margin:6px 6px 6px 0;padding:8px 12px;border:1px solid var(--orange,#ff9226);border-radius:8px;background:transparent;color:inherit;cursor:pointer;transition:background .2s,transform .2s}.pc-task-center button:hover:not(:disabled){background:#ff922617;transform:translateY(-1px)}.pc-task-center button:disabled{opacity:.4;cursor:not-allowed}.pc-task-center details{margin:10px 0;padding:10px;border:1px solid #64748b55;border-radius:10px}.pc-task-center summary{cursor:pointer;overflow-wrap:anywhere}.pc-task-center input,.pc-task-center select{padding:8px;border-radius:8px;background:var(--surface,#171b24);color:inherit;border:1px solid #64748b55;font:inherit;max-width:100%}.pc-task-center textarea{display:block;box-sizing:border-box;width:100%;min-height:80px;background:transparent;color:inherit;border:1px solid #64748b55;border-radius:8px;padding:10px;font:inherit}.pc-task-center pre{max-height:250px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}.pc-task-status{white-space:pre-wrap;margin:8px 0}.pc-task-warning{color:#fbbf24}.pc-task-files{overflow-wrap:anywhere}'; container.appendChild(style);
    async function launch(prompt, task) {
      if (!prompt.trim() || busy) return;
      busy = true; status.textContent = 'Sending to the selected chat…';
      try { const result = await send(prompt, task); if (result?.ok === false) throw Error(result.error); status.textContent = 'Sent. The selected AI will continue in the same chat.'; }
      catch (error) { status.textContent = error.message || String(error); } finally { busy = false; }
    }
    async function update() {
      if (busy) return; busy = true; refresh.disabled = true;status.textContent = 'Loading task history…';
      try {
        const result = await request({action: 'list'}); if (!result?.ok) throw Error(result?.error || 'Bridge unavailable.');
        list.replaceChildren();protectedList.replaceChildren();if(document.activeElement!==project)project.value=result.project || "";
        for(const value of result.protected || []){const row=el('div');row.appendChild(user('span',value));const remove=el('button','Remove');remove.type='button';remove.onclick=async()=>{const at=value.indexOf(':');try{const r=await request({action:'protect',engine:value.slice(0,at),path:value.slice(at+1),remove:true});if(!r?.ok)throw Error(r?.error);await update();}catch(error){status.textContent=error.message||String(error);}};row.appendChild(remove);protectedList.appendChild(row);}
        if (!result.tasks.length) list.appendChild(el('p', 'Your next agent task will appear here.'));
        for (const task of result.tasks.slice(0, 30)) {
          const row = el('details'), title = user('summary', `${task.status} · ${task.label || 'Agent task'} · ${task.engine === 'local' ? 'AgentScript' : 'RobloxScript'}`);
          row.appendChild(title); const body = el('div'); row.appendChild(body); let rendered = false;
          row.ontoggle = () => {
            if (!row.open || rendered) return; rendered = true;
            body.appendChild(user('p', task.started + (task.ended ? ' → ' + task.ended : '')));
            for (const warning of task.warnings) {const note=user('p',warning);note.className='pc-task-warning';body.appendChild(note);}
            body.appendChild(task.steps.length?user('div',task.steps.join(' → ')):el('div','No tools executed.'));
            for (const change of task.changes) {const file=user('div',`${change.kind} · ${change.path}`);file.className='pc-task-files';body.appendChild(file);}
            const preview = el('button', 'View before / after'), revert = el('button', 'Revert this task'), resume = el('button', 'Resume interrupted task');
            preview.type = revert.type = resume.type = 'button'; preview.disabled = !task.changes.length;revert.disabled = !task.can_revert;resume.disabled = !task.can_resume;
            const approve=el('button','Allow protected edits for this task');approve.type='button';approve.disabled=task.status==='reverted';
            approve.onclick=async()=>{if(!window.confirm('Allow this task to change protected systems?'))return;try{const r=await request({action:'approve',id:task.id});if(!r?.ok)throw Error(r?.error);status.textContent='Task approved. Continue it after checking the chat.';approve.disabled=true;}catch(error){status.textContent=error.message||String(error);}};
            const comparisons = el('div');body.append(preview, revert, resume, approve, comparisons);
            preview.onclick = async () => {
              preview.disabled = true;
              try { const result = await request({action:'details',id:task.id});if(!result?.ok)throw Error(result?.error);comparisons.replaceChildren();
                for (const file of result.details.files) { const diff=el('details');diff.appendChild(user('summary',file.path+(file.preview_limited?' · limited preview':'')));diff.append(el('strong','Before'),user('pre',file.before ?? '(absent or binary)'),el('strong','After'),user('pre',file.after ?? '(absent or binary)'));const restore=el('button',file.kind==='roblox'?'Restore only this script':'Restore only this file');restore.type='button';restore.disabled=!file.can_restore;restore.onclick=async()=>{if(!window.confirm('Restore only '+file.path+'? Later edits will block this restore.'))return;restore.disabled=true;try{const r=await request({action:'revert-one',id:task.id,path:file.path,studio_id:file.studio_id});if(!r?.ok)throw Error(r?.error);status.textContent='Selected change restored; other changes remain.';await update();}catch(error){status.textContent=error.message||String(error);restore.disabled=false;}};diff.appendChild(restore);comparisons.appendChild(diff); }
              } catch (error) { status.textContent=error.message || String(error); } finally { preview.disabled=false;localize(); }
            };
            revert.onclick = async () => {
              if (!window.confirm('Revert all checkpointed changes in this task? Later edits will block the restore.')) return;
              revert.disabled = true;
              try { const result=await request({action:'revert',id:task.id});if(!result?.ok)throw Error(result?.error);status.textContent='Task reverted.';await update(); }
              catch(error){status.textContent=error.message || String(error);revert.disabled=false;}
            };
            resume.onclick = async () => {
              try { const result=await request({action:'details',id:task.id});if(!result?.ok)throw Error(result?.error);
                await launch('Continue this interrupted task after inspecting current state. Do not replay completed commands blindly.\nOriginal request: '+(result.details.request || task.label)+'\nPreviously executed tools: '+task.steps.join(', ')+'\nChanged files: '+task.changes.map(change=>change.path).join(', ')+'\nComplete remaining work, verify the result, and preserve later manual edits.',task);
              } catch(error){status.textContent=error.message || String(error);}
            };
            localize();
          };
          list.appendChild(row);
        }
        status.textContent = `${result.tasks.length} retained task(s). History is bounded to keep the app responsive.`;
      } catch (error) {status.textContent = error.message || String(error);} finally {busy = false;refresh.disabled = false;localize();}
    }
    refresh.onclick = update;
    localize();return { refresh: update };
  }
  return {mount, workflows};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = elioTaskCenter;
