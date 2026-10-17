use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry { pub id: u64, pub text: String, pub source: String, #[serde(default)] pub chat_ids: Vec<String>, #[serde(default)] pub project: String, #[serde(default)] pub title: String }
#[derive(Clone, Serialize, Deserialize)]
pub struct Memory { pub automatic: bool, pub entries: Vec<Entry>, pub next_id: u64 }
impl Default for Memory {
    fn default() -> Self { Self { automatic: true, entries: vec![], next_id: 1 } }
}
/// 1.21.0: every note has a title saying what it is about. Notes saved without
/// one (including older notes) get the first line of their text, cut to 60 characters.
pub fn derive_title(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("");
    let mut title: String = line.chars().take(60).collect();
    if line.chars().count() > 60 { title.push('\u{2026}'); }
    title
}
pub struct Store { path: PathBuf, data: Mutex<Memory> }
impl Store {
    pub fn load(path: PathBuf) -> Self {
        let data = std::fs::read(&path).ok().and_then(|raw| serde_json::from_slice(&raw).ok()).unwrap_or_default();
        Self { path, data: Mutex::new(data) }
    }
    pub fn snapshot(&self) -> Memory { self.data.lock().unwrap_or_else(|e| e.into_inner()).clone() }
    pub fn update(&self, req: Value) -> anyhow::Result<Memory> {
        let mut lock = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = lock.clone();
        match req["action"].as_str().unwrap_or("") {
            "toggle" => next.automatic = req["enabled"].as_bool().ok_or_else(|| anyhow::anyhow!("Choose on or off."))?,
            "add" | "remember" | "edit" => {
                let action = req["action"].as_str().unwrap();
                let project=req["project"].as_str().unwrap_or("").trim().to_string();anyhow::ensure!(project.chars().count()<=80,"Project name is limited to 80 characters.");
                anyhow::ensure!(action != "remember" || next.automatic, "Automatic memory is off.");
                let text = req["text"].as_str().unwrap_or("").trim();
                anyhow::ensure!(!text.is_empty() && text.encode_utf16().count() <= 500000, "Memory must contain 1–500,000 characters.");
                let given_title = req["title"].as_str().unwrap_or("").trim().to_string();
                anyhow::ensure!(given_title.chars().count() <= 120, "Memory title is limited to 120 characters.");
                if action == "edit" {
                    let id = req["id"].as_u64().unwrap_or(0);
                    let entry = next.entries.iter_mut().find(|entry| entry.id == id).ok_or_else(|| anyhow::anyhow!("Memory no longer exists. Refresh the summary."))?;
                    entry.text = text.to_string(); entry.source = "Edited by you".into();
                    entry.title = if !given_title.is_empty() { given_title.clone() } else if entry.title.is_empty() { derive_title(text) } else { entry.title.clone() };
                } else {
                    let chat_id = if action == "remember" { req["chat_id"].as_str().unwrap_or("").chars().take(1000).collect::<String>() } else { String::new() };
                    if let Some(entry) = next.entries.iter_mut().find(|entry| entry.project==project && entry.text.eq_ignore_ascii_case(text)) {
                        if !chat_id.is_empty() && !entry.chat_ids.contains(&chat_id) && entry.chat_ids.len() < 200 { entry.chat_ids.push(chat_id); }
                    } else {
                    anyhow::ensure!(next.entries.len() < 200, "Memory is full. Remove an entry first.");
                    let source = if action == "remember" { req["source"].as_str().unwrap_or("AI chat").chars().take(300).collect() } else { "Added by you".into() };
                    next.entries.push(Entry { id: next.next_id, text: text.into(), source, title: if given_title.is_empty() { derive_title(text) } else { given_title.clone() }, project, chat_ids: if chat_id.is_empty() { vec![] } else { vec![chat_id] } }); next.next_id += 1;
                    }
                }
            }
            "import" => {
                let entries = req["entries"].as_array().ok_or_else(|| anyhow::anyhow!("Invalid memory entries."))?;
                for value in entries {
                    let text = value["text"].as_str().unwrap_or("").trim();
                    anyhow::ensure!(!text.is_empty() && text.encode_utf16().count() <= 500000, "Imported memory must contain 1–500,000 characters.");
                    let project=value["project"].as_str().unwrap_or("").trim().to_string();anyhow::ensure!(project.chars().count()<=80,"Invalid imported project name.");
                    if !next.entries.iter().any(|entry| entry.project==project && entry.text.eq_ignore_ascii_case(text)) {
                        anyhow::ensure!(next.entries.len() < 200, "Memory is full. Remove entries first.");
                        next.entries.push(Entry { id: next.next_id, text: text.into(), source: "Imported by you".into(), title: value["title"].as_str().map(|title| title.trim().chars().take(120).collect::<String>()).filter(|title| !title.is_empty()).unwrap_or_else(|| derive_title(text)), project, chat_ids: vec![] }); next.next_id += 1;
                    }
                }
            }
            "remove" => { let id = req["id"].as_u64().unwrap_or(0); next.entries.retain(|entry| entry.id != id); }
            _ => anyhow::bail!("Unknown memory action."),
        }
        let total=next.entries.iter().map(|entry| entry.text.encode_utf16().count()).sum::<usize>();
        anyhow::ensure!(total <= 500000 || total <= lock.entries.iter().map(|entry| entry.text.encode_utf16().count()).sum::<usize>(), "Saved memory is limited to 500,000 characters in total. Shorten or remove a note first.");
        if let Some(parent) = self.path.parent() { std::fs::create_dir_all(parent)?; }
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(&next)?)?;
        std::fs::rename(&temp, &self.path)?;
        *lock = next.clone(); Ok(next)
    }
}
pub static STORE: once_cell::sync::Lazy<Store> = once_cell::sync::Lazy::new(|| {
    let root = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));
    Store::load(root.join("synerixcode").join("memory.json"))
});
pub async fn get() -> axum::Json<Memory> { axum::Json(STORE.snapshot()) }
pub async fn post(axum::Json(req): axum::Json<Value>) -> axum::response::Response {
    use axum::response::IntoResponse;
    match STORE.update(req) {
        Ok(memory) => axum::Json(json!({"ok":true,"memory":memory})).into_response(),
        Err(error) => (axum::http::StatusCode::BAD_REQUEST, axum::Json(json!({"ok":false,"error":error.to_string()}))).into_response(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_memory_capacity_is_durable_and_transactional(){
        let dir=std::env::temp_dir().join(format!("synerixcode-memory-capacity-{}",std::process::id()));let _=std::fs::remove_dir_all(&dir);let path=dir.join("memory.json");let store=Store::load(path.clone());let text="A".repeat(500000);
        store.update(json!({"action":"add","text":text})).unwrap();assert_eq!(Store::load(path.clone()).snapshot().entries[0].text.len(),500000);
        assert!(store.update(json!({"action":"add","text":"exceeds total"})).is_err());assert_eq!(store.snapshot().entries.len(),1);
        assert!(store.update(json!({"action":"edit","id":1,"text":"B".repeat(500001)})).is_err());assert_eq!(store.snapshot().entries[0].text.len(),500000);
        store.update(json!({"action":"remove","id":1})).unwrap();store.update(json!({"action":"import","entries":[{"text":text}]})).unwrap();assert_eq!(Store::load(path).snapshot().entries[0].text.len(),500000);let _=std::fs::remove_dir_all(dir);
    }
    #[test]
    fn durable_manual_and_automatic_memory() {
        let dir = std::env::temp_dir().join(format!("synerixcode-memory-{}", std::process::id()));
        let path = dir.join("memory.json"); let _ = std::fs::remove_dir_all(&dir);
        let store = Store::load(path.clone());
        store.update(json!({"action":"remember","text":"Use SourceSansPro","source":"chat-a","chat_id":"chatgpt|/c/a"})).unwrap();
        store.update(json!({"action":"remember","text":"Use SourceSansPro","chat_id":"claude|/chat/b"})).unwrap();
        assert_eq!(store.snapshot().entries.len(), 1);
        store.update(json!({"action":"toggle","enabled":false})).unwrap();
        assert!(store.update(json!({"action":"remember","text":"blocked"})).is_err());
        store.update(json!({"action":"add","text":"No underscores"})).unwrap();
        store.update(json!({"action":"edit","id":1,"text":"Use explicit project conventions"})).unwrap();
        let reopened = Store::load(path); assert!(!reopened.snapshot().automatic);
        assert_eq!(reopened.snapshot().entries[0].source, "Edited by you");
        assert_eq!(reopened.snapshot().entries[0].chat_ids, vec!["chatgpt|/c/a", "claude|/chat/b"]);
        reopened.update(json!({"action":"add","text":"Same convention","project":"Game A"})).unwrap();
        reopened.update(json!({"action":"add","text":"Same convention","project":"Game B"})).unwrap();
        reopened.update(json!({"action":"add","text":"Same convention","project":"Game A"})).unwrap();
        assert_eq!(reopened.snapshot().entries.len(),4);
        let legacy: Entry = serde_json::from_str(r#"{"id":9,"text":"old memory","source":"old chat"}"#).unwrap(); assert!(legacy.chat_ids.is_empty());
        reopened.update(json!({"action":"remove","id":1})).unwrap(); assert_eq!(reopened.snapshot().entries.len(), 3);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn every_note_has_a_title() {
        let dir = std::env::temp_dir().join(format!("synerixcode-memory-title-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir); let path = dir.join("memory.json"); let store = Store::load(path.clone());
        store.update(json!({"action":"add","text":"\n  Combat cooldown lives in CombatService\nsecond line"})).unwrap();
        assert_eq!(store.snapshot().entries[0].title, "Combat cooldown lives in CombatService");
        store.update(json!({"action":"add","title":"UI fonts","text":"Use Gotham"})).unwrap();
        store.update(json!({"action":"edit","id":2,"text":"Use GothamSSm"})).unwrap();
        assert_eq!(store.snapshot().entries[1].title, "UI fonts");
        store.update(json!({"action":"edit","id":2,"title":"Fonts","text":"Use GothamSSm"})).unwrap();
        assert_eq!(Store::load(path).snapshot().entries[1].title, "Fonts");
        assert!(store.update(json!({"action":"add","title":"x".repeat(121),"text":"t"})).is_err());
        store.update(json!({"action":"import","entries":[{"text":"Imported fact"}]})).unwrap();
        assert_eq!(store.snapshot().entries[2].title, "Imported fact");
        let legacy: Entry = serde_json::from_str(r#"{"id":9,"text":"old","source":"s"}"#).unwrap(); assert!(legacy.title.is_empty());
        assert_eq!(derive_title(&"a".repeat(80)).chars().count(), 61);
        let _ = std::fs::remove_dir_all(dir);
    }
}
