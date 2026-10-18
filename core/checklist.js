// SPDX-License-Identifier: GPL-3.0-or-later
const elioChecklist = (() => {
  function userText(item, read) {
    try {
      const clone=item.cloneNode(true);
      clone.querySelectorAll('time,[datetime],[data-testid="timestamp"],[data-testid*="-timestamp"],[data-message-time],[class*="timestamp"],[class*="message-time"]').forEach(node=>node.remove());
      // Some hosts put an unmarked clock beside the message body. Remove only
      // standalone metadata leaves; literal times inside prose/code stay intact.
      for(const node of clone.querySelectorAll('span,div')) {
        if(node.childElementCount || !/^\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*$/i.test(node.textContent||'') || node.closest('p,pre,code,blockquote,li'))continue;
        const previous=node.previousElementSibling||node.parentElement?.previousElementSibling;
        if(previous && !/^(?:SPAN|A|EM|STRONG|CODE)$/.test(previous.tagName))node.remove();
      }
      return String(read(clone)||'').trim();
    } catch { return ''; }
  }
  function mount({root, getGroup, getBar, blocked, getDetached=()=>false, storage}) {
    const key='elio.checklistHidden',positionKey='elio.checklistPosition'; let collapsed=false, signature='',position=null,drag=null;
    try { if(!storage)storage=window.sessionStorage;collapsed=storage.getItem(key)==='1';const saved=JSON.parse(storage.getItem(positionKey));if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))position={x:saved.x,y:saved.y}; } catch {}
    const panel=document.createElement('section');panel.id='rs-task-checklist';panel.hidden=true;panel.setAttribute('aria-label','Task checklist');
    panel.innerHTML='<header><span class="rs-checklist-ring" role="progressbar" aria-label="Task plan progress" aria-valuemin="0" aria-valuemax="100"><svg viewBox="0 0 32 32" aria-hidden="true"><circle class="rs-checklist-track" cx="16" cy="16" r="12"/><circle class="rs-checklist-fill" cx="16" cy="16" r="12" pathLength="100" stroke-dasharray="100" transform="rotate(-90 16 16)"/></svg><span class="rs-checklist-percent"></span></span><span class="rs-checklist-heading"><strong>Task checklist</strong><small></small></span><button type="button" class="rs-checklist-hide" aria-label="Hide task checklist" title="Hide checklist — the AI keeps working">−</button></header><ol></ol>';
    const tab=document.createElement('button');tab.id='rs-checklist-show';tab.type='button';tab.hidden=true;tab.textContent='☑ Tasks';tab.setAttribute('aria-label','Show task checklist');
    root.append(panel,tab);
    function setCollapsed(value) {
      collapsed=value;try{if(value)storage.setItem(key,'1');else storage.removeItem(key);}catch{}
      place();(value?tab:panel.querySelector('button')).focus({preventScroll:true});
    }
    panel.querySelector('button').onclick=()=>setCollapsed(true);tab.onclick=()=>setCollapsed(false);
    function savePosition(){try{storage.setItem(positionKey,JSON.stringify(position));}catch{}}
    function stopDrag(){if(drag){const id=drag.id;drag=null;try{panel.releasePointerCapture(id);}catch{}panel.removeAttribute('data-dragging');savePosition();}}
    panel.addEventListener('pointerdown',event=>{
      if(!getDetached()||event.button!==0||event.target.closest('button'))return;
      const rect=panel.getBoundingClientRect();position={x:rect.left,y:rect.top};drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      try{panel.setPointerCapture(event.pointerId);}catch{}panel.dataset.dragging='true';event.preventDefault();
    });
    panel.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;position={x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y};place();event.preventDefault();});
    panel.addEventListener('pointerup',stopDrag);panel.addEventListener('pointercancel',stopDrag);panel.addEventListener('lostpointercapture',stopDrag);window.addEventListener('blur',stopDrag);
    const header=panel.querySelector('header');header.tabIndex=0;header.title='When the bar is hidden, drag this box or use arrow keys to move it.';header.setAttribute('aria-label','Task checklist; use arrow keys to move when detached');
    header.addEventListener('keydown',event=>{if(!getDetached()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const rect=panel.getBoundingClientRect(),step=event.shiftKey?40:10;position={x:rect.left+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:rect.top+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};place();savePosition();event.preventDefault();});
    function render() {
      const group=getGroup();
      if (!group || !group.taskLabel) {panel.hidden=true;tab.hidden=true;return;}
      const items=group.plan?.items?.length ? group.plan.items : [{label:'Waiting for the AI to describe the project goal',status:'pending'}];
      const completed=group.completed&&(!group.plan||group.plan.done===group.plan.total);
      const percent=completed?100:Math.round(100*(group.plan?group.plan.done/group.plan.total:0));
      const next=JSON.stringify([group.id,completed,group.ended,group.taskLabel,items,percent]);
      if(next!==signature){
        signature=next;panel.dataset.done=String(!!completed);
        panel.querySelector('.rs-checklist-percent').textContent=percent+'%';
        panel.querySelector('.rs-checklist-ring').setAttribute('aria-valuenow',String(percent));
        panel.querySelector('.rs-checklist-fill').style.strokeDashoffset=String(100-percent);
        const doneCount=completed?items.length:items.filter(item=>item.status==='completed').length;
        const goal=group.taskLabel&&group.taskLabel!=='Planning project work'?group.taskLabel:'Task checklist';
        panel.querySelector('small').textContent=completed?'Completed':(group.plan?`${doneCount} of ${items.length} done`+(group.ended?' · paused':''):'Waiting for task steps');
        panel.querySelector('strong').textContent=goal;
        panel.querySelector('strong').title=group.taskLabel;
        const list=panel.querySelector('ol');list.replaceChildren();
        for(const [index,item] of items.entries()){const row=document.createElement('li'),icon=document.createElement('span'),label=document.createElement('span');const done=completed||item.status==='completed';row.dataset.status=done?'completed':item.status;icon.className='rs-checklist-mark';icon.textContent=done?'✓':item.status==='in_progress'?'◉':'○';icon.setAttribute('aria-hidden','true');label.className="rs-checklist-label";label.textContent=(group.plan?`${index+1}. `:"")+item.label;row.setAttribute('aria-label',item.label+' — '+(done?'completed':item.status.replace('_',' ')));row.append(icon,label);list.append(row);}
      }
      place();
    }
    function place() {
      const group=getGroup(),bar=getBar(),rect=bar?.isConnected&&bar.style.display!=='none'?bar.getBoundingClientRect():null;
      const detached=!!getDetached(),available=!!group?.taskLabel&&(detached||!!rect?.width&&rect.top>64)&&!blocked();
      panel.hidden=!available||collapsed;tab.hidden=!available||!collapsed;
      if(!available)return;
      const element=collapsed?tab:panel,width=collapsed?94:Math.min(300,window.innerWidth-16);
      panel.dataset.detached=String(detached);
      if(detached){
        if(!position){const previous=element.getBoundingClientRect();position={x:previous.width?previous.left:Math.max(8,window.innerWidth-316),y:previous.height?previous.top:Math.max(8,window.innerHeight-380)};}
        element.style.width=width+'px';element.style.bottom='auto';panel.style.maxHeight=Math.max(48,Math.min(330,window.innerHeight-16))+'px';panel.style.setProperty('--rs-checklist-space',Math.max(48,Math.min(330,window.innerHeight-16))+'px');
        const height=element.offsetHeight||(collapsed?32:180);
        position.x=Math.max(8,Math.min(window.innerWidth-width-8,position.x));position.y=Math.max(8,Math.min(window.innerHeight-height-8,position.y));
        element.style.left=position.x+'px';element.style.top=position.y+'px';return;
      }
      stopDrag();element.style.top='auto';
      element.style.width=width+'px';element.style.left=Math.max(8,Math.min(window.innerWidth-width-8,rect.right-width))+'px';element.style.bottom=(window.innerHeight-rect.top+8)+'px';
      panel.style.maxHeight=Math.max(48,Math.min(330,rect.top-16))+'px';
      panel.style.setProperty('--rs-checklist-space',Math.max(48,Math.min(330,rect.top-16))+'px');
    }
    return {render,place,setCollapsed,panel,tab};
  }
  return {mount,userText};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=elioChecklist;
