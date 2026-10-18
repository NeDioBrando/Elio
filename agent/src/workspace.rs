// SPDX-License-Identifier: GPL-3.0-or-later
// workspace.rs - elio LOCAL engine (AgentScript).
//
// Native Rust port of OpenRender's workspace_mcp.py: full control over ONE
// local folder ("the workspace") - list/tree/read/write/edit/move/delete,
// glob + content search, and terminal execution - served to the extension
// over the same legacy WS protocol as the roblox engine (port 17615).
//
// Safety model (mirrors OpenRender, no Python involved):
//   * every path resolves against the workspace root; absolute paths and any
//     ".." climb that escapes the root are refused BEFORE touching the disk;
//   * the deepest EXISTING ancestor is canonicalized so symlink/junction
//     escapes are caught too (not-yet-existing targets resolve via parent);
//   * the root itself can never be deleted or moved;
//   * reads cap at 2 MB, text results clip at 40 K chars, command output at
//     8 K per stream, run_command hard-times-out (60 s default / 600 s max).
//
// All I/O is tokio-async; writes are byte-exact (no newline translation).
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

const MAX_TEXT_CHARS: usize = 40_000;
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RUN_OUTPUT: usize = 8_000;
const DEFAULT_RUN_TIMEOUT: u64 = 60;
const MAX_RUN_TIMEOUT: u64 = 600;
const GREP_MAX_RESULTS: usize = 100;
const TREE_DEFAULT_DEPTH: usize = 3;
const TREE_MAX_DEPTH: usize = 8;
const IGNORED_DIRS: &[&str] = &[
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".idea", ".vscode", "dist", "build", ".next", "coverage",
];

pub struct Workspace {
    /// Canonicalized root - every sandbox check compares against this.
    canon_root: PathBuf,
    /// FULL PC ACCESS mode: when set, absolute paths anywhere on the machine
    /// are allowed (the sandbox only guards the default workspace-relative
    /// behavior). Flipped at runtime via POST /api/local-full. Shared with the
    /// GUI status window so the badge is always live.
    full_access: Arc<AtomicBool>,
}

impl Workspace {
    /// Resolve the workspace root from (in order) an explicit override,
    /// ELIO_WORKSPACE_ROOT / ROBLOXSCRIPT_WORKSPACE_ROOT, or USERPROFILE/elioWorkspace.
    /// The folder is created when missing so a fresh install just works.
    pub fn new(override_dir: Option<&str>) -> anyhow::Result<Self> {
        let chosen = override_dir
            .map(str::to_string)
            .filter(|s| !s.trim().is_empty())
            .or_else(|| std::env::var("ELIO_WORKSPACE_ROOT").ok())
            .or_else(|| std::env::var("ROBLOXSCRIPT_WORKSPACE_ROOT").ok())
            .unwrap_or_else(|| {
                let home = std::env::var("USERPROFILE")
                    .or_else(|_| std::env::var("HOME"))
                    .unwrap_or_else(|_| ".".to_string());
                Path::new(&home).join("elioWorkspace").to_string_lossy().to_string()
            });
        let root = PathBuf::from(chosen);
        std::fs::create_dir_all(&root)
            .map_err(|e| anyhow::anyhow!("workspace root {} unavailable: {e}", root.display()))?;
        let canon_root = std::fs::canonicalize(&root)
            .map_err(|e| anyhow::anyhow!("cannot canonicalize {}: {e}", root.display()))?;
        tracing::info!("workspace root: {}", canon_root.display());
        Ok(Self { canon_root, full_access: Arc::new(AtomicBool::new(false)) })
    }

    pub fn root_display(&self) -> String { deverbatim_string(&self.canon_root) }

    pub fn ready(&self) -> bool { self.canon_root.is_dir() }

    pub fn full_access(&self) -> bool { self.full_access.load(Ordering::Relaxed) }

    /// Handle to share with the GUI so its FULL badge mirrors live state.
    pub fn full_flag(&self) -> Arc<AtomicBool> { Arc::clone(&self.full_access) }

    pub fn set_full_access(&self, on: bool) {
        self.full_access.store(on, Ordering::Relaxed);
        tracing::info!("FULL PC ACCESS {}", if on { "ENABLED" } else { "disabled" });
    }

    /// Sandbox core. `rel` must be relative; ".." may not climb above the
    /// root; the deepest existing ancestor is canonicalized against the
    /// canonical root to defeat symlink/junction escapes.
    /// In FULL PC ACCESS mode absolute paths anywhere are allowed.
    pub(crate) fn resolve_path(&self, rel: &str, must_exist: bool) -> Result<PathBuf, String> {
        let raw = rel.trim();
        if raw.is_empty() || raw == "." || raw == "/" || raw == "\\" {
            return Ok(self.canon_root.clone());
        }
        // FULL ACCESS: absolute paths bypass the sandbox entirely. Relative
        // paths still anchor at the workspace root (a sane default cwd).
        if self.full_access.load(Ordering::Relaxed)
            && (Path::new(raw).is_absolute() || is_windows_absolute(raw) || raw.starts_with('/'))
        {
            let p = PathBuf::from(raw);
            if must_exist && !p.exists() {
                return Err(format!("'{raw}' does not exist"));
            }
            return Ok(p);
        }
        let raw = raw.replace('\\', "/");
        if raw.is_empty() { return Ok(self.canon_root.clone()); }
        if raw.starts_with('/') || Path::new(&raw).is_absolute() || is_windows_absolute(&raw) {
            return Err(format!("paths must be relative to the workspace root, got '{raw}'"));
        }
        // Lexical walk: reject escapes without touching the filesystem.
        let mut depth: i64 = 0;
        for comp in Path::new(&raw).components() {
            match comp {
                Component::Normal(_) => depth += 1,
                Component::CurDir => {}
                Component::ParentDir => {
                    depth -= 1;
                    if depth < 0 {
                        return Err(format!("path '{raw}' is outside the workspace"));
                    }
                }
                _ => return Err(format!("path '{raw}' is outside the workspace")),
            }
        }
        let joined = self.canon_root.join(&raw);
        // Symlink/junction defense on the existing part of the path.
        let mut probe = joined.clone();
        let mut tail: Vec<PathBuf> = Vec::new();
        while !probe.exists() && probe != self.canon_root {
            match (probe.file_name().map(|n| n.to_os_string()), probe.parent().map(Path::to_path_buf)) {
                (Some(name), Some(parent)) => {
                    tail.push(PathBuf::from(name));
                    probe = parent;
                }
                _ => break,
            }
        }
        if probe.exists() {
            let canon = std::fs::canonicalize(&probe)
                .map_err(|e| format!("cannot resolve '{}': {e}", rel.trim()))?;
            if !canon.starts_with(&self.canon_root) {
                return Err(format!("path '{}' is outside the workspace", rel.trim()));
            }
        }
        let mut final_path = probe;
        for seg in tail.iter().rev() { final_path.push(seg); }
        if must_exist && !final_path.exists() {
            return Err(format!("'{}' does not exist in the workspace", rel.trim()));
        }
        Ok(final_path)
    }

    pub(crate) fn display(&self, p: &Path) -> String {
        // Compare with the verbatim (\\?\) prefix stripped on BOTH sides:
        // fs::canonicalize yields verbatim paths but glob/readdir do not.
        let base = deverbatim_string(&self.canon_root).replace('\\', "/");
        let ps = deverbatim_string(p).replace('\\', "/");
        if ps == base { return ".".to_string(); }
        ps.strip_prefix(&format!("{base}/")).unwrap_or(&ps).to_string()
    }
}

/// Strip Windows verbatim prefixes so users never see "\\?\C:\...".
fn deverbatim_string(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") { return format!(r"\\{rest}"); }
    if let Some(rest) = s.strip_prefix(r"\\?\") { return rest.to_string(); }
    s
}

/// Windows drive-letter check ("C:/...") that Path::is_absolute misses when
/// the input arrived with forward slashes.
fn is_windows_absolute(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn clip(text: &str, limit: usize) -> String {
    if text.len() <= limit { return text.to_string(); }
    let mut cut = limit;
    while cut > 0 && !text.is_char_boundary(cut) { cut -= 1; }
    format!("{}\n... [output truncated at {limit} characters]", &text[..cut])
}

fn human_size(n: f64) -> String {
    for unit in ["B", "KB", "MB", "GB", "TB"] {
        if n < 1024.0 || unit == "TB" {
            return if unit == "B" { format!("{n} B") } else { format!("{n:.1} {unit}") };
        }
    }
    format!("{n} B")
}

async fn read_text(path: &Path) -> Result<(String, bool), String> {
    let data = tokio::fs::read(path).await.map_err(|e| e.to_string())?;
    match String::from_utf8(data) {
        Ok(text) => Ok((text, false)),
        Err(_) => Ok((String::new(), true)), // non-UTF-8 -> treat as binary
    }
}

fn require_file(ws: &Workspace, p: &Path) -> Result<(), String> {
    if !p.exists() { return Err(format!("'{}' does not exist", ws.display(p))); }
    if p.is_dir() { return Err(format!("'{}' is a folder, not a file", ws.display(p))); }
    Ok(())
}

fn detect_eol(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

fn normalize_lf(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

fn count_lines(text: &str) -> usize {
    text.chars().filter(|c| *c == '\n').count()
    + usize::from(!text.is_empty() && !text.ends_with('\n'))
}

// ── lenient argument coercion ────────────────────────────────────────────
// Models frequently send numbers as strings ("offset": "5") or booleans as
// strings ("replace_all": "true"). Coerce instead of erroring so a whole
// round-trip isn't wasted on a type mismatch.

fn j_bool(args: &serde_json::Value, key: &str, default: bool) -> bool {
    match args.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => matches!(s.trim().to_lowercase().as_str(), "true" | "1" | "yes" | "on"),
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => default,
    }
}

fn j_u64(args: &serde_json::Value, key: &str, default: u64) -> u64 {
    match args.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(default),
        Some(serde_json::Value::String(s)) => s.trim().parse::<u64>().unwrap_or(default),
        _ => default,
    }
}

/// Required integer parameter (accepts number or numeric string).
fn j_i32(args: &serde_json::Value, key: &str) -> Result<i32, String> {
    let v = args.get(key).ok_or_else(|| format!("'{key}' is required"))?;
    match v {
        serde_json::Value::Number(n) => n.as_i64().map(|x| x as i32).ok_or_else(|| format!("'{key}' must be an integer")),
        serde_json::Value::String(s) => s.trim().parse::<i32>().map_err(|_| format!("'{key}' must be an integer")),
        _ => Err(format!("'{key}' must be an integer")),
    }
}

async fn dir_size_tree(dir: &Path, skip_ignored: bool) -> (usize, usize, u64) {
    let mut files = 0usize; let mut dirs = 0usize; let mut size = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&d).await { Ok(e) => e, Err(_) => continue };
        while let Ok(Some(e)) = entries.next_entry().await {
            let ft = match e.file_type().await { Ok(t) => t, Err(_) => continue };
            let name = e.file_name().to_string_lossy().to_string();
            if ft.is_dir() {
                if skip_ignored && IGNORED_DIRS.contains(&name.as_str()) { continue; }
                dirs += 1;
                stack.push(e.path());
            } else {
                files += 1;
                size += e.metadata().await.map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    (files, dirs, size)
}

fn arg_str(args: &serde_json::Value, key: &str) -> Result<String, String> {
    let v = args.get(key).ok_or_else(|| format!("'{key}' is required"))?;
    let s = v.as_str().ok_or_else(|| format!("'{key}' must be a string"))?;
    if s.trim().is_empty() { return Err(format!("'{key}' is required")); }
    Ok(s.to_string())
}

/// Optional path parameter - empty/missing means the workspace root.
fn opt_path(args: &serde_json::Value) -> String {
    args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string()
}

// -- tools ---------------------------------------------------------------

pub async fn tool_workspace_info(ws: &Workspace, _args: &serde_json::Value) -> Result<String, String> {
    let (file_count, dir_count, total) = dir_size_tree(&ws.canon_root, true).await;
    let mut top: Vec<String> = Vec::new();
    let mut entries = tokio::fs::read_dir(&ws.canon_root).await.map_err(|e| e.to_string())?;
    while let Ok(Some(e)) = entries.next_entry().await {
        let name = e.file_name().to_string_lossy().to_string();
        let slash = if e.file_type().await.map(|t| t.is_dir()).unwrap_or(false) { "/" } else { "" };
        top.push(format!("{name}{slash}"));
    }
    top.sort_by_key(|a| a.to_lowercase());
    let mut out = format!(
        "Workspace root: {}\nContents: {file_count} files, {dir_count} folders ({})\n(common generated folders like node_modules/.git are excluded from counts)\n\nTop-level entries:\n",
        ws.root_display(), human_size(total as f64)
    );
    if top.is_empty() { out.push_str("  (empty folder)"); }
    else {
        for name in top.iter().take(100) { out.push_str(&format!("  {name}\n")); }
        let extra = top.len().saturating_sub(100);
        if extra > 0 { out.push_str(&format!("  ... and {extra} more (use list_directory)")); }
        else { out.pop(); } // drop trailing newline
    }
    Ok(out)
}

pub async fn tool_list_directory(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let p = ws.resolve_path(opt_path(args).as_str(), true)?;
    if !p.is_dir() { return Err(format!("'{}' is a file, not a folder", ws.display(&p))); }
    let mut entries: Vec<(String, bool)> = Vec::new();
    let mut rd = tokio::fs::read_dir(&p).await.map_err(|e| e.to_string())?;
    while let Ok(Some(e)) = rd.next_entry().await {
        let is_dir = e.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        entries.push((e.file_name().to_string_lossy().to_string(), is_dir));
    }
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    if entries.is_empty() { return Ok(format!("{}/ is empty.", ws.display(&p))); }
    let mut lines = Vec::new();
    for (name, is_dir) in entries.iter().take(500) {
        if *is_dir {
            let n = count_dir_items(&p.join(name)).await;
            lines.push(format!("  [dir ] {name}/ ({n} items)"));
        } else {
            let size = tokio::fs::metadata(p.join(name)).await.map(|m| m.len()).unwrap_or(0);
            lines.push(format!("  [file] {name} ({})", human_size(size as f64)));
        }
    }
    if entries.len() > 500 { lines.push(format!("  ... and {} more", entries.len() - 500)); }
    Ok(format!("{}/:\n{}", ws.display(&p), lines.join("\n")))
}

async fn count_dir_items(d: &Path) -> usize {
    let Ok(mut rd) = tokio::fs::read_dir(d).await else { return 0 };
    let mut c = 0usize;
    while let Ok(Some(_)) = rd.next_entry().await { c += 1; }
    c
}

pub async fn tool_tree(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let p = ws.resolve_path(opt_path(args).as_str(), true)?;
    let depth = j_u64(args, "depth", TREE_DEFAULT_DEPTH as u64).clamp(1, TREE_MAX_DEPTH as u64) as usize;
    let mut out_lines = vec![format!("{}/", ws.display(&p))];
    tree_walk(&p, "", 1, depth, &mut out_lines).await;
    if out_lines.len() > 1500 {
        return Ok(clip(&out_lines.join("\n"), 30_000)
            + "\n... [tree truncated - use list_directory or a deeper/narrower path]");
    }
    Ok(out_lines.join("\n"))
}

async fn tree_walk(d: &Path, prefix: &str, level: usize, max_depth: usize, out: &mut Vec<String>) {
    if level > max_depth { return; }
    let mut entries: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(d).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            let is_file = e.file_type().await.map(|t| t.is_file()).unwrap_or(false);
            if is_file || !IGNORED_DIRS.contains(&name.as_str()) {
                entries.push((e.path(), name));
            }
        }
    }
    // Directories first, then files; case-insensitive names (matches Python).
    let mut metas: Vec<((bool, String), PathBuf, String)> = Vec::new(); // sort key, path, name
    for (path, name) in entries {
        let is_dir = tokio::fs::metadata(&path).await.map(|m| m.is_dir()).unwrap_or(false);
        metas.push(((is_dir, name.to_lowercase()), path, name));
    }
    metas.sort_by(|a, b| b.0.cmp(&a.0));
    let n = metas.len();
    for (i, (_, path, name)) in metas.iter().enumerate() {
        let last = i + 1 == n;
        let branch = if last { "`-- " } else { "|-- " };
        let ext = if last { "    " } else { "|   " };
        // Directories recurse via an explicit boxed future (bounded by max_depth).
        let is_dir = tokio::fs::metadata(path).await.map(|m| m.is_dir()).unwrap_or(false);
        if is_dir {
            out.push(format!("{prefix}{branch}{name}/"));
            Box::pin(tree_walk(path, &format!("{prefix}{ext}"), level + 1, max_depth, out)).await;
        } else {
            out.push(format!("{prefix}{branch}{name}"));
        }
    }
}

pub async fn tool_read_file(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let p = ws.resolve_path(arg_str(args, "path")?.as_str(), true)?;
    require_file(ws, &p)?;
    let size = tokio::fs::metadata(&p).await.map_err(|e| e.to_string())?.len();
    if size > MAX_READ_BYTES {
        return Err(format!(
            "'{}' is {} - too large to read whole (limit {}). Read it in parts with offset/limit if you really need to, or grep_files to find the relevant section.",
            ws.display(&p), human_size(size as f64), human_size(MAX_READ_BYTES as f64)
        ));
    }
    let (text, binary) = read_text(&p).await?;
    if binary {
        return Ok(format!("{} looks like a BINARY file ({}); its content is not shown as text.", ws.display(&p), human_size(size as f64)));
    }
    // Mirror Python splitlines(): no phantom empty line for a trailing newline.
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.len() > 1 && lines.last() == Some(&"") { lines.pop(); }
    let total = lines.len();
    let start = j_u64(args, "offset", 1).max(1) as usize;
    let limit = j_u64(args, "limit", 2000).clamp(1, 4000) as usize;
    let chunk: Vec<String> = lines.iter()
        .skip(start - 1).take(limit)
        .enumerate()
        .map(|(i, ln)| format!("{:>5} | {}", start + i, ln))
        .collect();
    let header = format!("{}  ({total} line{}, {})", ws.display(&p), if total != 1 { "s" } else { "" }, human_size(size as f64));
    if chunk.is_empty() {
        return Ok(format!("{header}\n(no lines in range {start}-{})", start + limit - 1));
    }
    let end = start - 1 + chunk.len();
    let footer = if end < total { format!("\n... lines {}-{total} continue (use offset={})", end + 1, end + 1) } else { String::new() };
    Ok(clip(&format!("{header}\n{}{footer}", chunk.join("\n")), MAX_TEXT_CHARS))
}

// ── binary → base64 (for images that must reach the browser) ───────────────
// The Roblox/Blender MCP servers write their captures to DISK (a PNG path),
// and a Chrome extension cannot read a local path - the only channel is the
// bridge. So this returns the bytes as base64 (hand-rolled: the crate has no
// base64 dependency, and adding one would churn Cargo.lock for 25 lines).
// SECURITY NOTE: 4/3 expansion - the cap is deliberately much tighter than
// MAX_READ_BYTES so a big file cannot wedge the websocket.
pub const MAX_B64_BYTES: u64 = 12 * 1024 * 1024;

const B64_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_ALPHABET[((n >> 18) & 0x3f) as usize] as char);
        out.push(B64_ALPHABET[((n >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 { B64_ALPHABET[((n >> 6) & 0x3f) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64_ALPHABET[(n & 0x3f) as usize] as char } else { '=' });
    }
    out
}

/// Content type for the image/asset extensions the bridge can hand back.
fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" | "md" | "log" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Read ANY file (text or binary) as base64 + mime. Used by the extension to
/// turn a screenshot written by Studio/Blender into an attachment it can put
/// in the chat composer, and to push a workspace file into the AI as an
/// attachment (elio's attach_feedback / elio_attach).
pub async fn tool_read_file_base64(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let p = ws.resolve_path(arg_str(args, "path")?.as_str(), true)?;
    require_file(ws, &p)?;
    let size = tokio::fs::metadata(&p).await.map_err(|e| e.to_string())?.len();
    if size > MAX_B64_BYTES {
        return Err(format!(
            "'{}' is {} - too large to attach (base64 limit {}, the wire format inflates it by ~33%).",
            ws.display(&p), human_size(size as f64), human_size(MAX_B64_BYTES as f64)
        ));
    }
    let data = tokio::fs::read(&p).await.map_err(|e| e.to_string())?;
    let mime = mime_for(&p);
    let payload = serde_json::json!({
        "path": ws.display(&p),
        "mimeType": mime,
        "bytes": data.len(),
        "data": base64_encode(&data),
    });
    Ok(payload.to_string())
}

pub async fn tool_write_file(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let rel = arg_str(args, "path")?;
    let content = args.get("content").ok_or("'content' is required (use \"\" for an empty file)")?
        .as_str().ok_or("'content' must be a string")?;
    let p = ws.resolve_path(rel.as_str(), false)?;
    if p.exists() && p.is_dir() {
        return Err(format!("'{}' is a folder - cannot overwrite it with a file", ws.display(&p)));
    }
    if let Some(parent) = p.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("cannot create parents: {e}"))?;
        // In FULL PC ACCESS mode the parent may legitimately live anywhere.
        if !ws.full_access() {
            let canon_parent = std::fs::canonicalize(parent)
                .map_err(|e| format!("cannot resolve parent: {e}"))?;
            if !canon_parent.starts_with(&ws.canon_root) {
                return Err("cannot create entries outside the workspace".into());
            }
        }
    }
    let existed = p.exists();
    tokio::fs::write(&p, content.as_bytes()).await.map_err(|e| format!("write failed: {e}"))?;
    let action = if existed { "Overwrote" } else { "Created" };
    Ok(format!("{action} {} ({} chars, ~{} lines).", ws.display(&p), content.chars().count(), count_lines(content)))
}

pub async fn tool_edit_file(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let rel = arg_str(args, "path")?;
    let old = args.get("old_string").and_then(|v| v.as_str()).ok_or("'old_string' and 'new_string' are required")?;
    let new = args.get("new_string").and_then(|v| v.as_str()).ok_or("'old_string' and 'new_string' are required")?;
    if old == new { return Err("old_string and new_string are identical - nothing to change".into()); }
    let replace_all = j_bool(args, "replace_all", false);
    let p = ws.resolve_path(rel.as_str(), true)?;
    require_file(ws, &p)?;
    let size = tokio::fs::metadata(&p).await.map_err(|e| e.to_string())?.len();
    if size > MAX_READ_BYTES { return Err(format!("'{}' is too large to edit ({})", ws.display(&p), human_size(size as f64))); }
    let (text, _bin) = read_text(&p).await?;
    // Match in LF-normalized space but preserve the file's own EOL on write.
    let eol = detect_eol(&text);
    let normalized = normalize_lf(&text);
    let old_norm = normalize_lf(old);
    let new_norm = normalize_lf(new);
    let count = normalized.matches(&old_norm).count();
    if count == 0 {
        let probe: String = old_norm.chars().take(60).collect();
        let near = normalized.find(&probe);
        let hint = if let Some(near) = near {
            let window = &normalized[near..];
            let diff_at = window.chars().zip(old_norm.chars())
                .position(|(a, b)| a != b)
                .unwrap_or(window.chars().count().min(old_norm.chars().count()));
            format!(" A similar passage exists around character {near}: your old_string first differs at position {diff_at}. Re-read the file with read_file and copy the EXACT text.")
        } else { String::new() };
        return Err(format!("old_string not found in {} (searched verbatim).{hint}", ws.display(&p)));
    }
    if count > 1 && !replace_all {
        let snippet = normalized.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
        let snippet: String = snippet.trim().chars().take(60).collect();
        return Err(format!(
            "old_string matches {count} places in {}. Add surrounding context so it is UNIQUE, or pass replace_all:true to change every occurrence.{}",
            ws.display(&p),
            if snippet.is_empty() { String::new() } else { format!(" First line: {snippet}") }
        ));
    }
    let occurrences = if replace_all { count } else { 1 };
    let replaced = if replace_all { normalized.replace(&old_norm, &new_norm) }
        else { normalized.replacen(&old_norm, &new_norm, 1) };
    let new_text = if eol != "\n" { replaced.replace('\n', eol) } else { replaced };
    tokio::fs::write(&p, new_text.as_bytes()).await.map_err(|e| format!("write failed: {e}"))?;
    let where_ = if replace_all { format!("{occurrences} occurrences") } else { "first occurrence".to_string() };
    Ok(format!("Edited {}: replaced {where_} of old_string ({} chars -> {} chars).", ws.display(&p), old.chars().count(), new.chars().count()))
}

pub async fn tool_create_folder(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let rel = arg_str(args, "path")?;
    let p = ws.resolve_path(rel.as_str(), false)?;
    if p.exists() && p.is_file() {
        return Err(format!("'{}' exists as a FILE - cannot create a folder with that name", ws.display(&p)));
    }
    tokio::fs::create_dir_all(&p).await.map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(format!("Folder ready: {}/", ws.display(&p)))
}

pub async fn tool_delete_path(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let rel = arg_str(args, "path")?;
    let p = ws.resolve_path(rel.as_str(), true)?;
    if p == ws.canon_root { return Err("refusing to delete the workspace root itself".into()); }
    let display = ws.display(&p);
    if p.is_dir() {
        let (files, _, _) = dir_size_tree(&p, false).await;
        tokio::fs::remove_dir_all(&p).await.map_err(|e| format!("delete failed: {e}"))?;
        Ok(format!("Deleted folder {display}/ ({files} files removed)."))
    } else {
        tokio::fs::remove_file(&p).await.map_err(|e| format!("delete failed: {e}"))?;
        Ok(format!("Deleted file {display}."))
    }
}

pub async fn tool_move_path(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let src_rel = arg_str(args, "source")?;
    let dst_rel = arg_str(args, "destination")?;
    let src = ws.resolve_path(src_rel.as_str(), true)?;
    if src == ws.canon_root { return Err("refusing to move the workspace root itself".into()); }
    let mut dst = ws.resolve_path(dst_rel.as_str(), false)?;
    if dst.exists() && dst.is_dir() {
        dst = dst.join(src.file_name().ok_or("bad source name")?);
    }
    if dst.exists() { return Err(format!("destination '{}' already exists", ws.display(&dst))); }
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("mkdir failed: {e}"))?;
    }
    move_any(&src, &dst).await?;
    Ok(format!("Moved {} -> {}.", ws.display(&src), ws.display(&dst)))
}

async fn move_any(src: &Path, dst: &Path) -> Result<(), String> {
    // Same-volume rename first (instant); fall back to copy+delete for
    // cross-drive moves (what Python's shutil.move does implicitly).
    if tokio::fs::rename(src, dst).await.is_ok() { return Ok(()); }
    if src.is_dir() {
        tokio::fs::create_dir_all(dst).await.map_err(|e| e.to_string())?;
        let mut rd = tokio::fs::read_dir(src).await.map_err(|e| e.to_string())?;
        while let Ok(Some(e)) = rd.next_entry().await {
            Box::pin(move_any(&e.path(), &dst.join(e.file_name()))).await?;
        }
        tokio::fs::remove_dir_all(src).await.map_err(|e| e.to_string())?;
    } else {
        tokio::fs::copy(src, dst).await.map_err(|e| e.to_string())?;
        tokio::fs::remove_file(src).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn tool_search_files(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let pattern = arg_str(args, "pattern")?.trim().to_string();
    if pattern.is_empty() { return Err("'pattern' is required, e.g. \"**/*.py\"".into()); }
    let globbed = format!("{}/{}", ws.canon_root.to_string_lossy().replace('\\', "/"), pattern);
    let paths = glob::glob(&globbed).map_err(|e| format!("invalid pattern '{pattern}': {e}"))?;
    let mut matches: Vec<String> = Vec::new();
    for m in paths.flatten() {
        let tag = if m.is_dir() { "dir/" } else { "" };
        matches.push(format!("  {}{tag}", ws.display(&m)));
        if matches.len() >= GREP_MAX_RESULTS { break; }
    }
    if matches.is_empty() { return Ok(format!("No paths match \"{pattern}\".")); }
    let tail = if matches.len() < GREP_MAX_RESULTS { String::new() } else { format!("\n  ... stopped at {GREP_MAX_RESULTS} results") };
    Ok(format!("Paths matching \"{pattern}\" ({}):\n{}{tail}", matches.len(), matches.join("\n")))
}

pub async fn tool_grep_files(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let query = args.get("query").and_then(|q| q.as_str()).filter(|q| !q.is_empty())
        .ok_or("'query' is required")?;
    let include = args.get("include").and_then(|i| i.as_str()).filter(|i| !i.is_empty()).unwrap_or("**/*");
    let is_regex = args.get("regex").and_then(|v| v.as_bool()).unwrap_or(false);
    let ignore_case = args.get("ignore_case").and_then(|v| v.as_bool()).unwrap_or(true);
    let rx = if is_regex {
        Some(regex::RegexBuilder::new(query)
            .case_insensitive(ignore_case)
            .build()
            .map_err(|e| format!("invalid regex '{query}': {e}"))?)
    } else { None };
    let needle = query.to_lowercase();

    // Candidate files: honor include-glob, skip ignored dirs + oversized files.
    let mut candidates: Vec<PathBuf> = Vec::new();
    collect_files(&ws.canon_root, include, &mut candidates).await;

    let mut hits: Vec<String> = Vec::new();
    let mut scanned = 0usize;
    'outer: for path in candidates {
        if hits.len() >= GREP_MAX_RESULTS { break; }
        if tokio::fs::metadata(&path).await.map(|m| m.len()).unwrap_or(u64::MAX) > MAX_READ_BYTES { continue; }
        let (text, binary) = match read_text(&path).await { Ok(t) => t, Err(_) => continue };
        if binary { continue; }
        scanned += 1;
        for (lineno, line) in text.split('\n').enumerate() {
            let ok = match &rx {
                Some(rx) => rx.is_match(line),
                None => line.to_lowercase().contains(&needle),
            };
            if ok {
                let trimmed = line.trim().chars().take(160).collect::<String>();
                hits.push(format!("  {}:{}: {}", ws.display(&path), lineno + 1, trimmed));
                if hits.len() >= GREP_MAX_RESULTS { break 'outer; }
            }
        }
    }
    if hits.is_empty() {
        let kind = if is_regex { "regex" } else { "text" };
        return Ok(format!("No matches for {kind} \"{query}\" (scanned {scanned} files matching \"{include}\")."));
    }
    let tail = if hits.len() < GREP_MAX_RESULTS { String::new() } else { format!("\n  ... stopped at {GREP_MAX_RESULTS} matches") };
    Ok(format!("Matches for \"{query}\" ({}, scanned {scanned} files):\n{}{tail}", hits.len(), hits.join("\n")))
}

async fn collect_files(dir: &Path, include: &str, out: &mut Vec<PathBuf>) {
    let matcher = glob::Pattern::new(include).ok();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(mut rd) = tokio::fs::read_dir(&d).await else { continue };
        while let Ok(Some(e)) = rd.next_entry().await {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = e.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if !IGNORED_DIRS.contains(&name.as_str()) { stack.push(path); }
                continue;
            }
            if let Some(m) = &matcher {
                // Default glob semantics: '*' crosses separators, like OpenRender's.
                let rel = path.strip_prefix(dir).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                if !m.matches(&rel) && !m.matches(&name) { continue; }
            }
            out.push(path);
            if out.len() >= 20_000 { return; }
        }
    }
}

pub async fn tool_run_command(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    tool_run_command_observed(ws,args).await.map(|(text,_)|text)
}
pub async fn tool_run_command_observed(ws: &Workspace, args: &serde_json::Value) -> Result<(String,bool), String> {
    let command = arg_str(args, "command")?.trim().to_string();
    if command.is_empty() {
        return Err("'command' is required, e.g. \"python main.py\" or \"npm install\"".into());
    }
    let timeout_secs = j_u64(args, "timeout_seconds", DEFAULT_RUN_TIMEOUT).clamp(1, MAX_RUN_TIMEOUT);

    let t0 = Instant::now();
    let output = run_shell(&command, &ws.canon_root, timeout_secs).await;
    let elapsed = t0.elapsed().as_secs_f64();
    let proc_out = match output {
        Ok(o) => o,
        Err(RunErr::Spawn(e)) => return Err(format!("could not run command: {e}")),
        Err(RunErr::Timeout) => return Ok((format!(
            "Command TIMED OUT after {timeout_secs}s: {command}\nIt may still have had partial effects. For long-running servers/tests, run them differently (background job, shorter test subset) instead of blocking."
        ),false)),
    };
    let mut stdout = String::from_utf8_lossy(&proc_out.stdout).trim().to_string();
    let mut stderr = String::from_utf8_lossy(&proc_out.stderr).trim().to_string();
    if stdout.chars().count() > MAX_RUN_OUTPUT {
        stdout = stdout.chars().take(MAX_RUN_OUTPUT).collect::<String>()
            + &format!("\n... [stdout truncated at {MAX_RUN_OUTPUT} chars]");
    }
    if stderr.chars().count() > MAX_RUN_OUTPUT {
        stderr = stderr.chars().take(MAX_RUN_OUTPUT).collect::<String>()
            + &format!("\n... [stderr truncated at {MAX_RUN_OUTPUT} chars]");
    }
    let code = proc_out.status.code().unwrap_or(-1);
    let mut parts = vec![
        format!("$ {command}"),
        format!("(ran in the workspace root, exit code {code}, {elapsed:.1}s)"),
    ];
    if !stdout.is_empty() { parts.push("--- stdout ---".to_string()); parts.push(stdout); }
    if !stderr.is_empty() { parts.push("--- stderr ---".to_string()); parts.push(stderr); }
    if code != 0 && proc_out.stderr.is_empty() {
        parts.push("(non-zero exit code with empty stderr - check stdout above)".to_string());
    }
    Ok((clip(&parts.join("\n"), MAX_TEXT_CHARS),proc_out.status.success()))
}

enum RunErr { Spawn(std::io::Error), Timeout }

#[cfg(windows)]
async fn run_shell(command: &str, cwd: &Path, timeout_secs: u64) -> Result<std::process::Output, RunErr> {
    use std::process::Stdio;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = tokio::process::Command::new("cmd");
    cmd.args(["/D", "/C", command])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false)
        .creation_flags(CREATE_NO_WINDOW);
    finish(cmd, timeout_secs).await
}

#[cfg(not(windows))]
async fn run_shell(command: &str, cwd: &Path, timeout_secs: u64) -> Result<std::process::Output, RunErr> {
    use std::process::Stdio;
    let mut cmd = tokio::process::Command::new("sh");
    cmd.arg("-c").arg(command)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    cmd.process_group(0);
    finish(cmd, timeout_secs).await
}

struct OwnedCommandTree { pid: u32, finished: bool }
impl Drop for OwnedCommandTree {
    fn drop(&mut self) {
        if self.finished || self.pid == 0 { return; }
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            let _=std::process::Command::new("taskkill").args(["/F","/T","/PID",&self.pid.to_string()]).creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        }
        #[cfg(not(windows))] {
            let _=std::process::Command::new("kill").args(["-KILL","--",&format!("-{}",self.pid)]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        }
    }
}
async fn finish(mut cmd: tokio::process::Command, timeout_secs: u64) -> Result<std::process::Output, RunErr> {
    let child=cmd.spawn().map_err(RunErr::Spawn)?;
    let mut owned=OwnedCommandTree {pid:child.id().unwrap_or(0),finished:false};
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), child.wait_with_output()).await {
        Ok(Ok(o)) => {owned.finished=true;Ok(o)},
        Ok(Err(e)) => Err(RunErr::Spawn(e)),
        Err(_) => Err(RunErr::Timeout),
    }
}

// ── extended system tools (AgentScript+) ─────────────────────────────────

pub async fn tool_file_info(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let rel = arg_str(args, "path")?;
    let p = ws.resolve_path(rel.as_str(), true)?;
    let md = tokio::fs::metadata(&p).await.map_err(|e| format!("stat failed: {e}"))?;
    let kind = if md.is_dir() { "folder" } else { "file" };
    Ok(format!(
        "{} ({})\nsize: {}\nmodified: {:?}\ncreated: {:?}\nreadonly: {}",
        ws.display(&p),
        kind,
        human_size(md.len() as f64),
        md.modified().ok(),
        md.created().ok(),
        md.permissions().readonly(),
    ))
}

pub async fn tool_env_info(ws: &Workspace, _args: &serde_json::Value) -> Result<String, String> {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_memory();
    let host = sysinfo::System::host_name().unwrap_or_else(|| "unknown".to_string());
    let os = sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string());
    let mem_total = sys.total_memory();
    let mem_free = sys.available_memory();
    Ok(format!(
        "Host: {host}\nOS: {os}\nArch: {}\nCPUs: {}\nMemory: {} total, {} available\nUser: {}\nWorkspace root: {}\nFULL PC ACCESS: {}",
        std::env::consts::ARCH,
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        human_size(mem_total as f64),
        human_size(mem_free as f64),
        whoami_fallback(),
        ws.root_display(),
        if ws.full_access() { "ON" } else { "off (workspace sandbox)" },
    ))
}

fn whoami_fallback() -> String {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "unknown".into())
}

pub async fn tool_process_list(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let limit = j_u64(args, "limit", 40).clamp(1, 300) as usize;
    let mut sys = sysinfo::System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let mut procs: Vec<(u32, String, u64)> = sys.processes().iter()
        .map(|(pid, p)| (pid.as_u32(), p.name().to_string_lossy().to_string(), p.memory()))
        .collect();
    procs.sort_by(|a, b| b.2.cmp(&a.2));
    let shown = procs.len().min(limit);
    let mut out = format!("{} running processes (top {shown} by memory):\n\n  PID     MEM       NAME", procs.len());
    for (pid, name, mem) in procs.iter().take(limit) {
        out.push_str(&format!("\n  {pid:<7} {:<9} {}", human_size(*mem as f64), name));
    }
    if ws.full_access() {
        out.push_str("\n\nKill one with process_kill {pid}.");
    } else {
        out.push_str("\n\n(FULL PC ACCESS is off - process_kill is unavailable.)");
    }
    Ok(out)
}

pub async fn tool_process_kill(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() {
        return Err("process_kill requires FULL PC ACCESS mode (the user must enable it from the elio bar toggle). This is intentional: killing processes affects the whole machine.".into());
    }
    let pid = args.get("pid").and_then(|p| p.as_u64()).filter(|p| *p > 0)
        .or_else(|| args.get("pid").and_then(|p| p.as_str()).and_then(|s| s.trim().parse::<u64>().ok()))
        .ok_or("'pid' is required (a number)")?;
    if pid == std::process::id() as u64 {
        return Err("refusing to kill the AgentScript agent itself".into());
    }
    #[cfg(windows)]
    let ok = {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        use std::os::windows::process::CommandExt;
        std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    #[cfg(not(windows))]
    let ok = {
        std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if ok { Ok(format!("Killed process {pid}.")) }
    else { Err(format!("could not kill process {pid} (not found or access denied)")) }
}

pub async fn tool_open_path(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let target = arg_str(args, "path")?;
    let resolved;
    let lower = target.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        resolved = target.clone(); // URLs are safe to hand to the OS handler
    } else {
        let p = ws.resolve_path(target.as_str(), true)?;
        resolved = p.to_string_lossy().to_string();
    }
    #[cfg(windows)]
    let ok = {
        // Use the OS file association directly; cmd/start can execute AutoRun
        // commands and reinterpret metacharacters in paths and URLs.
        use std::os::windows::ffi::OsStrExt;
        #[link(name="shell32")]
        unsafe extern "system" {fn ShellExecuteW(hwnd:*mut std::ffi::c_void,operation:*const u16,file:*const u16,parameters:*const u16,directory:*const u16,show:i32)->isize;}
        let file:Vec<u16>=std::ffi::OsStr::new(&resolved).encode_wide().chain(Some(0)).collect();
        let operation:Vec<u16>="open".encode_utf16().chain(Some(0)).collect();
        !resolved.contains('\0') && unsafe{ShellExecuteW(std::ptr::null_mut(),operation.as_ptr(),file.as_ptr(),std::ptr::null(),std::ptr::null(),1)>32}
    };
    #[cfg(not(windows))]
    let ok = {
        std::process::Command::new(if cfg!(target_os="macos") { "/usr/bin/open" } else { "xdg-open" }).arg(&resolved).spawn().is_ok()
    };
    if ok { Ok(format!("Opened {resolved} with the default application.")) }
    else { Err(format!("could not open '{resolved}'")) }
}

const DOWNLOAD_MAX_BYTES: u64 = 200 * 1024 * 1024;

pub async fn tool_download_file(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    let url = arg_str(args, "url")?;
    if !url.to_lowercase().starts_with("http://") && !url.to_lowercase().starts_with("https://") {
        return Err("'url' must be an http(s) URL".into());
    }
    let dest_rel = arg_str(args, "path")?;
    let dest = ws.resolve_path(dest_rel.as_str(), false)?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build().map_err(|e| format!("client error: {e}"))?;
    let resp = client.get(&url).send().await.map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} from {url}", resp.status()));
    }
    let total = resp.content_length();
    if let Some(n) = total {
        if n > DOWNLOAD_MAX_BYTES {
            return Err(format!("file is {} - over the {} download cap", human_size(n as f64), human_size(DOWNLOAD_MAX_BYTES as f64)));
        }
    }
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| format!("create failed: {e}"))?;
    use tokio::io::AsyncWriteExt;
    let mut written: u64 = 0;
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        written += chunk.len() as u64;
        if written > DOWNLOAD_MAX_BYTES {
            let _ = tokio::fs::remove_file(&dest).await;
            return Err(format!("download exceeded the {} cap mid-stream; aborted", human_size(DOWNLOAD_MAX_BYTES as f64)));
        }
        file.write_all(&chunk).await.map_err(|e| format!("write failed: {e}"))?;
    }
    file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
    Ok(format!(
        "Downloaded {url} -> {} ({}{})",
        ws.display(&dest),
        human_size(written as f64),
        total.map(|n| format!(" of {}", human_size(n as f64))).unwrap_or_default(),
    ))
}

// -- desktop control (FULL mode) ----------------------------------------
// Native screen capture + synthetic mouse/keyboard via Win32. All gated behind
// FULL PC ACCESS so a sandboxed session can never touch the user's screen.

#[cfg(windows)]
mod desktop {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct Point { pub x: i32, pub y: i32 }
    #[repr(C)]
    pub struct Rect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct MouseInput { pub dx: i32, pub dy: i32, pub mouse_data: u32, pub dw_flags: u32, pub time: u32, pub dw_extra_info: usize }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct KeybdInput { pub w_vk: u16, pub w_scan: u16, pub dw_flags: u32, pub time: u32, pub dw_extra_info: usize }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub union InputUnion { pub mi: MouseInput, pub ki: KeybdInput }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Input { pub itype: u32, pub u: InputUnion }

    pub const INPUT_MOUSE: u32 = 0;
    pub const INPUT_KEYBOARD: u32 = 1;
    pub const MOUSEEVENTF_MOVE: u32 = 0x0001;
    pub const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    pub const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    pub const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
    pub const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
    pub const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    pub const KEYEVENTF_KEYUP: u32 = 0x0002;
    pub const KEYEVENTF_UNICODE: u32 = 0x0004;
    pub const SRCCOPY: u32 = 0x00CC0020;
    pub const DIB_RGB_COLORS: u32 = 0;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct BitmapInfoHeader {
        pub bi_size: u32, pub bi_width: i32, pub bi_height: i32, pub bi_planes: u16,
        pub bi_bit_count: u16, pub bi_compression: u32, pub bi_size_image: u32,
        pub bi_xpels: i32, pub bi_ypels: i32, pub bi_clr_used: u32, pub bi_clr_important: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetSystemMetrics(index: i32) -> i32;
        pub fn SetCursorPos(x: i32, y: i32) -> i32;
        pub fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
        pub fn GetDC(hwnd: *mut c_void) -> *mut c_void;
        pub fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        pub fn CreateCompatibleDC(hdc: *mut c_void) -> *mut c_void;
        pub fn CreateCompatibleBitmap(hdc: *mut c_void, w: i32, h: i32) -> *mut c_void;
        pub fn SelectObject(hdc: *mut c_void, obj: *mut c_void) -> *mut c_void;
        pub fn BitBlt(dst: *mut c_void, x: i32, y: i32, w: i32, h: i32, src: *mut c_void, sx: i32, sy: i32, rop: u32) -> i32;
        pub fn GetDIBits(hdc: *mut c_void, bmp: *mut c_void, start: u32, lines: u32, bits: *mut c_void, bi: *mut BitmapInfoHeader, usage: u32) -> i32;
        pub fn DeleteObject(obj: *mut c_void) -> i32;
        pub fn DeleteDC(hdc: *mut c_void) -> i32;
    }
}

#[cfg(windows)]
pub async fn tool_screen_capture(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("screen_capture requires FULL PC ACCESS (enable it from the elio bar)".into()); }
    let path_rel = arg_str(args, "path").unwrap_or_else(|_| "screenshot.png".to_string());
    let dest = ws.resolve_path(path_rel.as_str(), false)?;
    #[cfg(windows)]
    {
        use desktop::*;
        let (w, h) = unsafe { (GetSystemMetrics(0), GetSystemMetrics(1)) };
        if w <= 0 || h <= 0 { return Err("could not read screen size".into()); }
        let hdc = unsafe { GetDC(std::ptr::null_mut()) };
        if hdc.is_null() { return Err("GetDC failed".into()); }
        let memdc = unsafe { CreateCompatibleDC(hdc) };
        let bmp = unsafe { CreateCompatibleBitmap(hdc, w, h) };
        let old = unsafe { SelectObject(memdc, bmp) };
        unsafe { BitBlt(memdc, 0, 0, w, h, hdc, 0, 0, SRCCOPY) };
        let mut bi = BitmapInfoHeader::default();
        bi.bi_size = std::mem::size_of::<BitmapInfoHeader>() as u32;
        bi.bi_width = w;
        bi.bi_height = -h;
        bi.bi_planes = 1;
        bi.bi_bit_count = 32;
        bi.bi_compression = 0;
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let got = unsafe { GetDIBits(memdc, bmp, 0, h as u32, buf.as_mut_ptr() as *mut std::ffi::c_void, &mut bi, DIB_RGB_COLORS) };
        unsafe { SelectObject(memdc, old); DeleteObject(bmp); DeleteDC(memdc); ReleaseDC(std::ptr::null_mut(), hdc); }
        if got == 0 { return Err("GetDIBits failed".into()); }
        let mut img: image::RgbaImage = image::ImageBuffer::new(w as u32, h as u32);
        for y in 0..h as u32 {
            for x in 0..w as u32 {
                let i = ((y * w as u32 + x) * 4) as usize;
                let b = buf[i]; let g = buf[i + 1]; let r = buf[i + 2];
                img.put_pixel(x, y, image::Rgba([r, g, b, 255]));
            }
        }
        img.save(&dest).map_err(|e| format!("could not write PNG: {e}"))?;
        return Ok(format!("Captured {}x{} screen to {}", w, h, ws.display(&dest)));
    }
    #[cfg(not(windows))]
    { let _ = dest; Err("screen capture is Windows-only".into()) }
}

#[cfg(windows)]
fn send_mouse(flags: u32, dx: i32, dy: i32, data: u32) -> Result<(), String> {
    use desktop::*;
    let input = Input { itype: INPUT_MOUSE, u: InputUnion { mi: MouseInput { dx, dy, mouse_data: data, dw_flags: flags, time: 0, dw_extra_info: 0 } } };
    let n = unsafe { SendInput(1, &input, std::mem::size_of::<Input>() as i32) };
    if n != 1 { Err("SendInput (mouse) failed".into()) } else { Ok(()) }
}

#[cfg(windows)]
pub async fn tool_mouse_move(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("mouse_move requires FULL PC ACCESS".into()); }
    let x = j_i32(args, "x")?; let y = j_i32(args, "y")?;
    let ok = unsafe { desktop::SetCursorPos(x, y) };
    if ok == 0 { Err("SetCursorPos failed".into()) } else { Ok(format!("Moved mouse to ({x}, {y}).")) }
}

#[cfg(windows)]
pub async fn tool_mouse_click(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("mouse_click requires FULL PC ACCESS".into()); }
    let button = args.get("button").and_then(|b| b.as_str()).unwrap_or("left").to_lowercase();
    if let (Ok(x), Ok(y)) = (j_i32(args, "x"), j_i32(args, "y")) {
        unsafe { desktop::SetCursorPos(x, y); }
    }
    let (down, up) = if button == "right" { (desktop::MOUSEEVENTF_RIGHTDOWN, desktop::MOUSEEVENTF_RIGHTUP) } else { (desktop::MOUSEEVENTF_LEFTDOWN, desktop::MOUSEEVENTF_LEFTUP) };
    send_mouse(down, 0, 0, 0)?;
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    send_mouse(up, 0, 0, 0)?;
    Ok(format!("Clicked {button} button."))
}

#[cfg(windows)]
pub async fn tool_key_type(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("key_type requires FULL PC ACCESS".into()); }
    use desktop::*;
    let text = arg_str(args, "text")?;
    for ch in text.chars() {
        let mut utf16 = [0u16; 2];
        for unit in ch.encode_utf16(&mut utf16).iter() {
            let down = Input { itype: INPUT_KEYBOARD, u: InputUnion { ki: KeybdInput { w_vk: 0, w_scan: *unit, dw_flags: KEYEVENTF_UNICODE, time: 0, dw_extra_info: 0 } } };
            let up = Input { itype: INPUT_KEYBOARD, u: InputUnion { ki: KeybdInput { w_vk: 0, w_scan: *unit, dw_flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dw_extra_info: 0 } } };
            unsafe { SendInput(1, &down, std::mem::size_of::<Input>() as i32); SendInput(1, &up, std::mem::size_of::<Input>() as i32); }
        }
    }
    Ok(format!("Typed {} characters.", text.chars().count()))
}

#[cfg(windows)]
mod winctl {
    use std::ffi::c_void;
    pub type Hwnd = *mut c_void;
    #[link(name = "user32")]
    extern "system" {
        pub fn EnumWindows(cb: extern "system" fn(Hwnd, isize) -> i32, lparam: isize) -> i32;
        pub fn IsWindowVisible(hwnd: Hwnd) -> i32;
        pub fn GetWindowTextW(hwnd: Hwnd, buf: *mut u16, max: i32) -> i32;
        pub fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        pub fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        pub fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
        pub fn IsIconic(hwnd: Hwnd) -> i32;
        pub fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
        pub fn GetWindowRect(hwnd: Hwnd, rect: *mut super::desktop::Rect) -> i32;
        pub fn GetWindowDC(hwnd: Hwnd) -> *mut c_void;
    }
}

#[cfg(windows)]
fn collect_windows() -> Vec<(usize, String)> {
    use std::sync::Mutex;
    use once_cell::sync::Lazy;
    use winctl::*;
    static OUT: Lazy<Mutex<Vec<(usize, String)>>> = Lazy::new(|| Mutex::new(Vec::new()));
    extern "system" fn cb(hwnd: Hwnd, _l: isize) -> i32 {
        unsafe {
            if IsWindowVisible(hwnd) != 0 {
                let len = GetWindowTextLengthW(hwnd);
                if len > 0 {
                    let mut buf: Vec<u16> = vec![0; (len + 1) as usize];
                    let got = GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
                    if got > 0 {
                        let title = String::from_utf16_lossy(&buf[..got as usize]);
                        if !title.trim().is_empty() {
                            if let Ok(mut v) = OUT.lock() { v.push((hwnd as usize, title)); }
                        }
                    }
                }
            }
        }
        1
    }
    if let Ok(mut v) = OUT.lock() { v.clear(); }
    unsafe { EnumWindows(cb, 0); }
    let out = OUT.lock().map(|v| v.clone()).unwrap_or_default();
    out
}

#[cfg(windows)]
pub async fn tool_list_windows(ws: &Workspace, _args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("list_windows requires FULL PC ACCESS".into()); }
    let wins = collect_windows();
    if wins.is_empty() { return Ok("No visible top-level windows found.".into()); }
    let mut lines = vec![format!("Open windows ({}):", wins.len())];
    for (hwnd, title) in wins.iter().take(80) {
        lines.push(format!("  hwnd={} \"{}\"", hwnd, title.chars().take(90).collect::<String>()));
    }
    Ok(lines.join("\n"))
}

#[cfg(windows)]
pub async fn tool_focus_window(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("focus_window requires FULL PC ACCESS".into()); }
    use winctl::*;
    let want = arg_str(args, "title")?.to_lowercase();
    let wins = collect_windows();
    let found = wins.iter().find(|(_, t)| t.to_lowercase().contains(&want));
    let Some((hwnd, title)) = found else { return Err(format!("no visible window whose title contains '{want}'")); };
    let h = *hwnd as Hwnd;
    unsafe { if IsIconic(h) != 0 { ShowWindow(h, 9); } SetForegroundWindow(h); }
    Ok(format!("Focused window \"{}\".", title.chars().take(90).collect::<String>()))
}

#[cfg(any(windows,target_os="macos"))]
pub async fn tool_launch_app(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("launch_app requires FULL PC ACCESS".into()); }
    let target = arg_str(args, "target")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Launch executables directly: cmd/start reparses paths and can run
        // a user's shell AutoRun commands. No shell is needed for an app.
        let mut command = std::process::Command::new(&target);
        if let Some(values) = args.get("argv").and_then(|value| value.as_array()) {
            for value in values {
                command.arg(value.as_str().ok_or("argv must contain strings")?);
            }
        } else if let Some(extra) = args.get("args").and_then(|value| value.as_str()) {
            // Preserve legacy simple arguments; quoted paths use argv instead.
            if extra.contains('"') { return Err("Use argv for arguments containing quoted paths".into()); }
            command.args(extra.split_whitespace());
        }
        if let Some(parent) = std::path::Path::new(&target).parent().filter(|p| p.is_dir()) {
            command.current_dir(parent);
        }
        command.creation_flags(CREATE_NO_WINDOW).spawn()
            .map_err(|error| format!("could not launch '{target}': {error}"))?;
        Ok(format!("Launched '{target}'."))
    }
    #[cfg(target_os="macos")]
    {
        let mut command=std::process::Command::new("/usr/bin/open");command.arg("-a").arg(&target);
        if let Some(values)=args.get("argv").and_then(|v|v.as_array()) {
            command.arg("--args");
            for value in values {command.arg(value.as_str().ok_or("argv must contain strings")?);}
        } else if let Some(extra)=args.get("args").and_then(|v|v.as_str()).filter(|s|!s.is_empty()) {command.arg("--args").args(extra.split_whitespace());}
        command.spawn().map_err(|error|format!("could not launch {target}: {error}"))?;Ok(format!("Launched {target}."))
    }
}

#[cfg(windows)]
pub async fn tool_window_screenshot(ws: &Workspace, args: &serde_json::Value) -> Result<String, String> {
    if !ws.full_access() { return Err("window_screenshot requires FULL PC ACCESS".into()); }
    use winctl::*;
    let titlewant = args.get("title").and_then(|v| v.as_str()).map(|s| s.to_lowercase());
    let wins = collect_windows();
    let pick = match &titlewant {
        Some(w) => wins.iter().find(|(_, t)| t.to_lowercase().contains(w)).cloned(),
        None => wins.first().cloned(),
    };
    let Some((hwnd, title)) = pick else { return Err("no matching window".into()); };
    let path_rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("window.png").to_string();
    let dest = ws.resolve_path(path_rel.as_str(), false)?;
    let h = hwnd as Hwnd;
    let mut rect = desktop::Rect { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetWindowRect(h, &mut rect); }
    let w = rect.right - rect.left;
    let ht = rect.bottom - rect.top;
    if w <= 0 || ht <= 0 { return Err("window has no drawable area".into()); }
    let hdc = unsafe { GetWindowDC(h) };
    if hdc.is_null() { return Err("GetWindowDC failed".into()); }
    let memdc = unsafe { desktop::CreateCompatibleDC(hdc) };
    let bmp = unsafe { desktop::CreateCompatibleBitmap(hdc, w, ht) };
    let old = unsafe { desktop::SelectObject(memdc, bmp) };
    unsafe { desktop::BitBlt(memdc, 0, 0, w, ht, hdc, 0, 0, desktop::SRCCOPY) };
    let mut bi = desktop::BitmapInfoHeader::default();
    bi.bi_size = std::mem::size_of::<desktop::BitmapInfoHeader>() as u32;
    bi.bi_width = w; bi.bi_height = -ht; bi.bi_planes = 1; bi.bi_bit_count = 32;
    let mut buf = vec![0u8; (w * ht * 4) as usize];
    let got = unsafe { desktop::GetDIBits(memdc, bmp, 0, ht as u32, buf.as_mut_ptr() as *mut std::ffi::c_void, &mut bi, desktop::DIB_RGB_COLORS) };
    unsafe { desktop::SelectObject(memdc, old); desktop::DeleteObject(bmp); desktop::DeleteDC(memdc); desktop::ReleaseDC(h, hdc); }
    if got == 0 { return Err("GetDIBits failed".into()); }
    let mut img: image::RgbaImage = image::ImageBuffer::new(w as u32, ht as u32);
    for y in 0..ht as u32 { for x in 0..w as u32 {
        let i = ((y * w as u32 + x) * 4) as usize;
        img.put_pixel(x, y, image::Rgba([buf[i + 2], buf[i + 1], buf[i], 255]));
    }}
    img.save(&dest).map_err(|e| format!("could not write PNG: {e}"))?;
    Ok(format!("Captured window \"{}\" ({}x{}) to {}", title.chars().take(80).collect::<String>(), w, ht, ws.display(&dest)))
}

// -- dispatch ------------------------------------------------------------

pub async fn dispatch(ws: &Workspace, name: &str, args: serde_json::Value) -> Result<String, String> {
    let empty = serde_json::Value::Null;
    let a = if args.is_null() || !args.is_object() { &empty } else { &args };
    match name {
        "workspace_info" => tool_workspace_info(ws, a).await,
        "list_directory" => tool_list_directory(ws, a).await,
        "tree" => tool_tree(ws, a).await,
        "read_file" => tool_read_file(ws, a).await,
        "read_file_base64" => tool_read_file_base64(ws, a).await,
        "write_file" => tool_write_file(ws, a).await,
        "edit_file" => tool_edit_file(ws, a).await,
        "create_folder" => tool_create_folder(ws, a).await,
        "delete_path" => tool_delete_path(ws, a).await,
        "move_path" => tool_move_path(ws, a).await,
        "search_files" => tool_search_files(ws, a).await,
        "grep_files" => tool_grep_files(ws, a).await,
        "run_command" => tool_run_command(ws, a).await,
        "file_info" => tool_file_info(ws, a).await,
        "env_info" => tool_env_info(ws, a).await,
        "process_list" => tool_process_list(ws, a).await,
        "process_kill" => tool_process_kill(ws, a).await,
        "open_path" => tool_open_path(ws, a).await,
        "download_file" => tool_download_file(ws, a).await,
        #[cfg(windows)]
        "screen_capture" => tool_screen_capture(ws, a).await,
        #[cfg(windows)]
        "mouse_move" => tool_mouse_move(ws, a).await,
        #[cfg(windows)]
        "mouse_click" => tool_mouse_click(ws, a).await,
        #[cfg(windows)]
        "key_type" => tool_key_type(ws, a).await,
        #[cfg(windows)]
        "list_windows" => tool_list_windows(ws, a).await,
        #[cfg(windows)]
        "focus_window" => tool_focus_window(ws, a).await,
        #[cfg(any(windows,target_os="macos"))]
        "launch_app" => tool_launch_app(ws, a).await,
        #[cfg(windows)]
        "window_screenshot" => tool_window_screenshot(ws, a).await,
        other => Err(format!(
            "unknown tool '{other}'. Available AgentScript tools: workspace_info, list_directory, tree, \
read_file, read_file_base64, write_file, edit_file, create_folder, delete_path, move_path, search_files, grep_files, \
run_command, file_info, env_info, process_list, process_kill (FULL mode), open_path, download_file, \
screen_capture / mouse_move / mouse_click / key_type / list_windows / focus_window / launch_app / window_screenshot (FULL mode, desktop control). \
Read any file as base64 (attachments/images) with read_file_base64 {{path}}. \
Call list_commands for full parameter details."
        )),
    }
}

fn schema(props: serde_json::Value, req: &[&str]) -> serde_json::Value {
    serde_json::json!({"type": "object", "properties": props, "required": req})
}

/// MCP-shaped catalog (same JSON shape the extension already consumes from
/// Studio's tools/list) so the browser side needs zero parser changes.
pub fn catalog() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"name": "workspace_info", "description": "Overview of the connected project folder: absolute root path, file/folder counts, total size and top-level entries.", "inputSchema": schema(serde_json::json!({}), &[])}),
        serde_json::json!({"name": "list_directory", "description": "List one folder's entries with types and sizes.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &[])}),
        serde_json::json!({"name": "tree", "description": "Recursive directory tree. Generated folders (.git, node_modules, __pycache__, dist...) are skipped.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}, "depth": {"type": "integer"}}), &[])}),
        serde_json::json!({"name": "read_file", "description": "Read a text file. Returns numbered lines as 'LINE | content'. Always read before editing so your old_string matches byte-for-byte.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}, "offset": {"type": "integer"}, "limit": {"type": "integer"}}), &["path"])}),
        serde_json::json!({"name": "write_file", "description": "Create a file or OVERWRITE an existing one with complete new content. Parent folders are created automatically. Prefer edit_file for partial changes.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}, "content": {"type": "string"}}), &["path", "content"])}),
        serde_json::json!({"name": "read_file_base64", "description": "Read ANY file (text or binary) as base64 + mimeType. The way to hand an image or a screenshot file to the AI as an attachment. Returns {path, mimeType, bytes, data}.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &["path"])}),
        serde_json::json!({"name": "edit_file", "description": "Exact-match string replacement inside a file. Replaces the FIRST match, or every match with replace_all:true. Fails loudly when old_string is missing or ambiguous.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}, "old_string": {"type": "string"}, "new_string": {"type": "string"}, "replace_all": {"type": "boolean"}}), &["path", "old_string", "new_string"])}),
        serde_json::json!({"name": "create_folder", "description": "Create a folder (and missing parents).", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &["path"])}),
        serde_json::json!({"name": "delete_path", "description": "Permanently DELETE a file or folder (folders recursive). Confirm scope with the user before deleting anything broad.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &["path"])}),
        serde_json::json!({"name": "move_path", "description": "Move or rename a file/folder. If destination is an existing folder, the source moves INSIDE it keeping its name.", "inputSchema": schema(serde_json::json!({"source": {"type": "string"}, "destination": {"type": "string"}}), &["source", "destination"])}),
        serde_json::json!({"name": "search_files", "description": "Find files/folders by NAME using glob patterns, e.g. \"**/*.py\", \"src/**/*.js\".", "inputSchema": schema(serde_json::json!({"pattern": {"type": "string"}}), &["pattern"])}),
        serde_json::json!({"name": "grep_files", "description": "Search INSIDE file contents. Case-insensitive substring by default; regex:true for regular expressions. Narrow with include globs like \"src/**/*.ts\".", "inputSchema": schema(serde_json::json!({"query": {"type": "string"}, "include": {"type": "string"}, "regex": {"type": "boolean"}, "ignore_case": {"type": "boolean"}}), &["query"])}),
        serde_json::json!({"name": "run_command", "description": "Run a terminal command in the workspace root: installs, builds, tests, git. Captures stdout/stderr and exit code. Blocks until done (hard timeout); never start interactive apps or dev servers.", "inputSchema": schema(serde_json::json!({"command": {"type": "string"}, "timeout_seconds": {"type": "integer"}, "cwd_note": {"type": "string", "description": "In FULL PC ACCESS mode use cd inside command to roam; relative paths resolve from the workspace root."}}), &["command"])}),
        serde_json::json!({"name": "file_info", "description": "Metadata for one path: kind, size, modified/created timestamps, readonly flag.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &["path"])}),
        serde_json::json!({"name": "env_info", "description": "Machine overview: host, OS, arch, CPU count, memory, user, workspace root, and whether FULL PC ACCESS is on.", "inputSchema": schema(serde_json::json!({}), &[])}),
        serde_json::json!({"name": "process_list", "description": "List running processes sorted by memory (top N by limit, default 40). Read-only.", "inputSchema": schema(serde_json::json!({"limit": {"type": "integer"}}), &[])}),
        serde_json::json!({"name": "process_kill", "description": "Kill a process by PID. Requires FULL PC ACCESS mode - refused otherwise by design.", "inputSchema": schema(serde_json::json!({"pid": {"type": "integer"}}), &["pid"])}),
        serde_json::json!({"name": "open_path", "description": "Open a file/folder (workspace-relative, absolute in FULL mode) or an http(s) URL with the OS default application.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &["path"])}),
        serde_json::json!({"name": "download_file", "description": "Download an http(s) URL to a path (200 MB cap, streamed). Path follows sandbox rules.", "inputSchema": schema(serde_json::json!({"url": {"type": "string"}, "path": {"type": "string"}}), &["url", "path"])}),
        serde_json::json!({"name": "screen_capture", "description": "Capture the full screen to a PNG file. Requires FULL PC ACCESS. Returns the saved path.", "inputSchema": schema(serde_json::json!({"path": {"type": "string"}}), &[])}),
        serde_json::json!({"name": "mouse_move", "description": "Move the mouse cursor to absolute screen (x, y). Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"x": {"type": "integer"}, "y": {"type": "integer"}}), &["x", "y"])}),
        serde_json::json!({"name": "mouse_click", "description": "Click the mouse (left/right), optionally moving to (x, y) first. Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"button": {"type": "string"}, "x": {"type": "integer"}, "y": {"type": "integer"}}), &[])}),
        serde_json::json!({"name": "key_type", "description": "Type a string of text via synthetic keystrokes into the focused window. Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"text": {"type": "string"}}), &["text"])}),
        serde_json::json!({"name": "list_windows", "description": "List visible top-level windows (hwnd + title). Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({}), &[])}),
        serde_json::json!({"name": "focus_window", "description": "Bring the first visible window whose title contains 'title' to the foreground. Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"title": {"type": "string"}}), &["title"])}),
        serde_json::json!({"name": "launch_app", "description": "Launch an executable directly by name or path (e.g. 'notepad', 'calc', or a full .exe path); use argv (array of strings) for paths with spaces, or legacy simple args. Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"target": {"type": "string"}, "args": {"type": "string"}, "argv": {"type":"array", "items":{"type":"string"}}}), &["target"])}),
        serde_json::json!({"name": "window_screenshot", "description": "Capture a single window (by title substring, or the first window) to a PNG. Requires FULL PC ACCESS.", "inputSchema": schema(serde_json::json!({"title": {"type": "string"}, "path": {"type": "string"}}), &[])}),
    ].into_iter().filter(|tool| {
        if cfg!(windows) { return true; }
        match tool["name"].as_str().unwrap_or("") {
            "screen_capture"|"mouse_move"|"mouse_click"|"key_type"|"list_windows"|"focus_window"|"window_screenshot"=>false,
            "launch_app"=>cfg!(target_os="macos"),
            _=>true
        }
    }).collect()
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn recorded_command_outcome_ignores_spoofed_stdout() {
        let dir=std::env::temp_dir().join(format!("elio-learning-command-{}",std::process::id()));
        let ws=Workspace::new(dir.to_str()).unwrap();
        std::fs::write(dir.join("failing.py"), "import sys\nprint('exit code 0')\nsys.exit(7)\n").unwrap();
        std::fs::write(dir.join("passing.py"), "print('checked')\n").unwrap();
        let (text,passed)=tool_run_command_observed(&ws,&serde_json::json!({"command":"python failing.py"})).await.unwrap();
        assert!(!passed);assert!(text.contains("exit code 0"),"{text}");assert!(text.contains("exit code 7"),"{text}");
        let (_,passed)=tool_run_command_observed(&ws,&serde_json::json!({"command":"python passing.py"})).await.unwrap();assert!(passed);
        let _=std::fs::remove_dir_all(dir);
    }

    use super::*;

    fn temp_ws(tag: &str) -> Workspace {
        let dir = std::env::temp_dir().join(format!("rs-ws-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Workspace::new(Some(dir.to_str().unwrap())).unwrap()
    }

    #[test]
    fn sandbox_rejects_escapes_and_absolute() {
        let ws = temp_ws("esc");
        assert!(ws.resolve_path("../outside", false).is_err());
        assert!(ws.resolve_path("a/../../b", false).is_err());
        assert!(ws.resolve_path("/etc/passwd", false).is_err());
        assert!(ws.resolve_path("C:/Windows/system32", false).is_err());
        assert!(ws.resolve_path("fine/sub/path.txt", false).is_ok());
        let inside = ws.resolve_path("sub/../ok.txt", false).unwrap();
        assert!(inside.starts_with(&ws.canon_root));
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn write_read_edit_roundtrip_preserves_crlf() {
        let ws = temp_ws("edit");
        let args = serde_json::json!({"path": "notes/a.txt", "content": "one\r\ntwo\r\nthree\r\n"});
        tool_write_file(&ws, &args).await.unwrap();
        let edit = serde_json::json!({"path": "notes/a.txt", "old_string": "two", "new_string": "TWO!"});
        let msg = tool_edit_file(&ws, &edit).await.unwrap();
        assert!(msg.contains("first occurrence"), "{msg}");
        let data = std::fs::read_to_string(ws.canon_root.join("notes/a.txt")).unwrap();
        assert_eq!(data, "one\r\nTWO!\r\nthree\r\n");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn edit_enforces_uniqueness_and_nearmiss_hint() {
        let ws = temp_ws("uniq");
        tool_write_file(&ws, &serde_json::json!({"path": "f.txt", "content": "alpha\nbeta\nalpha\n"})).await.unwrap();
        let dup = tool_edit_file(&ws, &serde_json::json!({"path": "f.txt", "old_string": "alpha", "new_string": "x"})).await;
        assert!(dup.unwrap_err().contains("matches 2 places"));
        let all = tool_edit_file(&ws, &serde_json::json!({"path": "f.txt", "old_string": "alpha", "new_string": "x", "replace_all": true})).await.unwrap();
        assert!(all.contains("2 occurrences"));
        // near-miss hint: wrong-case probe still points at the passage
        let miss = tool_edit_file(&ws, &serde_json::json!({"path": "f.txt", "old_string": "X", "new_string": "y"})).await;
        let msg = miss.unwrap_err();
        assert!(msg.contains("not found"), "{msg}");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn delete_and_move_guard_the_root() {
        let ws = temp_ws("rootguard");
        let del = tool_delete_path(&ws, &serde_json::json!({"path": "."})).await.unwrap_err();
        assert!(del.contains("refusing to delete"));
        let mv = tool_move_path(&ws, &serde_json::json!({"source": ".", "destination": "x"})).await.unwrap_err();
        assert!(mv.contains("refusing to move"));
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn grep_search_tree_basics() {
        let ws = temp_ws("grep");
        tool_write_file(&ws, &serde_json::json!({"path": "src/main.py", "content": "def hello():\n    pass\n"})).await.unwrap();
        tool_write_file(&ws, &serde_json::json!({"path": "lib/other.js", "content": "function hello() {}\n"})).await.unwrap();
        let g = tool_grep_files(&ws, &serde_json::json!({"query": "hello"})).await.unwrap();
        assert!(g.contains("src/main.py:1") && g.contains("lib/other.js:1"), "{g}");
        let s = tool_search_files(&ws, &serde_json::json!({"pattern": "**/*.py"})).await.unwrap();
        assert!(s.contains("src/main.py"), "{s}");
        let t = tool_tree(&ws, &serde_json::json!({"depth": 2})).await.unwrap();
        assert!(t.contains("main.py") && t.contains("other.js"), "{t}");
        let r = tool_read_file(&ws, &serde_json::json!({"path": "src/main.py"})).await.unwrap();
        assert!(r.contains("1 | def hello():"), "{r}");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn cancelled_command_does_not_leave_a_running_child() {
        let root=std::env::temp_dir().join(format!("elio-stop-test-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let marker=root.join("pid");let cwd=root.clone();
        let task=tokio::spawn(async move{run_shell("echo $$ > pid; sleep 30",&cwd,60).await});
        for _ in 0..100 {if marker.exists(){break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}
        let pid=std::fs::read_to_string(&marker).unwrap();task.abort();let _=task.await;
        for _ in 0..100 {if !std::process::Command::new("kill").args(["-0",pid.trim()]).stderr(std::process::Stdio::null()).status().unwrap().success(){std::fs::remove_dir_all(root).unwrap();return;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}
        panic!("Cancelled command remained running");
    }
    #[tokio::test]
    async fn run_command_captures_and_times_out() {
        let ws = temp_ws("run");
        let ok = tool_run_command(&ws, &serde_json::json!({"command": "echo hi"})).await.unwrap();
        assert!(ok.contains("hi") && ok.contains("exit code 0"), "{ok}");
        let err = tool_run_command(&ws, &serde_json::json!({"command": if cfg!(windows) {"exit /b 7"} else {"exit 7"}})).await.unwrap();
        assert!(err.contains("exit code 7"), "{err}");
        let slow = tool_run_command(&ws, &serde_json::json!({"command": if cfg!(windows) {"ping -n 30 127.0.0.1 > nul"} else {"sleep 30"}, "timeout_seconds": 1})).await.unwrap();
        assert!(slow.contains("TIMED OUT"), "{slow}");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn lenient_string_typed_args() {
        let ws = temp_ws("lenient");
        tool_write_file(&ws, &serde_json::json!({"path": "a.txt", "content": "x\ny\n"})).await.unwrap();
        // numeric params sent as strings must still work
        let r = tool_read_file(&ws, &serde_json::json!({"path": "a.txt", "offset": "1", "limit": "1"})).await.unwrap();
        assert!(r.contains("1 | x"), "{r}");
        // boolean param sent as string must still work
        tool_write_file(&ws, &serde_json::json!({"path": "b.txt", "content": "dup dup\n"})).await.unwrap();
        let e = tool_edit_file(&ws, &serde_json::json!({"path": "b.txt", "old_string": "dup", "new_string": "DUP", "replace_all": "true"})).await.unwrap();
        assert!(e.contains("2 occurrences"), "{e}");
        // unknown tools self-correct instead of dead-ending the model
        let u = dispatch(&ws, "nope_not_real", serde_json::json!({})).await.unwrap_err();
        assert!(u.contains("Available AgentScript tools") && u.contains("list_commands"), "{u}");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn base64_read_encodes_binary_files() {
        let ws = temp_ws("b64");
        // A real (tiny) PNG signature + a non-UTF8 byte: this is exactly the
        // shape read_file refuses ("looks like a BINARY file") and that the
        // screenshot path has to survive.
        let png: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF, 0x7F];
        tokio::fs::write(ws.canon_root.join("shot.png"), &png).await.unwrap();
        let out = tool_read_file_base64(&ws, &serde_json::json!({"path": "shot.png"})).await.unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mimeType"], "image/png");
        assert_eq!(v["bytes"].as_u64().unwrap(), png.len() as u64);
        assert_eq!(v["data"], base64_encode(&png));
        // RFC 4648 vectors: padding + remaining-byte cases must be exact.
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(&[0xFF, 0xFE, 0xFD, 0xFC]), "//79/A==");
        // A folder is rejected, and a missing file says so.
        assert!(tool_read_file_base64(&ws, &serde_json::json!({"path": "nope.png"})).await.is_err());
        // The unknown-tool hint advertises the new tool so a model can recover.
        let u = dispatch(&ws, "nope_not_real", serde_json::json!({})).await.unwrap_err();
        assert!(u.contains("read_file_base64"), "{u}");
        let _ = std::fs::remove_dir_all(&ws.canon_root);
    }

    #[tokio::test]
    async fn full_access_toggles_absolute_paths_and_gates_kill() {
        let ws = temp_ws("full");
        let abs = ws.canon_root.parent().unwrap().to_string_lossy().to_string();
        assert!(ws.resolve_path(&format!("{abs}/elsewhere.txt"), false).is_err());
        // kill is gated behind FULL mode
        assert!(tool_process_kill(&ws, &serde_json::json!({"pid": 999999})).await.is_err());
        ws.set_full_access(true);
        assert!(ws.full_access());
        assert!(ws.resolve_path(&format!("{abs}/elsewhere.txt"), false).is_ok());
        // ...but still refuses OUR own pid even in full mode
        let own = std::process::id();
        let self_kill = tool_process_kill(&ws, &serde_json::json!({"pid": own})).await;
        assert!(self_kill.is_err());
    }
}
