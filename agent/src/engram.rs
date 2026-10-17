// SPDX-License-Identifier: GPL-3.0-or-later
//! Lazy, project-isolated Engram MCP. Chat transcripts remain in chat_history.
use crate::mcp_addons::{AddonRuntime,ServerSpec};
use serde_json::{json,Value};
use std::{collections::{HashMap,HashSet},path::PathBuf,sync::Arc};
use tokio::sync::Mutex;
struct Runtime { process:AddonRuntime, sessions:HashSet<String> }
struct Entry { runtime:Arc<Mutex<Runtime>>, touched:u64 }
#[derive(Default)]struct Registry { entries:HashMap<String,Entry>, tick:u64 }
static REGISTRY:once_cell::sync::Lazy<Mutex<Registry>>=once_cell::sync::Lazy::new(||Mutex::new(Registry::default()));
fn key(text:&str)->String {let mut hash=14695981039346656037u64;for byte in text.as_bytes(){hash^=*byte as u64;hash=hash.wrapping_mul(1099511628211);}format!("{hash:016x}")}
fn data_root()->PathBuf{let base=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));base.join("synerixcode").join("engram")}
fn executable()->anyhow::Result<PathBuf>{
    let root=crate::platform::installation_root();
    let platform=if cfg!(target_os="windows"){"windows"}else if cfg!(target_os="macos"){"darwin"}else{"linux"};
    let arch=if cfg!(target_arch="aarch64"){"arm64"}else{"amd64"};
    let filename=format!("engram-{platform}-{arch}{}",if cfg!(windows){".exe"}else{""});
    // Older macOS updaters replace the signed app, but do not copy new runtime folders.
    // Prefer the bundled runtime so automatic upgrades carry the matching Engram build.
    let bundled=root.join("synerixcode.app/Contents/Resources/engram").join(&filename);
    let path=if cfg!(target_os="macos") && bundled.is_file(){bundled}else{root.join("runtime").join("engram").join(filename)};
    anyhow::ensure!(path.is_file(),"The bundled Engram runtime is unavailable. Existing memory and chat logging remain available.");Ok(path)
}
async fn runtime(scope:&str)->anyhow::Result<Arc<Mutex<Runtime>>>{
    let mut registry=REGISTRY.lock().await;registry.tick+=1;let tick=registry.tick;
    if let Some(entry)=registry.entries.get_mut(scope){entry.touched=tick;return Ok(entry.runtime.clone());}
    if registry.entries.len()>=4 {
        let oldest=registry.entries.iter().filter(|(_,v)|Arc::strong_count(&v.runtime)==1).min_by_key(|(_,v)|v.touched).map(|(k,_)|k.clone());
        if let Some(oldest)=oldest{if let Some(entry)=registry.entries.remove(&oldest){entry.runtime.lock().await.process.reset().await;}}
        else {anyhow::bail!("Memory is busy. Try reading context after current requests finish.");}
    }
    let path=executable()?;let dir=data_root().join(key(scope));tokio::fs::create_dir_all(&dir).await?;
    let marker=dir.join("scope.json");
    if marker.is_file(){let stored:String=serde_json::from_slice(&tokio::fs::read(&marker).await?)?;anyhow::ensure!(stored==scope,"Memory scope collision; refused to open another project's database.");}
    else{tokio::fs::write(&marker,serde_json::to_vec(scope)?).await?;}
    let mut env=HashMap::new();env.insert("ENGRAM_DATA_DIR".into(),dir.to_string_lossy().into_owned());env.insert("ENGRAM_PROJECT".into(),scope.into());env.insert("ENGRAM_CLOUD_AUTOSYNC".into(),"0".into());
    let process=AddonRuntime::new("synerixcode-engram".into(),ServerSpec{command:path.to_string_lossy().into_owned(),args:vec!["mcp".into(),"--tools=agent,admin".into()],env});
    let runtime=Arc::new(Mutex::new(Runtime{process,sessions:HashSet::new()}));registry.entries.insert(scope.into(),Entry{runtime:runtime.clone(),touched:tick});Ok(runtime)
}
fn string(value:&Value,name:&str,max:usize)->anyhow::Result<String>{let text=value[name].as_str().unwrap_or("");anyhow::ensure!(!text.trim().is_empty()&&text.len()<=max,"Invalid or oversized {name}");Ok(text.into())}
async fn execute(value:Value)->anyhow::Result<Value>{
    let scope=string(&value,"scope",2000)?;let chat=string(&value,"chat",2000)?;let action=string(&value,"action",30)?;
    if matches!(action.as_str(),"save"|"summary"|"checkpoint") {anyhow::ensure!(crate::memory::STORE.snapshot().automatic,"Automatic memory is off.");}
    let session=format!("synerixcode-{}",key(&chat));
    let (tool,args)=match action.as_str(){
        "context"=>("mem_context",json!({"project":scope,"scope":"project","max_bytes":12000})),
        "search"=>("mem_search",json!({"project":scope,"scope":"project","query":string(&value,"query",1000)?,"limit":8,"response_format":"compact"})),
        "read"=>{let id=value["id"].as_u64().filter(|id|*id>0).ok_or_else(||anyhow::anyhow!("Positive observation id required"))?;("mem_get_observation",json!({"id":id,"project":scope}))},
        "save"|"manual-save"=>("mem_save",json!({"session_id":session,"project":scope,"scope":"project","title":string(&value,"title",160)?,"content":string(&value,"content",16000)?,"topic_key":string(&value,"topic_key",160)?,"type":"discovery","capture_prompt":false})),
        "manual-remove"=>{let id=value["id"].as_u64().filter(|id|*id>0).ok_or_else(||anyhow::anyhow!("Positive observation id required"))?;("mem_delete",json!({"id":id,"expected_project":scope,"hard_delete":false}))},
        "checkpoint"=>{
            let id=string(&value,"checkpoint",160)?;
            let journal=crate::checkpoints::STORE.lock().await;let task=journal.task(&id)?;
            anyhow::ensure!(task.chat==chat && matches!(task.status.as_str(),"worked"|"interrupted"),"Checkpoint does not belong to this chat or is not finished.");
            let files=journal.details(&id)?;let paths=files["files"].as_array().map(|rows|rows.iter().filter_map(|row|row["path"].as_str()).take(40).map(|path|path.chars().take(300).collect::<String>()).collect::<Vec<_>>().join("\n")).unwrap_or_default();
            let content=format!("## Goal\n{}\n## Instructions\nHistorical checkpoint record. Verify current state before continuing; an ended loop is not proof every user goal was achieved.\n## Discoveries\nNo additional discoveries inferred automatically.\n## Accomplished\nRecorded checkpoint status: {}.\nRecorded tool steps: {}\nWarnings: {}\n## Next Steps\nInspect current state and unfinished goals before resuming.\n## Relevant Files\n{}",task.request.chars().take(4000).collect::<String>(),task.status,task.steps.iter().take(30).map(|step|step.chars().take(100).collect::<String>()).collect::<Vec<_>>().join(", "),task.warnings.iter().take(8).map(|warning|warning.chars().take(250).collect::<String>()).collect::<Vec<_>>().join("; "),paths);
            let mut end=content.len().min(16000);while !content.is_char_boundary(end){end-=1;}let content=&content[..end];
            ("mem_save",json!({"session_id":session,"project":scope,"scope":"project","title":format!("Task checkpoint: {}",task.label.chars().take(120).collect::<String>()),"content":content,"topic_key":format!("checkpoint/{id}"),"type":"discovery","capture_prompt":false}))
        },
        "summary"=>("mem_session_summary",json!({"session_id":session,"project":scope,"content":string(&value,"content",20000)?})),
        _=>anyhow::bail!("Use context, search, read, save or summary."),
    };
    let shared=runtime(&scope).await?;let mut runtime=shared.lock().await;
    let operation=async {
        if !runtime.sessions.contains(&session){runtime.process.call_tool("mem_session_start",json!({"id":session})).await?;if runtime.sessions.len()>=256{runtime.sessions.clear();}runtime.sessions.insert(session);}
        let (text,_)=runtime.process.call_tool(tool,args).await?;Ok::<String,anyhow::Error>(text)
    };
    let text=match tokio::time::timeout(std::time::Duration::from_secs(22),operation).await{
        Ok(Ok(text))=>text,Ok(Err(error))=>{runtime.process.reset().await;runtime.sessions.clear();return Err(error);},Err(_)=>{runtime.process.reset().await;runtime.sessions.clear();anyhow::bail!("Memory request timed out; a write may have completed. Read context before repeating a write.");}
    };
    let mut end=text.len().min(24000);while !text.is_char_boundary(end){end-=1;}
    Ok(json!({"ok":true,"text":&text[..end],"truncated":end<text.len(),"scope":scope}))
}
pub async fn post(axum::Json(value):axum::Json<Value>)->axum::response::Response{use axum::response::IntoResponse;match execute(value).await{Ok(result)=>axum::Json(result).into_response(),Err(e)=>(axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"ok":false,"error":e.to_string()}))).into_response()}}
#[cfg(test)]mod tests{use super::*;#[test]fn scope_keys_are_stable_and_safe(){assert_eq!(key("project:A"),key("project:A"));assert_ne!(key("project:A"),key("chat:A"));assert!(key("../escape").chars().all(|c|c.is_ascii_hexdigit()));}#[test]fn input_limits_are_bytes(){assert!(string(&json!({"scope":""}),"scope",2000).is_err());assert!(string(&json!({"content":"éé"}),"content",3).is_err());}}
