const elioChatCreators = (() => {
  'use strict';
  const policy = 'CHAT MODEL/UI CREATION: When asked to make a Roblox model or UI, automatically use elio creation_preview in this chat; no desktop navigation is needed. Read relevant saved creator feedback, save a shape/layout pass, then bounded stable-ID detail patches. Use the headless_build blueprint schema, actual Roblox materials, world-space part centers and native UI properties. Each save is at most 120 nodes/55,000 characters, total at most 800 nodes. Save status ready only after validation and finish detailing. A RobloxScript model/UI creation request defaults to Studio insertion unless explicitly preview/draft/planning/export-only. Call creation_insert with the saved build_id and exact current revision, then verify the returned result and inspect/playtest relevant behavior. Never recreate the design independently in Luau: insertion uses the saved preview blueprint. Preview-only, draft-only, planning, export-only and do-not-insert requests MUST NOT insert. The desktop Create preview flow explicitly remains preview-only until Insert is chosen. Revise the same saved build for follow-up visual changes; preserve unrelated instances and gameplay scripts. Existing script bug fixes, gameplay logic and edits to unrelated existing UI/models use their normal tools. Creator preview rendering approximates Studio lighting/materials/fonts/layout; identical blueprint properties are not a promise of pixel-identical rendering. Studio insertion success must come from confirmed tool results.';
  const tool = {
    name: 'creation_insert', server: 'roblox',
    description: 'Insert a READY saved elio creator model/UI directly from this chat using its exact blueprint and revision. No desktop Insert button is required. Use after creation_preview for Studio creation requests; never for preview-only requests. Uses bounded, owned, exactly-once Studio passes; inspect partial/ambiguous failures before retrying.',
    inputSchema: {type:'object',required:['build_id','revision','action_id'],additionalProperties:false,properties:{
      build_id:{type:'string',description:'The saved creation_preview build_id.'},
      revision:{type:'integer',description:'Exact revision returned by the latest save/read.'},
      action_id:{type:'string',description:'Unique 1–64 character insertion ID (letters, digits, dot, dash, underscore). Reuse the same ID only for the same insertion outcome.'}
    }}
  };
  // Recover only an unambiguous save from an active creator task. This never
  // inserts into Studio and still passes through the normal blueprint validator.
  function recoverPreview(text, active) {
    if (!active || typeof text !== 'string' || text.length > 60000) return null;
    const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    if (fences.length > 1) return null;
    const candidate = fences.length === 1 ? fences[0][1].trim() : text.trim();
    let value; try { value = JSON.parse(candidate); } catch { return null; }
    if (!value || Array.isArray(value) || value.action !== 'save' ||
        !value.blueprint || typeof value.blueprint !== 'object' || Array.isArray(value.blueprint) ||
        Object.keys(value).some(key => !['action','blueprint','build_id','revision','status','stage','note'].includes(key))) return null;
    if (value.blueprint.build_id && value.build_id && value.blueprint.build_id !== value.build_id) return null;
    if (!value.blueprint.build_id && value.build_id) value.blueprint.build_id = value.build_id;
    return {tool:'creation_preview',arguments:value};
  }
  function previewOnly(text) {
    return /\b(?:preview[ -]only|draft[ -]only|export[ -]only|(?:do not|don['’]?t|never)\s+insert|(?:do not|don['’]?t|never)\s+(?:modify|change)\s+(?:Roblox\s+)?Studio)\b/i.test(String(text||'')) || /\b(?:just|only)\s+(?:a\s+)?(?:preview|draft|plan)\b/i.test(String(text||''));
  }
  function routeRequest(text) {
    const request=String(text||'').replace(/```[\s\S]*?```/g,' ').trim();
    if(request.length>40000 || /^(?:how\b|explain\b|what\b|why\b|can (?:i|someone)\b)/i.test(request))return '';
    const creation=/\b(?:make|build|create|generate|design|recreate)\b/i.test(request);
    const visual=/\b(?:ui|gui|hud|user interface|interface|model|3d model|shop menu|inventory menu|settings menu)\b/i.test(request);
    if(!creation || !visual || /\b(?:machine learning|language model|data model|view model|database model)\b/i.test(request))return '';
    return policy+'\nAvailable chat insertion command: '+JSON.stringify(tool)+'\nContinue the current request through the creator tools. Preserve explicit preview-only and placement instructions; do not restart the agent.';
  }
  function enhancementRequest(raw){return '(System note: Automatically enhance the current elio model/UI request before any creator mutation. Output only an improved prompt; do not create, save or insert anything in this rewrite turn.)\n'+elioEnhancer.buildRequest(raw);}
  function executionRequest(raw,enhanced){return '(System note: The creator prompt enhancement pass is complete. Continue the current task using the enhanced wording below. The exact original request remains authoritative: retain its names, dimensions, placement, style, constraints, preview-only instructions and all unfinished goals. Do not repeat the rewrite pass. No earlier proposed creator command was executed.)\n'+policy+'\nEXACT ORIGINAL REQUEST:\n'+raw+'\nENHANCED CREATION BRIEF:\n'+enhanced;}
  function createEnhancer(env){
    const pending=new Map();
    return {perform(key,raw){
      const context=env.context(),identity=context+'|'+key;
      if(pending.has(identity))return pending.get(identity);
      const check=()=>{if(env.cancelled()||env.context()!==context)throw Error('Creation prompt enhancement stopped or chat/engine changed. No creator command was executed.');};
      const operation=(async()=>{check();if(typeof raw!=='string'||!raw.trim()||raw.length>40000)throw Error('Use a creation request of at most 40,000 characters. The original request remains in the chat.');const enhanced=await env.rewrite(raw,check);check();if(typeof enhanced!=='string'||!enhanced.trim()||enhanced.length>40000)throw Error('The enhanced creation prompt is empty or too long. No creator command was executed.');const base=await env.send(executionRequest(raw,enhanced));check();return {base,enhanced};})();
      pending.set(identity,operation);operation.finally(()=>{if(pending.get(identity)===operation)pending.delete(identity);}).catch(()=>{});return operation;
    }};
  }
  function batches(blueprint) {
    const draft=elioCreator.clone(blueprint);
    for(const node of draft.nodes||[]){if(node.id===draft.root_id && node.parent==='')delete node.parent;if(node.name==='')delete node.name;}
    return elioCreator.batches(draft);
  }
  function create(env) {
    const outcomes = new Map();
    let busy = false;
    function insert(args) {
      const context = env.context();
      if(!args || typeof args.build_id!=='string' || !args.build_id || args.build_id.length>96 || !Number.isSafeInteger(args.revision) || args.revision<1 || !/^[a-zA-Z0-9_.-]{1,64}$/.test(args.action_id||'') || Object.keys(args).some(key=>!['build_id','revision','action_id'].includes(key)))return Promise.resolve({ok:false,error:'Supply build_id, an exact positive revision and a valid unique action_id. No Studio command was sent.'});
      const key = context+'|'+args.action_id;
      const signature = JSON.stringify([args.build_id,args.revision]);
      if(outcomes.has(key)) {
        const previous=outcomes.get(key);
        return previous.signature===signature ? previous.result : Promise.resolve({ok:false,error:'This insertion action_id already belongs to a different draft/revision. No Studio command was sent.'});
      }
      if(busy)return Promise.resolve({ok:false,error:'Another creator insertion is still running. No additional Studio command was sent.'});
      busy=true;
      const result=(async()=>{
        let done=0,total=0;
        const started=Date.now();
        const check=()=>{if(!env.allowed() || env.context()!==context || Date.now()-started>110000)throw Error('Insertion stopped or chat/engine changed. Inspect Studio before retrying.');};
        try {
          check();
          const response=await env.read(args.build_id);
          check();
          if(!response?.ok || !response.record)throw Error(response?.error||'Saved creator draft is unavailable.');
          const record=response.record;
          if(record.revision!==args.revision)throw Error('Draft changed. Read the latest revision before inserting.');
          if(record.status!=='ready')throw Error('Finish the draft and save status ready before inserting; partial/building drafts are not inserted automatically.');
          if(record.blueprint?.build_id!==args.build_id)throw Error('Saved build identity does not match.');
          const draft=elioCreator.clone(record.blueprint);
          const passes=batches(draft);
          total=passes.length;
          for(let index=0;index<passes.length;index++) {
            check();
            const current=await env.read(args.build_id);
            check();
            if(!current?.ok || current.record?.revision!==args.revision || current.record?.status!=='ready')throw Error('Saved draft changed during insertion.');
            const pass={...passes[index],action_id:'chat-'+args.action_id+'-'+index};
            const compiled=ZSHeadlessBuilder.compile(pass);
            if(!compiled.ok)throw Error(compiled.error);
            const outcome=await env.execute(compiled);
            if(!outcome?.ok || outcome.payload?.ok!==true || outcome.payload.build_id!==draft.build_id || outcome.payload.action_id!==pass.action_id || outcome.payload.ownership_verified===false)throw Error(outcome?.error||outcome?.payload?.error||'Studio did not confirm this insertion pass.');
            done++;
            check();
          }
          const final=await env.read(args.build_id);
          check();
          if(!final?.ok || final.record?.revision!==args.revision)throw Error('Saved draft changed before insertion verification completed.');
          return {ok:true,build_id:draft.build_id,revision:args.revision,nodes:draft.nodes.length,passes:done,root_path:draft.target_parent+'.'+draft.root_name,studio_changed:true,blueprint_source:'exact saved creator revision',message:'Saved model/UI inserted through validated owned passes. Review Studio rendering and test gameplay/UI behavior.'};
        }catch(error){return {ok:false,build_id:args.build_id,revision:args.revision,completed_passes:done,total_passes:total,studio_changed:done>0,completion_uncertain:total>0,error:String(error.message||error)+' Finished/uncertain passes must be inspected before another insertion.'};}
        finally {busy=false;}
      })();
      outcomes.set(key,{signature,result});
      if(outcomes.size>100)outcomes.delete(outcomes.keys().next().value);
      return result;
    }
    return {insert};
  }
  return {policy,tool,routeRequest,previewOnly,recoverPreview,batches,create,enhancementRequest,executionRequest,createEnhancer};
})();
if(typeof module!=='undefined')module.exports=elioChatCreators;
