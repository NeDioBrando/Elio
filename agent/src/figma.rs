// SPDX-License-Identifier: GPL-3.0-or-later
//! Capability-scoped Figma Plugin API bridge. No Figma OAuth token or arbitrary JS.
use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::Mutex,
    time::{Duration, Instant},
};
struct Job {
    payload: Value,
    state: String,
    result: Value,
    at: Instant,
}
#[derive(Default)]
struct Session {
    token: String,
    born: Option<Instant>,
    seen: Option<Instant>,
    client: String,
    document: Value,
    writable: bool,
    jobs: BTreeMap<String, Job>,
}
static STORE: once_cell::sync::Lazy<Mutex<Session>> =
    once_cell::sync::Lazy::new(|| Mutex::new(Session::default()));
fn random() -> anyhow::Result<String> {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(b.iter().map(|b| format!("{b:02x}")).collect())
}
fn ident(v: &Value, k: &str) -> anyhow::Result<String> {
    let s = v[k].as_str().unwrap_or("");
    anyhow::ensure!(
        !s.is_empty()
            && s.len() <= 120
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-:.".contains(c)),
        "{k}: use a stable 1–120 character identifier"
    );
    Ok(s.into())
}
fn validate(v: &Value) -> anyhow::Result<()> {
    anyhow::ensure!(v.to_string().len() <= 300_000, "Command exceeds 300 KB");
    let action = v["action"].as_str().unwrap_or("");
    anyhow::ensure!(
        ["read", "apply", "export"].contains(&action),
        "Use status, read, apply, export or result"
    );
    ident(v, "request_id")?;
    if action == "apply" {
        ident(v, "build_id")?;
        let nodes = v["nodes"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("nodes array required"))?;
        anyhow::ensure!(
            !nodes.is_empty() && nodes.len() <= 120,
            "Use 1–120 nodes per design"
        );
        let mut ids = std::collections::BTreeSet::new();
        for (i, n) in nodes.iter().enumerate() {
            let id = ident(n, "id")?;
            anyhow::ensure!(ids.insert(id), "Duplicate node id");
            anyhow::ensure!(
                ["FRAME", "COMPONENT", "RECTANGLE", "ELLIPSE", "TEXT", "SVG"]
                    .contains(&n["type"].as_str().unwrap_or("")),
                "Unsupported node type"
            );
            if i == 0 {
                anyhow::ensure!(
                    matches!(n["type"].as_str(), Some("FRAME" | "COMPONENT"))
                        && n["parent"].is_null(),
                    "First node must be a root FRAME or COMPONENT with no parent"
                );
            } else {
                anyhow::ensure!(
                    n["parent"]
                        .as_str()
                        .map(|p| ids.contains(p) && p != n["id"].as_str().unwrap())
                        .unwrap_or(false),
                    "Parent must precede its child"
                );
            }
            if n["type"] == "SVG" {
                let svg = n["svg"].as_str().unwrap_or("");
                let s = svg.to_ascii_lowercase();
                anyhow::ensure!(s.contains("<svg")&&svg.len()<=64000&&!s.contains("<!")&&!s.contains("<script")&&!s.contains("<foreignobject")&&!s.contains("<image")&&!s.contains("<use")&&!s.contains("<style")&&!s.contains("<animate")&&!s.contains("href")&&!s.contains("url(")&&!s.contains("javascript:")&&!regex::Regex::new(r"\bon[a-z]+\s*=").unwrap().is_match(&s),"SVG must be self-contained static vector geometry, without scripts, links or images");
            }
        }
    }
    Ok(())
}
impl Session {
    fn expire(&mut self) {
        if self
            .born
            .map(|t| t.elapsed() > Duration::from_secs(4 * 3600))
            .unwrap_or(false)
        {
            self.token.clear();
            self.client.clear();
            self.writable = false;
        }
        for j in self.jobs.values_mut() {
            if ["queued", "running"].contains(&j.state.as_str())
                && j.at.elapsed() > Duration::from_secs(120)
            {
                j.state = if j.state == "running" {
                    "unknown"
                } else {
                    "expired"
                }
                .into();
                j.result = json!({"error":"No confirmed result. Read the file before any new mutation; do not retry with a new request_id."});
            }
        }
    }
    fn connected(&self) -> bool {
        !self.client.is_empty()
            && self
                .seen
                .map(|t| t.elapsed() < Duration::from_secs(10))
                .unwrap_or(false)
            && !self.token.is_empty()
    }
    fn api(&mut self, v: Value) -> anyhow::Result<Value> {
        self.expire();
        let action = v["action"].as_str().unwrap_or("status");
        match action {
            "pair" => {
                self.token = random()?;
                self.born = Some(Instant::now());
                self.client.clear();
                self.seen = None;
                self.writable = false;
                for j in self.jobs.values_mut() {
                    if j.state == "running" || j.state == "queued" {
                        j.state = "unknown".into();
                    }
                }
                Ok(json!({"ok":true,"pairing_code":self.token,"expires_in_seconds":14400}))
            }
            "revoke" => {
                self.token.clear();
                self.client.clear();
                self.writable = false;
                for j in self.jobs.values_mut() {
                    if j.state == "running" || j.state == "queued" {
                        j.state = "unknown".into();
                    }
                }
                Ok(json!({"ok":true}))
            }
            "plugin-files" => Ok(
                json!({"ok":true,"files":{"manifest.json":include_str!("../../figma-plugin/manifest.json"),"code.js":include_str!("../../figma-plugin/code.js"),"ui.html":include_str!("../../figma-plugin/ui.html")}}),
            ),
            "status" => Ok(
                json!({"ok":true,"connected":self.connected(),"writable":self.writable&&self.connected(),"document":self.document,"transport":"local-plugin","official_mcp":"Remote MCP requires Figma-approved client registration; Elio does not impersonate one.","jobs":self.jobs.iter().map(|(id,j)|json!({"request_id":id,"state":j.state})).collect::<Vec<_>>()}),
            ),
            "result" => {
                let id = ident(&v, "request_id")?;
                let j = self
                    .jobs
                    .get(&id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown request_id"))?;
                Ok(json!({"ok":true,"request_id":id,"state":j.state,"result":j.result}))
            }
            _ => {
                validate(&v)?;
                let id = ident(&v, "request_id")?;
                if let Some(j) = self.jobs.get(&id) {
                    anyhow::ensure!(
                        j.payload == v,
                        "request_id already belongs to another command"
                    );
                    return Ok(
                        json!({"ok":true,"request_id":id,"state":j.state,"result":j.result,"replayed":true}),
                    );
                }
                anyhow::ensure!(
                    self.connected(),
                    "Open Elio Link in Figma Desktop and connect it in Elio → Figma first"
                );
                anyhow::ensure!(
                    action != "apply" || self.writable,
                    "Enable Allow edits in the Figma plugin first"
                );
                if self.jobs.len() >= 32 {
                    let key = self
                        .jobs
                        .iter()
                        .filter(|(_, j)| !["queued", "running"].contains(&j.state.as_str()))
                        .min_by_key(|(_, j)| j.at)
                        .map(|(k, _)| k.clone());
                    if let Some(k) = key {
                        self.jobs.remove(&k);
                    } else {
                        anyhow::bail!("Queue is full");
                    }
                }
                anyhow::ensure!(
                    !self
                        .jobs
                        .values()
                        .any(|j| ["queued", "running"].contains(&j.state.as_str())),
                    "Wait for the previous Figma command result"
                );
                self.jobs.insert(
                    id.clone(),
                    Job {
                        payload: v,
                        state: "queued".into(),
                        result: Value::Null,
                        at: Instant::now(),
                    },
                );
                Ok(
                    json!({"ok":true,"request_id":id,"state":"queued","message":"Accepted, not yet executed. Call result with this request_id; never claim design success from this receipt."}),
                )
            }
        }
    }
    fn plugin(&mut self, token: &str, v: Value) -> anyhow::Result<Value> {
        self.expire();
        anyhow::ensure!(
            !self.token.is_empty()
                && token.len() == self.token.len()
                && token
                    .bytes()
                    .zip(self.token.bytes())
                    .fold(0u8, |a, (b, c)| a | (b ^ c))
                    == 0,
            "Invalid or expired plugin pairing code"
        );
        let client = ident(&v, "client_id")?;
        anyhow::ensure!(
            self.client.is_empty() || self.client == client,
            "Another plugin already owns this session; generate a new pairing code to switch files"
        );
        if self.client.is_empty() {
            anyhow::ensure!(v["action"] == "hello", "Connect before polling");
            self.client = client;
        }
        self.seen = Some(Instant::now());
        match v["action"].as_str().unwrap_or("") {
            "hello" => {
                self.document = json!({"name":v["document"]["name"].as_str().unwrap_or("").chars().take(200).collect::<String>(),"page":v["document"]["page"].as_str().unwrap_or("").chars().take(200).collect::<String>()});
                self.writable = v["writable"].as_bool().unwrap_or(false);
                Ok(json!({"ok":true}))
            }
            "disconnect" => {
                self.writable = false;
                self.seen = None;
                Ok(json!({"ok":true}))
            }
            "heartbeat" => {
                self.writable = v["writable"].as_bool().unwrap_or(false);
                Ok(json!({"ok":true}))
            }
            "poll" => {
                self.writable = v["writable"].as_bool().unwrap_or(false);
                if let Some(j) = self.jobs.values_mut().find(|j| j.state == "queued") {
                    if j.payload["action"] == "apply" && (!self.writable || crate::safety::readonly()) {
                        j.state = "failed".into();
                        j.result = json!({"error":"Edits were disabled before execution"});
                        return Ok(json!({"ok":true,"command":null}));
                    }
                    j.state = "running".into();
                    let mut payload = j.payload.clone();
                    payload["fingerprint"] = json!(format!(
                        "{:x}",
                        Sha256::digest(j.payload.to_string().as_bytes())
                    ));
                    Ok(json!({"ok":true,"command":payload}))
                } else {
                    Ok(json!({"ok":true,"command":null}))
                }
            }
            "complete" => {
                let id = ident(&v, "request_id")?;
                let j = self
                    .jobs
                    .get_mut(&id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown request"))?;
                if (j.state == "succeeded" || j.state == "failed") && j.result == v["result"] {
                    return Ok(json!({"ok":true,"replayed":true}));
                }
                anyhow::ensure!(
                    j.state == "running" || j.state == "unknown",
                    "Command is not running"
                );
                anyhow::ensure!(
                    v["result"].to_string().len() <= 1_500_000,
                    "Result exceeds 1.5 MB"
                );
                j.state = if v["result"]["ok"] == true {
                    "succeeded"
                } else {
                    "failed"
                }
                .into();
                j.result = v["result"].clone();
                Ok(json!({"ok":true}))
            }
            _ => anyhow::bail!("Unsupported plugin action"),
        }
    }
}
fn response(r: anyhow::Result<Value>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"ok":false,"error":e.to_string()})),
        )
            .into_response(),
    }
}
pub async fn post(Json(v): Json<Value>) -> Response {
    if v["action"]=="apply"{if let Err(e)=crate::safety::mutation(){return response(Err(e));}}
    response(STORE.lock().unwrap_or_else(|e| e.into_inner()).api(v))
}
pub async fn plugin(headers: HeaderMap, Json(v): Json<Value>) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if !matches!(
        origin,
        None | Some(
            "null" | "https://www.figma.com" | "https://www.figma.com/" | "https://figma.com"
        )
    ) {
        return (StatusCode::FORBIDDEN, "Figma plugin origin required").into_response();
    }
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    response(
        STORE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .plugin(token, v),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn hello(s: &mut Session) -> String {
        let t = s.api(json!({"action":"pair"})).unwrap()["pairing_code"]
            .as_str()
            .unwrap()
            .to_owned();
        s.plugin(&t,json!({"action":"hello","client_id":"client","writable":true,"document":{"name":"Fixture"}})).unwrap();
        t
    }
    fn apply() -> Value {
        json!({"action":"apply","request_id":"one","build_id":"design","nodes":[{"id":"root","type":"FRAME"}]})
    }
    #[test]
    fn pairing_and_no_cross_client() {
        let mut s = Session::default();
        let t = hello(&mut s);
        assert!(s.plugin("bad", json!({"client_id":"client"})).is_err());
        assert!(s
            .plugin(&t, json!({"client_id":"other","action":"poll"}))
            .is_err());
        s.api(json!({"action":"revoke"})).unwrap();
        assert!(s
            .plugin(&t, json!({"client_id":"client","action":"poll"}))
            .is_err());
    }
    #[test]
    fn delivery_is_once_and_receipt_is_not_success() {
        let mut s = Session::default();
        let t = hello(&mut s);
        assert_eq!(s.api(apply()).unwrap()["state"], "queued");
        let p = json!({"action":"poll","client_id":"client","writable":true});
        assert!(!s.plugin(&t, p.clone()).unwrap()["command"].is_null());
        assert!(s.plugin(&t, p).unwrap()["command"].is_null());
        assert_eq!(s.api(apply()).unwrap()["state"], "running");
        s.plugin(&t,json!({"action":"complete","client_id":"client","request_id":"one","result":{"ok":true,"node_id":"1:2"}})).unwrap();
        assert_eq!(s.api(apply()).unwrap()["state"], "succeeded");
        let mut changed = apply();
        changed["build_id"] = json!("other");
        assert!(s.api(changed).is_err());
    }
    #[test]
    fn no_edits_without_plugin_permission() {
        let mut s = Session::default();
        let t = hello(&mut s);
        s.plugin(
            &t,
            json!({"action":"poll","client_id":"client","writable":false}),
        )
        .unwrap();
        assert!(s.api(apply()).is_err());
    }
    #[test]
    fn unsafe_svg_and_bad_graph_refused() {
        let mut v = apply();
        v["nodes"] = json!([{"id":"root","type":"FRAME"},{"id":"svg","parent":"root","type":"SVG","svg":"<svg><image href='https://bad'/></svg>"}]);
        assert!(validate(&v).is_err());
        v["nodes"][1]["svg"] = json!("<svg><path d='M0 0L2 2'/></svg>");
        assert!(validate(&v).is_ok());
        v["nodes"][1]["parent"] = json!("missing");
        assert!(validate(&v).is_err());
    }
    #[test]
    fn stale_delivery_becomes_unknown_not_requeued() {
        let mut s = Session::default();
        let t = hello(&mut s);
        s.api(apply()).unwrap();
        s.plugin(
            &t,
            json!({"action":"poll","client_id":"client","writable":true}),
        )
        .unwrap();
        s.jobs.get_mut("one").unwrap().at = Instant::now() - Duration::from_secs(121);
        assert_eq!(
            s.api(json!({"action":"result","request_id":"one"}))
                .unwrap()["state"],
            "unknown"
        );
        assert!(s
            .plugin(
                &t,
                json!({"action":"poll","client_id":"client","writable":true})
            )
            .unwrap()["command"]
            .is_null());
    }
}
