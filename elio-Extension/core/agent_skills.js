// Extra AgentScript (LOCAL) commands layered on the native workspace tools.
// list_commands advertises them; runTool intercepts and maps onto read/write/run_command.
const AgentScriptSkills = (() => {
  "use strict";

  const SKILL_COMMANDS = [
    { name: "append_file", description: "Append text to a file (creates it if missing).", params: { path: { type: "string", req: true }, content: { type: "string", req: true } } },
    { name: "copy_file", description: "Copy a text file to a new path (parents created).", params: { source: { type: "string", req: true }, destination: { type: "string", req: true } } },
    { name: "replace_in_files", description: "Replace every occurrence of query with replacement across matching files.", params: { query: { type: "string", req: true }, replacement: { type: "string", req: true }, include: { type: "string", req: false, desc: "glob, default **/*" } } },
    { name: "touch_file", description: "Create an empty file if it does not exist; no-op if it does.", params: { path: { type: "string", req: true } } },
    { name: "file_exists", description: "Check whether a path exists (file or folder).", params: { path: { type: "string", req: true } } },
    { name: "count_lines", description: "Count lines in a text file.", params: { path: { type: "string", req: true } } },
    { name: "find_todos", description: "Search the workspace for TODO/FIXME/HACK comments.", params: { include: { type: "string", req: false } } },
    { name: "write_json", description: "Write pretty JSON to a path. Pass data as an object or a JSON string.", params: { path: { type: "string", req: true }, data: { type: "string", req: false }, content: { type: "string", req: false } } },
    { name: "patch_json", description: "Set a dotted key on a JSON file (creates nested objects as needed) and write it back.", params: { path: { type: "string", req: true }, key: { type: "string", req: true, desc: "a.b.c" }, value: { type: "string", req: false } } },
    { name: "run_python", description: "Run a .py file or an inline snippet with python.", params: { file: { type: "string", req: false }, code: { type: "string", req: false }, timeout_seconds: { type: "number", req: false } } },
    { name: "run_node", description: "Run a .js file or an inline snippet with node.", params: { file: { type: "string", req: false }, code: { type: "string", req: false }, timeout_seconds: { type: "number", req: false } } },
    { name: "git_status", description: "git status -sb in the workspace.", params: {} },
    { name: "git_diff", description: "git diff (optional path).", params: { path: { type: "string", req: false } } },
    { name: "git_log", description: "git log --oneline (limit default 20).", params: { limit: { type: "number", req: false } } },
    { name: "npm_install", description: "npm install, optionally a package name.", params: { pkg: { type: "string", req: false }, timeout_seconds: { type: "number", req: false } } },
    { name: "npm_script", description: "npm run <script>.", params: { script: { type: "string", req: true }, timeout_seconds: { type: "number", req: false } } },
    { name: "dir_size", description: "Sum file sizes under a folder (PowerShell).", params: { path: { type: "string", req: false } } },
    { name: "which_cmd", description: "Locate an executable on PATH (where.exe / command -v).", params: { name: { type: "string", req: true } } },
    { name: "concat_files", description: "Concatenate text files into dest.", params: { paths: { type: "array", req: true }, dest: { type: "string", req: true }, sep: { type: "string", req: false } } },
    { name: "list_by_ext", description: "List files by extension (e.g. js, py, lua).", params: { ext: { type: "string", req: true } } },
    { name: "grep_count", description: "Count grep hits for a query.", params: { query: { type: "string", req: true }, include: { type: "string", req: false }, regex: { type: "boolean", req: false } } },
    { name: "scaffold_file", description: "Write a starter file from a tiny template (js/py/html/md/json/lua) if the path does not exist.", params: { path: { type: "string", req: true }, title: { type: "string", req: false } } },
    { name: "read_range", description: "Read a slice of a text file (1-based start line, inclusive end).", params: { path: { type: "string", req: true }, start: { type: "number", req: true }, end: { type: "number", req: false } } },
    { name: "file_stat", description: "File/folder info (size, type) for a path.", params: { path: { type: "string", req: true } } },
    { name: "replace_once", description: "Replace the first occurrence of query in a file (leaves the rest).", params: { path: { type: "string", req: true }, query: { type: "string", req: true }, replacement: { type: "string", req: true } } },
    { name: "list_recent", description: "List files under a folder (native list_dir).", params: { path: { type: "string", req: false } } },
    { name: "env_info", description: "Workspace root + a short environment snapshot (cwd, node/python if present).", params: {} },
  ];

  function describeCommands() {
    const lines = [];
    lines.push("— AgentScript extras: file helpers, JSON patch, git, npm, python/node runners (mapped onto the native workspace tools). —");
    for (const c of SKILL_COMMANDS) {
      const compact = [];
      const detailed = [];
      for (const [k, v] of Object.entries(c.params)) {
        const mark = v.req ? "" : "?";
        if (v.desc && v.desc.length > 45) detailed.push(`    ${k}${mark}: ${v.type} - ${v.desc}`);
        else compact.push(`${k}${mark}:${v.type}${v.desc ? ` "${v.desc}"` : ""}`);
      }
      const paramLines = [compact.length ? `    ${compact.join(", ")}` : "", ...detailed].filter(Boolean).join("\n");
      lines.push(`${c.name}: ${c.description}${paramLines ? "\n" + paramLines : ""}`);
    }
    return lines;
  }

  function stripRead(raw) {
    const text = String(raw || "");
    const lines = [];
    for (const ln of text.split("\n")) {
      const m = ln.match(/^\s*\d+\s+\|\s(.*)$/);
      if (m) lines.push(m[1]);
    }
    return lines.join("\n");
  }
  function isErr(raw) {
    const s = String(raw || "");
    return /^ERROR/i.test(s) || s.includes("ERROR in") || s.includes("ERROR calling") || s.includes("currently OFFLINE");
  }
  function missing(args, key) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return `ERROR: missing required param '${key}'`;
    }
    return null;
  }

  const TEMPLATES = {
    js: (t) => `// ${t}\n\nfunction main() {\n  console.log(${JSON.stringify(t)});\n}\n\nmain();\n`,
    py: (t) => `#!/usr/bin/env python3\n\"\"\"${t}\"\"\"\n\ndef main():\n    print(${JSON.stringify(t)})\n\nif __name__ == \"__main__\":\n    main()\n`,
    html: (t) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>${t}</title>\n</head>\n<body>\n  <h1>${t}</h1>\n</body>\n</html>\n`,
    md: (t) => `# ${t}\n\n`,
    json: () => `{\n}\n`,
    lua: (t) => `-- ${t}\nprint(${JSON.stringify(t)})\n`,
    txt: (t) => `${t}\n`,
  };

  async function run(name, args, runTool) {
    args = args || {};
    const call = (tool, arguments_) => runTool({ tool, arguments: arguments_ });

    if (name === "append_file") {
      const m = missing(args, "path") || missing(args, "content");
      if (m) return m;
      const info = await call("file_info", { path: args.path });
      let cur = "";
      if (!isErr(info) && !/folder/i.test(String(info))) {
        const raw = await call("read_file", { path: args.path, offset: 1, limit: 4000 });
        if (isErr(raw)) return raw;
        cur = stripRead(raw);
      }
      const next = cur ? (cur + (cur.endsWith("\n") ? "" : "\n") + args.content) : String(args.content);
      return await call("write_file", { path: args.path, content: next });
    }
    if (name === "copy_file") {
      const m = missing(args, "source") || missing(args, "destination");
      if (m) return m;
      const raw = await call("read_file", { path: args.source, offset: 1, limit: 4000 });
      if (isErr(raw) || /BINARY file/i.test(String(raw))) {
        return await call("run_command", { command: `copy /Y "${args.source}" "${args.destination}"` });
      }
      return await call("write_file", { path: args.destination, content: stripRead(raw) });
    }
    if (name === "replace_in_files") {
      const m = missing(args, "query") || missing(args, "replacement");
      if (m) return m;
      const grep = await call("grep_files", { query: args.query, include: args.include || "**/*", regex: false });
      if (isErr(grep)) return grep;
      const paths = [];
      const seen = new Set();
      for (const ln of String(grep).split("\n")) {
        const mm = ln.match(/^\s+(.+?):(\d+):/);
        if (!mm) continue;
        const p = mm[1];
        if (seen.has(p)) continue;
        seen.add(p);
        paths.push(p);
      }
      if (!paths.length) return `Output of 'replace_in_files':\nNo files matched ${JSON.stringify(args.query)}.`;
      const results = [];
      for (const p of paths) {
        results.push(await call("edit_file", { path: p, old_string: args.query, new_string: args.replacement, replace_all: true }));
      }
      return `Output of 'replace_in_files':\nUpdated ${paths.length} file(s):\n${paths.map((p) => "- " + p).join("\n")}\n\n${results.join("\n")}`;
    }
    if (name === "touch_file") {
      const m = missing(args, "path");
      if (m) return m;
      const info = await call("file_info", { path: args.path });
      if (!isErr(info)) return `Output of 'touch_file':\n${args.path} already exists.\n${info}`;
      return await call("write_file", { path: args.path, content: "" });
    }
    if (name === "file_exists") {
      const m = missing(args, "path");
      if (m) return m;
      const info = await call("file_info", { path: args.path });
      const exists = !isErr(info);
      return `Output of 'file_exists':\n${JSON.stringify({ path: args.path, exists })}\n${exists ? info : "(missing)"}`;
    }
    if (name === "count_lines") {
      const m = missing(args, "path");
      if (m) return m;
      const raw = await call("read_file", { path: args.path, offset: 1, limit: 4000 });
      if (isErr(raw)) return raw;
      const body = stripRead(raw);
      const n = body ? body.split("\n").length : 0;
      return `Output of 'count_lines':\n${args.path}: ${n} line(s)`;
    }
    if (name === "find_todos") {
      return await call("grep_files", { query: "TODO|FIXME|HACK|XXX", include: args.include || "**/*", regex: true, ignore_case: true });
    }
    if (name === "write_json") {
      const m = missing(args, "path");
      if (m) return m;
      let data = args.data !== undefined ? args.data : args.content;
      if (data === undefined) return "ERROR: missing required param 'data'";
      let text;
      if (typeof data === "string") {
        try { text = JSON.stringify(JSON.parse(data), null, 2); }
        catch (e) { text = data; }
      } else {
        try { text = JSON.stringify(data, null, 2); }
        catch (e) { return `ERROR: data is not JSON-serializable: ${e}`; }
      }
      if (!text.endsWith("\n")) text += "\n";
      return await call("write_file", { path: args.path, content: text });
    }
    if (name === "patch_json") {
      const m = missing(args, "path") || missing(args, "key");
      if (m) return m;
      const raw = await call("read_file", { path: args.path, offset: 1, limit: 4000 });
      if (isErr(raw)) return raw;
      let obj;
      try { obj = JSON.parse(stripRead(raw) || "{}"); }
      catch (e) { return `ERROR: ${args.path} is not valid JSON: ${e}`; }
      const parts = String(args.key).split(".").filter(Boolean);
      if (!parts.length) return "ERROR: key is empty";
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
      }
      let val = args.value;
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch (e) { /* keep string */ }
      }
      cur[parts[parts.length - 1]] = val;
      return await call("write_file", { path: args.path, content: JSON.stringify(obj, null, 2) + "\n" });
    }
    if (name === "run_python") {
      const timeout = Number(args.timeout_seconds) || 60;
      if (args.file) return await call("run_command", { command: `python "${args.file}"`, timeout_seconds: timeout });
      if (args.code) {
        const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(args.code))) : Buffer.from(args.code, "utf8").toString("base64");
        return await call("run_command", { command: `python -c "import base64; exec(base64.b64decode('${b64}').decode())"`, timeout_seconds: timeout });
      }
      return "ERROR: missing required param 'file' or 'code'";
    }
    if (name === "run_node") {
      const timeout = Number(args.timeout_seconds) || 60;
      if (args.file) return await call("run_command", { command: `node "${args.file}"`, timeout_seconds: timeout });
      if (args.code) {
        const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(args.code))) : Buffer.from(args.code, "utf8").toString("base64");
        return await call("run_command", { command: `node -e "eval(Buffer.from('${b64}','base64').toString())"`, timeout_seconds: timeout });
      }
      return "ERROR: missing required param 'file' or 'code'";
    }
    if (name === "git_status") return await call("run_command", { command: "git status -sb" });
    if (name === "git_diff") return await call("run_command", { command: args.path ? `git diff -- "${args.path}"` : "git diff" });
    if (name === "git_log") {
      const n = Math.min(100, Math.max(1, Number(args.limit) || 20));
      return await call("run_command", { command: `git log -${n} --oneline` });
    }
    if (name === "npm_install") {
      const timeout = Number(args.timeout_seconds) || 180;
      const cmd = args.pkg ? `npm install ${args.pkg}` : "npm install";
      return await call("run_command", { command: cmd, timeout_seconds: timeout });
    }
    if (name === "npm_script") {
      const m = missing(args, "script");
      if (m) return m;
      return await call("run_command", { command: `npm run ${args.script}`, timeout_seconds: Number(args.timeout_seconds) || 180 });
    }
    if (name === "dir_size") {
      const p = args.path || ".";
      return await call("run_command", { command: `powershell -NoProfile -Command "(Get-ChildItem -LiteralPath '${String(p).replace(/'/g, "''")}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum"` });
    }
    if (name === "which_cmd") {
      const m = missing(args, "name");
      if (m) return m;
      const n = String(args.name).replace(/["&|<>]/g, "");
      return await call("run_command", { command: `where ${n}` });
    }
    if (name === "concat_files") {
      if (!Array.isArray(args.paths) || !args.paths.length) return "ERROR: missing required param 'paths'";
      const m = missing(args, "dest");
      if (m) return m;
      const chunks = [];
      for (const p of args.paths) {
        const raw = await call("read_file", { path: String(p), offset: 1, limit: 4000 });
        if (isErr(raw)) return raw;
        chunks.push(stripRead(raw));
      }
      const sep = args.sep == null ? "\n" : String(args.sep);
      return await call("write_file", { path: args.dest, content: chunks.join(sep) });
    }
    if (name === "list_by_ext") {
      const m = missing(args, "ext");
      if (m) return m;
      const ext = String(args.ext).replace(/^\./, "");
      return await call("search_files", { pattern: `**/*.${ext}` });
    }
    if (name === "grep_count") {
      const m = missing(args, "query");
      if (m) return m;
      const grep = await call("grep_files", { query: args.query, include: args.include || "**/*", regex: args.regex === true });
      if (isErr(grep)) return grep;
      const hits = String(grep).split("\n").filter((ln) => /^\s+.+:\d+:/.test(ln)).length;
      return `Output of 'grep_count':\n${hits} hit(s) for ${JSON.stringify(args.query)}\n\n${grep}`;
    }
    if (name === "scaffold_file") {
      const m = missing(args, "path");
      if (m) return m;
      const info = await call("file_info", { path: args.path });
      if (!isErr(info)) return `ERROR: ${args.path} already exists — scaffold_file will not overwrite.`;
      const ext = String(args.path).split(".").pop().toLowerCase();
      const title = args.title || args.path;
      const fn = TEMPLATES[ext] || TEMPLATES.txt;
      return await call("write_file", { path: args.path, content: fn(title) });
    }
    if (name === "read_range") {
      const m = missing(args, "path") || missing(args, "start");
      if (m) return m;
      const start = Math.max(1, Number(args.start) || 1);
      const end = Math.max(start, Number(args.end) || (start + 80));
      const limit = Math.min(4000, end - start + 1);
      return await call("read_file", { path: args.path, offset: start, limit });
    }
    if (name === "file_stat") {
      const m = missing(args, "path");
      if (m) return m;
      return await call("file_info", { path: args.path });
    }
    if (name === "replace_once") {
      const m = missing(args, "path") || missing(args, "query") || missing(args, "replacement");
      if (m) return m;
      const raw = await call("read_file", { path: args.path, offset: 1, limit: 4000 });
      if (isErr(raw)) return raw;
      const cur = stripRead(raw);
      const q = String(args.query);
      const i = cur.indexOf(q);
      if (i < 0) return `ERROR: query not found in ${args.path}`;
      const next = cur.slice(0, i) + String(args.replacement) + cur.slice(i + q.length);
      return await call("write_file", { path: args.path, content: next });
    }
    if (name === "list_recent") {
      return await call("list_dir", { path: args.path || "." });
    }
    if (name === "env_info") {
      const info = await call("file_info", { path: args.path || "." });
      const listing = await call("list_dir", { path: args.path || "." });
      return `Output of 'env_info':\n${info}\n\n${listing}`;
    }
    return `ERROR: unknown AgentScript extra '${name}'`;
  }

  return {
    SKILL_COMMANDS,
    SKILL_OPS: SKILL_COMMANDS.map((c) => c.name),
    describeCommands,
    run,
  };
})();
