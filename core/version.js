// SPDX-License-Identifier: GPL-3.0-or-later
// Native agent is the sole network/release authority. UI never supplies URLs.
const synerixcodeVersion = (() => {
  function tuple(value){return /^\d+\.\d+\.\d+$/.test(String(value))?String(value).split('.').map(Number):null;}
  function compare(a,b){a=tuple(a);b=tuple(b);if(!a||!b)return 0;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i]?1:-1;}return 0;}
  function display(current){return tuple(current)?String(current):'?';}
  function describe(current,status){
    const s=status||{}, busy=s.installing||['downloading','installing'].includes(s.phase);
    const native=s.current||current, latest=s.latest && compare(s.latest,native)>0?s.latest:native;
    const outdated=s.outdated===true || compare(latest,current)>0, reload=outdated&&compare(native,current)>0&&!s.outdated;
    let title='',text='',button='',action='',disabled=false;
    if(busy){title='Обновление выполняется';text=s.phase==='downloading'?'Скачивание и проверка пакета'+(s.size?' · '+Math.min(100,Math.floor((s.downloaded||0)/s.size*100))+'%':''):'Подготовка и перезапуск приложения…';disabled=true;button='Обновляется…';}
    else if(reload){title='Версия устарела · Outdated';text='Приложение v'+native+' уже установлено. Перезагрузите расширение, затем обновите вкладки ИИ.';button='Перезагрузить расширение';action='reload';}
    else if(outdated){title='Версия устарела · Outdated';text=(native!==current?'Приложение v'+display(native)+' · расширение v'+display(current):'Установлена v'+display(current))+' → доступна v'+display(latest)+'.';button='Обновить';action='install';disabled=s.supported===false||s.phase==='checking';}
    else if(s.phase==='error'){title='Не удалось проверить обновления';text=s.error||'Повторите проверку позже.';button='Проверить снова';action='check';}
    else if(s.phase==='unpublished'){title='Релиз ещё не опубликован';text='Стабильный Windows-релиз не найден.';button='Проверить снова';action='check';}
    const notes=outdated&&!reload&&s.error?s.error:'';
    return {outdated,reload,busy,title,text,notes,button,action,disabled,visible:!!title,latest,label:'v'+display(current)+(outdated?' · Outdated':''),color:outdated?'#ffcf83':'#a5ceff'};
  }
  function render(element,current,status,prefix='v',extra=''){
    if(!element)return;const view=describe(current,status);
    element.textContent=String(prefix).replace(/v$/,'')+view.label+extra;
    element.title=view.outdated?view.text:'synerixcode v'+display(current);
    element.setAttribute('aria-label',element.textContent);
    element.toggleAttribute('data-outdated',view.outdated);
    if(view.outdated)element.style.color='#ffcf83';else element.style.removeProperty('color');
  }
  function styles(){
    if(document.getElementById('synerixcode-update-styles'))return;
    const style=document.createElement('style');style.id='synerixcode-update-styles';style.textContent=`
.sc-update-host{flex:none;min-width:0}.sc-update-host[hidden]{display:none!important}.sc-version-notice{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;margin:12px 24px 0;border:1px solid #b48b4e;border-radius:8px;background:#292116;color:#fff4e3;font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;overflow-wrap:anywhere;text-align:left;color-scheme:dark}.sc-version-notice strong{display:block;font-size:16px;color:#ffcf83}.sc-version-notice p{margin:4px 0 0;white-space:pre-wrap}.sc-version-notice button{flex:none;min-height:44px;max-width:100%;border:1px solid #ffcf83;background:#ffcf83;color:#23190b;border-radius:8px;padding:10px 18px;font:600 14px/1.4 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer}.sc-version-notice button:disabled{opacity:.6;cursor:wait}.sc-version-notice button:focus-visible{outline:2px solid white;outline-offset:3px}.sc-update-floating{position:fixed;z-index:2147483646;top:16px;right:16px;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto}.sc-update-floating .sc-version-notice{margin:0;box-shadow:0 4px 18px #0005;flex-direction:column;align-items:stretch;gap:12px}.sc-update-floating .sc-version-notice button{align-self:flex-start}.sc-version-notice [hidden]{display:none!important}@media(max-width:600px){.sc-version-notice{padding:16px;margin:8px 16px 0;align-items:stretch;flex-direction:column;gap:12px}.sc-version-notice button{align-self:flex-start}.sc-update-floating .sc-version-notice{margin:0}}`;
    document.documentElement.appendChild(style);
  }
  function mount(host,options){
    styles();host.classList.add('sc-update-host');if(options.floating)host.classList.add('sc-update-floating');
    host.innerHTML='<section class="sc-version-notice" aria-label="Обновление SynerixCode"><div role="status"><strong data-update-title></strong><p data-update-text></p><p data-update-error></p></div><button type="button" data-update-action></button></section>';
    const title=host.querySelector('[data-update-title]'),text=host.querySelector('[data-update-text]'),error=host.querySelector('[data-update-error]'),button=host.querySelector('button');
    let pending=false,refreshing=false,view={},localError='',lastStatusKey='';
    async function refresh(){
      if(refreshing)return;refreshing=true;
      try{const status=await options.getStatus();const statusKey=JSON.stringify(status&&[status.phase,status.current,status.latest,status.error,status.checked_at]);if(statusKey!==lastStatusKey){localError='';lastStatusKey=statusKey;}view=describe(typeof options.current==='function'?options.current():options.current,status);host.hidden=!view.visible;title.textContent=view.title;text.textContent=view.text;error.textContent=localError||view.notes;button.textContent=view.button;button.hidden=!view.button;button.disabled=pending||view.disabled;}
      catch(e){host.hidden=false;title.textContent='Нет связи с приложением';text.textContent='Запустите synerixcode.exe для проверки и установки обновлений.';error.textContent=e.message||String(e);button.hidden=true;}
      finally{refreshing=false;}
    }
    button.onclick=async()=>{if(pending||!view.action)return;pending=true;localError='';button.disabled=true;try{await options.invoke(view.action);localError=view.action==='reload'?'После перезагрузки расширения обновите эту вкладку.':'Запрос принят. Ожидайте смены статуса.';}catch(e){localError=e.message||String(e);}finally{pending=false;refresh();}};
    refresh();const timer=setInterval(refresh,options.interval||2000);
    return {refresh,destroy(){clearInterval(timer);host.replaceChildren();}};
  }
  function browserPage(){return '';}
  async function detectBrowser(){return '';}
  return {display,compare,describe,render,mount,browserPage,detectBrowser};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=synerixcodeVersion;
