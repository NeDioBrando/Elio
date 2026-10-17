use crate::{mcp_addons, preferences};
#[cfg(windows)]
#[path = "tray.rs"]
mod tray;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
pub static FOREGROUND: AtomicBool = AtomicBool::new(false);
// Whether the desktop window is shown (not hidden to tray or minimized). An
// automatic update relaunches an open window visibly, without taking focus.
pub static WINDOW_OPEN: AtomicBool = AtomicBool::new(false);
pub static RESTORE_WINDOW: AtomicBool = AtomicBool::new(false);
#[cfg(any(windows, target_os = "macos"))]
use std::time::{Duration, Instant};
#[cfg(any(windows, target_os = "macos"))]
use tao::dpi::LogicalSize;
#[cfg(any(windows, target_os = "macos"))]
use tao::event::{Event, WindowEvent};
#[cfg(any(windows, target_os = "macos"))]
use tao::event_loop::{ControlFlow, EventLoopBuilder};
#[cfg(any(windows, target_os = "macos"))]
use tao::platform::run_return::EventLoopExtRunReturn;
#[cfg(any(windows, target_os = "macos"))]
use tao::window::{Icon, WindowBuilder};
#[cfg(any(windows, target_os = "macos"))]
use wry::WebViewBuilder;

// Desktop launch actions are a fixed allowlist, matching extension providers.
fn toolkit_store_url(action:&str)->Option<String>{
    let value:serde_json::Value=serde_json::from_str(action.strip_prefix("toolkit-store:")?).ok()?;
    let query=value["query"].as_str()?.trim();if query.is_empty()||query.chars().count()>200{return None}
    let mut url=reqwest::Url::parse("https://create.roblox.com/store/models").ok()?;
    url.query_pairs_mut().append_pair("keyword",query);Some(url.to_string())
}

fn donation_url(action: &str) -> Option<&'static str> {
    match action {
        _ => None,
    }
}

fn supported_ai_url(action: &str) -> Option<&'static str> {
    match action {
        "open:clickup" => Some("https://app.clickup.com/"),
        "open:chatgpt" => Some("https://chatgpt.com/"),
        "open:deepseek" => Some("https://chat.deepseek.com/"),
        "open:claude" => Some("https://claude.ai/new"),
        "open:gemini" => Some("https://gemini.google.com/"),
        "open:kimi" => Some("https://www.kimi.com/"),
        "open:glm" => Some("https://chat.z.ai/"),
        "open:qwen" => Some("https://chat.qwen.ai/"),
        "open:arena" => Some("https://arena.ai/"),
        "open:freebuff" => Some("https://freebuff.ai/"),
        "open:crax" => Some("https://gpt.crax.lol/"),
        "open:useai" => Some("https://use.ai/"),
        "open:oxalpha" => Some("https://oxalpha.com/"),
        "open:vani" => Some("https://c.vani.ai/c"),
        "open:notion" => Some("https://www.notion.so/ai"),
        "open:ollama" => Some("https://ollama.com/"),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolDisplay {
    pub name: String,
    pub source: String,
    pub description: String,
    pub available: bool,
}

pub struct UiShared {
    pub studio_running: AtomicBool,
    pub mcp_alive: Arc<AtomicBool>,
    pub workspace_ready: AtomicBool,
    pub full_access: std::sync::RwLock<Arc<AtomicBool>>,
    pub workspace_root: Mutex<String>,
    pub fatal: Mutex<Option<String>>,
    pub logs: Mutex<VecDeque<String>>,
    pub extension_seen_ms: std::sync::atomic::AtomicU64,
    pub show_requested: AtomicBool,
    pub quit_requested: AtomicBool,
    pub tools: Mutex<Vec<ToolDisplay>>,
    pub servers: Mutex<Vec<mcp_addons::ServerSummary>>,
    pub desktop_events: tokio::sync::broadcast::Sender<serde_json::Value>,
    pub browser_agent: Mutex<Option<(std::time::Instant, serde_json::Value)>>,
    pub desktop_action_results: Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
}

const LOG_CAP: usize = 1200;

impl UiShared {
    pub fn new(mcp_alive: Arc<AtomicBool>) -> Self {
        Self {
            studio_running: AtomicBool::new(false),
            mcp_alive,
            workspace_ready: AtomicBool::new(false),
            full_access: std::sync::RwLock::new(Arc::new(AtomicBool::new(false))),
            workspace_root: Mutex::new(String::new()),
            fatal: Mutex::new(None),
            logs: Mutex::new(VecDeque::with_capacity(LOG_CAP)),
            extension_seen_ms: std::sync::atomic::AtomicU64::new(0),
            show_requested: AtomicBool::new(false),
            quit_requested: AtomicBool::new(false),
            tools: Mutex::new(Vec::new()),
            servers: Mutex::new(Vec::new()),
            desktop_events: tokio::sync::broadcast::channel(32).0,
            browser_agent: Mutex::new(None),
            desktop_action_results: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn browser_agent_snapshot(&self) -> serde_json::Value {
        let current = self.browser_agent.lock().unwrap_or_else(|error| error.into_inner());
        match current.as_ref() {
            Some((at, value)) if at.elapsed() < std::time::Duration::from_secs(3) => value.clone(),
            _ => serde_json::json!({"canStart":false,"canStop":false,"status":"Select a supported AI chat in your browser."}),
        }
    }

    pub fn attach_workspace(&self, root: String, full_flag: Arc<AtomicBool>) {
        if let Ok(mut value) = self.workspace_root.lock() {
            *value = root;
        }
        self.workspace_ready.store(true, Ordering::Relaxed);
        let current = self.full_access.read()
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false);
        full_flag.store(current, Ordering::Relaxed);
        if let Ok(mut slot) = self.full_access.write() {
            *slot = full_flag;
        }
    }

    pub fn log(&self, chunk: &str) {
        let mut logs = self.logs.lock().unwrap_or_else(|error| error.into_inner());
        for line in chunk.lines() {
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                continue;
            }
            if logs.len() == LOG_CAP {
                logs.pop_front();
            }
            logs.push_back(trimmed.to_string());
        }
    }

    pub fn clear_logs(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }

    pub fn mark_extension_seen(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.extension_seen_ms.store(now, Ordering::Relaxed);
    }

    pub fn extension_recent(&self) -> bool {
        let seen = self.extension_seen_ms.load(Ordering::Relaxed);
        if seen == 0 {
            return false;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        now.saturating_sub(seen) < 15_000
    }

    pub fn request_show(&self) {
        self.show_requested.store(true, Ordering::Relaxed);
    }

    pub fn request_quit(&self) {
        self.quit_requested.store(true, Ordering::Relaxed);
    }

    pub fn set_fatal(&self, msg: String) {
        let mut fatal = self.fatal.lock().unwrap_or_else(|error| error.into_inner());
        if fatal.is_none() {
            *fatal = Some(msg);
        }
    }

    fn replace_source_tools(&self, source: &str, tools: &[serde_json::Value], available: bool) {
        if let Ok(mut rows) = self.tools.lock() {
            rows.retain(|row| row.source != source);
            rows.extend(tools.iter().filter_map(|tool| {
                tool.get("name").and_then(|value| value.as_str()).map(|name| ToolDisplay {
                    name: name.to_string(),
                    source: source.to_string(),
                    description: tool.get("description").and_then(|value| value.as_str()).unwrap_or("").to_string(),
                    available,
                })
            }));
            rows.sort_by(|left, right| left.source.cmp(&right.source).then_with(|| left.name.cmp(&right.name)));
            rows.dedup_by(|left, right| left.source == right.source && left.name == right.name);
        }
    }

    pub fn set_roblox_tools(&self, tools: &[serde_json::Value], available: bool) {
        self.replace_source_tools("Roblox Studio", tools, available);
    }

    pub fn set_local_tools(&self, tools: &[serde_json::Value], available: bool) {
        self.replace_source_tools("AgentScript", tools, available);
    }

    pub fn set_addon_tools(&self, tools: &[serde_json::Value], servers: Vec<mcp_addons::ServerSummary>) {
        if let Ok(mut rows) = self.tools.lock() {
            rows.retain(|row| !row.source.starts_with("MCP / "));
            for tool in tools {
                let Some(name) = tool.get("name").and_then(|value| value.as_str()) else { continue; };
                let server = tool.get("server").and_then(|value| value.as_str())
                    .or_else(|| name.split_once("__").map(|parts| parts.0))
                    .unwrap_or("addon");
                rows.push(ToolDisplay {
                    name: name.to_string(),
                    source: format!("MCP / {server}"),
                    description: tool.get("description").and_then(|value| value.as_str()).unwrap_or("").to_string(),
                    available: true,
                });
            }
            rows.sort_by(|left, right| left.source.cmp(&right.source).then_with(|| left.name.cmp(&right.name)));
            rows.dedup_by(|left, right| left.source == right.source && left.name == right.name);
        }
        if let Ok(mut current) = self.servers.lock() {
            *current = servers;
        }
    }

    pub fn set_browser_tools(&self, tools: &[serde_json::Value]) {
        if let Ok(mut rows) = self.tools.lock() {
            rows.retain(|row| !row.source.starts_with("synerixcode"));
            for tool in tools {
                let Some(name) = tool.get("name").and_then(|value| value.as_str()) else { continue; };
                let source = tool.get("source").and_then(|value| value.as_str()).unwrap_or("synerixcode");
                rows.push(ToolDisplay {
                    name: name.to_string(),
                    source: source.to_string(),
                    description: tool.get("description").and_then(|value| value.as_str()).unwrap_or("").to_string(),
                    available: true,
                });
            }
            rows.sort_by(|left, right| left.source.cmp(&right.source).then_with(|| left.name.cmp(&right.name)));
            rows.dedup_by(|left, right| left.source == right.source && left.name == right.name);
        }
    }
}

#[cfg(any(windows, target_os = "macos"))]
#[derive(Clone, Debug)]
enum UiEvent {
    Hide,
    Quit,
    Minimize,
    Maximize,
    Drag,
    Ready,
    JsError(String),
    OpenExternal(String),
}

#[cfg(any(windows, target_os = "macos"))]
fn window_icon() -> anyhow::Result<Icon> {
    let pixels = image::load_from_memory(include_bytes!("../assets/synerixcode.png"))?.into_rgba8();
    let (width, height) = pixels.dimensions();
    Icon::from_rgba(pixels.into_raw(), width, height)
        .map_err(|error| anyhow::anyhow!("invalid synerixcode window icon: {error}"))
}

#[cfg(any(windows, target_os = "macos"))]
pub fn run_gui(
    shared: Arc<UiShared>,
    _restart_tx: tokio::sync::mpsc::UnboundedSender<()>,
    _preferences: Arc<preferences::PreferencesStore>,
    addr: std::net::SocketAddr,
    pairing_key: &str,
    start_background: bool,
) -> anyhow::Result<()> {
    let desktop_url = format!("http://{addr}/desktop-ui");
    let boot = serde_json::json!({"key":pairing_key,"apiUrl":format!("http://{addr}")});
    let initialization = format!("if(location.href === {}) window.__SYNERIXCODE_BOOT__ = {};",
        serde_json::to_string(&desktop_url)?, boot);

    let mut event_loop = EventLoopBuilder::<UiEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title(format!("synerixcode {}", env!("CARGO_PKG_VERSION")))
        .with_decorations(cfg!(target_os = "macos"))
        .with_visible(false)
        .with_focused(!start_background)
        .with_resizable(true)
        .with_inner_size(LogicalSize::new(1460.0, 900.0))
        .with_min_inner_size(LogicalSize::new(900.0, 620.0))
        .with_window_icon(Some(window_icon()?))
        .build(&event_loop)
        .map_err(|error| anyhow::anyhow!("cannot create synerixcode window: {error}"))?;

    let proxy = event_loop.create_proxy();
    let ipc_proxy = proxy.clone();
    let allowed_url = desktop_url.clone();
    let _webview = WebViewBuilder::new()
        .with_focused(!start_background)
        .with_initialization_script(initialization)
        .with_navigation_handler(move |url| url == allowed_url)
        .with_url(&desktop_url)
        .with_ipc_handler(move |request| {
            let body = request.body().as_str();
            let event = match body {
                "hide" => Some(UiEvent::Hide),
                "quit" => Some(UiEvent::Quit),
                "minimize" => Some(UiEvent::Minimize),
                "maximize" => Some(UiEvent::Maximize),
                "drag" => Some(UiEvent::Drag),
                "ui-ready" => Some(UiEvent::Ready),
                "open:github" => Some(UiEvent::OpenExternal("https://github.com/stoveez/PlazCode".to_owned())),
                "open:blender-guide" => Some(UiEvent::OpenExternal("https://github.com/ahujasid/blender-mcp#installation".to_owned())),
                _ if body.starts_with("toolkit-store:") => toolkit_store_url(body).map(UiEvent::OpenExternal),
                _ => donation_url(body).or_else(|| supported_ai_url(body)).map(|url|UiEvent::OpenExternal(url.to_owned())).or_else(|| body.strip_prefix("js-error:").map(|message| UiEvent::JsError(message.to_string()))),
            };
            if let Some(event) = event {
                let _ = ipc_proxy.send_event(event);
            }
        })
        .with_devtools(cfg!(debug_assertions))
        .build(&window)
        .map_err(|error| anyhow::anyhow!("cannot create synerixcode WebView: {error}"))?;

    #[cfg(windows)]
    let mut tray = tray::Tray::new(&window, shared.clone());
    if !start_background { window.set_visible(true); window.set_focus(); }
    else {
        #[cfg(windows)] {
            use tao::platform::windows::WindowExtWindows;
            #[link(name = "user32")]
            unsafe extern "system" { fn ShowWindow(window: *mut std::ffi::c_void, command: i32) -> i32; }
            let _ = tray.ensure_registered();
            // SW_SHOWMINNOACTIVE keeps the restarted app in the taskbar without
            // bringing it in front of the current application.
            // SW_SHOWNOACTIVATE (4) restores a window that was open before the
            // update without stealing focus from the current application.
            let command = if RESTORE_WINDOW.load(Ordering::Relaxed) { 4 } else { 7 };
            unsafe { ShowWindow(window.hwnd() as *mut std::ffi::c_void, command); }
        }
        #[cfg(target_os = "macos")] { window.set_visible(true); window.set_minimized(!RESTORE_WINDOW.load(Ordering::Relaxed)); }
        if RESTORE_WINDOW.load(Ordering::Relaxed) { shared.log("Desktop started with its window open, without taking focus."); }
        else { shared.log("Desktop started minimized without taking focus; reopen it from the taskbar, Dock or tray."); }
    }

    #[cfg(target_os = "macos")]
    let mut background_visibility_pending = start_background;
    let mut last_tick = Instant::now();
    event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(100));

        match event {
            Event::WindowEvent { event: WindowEvent::Focused(focused), .. } => { FOREGROUND.store(focused, Ordering::Relaxed); },
            Event::UserEvent(UiEvent::Hide) => {
                #[cfg(windows)]
                if tray.ensure_registered() { window.set_visible(false); } else { window.set_minimized(true); }
                #[cfg(target_os = "macos")]
                window.set_minimized(true);
            },
            Event::UserEvent(UiEvent::Quit) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UiEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UiEvent::Maximize) => window.set_maximized(!window.is_maximized()),
            Event::UserEvent(UiEvent::Drag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UiEvent::OpenExternal(url)) => {
                #[cfg(windows)]
                let opened = {
                    use std::os::windows::process::CommandExt;
                    std::process::Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(url).creation_flags(0x0800_0000).spawn()
                };
                #[cfg(target_os = "macos")]
                let opened = std::process::Command::new("/usr/bin/open").arg(url).spawn();
                if let Err(error) = opened { shared.log(&format!("Could not open browser: {error}")); }
            }
            Event::UserEvent(UiEvent::Ready) => {
                // Cocoa can show a window during launch. Apply the requested
                // minimized/restored state after the first loaded UI, once only.
                #[cfg(target_os = "macos")]
                if background_visibility_pending {
                    window.set_minimized(!RESTORE_WINDOW.load(Ordering::Relaxed));
                    background_visibility_pending = false;
                }
                shared.log("desktop WebView UI ready");

            }
            Event::UserEvent(UiEvent::JsError(message)) => {
                let line = format!("ERROR desktop WebView JavaScript: {message}");
                shared.log(&line);
                shared.set_fatal(line);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                #[cfg(windows)]
                if tray.ensure_registered() {
                    window.set_visible(false);
                    shared.log("desktop window hidden — reopen synerixcode from its tray icon");
                } else {
                    window.set_minimized(true);
                    shared.log("Tray icon unavailable; synerixcode stays accessible in the taskbar.");
                }
                #[cfg(target_os = "macos")]
                { window.set_minimized(true); shared.log("synerixcode minimized — reopen from the Dock or launch synerixcode again."); }
            }
            Event::MainEventsCleared => {
                if last_tick.elapsed() >= Duration::from_millis(100) {
                    last_tick = Instant::now();
                    WINDOW_OPEN.store(window.is_visible() && !window.is_minimized(), Ordering::Relaxed);
                    if shared.show_requested.swap(false, Ordering::Relaxed) {
                        window.set_visible(true);
                        window.set_minimized(false);
                        window.set_focus();
                    }
                    if shared.quit_requested.swap(false, Ordering::Relaxed) {
                        *control_flow = ControlFlow::Exit;
                    }
                }
            }
            _ => {}
        }
    });

    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn run_gui(
    _shared: Arc<UiShared>,
    _restart_tx: tokio::sync::mpsc::UnboundedSender<()>,
    _preferences: Arc<preferences::PreferencesStore>,
    addr: std::net::SocketAddr,
    pairing_key: &str,
    start_background: bool,
) -> anyhow::Result<()> {
    let _ = (addr, pairing_key, start_background);
    anyhow::bail!("synerixcode desktop UI currently requires Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn toolkit_store_search_uses_fixed_origin(){
        let url=toolkit_store_url(r#"toolkit-store:{"query":"tree & castle"}"#).unwrap();
        assert!(url.starts_with("https://create.roblox.com/store/models?"));assert!(url.contains("tree+%26+castle"));
        assert!(toolkit_store_url("open:https://example.com").is_none());
    }
    #[test] fn donation_links_are_fixed_and_match_desktop_anchors() {
        let html=include_str!("desktop.html");
        assert_eq!(donation_url("open:https://example.com"),None);
    }

    #[test] fn supported_ai_links_are_fixed_and_match_desktop_buttons() {
        let html=include_str!("desktop.html");
        let actions=["clickup","chatgpt","deepseek","claude","gemini","kimi","glm","qwen","arena","freebuff","crax","useai","oxalpha","vani","notion","ollama"];
        for name in actions {
            let action=format!("open:{name}");let url=supported_ai_url(&action).expect("missing supported AI action");
            assert!(url.starts_with("https://"));assert!(html.contains(&format!("data-ipc=\"{action}\"")));
        }
        assert_eq!(supported_ai_url("open:https://example.com"),None);assert_eq!(supported_ai_url("open:unknown"),None);
    }

    fn names(rows: &[ToolDisplay]) -> Vec<(String, String)> {
        rows.iter().map(|row| (row.name.clone(), row.source.clone())).collect()
    }

    #[test]
    fn tool_catalog_merges_all_sources() {
        let shared = UiShared::new(Arc::new(AtomicBool::new(false)));

        shared.set_roblox_tools(
            &[serde_json::json!({"name":"execute_luau"})],
            true,
        );
        shared.set_local_tools(
            &[serde_json::json!({"name":"read_file"})],
            true,
        );
        shared.set_addon_tools(
            &[serde_json::json!({"name":"memory__search","server":"memory"})],
            Vec::new(),
        );
        shared.set_browser_tools(
            &[
                serde_json::json!({"name":"web_search","source":"synerixcode"}),
                serde_json::json!({"name":"animation_create","source":"synerixcode / Motion"}),
            ],
        );

        let rows = shared.tools.lock().expect("tool lock").clone();
        let values = names(&rows);
        assert!(values.contains(&("execute_luau".to_string(), "Roblox Studio".to_string())));
        assert!(values.contains(&("read_file".to_string(), "AgentScript".to_string())));
        assert!(values.contains(&("memory__search".to_string(), "MCP / memory".to_string())));
        assert!(values.contains(&("web_search".to_string(), "synerixcode".to_string())));
        assert!(values.contains(&("animation_create".to_string(), "synerixcode / Motion".to_string())));
    }

    #[test]
    fn tool_descriptions_survive_all_sources() {
        let shared = UiShared::new(Arc::new(AtomicBool::new(false)));
        shared.set_roblox_tools(&[serde_json::json!({"name":"execute_luau","description":"Run Luau"})], true);
        shared.set_local_tools(&[serde_json::json!({"name":"create_folder","description":"Create a folder"})], true);
        shared.set_addon_tools(&[serde_json::json!({"name":"memory__search","description":"Search memory"})], vec![]);
        shared.set_browser_tools(&[serde_json::json!({"name":"web_search","description":"Search the web"}), serde_json::json!({"name":"unknown"})]);
        let rows = shared.tools.lock().unwrap();
        for (name, description) in [("execute_luau", "Run Luau"), ("create_folder", "Create a folder"), ("memory__search", "Search memory"), ("web_search", "Search the web"), ("unknown", "")] {
            let row = rows.iter().find(|row| row.name == name).unwrap();
            assert_eq!(row.description, description);
            assert_eq!(serde_json::to_value(row).unwrap()["description"], description);
        }
    }

    #[test]
    fn browser_tool_refresh_replaces_only_browser_rows() {
        let shared = UiShared::new(Arc::new(AtomicBool::new(false)));
        shared.set_local_tools(&[serde_json::json!({"name":"tree"})], true);
        shared.set_browser_tools(&[serde_json::json!({"name":"web_search","source":"synerixcode"})]);
        shared.set_browser_tools(&[serde_json::json!({"name":"web_fetch","source":"synerixcode"})]);

        let rows = shared.tools.lock().expect("tool lock").clone();
        assert!(rows.iter().any(|row| row.name == "tree" && row.source == "AgentScript"));
        assert!(rows.iter().any(|row| row.name == "web_fetch" && row.source == "synerixcode"));
        assert!(!rows.iter().any(|row| row.name == "web_search" && row.source == "synerixcode"));
    }
}
