// Smoke test for execute_luau chunk wrapping (run: node test-luau-wrap.js).
const fs = require("fs");
const ok = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) process.exitCode = 1; };

const src = fs.readFileSync(__dirname + "/core/main.js", "utf8");
const start = src.indexOf("function luauLongStr");
const end = src.indexOf("function pythonAnalyze");
ok("luauLongStr + wrapLuauChunk present", start !== -1 && end > start);
const slice = src.slice(start, end);
ok("wrapper does not call JSONDecode", !slice.includes("JSONDecode"));
ok("wrapper does not pull HttpService", !slice.includes("HttpService"));

const fn = new Function(slice + "; return { luauLongStr, wrapLuauChunk };");
const { luauLongStr, wrapLuauChunk } = fn();

const code = 'print("hi")\nlocal x = ]]\nreturn x';
const lit = luauLongStr(code);
ok("long-string delimiter avoids payload closer", lit.startsWith("[=") && lit.includes(code) && lit.endsWith("=]"));
ok("payload is not JSON-quoted", !lit.includes(JSON.stringify(code)));

const first = wrapLuauChunk(code, 0, 3);
ok("first chunk stores into _synerixcodeLuau Buf", first.includes("_synerixcodeLuau") && first.includes("m.Value=") && first.includes("chunk 1/3"));
ok("first chunk has no JSONDecode", !first.includes("JSONDecode"));

const mid = wrapLuauChunk("more", 1, 3);
ok("middle chunk concatenates", mid.includes("m.Value=m.Value..") && mid.includes("chunk 2/3"));

const last = wrapLuauChunk("end piece", 2, 3);
ok("last chunk loadstrings", last.includes("loadstring(src)") && last.includes("chunked luau parse"));
ok("quotes in lua survive wrapping", wrapLuauChunk('local s = "hello"', 0, 2).includes('local s = "hello"'));
