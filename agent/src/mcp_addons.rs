use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct McpConfig {
    #[serde(rename = "mcpServers", default)]
    pub servers: BTreeMap<String, ServerSpec>,
}

#[derive(Clone, Debug)]
pub struct CatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub command: &'static str,
    pub args: &'static [&'static str],
}

#[derive(Clone, Debug, Serialize)]
pub struct ServerSummary {
    pub id: String,
    pub name: String,
    pub alive: bool,
    pub tools: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn catalog() -> Vec<CatalogEntry> {
    vec![
        CatalogEntry {
            id: "blender",
            name: "Blender",
            description: "Install and enable the Blender MCP addon inside Blender first. Keep Blender open, press N in the 3D viewport, open Blender MCP / MCP for Blender, and click Start MCP Server (default port 9876). Enable here starts the MCP process only; Test Blender connection checks the actual scene response.",
            command: "uvx",
            args: &["blender-mcp"],
        },
        CatalogEntry {
            id: "context7",
            name: "Context7",
            description: "Library and framework documentation lookup.",
            command: "npx",
            args: &["-y", "@upstash/context7-mcp"],
        },
        CatalogEntry {
            id: "fetch",
            name: "Fetch",
            description: "Fetch and read web resources through an MCP server.",
            command: "uvx",
            args: &["mcp-server-fetch"],
        },
        CatalogEntry {
            id: "git",
            name: "Git",
            description: "Local Git repository inspection and operations. Requires Git for Windows (git-scm.com).",
            command: "uvx",
            args: &["mcp-server-git"],
        },
        CatalogEntry {
            id: "memory",
            name: "Memory",
            description: "Local graph-style memory tools for agent sessions.",
            command: "npx",
            args: &["-y", "@modelcontextprotocol/server-memory"],
        },
        CatalogEntry {
            id: "thinking",
            name: "Sequential Thinking",
            description: "Structured step-by-step reasoning utilities.",
            command: "npx",
            args: &["-y", "@modelcontextprotocol/server-sequential-thinking"],
        },
    ]
}

pub fn config_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    { return crate::platform::configuration_root().join("config.json"); }
    #[cfg(not(target_os = "macos"))]
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("config.json")))
        .unwrap_or_else(|| PathBuf::from("config.json"))
}

fn read_config_at(path: &std::path::Path) -> anyhow::Result<McpConfig> {
    use std::io::Read;
    let mut cfg=match std::fs::File::open(path) {
        Ok(file)=>{let mut raw=Vec::new();file.take(2*1024*1024+1).read_to_end(&mut raw)?;
            anyhow::ensure!(raw.len()<=2*1024*1024,"MCP configuration exceeds 2 MB; original file preserved.");
            serde_json::from_slice::<McpConfig>(&raw).map_err(|e|anyhow::anyhow!("MCP configuration is invalid; original file preserved: {e}"))?},
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>McpConfig::default(),
        Err(e)=>return Err(e.into()),
    };
    cfg.servers.entry("roblox".to_string()).or_insert_with(|| ServerSpec {
        command: "launch_studio_mcp.py".to_string(), args: Vec::new(), env: HashMap::new(),
    });Ok(cfg)
}
pub fn read_config() -> McpConfig {
    read_config_at(&config_path()).unwrap_or_else(|error|{tracing::warn!("{error}");McpConfig::default()})
}
fn write_config_at(path: &std::path::Path, cfg: &McpConfig) -> anyhow::Result<()> {
    use std::io::Write;
    let raw=serde_json::to_vec_pretty(cfg)?;anyhow::ensure!(raw.len()<=2*1024*1024,"MCP configuration exceeds 2 MB; original file preserved.");
    if let Some(parent)=path.parent(){std::fs::create_dir_all(parent)?;}
    let mut nonce=[0u8;16];getrandom::getrandom(&mut nonce).map_err(|e|anyhow::anyhow!("Config temporary file: {e}"))?;
    let tmp=path.with_extension(format!("json.{}.tmp",nonce.iter().map(|b|format!("{b:02x}")).collect::<String>()));
    let mut created=false;
    let result=(||{let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;created=true;
        file.write_all(&raw)?;file.sync_all()?;drop(file);
        // rename replaces an existing file on Windows too. Never delete the only good config first.
        std::fs::rename(&tmp,path)?;Ok::<_,anyhow::Error>(())})();
    if result.is_err() && created{let _=std::fs::remove_file(&tmp);}result
}
static CONFIG_WRITE:std::sync::Mutex<()>=std::sync::Mutex::new(());
fn mutate_config_at(path:&std::path::Path, update:impl FnOnce(&mut McpConfig)->anyhow::Result<()>) -> anyhow::Result<()> {
    let _lock=CONFIG_WRITE.lock().unwrap_or_else(|e|e.into_inner());
    let mut cfg=read_config_at(path)?;update(&mut cfg)?;write_config_at(path,&cfg)
}
pub fn is_enabled(id: &str) -> bool {read_config().servers.contains_key(id)}
pub fn set_catalog_enabled(id: &str, enabled: bool) -> anyhow::Result<()> {
    let entry=catalog().into_iter().find(|e|e.id==id).ok_or_else(||anyhow::anyhow!("unknown catalog server '{id}'"))?;
    mutate_config_at(&config_path(),|cfg|{if enabled{cfg.servers.insert(id.into(),ServerSpec{command:entry.command.into(),args:entry.args.iter().map(|v|(*v).into()).collect(),env:HashMap::new()});}else{cfg.servers.remove(id);}Ok(())})
}
pub fn add_server(id: &str, spec: ServerSpec) -> anyhow::Result<()> {
    let id=id.trim();anyhow::ensure!(!id.is_empty(),"server id is required");anyhow::ensure!(id!="roblox","the Roblox server cannot be replaced");anyhow::ensure!(!spec.command.trim().is_empty(),"server command is required");
    mutate_config_at(&config_path(),|cfg|{cfg.servers.insert(id.into(),spec);Ok(())})
}
pub fn remove_server(id: &str) -> anyhow::Result<()> {
    let id=id.trim();anyhow::ensure!(id!="roblox","the Roblox server cannot be removed");
    mutate_config_at(&config_path(),|cfg|{anyhow::ensure!(cfg.servers.remove(id).is_some(),"server '{id}' is not configured");Ok(())})
}

pub(crate) struct AddonRuntime {
    id: String,
    spec: ServerSpec,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<crate::resource_limits::LimitedLines<ChildStdout>>,
    next_id: u64,
    tools: Vec<serde_json::Value>,
    last_error: Option<String>,
    stderr: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
    stderr_task: Option<tokio::task::JoinHandle<()>>,
    initialized: bool,
    /// Consecutive tools/call timeouts; the server is recycled only at 2.
    call_timeouts: u32,
    request_pending: bool,
}

impl Drop for AddonRuntime {
    fn drop(&mut self){if let Some(task)=self.stderr_task.take(){task.abort();}}
}

impl AddonRuntime {
    pub(crate) fn new(id: String, spec: ServerSpec) -> Self {
        Self {
            id,
            spec,
            child: None,
            stdin: None,
            stdout: None,
            next_id: 1,
            tools: Vec::new(),
            last_error: None,
            stderr: Default::default(),
            stderr_task: None,
            initialized: false,
            call_timeouts: 0,
            request_pending: false,
        }
    }

    fn same_spec(&self, spec: &ServerSpec) -> bool {
        &self.spec == spec
    }

    fn child_alive(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    pub(crate) async fn reset(&mut self) {
        let child=self.child.take();
        self.request_pending=false;self.initialized=false;self.stdin=None;self.stdout=None;self.tools.clear();self.next_id=1;
        if let Some(task)=self.stderr_task.take(){task.abort();}
        self.stderr.lock().unwrap_or_else(|error|error.into_inner()).clear();
        if let Some(mut child)=child {
            #[cfg(windows)]
            if let Some(pid)=child.id(){let mut killer=Command::new("taskkill");killer.args(["/F","/T","/PID",&pid.to_string()]).creation_flags(CREATE_NO_WINDOW).kill_on_drop(true);let _=tokio::time::timeout(std::time::Duration::from_secs(3),killer.output()).await;}
            let _=child.start_kill();let _=tokio::time::timeout(std::time::Duration::from_secs(2),child.wait()).await;
        }
    }

    fn inherited_path(&self) -> Option<std::ffi::OsString> {
        self.spec.env.get("PATH").map(std::ffi::OsString::from).or_else(|| std::env::var_os("PATH"))
    }

    /// mcp-server-git uses GitPython, which aborts during `initialize` with
    /// "Bad git executable" when git is not on the child's PATH (for example when
    /// elio was started by the updater or at sign-in with a PATH captured
    /// before Git for Windows was installed). Resolve git explicitly instead.
    fn git_override(&self) -> Option<anyhow::Result<PathBuf>> {
        if !wants_git(&self.id, &self.spec.args) || self.spec.env.contains_key("GIT_PYTHON_GIT_EXECUTABLE") {
            return None;
        }
        let path = self.inherited_path();
        Some(find_git(path.as_deref()).ok_or_else(|| anyhow::anyhow!(
            "[{}] Git was not found. Install Git for Windows from https://git-scm.com/download/win (or set GIT_PYTHON_GIT_EXECUTABLE in this server's env), then retry.",
            self.id)))
    }

    fn command(&self) -> anyhow::Result<Command> {
        #[cfg(windows)]
        {
            let low = self.spec.command.to_ascii_lowercase();
            let app = config_path().parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
            if low == "npx" || low == "uvx" {
                let cache = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
                    .map(|base| base.join("elio").join("runtimes"));
                let mut roots = vec![app.join("runtimes").join("node"), app.join("runtimes").join("uv")];
                if let Some(cache) = cache {
                    roots.push(cache.join(if low == "npx" { "node-22.22.0" } else { "uv-0.12.21" }));
                }
                if let Some(profile) = std::env::var_os("USERPROFILE") {
                    let profile = PathBuf::from(profile);
                    roots.push(profile.join(".local").join("bin"));
                    roots.push(profile.join(".cargo").join("bin"));
                    let node_root = profile.join("elioWorkspace").join("node");
                    if let Ok(entries) = std::fs::read_dir(node_root) {
                        roots.extend(entries.flatten().map(|entry| entry.path()));
                    }
                }
                if let Some(programs) = std::env::var_os("ProgramFiles") {
                    roots.push(PathBuf::from(programs).join("nodejs"));
                }
                if let Some(path) = self.inherited_path() {
                    roots.extend(std::env::split_paths(&path));
                }
                let git = self.git_override().and_then(|found| found.ok());
                for root in roots {
                    let binary = root.join(if low == "npx" { "node.exe" } else { "uvx.exe" });
                    let cli = root.join("node_modules").join("npm").join("bin").join("npx-cli.js");
                    if !binary.is_file() || (low == "npx" && !cli.is_file()) { continue; }
                    let mut cmd = Command::new(binary);
                    if low == "npx" { cmd.arg(cli); }
                    cmd.args(&self.spec.args);
                    apply_uv_defaults(&mut cmd, &low, &self.spec.env);
                    cmd.envs(&self.spec.env);
                    let mut paths = vec![root];
                    if let Some(git) = git.as_ref() {
                        if let Some(dir) = git.parent() { paths.push(dir.to_path_buf()); }
                        cmd.env("GIT_PYTHON_GIT_EXECUTABLE", git);
                    }
                    if let Some(path) = self.inherited_path() {
                        paths.extend(std::env::split_paths(&path));
                    }
                    cmd.env("PATH", std::env::join_paths(paths)?);
                    cmd.current_dir(&app).creation_flags(CREATE_NO_WINDOW);
                    return Ok(cmd);
                }
                anyhow::bail!("[{}] {} runtime unavailable; first-use setup requires internet access.", self.id, low);
            }
            if low.ends_with(".cmd") || low.ends_with(".bat") {
                let mut cmd = Command::new("cmd");
                cmd.arg("/D").arg("/C").arg(&self.spec.command).args(&self.spec.args);
                cmd.envs(&self.spec.env);
                cmd.creation_flags(CREATE_NO_WINDOW);
                return Ok(cmd);
            }
        }
        let mut cmd = Command::new(&self.spec.command);
        cmd.args(&self.spec.args);
        apply_uv_defaults(&mut cmd, &self.spec.command.to_ascii_lowercase(), &self.spec.env);
        cmd.envs(&self.spec.env);
        if let Some(Ok(git)) = self.git_override() {
            cmd.env("GIT_PYTHON_GIT_EXECUTABLE", git);
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        Ok(cmd)
    }

    async fn ensure(&mut self) -> anyhow::Result<()> {
        if self.initialized && self.child_alive() && self.stdin.is_some() && self.stdout.is_some() {
            return Ok(());
        }
        self.reset().await;
        // Fail fast with an actionable message instead of starting a server that
        // exits during initialize (and instead of re-running runtime setup).
        if let Some(Err(error)) = self.git_override() {
            return Err(error);
        }
        let command = self.command();
        #[cfg(windows)]
        let command = match command {
            Err(error) if matches!(self.spec.command.to_ascii_lowercase().as_str(), "npx" | "uvx") => {
                let app = config_path().parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
                let script = app.join("Setup-Mcp-Runtime.ps1");
                anyhow::ensure!(script.is_file(), "[{}] Runtime setup script missing: {} ({error})", self.id, script.display());
                tracing::info!("[{}] Preparing {} runtime for first use; download is cached for later launches", self.id, self.spec.command);
                let mut setup = Command::new("powershell.exe");
                setup.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File"])
                    .arg(script).arg("-Runtime").arg(self.spec.command.to_ascii_lowercase())
                    .creation_flags(CREATE_NO_WINDOW).kill_on_drop(true);
                let output = tokio::time::timeout(std::time::Duration::from_secs(300), setup.output()).await
                    .map_err(|_| anyhow::anyhow!("[{}] Runtime setup timed out; check internet access and retry", self.id))??;
                anyhow::ensure!(output.status.success(), "[{}] Runtime setup failed: {}", self.id,
                    String::from_utf8_lossy(&output.stderr).chars().take(4000).collect::<String>());
                tracing::info!("[{}] Runtime setup completed", self.id);
                self.command()
            }
            other => other,
        };
        let mut cmd = command?;
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("[{}] could not start '{}': {e}", self.id, self.spec.command))?;
        if let Some(stderr) = child.stderr.take() {
            let tail = self.stderr.clone();
            self.stderr_task = Some(tokio::spawn(async move {
                let mut lines = crate::resource_limits::LimitedLines::new(stderr,4000);
                loop {
                    let line=match lines.next_line().await{Ok(Some(line))=>line,Ok(None)=>break,Err(error) if error.kind()==std::io::ErrorKind::InvalidData=>"MCP stderr line exceeded its memory limit (discarded)".into(),Err(_)=>break};
                    let mut tail = tail.lock().unwrap_or_else(|error| error.into_inner());
                    if tail.len() == 12 { tail.pop_front(); }
                    tail.push_back(line.chars().take(1000).collect());
                }
            }));
        }
        self.stdin = child.stdin.take();
        self.stdout = child.stdout.take().map(|s| crate::resource_limits::LimitedLines::new(s,32*1024*1024));
        self.child = Some(child);
        self.request("initialize", serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "elio", "version": env!("CARGO_PKG_VERSION")}
        })).await?;
        self.notify("notifications/initialized", serde_json::json!({})).await?;
        self.initialized = true;
        self.last_error = None;
        Ok(())
    }

    async fn notify(&mut self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        let line = serde_json::json!({"jsonrpc":"2.0","method":method,"params":params}).to_string() + "\n";
        let stdin = self.stdin.as_mut().ok_or_else(|| anyhow::anyhow!("MCP stdin unavailable"))?;
        tokio::time::timeout(std::time::Duration::from_secs(5), async { stdin.write_all(line.as_bytes()).await?; stdin.flush().await })
            .await.map_err(|_| anyhow::anyhow!("[{}] MCP notification timed out: {method}", self.id))??;
        Ok(())
    }

    async fn request(&mut self, method: &str, params: serde_json::Value) -> anyhow::Result<serde_json::Value> {
        let seconds = if self.id == "blender" && method != "tools/call" { 20 } else if self.id == "blender" && params["name"] == "get_scene_info" { 20 }
            else if method == "tools/call" { call_timeout_secs(&self.spec.args, &params["arguments"]) } else { 120 };
        self.request_with_timeout(method,params,std::time::Duration::from_secs(seconds)).await
    }
    async fn request_with_timeout(&mut self, method: &str, params: serde_json::Value, budget: std::time::Duration) -> anyhow::Result<serde_json::Value> {
        let request_id=self.next_id;self.next_id+=1;
        let line=serde_json::json!({"jsonrpc":"2.0","id":request_id,"method":method,"params":params}).to_string()+"\n";
        let deadline=tokio::time::Instant::now()+budget;
        self.request_pending=true;
        let exchange=async {
            let stdin=self.stdin.as_mut().ok_or_else(||anyhow::anyhow!("MCP stdin unavailable"))?;
            stdin.write_all(line.as_bytes()).await?;stdin.flush().await?;
            let stdout=self.stdout.as_mut().ok_or_else(||anyhow::anyhow!("MCP stdout unavailable"))?;
            loop {
                anyhow::ensure!(tokio::time::Instant::now() < deadline, "[{}] MCP request timed out: {method}", self.id);
                let line=stdout.next_line().await?.ok_or_else(||anyhow::anyhow!("[{}] MCP server exited while handling {method}",self.id))?;
                let Ok(message)=serde_json::from_str::<serde_json::Value>(&line) else {continue;};
                if message.get("id").and_then(|v|v.as_u64())!=Some(request_id){continue;}
                if let Some(error)=message.get("error"){anyhow::bail!("[{}] {method} failed: {error}",self.id);}
                return message.get("result").cloned().ok_or_else(||anyhow::anyhow!("[{}] {method} returned no result",self.id));
            }
        };
        let outcome=tokio::time::timeout_at(deadline,exchange).await.map_err(|_|anyhow::anyhow!("[{}] MCP request timed out: {method}",self.id));
        self.request_pending=false;
        outcome?
    }

    async fn list_tools(&mut self) -> anyhow::Result<Vec<serde_json::Value>> {
        self.ensure().await?;
        let result = self.request("tools/list", serde_json::json!({})).await?;
        self.tools = result.get("tools").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(self.tools.clone())
    }

    pub(crate) async fn call_tool(&mut self, name: &str, args: serde_json::Value) -> anyhow::Result<(String, Vec<serde_json::Value>)> {
        self.ensure().await?;
        let call_id = self.next_id;
        let result = match self.request("tools/call", serde_json::json!({"name":name,"arguments":args})).await {
            Ok(result) => { self.call_timeouts = 0; result }
            Err(error) => {
                if error.to_string().contains("MCP request timed out: tools/call") {
                    self.call_timeouts += 1;
                    // Keep the server: a Studio add-on such as robloxstudio-mcp owns the
                    // plugin connection, and killing it mid-playtest disconnects Studio.
                    // Ask it to cancel; a late reply is skipped by request id.
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(2),self.notify("notifications/cancelled", serde_json::json!({"requestId": call_id, "reason": "elio timeout"}))).await;
                }
                return Err(error);
            }
        };
        let is_error = result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
        let mut texts = Vec::new();
        let mut images = Vec::new();
        if let Some(items) = result.get("content").and_then(|v| v.as_array()) {
            for item in items {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    texts.push(text.to_string());
                }
                if item.get("type").and_then(|v| v.as_str()) == Some("image") {
                    if let Some(data) = item.get("data").and_then(|v| v.as_str()) {
                        images.push(serde_json::json!({
                            "mimeType": item.get("mimeType").and_then(|v| v.as_str()).unwrap_or("image/png"),
                            "data": data
                        }));
                    }
                }
            }
        }
        let text = texts.join("\n");
        if is_error {
            anyhow::bail!("{}", if text.is_empty() { result.to_string() } else { text });
        }
        Ok((text, images))
    }
}

pub struct AddonManager {
    runtimes: HashMap<String, AddonRuntime>,
}

impl AddonManager {
    pub fn new() -> Self {
        Self { runtimes: HashMap::new() }
    }

    async fn sync_config(&mut self) {
        let cfg = read_config();
        let wanted: HashMap<String, ServerSpec> = cfg.servers.into_iter()
            .filter(|(id, _)| id != "roblox")
            .collect();

        let stale: Vec<String> = self.runtimes.keys()
            .filter(|id| !wanted.contains_key(*id))
            .cloned()
            .collect();
        for id in stale {
            if let Some(mut runtime) = self.runtimes.remove(&id) {
                runtime.reset().await;
            }
        }

        for (id, spec) in wanted {
            let replace = self.runtimes.get(&id).map(|r| !r.same_spec(&spec)).unwrap_or(true);
            if replace {
                if let Some(mut old) = self.runtimes.remove(&id) {
                    old.reset().await;
                }
                self.runtimes.insert(id.clone(), AddonRuntime::new(id, spec));
            }
        }
    }

    pub async fn reset_interrupted_tool(&mut self, advertised: &str) {
        if let Some((id,_))=advertised.split_once("__") {if let Some(runtime)=self.runtimes.get_mut(id){if runtime.request_pending{runtime.reset().await;runtime.request_pending=false;}}}
    }
    pub async fn reset_tool(&mut self, advertised: &str) {
        if let Some((id,_))=advertised.split_once("__") { if let Some(runtime)=self.runtimes.get_mut(id) { runtime.reset().await; } }
    }
    pub async fn reset_all(&mut self) {
        for runtime in self.runtimes.values_mut() {
            runtime.reset().await;
        }
        self.runtimes.clear();
    }

    pub async fn list_tools(&mut self) -> (Vec<serde_json::Value>, Vec<ServerSummary>) {
        self.sync_config().await;
        // Servers start independently: one slow or broken server (first-run
        // runtime download, unreachable Blender) must not delay the others.
        let outcomes = futures::future::join_all(self.runtimes.iter_mut().map(|(id, runtime)| {
            let id = id.clone();
            async move {
                match runtime.list_tools().await {
                    Ok(server_tools) => (id, Ok((server_tools, runtime.tools.len()))),
                    Err(error) => {
                        runtime.last_error = Some(error.to_string());
                        (id, Err(runtime.last_error.clone()))
                    }
                }
            }
        })).await;
        let mut tools = Vec::new();
        let mut summaries = Vec::new();
        for (id, outcome) in outcomes {
            match outcome {
                Ok((server_tools, count)) => {
                    for mut tool in server_tools {
                        let Some(real) = tool.get("name").and_then(|v| v.as_str()).map(str::to_string) else { continue; };
                        tool["name"] = serde_json::Value::String(format!("{id}__{real}"));
                        if let Some(desc) = tool.get("description").and_then(|v| v.as_str()).map(str::to_string) {
                            tool["description"] = serde_json::Value::String(format!("[{id}] {desc}"));
                        }
                        tool["server"] = serde_json::Value::String(id.clone());
                        tools.push(tool);
                    }
                    summaries.push(ServerSummary { id: id.clone(), name: id.clone(), alive: true, tools: count, error: None });
                }
                Err(error) => {
                    summaries.push(ServerSummary { id: id.clone(), name: id.clone(), alive: false, tools: 0, error });
                }
            }
        }
        summaries.sort_by(|a, b| a.id.cmp(&b.id));
        tools.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
        (tools, summaries)
    }

    pub async fn call_tool(&mut self, advertised: &str, args: serde_json::Value) -> anyhow::Result<(String, Vec<serde_json::Value>)> {
        self.sync_config().await;
        let (id, real) = advertised.split_once("__")
            .ok_or_else(|| anyhow::anyhow!("invalid add-on tool name '{advertised}'"))?;
        let runtime = self.runtimes.get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("MCP server '{id}' is not configured"))?;
        if id == "blender" && real == "get_scene_info" {
            let value=crate::blender::command("get_scene_info",serde_json::json!({}),std::time::Duration::from_secs(8)).await?;
            return Ok((value["result"].to_string(),Vec::new()));
        }
        let result = runtime.call_tool(real, args).await;
        if result.as_ref().err().is_some_and(|error| addon_should_reset(&error.to_string(), runtime.call_timeouts)) {
            runtime.reset().await;
            runtime.call_timeouts = 0;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};

    #[test]
    #[ignore]
    fn stdio_fixture() {
        let mut initialized = false;
        for line in std::io::stdin().lock().lines() {
            let line = line.unwrap();
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
            let method = message["method"].as_str().unwrap_or("");
            if method == "notifications/initialized" { initialized = true; continue; }
            let result = match method {
                "initialize" if std::env::var("ELIO_TEST_REJECT").is_ok() => {
                    println!("{}", serde_json::json!({"jsonrpc":"2.0","id":message["id"],"error":{"code":-32603,"message":"fixture initialization rejected"}}));
                    std::io::stdout().flush().unwrap();
                    continue;
                }
                "initialize" => serde_json::json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}}}),
                "tools/list" if initialized => serde_json::json!({"tools":[{"name":"echo","inputSchema":{"type":"object"}}]}),
                "tools/call" if initialized => serde_json::json!({"content":[{"type":"text","text":message["params"]["arguments"]["text"]}]}),
                _ => panic!("request before initialized notification"),
            };
            println!("{}", serde_json::json!({"jsonrpc":"2.0","id":message["id"],"result":result}));
            std::io::stdout().flush().unwrap();
        }
    }

    fn fixture(reject: bool) -> AddonRuntime {
        let mut env = HashMap::new();
        if reject { env.insert("ELIO_TEST_REJECT".into(), "1".into()); }
        AddonRuntime::new("fixture".into(), ServerSpec {
            command: std::env::current_exe().unwrap().to_string_lossy().into_owned(),
            args: vec!["--ignored".into(), "--exact".into(), "mcp_addons::tests::stdio_fixture".into(), "--nocapture".into()],
            env,
        })
    }

    #[tokio::test]
    async fn addon_backpressured_stdin_is_bounded_without_cutting_long_call_defaults() {
        let mut runtime=fixture(false);
        let python=if cfg!(windows){"python"}else{"python3"};
        let mut child=Command::new(python).args(["-u","-c","import time;time.sleep(60)"]).kill_on_drop(true).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        runtime.stdin=child.stdin.take();runtime.stdout=child.stdout.take().map(|s|crate::resource_limits::LimitedLines::new(s,32*1024*1024));runtime.child=Some(child);
        let started=std::time::Instant::now();
        let result=runtime.request_with_timeout("tools/call",serde_json::json!({"code":"x".repeat(2*1024*1024)}),std::time::Duration::from_millis(250)).await;
        assert!(result.unwrap_err().to_string().contains("MCP request timed out"));assert!(started.elapsed()<std::time::Duration::from_secs(3));
        runtime.reset().await;assert!(!runtime.child_alive());
    }

    #[tokio::test]
    async fn stdio_handshake_and_tool_call() {
        let mut runtime = fixture(false);
        let tools = runtime.list_tools().await.unwrap();
        assert_eq!(tools[0]["name"], "echo");
        let pid = runtime.child.as_ref().unwrap().id();
        let (text, images) = runtime.call_tool("echo", serde_json::json!({"text":"hello"})).await.unwrap();
        assert_eq!(text, "hello");
        assert!(images.is_empty());
        assert_eq!(pid, runtime.child.as_ref().unwrap().id());
        runtime.reset().await;
        assert!(!runtime.initialized);
        assert!(!runtime.child_alive());
    }

    #[tokio::test]
    async fn failed_initialize_is_never_reused_as_ready() {
        let mut runtime = fixture(true);
        assert!(runtime.list_tools().await.unwrap_err().to_string().contains("fixture initialization rejected"));
        assert!(!runtime.initialized);
        assert!(runtime.list_tools().await.unwrap_err().to_string().contains("fixture initialization rejected"));
        runtime.reset().await;
    }
}

/// Packages that uvx must install from prebuilt wheels instead of compiling.
/// cryptography 49+ publishes no Intel macOS wheel, so on Intel Macs uv tried
/// to build it with Rust/maturin and blender-mcp exited during initialize.
/// Refusing the source build makes uv pick the newest version that has a wheel
/// for this machine (48.0.1 on Intel Macs); Apple Silicon, Windows and Linux
/// keep resolving the same versions as before.
pub const UV_NO_BUILD_PACKAGES: &str = "cryptography";

fn uv_default_env(command: &str, configured: &HashMap<String, String>) -> Option<(&'static str, &'static str)> {
    let name = std::path::Path::new(command).file_stem().and_then(|s| s.to_str()).unwrap_or(command).to_ascii_lowercase();
    if (name == "uvx" || name == "uv") && !configured.contains_key("UV_NO_BUILD_PACKAGE") && std::env::var_os("UV_NO_BUILD_PACKAGE").is_none() {
        Some(("UV_NO_BUILD_PACKAGE", UV_NO_BUILD_PACKAGES))
    } else { None }
}

fn apply_uv_defaults(cmd: &mut Command, command: &str, configured: &HashMap<String, String>) {
    if let Some((key, value)) = uv_default_env(command, configured) { cmd.env(key, value); }
}

#[cfg(windows)]
const GIT_EXE: &str = "git.exe";
#[cfg(not(windows))]
const GIT_EXE: &str = "git";

/// True when a server spec runs the Python mcp-server-git package.
fn wants_git(id: &str, args: &[String]) -> bool {
    id.eq_ignore_ascii_case("git") || args.iter().any(|arg| {
        let arg = arg.to_ascii_lowercase();
        arg == "mcp-server-git" || arg.starts_with("mcp-server-git=") || arg.starts_with("mcp-server-git@")
    })
}

/// Standard Git install locations that may be missing from a stale PATH.
fn standard_git_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        for var in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(base) = std::env::var_os(var) {
                let base = PathBuf::from(base).join("Git");
                dirs.push(base.join("cmd"));
                dirs.push(base.join("bin"));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local).join("Programs").join("Git");
            dirs.push(base.join("cmd"));
            dirs.push(base.join("bin"));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = PathBuf::from(profile);
            dirs.push(profile.join("scoop").join("shims"));
            dirs.push(profile.join("scoop").join("apps").join("git").join("current").join("cmd"));
        }
        if let Some(data) = std::env::var_os("ProgramData") {
            dirs.push(PathBuf::from(data).join("chocolatey").join("bin"));
        }
        // GitHub Desktop bundles its own Git (newest app-* folder first).
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(local).join("GitHubDesktop")) {
                let mut apps: Vec<PathBuf> = entries.flatten().map(|e| e.path())
                    .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("app-"))).collect();
                apps.sort();
                for app in apps.into_iter().rev() {
                    dirs.push(app.join("resources").join("app").join("git").join("cmd"));
                }
            }
        }
        // The PATH elio inherited can predate a Git install (started at sign-in
        // or relaunched by the updater). Read the current user and machine PATH.
        for key in [r"HKCU\Environment", r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"] {
            let mut cmd = std::process::Command::new("reg.exe");
            cmd.args(["query", key, "/v", "Path"]).creation_flags(CREATE_NO_WINDOW);
            if let Ok(out) = cmd.output() {
                if let Some(value) = parse_reg_path(&String::from_utf8_lossy(&out.stdout)) {
                    dirs.extend(std::env::split_paths(&expand_env_vars(&value, |name| std::env::var(name).ok())));
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(PathBuf::from));
    }
    dirs
}

/// True for add-ons that drive Roblox Studio through their own plugin
/// (for example @chrrxs/robloxstudio-mcp). Their playtest tools run for minutes.
fn is_studio_addon(args: &[String]) -> bool {
    args.iter().any(|arg| arg.to_ascii_lowercase().contains("robloxstudio-mcp"))
}

/// Seconds elio waits for one add-on tools/call. A tool's own requested
/// timeout (timeoutMs, timeout_ms, timeout_seconds, timeoutSeconds) is honored
/// plus 30 s of grace, capped at 630 s; Studio add-ons default to 330 s.
fn call_timeout_secs(spec_args: &[String], call_args: &serde_json::Value) -> u64 {
    let base: u64 = if is_studio_addon(spec_args) { 330 } else { 120 };
    let ms = ["timeoutMs", "timeout_ms"].iter().find_map(|k| call_args.get(*k).and_then(|v| v.as_f64()));
    let secs = ["timeout_seconds", "timeoutSeconds"].iter().find_map(|k| call_args.get(*k).and_then(|v| v.as_f64()));
    let requested = ms.map(|ms| ms / 1000.0).or(secs).filter(|v| v.is_finite() && *v > 0.0);
    match requested {
        Some(v) => base.max((v.ceil() as u64).saturating_add(30)).min(630),
        None => base,
    }
}

/// Timeouts of initialize/tools/list still recycle the server at once. A
/// tools/call timeout recycles it only when two calls in a row timed out.
fn addon_should_reset(error: &str, consecutive_call_timeouts: u32) -> bool {
    if error.contains("MCP request timed out: tools/call") { return consecutive_call_timeouts >= 2; }
    error.contains("timed out") || error.contains("MCP response line exceeds its memory limit")
}

/// Value of the Path entry in `reg query <key> /v Path` output.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_reg_path(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.get(..4).filter(|head| head.eq_ignore_ascii_case("path"))
            .map(|_| line[4..].trim_start())?;
        let rest = rest.strip_prefix("REG_EXPAND_SZ").or_else(|| rest.strip_prefix("REG_SZ"))?;
        let value = rest.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Expands %NAME% references; unknown names are left as written.
#[cfg_attr(not(windows), allow(dead_code))]
fn expand_env_vars(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) { Some(v) => out.push_str(&v), None => { out.push('%'); out.push_str(name); out.push('%'); } }
                rest = &after[end + 1..];
            }
            _ => { out.push('%'); rest = after; }
        }
    }
    out.push_str(rest);
    out
}

fn find_git_in(path: Option<&std::ffi::OsStr>, extra: &[PathBuf]) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = path.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    dirs.extend(extra.iter().cloned());
    dirs.into_iter().map(|dir| dir.join(GIT_EXE)).find(|candidate| candidate.is_file())
}

fn find_git(path: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    // Only look further (registry, install folders) when the PATH has no Git.
    find_git_in(path, &[]).or_else(|| find_git_in(None, &standard_git_dirs()))
}

#[cfg(test)]
mod git_runtime_tests {
    use super::*;

    #[test]
    fn git_server_is_detected_by_id_or_package() {
        assert!(wants_git("git", &[]));
        assert!(wants_git("repo", &["mcp-server-git".into()]));
        assert!(wants_git("repo", &["mcp-server-git==2025.1.14".into(), "--repository".into(), ".".into()]));
        assert!(!wants_git("fetch", &["mcp-server-fetch".into()]));
        assert!(!wants_git("blender", &["blender-mcp".into()]));
    }

    #[test]
    fn git_is_found_on_path_or_in_standard_locations() {
        let dir = std::env::temp_dir().join(format!("elio-git-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(GIT_EXE);
        std::fs::write(&exe, b"").unwrap();
        let on_path = std::env::join_paths([dir.clone()]).unwrap();
        assert_eq!(find_git_in(Some(&on_path), &[]), Some(exe.clone()));
        let stale = std::env::join_paths([dir.join("missing")]).unwrap();
        assert_eq!(find_git_in(Some(&stale), &[]), None);
        assert_eq!(find_git_in(Some(&stale), &[dir.clone()]), Some(exe.clone()));
        assert_eq!(find_git_in(None, &[dir.clone()]), Some(exe));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn studio_addon_calls_get_their_requested_time_and_are_not_killed_on_one_timeout() {
        let chrrxs: Vec<String> = vec!["-y".into(), "@chrrxs/robloxstudio-mcp@latest".into(), "--auto-install-plugin".into()];
        let fetch: Vec<String> = vec!["mcp-server-fetch".into()];
        assert!(is_studio_addon(&chrrxs) && !is_studio_addon(&fetch));
        assert_eq!(call_timeout_secs(&fetch, &serde_json::json!({})), 120);
        assert_eq!(call_timeout_secs(&chrrxs, &serde_json::json!({})), 330);
        assert_eq!(call_timeout_secs(&chrrxs, &serde_json::json!({"timeoutMs": 300000})), 330);
        assert_eq!(call_timeout_secs(&fetch, &serde_json::json!({"timeoutMs": 200000})), 230);
        assert_eq!(call_timeout_secs(&fetch, &serde_json::json!({"timeout_seconds": 5})), 120);
        assert_eq!(call_timeout_secs(&fetch, &serde_json::json!({"timeoutMs": 9e9})), 630);
        assert_eq!(call_timeout_secs(&fetch, &serde_json::json!({"timeoutMs": "abc"})), 120);
        assert!(!addon_should_reset("[robloxstudio] MCP request timed out: tools/call", 1));
        assert!(addon_should_reset("[robloxstudio] MCP request timed out: tools/call", 2));
        assert!(addon_should_reset("[robloxstudio] MCP request timed out: tools/list", 0));
        assert!(!addon_should_reset("[robloxstudio] tools/call failed: boom", 5));
    }

    #[test]
    fn registry_path_is_parsed_and_expanded() {
        let out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Program Files\\Git\\cmd\r\n\r\n";
        let value = parse_reg_path(out).unwrap();
        assert_eq!(value, "%USERPROFILE%\\bin;C:\\Program Files\\Git\\cmd");
        let expanded = expand_env_vars(&value, |n| (n == "USERPROFILE").then(|| "C:\\Users\\a".to_string()));
        assert_eq!(expanded, "C:\\Users\\a\\bin;C:\\Program Files\\Git\\cmd");
        assert_eq!(parse_reg_path("    PATH    REG_SZ    C:\\x"), Some("C:\\x".into()));
        assert_eq!(parse_reg_path("ERROR: The system was unable to find the specified registry key or value."), None);
        assert_eq!(parse_reg_path("    PathExt    REG_SZ    .COM"), None);
        assert_eq!(expand_env_vars("%MISSING%;50%;%", |_| None), "%MISSING%;50%;%");
    }

    #[test]
    fn explicit_git_override_is_respected_and_other_servers_untouched() {
        let mut env = HashMap::new();
        env.insert("GIT_PYTHON_GIT_EXECUTABLE".to_string(), "C:/custom/git.exe".to_string());
        let custom = AddonRuntime::new("git".into(), ServerSpec { command: "uvx".into(), args: vec!["mcp-server-git".into()], env });
        assert!(custom.git_override().is_none());
        let fetch = AddonRuntime::new("fetch".into(), ServerSpec { command: "uvx".into(), args: vec!["mcp-server-fetch".into()], env: HashMap::new() });
        assert!(fetch.git_override().is_none());
    }

    #[test]
    fn missing_git_reports_an_actionable_error() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), std::env::temp_dir().join("elio-no-git-here").to_string_lossy().into_owned());
        let runtime = AddonRuntime::new("git".into(), ServerSpec { command: "uvx".into(), args: vec!["mcp-server-git".into()], env });
        match runtime.git_override() {
            Some(Ok(found)) => assert!(found.is_file()), // machine has Git in a standard location
            Some(Err(error)) => assert!(error.to_string().contains("Install Git for Windows")),
            None => panic!("git server must resolve git"),
        }
    }
}

#[cfg(test)]
mod uv_default_tests {
    use super::*;
    #[test]
    fn uvx_refuses_source_builds_of_cryptography() {
        let none = HashMap::new();
        assert_eq!(uv_default_env("uvx", &none), Some(("UV_NO_BUILD_PACKAGE", "cryptography")));
        assert_eq!(uv_default_env("/opt/homebrew/bin/uvx", &none), Some(("UV_NO_BUILD_PACKAGE", "cryptography")));
        #[cfg(windows)]
        assert_eq!(uv_default_env("C:\\x\\uvx.exe", &none), Some(("UV_NO_BUILD_PACKAGE", "cryptography")));
        assert_eq!(uv_default_env("npx", &none), None);
        assert_eq!(uv_default_env("launch_studio_mcp.py", &none), None);
    }
    #[test]
    fn user_configured_value_is_preserved() {
        let mut env = HashMap::new();
        env.insert("UV_NO_BUILD_PACKAGE".to_string(), "".to_string());
        assert_eq!(uv_default_env("uvx", &env), None);
    }
}

#[cfg(test)]mod drop_resource_tests{use super::*;#[tokio::test]async fn dropped_runtime_aborts_stderr_task(){let mut runtime=AddonRuntime::new("fixture".into(),ServerSpec{command:"unused".into(),args:vec![],env:HashMap::new()});let task=tokio::spawn(std::future::pending::<()>());let handle=task.abort_handle();runtime.stderr_task=Some(task);drop(runtime);tokio::task::yield_now().await;assert!(handle.is_finished());}}

#[cfg(test)] mod audit_config_tests {
    use super::*;
    #[test] fn invalid_config_cannot_be_overwritten_by_mutation() {
        let root=std::env::temp_dir().join(format!("elio-audit-config-corrupt-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let path=root.join("config.json");
        let original=b"{broken user configuration";std::fs::write(&path,original).unwrap();
        assert!(mutate_config_at(&path,|c|{c.servers.clear();Ok(())}).is_err());assert_eq!(std::fs::read(&path).unwrap(),original);std::fs::remove_dir_all(root).unwrap();
    }
    #[test] fn concurrent_config_edits_preserve_all_servers_and_leave_no_temp_files() {
        let root=std::env::temp_dir().join(format!("elio-audit-config-concurrent-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let path=root.join("config.json");
        let mut workers=Vec::new();for i in 0..16{let path=path.clone();workers.push(std::thread::spawn(move||mutate_config_at(&path,|c|{c.servers.insert(format!("fixture-{i}"),ServerSpec{command:"fixture".into(),args:vec![],env:HashMap::new()});Ok(())}).unwrap()));}
        for worker in workers{worker.join().unwrap();}let c=read_config_at(&path).unwrap();assert_eq!(c.servers.len(),17);assert!(c.servers.contains_key("roblox"));assert_eq!(std::fs::read_dir(&root).unwrap().count(),1);std::fs::remove_dir_all(root).unwrap();
    }
    #[test] fn failed_replacement_cleans_only_its_temporary_file() {
        let root=std::env::temp_dir().join(format!("elio-audit-config-failed-{}",std::process::id()));std::fs::create_dir_all(root.join("config.json")).unwrap();std::fs::write(root.join("config.json/keep"),b"keep").unwrap();
        assert!(write_config_at(&root.join("config.json"),&McpConfig::default()).is_err());assert_eq!(std::fs::read(root.join("config.json/keep")).unwrap(),b"keep");assert_eq!(std::fs::read_dir(&root).unwrap().count(),1);std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)] mod audit_config_size_test {
    use super::*;
    #[test] fn oversized_edit_preserves_last_readable_config() {
        let root=std::env::temp_dir().join(format!("elio-audit-config-size-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let path=root.join("config.json");
        mutate_config_at(&path,|_|Ok(())).unwrap();let original=std::fs::read(&path).unwrap();
        assert!(mutate_config_at(&path,|c|{c.servers.insert("large".into(),ServerSpec{command:"fixture".into(),args:vec!["x".repeat(2*1024*1024)],env:HashMap::new()});Ok(())}).is_err());
        assert_eq!(std::fs::read(&path).unwrap(),original);assert!(read_config_at(&path).is_ok());std::fs::remove_dir_all(root).unwrap();
    }
}
