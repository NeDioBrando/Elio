#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{extract::{Query, State}, http::Method, response::{Html, IntoResponse}, routing::{get, post}, Json, Router};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, process::Stdio, sync::{atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering}, Arc}, time::Duration};
use tokio::{
    io::{AsyncWriteExt},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{broadcast, Mutex, RwLock},
};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Append-only file logger so the GUI-subsystem release build keeps visible
/// diagnostics outside the signed macOS bundle (stdout is invisible there).
#[derive(Clone)]
struct FileLog {
    file: Arc<std::sync::Mutex<resource_limits::RollingFile>>,
    ui: Option<Arc<gui::UiShared>>,
}
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for FileLog {
    type Writer = FileLog;
    fn make_writer(&'a self) -> Self::Writer { self.clone() }
}
impl std::io::Write for FileLog {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Some(ui) = &self.ui { ui.log(&String::from_utf8_lossy(buf)); }
        let mut f = self.file.lock().unwrap_or_else(|e| e.into_inner());
        std::io::Write::write(&mut *f, buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        let mut f = self.file.lock().unwrap_or_else(|e| e.into_inner());
        std::io::Write::flush(&mut *f)
    }
}

fn init_file_logger(ui: Option<Arc<gui::UiShared>>) {
    #[cfg(target_os = "macos")]
    let dir = platform::configuration_root().join("logs");
    #[cfg(not(target_os = "macos"))]
    let dir = std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|d| d.join("logs")))
        .unwrap_or_else(|| PathBuf::from("logs"));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("agent.log");
    match resource_limits::RollingFile::open(path,5*1024*1024) {
        Ok(file) => {
            tracing_subscriber::fmt()
                .with_env_filter("info")
                .with_ansi(false)
                .with_writer(FileLog { file: Arc::new(std::sync::Mutex::new(file)), ui })
                .init();
        }
        Err(_) => {
            tracing_subscriber::fmt().with_env_filter("info").init();
        }
    }
}

mod resource_limits;
mod gui;
mod workspace;
mod security;
mod preferences;
mod memory;
mod vault;
mod vault_assets;
mod compatibility;
mod safety;
mod figma;
mod templates;
mod creations;
mod explorer;
mod skills;
mod shared_learning;
mod starter_skills;
mod eclipse_skill;
mod vfx_studio_skill;
mod qp2_skill;
mod emitter2d_skill;
mod creation_export;
mod toolkit;
mod blender;
mod platform;
mod checkpoints;
mod mcp_addons;
mod studio_session;
mod studio_launcher;
mod media;
mod cancellation;
mod chat_history;
mod engram;
mod debug_report;
mod update_service;

#[cfg(windows)]
mod win_msg {
    #[link(name = "user32")]
    extern "system" {
        pub fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            ty: u32,
        ) -> i32;
    }
}

#[cfg(windows)]
fn win_alert(title: &str, msg: &str) {
    // windows_subsystem = "windows" hides stderr. A MessageBox is the only way
    // the user sees *why* the agent did not open.
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }
    let t = wide(title);
    let m = wide(msg);
    unsafe { win_msg::MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), 0x10); }
}


#[derive(Parser, Debug)]
#[command(name = "elio-agent", version = env!("CARGO_PKG_VERSION"), about = "Elio Native Agent — Roblox Studio MCP + AgentScript")]
struct Args {
    #[arg(long, help = "Run without the status window (for autostart/background use)")]
    headless: bool,
    #[arg(long, hide = true)]
    update_receipt: Option<PathBuf>,
    #[arg(long, help = "Open the desktop in the background")]
    background: bool,
    #[arg(long, help = "With --background, reopen the desktop window without taking focus")]
    restore_window: bool,
    #[arg(long, default_value = "127.0.0.1:3000")]
    roblox_addr: String,
    #[arg(long, help = "Workspace root for the LOCAL (FS) engine [env: ELIO_WORKSPACE_ROOT]")]
    workspace: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Payload { id: String, target: String, code: String, language: String, #[serde(default)] meta: serde_json::Value, }

#[derive(Clone)]
struct AppState {
    pairing_key: Arc<String>,
    cancellation: Arc<cancellation::Hub>,
    roblox_queue: Arc<Mutex<resource_limits::BudgetQueue<Payload>>>,
    bridge_tool_slots: Arc<tokio::sync::Semaphore>,
    roblox_clients: Arc<RwLock<HashMap<String, String>>>,
    local_clients: Arc<RwLock<HashMap<String, String>>>,
    workspace: Arc<workspace::Workspace>,
    result_tx: broadcast::Sender<ExecResult>,
    roblox_mcp: Arc<Mutex<McpRuntime>>,
    /// Count of in-flight MCP tools/list/probe calls. Status probes skip while
    /// this is non-zero so they never fight a 20s execute_luau for the mutex.
    mcp_in_flight: Arc<AtomicUsize>,
    roblox_proc: Arc<AtomicBool>,
    roblox_editor_connected: Arc<AtomicBool>,
    /// Consecutive failed Studio probes, shared by every probe path (auto-connect,
    /// heartbeat `studio_status`, `list_tools`, browser intro, restart).
    studio_probe_misses: Arc<AtomicU32>,
    addons: Arc<Mutex<mcp_addons::AddonManager>>,
    /// Last good add-on catalogue, served while the manager is busy starting servers.
    addon_cache: Arc<std::sync::Mutex<(Vec<serde_json::Value>, Vec<mcp_addons::ServerSummary>)>>,
    addon_refreshing: Arc<AtomicBool>,
    preferences: Arc<preferences::PreferencesStore>,
    ui: Arc<gui::UiShared>,
    updates: Arc<update_service::Service>,
}

impl AppState {
    fn new(
        result_tx: broadcast::Sender<ExecResult>,
        mcp_alive: Arc<AtomicBool>,
        roblox_proc: Arc<AtomicBool>,
        workspace: Arc<workspace::Workspace>,
        pairing_key: Arc<String>,
        preferences: Arc<preferences::PreferencesStore>,
        ui: Arc<gui::UiShared>,
    ) -> Self {
        Self {
            pairing_key,
            cancellation: Arc::new(cancellation::Hub::default()),
            updates: Arc::new(update_service::Service::default()),
            roblox_queue: Arc::new(Mutex::new(resource_limits::BudgetQueue::new(32,8*1024*1024))),
            bridge_tool_slots: Arc::new(tokio::sync::Semaphore::new(32)),
            roblox_clients: Arc::new(RwLock::new(HashMap::new())),
            local_clients: Arc::new(RwLock::new(HashMap::new())),
            workspace,
            result_tx,
            roblox_mcp: Arc::new(Mutex::new(McpRuntime::new(mcp_alive))),
            mcp_in_flight: Arc::new(AtomicUsize::new(0)),
            roblox_proc,
            roblox_editor_connected: Arc::new(AtomicBool::new(false)),
            studio_probe_misses: Arc::new(AtomicU32::new(0)),
            addons: Arc::new(Mutex::new(mcp_addons::AddonManager::new())),
            addon_cache: Arc::new(std::sync::Mutex::new((Vec::new(), Vec::new()))),
            addon_refreshing: Arc::new(AtomicBool::new(false)),
            preferences,
            ui,
        }
    }

    /// 1.24.13: the auto-connect loop already ignored one or two failed probes, but
    /// the browser heartbeat (`studio_status`, every 10 s), `list_tools` and the
    /// connection intro each flipped a verified Studio link to "MCP is off" on a
    /// single slow or failed `get_studio_state`. Every probe now goes through the
    /// same rule: a live link drops only after STUDIO_DROP_AFTER consecutive
    /// misses or when the helper process itself is gone.
    fn studio_probe_result(&self, probe: &anyhow::Result<()>) -> bool {
        match probe {
            Ok(()) => { self.studio_probe_misses.store(0, Ordering::Relaxed); true }
            Err(error) => {
                let misses = self.studio_probe_misses.fetch_add(1, Ordering::Relaxed).saturating_add(1);
                let was_connected = self.roblox_editor_connected.load(Ordering::Relaxed);
                !studio_should_drop(was_connected, misses, probe_failure_is_fatal(error))
            }
        }
    }

    fn set_editor_connection(&self, online: bool, tools: Option<&[serde_json::Value]>) {
        if self.roblox_editor_connected.swap(online, Ordering::Relaxed) != online {
            let mut event = serde_json::json!({"type":"roblox_status","studio":online,
                "studio_proc":self.roblox_proc.load(Ordering::Relaxed) || online});
            if let Some(tools) = tools {
                event["tools"] = serde_json::json!(tools);
                event["mcp_alive"] = serde_json::json!(true);
            }
            let _ = self.ui.desktop_events.send(event);
        }
    }
}

/// Persistent stdio client for Roblox Studio's built-in MCP server.
struct McpRuntime {
    request_pending: bool,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<resource_limits::LimitedLines<ChildStdout>>,
    next_id: u64,
    tools: Vec<serde_json::Value>,
    studio_id: Option<serde_json::Value>,
    studio_checked: Option<std::time::Instant>,
    alive: Arc<AtomicBool>,
}

impl McpRuntime {
    fn new(alive: Arc<AtomicBool>) -> Self {
        Self { request_pending: false, child: None, stdin: None, stdout: None, next_id: 1, tools: Vec::new(), studio_id: None, studio_checked: None, alive }
    }

    fn launcher() -> anyhow::Result<(String, Vec<String>)> {
        if let Ok(raw) = std::env::var("ELIO_MCP_COMMAND").or_else(|_| std::env::var("ROBLOXSCRIPT_MCP_COMMAND")) {
            let mut parts = raw.split_whitespace();
            let program = parts.next().ok_or_else(|| anyhow::anyhow!("ELIO_MCP_COMMAND is empty"))?;
            return Ok((program.to_string(), parts.map(str::to_string).collect()));
        }
        #[cfg(target_os = "macos")]
        {
            let mut paths = vec![PathBuf::from("/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP")];
            if let Some(home) = std::env::var_os("HOME") { paths.push(PathBuf::from(home).join("Applications/RobloxStudio.app/Contents/MacOS/StudioMCP")); }
            if let Some(path) = paths.iter().find(|path| path.is_file()) { return Ok((path.to_string_lossy().into_owned(), vec![])); }
            anyhow::bail!("Roblox Studio MCP launcher is missing. Install Roblox Studio and enable Studio as MCP server in Assistant settings.");
        }
        #[cfg(not(target_os = "macos"))]
        {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let roots: Vec<PathBuf> = ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"]
            .iter().filter_map(|name| std::env::var_os(name).map(PathBuf::from)).collect();
        let mut sys = sysinfo::System::new();
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true,
            sysinfo::ProcessRefreshKind::new().with_exe(sysinfo::UpdateKind::OnlyIfNotSet));
        let running: Vec<PathBuf> = sys.processes().values()
            .filter(|process| is_roblox_studio_process(&process.name().to_string_lossy()))
            .filter_map(|process| process.exe().map(PathBuf::from)).collect();
        let launcher = studio_launcher::windows_launcher(&running, local.as_deref(), &roots)
            .ok_or_else(|| anyhow::anyhow!("Roblox Studio MCP launcher is missing. Install Roblox Studio and enable Assistant → Manage MCP Servers → Enable Studio as MCP server."))?;
        if launcher.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("bat")) {
            Ok(("cmd".to_string(), vec!["/D".to_string(), "/C".to_string(), launcher.to_string_lossy().into_owned()]))
        } else {
            Ok((launcher.to_string_lossy().into_owned(), vec![]))
        }
        }
    }

    async fn reset(&mut self) {
        self.request_pending=false;
        let child = self.child.take();
        self.stdin = None; self.stdout = None; self.tools.clear(); self.studio_id = None; self.studio_checked = None; self.next_id = 1;
        self.alive.store(false, Ordering::Relaxed);
        if let Some(mut child) = child {
            info!("MCP runtime reset — closing the owned helper process");
            #[cfg(windows)]
            if let Some(pid) = child.id() {
                let mut killer=Command::new("taskkill");
                killer.args(["/F","/T","/PID",&pid.to_string()]).creation_flags(CREATE_NO_WINDOW).kill_on_drop(true);
                let _=tokio::time::timeout(Duration::from_secs(3),killer.output()).await;
            }
            let _=child.start_kill();
            let _=tokio::time::timeout(Duration::from_secs(2),child.wait()).await;
        }
    }

    /// True if the helper process is still running. Uses try_wait so a crashed
    /// StudioMCP is not treated as alive just because Option<Child> is Some.
    fn child_alive(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                Ok(Some(status)) => {
                    info!("MCP helper exited ({status})");
                    false
                }
                Err(e) => {
                    tracing::warn!("MCP try_wait failed: {e}");
                    false
                }
            },
            None => false,
        }
    }

    async fn ensure(&mut self) -> anyhow::Result<()> {
        if self.alive.load(Ordering::Relaxed) && self.child_alive() && self.stdin.is_some() && self.stdout.is_some() {
            return Ok(());
        }
        self.reset().await;
        let (program, args) = Self::launcher()?;
        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut child = cmd.spawn().map_err(|e| { tracing::error!("MCP helper spawn failed: {e}"); e })?;
        info!("MCP helper spawned OK");
        self.stdin = child.stdin.take();
        self.stdout = child.stdout.take().map(|s| resource_limits::LimitedLines::new(s,32*1024*1024));
        self.child = Some(child);
        let _ = self.request("initialize", serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "elio", "version": env!("CARGO_PKG_VERSION")}
        })).await.map_err(|e| { tracing::warn!("MCP initialize failed: {e:#}"); e })?;
        self.notify("notifications/initialized", serde_json::json!({})).await?;
        self.alive.store(true, Ordering::Relaxed);
        Ok(())
    }

    async fn notify(&mut self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        let line = serde_json::json!({"jsonrpc":"2.0", "method":method, "params":params}).to_string() + "\n";
        let stdin = self.stdin.as_mut().ok_or_else(|| anyhow::anyhow!("MCP stdin unavailable"))?;
        tokio::time::timeout(Duration::from_secs(5), async { stdin.write_all(line.as_bytes()).await?; stdin.flush().await })
            .await.map_err(|_| anyhow::anyhow!("MCP notification timed out: {method}"))??;
        Ok(())
    }

    async fn request(&mut self, method: &str, params: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        self.request_with_timeout(method, params, Duration::from_secs(120)).await
    }

    async fn request_with_timeout(&mut self, method: &str, params: serde_json::Value, budget: Duration) -> anyhow::Result<serde_json::Value> {
        let request_id = self.next_id; self.next_id += 1;
        let line = serde_json::json!({"jsonrpc":"2.0", "id":request_id, "method":method, "params":params}).to_string() + "\n";
        let deadline = tokio::time::Instant::now() + budget;
        self.request_pending=true;
        let exchange = async {
            let stdin = self.stdin.as_mut().ok_or_else(|| anyhow::anyhow!("MCP stdin unavailable"))?;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
            let stdout = self.stdout.as_mut().ok_or_else(|| anyhow::anyhow!("MCP stdout unavailable"))?;
            loop {
                anyhow::ensure!(tokio::time::Instant::now() < deadline, "MCP request timed out: {method}");
                let line = stdout.next_line().await?.ok_or_else(|| anyhow::anyhow!("MCP server exited while handling {method}"))?;
                let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
                if message.get("id").and_then(|v| v.as_u64()) != Some(request_id) { continue; }
                if let Some(error) = message.get("error") { anyhow::bail!("MCP {method} failed: {error}"); }
                return message.get("result").cloned().ok_or_else(|| anyhow::anyhow!("MCP {method} returned no result"));
            }
        };
        let outcome=tokio::time::timeout_at(deadline, exchange).await.map_err(|_| anyhow::anyhow!("MCP request timed out: {method}"));
        self.request_pending=false;
        outcome?
    }

    async fn list_tools(&mut self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.ensure().await?;
        let result = self.request("tools/list", serde_json::json!({})).await?;
        self.tools = result.get("tools").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(studio_session::public_tools(&self.tools))
    }

    async fn probe_studio(&mut self) -> anyhow::Result<()> {
        let out = self.call_tool("get_studio_state", serde_json::json!({})).await?;
        let text = out.text;
        if studio_text_disconnected(&text) {
            anyhow::bail!("Roblox Studio is not connected");
        }
        Ok(())
    }

    async fn call_tool(&mut self, name: &str, mut args: serde_json::Value) -> anyhow::Result<McpOutput> {
        self.ensure().await?;
        if self.tools.is_empty() { self.list_tools().await?; }
        let targeted = studio_session::needs_id(&self.tools, name);
        let explicit_id = args.get("studio_id").filter(|id| !id.is_null()).cloned();
        if targeted && explicit_id.is_none() {
            if self.studio_checked.is_none_or(|time| time.elapsed() >= Duration::from_secs(5)) {
                let discovery = tokio::time::timeout(Duration::from_secs(5), self.request("tools/call", serde_json::json!({"name":"list_roblox_studios","arguments":{}})))
                    .await.map_err(|_| anyhow::anyhow!("Studio discovery timed out; the local bridge remains available"))??;
                let ids = studio_session::discover(&discovery)?;
                self.studio_id = Some(studio_session::select(&ids, self.studio_id.as_ref())?);
                self.studio_checked = Some(std::time::Instant::now());
            }
            let object = args.as_object_mut().ok_or_else(|| anyhow::anyhow!("Studio tool arguments must be an object"))?;
            object.insert("studio_id".into(), self.studio_id.clone().ok_or_else(|| anyhow::anyhow!("Studio ID unavailable"))?);
        }
        let result = self.request("tools/call", serde_json::json!({"name":name, "arguments":args})).await?;
        let is_error = result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
        let items = result.get("content").and_then(|v| v.as_array());
        // Text blocks are concatenated as before. IMAGE blocks (an MCP server's
        // screenshot: {type:"image", data:<base64>, mimeType:"image/png"}) carry
        // NO "text" field, so the old text-only join silently dropped them and
        // Studio's screen_capture looked like it had returned an empty result.
        // They are collected here and shipped to the extension, which attaches
        // them to the model's next message.
        let mut images: Vec<serde_json::Value> = Vec::new();
        let mut texts: Vec<&str> = Vec::new();
        if let Some(items) = items {
            for item in items {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) { texts.push(t); }
                let kind = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let is_image = kind == "image" || item.get("data").is_some() && kind != "text";
                if !is_image { continue; }
                let data = item.get("data").and_then(|v| v.as_str()).unwrap_or("");
                if data.is_empty() { continue; }
                let mime = item.get("mimeType").and_then(|v| v.as_str())
                    .or_else(|| item.get("mime_type").and_then(|v| v.as_str()))
                    .unwrap_or("image/png");
                images.push(serde_json::json!({"mimeType": mime, "data": data}));
            }
        }
        let text = if texts.is_empty() && items.is_some() {
            // No text block at all: keep the old raw-JSON fallback so a server
            // with an unusual shape still shows SOMETHING to the model.
            if images.is_empty() { result.to_string() } else { String::new() }
        } else {
            texts.join("\n")
        };
        if is_error { anyhow::bail!("{text}"); }
        if targeted {
            if let Some(id) = explicit_id { self.studio_id = Some(id); self.studio_checked = None; }
        }
        Ok(McpOutput { text, images })
    }
}

/// Result of one MCP tool call: text output plus any image blocks the server
/// returned. Serialised into the extension's `tool_result` frame.
#[derive(Clone, Debug)]
struct McpOutput {
    text: String,
    images: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ExecResult { id: String, ok: bool, result: String, error: Option<String>, }

#[cfg(windows)]
fn port_owner_pid(port: u16) -> Option<u32> {
    #[link(name="iphlpapi")]
    unsafe extern "system" {
        fn GetExtendedTcpTable(table:*mut std::ffi::c_void,size:*mut u32,ordered:i32,family:u32,class:u32,reserved:u32)->u32;
    }
    for (family,ipv6) in [(2,false),(23,true)] {
        let mut size=0;
        let first=unsafe { GetExtendedTcpTable(std::ptr::null_mut(),&mut size,0,family,3,0) };
        if first!=122 || size<4 { continue; }
        // The OS can add a listener between sizing and reading the table.
        for _ in 0..3 {
            if size>16*1024*1024 { break; }
            let mut table=vec![0u32;(size as usize+3)/4];
            let result=unsafe { GetExtendedTcpTable(table.as_mut_ptr().cast(),&mut size,0,family,3,0) };
            if result==122 { continue; }
            if result!=0 || size as usize>table.len()*4 { break; }
            if let Some(pid)=tcp_listener_owner(&table[..size as usize/4],ipv6,port) { return Some(pid); }
            break;
        }
    }
    None
}

#[cfg(any(windows,test))]
fn tcp_listener_owner(table:&[u32],ipv6:bool,port:u16)->Option<u32> {
    let count=*table.first()? as usize;
    let width=if ipv6 {14}else{6};
    if count>table.len().saturating_sub(1)/width { return None; }
    for row in table[1..].chunks_exact(width).take(count) {
        let (state,network_port,pid,local)=if ipv6 {
            let mut bytes=[0u8;16];
            for (slot,word) in bytes.chunks_exact_mut(4).zip(row[..4].iter()) {slot.copy_from_slice(&word.to_ne_bytes());}
            let address=std::net::Ipv6Addr::from(bytes);
            (row[12],row[5],row[13],address.is_unspecified()||address.is_loopback()||address.to_ipv4_mapped().is_some_and(|v|v.is_loopback()))
        } else {
            let address=std::net::Ipv4Addr::from(row[1].to_ne_bytes());
            (row[0],row[2],row[5],address.is_unspecified()||address.is_loopback())
        };
        if state==2 && local && u16::from_be(network_port as u16)==port && pid!=0 {return Some(pid);}
    }
    None
}
#[cfg(not(windows))]
fn port_owner_pid(_port: u16) -> Option<u32> { None }

#[cfg(windows)]
fn process_image(pid: u32) -> Option<String> {
    #[link(name="kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access:u32,inherit:i32,pid:u32)->*mut std::ffi::c_void;
        fn QueryFullProcessImageNameW(process:*mut std::ffi::c_void,flags:u32,path:*mut u16,size:*mut u32)->i32;
        fn CloseHandle(handle:*mut std::ffi::c_void)->i32;
    }
    let process=unsafe {OpenProcess(0x1000,0,pid)};
    if process.is_null(){return None;}
    let mut path=vec![0u16;32768];let mut size=path.len() as u32;
    let ok=unsafe {QueryFullProcessImageNameW(process,0,path.as_mut_ptr(),&mut size)};
    unsafe {CloseHandle(process);}
    if ok==0 || size as usize>path.len(){return None;}
    let path=String::from_utf16_lossy(&path[..size as usize]);
    PathBuf::from(path).file_name().map(|name|name.to_string_lossy().to_ascii_lowercase())
}
#[cfg(not(windows))]
fn process_image(_pid: u32) -> Option<String> { None }

fn is_elio_image(image: &str) -> bool {
    matches!(
        image.trim().to_ascii_lowercase().as_str(),
        "elio.exe" | "elio-agent.exe"
    )
}

#[cfg(windows)]
fn reclaim_port(port: u16) -> anyhow::Result<()> {
    let Some(pid) = port_owner_pid(port) else { return Ok(()); };
    if pid == std::process::id() { return Ok(()); }
    let image = process_image(pid).unwrap_or_default();
    if is_elio_image(&image) {
        tracing::info!("killing stale elio Agent (pid {pid}) on port {port}...");
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while port_owner_pid(port).is_some() {
            if std::time::Instant::now() >= deadline { anyhow::bail!("Could not free port {port} — close the old agent manually."); }
            std::thread::sleep(Duration::from_millis(150));
        }
        tracing::info!("port {port} is free, starting fresh agent.");
        return Ok(());
    }
    anyhow::bail!(
        "Port {port} is held by '{image}' (pid {pid}). Close that program or pick a\
        \ndifferent port, then start the agent again."
    );
}
#[cfg(not(windows))]
fn reclaim_port(_port: u16) -> anyhow::Result<()> { Ok(()) }

#[cfg(windows)]
struct StartupGuard(*mut std::ffi::c_void);
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *mut std::ffi::c_void, owner: i32, name: *const u16) -> *mut std::ffi::c_void;
    fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
    fn ReleaseMutex(handle: *mut std::ffi::c_void) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}
#[cfg(windows)]
impl StartupGuard {
    fn acquire(addr: SocketAddr) -> anyhow::Result<Self> {
        let name: Vec<u16> = format!("Local\\elio-startup-{}", addr).encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
        anyhow::ensure!(!handle.is_null(), "Could not create startup lock: {}", std::io::Error::last_os_error());
        let wait = unsafe { WaitForSingleObject(handle, 30000) };
        if wait != 0 && wait != 0x80 {
            unsafe { CloseHandle(handle); }
            anyhow::bail!("Another elio launch is still starting. Wait briefly and open elio again.");
        }
        Ok(Self(handle))
    }
}
#[cfg(windows)]
impl Drop for StartupGuard {
    fn drop(&mut self) { unsafe { ReleaseMutex(self.0); CloseHandle(self.0); } }
}
#[cfg(unix)]
struct StartupGuard(std::fs::File);
#[cfg(unix)]
impl StartupGuard {
    fn acquire(addr: SocketAddr) -> anyhow::Result<Self> {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::OpenOptionsExt;
        let home = std::env::var_os("HOME").ok_or_else(||anyhow::anyhow!("Cannot locate startup lock directory"))?;
        let directory = PathBuf::from(home).join(".config/elio");std::fs::create_dir_all(&directory)?;
        let file=std::fs::OpenOptions::new().read(true).write(true).create(true).mode(0o600).open(directory.join(format!("startup-{}.lock",addr.port())))?;
        let start=std::time::Instant::now();
        loop {
            if unsafe { libc::flock(file.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB) }==0 { return Ok(Self(file)); }
            let error=std::io::Error::last_os_error();
            anyhow::ensure!(error.kind()==std::io::ErrorKind::WouldBlock,"Cannot acquire startup lock: {error}");
            anyhow::ensure!(start.elapsed()<Duration::from_secs(15),"Another elio launch is still starting. Retry shortly.");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
#[cfg(unix)]
impl Drop for StartupGuard { fn drop(&mut self) {use std::os::fd::AsRawFd;unsafe {libc::flock(self.0.as_raw_fd(),libc::LOCK_UN);}} }
#[cfg(not(any(windows,unix)))]
struct StartupGuard;
#[cfg(not(any(windows,unix)))]
impl StartupGuard {fn acquire(_addr:SocketAddr)->anyhow::Result<Self>{Ok(Self)}}

async fn bind_required(addr: SocketAddr, wait: Duration) -> anyhow::Result<tokio::net::TcpListener> {
    // Healthy startup binds immediately: no process scans or helper launches.
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener)=>return Ok(listener),
        Err(error) if error.kind()==std::io::ErrorKind::AddrInUse=>{},
        Err(error)=>anyhow::bail!("Cannot start the local bridge at {addr}: {error}. Details: logs/agent.log."),
    }
    let port=addr.port();
    tokio::task::spawn_blocking(move||reclaim_port(port)).await??;
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse && tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
            Err(error) => anyhow::bail!("Cannot start the local bridge at {addr}: {error}. Close an older elio instance if it is still exiting. Details: logs/agent.log."),
        }
    }
}

fn should_reuse_running_version(running_version: &str) -> bool {
    running_version == env!("CARGO_PKG_VERSION")
}

async fn focus_existing(addr: SocketAddr, pairing_key: &str) -> bool {
    if !addr.ip().is_loopback() {
        return false;
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    let root_url = format!("http://{addr}/");
    let running_version = match client.get(root_url).bearer_auth(pairing_key).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| body.get("version").and_then(|value| value.as_str()).map(str::to_string)),
        _ => None,
    };

    let Some(running_version) = running_version else {
        return false;
    };

    if !should_reuse_running_version(&running_version) {
        info!(
            "older elio instance v{} detected while launching v{} — replacing it",
            running_version,
            env!("CARGO_PKG_VERSION")
        );
        let shutdown_url = format!("http://{addr}/api/shutdown");
        let _ = client.post(shutdown_url).bearer_auth(pairing_key).send().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        return false;
    }

    let show_url = format!("http://{addr}/api/show");
    match client.post(show_url).bearer_auth(pairing_key).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

fn env_first(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| std::env::var(k).ok().filter(|s| !s.trim().is_empty()))
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    async fn deadline_fixture(script: &str) -> McpRuntime {
        let mut child = Command::new("python").args(["-u", "-c", script])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().unwrap();
        let mut mcp = McpRuntime::new(Arc::new(AtomicBool::new(true)));
        mcp.stdin=child.stdin.take();mcp.stdout=child.stdout.take().map(|s|resource_limits::LimitedLines::new(s,32*1024*1024));mcp.child=Some(child);mcp
    }

    #[tokio::test]
    async fn mcp_deadline_does_not_restart_for_notifications_or_wrong_ids() {
        let mut mcp=deadline_fixture("import sys,time,json\nrequest=json.loads(sys.stdin.readline())\nwhile True:\n print('not json');print(json.dumps({'jsonrpc':'2.0','method':'notifications/progress'}));print(json.dumps({'id':999,'result':{}}))").await;
        let start=std::time::Instant::now();
        let error=mcp.request_with_timeout("tools/call",serde_json::json!({}),Duration::from_secs(1)).await.unwrap_err();
        assert!(error.to_string().contains("timed out"));assert!(start.elapsed()<Duration::from_secs(3));
        mcp.child.as_mut().unwrap().kill().await.unwrap();
    }

    #[tokio::test]
    async fn mcp_deadline_covers_a_helper_that_stops_reading_stdin() {
        let mut mcp=deadline_fixture("import time;time.sleep(10)").await;
        let start=std::time::Instant::now();
        let error=mcp.request_with_timeout("tools/call",serde_json::json!({"code":"x".repeat(8*1024*1024)}),Duration::from_millis(300)).await.unwrap_err();
        assert!(error.to_string().contains("timed out"));assert!(start.elapsed()<Duration::from_secs(4));
        mcp.child.as_mut().unwrap().kill().await.unwrap();
    }

    #[tokio::test]
    async fn mcp_deadline_accepts_one_matching_result_after_noise() {
        let mut mcp=deadline_fixture("import sys,json\nfor line in sys.stdin:\n r=json.loads(line);print('noise');print(json.dumps({'id':999,'result':'wrong'}));print(json.dumps({'id':r['id'],'result':{'ok':True}}))").await;
        for _ in 0..2 { assert_eq!(mcp.request_with_timeout("tools/call",serde_json::json!({}),Duration::from_secs(5)).await.unwrap()["ok"],true); }
        mcp.child.as_mut().unwrap().kill().await.unwrap();
    }


    #[tokio::test]
    async fn verified_editor_transitions_push_to_all_subscribers_without_locking_tools() {
        let alive = Arc::new(AtomicBool::new(false));
        let ui = Arc::new(gui::UiShared::new(alive.clone()));
        let folder = std::env::temp_dir().join(format!("elio-status-test-{}", std::process::id()));
        let workspace = Arc::new(workspace::Workspace::new(Some(folder.to_str().unwrap())).unwrap());
        let state = AppState::new(broadcast::channel(16).0, alive, Arc::new(AtomicBool::new(false)),
            workspace, Arc::new("test-key".into()), Arc::new(preferences::PreferencesStore::load()), ui.clone());
        let mut first = ui.desktop_events.subscribe();
        let mut second = ui.desktop_events.subscribe();
        let _running_tool = state.roblox_mcp.lock().await;
        state.mcp_in_flight.store(1, Ordering::Relaxed);
        let tools = vec![serde_json::json!({"name":"execute_luau"})];
        state.set_editor_connection(true, Some(&tools));
        let event = tokio::time::timeout(Duration::from_millis(100), first.recv()).await.unwrap().unwrap();
        assert_eq!(event, second.try_recv().unwrap());
        assert_eq!(event["studio"], true);
        assert_eq!(event["tools"], serde_json::json!(tools));
        state.set_editor_connection(true, Some(&tools));
        assert!(matches!(first.try_recv(), Err(broadcast::error::TryRecvError::Empty)));
        state.set_editor_connection(false, None);
        assert_eq!(first.try_recv().unwrap()["studio"], false);
        assert_eq!(second.try_recv().unwrap()["studio"], false);
        assert_eq!(state.mcp_in_flight.load(Ordering::Relaxed), 1);
        let _ = std::fs::remove_dir_all(folder);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn studio_ids_reach_stdio_calls_and_legacy_calls_stay_unchanged() {
        for modern in [true, false] {
            let script = r#"import sys,json
modern = sys.argv[1] == 'true'
discoveries = 0
for line in sys.stdin:
 request = json.loads(line)
 if 'id' not in request: continue
 method = request['method']; params = request.get('params',{})
 if method == 'tools/list':
  properties = {'studio_id':{'type':'string'}} if modern else {}
  result = {'tools':[{'name':'script_read','inputSchema':{'type':'object','properties':properties,'required':['studio_id'] if modern else []}}, {'name':'list_roblox_studios','inputSchema':{'type':'object'}}]}
 else:
  name = params['name']; args = params.get('arguments',{})
  if name == 'list_roblox_studios':
   discoveries += 1
   result = {'structuredContent':{'studios':[{'name':'Game','studio_id':'studio-exact'}]}}
  else:
   result = {'content':[{'type':'text','text':json.dumps({'arguments':args,'discoveries':discoveries})}]}
 print(json.dumps({'jsonrpc':'2.0','id':request['id'],'result':result}),flush=True)
"#;
            let mut child = Command::new("python3").args(["-u", "-c", script, if modern {"true"} else {"false"}])
                .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
            let mut mcp = McpRuntime::new(Arc::new(AtomicBool::new(true)));
            mcp.stdin = child.stdin.take();
            mcp.stdout = child.stdout.take().map(|stream| resource_limits::LimitedLines::new(stream,32*1024*1024));
            mcp.child = Some(child);
            let tools = mcp.list_tools().await.unwrap();
            assert!(!tools[0]["inputSchema"]["required"].as_array().unwrap().contains(&serde_json::json!("studio_id")));
            for _ in 0..2 {
                let output = mcp.call_tool("script_read", serde_json::json!({"path":"exact"})).await.unwrap();
                let observed: serde_json::Value = serde_json::from_str(&output.text).unwrap();
                assert_eq!(observed["arguments"]["path"], "exact");
                assert_eq!(observed["arguments"]["studio_id"], if modern {serde_json::json!("studio-exact")} else {serde_json::Value::Null});
                assert_eq!(observed["discoveries"], if modern {1} else {0});
            }
            let output = mcp.call_tool("script_read", serde_json::json!({"studio_id":"caller-chosen"})).await.unwrap();
            assert!(output.text.contains("caller-chosen"));
            mcp.reset().await;
            assert!(mcp.studio_id.is_none());
        }
    }


    async fn fake_request_runtime(script: &str) -> McpRuntime {
        let python=if cfg!(windows){"python"}else{"python3"};
        let mut child=Command::new(python).args(["-u","-c",script]).kill_on_drop(true)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut mcp=McpRuntime::new(Arc::new(AtomicBool::new(true)));
        mcp.stdin=child.stdin.take();mcp.stdout=child.stdout.take().map(|s|resource_limits::LimitedLines::new(s,32*1024*1024));mcp.child=Some(child);mcp
    }
    #[tokio::test]
    async fn mcp_notification_noise_and_backpressured_writes_have_total_deadlines() {
        for (script,params) in [
            ("import sys,time,json\nrequest=json.loads(sys.stdin.readline())\nwhile True:\n print(json.dumps({'method':'notifications/progress','params':{'progress':1}}),flush=True)\n time.sleep(.01)\n",serde_json::json!({})),
            ("import time\ntime.sleep(60)\n",serde_json::json!({"code":"x".repeat(2*1024*1024)})),
        ] {
            let mut mcp=fake_request_runtime(script).await;let started=std::time::Instant::now();
            let error=mcp.request_with_timeout("tools/call",params,Duration::from_millis(250)).await.unwrap_err();
            assert!(error.to_string().contains("timed out"));assert!(started.elapsed()<Duration::from_secs(3));
            mcp.reset().await;assert!(mcp.child.is_none());assert!(!mcp.alive.load(Ordering::Relaxed));
        }
    }
    #[tokio::test]
    async fn mcp_matching_reply_ignores_unrelated_and_late_ids_without_replay() {
        let script="import sys,json\nfor line in sys.stdin:\n r=json.loads(line)\n print('not-json',flush=True)\n print(json.dumps({'id':r['id']-1,'result':'stale'}),flush=True)\n print(json.dumps({'id':r['id'],'result':{'echo':r['params']}}),flush=True)\n";
        let mut mcp=fake_request_runtime(script).await;
        for value in ["first","second"] {let result=mcp.request_with_timeout("tools/call",serde_json::json!({"value":value}),Duration::from_secs(3)).await.unwrap();assert_eq!(result["echo"]["value"],value);}
        mcp.reset().await;
    }
    #[tokio::test]
    async fn queued_command_deadline_does_not_reset_another_tasks_helper() {
        let alive=Arc::new(AtomicBool::new(true));let ui=Arc::new(gui::UiShared::new(alive.clone()));
        let folder=std::env::temp_dir().join(format!("elio-queue-test-{}",std::process::id()));
        let workspace=Arc::new(workspace::Workspace::new(Some(folder.to_str().unwrap())).unwrap());
        let state=AppState::new(broadcast::channel(16).0,alive.clone(),Arc::new(AtomicBool::new(false)),workspace,Arc::new("test".into()),Arc::new(preferences::PreferencesStore::load()),ui);
        let _owned=state.roblox_mcp.lock().await;
        let error=checkpoint_tool_bounded(&state,"roblox","","script_grep",serde_json::json!({}),Duration::from_millis(50)).await.unwrap_err();
        assert!(error.to_string().contains("deadline exceeded"));assert!(alive.load(Ordering::Relaxed));assert_eq!(state.mcp_in_flight.load(Ordering::Relaxed),0);
        assert_eq!(native_tool_timeout("addon__long",None),Duration::from_millis(640000));
        assert_eq!(native_tool_timeout("execute_luau",Some(20000)),Duration::from_secs(20));
        let _=std::fs::remove_dir_all(folder);
    }

    #[tokio::test]
    async fn occupied_port_reports_the_exact_endpoint() {
        let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = held.local_addr().unwrap();
        let error = bind_required(addr, Duration::from_millis(50)).await.unwrap_err().to_string();
        assert!(error.contains(&addr.to_string()), "{error}");
        assert!(error.contains("logs/agent.log"), "{error}");
    }

    #[tokio::test]
    async fn free_ports_bind_without_startup_recovery() {
        let listener=bind_required("127.0.0.1:0".parse().unwrap(),Duration::ZERO).await.unwrap();
        assert_ne!(listener.local_addr().unwrap().port(),0);
    }

    #[test]
    fn native_tcp_tables_find_only_local_listening_owners() {
        let network=u16::to_be(3000) as u32;
        let local=u32::from_ne_bytes([127,0,0,1]);
        assert_eq!(tcp_listener_owner(&[1,2,local,network,0,0,42],false,3000),Some(42));
        assert_eq!(tcp_listener_owner(&[1,5,local,network,0,0,42],false,3000),None);
        assert_eq!(tcp_listener_owner(&[1,2,local,network,0,0,42],false,3001),None);
        assert_eq!(tcp_listener_owner(&[1,2,u32::from_ne_bytes([10,0,0,1]),network,0,0,42],false,3000),None);
        assert_eq!(tcp_listener_owner(&[2,2,local,network,0,0,42],false,3000),None);
        let mut v6=vec![0u32;15];v6[0]=1;v6[6]=network;v6[13]=2;v6[14]=43;
        assert_eq!(tcp_listener_owner(&v6,true,3000),Some(43));
        v6[1]=u32::from_ne_bytes([0x20,1,0x0d,0xb8]);assert_eq!(tcp_listener_owner(&v6,true,3000),None);
    }

    #[cfg(windows)]
    #[test]
    fn windows_native_owner_lookup_matches_live_listener_and_image() {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        assert_eq!(port_owner_pid(listener.local_addr().unwrap().port()),Some(std::process::id()));
        let image=std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().to_ascii_lowercase();
        assert_eq!(process_image(std::process::id()),Some(image));
        if let Ok(v6)=std::net::TcpListener::bind("[::1]:0") {assert_eq!(port_owner_pid(v6.local_addr().unwrap().port()),Some(std::process::id()));}
    }

    #[tokio::test]
    async fn exiting_listener_is_retried_until_released() {
        let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = held.local_addr().unwrap();
        let release = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            drop(held);
        });
        let listener = bind_required(addr, Duration::from_secs(2)).await.unwrap();
        assert_eq!(listener.local_addr().unwrap(), addr);
        release.await.unwrap();
    }

    #[test]
    fn same_version_reuses_existing_background_instance() {
        assert!(should_reuse_running_version(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn older_version_is_replaced_instead_of_reused() {
        assert!(!should_reuse_running_version("1.18.58"));
        assert!(!should_reuse_running_version("0.0.1"));
    }



    #[test]
    fn reactor_resource_panics_are_recognised_but_other_panics_are_not() {
        assert!(is_reactor_resource_panic("panicked at tokio-1.53.1/src/runtime/io/driver.rs:196:23: unexpected error when polling the I/O driver: Os { code: 1450, kind: Uncategorized, message: \"OS Error 1450\" }"));
        assert!(is_reactor_resource_panic("called `Result::unwrap()` on an `Err` value: Os { code: 1450 }"));
        assert!(!is_reactor_resource_panic("index out of bounds: the len is 3 but the index is 5"));
    }

    #[test]
    fn stale_cleanup_targets_only_elio_images() {
        assert!(is_elio_image("elio.exe"));
        assert!(is_elio_image("elio-agent.exe"));
        assert!(!is_elio_image("python.exe"));
        assert!(!is_elio_image("RobloxStudioBeta.exe"));
    }
}

/// Windows can report ERROR_NO_SYSTEM_RESOURCES (1450) from the IOCP wait that
/// drives tokio's I/O reactor. Tokio treats any such error as fatal and panics
/// the reactor thread, which used to end in a modal "elio Agent crashed"
/// box and a dead bridge. It is transient resource pressure, so recover by
/// relaunching instead of showing a dialog.
fn is_reactor_resource_panic(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    lower.contains("polling the i/o driver")
        || lower.contains("code: 1450")
        || lower.contains("os error 1450")
        || lower.contains("no system resources")
}

const CRASH_RESTART_ENV: &str = "ELIO_CRASH_RESTARTS";
const CRASH_RESTART_LIMIT: u32 = 5;

/// Relaunch this executable with the same arguments. Bounded by an env counter
/// passed to the child so a persistent failure ends in the visible dialog
/// instead of an invisible restart loop. Returns true when a replacement started.
fn relaunch_after_crash() -> bool {
    let attempts = std::env::var(CRASH_RESTART_ENV).ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    if attempts >= CRASH_RESTART_LIMIT { return false; }
    let Ok(exe) = std::env::current_exe() else { return false; };
    let mut command = std::process::Command::new(exe);
    command.args(std::env::args_os().skip(1)).env(CRASH_RESTART_ENV, (attempts + 1).to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.spawn().is_ok()
}

fn main() {
    // A relaunched replacement waits briefly so the crashed process can release
    // its port and single-instance lock first.
    if std::env::var_os(CRASH_RESTART_ENV).is_some() {
        std::thread::sleep(std::time::Duration::from_millis(2500));
    }
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("{info}");
        eprintln!("elio Agent panic: {msg}");
        tracing::error!("elio Agent panic: {msg}");
        if is_reactor_resource_panic(&msg) {
            if relaunch_after_crash() {
                tracing::error!("I/O reactor failed with a transient system-resource error; relaunched elio");
                std::process::exit(0);
            }
        } else if std::thread::current().name().is_some_and(|name| name.starts_with("tokio-runtime-worker")) {
            // A panic inside a spawned task is contained by tokio. A modal
            // MessageBox on a runtime worker would stall that worker (and every
            // task queued on it), so it is logged without blocking.
            return;
        }
        #[cfg(windows)]
        win_alert("elio Agent crashed", &msg);
    }));
    if let Err(e) = start() {
        let msg = format!("{e:#}");
        #[cfg(windows)]
        win_alert("elio Agent failed to start", &msg);
        eprintln!("elio Agent failed to start: {msg}");
        std::process::exit(1);
    }
}

#[tokio::main]
async fn start() -> anyhow::Result<()> {
    let args = Arc::new(Args::parse());
    #[cfg(target_os="macos")]
    platform::prepare_application_path();
    #[cfg(target_os="macos")]
    platform::remember_installation_root();
    std::env::set_current_dir(platform::installation_root())?;
    let addr: SocketAddr = args.roblox_addr.parse().unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 3000)));
    anyhow::ensure!(addr.ip().is_loopback(), "The bridge must bind to a loopback address");
    let startup_guard = StartupGuard::acquire(addr)?;
    let mcp_alive = Arc::new(AtomicBool::new(false));
    let roblox_proc = Arc::new(AtomicBool::new(false));
    let pairing_key = Arc::new(security::load_key()?);
    let shared = Arc::new(gui::UiShared::new(mcp_alive.clone()));
    init_file_logger(Some(shared.clone()));
    info!("=== elio Rust Agent v{} start (pid={}) ===", env!("CARGO_PKG_VERSION"), std::process::id());
    let start = std::time::Instant::now();
    let (result_tx, _) = broadcast::channel::<ExecResult>(128);
    if !args.headless {
        if focus_existing(addr, pairing_key.as_str()).await {
            info!("existing same-version elio instance found — requested its desktop window and exiting launcher process");
            return Ok(());
        }
    }
    // Bind every required endpoint before announcing readiness. Reclaim only the
    // elio process holding that endpoint, never all similarly named launches.
    let listener = bind_required(addr, Duration::from_secs(8)).await?;
    let legacy_roblox = bind_required("127.0.0.1:17613".parse()?, Duration::from_secs(8)).await?;
    let legacy_local = bind_required("127.0.0.1:17615".parse()?, Duration::from_secs(8)).await?;
    let ws_override = env_first(&["ELIO_WORKSPACE_ROOT", "ROBLOXSCRIPT_WORKSPACE_ROOT"])
        .or_else(|| args.workspace.clone());
    let workspace = Arc::new(workspace::Workspace::new(ws_override.as_deref())?);
    let preferences = Arc::new(preferences::PreferencesStore::load());
    if env_first(&["ELIO_FULL_ACCESS", "ROBLOXSCRIPT_FULL_ACCESS"]).map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
        || preferences.snapshot().perm_mode == "full" {
        workspace.set_full_access(true);
    }
    shared.attach_workspace(workspace.root_display(), workspace.full_flag());
    shared.set_local_tools(&workspace::catalog(), workspace.ready());
    shared.log(&format!("elio-agent v{} — native bridge for roblox studio / local fs", env!("CARGO_PKG_VERSION")));
    shared.log(&format!("workspace: {}", workspace.root_display()));
    if workspace.full_access() { shared.log("FULL PC ACCESS enabled at boot (ELIO_FULL_ACCESS=1)"); }
    shared.log("listening: http://127.0.0.1:3000 · ws 17613 (roblox) · 17615 (agentscript)");
    shared.log("keys: [R] restart mcp · [C] clear console · [1-4] filter level");
    let state = AppState::new(
        result_tx,
        mcp_alive,
        roblox_proc.clone(),
        workspace,
        pairing_key,
        preferences.clone(),
        shared.clone(),
    );
    let (restart_tx, mut restart_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let rr_state = state.clone();
    tokio::spawn(async move {
        while let Some(()) = restart_rx.recv().await {
            info!("status window requested MCP restart — resetting helper then re-ensuring");
            {
                let mut mcp = rr_state.roblox_mcp.lock().await;
                mcp.reset().await;
            }
            match roblox_tools(&rr_state).await {
                Ok(_) => info!("MCP helper re-ensured after GUI restart"),
                Err(e) => tracing::warn!("MCP re-ensure after GUI restart failed: {e:#}"),
            }
        }
    });
    let ui_for_server = shared.clone();
    let ui_for_fatal = shared.clone();
    let shutdown_state = state.clone();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        if let Err(e) = run_server(state, addr, start, ui_for_server, ready_tx, listener, legacy_roblox, legacy_local).await {
            tracing::error!("{e:#}");
            ui_for_fatal.set_fatal(format!("{e:#}"));
        }
    });
    // Never create a functional-looking desktop before its API has bound.
    tokio::time::timeout(Duration::from_secs(15), ready_rx).await
        .map_err(|_| anyhow::anyhow!("The local bridge did not finish binding within 15 seconds"))?
        .map_err(|_| anyhow::anyhow!("The local bridge failed to bind; inspect the startup log for the port error"))?;
    if let Some(path)=&args.update_receipt { update_service::mark_ready(path)?; }
    drop(startup_guard);
    if args.headless {
        let quit_ui=shared.clone();tokio::spawn(async move{loop{tokio::time::sleep(Duration::from_millis(200)).await;if quit_ui.quit_requested.load(Ordering::Relaxed){std::process::exit(0);}}});
        let _ = server.await;
        Ok(())
    } else {
        #[cfg(any(windows, target_os = "macos"))]
        gui::RESTORE_WINDOW.store(args.background && args.restore_window, Ordering::Relaxed);
        match gui::run_gui(shared, restart_tx, preferences, addr, shutdown_state.pairing_key.as_str(), args.background) {
            Ok(()) => {
                info!("elio exit requested — killing MCP helper tree and exiting");
                shutdown_state.roblox_mcp.lock().await.reset().await;
                std::process::exit(0);
            }
            Err(e) => {
                tracing::error!("GUI unavailable ({e:#}) — continuing headless");
                #[cfg(windows)]
                win_alert(
                    "elio Agent",
                    &format!("The status window could not open ({e:#}).\nThe bridge is still running in the background (ports 3000 / 17613 / 17615)."),
                );
                let _ = server.await;
                Ok(())
            }
        }
    }
}

fn is_roblox_studio_process(name: &str) -> bool {
    name.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>()
        .to_ascii_lowercase().contains("robloxstudio")
}

#[test]
fn studio_process_names_allow_platform_spacing() {
    assert!(is_roblox_studio_process("RobloxStudioBeta.exe"));
    assert!(is_roblox_studio_process("Roblox Studio"));
    assert!(!is_roblox_studio_process("RobloxPlayerBeta.exe"));
}

async fn run_server(state: AppState, addr: SocketAddr, start: std::time::Instant, ui: Arc<gui::UiShared>, ready: tokio::sync::oneshot::Sender<()>, listener: tokio::net::TcpListener, legacy_roblox: tokio::net::TcpListener, legacy_local: tokio::net::TcpListener) -> anyhow::Result<()> {
    let update_check=state.updates.clone();
    tokio::spawn(async move { loop { if let Err(error)=update_check.check().await{tracing::warn!("Update check: {error}");}tokio::time::sleep(Duration::from_secs(4*60*60)).await; } });
    let watcher_state = state.clone();
    let watcher_ui = ui.clone();
    tokio::spawn(async move {
        let mut sys = sysinfo::System::new();
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::new());
        let has_roblox = sys.processes().values().any(|p| is_roblox_studio_process(&p.name().to_string_lossy()));
        watcher_ui.studio_running.store(has_roblox, Ordering::Relaxed);
        watcher_state.roblox_proc.store(has_roblox, Ordering::Relaxed);
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::new());
            let has_roblox = sys.processes().values().any(|p| is_roblox_studio_process(&p.name().to_string_lossy()));
            watcher_ui.studio_running.store(has_roblox, Ordering::Relaxed);
            watcher_state.roblox_proc.store(has_roblox, Ordering::Relaxed);
            // Process scans are advisory. Only a failed editor probe clears
            // a verified MCP connection; a scan can miss Studio on some hosts.
        }
    });
    let addon_state = state.clone();
    tokio::spawn(async move {
        let _ = refresh_addons(&addon_state).await;
    });
    let autoconnect_state = state.clone();
    tokio::spawn(async move {
        let mut previous_error = String::new();
        let mut misses: u32 = 0;
        loop {
            // Process discovery is advisory, including for the FIRST connection.
            // Start the helper at launch and retry discovery when Studio opens
            // later, even if the host cannot enumerate its process name.
            if autoconnect_state.mcp_in_flight.load(Ordering::Relaxed) == 0 {
                if let Ok(mut mcp) = autoconnect_state.roblox_mcp.try_lock() {
                    let connection = match tokio::time::timeout(Duration::from_secs(20), async {
                        let tools = mcp.list_tools().await?;
                        mcp.probe_studio().await?;
                        anyhow::Ok(tools)
                    }).await {
                        Ok(result) => result,
                        Err(_) => { mcp.reset().await; Err(anyhow::anyhow!("Studio auto-connect timed out; the local bridge is ready and will retry")) }
                    };
                    match connection {
                        Ok(tools) => {
                            autoconnect_state.studio_probe_misses.store(0, Ordering::Relaxed);
                            autoconnect_state.ui.set_roblox_tools(&tools, true);
                            if !autoconnect_state.roblox_editor_connected.load(Ordering::Relaxed) {
                                info!("Roblox Studio MCP connected automatically");
                            }
                            autoconnect_state.set_editor_connection(true, Some(&tools));
                            previous_error.clear();
                            misses = 0;
                        }
                        Err(error) => {
                            misses = misses.saturating_add(1);
                            let keep = autoconnect_state.studio_probe_result(&Err(anyhow::anyhow!("{error:#}")));
                            if !keep {
                                autoconnect_state.set_editor_connection(false, None);
                                autoconnect_state.ui.set_roblox_tools(&[], false);
                            }
                            let message = format!("{error:#}");
                            if message != previous_error {
                                tracing::warn!("Studio auto-connect: {message}");
                                previous_error = message;
                            }
                            if helper_is_dead(&error) { mcp.reset().await; }
                            if !autoconnect_state.roblox_editor_connected.load(Ordering::Relaxed)
                                && autoconnect_state.roblox_proc.load(Ordering::Relaxed)
                                && should_clear_competitors(misses) {
                                // Reset first so our own helper is gone and cannot be mistaken for a competitor.
                                mcp.reset().await;
                                let closed = close_competing_studio_helpers();
                                if !closed.is_empty() {
                                    tracing::warn!("Closed other Studio MCP connection(s) so elio can connect: {}", closed.join(", "));
                                    let _ = autoconnect_state.ui.desktop_events.send(serde_json::json!({"type":"studio_competitors_closed","closed":closed}));
                                }
                            }
                        }
                    }
                }
            }
            let retry = if autoconnect_state.roblox_editor_connected.load(Ordering::Relaxed) { 5000 }
                else if autoconnect_state.roblox_proc.load(Ordering::Relaxed) { 1000 } else { 5000 };
            tokio::time::sleep(Duration::from_millis(retry)).await;
        }
    });
    let s1 = state.clone();
    tokio::spawn(async move { if let Err(error) = run_legacy_ws(s1, legacy_roblox, "roblox").await { tracing::error!("Roblox socket stopped: {error:#}"); } });
    let s3 = state.clone();
    tokio::spawn(async move { if let Err(error) = run_legacy_ws(s3, legacy_local, "local").await { tracing::error!("AgentScript socket stopped: {error:#}"); } });
    let ws_root_display = state.workspace.root_display();
    let cors = CorsLayer::new().allow_origin(tower_http::cors::AllowOrigin::predicate(|origin, _| {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", origin.clone());
        security::allowed_origin(&headers) || matches!(origin.to_str().ok(),Some("null"|"https://www.figma.com"|"https://figma.com"))
    })).allow_methods([Method::GET, Method::POST, Method::OPTIONS]).allow_headers(Any).allow_private_network(true);
    let app = Router::new()
        .route("/", get(|| async { Json(serde_json::json!({"ok": true, "service": "elio-agent", "version": env!("CARGO_PKG_VERSION")})) }))
        .route("/api/pair", post(|| async { axum::http::StatusCode::FORBIDDEN }))
        .route("/api/connect", post(connect_handler))
        .route("/api/poll", get(poll_handler))
        .route("/api/push", post(push_handler))
        .route("/api/result", post(result_handler))
        .route("/api/disconnect", post(disconnect_handler))
        .route("/api/status", get(status_handler))
        .route("/api/updates/status", get(update_status_handler))
        .route("/api/updates/check", post(update_check_handler))
        .route("/api/updates/install", post(update_install_handler))
        .route("/desktop", get(desktop_handler))
        .route("/api/desktop/state", get(desktop_state_handler))
        .route("/api/desktop/preferences", post(desktop_preferences_handler))
        .route("/api/desktop/agent", post(desktop_agent_handler).layer(axum::extract::DefaultBodyLimit::max(18 * 1024 * 1024)))
        .route("/api/desktop/kill-studio", post(desktop_kill_studio_handler))
        .route("/api/desktop/browser-agent", post(browser_agent_handler))
        .route("/api/desktop/activity", post(|| async { Json(serde_json::json!({"ok":true})) }))
        .route("/api/desktop/agent-result", post(desktop_agent_result_handler))
        .route("/api/checkpoints", post(checkpoint_handler))
        .route("/api/toolkit", post(toolkit::post).layer(axum::extract::DefaultBodyLimit::max(64000)))
        .route("/api/blender", post(blender::post).layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024)))
        .route("/api/skills", post(skills::post).layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024)))
        .route("/api/explorer", post(explorer::post).layer(axum::extract::DefaultBodyLimit::max(3 * 1024 * 1024)))
        .route("/api/creations", post(creations::post).layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024)))
        .route("/api/templates", post(templates::post))
        .route("/api/templates/upload",post(templates::upload).layer(axum::extract::DefaultBodyLimit::max(64000)))
        .route("/api/templates/upload/:id",post(templates::upload_chunk).layer(axum::extract::DefaultBodyLimit::max(templates::CHUNK_SIZE)))
        .route("/api/templates/import", post(templates::import).layer(axum::extract::DefaultBodyLimit::max(templates::MAX_FILE)))
        .route("/api/stop", post(immediate_stop_handler))
        .route("/api/media/convert", post(media::post).layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024)))
        .route("/api/memory", get(memory::get).post(memory::post).layer(axum::extract::DefaultBodyLimit::max(4*1024*1024)))
        .route("/api/figma",post(figma::post).layer(axum::extract::DefaultBodyLimit::max(400_000)))
        .route("/api/vault",post(vault::post).layer(axum::extract::DefaultBodyLimit::max(6*1024*1024)))
        .route("/api/engram",post(engram::post).layer(axum::extract::DefaultBodyLimit::max(64000)))
        .route("/api/chat-history",get(chat_history::get).post(chat_history::post).layer(axum::extract::DefaultBodyLimit::max(6*1024*1024)))
        .route("/api/desktop/restart", post(desktop_restart_handler))
        .route("/api/desktop/clear-logs", post(desktop_clear_logs_handler))
        .route("/api/debug/browser-log", post(debug_browser_log_handler).layer(axum::extract::DefaultBodyLimit::max(debug_report::BODY_LIMIT)))
        .route("/api/debug/report", get(debug_report_handler))
        .route("/api/show", post(show_handler))
        .route("/api/shutdown", post(shutdown_handler))
        .route("/api/local-full", post(local_full_handler))
        .route("/api/preferences", get(preferences_get_handler).post(preferences_post_handler))
        .route("/api/tools/browser", post(browser_tools_handler))
        .route("/api/mcp/catalog", get(mcp_catalog_handler))
        .route("/api/mcp/toggle", post(mcp_toggle_handler))
        .route("/ws", get(ws_handler))
        .layer(axum::middleware::from_fn_with_state(state.updates.clone(), update_mutation_gate))
        .layer(axum::middleware::from_fn_with_state(state.pairing_key.clone(), security::require_pairing))
        .with_state(state)
        // Public shell contains no key; the native WebView injects credentials.
        // Register after pairing middleware; every API remains authenticated.
        .route("/figma-link",post(figma::plugin).layer(axum::extract::DefaultBodyLimit::max(1_600_000)))
        .route("/desktop-ui", get(desktop_shell_handler))
        .layer(cors);
    info!("elio bridge listening on http://{} (WS /ws)", addr);
    info!("Legacy WS on ws://127.0.0.1:17613 (roblox) and 17615 (AgentScript FS: {})", ws_root_display);
    info!("Boot completed in {}ms", start.elapsed().as_millis());
    let _ = ready.send(());
    axum::serve(listener, app).await?;
    Ok(())
}

async fn connect_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let client_id = req.get("client_id").and_then(|v| v.as_str()).unwrap_or("studio-1").to_string();
    let engine = req.get("engine").and_then(|v| v.as_str()).unwrap_or("roblox").to_string();
    let clients=if engine.to_lowercase()=="local"{&state.local_clients}else{&state.roblox_clients};
    if let Err(error)=resource_limits::register_client(clients,&client_id,&engine).await{return (axum::http::StatusCode::TOO_MANY_REQUESTS,Json(serde_json::json!({"ok":false,"error":error}))).into_response();}
    let editor_connected=if engine.to_lowercase()=="local"{state.workspace.ready()}else{state.roblox_editor_connected.load(Ordering::Relaxed)};
    Json(serde_json::json!({
        "ok": true,
        "bridge_registered": true,
        "editor_connected": editor_connected,
        "client_id": client_id,
    })).into_response()
}
async fn poll_handler(State(state): State<AppState>, Query(_q): Query<HashMap<String,String>>) -> impl IntoResponse {
    let queue = &state.roblox_queue;
    for _ in 0..50 {
        { let mut guard = queue.lock().await; if let Some(p) = guard.pop_front() { if safety::readonly(){let _=state.result_tx.send(ExecResult{id:p.id,ok:false,result:String::new(),error:Some("Read-only mode discarded a pending legacy command.".into())});continue;} return Json(serde_json::json!({"ok": true, "payload": p})).into_response(); } }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Json(serde_json::json!({"ok": true, "payload": null})).into_response()
}
async fn push_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let engine = req.get("engine").and_then(|v| v.as_str()).or(req.get("target").and_then(|v| v.as_str())).unwrap_or("roblox");
    let payload = if let Some(p) = req.get("payload") { serde_json::from_value::<Payload>(p.clone()).unwrap_or(Payload{id: format!("p-{}", chrono::Utc::now().timestamp_millis()), target: engine.to_string(), code: p.to_string(), language: "luau".into(), meta: p.clone()}) } else { Payload{id: req.get("id").and_then(|v| v.as_str()).unwrap_or(&format!("p-{}", chrono::Utc::now().timestamp_millis())).to_string(), target: engine.to_string(), code: req.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string(), language: req.get("language").and_then(|v| v.as_str()).unwrap_or("luau").to_string(), meta: req.clone()} };
    if let Err(error)=safety::check(&state.workspace,"roblox","execute_luau",&serde_json::json!({"code":payload.code})){return (axum::http::StatusCode::CONFLICT,Json(serde_json::json!({"ok":false,"error":error.to_string()}))).into_response();}
    let size=serde_json::to_vec(&payload).map_or(usize::MAX,|v|v.len());
    let id=payload.id.clone();
    if let Err(error)=state.roblox_queue.lock().await.push(payload,size){return (axum::http::StatusCode::TOO_MANY_REQUESTS,Json(serde_json::json!({"ok":false,"error":error}))).into_response();}
    Json(serde_json::json!({"ok": true, "queued": id})).into_response()
}
async fn result_handler(State(state): State<AppState>, Json(res): Json<ExecResult>) -> impl IntoResponse {
    let _ = state.result_tx.send(res);
    Json(serde_json::json!({"ok": true}))
}
async fn disconnect_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    if let Some(id) = req.get("client_id").and_then(|v| v.as_str()) {
        state.roblox_clients.write().await.remove(id);
        state.local_clients.write().await.remove(id);
    }
    Json(serde_json::json!({"ok": true}))
}

#[derive(serde::Deserialize)]
struct LocalFullReq { enabled: bool }
async fn local_full_handler(State(state): State<AppState>, Json(req): Json<LocalFullReq>) -> impl IntoResponse {
    state.workspace.set_full_access(req.enabled);
    info!("local_full set to {} via HTTP", req.enabled);
    Json(serde_json::json!({"ok": true, "local_full": req.enabled}))
}

async fn checkpoint_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> axum::response::Response {
    use axum::response::IntoResponse;
    let result: anyhow::Result<serde_json::Value> = async {
        if req["action"].as_str().unwrap_or("").starts_with("safety"){return safety::api(&req);}
        let mut journal = checkpoints::STORE.lock().await;
        let id = req["id"].as_str().unwrap_or("");
        match req["action"].as_str().unwrap_or("list") {
            "begin" => Ok(serde_json::json!({"ok":true,"id":journal.begin(&req)?})),
            "finish" => { journal.finish(id, req["complete"].as_bool().unwrap_or(false))?;
                let task=journal.task(id)?;
                if let Some(report)=shared_learning::report(&task.engine,&task.status,&task.learning){let id=id.to_owned();tokio::spawn(async move{let _=shared_learning::enqueue(&id,report).await;});}
                Ok(serde_json::json!({"ok":true})) },
            "context" => Ok(serde_json::json!({"ok":true,"project":journal.project(req["chat"].as_str().unwrap_or(""))})),
            "project" => {journal.set_project(&req)?;Ok(serde_json::json!({"ok":true}))},
            "protect" => {journal.protect(&req)?;Ok(serde_json::json!({"ok":true}))},
            "approve" => {journal.task_mut(id)?.approved=true;journal.save()?;Ok(serde_json::json!({"ok":true}))},
            "details" => Ok(serde_json::json!({"ok":true,"details":journal.details(id)?})),
            "revert-one" => {
                let path=req["path"].as_str().ok_or_else(||anyhow::anyhow!("Choose a file or script."))?;
                let task=journal.task(id)?.clone();
                if task.engine=="local"{journal.revert_file(&state.workspace,id,path)?;}
                else{
                    anyhow::ensure!(task.status!="working"&&task.status!="reverted","Wait for this task to finish.");
                    let snapshot=task.scripts.iter().find(|s|s.path==path&&s.studio_id==req["studio_id"]).ok_or_else(||anyhow::anyhow!("Script snapshot not found."))?;
                    anyhow::ensure!(snapshot.session==*checkpoints::SNAPSHOT_SESSION,"Studio snapshots cannot be restored after restarting the bridge.");
                    let out=roblox_tool(&state,"execute_luau",serde_json::json!({"code":checkpoints::script_restore(snapshot),"datamodel_type":"Edit","studio_id":snapshot.studio_id})).await?;
                    anyhow::ensure!(out.text.contains("ELIO_SCRIPT_RESTORED"),"Studio did not confirm restore: {}",out.text);
                    journal.task_mut(id)?.scripts.retain(|s|!(s.path==path&&s.studio_id==req["studio_id"]));
                    journal.warn(id,"An individual script was restored. Whole-task Studio undo is disabled because its history changed.");journal.save()?;
                }
                Ok(serde_json::json!({"ok":true}))
            },
            "revert" => {
                let task = journal.task(id)?.clone();
                anyhow::ensure!(task.status != "working" && task.status != "reverted" && task.warnings.is_empty(), "This checkpoint cannot be safely reverted.");
                if task.engine == "local" { journal.revert_files(&state.workspace,id)?; }
                else {
                    anyhow::ensure!(!task.waypoints.is_empty(), "No verified Studio undo checkpoints.");
                    let out=roblox_tool(&state,"execute_luau",serde_json::json!({"code":checkpoints::studio_revert(&task.waypoints),"datamodel_type":"Edit"})).await?;
                    anyhow::ensure!(out.text.contains("ELIO_TASK_REVERTED"), "Studio did not confirm task restore: {}",out.text);
                    journal.task_mut(id)?.status="reverted".into();journal.save()?;
                }
                Ok(serde_json::json!({"ok":true}))
            },
            "list" => Ok(serde_json::json!({"ok":true,"tasks":journal.summaries(),"protected":journal.protected,"project":journal.project(req["chat"].as_str().unwrap_or(""))})),
            _=>anyhow::bail!("Unknown checkpoint action."),
        }
    }.await;
    match result { Ok(value)=>Json(value).into_response(), Err(error)=>(axum::http::StatusCode::CONFLICT,Json(serde_json::json!({"ok":false,"error":error.to_string()}))).into_response() }
}

async fn immediate_stop_handler(State(state):State<AppState>,Json(req):Json<serde_json::Value>)->impl IntoResponse {
    let id=req["checkpoint_id"].as_str().unwrap_or("");
    let cancelled=!id.is_empty() && state.cancellation.cancel(id);
    Json(serde_json::json!({"ok":true,"cancelled":cancelled,"message":"Immediate Stop requested. External tools may retain partial effects."}))
}
fn native_tool_timeout(name: &str, requested: Option<u64>) -> Duration {
    Duration::from_millis(requested.unwrap_or(if name.contains("__") { 640000 } else { 120000 }).clamp(1000,640000))
}
async fn checkpoint_tool_bounded(state: &AppState, engine: &str, id: &str, name: &str, args: serde_json::Value, budget: Duration) -> anyhow::Result<McpOutput> {
    match tokio::time::timeout(budget, checkpoint_tool(state,engine,id,name,args)).await {
        Ok(result)=>result,
        Err(_)=> {
            // The timed-out future is dropped before this branch. Never wait for
            // or reset a helper currently owned by another task.
            if engine=="roblox" {
                if name.contains("__") {
                    if let Ok(mut addons)=state.addons.try_lock(){addons.reset_interrupted_tool(name).await;}
                } else if let Ok(mut mcp)=state.roblox_mcp.try_lock(){if mcp.request_pending{mcp.reset().await;}}
            }
            if !id.is_empty() {
                if let Ok(mut journal)=checkpoints::STORE.try_lock(){journal.warn(id,"A command exceeded its total deadline. Partial effects may remain; inspect before retrying. The command was not replayed.");let _=journal.save();}
            }
            anyhow::bail!("Command deadline exceeded after {} seconds. Partial effects may remain; inspect state before retrying. The command was not replayed.",budget.as_secs())
        }
    }
}
async fn checkpoint_tool(state: &AppState, engine: &str, id: &str, name: &str, args: serde_json::Value) -> anyhow::Result<McpOutput> {
    let _update_guard=state.updates.begin_tool()?;
    safety::check(&state.workspace,engine,name,&args)?;
    if id.is_empty(){return checkpoint_tool_inner(state,engine,id,name,args).await;}
    let mut cancellation=state.cancellation.register(id);
    anyhow::ensure!(!*cancellation.borrow(),"Task stopped before tool dispatch.");
    let result=tokio::select! {
        biased;
        _=cancellation.changed()=>None,
        result=checkpoint_tool_inner(state,engine,id,name,args)=>Some(result),
    };
    if let Some(result)=result{return result;}
    // Dropping the local command future kills only its owned shell tree.
    // Recycle the specific helper whose response stream was interrupted.
    if engine=="roblox" {
        if name.contains("__"){if let Ok(mut addons)=state.addons.try_lock(){addons.reset_interrupted_tool(name).await;}}else{if let Ok(mut mcp)=state.roblox_mcp.try_lock(){if mcp.request_pending{mcp.reset().await;}}}
    }
    let mut journal=checkpoints::STORE.lock().await;
    journal.warn(id,"Immediate Stop interrupted a tool. Partial changes or an uncertain external result may remain. Inspect state before retrying; automatic rollback is disabled.");let _=journal.save();
    anyhow::bail!("Immediate Stop interrupted the tool. Its result may be partial; inspect before retrying.")
}
async fn checkpoint_tool_inner(state: &AppState, engine: &str, id: &str, name: &str, mut args: serde_json::Value) -> anyhow::Result<McpOutput> {
    if id.is_empty() { return match engine { "local"=>workspace::dispatch(&state.workspace,name,args).await.map(|text|McpOutput{text,images:Vec::new()}).map_err(anyhow::Error::msg), "roblox"=>roblox_tool(state,name,args).await,_=>Err(anyhow::anyhow!("unknown engine")) }; }
    let mut journal=checkpoints::STORE.lock().await;
    anyhow::ensure!(journal.task(id)?.status=="working" && journal.task(id)?.engine==engine,"Checkpoint belongs to a different or finished task.");
    if engine=="local" {
        let paths=journal.prepare_files(&state.workspace,id,name,&args)?;
        let (result,success)=if name=="run_command" {
            match workspace::tool_run_command_observed(&state.workspace,&args).await {Ok((text,success))=>(Ok(McpOutput{text,images:Vec::new()}),success),Err(error)=>(Err(anyhow::Error::msg(error)),false)}
        }else{let result=workspace::dispatch(&state.workspace,name,args.clone()).await.map(|text|McpOutput{text,images:Vec::new()}).map_err(anyhow::Error::msg);let success=result.is_ok();(result,success)};
        let task=journal.task_mut(id)?;if task.learning.len()<101{task.learning.push(shared_learning::observation(name,&args,success));}
        journal.save()?;
        if let Err(error)=journal.commit_files(&state.workspace,id,&paths) { journal.warn(id,&format!("Checkpoint verification failed: {error}"));journal.task_mut(id)?.learning.push(shared_learning::observation("checkpoint_verification_failed",&serde_json::Value::Null,false));let _=journal.save(); }
        if success{let chat=journal.task(id)?.chat.clone();let project=journal.project(&chat);let scope=if project.is_empty(){format!("chat:{chat}")}else{format!("project:{project}")};if let Err(error)=vault::STORE.invalidate(&scope,"file",&paths){journal.warn(id,&format!("Memory dependency review could not be updated: {error}"));let _=journal.save();}}
        return result;
    }
    journal.step(id,name);
    let read_only = name.starts_with("get_") || name.starts_with("list_") || name.starts_with("search_") || name.starts_with("inspect_") || matches!(name,"script_read"|"script_grep"|"script_analysis"|"screen_capture");
    if !read_only {journal.check_protection(&state.workspace,id,engine,name,&args)?;}
    if read_only { return roblox_tool(state,name,args).await; }
    if name.contains("__") || args["datamodel_type"].as_str().map_or(false,|dm|dm!="Edit") {
        journal.warn(id,"This task includes an external server or runtime operation. Studio task revert is disabled.");journal.save()?;
        let result=roblox_tool(state,name,args).await;let _=journal.save();return result;
    }
    let source_path=if matches!(name,"multi_edit"|"script_set_source"){args["file_path"].as_str().or_else(||args["path"].as_str()).map(str::to_owned)}else{None};
    let mut script_before=None;
    if let Some(path)=&source_path{
        let mut params=serde_json::json!({"code":checkpoints::script_snapshot(path),"datamodel_type":"Edit"});if let Some(studio)=args.get("studio_id"){params["studio_id"]=studio.clone();}
        if let Ok(out)=roblox_tool(state,"execute_luau",params).await{if let Some(before)=checkpoints::parse_snapshot(&out.text){
            let studio=args.get("studio_id").filter(|v|!v.is_null()).cloned().or_else(||state.roblox_mcp.try_lock().ok().and_then(|m|m.studio_id.clone()));
            if let Some(studio)=studio{args["studio_id"]=studio.clone();script_before=Some((before,studio));}
        }}
    }
    let label=format!("elio {} {}",id,journal.task(id)?.steps.len());
    let studio_id = args.get("studio_id").filter(|id| !id.is_null()).cloned();
    let mark_args = |code: String| {
        let mut params = serde_json::json!({"code":code,"datamodel_type":"Edit"});
        if let Some(id) = &studio_id { params["studio_id"] = id.clone(); }
        params
    };
    let before=roblox_tool(state,"execute_luau",mark_args(checkpoints::studio_mark(&format!("Before {label}")))).await;
    if before.is_err() { journal.warn(id,"Studio could not establish an undo boundary. This task has no verified complete rollback."); }
    let outcome=roblox_tool(state,name,args).await;
    if let Some((before,studio))=script_before {
        let captured=roblox_tool(state,"execute_luau",mark_args(checkpoints::script_snapshot(before["path"].as_str().unwrap_or("")))).await;
        if let Ok(out)=captured{if let Some(after)=checkpoints::parse_snapshot(&out.text){if let Err(error)=journal.record_script(id,&before,&after,studio){journal.warn(id,&format!("Selective script snapshot unavailable: {error}"));}}}
    }
    let marked=roblox_tool(state,"execute_luau",mark_args(checkpoints::studio_mark(&label))).await;
    match marked {
        Ok(out)=> {
            let raw=out.text.trim();let parsed=serde_json::from_str::<serde_json::Value>(raw).ok().or_else(||{let a=raw.find('{')?;let z=raw.rfind('}')?;serde_json::from_str(&raw[a..=z]).ok()});
            if parsed.as_ref().map_or(false,|v|v["available"]==true && v["name"]==label) {journal.task_mut(id)?.waypoints.push(label);}
            else {journal.warn(id,"Studio did not expose the task's named undo waypoint. Automatic revert is disabled rather than undoing unrelated edits.");}
        },
        Err(_)=>journal.warn(id,"Studio checkpoint completion was not confirmed. Automatic revert is disabled."),
    }
    if outcome.is_err(){journal.warn(id,"A Studio mutation failed with an uncertain outcome. Check Studio before attempting a restore.");}
    if outcome.is_ok(){if let Some(path)=source_path{let chat=journal.task(id)?.chat.clone();let project=journal.project(&chat);let scope=if project.is_empty(){format!("chat:{chat}")}else{format!("project:{project}")};if let Err(error)=vault::STORE.invalidate(&scope,"studio",&[path]){journal.warn(id,&format!("Memory dependency review could not be updated: {error}"));}}}
    journal.save()?;outcome
}

async fn desktop_shell_handler() -> impl IntoResponse {
    let html = include_str!("desktop.html")
        .replace("__ELIO_I18N_CATALOG__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/i18n-catalog.js")))
        .replace("__ELIO_I18N__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/i18n.js")))
        .replace("__ELIO_SKILLS_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/skills-ui.js")))
        .replace("__ELIO_EXPLORER_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/explorer-ui.js")))
        .replace("__ELIO_MEDIA_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/media.js")))
        .replace("__ELIO_MEMORY_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/memory.js")))
        .replace("__ELIO_VAULT_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/vault-ui.js")))
        .replace("__ELIO_FIGMA_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/figma.js")))
        .replace("__ELIO_TOOLKIT_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/toolkit-ui.js")))
        .replace("__ELIO_TASK_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/task-center.js")))
        .replace("__ELIO_TEMPLATE_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/templates.js")))
        .replace("__ELIO_VERSION_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/version.js")))
        .replace("__ELIO_PAIRING_KEY__", "")
        .replace("__ELIO_VERSION__", env!("CARGO_PKG_VERSION"))
        .replace("__ELIO_DESKTOP_CHAT_CSS__", include_str!("../../desktop/chat.css"))
        .replace("__ELIO_CHAT_VIEW__", include_str!("../../core/chat-view.js"))
        .replace("__ELIO_SHELL_CSS__", include_str!("../../desktop/elio.css"))
        .replace("__ELIO_THEME_CSS__", include_str!("../../core/theme.css"))
        .replace("__ELIO_THEME_JS__", include_str!("../../core/theme.js"))
        .replace("__ELIO_DESKTOP_CHAT_JS__", include_str!("../../desktop/chat.js"));
    ([(axum::http::header::CACHE_CONTROL, "no-store")], Html(html))
}

async fn desktop_handler(State(state): State<AppState>) -> Html<String> {
    let html = include_str!("desktop.html")
        .replace("__ELIO_I18N_CATALOG__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/i18n-catalog.js")))
        .replace("__ELIO_I18N__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/i18n.js")))
        .replace("__ELIO_SKILLS_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/skills-ui.js")))
        .replace("__ELIO_EXPLORER_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/explorer-ui.js")))
        .replace("__ELIO_MEDIA_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/media.js")))
        .replace("__ELIO_MEMORY_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/memory.js")))
        .replace("__ELIO_VAULT_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/vault-ui.js")))
        .replace("__ELIO_FIGMA_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/figma.js")))
        .replace("__ELIO_TOOLKIT_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/toolkit-ui.js")))
        .replace("__ELIO_TASK_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/task-center.js")))
        .replace("__ELIO_TEMPLATE_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/templates.js")))
        .replace("__ELIO_VERSION_UI__", include_str!(concat!(env!("ELIO_EXTENSION_ROOT"), "/core/version.js")))
        .replace("__ELIO_PAIRING_KEY__", state.pairing_key.as_str())
        .replace("__ELIO_VERSION__", env!("CARGO_PKG_VERSION"))
        .replace("__ELIO_DESKTOP_CHAT_CSS__", include_str!("../../desktop/chat.css"))
        .replace("__ELIO_CHAT_VIEW__", include_str!("../../core/chat-view.js"))
        .replace("__ELIO_SHELL_CSS__", include_str!("../../desktop/elio.css"))
        .replace("__ELIO_THEME_CSS__", include_str!("../../core/theme.css"))
        .replace("__ELIO_THEME_JS__", include_str!("../../core/theme.js"))
        .replace("__ELIO_DESKTOP_CHAT_JS__", include_str!("../../desktop/chat.js"));
    Html(html)
}

async fn update_status_handler(State(state):State<AppState>)->impl IntoResponse {Json(serde_json::json!({"ok":true,"update":state.updates.snapshot()}))}
async fn update_check_handler(State(state):State<AppState>)->impl IntoResponse {
    let service=state.updates.clone();tokio::spawn(async move{let _=service.check().await;});
    Json(serde_json::json!({"ok":true,"update":state.updates.snapshot()}))
}
async fn update_install_handler(State(state):State<AppState>)->impl IntoResponse {
    let reason=if !cfg!(windows){Some("Установка доступна только на Windows x64.")}
        else if state.updates.installing.load(Ordering::SeqCst){Some("Обновление уже запущено.")}
        else if state.updates.browser_busy() || state.updates.active_tools.load(Ordering::SeqCst)>0 || state.mcp_in_flight.load(Ordering::Relaxed)>0 {Some("Завершите активную задачу перед обновлением.")}
        else if !state.roblox_queue.lock().await.is_empty(){Some("Дождитесь выполнения очереди Studio.")}
        else if state.updates.snapshot()["outdated"]!=true {Some("Нет проверенной новой версии. Нажмите «Проверить обновления».")}
        else{None};
    if let Some(error)=reason{return (axum::http::StatusCode::CONFLICT,Json(serde_json::json!({"ok":false,"error":error}))).into_response();}
    let service=state.updates.clone();let ui=state.ui.clone();
    tokio::spawn(async move{if let Err(error)=service.install(ui).await{tracing::warn!("Update install: {error:#}");}});
    Json(serde_json::json!({"ok":true,"message":"Запуск обновления принят. Следите за статусом."})).into_response()
}
async fn update_mutation_gate(State(service):State<Arc<update_service::Service>>,request:axum::extract::Request,next:axum::middleware::Next)->axum::response::Response {
    let allowed=matches!(request.uri().path(),"/api/pair"|"/api/updates/check"|"/api/updates/install"|"/api/desktop/browser-agent"|"/api/desktop/activity"|"/api/desktop/agent-result"|"/api/debug/browser-log"|"/api/stop"|"/api/result");
    if request.method()==axum::http::Method::POST && service.installing.load(Ordering::SeqCst) && !allowed {
        return (axum::http::StatusCode::CONFLICT,Json(serde_json::json!({"ok":false,"error":"Обновление выполняется. Новая задача не была запущена."}))).into_response();
    }
    next.run(request).await
}

async fn desktop_state_handler(State(state): State<AppState>) -> impl IntoResponse {
    let tools = state.ui.tools.lock().map(|value| value.clone()).unwrap_or_default();
    let servers = state.ui.servers.lock().map(|value| value.clone()).unwrap_or_default();
    let logs = state.ui.logs.lock()
        .map(|value| value.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let fatal = state.ui.fatal.lock().ok().and_then(|value| value.clone());
    Json(serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "bridge_connected": state.ui.extension_recent(),
        "studio_running": state.ui.studio_running.load(Ordering::Relaxed),
        "mcp_alive": state.ui.mcp_alive.load(Ordering::Relaxed),
        "workspace_ready": state.ui.workspace_ready.load(Ordering::Relaxed),
        "workspace_root": state.ui.workspace_root.lock().map(|value| value.clone()).unwrap_or_default(),
        "compatibility": compatibility::snapshot(),
        "blender_connected": blender::connected(),
        "roblox_connected": state.roblox_editor_connected.load(Ordering::Relaxed),
        "roblox_bridge_connected": state.roblox_clients.read().await.len() > 0,
        "local_bridge_connected": state.local_clients.read().await.len() > 0,
        "tools": tools,
        "servers": servers,
        "logs": logs,
        "fatal": fatal,
        "preferences": state.preferences.snapshot(),
        "browser_agent": state.ui.browser_agent_snapshot(),
        "update": state.updates.snapshot(),
    }))
}

async fn desktop_preferences_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    match state.preferences.patch(req) {
        Ok(prefs) => {
            state.workspace.set_full_access(prefs.perm_mode == "full");
            let _ = state.ui.desktop_events.send(serde_json::json!({"type":"desktop_preferences","preferences":prefs}));
            Json(serde_json::json!({"ok": true, "preferences": prefs})).into_response()
        }
        Err(error) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": error.to_string()})),
        ).into_response(),
    }
}

async fn desktop_kill_studio_handler(State(state): State<AppState>) -> impl IntoResponse {
    #[cfg(windows)]
    {
        // Emergency action: no MCP, workspace, or agent-loop locks are acquired.
        for image in ["RobloxStudioBeta.exe", "RobloxStudio.exe"] {
            let mut command = Command::new("taskkill");
            command.args(["/F", "/T", "/IM", image]);
            command.creation_flags(CREATE_NO_WINDOW);
            match command.output().await {
                Ok(output) if output.status.success() => info!("Force-closed {image} from desktop"),
                Ok(output) => {
                    let error = String::from_utf8_lossy(&output.stderr);
                    // Missing processes are already closed. Other failures must be visible.
                    if output.status.code() != Some(128) && !error.contains("not found") {
                        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"ok":false,"error":error.to_string()}))).into_response();
                    }
                }
                Err(error) => return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"ok":false,"error":error.to_string()}))).into_response(),
            }
        }
        state.roblox_proc.store(false, Ordering::Relaxed);
        state.set_editor_connection(false, None);
        state.ui.studio_running.store(false, Ordering::Relaxed);
        return Json(serde_json::json!({"ok":true})).into_response();
    }
    #[cfg(target_os = "macos")]
    {
        let system = sysinfo::System::new_all();
        let mut failed = false;
        for process in system.processes().values() {
            if process.exe().is_some_and(|path| path.ends_with("RobloxStudio.app/Contents/MacOS/RobloxStudio")) { failed |= !process.kill(); }
        }
        if failed { return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"ok":false,"error":"macOS did not allow closing a Studio process."}))).into_response(); }
        state.roblox_proc.store(false,Ordering::Relaxed);state.set_editor_connection(false, None);state.ui.studio_running.store(false,Ordering::Relaxed);
        Json(serde_json::json!({"ok":true})).into_response()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = state;
        (axum::http::StatusCode::NOT_IMPLEMENTED, Json(serde_json::json!({"ok":false,"error":"Force-closing Studio requires Windows or macOS."}))).into_response()
    }
}

async fn browser_agent_handler(State(state): State<AppState>, Json(value): Json<serde_json::Value>) -> impl IntoResponse {
    state.ui.mark_extension_seen();
    state.updates.note_browser(value["browser_id"].as_str().unwrap_or(""),value["any_running"]==true || value["canStop"]==true);
    let mut slot=state.ui.browser_agent.lock().unwrap_or_else(|error|error.into_inner());
    let replace=slot.as_ref().map_or(true,|(at,current)|at.elapsed()>Duration::from_secs(3) || (value["browser_focused"]==true && current["pinned"]!=true) || current["browser_id"]==value["browser_id"]);
    if replace {*slot=Some((std::time::Instant::now(),value));}
    Json(serde_json::json!({"ok":true}))
}

async fn desktop_agent_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let action = req.get("action").and_then(|value| value.as_str()).unwrap_or("");
    if action.starts_with("cowork-") || action.starts_with("memory-") || action=="handoff-export" || action=="budget-resume" || action=="task-send" || action=="creator-send" || action=="creator-insert" || action=="activity-read" || action=="chat-read" || action=="chat-pin" || action=="start" || action=="media-stage" || action=="stop" || action=="engine-set" { return desktop_cowork_handler(state, req).await; }
    let mut slot = state.ui.browser_agent.lock().unwrap_or_else(|error| error.into_inner());
    let available = slot.as_ref().filter(|(at, _)| at.elapsed() < Duration::from_secs(3));
    let key = match action { "start" => "canStart", "stop" => "canStop", "enhance" => "canEnhance", "cowork-queue" => "canQueue", "cowork-on" | "cowork-off" | "cowork-resume" | "cowork-remove" => "canCoWork", _ => "" };
    if matches!(action, "enhance" | "cowork-queue") && req.get("prompt").and_then(|value| value.as_str()).map(str::trim).unwrap_or("").is_empty() {
        return (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({"ok":false,"error":"Enter a prompt first."}))).into_response();
    }
    if let Some((_, control)) = available {
        if ["chat", "browser_id", "tab_id"].iter().any(|name| req.get(*name).is_some_and(|value| value != &control[*name])) {
            return (axum::http::StatusCode::CONFLICT, Json(serde_json::json!({"ok":false,"error":"The selected chat changed. Review the destination before retrying."}))).into_response();
        }
        if !key.is_empty() && control.get(key).and_then(|value| value.as_bool()) == Some(true) {
            let event = serde_json::json!({"type":"desktop_agent_action","action":action,"tab_id":control.get("tab_id"),"browser_id":control.get("browser_id"),"prompt":req.get("prompt"),"expected_chat":req.get("chat")});
            if state.ui.desktop_events.send(event).is_ok() {
                if let Some((_, control)) = slot.as_mut().filter(|_| !action.starts_with("cowork-")) {
                    control["canStart"] = false.into(); control["canStop"] = false.into(); control["canEnhance"] = false.into();
                    control["status"] = match action { "start" => "Starting…", "enhance" => "Enhancing your prompt…", _ => "Stopping…" }.into();
                }
                return Json(serde_json::json!({"ok":true})).into_response();
            }
        }
    }
    (axum::http::StatusCode::CONFLICT, Json(serde_json::json!({"ok":false,"error":"The selected AI chat is no longer ready for this action. Check the browser tab."}))).into_response()
}

async fn desktop_agent_result_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let id = req.get("request_id").and_then(|value| value.as_str()).unwrap_or("");
    if let Some((_,sender)) = state.ui.desktop_action_results.lock().unwrap_or_else(|error| error.into_inner()).remove(id) {
        let _ = sender.send(req.get("result").cloned().unwrap_or(serde_json::json!({"ok":false,"error":"Missing browser result."})));
    }
    Json(serde_json::json!({"ok":true}))
}

async fn desktop_cowork_handler(state: AppState, req: serde_json::Value) -> axum::response::Response {
    let action = req.get("action").and_then(|value| value.as_str()).unwrap_or("");
    let key = match action { "chat-read" => "canChatRead", "chat-pin" => "canChatPin", "start"=>"canStart", "stop"=>"canStop", "media-stage"=>"canMedia", "task-send"=>"canTaskSend", "creator-send"=>"canCreate", "creator-insert"=>"canTaskSend", "cowork-queue" => "canQueue", "memory-import" => "canEnhance", "memory-export" | "activity-read" | "handoff-export" | "budget-resume" | "engine-set" => "canCoWork", "cowork-on" | "cowork-off" | "cowork-resume" | "cowork-remove" => "canCoWork", _ => "" };
    let control = {
        let slot = state.ui.browser_agent.lock().unwrap_or_else(|error| error.into_inner());
        slot.as_ref().filter(|(at, control)| at.elapsed() < Duration::from_secs(3) && !key.is_empty() && control.get(key).and_then(|value| value.as_bool()) == Some(true)).map(|(_, control)| control.clone())
    };
    let Some(control) = control else { return (axum::http::StatusCode::CONFLICT, Json(serde_json::json!({"ok":false,"error":"Select a ready AI chat before sending. Follow-ups also require Co-work to be on."}))).into_response(); };
    if ["chat", "browser_id", "tab_id"].iter().any(|name| req.get(*name).is_some_and(|value| value != &control[*name])) {
        return (axum::http::StatusCode::CONFLICT, Json(serde_json::json!({"ok":false,"error":"The selected chat changed. Review the destination before retrying."}))).into_response();
    }
    let id = req.get("request_id").and_then(|value| value.as_str()).unwrap_or("");
    if id.is_empty() || id.len() > 128 { return (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({"ok":false,"error":"Missing request ID."}))).into_response(); }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let pending=match state.ui.reserve_desktop_action(id,sender){Ok(lease)=>lease,Err(error)=>return (axum::http::StatusCode::CONFLICT,Json(serde_json::json!({"ok":false,"error":error}))).into_response()};
    let event = serde_json::json!({"type":"desktop_agent_action","action":action,"tab_id":control.get("tab_id"),"browser_id":control.get("browser_id"),"prompt":req.get("prompt"),"request_id":id,"expected_chat":req.get("chat")});
    let delivered = state.ui.desktop_events.send(event).is_ok();
    let result = if delivered { tokio::time::timeout(Duration::from_secs(if action == "task-send" { 100 } else if action == "media-stage" { 60 } else if action == "creator-insert" { 125 } else if action == "creator-send" { 100 } else { 5 }), receiver).await.ok().and_then(Result::ok) } else { None };
    drop(pending);
    match result {
        Some(result) if result.get("ok").and_then(|value| value.as_bool()) == Some(true) => Json(result).into_response(),
        Some(result) => (axum::http::StatusCode::CONFLICT, Json(result)).into_response(),
        None => (axum::http::StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({"ok":false,"error":"The browser did not confirm this request. Your draft is kept; retrying it will not queue a duplicate."}))).into_response(),
    }
}

async fn desktop_restart_handler(State(state): State<AppState>) -> impl IntoResponse {
    {
        let mut mcp = state.roblox_mcp.lock().await;
        mcp.reset().await;
    }
    match roblox_tools(&state).await {
        Ok(tools) => Json(serde_json::json!({"ok": true, "tools": tools.len()})).into_response(),
        Err(error) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"ok": false, "error": error.to_string()})),
        ).into_response(),
    }
}

/// 1.22.0: browser-side errors, warnings, info and agent events for the debug report.
async fn debug_browser_log_handler(State(state): State<AppState>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    state.ui.mark_extension_seen();
    match debug_report::accept(&body) {
        Ok(stored) => Json(serde_json::json!({"ok": true, "stored": stored})).into_response(),
        Err(error) => (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({"ok": false, "error": error}))).into_response(),
    }
}

/// 1.22.0: Settings -> Copy debug report.
async fn debug_report_handler(State(state): State<AppState>) -> impl IntoResponse {
    let desktop_log = state.ui.logs.lock().map(|value| value.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
    let status = serde_json::json!({
        "bridge_connected": state.ui.extension_recent(),
        "studio_running": state.ui.studio_running.load(Ordering::Relaxed),
        "mcp_alive": state.ui.mcp_alive.load(Ordering::Relaxed),
        "roblox_connected": state.roblox_editor_connected.load(Ordering::Relaxed),
        "compatibility": compatibility::snapshot(),
        "blender_connected": blender::connected(),
        "workspace_ready": state.workspace.ready(),
        "mcp_busy": state.mcp_in_flight.load(Ordering::Relaxed) > 0,
    });
    let context = debug_report::Context { desktop_version: env!("CARGO_PKG_VERSION").to_string(), status, desktop_log };
    let report = tokio::task::spawn_blocking(move || debug_report::render(&context)).await.unwrap_or_else(|_| "# elio debug report\n\nThe report could not be built.\n".to_string());
    Json(serde_json::json!({"ok": true, "report": report}))
}

async fn desktop_clear_logs_handler(State(state): State<AppState>) -> impl IntoResponse {
    state.ui.clear_logs();
    Json(serde_json::json!({"ok": true}))
}

async fn show_handler(State(state): State<AppState>) -> impl IntoResponse {
    state.ui.request_show();
    Json(serde_json::json!({"ok": true, "visible": true}))
}

async fn shutdown_handler(State(state): State<AppState>) -> impl IntoResponse {
    state.ui.request_quit();
    Json(serde_json::json!({"ok": true, "shutting_down": true}))
}

async fn preferences_get_handler(State(state): State<AppState>) -> impl IntoResponse {
    state.ui.mark_extension_seen();
    let mut value = serde_json::to_value(state.preferences.snapshot()).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("_elioPersisted".to_string(), serde_json::Value::Bool(state.preferences.persisted()));
    }
    Json(value)
}

async fn preferences_post_handler(State(state): State<AppState>, Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    state.ui.mark_extension_seen();
    match state.preferences.patch(req) {
        Ok(prefs) => {
            state.workspace.set_full_access(prefs.perm_mode == "full");
            let _ = state.ui.desktop_events.send(serde_json::json!({"type":"desktop_preferences","preferences":prefs}));
            Json(serde_json::json!({"ok": true, "preferences": prefs})).into_response()
        }
        Err(error) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": error.to_string()})),
        ).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct BrowserToolsReq {
    #[serde(default)]
    tools: Vec<serde_json::Value>,
}

async fn browser_tools_handler(State(state): State<AppState>, Json(req): Json<BrowserToolsReq>) -> impl IntoResponse {
    state.ui.mark_extension_seen();
    state.ui.set_browser_tools(&req.tools);
    Json(serde_json::json!({"ok": true, "tools": req.tools.len()}))
}

async fn mcp_catalog_handler() -> impl IntoResponse {
    let cfg = mcp_addons::read_config();
    let entries: Vec<serde_json::Value> = mcp_addons::catalog().into_iter().map(|entry| {
        serde_json::json!({
            "id": entry.id,
            "name": entry.name,
            "description": entry.description,
            "command": entry.command,
            "args": entry.args,
            "enabled": cfg.servers.contains_key(entry.id),
        })
    }).collect();
    Json(serde_json::json!({"ok": true, "servers": entries}))
}

#[derive(serde::Deserialize)]
struct McpToggleReq { id: String, enabled: bool }

async fn mcp_toggle_handler(State(state): State<AppState>, Json(req): Json<McpToggleReq>) -> impl IntoResponse {
    match mcp_addons::set_catalog_enabled(&req.id, req.enabled) {
        Ok(()) => {
            // list_tools syncs only changed configuration without restarting peers.
            // Return before waiting on slow server startup or the manager lock.
            let refresh_state = state.clone();
            tokio::spawn(async move {
                let _ = refresh_addons(&refresh_state).await;
            });
            Json(serde_json::json!({"ok": true, "id": req.id, "enabled": req.enabled})).into_response()
        }
        Err(error) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": error.to_string()})),
        ).into_response(),
    }
}

async fn status_handler(State(state): State<AppState>, axum::extract::Query(query):axum::extract::Query<std::collections::HashMap<String,String>>) -> impl IntoResponse {
    compatibility::seen(&query);
    state.ui.mark_extension_seen();
    Json(serde_json::json!({
        "compatibility": compatibility::snapshot(),
        "blender_connected": blender::connected(),
        "roblox_connected": state.roblox_editor_connected.load(Ordering::Relaxed),
        "roblox_bridge_connected": state.roblox_clients.read().await.len() > 0,
        "local_bridge_connected": state.local_clients.read().await.len() > 0,
        "local_ready": state.workspace.ready(),
        "local_root": state.workspace.root_display(),
        "local_full": state.workspace.full_access(),
        "roblox_queue": state.roblox_queue.lock().await.len(),
        "roblox_proc": state.roblox_proc.load(Ordering::Relaxed),
        "mcp_busy": state.mcp_in_flight.load(Ordering::Relaxed) > 0,
    }))
}
async fn ws_handler(ws: axum::extract::ws::WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.protocols(["elio"]).on_upgrade(move |socket| handle_ws(socket, state))
}

/// 1.20.0: an empty get_studio_state text is not proof that Studio is gone
/// (newer Studio builds can answer with structured content only). Only an
/// explicit disconnection message counts.
fn studio_text_disconnected(text: &str) -> bool {
    text.contains("Unable to find an active Studio instance")
        || text.contains("previously active Studio has disconnected")
        || text.contains("no active Studio")
}
/// 1.20.0: one slow or failed probe no longer flips a live connection to
/// "MCP is off"; three consecutive misses (or a dead helper) are required.
const STUDIO_DROP_AFTER: u32 = 3;
fn studio_should_drop(was_connected: bool, misses: u32, helper_dead: bool) -> bool {
    !was_connected || helper_dead || misses >= STUDIO_DROP_AFTER
}
/// 1.21.0: another AI or bridge can hold Roblox Studio's MCP link with its
/// own StudioMCP helper, which leaves elio stuck on "MCP is off". Only
/// StudioMCP helpers that elio did not start are targeted; Studio itself,
/// the other app's main window and unrelated processes are never touched.
fn is_studio_mcp_helper(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower == "studiomcp.exe" || lower == "studiomcp"
}
fn competing_studio_helpers(procs: &[(u32, Option<u32>, String)], me: u32, include_orphans: bool) -> Vec<u32> {
    let parent_of: HashMap<u32, Option<u32>> = procs.iter().map(|(pid, parent, _)| (*pid, *parent)).collect();
    let mut out = Vec::new();
    for (pid, _, name) in procs {
        if *pid == me || !is_studio_mcp_helper(name) { continue; }
        let direct = parent_of.get(pid).copied().flatten();
        // Orphan = the process that started this helper is gone.
        let orphan = direct.map_or(true, |parent| !parent_of.contains_key(&parent));
        let (mut cursor, mut ours, mut hops) = (direct, false, 0);
        while let Some(parent) = cursor {
            if parent == me { ours = true; break; }
            hops += 1;
            if hops > 64 { break; }
            cursor = parent_of.get(&parent).copied().flatten();
        }
        if !ours && (!orphan || include_orphans) { out.push(*pid); }
    }
    out.sort_unstable();
    out
}
/// Clear competitors on the second consecutive miss, then at most every 30 misses.
fn should_clear_competitors(misses: u32) -> bool { misses == 2 || (misses > 2 && misses % 30 == 0) }
fn close_competing_studio_helpers() -> Vec<String> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::new());
    let procs: Vec<(u32, Option<u32>, String)> = sys.processes().values()
        .map(|p| (p.pid().as_u32(), p.parent().map(|x| x.as_u32()), p.name().to_string_lossy().into_owned())).collect();
    let mut closed = Vec::new();
    for pid in competing_studio_helpers(&procs, std::process::id(), true) {
        let Some(process) = sys.process(sysinfo::Pid::from_u32(pid)) else { continue; };
        let owner = process.parent().and_then(|ppid| sys.process(ppid)).map(|p| p.name().to_string_lossy().into_owned()).unwrap_or_else(|| "unknown app".into());
        if process.kill() {
            info!("closed competing Studio MCP helper pid {pid} (started by {owner})");
            closed.push(format!("{} (pid {pid}, from {owner})", process.name().to_string_lossy()));
        }
    }
    closed
}
/// A probe failure that proves the helper process is gone (not merely slow).
/// Timeouts are ordinary misses: Studio can be busy for a few seconds.
fn probe_failure_is_fatal(error: &anyhow::Error) -> bool {
    let msg = format!("{error:#}");
    msg.contains("exited") || msg.contains("stdin unavailable") || msg.contains("stdout unavailable") || msg.contains("spawn failed") || msg.contains("MCP response line exceeds its memory limit")
}
fn helper_is_dead(error: &anyhow::Error) -> bool {
    let msg = format!("{error:#}");
    msg.contains("exited") || msg.contains("timed out") || msg.contains("stdin unavailable")
        || msg.contains("stdout unavailable") || msg.contains("spawn failed") || msg.contains("MCP response line exceeds its memory limit")
}

struct InFlight<'a>(&'a AtomicUsize);
impl<'a> InFlight<'a> {
    fn enter(flag: &'a AtomicUsize) -> Self {
        flag.fetch_add(1, Ordering::Relaxed);
        InFlight(flag)
    }
}
impl Drop for InFlight<'_> {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); }
}

async fn roblox_tools(state: &AppState) -> anyhow::Result<Vec<serde_json::Value>> {
    let _busy = InFlight::enter(&state.mcp_in_flight);
    let mut primary = {
        let mut mcp = state.roblox_mcp.lock().await;
        match mcp.list_tools().await {
            Ok(tools) => tools,
            Err(error) => {
                if !helper_is_dead(&error) { return Err(error); }
                tracing::warn!("list_tools failed ({error:#}) — recycling helper once");
                mcp.reset().await;
                match mcp.list_tools().await {
                    Ok(tools) => tools,
                    Err(error2) => {
                        tracing::warn!("list_tools retry failed: {error2:#}");
                        if helper_is_dead(&error2) { mcp.reset().await; }
                        return Err(error2);
                    }
                }
            }
        }
    };

    state.ui.set_roblox_tools(&primary, true);
    let addon_tools = addon_snapshot(state).await;
    primary.extend(addon_tools);
    Ok(primary)
}

/// Add-on (Blender, Context7, ...) catalogue without letting slow servers stall
/// the Studio connection. Start-up of a server can take minutes (runtime
/// download, first npx run) while holding the manager lock, and the Studio
/// `list_tools` used to wait for all of it, so the browser's 8 s handshake gave
/// up and reported "not connected" even though Studio was. The refresh keeps
/// running in the background; callers wait a bounded time and otherwise get the
/// last known catalogue.
/// Starts/syncs every configured add-on and records the result for the UI and
/// the cache. May take a long time; never call it while holding other locks.
async fn refresh_addons(state: &AppState) -> Vec<serde_json::Value> {
    let (tools, servers) = state.addons.lock().await.list_tools().await;
    state.ui.set_addon_tools(&tools, servers.clone());
    if let Ok(mut cache) = state.addon_cache.lock() { *cache = (tools.clone(), servers); }
    ADDON_REFRESHED_AT_MS.store(now_ms(), Ordering::Release);
    tools
}

static ADDON_REFRESHED_AT_MS: AtomicU64 = AtomicU64::new(0);
const ADDON_CACHE_FRESH_MS: u64 = 30_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

async fn addon_snapshot(state: &AppState) -> Vec<serde_json::Value> {
    let cached = |state: &AppState| state.addon_cache.lock().map(|c| c.0.clone()).unwrap_or_default();
    // Startup asks for the catalogue several times within seconds. A recent, non-empty
    // catalogue is served immediately instead of re-polling every add-on each time.
    let fresh = cached(state);
    if !fresh.is_empty() && now_ms().saturating_sub(ADDON_REFRESHED_AT_MS.load(Ordering::Acquire)) < ADDON_CACHE_FRESH_MS {
        return fresh;
    }
    if state.addon_refreshing.swap(true, Ordering::AcqRel) {
        return cached(state);
    }
    let refresh_state = state.clone();
    let task = tokio::spawn(async move {
        let tools = refresh_addons(&refresh_state).await;
        refresh_state.addon_refreshing.store(false, Ordering::Release);
        tools
    });
    match tokio::time::timeout(Duration::from_millis(2500), task).await {
        Ok(Ok(tools)) => tools,
        _ => cached(state),
    }
}

async fn roblox_tool(state: &AppState, name: &str, args: serde_json::Value) -> anyhow::Result<McpOutput> {
    let _busy = InFlight::enter(&state.mcp_in_flight);
    if name.contains("__") {
        let (text, images) = state.addons.lock().await.call_tool(name, args).await?;
        return Ok(McpOutput { text, images });
    }
    let mut mcp = state.roblox_mcp.lock().await;
    match mcp.call_tool(name, args.clone()).await {
        Ok(result) => Ok(result),
        Err(error) => {
            if !helper_is_dead(&error) { return Err(error); }
            tracing::warn!("call_tool '{name}' failed ({error:#}) — recycling helper once");
            mcp.reset().await;
            let read_only=name.starts_with("get_") || name.starts_with("list_") || name.starts_with("search_") || name.starts_with("inspect_") || matches!(name,"script_read"|"script_grep"|"script_analysis"|"screen_capture");
            anyhow::ensure!(read_only,"Tool connection dropped with an uncertain result. The mutating command was not replayed. Inspect Studio state before retrying: {error}");
            match mcp.call_tool(name, args).await {
                Ok(result) => {
                    info!("call_tool '{name}' recovered after helper recycle");
                    Ok(result)
                }
                Err(error2) => {
                    tracing::warn!("call_tool '{name}' retry failed: {error2:#}");
                    if helper_is_dead(&error2) { mcp.reset().await; }
                    Err(error2)
                }
            }
        }
    }
}

async fn handle_ws(socket: axum::extract::ws::WebSocket, state: AppState) {
    let (mut send, mut recv) = socket.split();
    let mut rx = state.result_tx.subscribe();
    let send_task = tokio::spawn(async move { loop { match rx.recv().await {Ok(res)=>{let txt=serde_json::to_string(&res).unwrap_or_default();if !matches!(tokio::time::timeout(Duration::from_secs(10),send.send(axum::extract::ws::Message::Text(txt))).await,Ok(Ok(()))){break;}},Err(broadcast::error::RecvError::Lagged(_))=>continue,Err(_)=>break} } });
    while let Some(Ok(msg)) = recv.next().await {
        if let axum::extract::ws::Message::Text(txt) = msg {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&txt) {
                if val.get("code").is_some() && !state.updates.installing.load(Ordering::SeqCst) {
                    let engine = val.get("engine").and_then(|v| v.as_str()).unwrap_or("roblox").to_string();
                    let payload = Payload{ id: val.get("id").and_then(|v| v.as_str()).unwrap_or("p-1").to_string(), target: engine.clone(), code: val.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string(), language: "luau".into(), meta: val.clone()};
                    if let Err(error)=safety::check(&state.workspace,"roblox","execute_luau",&serde_json::json!({"code":payload.code})){let _=state.result_tx.send(ExecResult{id:payload.id,ok:false,result:String::new(),error:Some(error.to_string())});continue;}
                    let size=serde_json::to_vec(&payload).map_or(usize::MAX,|v|v.len());
                    let id=payload.id.clone();
                    if let Err(error)=state.roblox_queue.lock().await.push(payload,size){let _=state.result_tx.send(ExecResult{id,ok:false,result:String::new(),error:Some(error.into())});}
                }
            }
        }
    }
    send_task.abort();
}

async fn run_legacy_ws(state: AppState, listener: tokio::net::TcpListener, engine: &str) -> anyhow::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        let eng = engine.to_string();
        tokio::spawn(async move {
            let key = state.pairing_key.clone();
            let handshake = tokio_tungstenite::accept_hdr_async(stream, move |request: &tokio_tungstenite::tungstenite::handshake::server::Request, mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                if !security::authorized(request.headers(), &key) {
                    return Err(tokio_tungstenite::tungstenite::http::Response::builder()
                        .status(401).body(Some("elio pairing required".to_string())).unwrap());
                }
                response.headers_mut().insert("sec-websocket-protocol", "elio".parse().unwrap());
                Ok(response)
            });
            if let Ok(Ok(ws)) = tokio::time::timeout(Duration::from_secs(5), handshake).await {
                handle_legacy_ws(ws, state, eng).await;
            }
        });
    }
}

async fn handle_legacy_ws(ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>, state: AppState, engine: String) {
    static NEXT_CLIENT: AtomicUsize = AtomicUsize::new(1);
    let client_key = format!("ext-{engine}-{}", NEXT_CLIENT.fetch_add(1,Ordering::Relaxed));
    let clients=if engine=="local"{&state.local_clients}else{&state.roblox_clients};
    if resource_limits::register_client(clients,&client_key,&engine).await.is_err(){return;}
    state.ui.mark_extension_seen();
    info!("legacy WS [{engine}] client connected");
    let (mut write, mut read) = ws_stream.split();
    // Outbound channel so ping/status keep flowing while a tool runs on another task.
    let (out_tx, mut out_rx, mut closed_rx) = resource_limits::BridgeSender::channel(32,64*1024*1024);
    let mut desktop_rx = state.ui.desktop_events.subscribe();
    let desktop_tx = out_tx.clone();
    let desktop_forwarder = tokio::spawn(async move {
        loop {
            match desktop_rx.recv().await {
                Ok(event) => if desktop_tx.send(event.to_string()).is_err() { break; },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });
    let writer_closed=out_tx.clone();
    let writer = tokio::spawn(async move {
        while let Some(mut frame) = out_rx.recv().await {
            let message=tokio_tungstenite::tungstenite::Message::Text(std::mem::take(&mut frame.text).into());
            if !matches!(tokio::time::timeout(Duration::from_secs(10),write.send(message)).await,Ok(Ok(()))){break;}
        }
        writer_closed.close();
    });
    let send_json = |tx: &resource_limits::BridgeSender, v: serde_json::Value| {
        let _ = tx.send(v.to_string());
    };

    // A browser connection does not depend on slow MCP initialization.
    // 1.24.13: report the link the bridge already verified instead of a blanket
    // "studio:false, mcp_alive:false". A reconnecting browser tab (service-worker
    // wake, page reload) used to show "MCP is off" until the intro arrived, and the
    // false mcp_alive made the extension's auto-heal restart a working helper.
    let known_studio = engine == "roblox" && state.roblox_editor_connected.load(Ordering::Relaxed);
    send_json(&out_tx, serde_json::json!({"type":"connected","id":0,"ok":true,
        "mcp_alive":known_studio,"studio":known_studio,"studio_checking":engine != "local" && !known_studio,"tools":[],"servers":[]}));
    send_json(&out_tx, serde_json::json!({"type":"desktop_preferences","preferences":state.preferences.snapshot()}));
    let intro_state = state.clone();
    let intro_engine = engine.clone();
    let intro_tx = out_tx.clone();
    let intro_task = tokio::spawn(async move {
    let state = intro_state;
    let engine = intro_engine;
    let intro = tokio::time::timeout(Duration::from_secs(8), async {
        if engine == "local" {
            let ready = state.workspace.ready();
            let tools = workspace::catalog();
            serde_json::json!({"type":"connected","id":0,"ok":ready,"mcp_alive":ready,"studio":ready,"tools":tools,"servers":[{"id":"local","name":"Local Filesystem","alive":ready,"tools":if ready { tools.len() } else { 0 }}],"workspace_root":state.workspace.root_display()})
        } else {
            match roblox_tools(&state).await {
                Ok(tools) => {
                    let studio = {
                        let mut mcp = state.roblox_mcp.lock().await;
                        let probe = mcp.probe_studio().await;
                        state.studio_probe_result(&probe)
                    };
                    state.set_editor_connection(studio, Some(&tools));
                    serde_json::json!({"type":"connected","id":0,"ok":studio,"mcp_alive":true,"studio":studio,"tools":tools,"servers":[{"id":"roblox","name":"Roblox Studio MCP","alive":studio,"tools":if studio { tools.len() } else { 0 }}]})
                },
                Err(error) => {
                    // A still-verified link is not overwritten by one failed catalogue read.
                    if state.studio_probe_result(&Err(error)) { serde_json::Value::Null }
                    else { serde_json::json!({"type":"connected","id":0,"ok":false,"mcp_alive":false,"studio":false,"tools":[],"servers":[{"id":"roblox","name":"Roblox Studio MCP","alive":false,"tools":0}]}) }
                }
            }
        }
    })
    .await;
    // A slow probe must not be reported as "disconnected": the auto-connect loop
    // may already have verified Studio, and a stale `ok:false` frame arriving after
    // its status event used to overwrite it until the next heartbeat. Skip the
    // frame instead and let the verified state stand.
    if let Ok(intro) = intro { if !intro.is_null() { let _ = intro_tx.send(intro.to_string()); } }
    });
    let mut last_online: Option<bool> = None;
    loop {
        let msg=tokio::select!{_ = closed_rx.changed()=>break, message=read.next()=>match message{Some(Ok(message))=>message,_=>break}};
        if let tokio_tungstenite::tungstenite::Message::Text(txt) = msg {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&txt) {
                let typ = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let id = val.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                if state.updates.installing.load(Ordering::SeqCst) && !matches!(typ,"ping"|"studio_status"|"list_tools") {
                    send_json(&out_tx,serde_json::json!({"type":"result","id":id,"ok":false,"error":"Update in progress. No command was dispatched."}));continue;
                }
                match typ {
                    "ping" => { send_json(&out_tx, serde_json::json!({"type":"pong","id":id})); },
                    "list_tools" => {
                        let response = if engine == "local" {
                            let ready = state.workspace.ready();
                            let tools = workspace::catalog();
                            state.ui.set_local_tools(&tools, ready);
                            serde_json::json!({"type":"tools","id":id,"ok":ready,"mcp_alive":ready,"studio":ready,"tools":tools,"servers":[{"id":"local","name":"Local Filesystem","alive":ready,"tools":if ready { tools.len() } else { 0 }}]})
                        } else {
                            match roblox_tools(&state).await {
                                Ok(tools) => {
                                    let studio = if state.mcp_in_flight.load(Ordering::Relaxed) > 1 {
                                        // Another tool is in flight (list_tools itself holds 1). Skip extra probe.
                                        state.roblox_editor_connected.load(Ordering::Relaxed)
                                    } else {
                                        let mut mcp = state.roblox_mcp.lock().await;
                                        let probe = mcp.probe_studio().await;
                                        state.studio_probe_result(&probe)
                                    };
                                    state.set_editor_connection(studio, Some(&tools));
                                    serde_json::json!({"type":"tools","id":id,"ok":studio,"mcp_alive":true,"studio":studio,"tools":tools,"servers":[{"id":"roblox","name":"Roblox Studio MCP","alive":studio,"tools":if studio { tools.len() } else { 0 }}]})
                                },
                                Err(error) => {
                                    let message = error.to_string();
                                    if state.studio_probe_result(&Err(error)) {
                                        // Keep the verified link and the browser's cached catalogue (no "tools" key).
                                        serde_json::json!({"type":"tools","id":id,"ok":false,"mcp_alive":true,"studio":true,"error":message})
                                    } else {
                                        serde_json::json!({"type":"tools","id":id,"ok":false,"mcp_alive":false,"studio":false,"tools":[],"error":message})
                                    }
                                }
                            }
                        };
                        send_json(&out_tx, response);
                    },
                    "studio_status" => {
                        let online = match engine.as_str() {
                            "local" => state.workspace.ready(),
                            "roblox" => {
                                if state.mcp_in_flight.load(Ordering::Relaxed) > 0 {
                                    // Cached probe: a 20s execute_luau owns the helper.
                                    // Never lock / never mark MCP dead mid-tool.
                                    state.roblox_editor_connected.load(Ordering::Relaxed)
                                } else {
                                    let mut mcp = state.roblox_mcp.lock().await;
                                    let probe = mcp.probe_studio().await;
                                    state.studio_probe_result(&probe)
                                }
                            }
                            _ => false,
                        };
                        if engine == "roblox" {
                            state.set_editor_connection(online, None);
                        }
                        if last_online != Some(online) {
                            info!("studio_status [{engine}]: {}", if online { "CONNECTED" } else { "OFFLINE" });
                            last_online = Some(online);
                        }
                        send_json(&out_tx, serde_json::json!({"type":"studio_status","id":id,"studio":online,"studio_app":online,"studio_proc":state.roblox_proc.load(Ordering::Relaxed) || online}));
                    },
                    "restart_mcp" => {
                        let alive = if engine == "roblox" {
                            {
                                let mut mcp = state.roblox_mcp.lock().await;
                                mcp.reset().await;
                            }
                            state.set_editor_connection(false, None);
                            match roblox_tools(&state).await {
                                Ok(tools) => {
                                    let studio = {
                                        let mut mcp = state.roblox_mcp.lock().await;
                                        let probe = mcp.probe_studio().await;
                                        state.studio_probe_result(&probe)
                                    };
                                    state.set_editor_connection(studio, Some(&tools));
                                    send_json(&out_tx, serde_json::json!({"type":"mcp_status","id":id,"ok":true,"alive":true,"studio":studio,"tools":tools}));
                                    true
                                }
                                Err(error) => {
                                    tracing::warn!("restart_mcp re-ensure failed: {error:#}");
                                    send_json(&out_tx, serde_json::json!({"type":"mcp_status","id":id,"ok":false,"alive":false,"error":error.to_string()}));
                                    false
                                }
                            }
                        } else {
                            send_json(&out_tx, serde_json::json!({"type":"mcp_status","id":id,"ok":true,"alive":true}));
                            true
                        };
                        let _ = alive;
                    },
                    "call_tool" => {
                        let permit=match state.bridge_tool_slots.clone().try_acquire_owned(){Ok(permit)=>permit,Err(_)=>{send_json(&out_tx,serde_json::json!({"type":"tool_result","id":id,"ok":false,"kind":"busy","error":"Bridge tool capacity reached. No command was dispatched."}));continue;}};
                        let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                        let args = val.get("arguments").cloned().unwrap_or(serde_json::Value::Null);
                        let budget = native_tool_timeout(&name,val.get("timeout").and_then(|v|v.as_u64()));
                        let state2 = state.clone();
                        let eng = engine.clone();
                        let checkpoint_id = val.get("checkpoint_id").and_then(|v|v.as_str()).unwrap_or("").to_string();
                        let tx = out_tx.clone();
                        tokio::spawn(async move {
                            let _permit=permit;
                            let outcome = checkpoint_tool_bounded(&state2, &eng, &checkpoint_id, &name, args, budget).await;
                            let response = match outcome {
                                Ok(out) => {
                                    let mut frame = serde_json::json!({"type":"tool_result","id":id,"ok":true,"text":out.text});
                                    // Image blocks (Studio screenshots) ride along as
                                    // [{mimeType, data}] — the extension attaches them to
                                    // the model's next message. Omitted entirely when empty
                                    // so text-only results keep their exact old shape.
                                    if !out.images.is_empty() {
                                        frame["images"] = serde_json::Value::Array(out.images);
                                    }
                                    frame
                                }
                                Err(error) => serde_json::json!({"type":"tool_result","id":id,"ok":false,"kind":"execution","error":error.to_string()}),
                            };
                            let _ = tx.send(response.to_string());
                        });
                    },
                    "add_server" => {
                        let server_id = val.get("server_id").or_else(|| val.get("id")).and_then(|v| v.as_str()).unwrap_or("");
                        let command = val.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let args = val.get("args").and_then(|v| v.as_array()).map(|items| {
                            items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>()
                        }).unwrap_or_default();
                        let env = val.get("env").and_then(|v| v.as_object()).map(|items| {
                            items.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect::<HashMap<_, _>>()
                        }).unwrap_or_default();
                        let result = mcp_addons::add_server(server_id, mcp_addons::ServerSpec { command, args, env });
                        if result.is_ok() {
                            state.addons.lock().await.reset_all().await;
                        }
                        send_json(&out_tx, match result {
                            Ok(()) => serde_json::json!({"type":"server_changed","id":id,"ok":true,"server_id":server_id}),
                            Err(error) => serde_json::json!({"type":"server_changed","id":id,"ok":false,"error":error.to_string()}),
                        });
                    },
                    "remove_server" => {
                        let server_id = val.get("server_id").or_else(|| val.get("id")).and_then(|v| v.as_str()).unwrap_or("");
                        let result = mcp_addons::remove_server(server_id);
                        if result.is_ok() {
                            state.addons.lock().await.reset_all().await;
                        }
                        send_json(&out_tx, match result {
                            Ok(()) => serde_json::json!({"type":"server_changed","id":id,"ok":true,"server_id":server_id}),
                            Err(error) => serde_json::json!({"type":"server_changed","id":id,"ok":false,"error":error.to_string()}),
                        });
                    },
                    _ => { send_json(&out_tx, serde_json::json!({"type":"error","id":id,"error":"unknown bridge message type"})); }
                }
            }
        }
    }
    desktop_forwarder.abort();
    intro_task.abort();
    out_tx.close();
    writer.abort();
    let _ = writer.await;
    drop(out_tx);
    if engine == "local" {
        state.local_clients.write().await.remove(&client_key);
    } else {
        state.roblox_clients.write().await.remove(&client_key);
    }
    // Disconnecting a browser tab does not disconnect Studio's MCP server.
    info!("legacy WS [{engine}] client disconnected");
}

#[cfg(test)]
mod studio_detection_tests {
    use super::*;
    #[test]
    fn empty_state_text_is_not_disconnected() { assert!(!studio_text_disconnected("")); }
    #[test]
    fn explicit_disconnect_is_detected() { assert!(studio_text_disconnected("Unable to find an active Studio instance")); }
    #[test]
    fn slow_probes_are_misses_but_a_dead_helper_is_fatal() {
        assert!(!probe_failure_is_fatal(&anyhow::anyhow!("MCP request timed out: tools/call")));
        assert!(!probe_failure_is_fatal(&anyhow::anyhow!("Studio discovery timed out; the local bridge remains available")));
        assert!(!probe_failure_is_fatal(&anyhow::anyhow!("Roblox Studio is not connected")));
        assert!(probe_failure_is_fatal(&anyhow::anyhow!("StudioMCP exited with code 1")));
        assert!(probe_failure_is_fatal(&anyhow::anyhow!("spawn failed: not found")));
    }
    #[test]
    fn single_miss_keeps_live_connection() {
        assert!(!studio_should_drop(true, 1, false));
        assert!(!studio_should_drop(true, 2, false));
        assert!(studio_should_drop(true, 3, false));
        assert!(studio_should_drop(true, 1, true));
        assert!(studio_should_drop(false, 1, false));
    }
    #[test]
    fn only_foreign_studio_helpers_are_closed() {
        let me = 100;
        let procs = vec![
            (100, Some(1), "elio.exe".to_string()),
            (110, Some(100), "cmd.exe".to_string()),
            (111, Some(110), "StudioMCP.exe".to_string()),      // ours
            (200, Some(1), "Claude.exe".to_string()),
            (201, Some(200), "StudioMCP.exe".to_string()),      // other AI
            (300, Some(1), "RobloxStudioBeta.exe".to_string()), // Studio itself
            (400, Some(1), "notepad.exe".to_string()),
            (500, Some(999), "studiomcp".to_string()),          // orphan (parent gone)
        ];
        assert_eq!(competing_studio_helpers(&procs, me, false), vec![201]);
        assert_eq!(competing_studio_helpers(&procs, me, true), vec![201, 500]);
        assert!(!is_studio_mcp_helper("RobloxStudioBeta.exe"));
    }
    #[test]
    fn competitor_cleanup_is_rate_limited() {
        assert!(!should_clear_competitors(1));
        assert!(should_clear_competitors(2));
        assert!(!should_clear_competitors(3));
        assert!(should_clear_competitors(30));
    }
}
