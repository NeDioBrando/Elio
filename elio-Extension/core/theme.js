// SPDX-License-Identifier: GPL-3.0-or-later
// Shared product-only light/dark mode. Never changes an AI website's theme.
(()=>{'use strict';let mode='light';const bindings=new Set();
const icons={dark:'<path d="M20.8 13A8.7 8.7 0 0 1 11 3.2 8.8 8.8 0 1 0 20.8 13Z"/>',light:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'};
function paint(b){const next=mode==='dark'?'light':'dark',key=next==='dark'?'Switch to dark theme':'Switch to light theme',label=globalThis.elioI18n?.t(key)||key;b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[next]+'</svg>';b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(mode==='dark'));}
function apply(value){mode=value==='dark'?'dark':'light';document.documentElement.dataset.elioMode=mode;if(document.documentElement.hasAttribute('data-elio'))try{localStorage.setItem('elioColorMode',mode);}catch{}for(const b of bindings){if(b.isConnected)paint(b);else bindings.delete(b);}return mode;}
function mount(button,save){if(!button)return;button.type='button';button.classList.add('elio-theme-toggle');bindings.add(button);paint(button);button.onclick=async()=>{const previous=mode;apply(mode==='dark'?'light':'dark');button.disabled=true;try{await save(mode);}catch(error){apply(previous);button.title=(globalThis.elioI18n?.t('Could not save theme')||'Could not save theme')+': '+(error?.message||error);}finally{button.disabled=false;}};}
function mountBrowser(button){mount(button,value=>chrome.storage.local.set({rsColorMode:value}));}
globalThis.elioTheme={apply,mount,mountBrowser,get mode(){return mode;}};
try{globalThis.elioI18n?.onChange(()=>{for(const b of bindings)paint(b);});}catch{}
// Extension worlds have storage; native WebView uses its preferences API instead.
try{if(document.documentElement.hasAttribute('data-elio'))apply(localStorage.getItem('elioColorMode'));}catch{}
try{if(globalThis.chrome?.storage?.local){chrome.storage.local.get(['rsColorMode'],r=>apply(r?.rsColorMode));chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.rsColorMode)apply(changes.rsColorMode.newValue);});}}catch{}
})();
