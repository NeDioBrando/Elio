// SPDX-License-Identifier: GPL-3.0-or-later
//! Real Windows input, never Luau signal spoofing or private plugin APIs.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub fn tools() -> Vec<Value> {
    let schema = |properties: Value, required: &[&str]| json!({"type":"object","properties":properties,"required":required,"additionalProperties":false});
    vec![
        json!({"name":"studio_ui_snapshot","description":"Windows only. Capture the real foreground Roblox Studio main window and bounded OS accessibility controls. Requires user-enabled Full PC access, exactly one connected Studio and one Studio process. Optional focus=true brings Studio forward. Returns a single-use snapshot_id valid 45s and PNG. Local Roblox Visible=true is NOT desktop visibility. No plugin import or click.","inputSchema":schema(json!({"studio_id":{"type":"string"},"focus":{"type":"boolean","default":false}}), &["studio_id"])}),
        json!({"name":"studio_ui_action","description":"Windows only. ONE real input against a fresh studio_ui_snapshot; snapshot consumed even on failure, never auto-replayed. click/scroll use screenshot-relative integer x,y or accessibility element_id. type_text/key require the current focus to match the snapshot (click then take a NEW snapshot). Keys: ENTER,TAB,ESCAPE,CTRL+A,LEFT,RIGHT,UP,DOWN,HOME,END,PAGEUP,PAGEDOWN. No shell, clipboard, plugin API, trust/install approval. Input receipt is NOT success: inspect DataModel/UI after each action. Stop at trust/install/publish dialogs and ask the user.","inputSchema":schema(json!({"studio_id":{"type":"string"},"snapshot_id":{"type":"string"},"action":{"enum":["click","type_text","key","scroll"]},"x":{"type":"integer","minimum":0},"y":{"type":"integer","minimum":0},"element_id":{"type":"integer","minimum":0},"text":{"type":"string","maxLength":512},"key":{"type":"string"},"delta":{"type":"integer","minimum":-5,"maximum":5},"button":{"enum":["left","right"]}}), &["studio_id","snapshot_id","action"])})
    ]
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Action {
    studio_id: String, snapshot_id: String, action: String,
    x: Option<i32>, y: Option<i32>, element_id: Option<usize>,
    text: Option<String>, key: Option<String>, delta: Option<i32>, button: Option<String>,
}
impl Action {
    fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(!self.studio_id.is_empty() && self.studio_id.len() <= 256 && !self.snapshot_id.is_empty() && self.snapshot_id.len() <= 100, "Invalid session/snapshot ID");
        let point = self.x.zip(self.y);
        match self.action.as_str() {
            "click" | "scroll" => {
                anyhow::ensure!(self.text.is_none() && self.key.is_none(), "Unexpected text/key");
                anyhow::ensure!((point.is_some() && self.element_id.is_none()) || (self.x.is_none() && self.y.is_none() && self.element_id.is_some()), "Provide x AND y, or element_id, exclusively");
                if let Some((x,y)) = point { anyhow::ensure!((0..=16384).contains(&x) && (0..=16384).contains(&y), "Invalid screenshot point"); }
                if self.action == "scroll" { anyhow::ensure!(self.button.is_none() && self.delta.is_some_and(|d| d != 0 && (-5..=5).contains(&d)), "Scroll delta must be -5..5, nonzero"); }
                else { anyhow::ensure!(self.delta.is_none() && self.button.as_deref().map_or(true, |b| matches!(b,"left"|"right")), "Invalid click"); }
            }
            "type_text" | "key" => {
                anyhow::ensure!(self.x.is_none() && self.y.is_none() && self.element_id.is_none() && self.delta.is_none() && self.button.is_none(), "Keyboard input takes no point/button/delta");
                if self.action == "type_text" {
                    let text = self.text.as_deref().unwrap_or("");
                    anyhow::ensure!(self.key.is_none() && !text.is_empty() && text.encode_utf16().count() <= 512 && !text.chars().any(char::is_control), "Text must be 1..512 UTF-16 units, without control characters");
                } else { anyhow::ensure!(self.text.is_none() && matches!(self.key.as_deref(), Some("ENTER"|"TAB"|"ESCAPE"|"CTRL+A"|"LEFT"|"RIGHT"|"UP"|"DOWN"|"HOME"|"END"|"PAGEUP"|"PAGEDOWN")), "Unsupported key"); }
            }
            _ => anyhow::bail!("Unsupported action"),
        }
        Ok(())
    }
}
struct Snapshot { id: String, studio: String, created: Instant, guard: Value, elements: Vec<Value> }
#[derive(Default)]
struct Session { snapshot: Option<Snapshot> }
static SESSION: once_cell::sync::Lazy<Mutex<Session>> = once_cell::sync::Lazy::new(|| Mutex::new(Session::default()));

fn consume(session: &mut Session, action: &Action) -> anyhow::Result<Value> {
    // Take BEFORE validation/await: uncertain input is never replayable.
    let snapshot = session.snapshot.take().ok_or_else(|| anyhow::anyhow!("Take a fresh studio_ui_snapshot first"))?;
    anyhow::ensure!(snapshot.id == action.snapshot_id && snapshot.studio == action.studio_id && snapshot.created.elapsed() <= Duration::from_secs(45), "Snapshot expired, mismatched or consumed; inspect again");
    let mut request = serde_json::to_value(action)?;
    request["guard"] = snapshot.guard;
    let remaining = Duration::from_secs(45).saturating_sub(snapshot.created.elapsed());
    request["deadline_unix_ms"] = json!(unix_ms().saturating_add(remaining.as_millis() as u64));
    if let Some(index) = action.element_id {
        let element = snapshot.elements.get(index).ok_or_else(|| anyhow::anyhow!("Unknown element_id"))?;
        anyhow::ensure!(element["enabled"] == true && element["offscreen"] == false, "Element is not actionable");
        let x = element["x"].as_i64().ok_or_else(|| anyhow::anyhow!("Element has no point"))?;
        let y = element["y"].as_i64().ok_or_else(|| anyhow::anyhow!("Element has no point"))?;
        request["x"] = json!(x); request["y"] = json!(y);
        request["element"] = element.clone();
    }
    Ok(request)
}

pub async fn call(state: &crate::AppState, name: &str, args: Value) -> anyhow::Result<crate::McpOutput> {
    anyhow::ensure!(cfg!(windows), "Studio desktop automation is available only in the Windows build; no input was sent");
    anyhow::ensure!(state.workspace.full_access(), "Studio UI automation needs user-enabled Full PC access. Enable it in Elio only if you want desktop control; it was NOT enabled automatically.");
    crate::safety::desktop_policy(name == "studio_ui_snapshot")?;
    let mut session = SESSION.lock().await;
    let action = if name == "studio_ui_action" {
        let parsed = serde_json::from_value::<Action>(args.clone()).map_err(anyhow::Error::from).and_then(|a| { a.validate()?; Ok(a) });
        match parsed { Ok(a) => Some(a), Err(e) => { session.snapshot = None; return Err(e); } }
    } else { None };
    let studio = args["studio_id"].as_str().filter(|s| !s.is_empty() && s.len() <= 256).ok_or_else(|| anyhow::anyhow!("Explicit studio_id required"))?;
    // Consume before the first await that can fail, including a disconnected bridge.
    let mut request = if let Some(a) = &action { consume(&mut session, a)? } else {
        session.snapshot = None;
        anyhow::ensure!(args.as_object().is_some_and(|o| o.keys().all(|k| matches!(k.as_str(),"studio_id"|"focus"))) && args.get("focus").map_or(true,Value::is_boolean), "Invalid snapshot arguments");
        json!({"action":"snapshot","focus":args["focus"] == true})
    };
    let listing = state.roblox_mcp.lock().await.call_tool("list_roblox_studios", json!({})).await?;
    let ids = crate::studio_session::discover(&serde_json::from_str::<Value>(listing.text.trim())?)?;
    anyhow::ensure!(ids.len() == 1 && ids[0] == studio, "Desktop-to-Studio mapping is ambiguous or stale: require exactly one connected Studio matching studio_id. No input sent.");
    request["studio_id"] = json!(studio);
    // Permissions can be revoked while discovery awaits the bridge.
    anyhow::ensure!(state.workspace.full_access(), "Full PC access was revoked; no desktop input sent");
    crate::safety::desktop_policy(name == "studio_ui_snapshot")?;
    if name == "studio_ui_action" { anyhow::ensure!(request["deadline_unix_ms"].as_u64().is_some_and(|deadline| unix_ms() < deadline), "Snapshot expired during discovery; no input sent"); }
    let mut output = run(request).await?;
    let image = output.as_object_mut().and_then(|o| o.remove("image"));
    let mut images = Vec::new();
    if let Some(image) = image.filter(Value::is_string) { images.push(json!({"mimeType":"image/png","data":image})); }
    if name == "studio_ui_snapshot" {
        anyhow::ensure!(output["guard"].is_object() && !images.is_empty(), "Incomplete desktop snapshot");
        let mut nonce = [0u8;16]; getrandom::getrandom(&mut nonce).map_err(|e| anyhow::anyhow!("Snapshot nonce unavailable: {e}"))?;
        let id = format!("studio-ui-{}", nonce.iter().map(|b| format!("{b:02x}")).collect::<String>());
        let elements = output["elements"].as_array().cloned().unwrap_or_default();
        session.snapshot = Some(Snapshot { id: id.clone(), studio: studio.into(), created: Instant::now(), guard: output["guard"].clone(), elements });
        output.as_object_mut().unwrap().remove("guard");
        output["snapshot_id"] = json!(id); output["expires_in_seconds"] = json!(45);
    }
    Ok(crate::McpOutput { text: serde_json::to_string(&output)?, images })
}

fn unix_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

async fn run(request: Value) -> anyhow::Result<Value> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use std::process::Stdio;
    let script = include_str!("studio_desktop.ps1");

    // Fixed script passed separately; user text is JSON on stdin, never PowerShell source.
    let system_root = std::env::var_os("SystemRoot").ok_or_else(|| anyhow::anyhow!("SystemRoot unavailable"))?;
    let exe = std::path::PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = tokio::process::Command::new(exe);
    command.args(["-NoLogo","-NoProfile","-NonInteractive","-Command",script])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x0800_0000);
    let mut child = command.spawn()?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap(); let stderr = child.stderr.take().unwrap();
    let result = tokio::time::timeout(Duration::from_secs(25), async {
        stdin.write_all(&serde_json::to_vec(&request)?).await?; drop(stdin);
        let out = async { let mut v=Vec::new(); stdout.take(12*1024*1024+1).read_to_end(&mut v).await.map(|_|v) };
        let err = async { let mut v=Vec::new(); stderr.take(8193).read_to_end(&mut v).await.map(|_|v) };
        let (out,err) = tokio::try_join!(out,err)?;
        anyhow::ensure!(out.len() <= 12*1024*1024 && err.len() <= 8192, "Desktop output limit exceeded; input outcome may be uncertain");
        let status = child.wait().await?;
        anyhow::ensure!(status.success(), "Desktop operation failed; inspect before retrying: {}",String::from_utf8_lossy(&err));
        let value: Value = serde_json::from_slice(&out)?;
        anyhow::ensure!(value["ok"] == true, "Desktop operation failed: {}", value["error"]);
        Ok::<_,anyhow::Error>(value)
    }).await;
    result.map_err(|_|anyhow::anyhow!("Desktop timeout: child terminated; input may be partial. Take a new snapshot, never blindly retry."))?
}

#[cfg(test)] mod tests {
    use super::*;
    fn action(extra: Value) -> Action { let mut v=json!({"studio_id":"s","snapshot_id":"one","action":"click","x":1,"y":2}); for(k,x)in extra.as_object().unwrap(){v[k]=x.clone();} serde_json::from_value(v).unwrap() }
    #[test] fn input_validation() {
        assert!(action(json!({})).validate().is_ok());
        for extra in [json!({"x":-1}),json!({"y":null}),json!({"element_id":2}),json!({"text":"x"}),json!({"button":"middle"}),json!({"action":"run"}),json!({"action":"scroll","delta":0})] { assert!(action(extra).validate().is_err()); }
        for key in ["CTRL+V","CTRL+R","ALT+F4","F5","$(calc)"] { assert!(action(json!({"x":null,"y":null,"action":"key","key":key})).validate().is_err()); }
        for text in ["line\nenter".into(),"x".repeat(513),"\u{1b}".into()] { assert!(action(json!({"x":null,"y":null,"action":"type_text","text":text})).validate().is_err()); }
        assert!(action(json!({"x":null,"y":null,"action":"type_text","text":"Impact '$(calc)' 🐔"})).validate().is_ok());
        assert!(serde_json::from_value::<Action>(json!({"studio_id":"s","snapshot_id":"a","action":"key","key":"TAB","code":"calc"})).is_err());
    }
    #[test] fn snapshots_single_use_expiry_and_identity() {
        let new = || Snapshot{id:"one".into(),studio:"s".into(),created:Instant::now(),guard:json!({}),elements:vec![]};
        let mut s=Session{snapshot:Some(new())}; assert!(consume(&mut s,&action(json!({}))).is_ok());assert!(consume(&mut s,&action(json!({}))).is_err());
        for extra in [json!({"studio_id":"other"}),json!({"snapshot_id":"stale"})] {s.snapshot=Some(new());assert!(consume(&mut s,&action(extra)).is_err());assert!(s.snapshot.is_none());}
        let mut old=new();old.created=Instant::now()-Duration::from_secs(46);s.snapshot=Some(old);assert!(consume(&mut s,&action(json!({}))).is_err());
    }
    #[test] fn catalogue_is_explicit_and_embedded() {assert_eq!(tools().len(),2);for t in tools(){assert!(t["inputSchema"]["required"].as_array().unwrap().contains(&json!("studio_id")));} assert!(include_str!("studio_desktop.ps1").contains("WindowFromPoint"));}
}
