// SPDX-License-Identifier: GPL-3.0-or-later
// Presentation only: NEVER executes, translates or discards original content.
(function(g){'use strict';
function brace(s,at){let n=0,q=false,e=false;for(let i=at;i<s.length;i++){let c=s[i];if(q){if(e)e=false;else if(c==='\\')e=true;else if(c==='"')q=false;}else if(c==='"')q=true;else if(c==='{')n++;else if(c==='}'&&!--n)return i+1;}return -1;}
function name(raw){try{let o=JSON.parse(raw);return typeof(o.command||o.tool)==='string'?(o.command||o.tool):null;}catch{return null;}}
function segments(text){
 const s=String(text||''),spans=[];let m;
 const markers=/###\s*(MCP_TOOL|LUA)(?:\s*[:_-]\s*(Edit|Server|Client))?\s*###/ig;
 while((m=markers.exec(s))){const close=new RegExp('###\\s*END[_ -]?'+m[1]+'\\s*###','ig');close.lastIndex=markers.lastIndex;const end=close.exec(s);const stop=end?close.lastIndex:s.length;const raw=s.slice(m.index,stop);spans.push({at:m.index,end:stop,type:'tool',name:m[1].toUpperCase()==='LUA'?'execute_luau':name(s.slice(markers.lastIndex,end?end.index:s.length).trim().replace(/^```json\s*|```$/g,''))||'Tool call',raw});markers.lastIndex=stop;}
 // Only command/tool objects, not arbitrary JSON or quoted tool names.
 for(let at=0;at<s.length;at++){if(s[at]!=='{'||spans.some(x=>at>=x.at&&at<x.end))continue;const end=brace(s,at);if(end<0){if(/^\{\s*"(?:command|tool)"\s*:/.test(s.slice(at)))spans.push({at,end:s.length,type:'tool',name:'Tool call',raw:s.slice(at)});break;}const raw=s.slice(at,end),tool=name(raw);if(tool){let from=at,to=end;const before=s.slice(0,at).match(/```(?:json)?\s*$/i),after=s.slice(end).match(/^\s*```/);if(before&&after){from=at-before[0].length;to=end+after[0].length;}spans.push({at:from,end:to,type:'tool',name:tool,raw});at=end-1;}}
 spans.sort((a,b)=>a.at-b.at);const out=[];let pos=0;for(const x of spans){if(x.at<pos)continue;if(s.slice(pos,x.at).trim())out.push({type:'text',text:s.slice(pos,x.at)});out.push(x);pos=x.end;}if(s.slice(pos).trim())out.push({type:'text',text:s.slice(pos)});return out.length?out:[{type:'text',text:s}];
}
function present(row){
 const raw=String(row.text||''),system=row.kind==='system'||(row.role==='user'&&raw.includes('⟦RS-SYS⟧'));
 const feedback=row.kind==='result'||(row.role==='user'&&/^\s*(?:Output of '[^']+':|\(System note:|\[elio retained the COMPLETE result\.)/.test(raw));
 if(system)return {...row,kind:'system',name:'Agent setup',segments:[],status:row.phase==='run'?'running':'done'};
 if(feedback){const m=raw.match(/Output of '([^']+)'/);const failed=row.phase==='err'||/^\s*ERROR\b/.test(raw)||/^\s*Output of '[^']+':\s*ERROR\b/i.test(raw);return {...row,kind:'result',name:m?m[1]:'Tool result',segments:[],status:failed?'error':'done'};}
 const parts=row.role==='assistant'?segments(raw):[{type:'text',text:raw}];return {...row,kind:parts.some(p=>p.type==='tool')?'tool':'message',segments:parts,status:row.phase==='err'?'error':row.phase==='done'?'done':row.phase==='run'?'running':'requested'};
}
function prepare(rows){const out=(rows||[]).map(present),waiting=new Map();out.forEach(r=>{if(r.kind==='tool')for(const s of r.segments.filter(x=>x.type==='tool'))waiting.set(s.name,{r,s});if(r.kind==='result'){const w=waiting.get(r.name);if(w){w.s.status=r.status;w.r.status=r.status;waiting.delete(r.name);}}});return out;}
const api={segments,present,prepare};g.elioChatView=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
