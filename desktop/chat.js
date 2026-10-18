// SPDX-License-Identifier: GPL-3.0-or-later
// UI knows only this transport contract. A future CDP/Lightpanda adapter can
// implement it without exposing chrome.* or provider DOM to the renderer.
(function (global) {
  'use strict';
  function identity(control) { return JSON.stringify([control.browser_id, control.tab_id, control.chat]); }
  function createTransport(api) {
    function action(control, name, prompt, id) {
      return api('/api/desktop/agent', {method:'POST',body:JSON.stringify({action:name,prompt:prompt || '',request_id:id || crypto.randomUUID(),chat:control.chat,browser_id:control.browser_id,tab_id:control.tab_id})}).then(function(result){
        if (!result || !result.ok) throw Error(result && result.error || 'Нет подтверждения от расширения.');
        return result;
      });
    }
    return {
      read: function(c, revision){return action(c,'chat-read',JSON.stringify({chat:c.chat,revision:revision}));},
      send: function(c, text, id){return action(c,'task-send',text,id);},
      start: function(c){return action(c,'start');},
      stop: function(c){return action(c,'stop');},
      pin: function(c, pinned){return action(c,'chat-pin',pinned?'on':'off');}
    };
  }
  // Never interpret model/site text as HTML. Only fenced code gets a distinct
  // visual treatment; scripts, images, and links remain inert plain text.
  function renderText(node, text) {
    node.replaceChildren();
    var parts = String(text).split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
    parts.forEach(function(part){
      if (!part) return;
      var block = document.createElement(part.startsWith('```')?'pre':'p');
      if(part.startsWith('```')) {
        var newline=part.indexOf('\n'), code=document.createElement('code');
        code.textContent=part.slice(newline+1).replace(/```$/, '');block.appendChild(code);
      } else block.textContent=part;
      node.appendChild(block);
    });
  }
  function mount(root, transport, getState, ipc) {
    root.innerHTML='<div class="sc-chat"><header class="sc-chat-head"><div><div class="sc-eyebrow">SYNERIXCODE / CHAT WORKSPACE</div><h1>От идеи — к проекту.</h1><p id="sc-chat-provider">Браузер — движок. Здесь — ваш рабочий чат.</p></div><div class="sc-chat-controls"><button type="button" id="sc-chat-pin" aria-pressed="false">Закрепить вкладку</button><button type="button" id="sc-chat-start">Запустить агента</button><button type="button" id="sc-chat-stop" hidden>Остановить</button></div></header><div class="sc-chat-health" id="sc-chat-health" role="status">Подключение к локальному мосту…</div><div class="sc-chat-thread" id="sc-chat-thread" tabindex="0" role="region" aria-label="Сообщения чата"><div class="sc-chat-empty" id="sc-chat-empty"><div class="sc-eyebrow">ОДНО ОКНО ДЛЯ РАБОТЫ</div><h2>Ваш ИИ. Ваши инструменты.</h2><p>Откройте поддерживаемый чат в браузере с расширением synerixcode. Закрепите вкладку и запустите агента — затем пишите здесь.</p><div class="sc-chat-launch"><button type="button" data-sc-open="open:chatgpt">Открыть ChatGPT ↗</button><button type="button" data-sc-open="open:deepseek">Открыть DeepSeek ↗</button></div><p class="sc-chat-caption">Roblox Studio · Blender · AgentScript</p></div></div><div class="sc-chat-notice" id="sc-chat-notice" role="status"></div><form id="sc-chat-form" class="sc-chat-composer"><label for="sc-chat-input">Сообщение для ИИ</label><textarea id="sc-chat-input" rows="3" maxlength="40000" placeholder="Что создадим? Например, сцену с освещением в Roblox Studio…"></textarea><div class="sc-chat-compose-footer"><span>Enter — отправить · Shift + Enter — новая строка</span><button type="submit" id="sc-chat-send">Отправить ↑</button></div></form><p class="sc-chat-caption sc-chat-footnote">Показываются захваченные расширением сообщения. Не загруженная сайтом история может отсутствовать.</p></div>';
    var q=function(id){return root.querySelector('#sc-chat-'+id);};
    var current=null, owner='', revision=null, reading=false, changing=false, sending=false, cooldown=0, error='', notice='', pending=null;
    var drafts=new Map(), mounted=new Map();
    var input=q('input'), thread=q('thread');
    function remember(){if(owner)drafts.set(owner,{text:input.value,pending:pending});}
    function showNotice(text){notice=text;q('notice').textContent=text;}
    function controls() {
      var c=current || {}, ready=!!c.canChatRead;
      q('pin').disabled=!(c.canChatPin || ready) || changing;
      q('pin').textContent=c.pinned?'Вкладка закреплена ✓':'Закрепить вкладку';
      q('pin').setAttribute('aria-pressed',String(!!c.pinned));
      q('start').disabled=!c.canStart || changing;q('start').hidden=!!c.canTaskSend || !!c.canStop;
      q('stop').hidden=!c.canStop;q('stop').disabled=changing;
      q('send').disabled=!c.canTaskSend || sending || Date.now()<cooldown || !input.value.trim();
      q('send').textContent=sending?'Принимается…':pending?'Повторить вручную':'Отправить ↑';
      q('provider').textContent=c.provider ? c.provider+' · '+(c.engine==='local'?'AgentScript':'Roblox Studio')+(c.pinned?' · вкладка закреплена':' · активная вкладка браузера') : 'Браузер — движок. Здесь — ваш рабочий чат.';
      var state=getState() || {};
      q('health').textContent=error || (!ready?'Откройте или обновите поддерживаемый чат в браузере.':(c.status || 'Чат подключён.'))+' · Studio: '+(state.roblox_connected?'подключена':'не подключена')+' · Blender: '+(state.blender_connected?'подключён':'не подключён');
    }
    function render(result) {
      if(result.not_modified)return;
      revision=result.revision;
      var previousScroll=thread.scrollTop;
      var bottom=thread.scrollHeight-previousScroll-thread.clientHeight<90;
      var rows=result.history || [], keep=new Set(rows.map(function(row){return row.id;}));
      mounted.forEach(function(node,id){if(!keep.has(id)){node.remove();mounted.delete(id);}});
      q('empty').hidden=rows.length>0;
      rows.forEach(function(row){
        var node=mounted.get(row.id);
        if(!node){node=document.createElement('article');node.className='sc-chat-message '+(row.role==='user'?'sc-chat-user':'sc-chat-assistant');var label=document.createElement('h3');label.textContent=row.role==='user'?'Вы':result.provider || 'ИИ';var body=document.createElement('div');node.append(label,body);mounted.set(row.id,node);}
        if(node._text!==row.text){renderText(node.lastChild,row.text);node._text=row.text;}
        thread.appendChild(node);
      });
      thread.scrollTop=bottom?thread.scrollHeight:previousScroll;
      root.querySelector('.sc-chat-footnote').textContent=result.omitted?'Часть ранней истории не показана: лимит живого окна — 300 сообщений / 160 000 символов. Архив доступен в настройках.':'Показываются захваченные расширением сообщения. Не загруженная сайтом история может отсутствовать.';
    }
    async function tick() {
      if(!root.closest('.page').classList.contains('active') || document.hidden)return;
      var c=(getState() || {}).browser_agent || {};
      if(c.canChatRead || c.canChatPin) {
        var next=identity(c);
        if(next!==owner){remember();owner=next;revision=null;mounted.forEach(function(node){node.remove();});mounted.clear();q('empty').hidden=false;var saved=drafts.get(owner);input.value=saved?saved.text:'';pending=saved?saved.pending:null;showNotice('');error='';}
        current=c;
      } else current=null;
      controls();
      if(!current || !current.canChatRead || reading)return;
      reading=true;var selected=owner, snapshot=current;
      try{var result=await transport.read(snapshot,revision);if(selected===owner && result.chat===snapshot.chat){render(result);error='';}}
      catch(e){if(selected===owner)error='Не удалось прочитать чат: '+e.message;}
      finally{reading=false;controls();}
    }
    async function command(name) {
      if(!current || changing)return;
      changing=true;var c=current, selected=owner;controls();
      try{await transport[name](c,name==='pin'?!c.pinned:undefined);if(selected===owner)showNotice(name==='start'?'Запуск принят. Дождитесь готовности агента, затем отправьте запрос.':name==='stop'?'Запрос на остановку принят.':'Настройка вкладки сохранена.');}
      catch(e){if(selected===owner)showNotice(e.message);}
      finally{changing=false;controls();}
    }
    q('pin').onclick=function(){command('pin');};q('start').onclick=function(){command('start');};q('stop').onclick=function(){command('stop');};
    root.querySelectorAll('[data-sc-open]').forEach(function(button){button.onclick=function(){ipc(button.dataset.scOpen);};});
    input.oninput=function(){if(pending && pending.text!==input.value)pending=null;remember();controls();};
    input.onkeydown=function(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!q('send').disabled)q('form').requestSubmit();}};
    q('form').onsubmit=async function(event){
      event.preventDefault();if(q('send').disabled || !current)return;
      var c=current, selected=owner, text=input.value;
      var request=pending && pending.text===text?pending:{id:crypto.randomUUID(),text:text};pending=request;remember();sending=true;controls();
      try{
        await transport.send(c,text,request.id);
        if(selected===owner){if(input.value===text)input.value='';pending=null;remember();showNotice('Запрос принят расширением. Ответ появится в чате.');}
        else {var saved=drafts.get(selected);drafts.set(selected,{text:saved && saved.text!==text?saved.text:'',pending:null});}
        cooldown=Date.now()+1500;
      } catch(e){if(selected===owner)showNotice('Запрос не подтверждён: '+e.message+' Черновик сохранён. Проверьте историю перед ручным повтором; автоматически запрос не повторяется.');}
      finally{sending=false;controls();}
    };
    controls();tick();var timer=setInterval(tick,1000);
    return {refresh:tick,destroy:function(){clearInterval(timer);}};
  }
  global.synerixcodeDesktopChat={createTransport:createTransport,mount:mount,renderText:renderText,identity:identity};
}(globalThis));
