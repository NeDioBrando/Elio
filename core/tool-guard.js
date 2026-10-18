// SPDX-License-Identifier: GPL-3.0-or-later
const elioToolGuard = (() => {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validate(value, schema, path = 'arguments', depth = 0) {
    if (!object(schema) || depth > 12) return [];
    const errors = [], types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const matches = type => type === 'object' ? object(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : type === 'null' ? value === null : typeof value === type;
    if (types.length && !types.some(matches)) return [`${path}: expected ${types.join(' or ')}`];
    if (schema.enum && !schema.enum.some(entry => JSON.stringify(entry) === JSON.stringify(value))) errors.push(`${path}: use ${JSON.stringify(schema.enum)}`);
    if (Object.hasOwn(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
    if (typeof value === 'string') {
      if (schema.minLength != null && [...value].length < schema.minLength) errors.push(`${path}: too short`);
      if (schema.maxLength != null && [...value].length > schema.maxLength) errors.push(`${path}: too long`);
    }
    if (typeof value === 'number') {
      if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: minimum ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: maximum ${schema.maximum}`);
    }
    if (object(value)) {
      for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
      for (const [key, entry] of Object.entries(value)) {
        if (schema.properties?.[key]) errors.push(...validate(entry, schema.properties[key], `${path}.${key}`, depth + 1));
        else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown argument`);
      }
    }
    if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: too few entries`);
      if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: too many entries`);
      if (schema.items && !Array.isArray(schema.items)) for (let i = 0; i < Math.min(value.length, 2000); i++) errors.push(...validate(value[i], schema.items, `${path}[${i}]`, depth + 1));
    }
    if (schema.anyOf && !schema.anyOf.some(branch => !validate(value, branch, path, depth + 1).length)) errors.push(`${path}: no allowed argument shape matches`);
    if (schema.oneOf && schema.oneOf.filter(branch => !validate(value, branch, path, depth + 1).length).length !== 1) errors.push(`${path}: expected one allowed argument shape`);
    for (const branch of schema.allOf || []) errors.push(...validate(value, branch, path, depth + 1));
    return errors.slice(0, 12);
  }
  function incompleteLuau(code) {
    const stack=[]; let i=0;
    while(i<code.length) {
      const c=code[i];
      if(code.startsWith('--',i)) {
        const long=/^\[(=*)\[/.exec(code.slice(i+2));
        if(long){const close=']'+long[1]+']',end=code.indexOf(close,i+2+long[0].length);if(end<0)return 'Unclosed long comment';i=end+close.length;}
        else {const end=code.indexOf('\n',i+2);i=end<0?code.length:end+1;}continue;
      }
      if(c==='"'||c==="'"||c==='`') {
        const quote=c;i++;let closed=false;
        while(i<code.length){if(code[i]==='\\'){i+=2;continue;}if(code[i++]===quote){closed=true;break;}}
        if(!closed)return 'Unclosed quoted string';continue;
      }
      const long=c==='[' && /^\[(=*)\[/.exec(code.slice(i));
      if(long){const close=']'+long[1]+']',end=code.indexOf(close,i+long[0].length);if(end<0)return 'Unclosed long string';i=end+close.length;continue;}
      if('({['.includes(c))stack.push(c);
      else if(')}]'.includes(c) && stack.pop()!==({')':'(', '}':'{', ']':'['})[c])return 'Mismatched code delimiter';
      i++;
    }
    return stack.length?'Unclosed code delimiter':'';
  }
  function check(call, tools) {
    if (!call || typeof call.tool !== 'string' || !call.tool.trim()) return ['A tool name is required.'];
    const args = call.arguments == null ? {} : call.arguments;
    if (!object(args)) return ['arguments must be a JSON object, not a string or array.'];
    const name = call.tool.split('/').pop();
    const tool = (tools || []).find(tool => tool.name === call.tool || tool.name === name);
    const normalized = Object.fromEntries(Object.entries(args).filter(([key]) => !['_orChunk', '_orNoTxn'].includes(key)));
    if (name === 'execute_luau' && !normalized.datamodel_type) normalized.datamodel_type = 'Edit';
    if (['user_keyboard_input', 'user_mouse_input'].includes(name) && !normalized.datamodel_type) normalized.datamodel_type = 'Client';
    const errors = validate(normalized, tool?.inputSchema || tool?.input_schema || tool?.parameters);
    if (name === 'execute_luau') {
      if (typeof args.code !== 'string' || !args.code.trim()) errors.push('arguments.code: non-empty Luau code is required');
      if (args.datamodel_type && !['Edit', 'Client', 'Server'].includes(args.datamodel_type)) errors.push('arguments.datamodel_type: use Edit, Client or Server');
      if (typeof args.code === 'string' && /^(?:###(?:END_)?LUA###|```)/.test(args.code.trim())) errors.push('arguments.code: send code only; remove Markdown fences and protocol markers');
      if (typeof args.code === 'string') { const error=incompleteLuau(args.code);if(error)errors.push('arguments.code: '+error+'; the command may be truncated'); }
    }
    return errors.slice(0, 12);
  }
  // Repairs the harmless shape mistakes models (ChatGPT especially) make most
  // often - stringified arguments, fenced Luau, wrong-case enums, quoted
  // numbers/booleans/arrays - so the command runs first time instead of
  // bouncing back as an error turn. Real mistakes are left for check().
  function coerce(value, schema, depth = 0) {
    if (!object(schema) || depth > 12) return value;
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    if (typeof value === 'string') {
      const t = value.trim();
      if (types.includes('string')) {
        if (Array.isArray(schema.enum) && !schema.enum.includes(value)) { const hit = schema.enum.find(e => typeof e === 'string' && e.toLowerCase() === t.toLowerCase()); if (hit !== undefined) return hit; }
        return value;
      }
      if ((types.includes('integer') || types.includes('number')) && /^-?\d+(?:\.\d+)?$/.test(t)) { const n = Number(t); if (Number.isInteger(n) || types.includes('number')) return n; }
      if (types.includes('boolean') && /^(?:true|false)$/i.test(t)) return t.toLowerCase() === 'true';
      if ((types.includes('object') || types.includes('array')) && /^[\[{]/.test(t)) {
        try { const parsed = JSON.parse(t); if (types.includes(Array.isArray(parsed) ? 'array' : 'object')) return coerce(parsed, schema, depth + 1); } catch {}
      }
      return value;
    }
    if (object(value) && object(schema.properties)) for (const [k, v] of Object.entries(value)) if (schema.properties[k]) value[k] = coerce(v, schema.properties[k], depth + 1);
    if (Array.isArray(value) && object(schema.items)) for (let i = 0; i < Math.min(value.length, 2000); i++) value[i] = coerce(value[i], schema.items, depth + 1);
    return value;
  }
  // Some Studio MCPs expose a generic `skill` tool. Models sometimes pass a
  // elio or MCP tool name to it ({tool:"skill",arguments:{name:"creation_preview",...}}),
  // which fails with "Unknown skill". When the name is an advertised tool (and
  // not skill itself), call that tool directly with the nested arguments.
  function rerouteSkill(call, tools) {
    const bare = String(call.tool || '').split('/').pop();
    if (bare !== 'skill' && !/__skill$/.test(bare)) return;
    const args = call.arguments, key = ['name', 'skill', 'skill_name'].find(k => typeof args[k] === 'string');
    if (!key) return;
    const target = args[key].trim().replace(/^\//, '');
    const list = tools || [];
    if (!target || target === 'skill' || !list.some(t => t && t.name === target)) return;
    let inner = ['arguments', 'args', 'input', 'params', 'parameters'].map(k => args[k]).find(v => v != null);
    if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch { inner = undefined; } }
    if (!object(inner)) { inner = { ...args }; delete inner[key]; for (const k of ['arguments', 'args', 'input', 'params', 'parameters']) delete inner[k]; }
    call.tool = target; call.arguments = inner; call.reroutedFrom = 'skill';
  }
  function repair(call, tools) {
    if (!call || typeof call !== 'object') return call;
    if (typeof call.tool === 'string') call.tool = call.tool.trim();
    if (typeof call.arguments === 'string') {
      const t = call.arguments.trim();
      if (!t) call.arguments = {};
      else { try { const parsed = JSON.parse(t); if (object(parsed)) call.arguments = parsed; } catch {} }
    }
    if (!object(call.arguments)) return call;
    rerouteSkill(call, tools);
    const name = typeof call.tool === 'string' ? call.tool.split('/').pop() : '';
    const tool = (tools || []).find(t => t.name === call.tool || t.name === name);
    coerce(call.arguments, tool?.inputSchema || tool?.input_schema || tool?.parameters);
    const args = call.arguments;
    if (name === 'execute_luau') {
      if (typeof args.datamodel_type === 'string') { const d = args.datamodel_type.trim().toLowerCase(); const hit = ['Edit', 'Client', 'Server'].find(x => x.toLowerCase() === d); if (hit) args.datamodel_type = hit; }
      if (typeof args.code === 'string') { const fenced = /^\s*```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(args.code); if (fenced) args.code = fenced[1]; }
    }
    return call;
  }
  function retries(limit = 3) {
    let failures = 0;
    return { fail: () => ++failures >= limit, reset: () => { failures = 0; }, count: () => failures };
  }
  return { check, validate, retries, incompleteLuau, repair };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = elioToolGuard;
