use axum::Json;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpStream};

static LAST_CONNECTION: std::sync::Mutex<Option<(std::time::Instant,bool)>> = std::sync::Mutex::new(None);
pub fn connected() -> Option<bool> { LAST_CONNECTION.lock().ok().and_then(|state|state.as_ref().filter(|(at,_)|at.elapsed()<Duration::from_secs(20)).map(|(_,ready)|*ready)) }

pub async fn command_at(host: &str, port: u16, kind: &str, params: Value, limit: Duration) -> anyhow::Result<Value> {
    tokio::time::timeout(limit, async {
        let mut socket = TcpStream::connect((host, port)).await?;
        socket.write_all(&serde_json::to_vec(&json!({"type":kind,"params":params}))?).await?;
        let mut data = Vec::new();
        let mut buffer = [0u8;8192];
        loop {
            let size = socket.read(&mut buffer).await?;
            anyhow::ensure!(size > 0, "Blender closed the connection before sending a complete response.");
            data.extend_from_slice(&buffer[..size]);
            anyhow::ensure!(data.len() <= 16*1024*1024, "Blender response exceeds 16 MB.");
            match serde_json::from_slice::<Value>(&data) {
                Ok(value) => {
                    anyhow::ensure!(value.is_object() && matches!(value["status"].as_str(), Some("success"|"error")), "The endpoint is not a compatible Blender MCP addon.");
                    return Ok(value);
                },
                Err(error) if error.is_eof() => {},
                Err(error) => return Err(error.into()),
            }
        }
    }).await.map_err(|_| anyhow::anyhow!("Blender did not answer {kind} within {} seconds. Run Blender normally with its visible GUI (not headless / -b), keep it responsive, close blocking dialogs, then stop and start the MCP server in Blender (N → Blender MCP → Start MCP Server). If a fresh scene check still fails, update the official Blender MCP addon: older addons can accept sockets without scheduling commands reliably on Blender's main thread. A running MCP process or tool list alone does not confirm Blender is connected. A timed-out edit may still execute later; inspect the scene before retrying. elio did not replay the command.", limit.as_secs()))?
}

pub async fn command(kind: &str, params: Value, limit: Duration) -> anyhow::Result<Value> {
    static COMMAND_LOCK: once_cell::sync::Lazy<tokio::sync::Mutex<()>> = once_cell::sync::Lazy::new(||tokio::sync::Mutex::new(()));
    // Several chats/browsers can share one Blender. Wait briefly for the active
    // command instead of failing immediately; commands are never repeated.
    let _guard=tokio::time::timeout(Duration::from_secs(45),COMMAND_LOCK.lock()).await.map_err(|_|anyhow::anyhow!("Blender is processing another elio command. Wait for it to finish before running a scene check."))?;
    let config=crate::mcp_addons::read_config();
    let spec=config.servers.get("blender");
    let host = spec.and_then(|s|s.env.get("BLENDER_HOST")).cloned().or_else(||std::env::var("BLENDER_HOST").ok()).unwrap_or_else(|| "127.0.0.1".into());
    let port = spec.and_then(|s|s.env.get("BLENDER_PORT")).cloned().or_else(||std::env::var("BLENDER_PORT").ok()).and_then(|v|v.parse().ok()).unwrap_or(9876);
    let result=command_at(&host,port,kind,params,limit).await;
    // A slow reply means Blender is busy, not disconnected: keep the last known
    // state so the extension does not drop a live Blender connection.
    let busy=matches!(&result,Err(error) if error.to_string().contains("did not answer"));
    if !busy {if let Ok(mut state)=LAST_CONNECTION.lock(){*state=Some((std::time::Instant::now(),result.is_ok()));}}
    result
}

pub async fn post(Json(request): Json<Value>) -> Json<Value> {
    let kind = request["type"].as_str().unwrap_or("get_scene_info");
    if kind!="get_scene_info"{if let Err(error)=crate::safety::mutation(){return Json(json!({"ok":false,"error":error.to_string()}));}}
    let seconds = if kind == "get_scene_info" {8} else {request["timeout_seconds"].as_u64().unwrap_or(120).clamp(1,180)};
    match command(kind, request.get("params").cloned().unwrap_or_else(||json!({})), Duration::from_secs(seconds)).await {
        Ok(value) => Json(json!({"ok":true,"blender":true,"data":value})),
        Err(error) => Json(json!({"ok":false,"blender":false,"error":format!("{error}. Check that the Blender MCP addon is enabled and its server is started on the same host and port as elio (default 127.0.0.1:9876).")})),
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[tokio::test] async fn responds_without_waiting_for_socket_close() {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let port=listener.local_addr().unwrap().port();
        let task=tokio::spawn(async move {let (mut stream,_)=listener.accept().await.unwrap();let mut bytes=[0;1024];stream.read(&mut bytes).await.unwrap();stream.write_all(b"{\"status\":\"success\",\"result\":{}").await.unwrap();stream.write_all(b"}").await.unwrap();tokio::time::sleep(Duration::from_secs(2)).await;});
        assert!(command_at("127.0.0.1",port,"get_scene_info",json!({}),Duration::from_secs(1)).await.is_ok());task.abort();
    }
    #[tokio::test] async fn listening_but_silent_is_not_connected() {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let port=listener.local_addr().unwrap().port();
        let task=tokio::spawn(async move {let (_stream,_)=listener.accept().await.unwrap();tokio::time::sleep(Duration::from_secs(2)).await;});
        assert!(command_at("127.0.0.1",port,"get_scene_info",json!({}),Duration::from_millis(50)).await.unwrap_err().to_string().contains("did not answer"));task.abort();
    }
}
