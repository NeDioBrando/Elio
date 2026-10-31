// Styled, keyboard-accessible effort menu. The original select remains the state/event contract.
function elioMountEffortPicker(select){
 if(!select||select.tagName!=='SELECT')return null;if(select._ultraPicker)return select._ultraPicker;
 const wrap=document.createElement('div');wrap.className='pc-effort-picker';select.before(wrap);wrap.append(select);select.hidden=true;
 const trigger=document.createElement('button');trigger.type='button';trigger.className='pc-effort-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
 const label=document.createElement('span'),arrow=document.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');trigger.append(label,arrow);
 const panel=document.createElement('div');panel.className='pc-effort-options';panel.hidden=true;panel.setAttribute('role','listbox');panel.setAttribute('aria-label','Reasoning effort');
 const options=Array.from(select.options).map(option=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.tabIndex=-1;button.dataset.value=option.value;const text=document.createElement('span');text.textContent=option.textContent;text.classList.toggle('pc-ultra-label',option.value==='ultracode');button.append(text);button.onclick=()=>choose(option.value);panel.append(button);return button;});
 wrap.append(trigger,panel);
 function refresh(){const value=select.value,text=Array.from(select.options).find(o=>o.value===value)?.textContent||'Default';if(label.textContent!==text)label.textContent=text;label.classList.toggle('pc-ultra-label',value==='ultracode');trigger.disabled=select.disabled;trigger.setAttribute('aria-label','Reasoning effort: '+text);for(const b of options)b.setAttribute('aria-selected',String(b.dataset.value===value));}

 function place(){
  if(panel.hidden)return;
  const rect=trigger.getBoundingClientRect(), view=window.visualViewport;
  const leftEdge=view?.offsetLeft||0,topEdge=view?.offsetTop||0;
  const width=view?.width||innerWidth,height=view?.height||innerHeight;
  const below=Math.max(0,topEdge+height-rect.bottom-12),above=Math.max(0,rect.top-topEdge-12);
  const up=above>below,room=Math.max(32,Math.min(280,up?above:below));
  Object.assign(panel.style,{position:'fixed',margin:'0',bottom:'auto',right:'auto',boxSizing:'border-box',
    width:Math.min(Math.max(rect.width,160),Math.max(32,width-16))+'px',maxHeight:room+'px',
    left:Math.max(leftEdge+8,Math.min(rect.left,leftEdge+width-Math.max(rect.width,160)-8))+'px',
    top:(up?Math.max(topEdge+8,rect.top-room-5):rect.bottom+5)+'px'});
 }
 function close(focus=false){if(typeof panel.hidePopover==='function'){try{panel.hidePopover();}catch{}}panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
 function open(index){refresh();if(trigger.disabled)return;
  panel.hidden=false;
  if(typeof panel.showPopover==='function'){panel.setAttribute('popover','manual');try{panel.showPopover();}catch{panel.removeAttribute('popover');document.body.append(panel);}}
  else {document.body.append(panel);}
  place();trigger.setAttribute('aria-expanded','true');(options[index]||options.find(b=>b.dataset.value===select.value)||options[0])?.focus();
 }
 function choose(value){if(panel.hidden)return;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));refresh();close(true);}
 trigger.onclick=()=>panel.hidden?open():close();trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();open(e.key==='Home'?0:e.key==='End'?options.length-1:undefined);}};
 panel.onkeydown=e=>{const index=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='Tab')close();else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next].focus();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(index>=0)choose(options[index].dataset.value);}};
 const outside=e=>{if(!wrap.contains(e.target)&&!panel.contains(e.target))close();};document.addEventListener('pointerdown',outside);select.addEventListener('change',refresh);
 const reposition=()=>{if(!panel.hidden)place();};
 window.addEventListener('resize',reposition);document.addEventListener('scroll',reposition,true);
 window.visualViewport?.addEventListener('resize',reposition);
 const timer=setInterval(()=>{if(!wrap.isConnected){close();panel.remove();clearInterval(timer);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',reposition);document.removeEventListener('scroll',reposition,true);window.visualViewport?.removeEventListener('resize',reposition);select.removeEventListener('change',refresh);select._ultraPicker=null;return;}if(!panel.hidden&&(trigger.disabled||!trigger.getClientRects().length))close();refresh();},500);refresh();
 return select._ultraPicker={refresh,close};
}
if(typeof module!=='undefined')module.exports=elioMountEffortPicker;
