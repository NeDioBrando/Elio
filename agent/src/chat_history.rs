// SPDX-License-Identifier: GPL-3.0-or-later
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use std::path::PathBuf;
#[derive(Clone,Serialize,Deserialize)]
struct Chat {id:String,provider:String,updated:i64,history:Vec<Message>,handoff:Value,#[serde(default)]omitted:usize}
#[derive(Clone,Serialize,Deserialize)]
struct Message{id:String,role:String,text:String}
#[derive(Default,Serialize,Deserialize)]
pub struct Archive{chats:Vec<Chat>,#[serde(skip)]path:PathBuf,#[serde(skip)]load_error:Option<String>}
impl Archive {
    fn load(path:PathBuf)->Self {
        let (mut archive,error)=match std::fs::read(&path) {
            Ok(raw) if raw.len()<=8*1024*1024=>match serde_json::from_slice::<Self>(&raw){Ok(value)=>(value,None),Err(_)=>(Self::default(),Some("Saved chat archive is invalid; original file preserved.".into()))},
            Ok(_)=>(Self::default(),Some("Saved chat archive exceeds its limit; original file preserved.".into())),
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>(Self::default(),None),
            Err(_)=>(Self::default(),Some("Saved chat archive could not be read; original file preserved.".into())),
        };archive.path=path;archive.load_error=error;archive
    }
    fn inspect(&self,value:&Value)->anyhow::Result<Value>{
        anyhow::ensure!(self.load_error.is_none(),"{}",self.load_error.as_deref().unwrap_or(""));
        match value["action"].as_str().unwrap_or(""){
            "list"=>Ok(json!({"ok":true,"chats":self.chats.iter().rev().map(|chat|json!({"id":chat.id,"provider":chat.provider,"updated":chat.updated,"messages":chat.history.len(),"omitted":chat.omitted})).collect::<Vec<_>>()})),
            "export"=>{let chat=self.chats.iter().find(|chat|chat.id==value["chat_id"].as_str().unwrap_or("")).ok_or_else(||anyhow::anyhow!("Saved chat not found."))?;Ok(json!({"ok":true,"log":{"format":"elio-chat-log","version":1,"chat_id":chat.id,"provider":chat.provider,"history":chat.history,"omitted":chat.omitted,"handoff":chat.handoff}}))},
            _=>anyhow::bail!("Unknown saved chat action."),
        }
    }
    fn update(&mut self,value:Value)->anyhow::Result<()> {
        anyhow::ensure!(self.load_error.is_none(),"{}",self.load_error.as_deref().unwrap_or(""));
        let id=value["chat_id"].as_str().unwrap_or("");anyhow::ensure!(!id.is_empty()&&!id.ends_with('|')&&id.len()<=1000,"A stable chat ID is required.");
        let incoming:Vec<Message>=serde_json::from_value(value["history"].clone())?;anyhow::ensure!(incoming.len()<=2000&&incoming.iter().all(|m|matches!(m.role.as_str(),"user"|"assistant")&&m.id.len()<=1500)&&incoming.iter().map(|m|m.text.len()).sum::<usize>()<=1600000,"Chat history exceeds its capture limit.");
        let handoff=value["handoff"].clone();anyhow::ensure!(handoff["format"]=="elio-chat-transfer"&&serde_json::to_vec(&handoff)?.len()<=60000,"Invalid continuation reference.");
        let mut next=self.chats.clone();let index=next.iter().position(|c|c.id==id).unwrap_or_else(||{next.push(Chat{id:id.into(),provider:value["provider"].as_str().unwrap_or("").chars().take(80).collect(),updated:0,history:Vec::new(),handoff:Value::Null,omitted:0});next.len()-1});
        let chat=&mut next[index];
        let mut positions=std::collections::HashMap::new();
        for (index,row) in chat.history.iter().enumerate(){positions.entry(row.id.clone()).or_insert(index);}
        let mut bytes:usize=chat.history.iter().map(|row|row.text.len()).sum();
        for row in incoming {if let Some(&index)=positions.get(&row.id){bytes=bytes-chat.history[index].text.len()+row.text.len();chat.history[index]=row;}else{positions.insert(row.id.clone(),chat.history.len());bytes+=row.text.len();chat.history.push(row);}}
        let mut remove=0;
        while chat.history.len()-remove>2000||bytes>800000{bytes-=chat.history[remove].text.len();remove+=1;}
        if remove>0{chat.history.drain(..remove);chat.omitted+=remove;}
        chat.omitted=chat.omitted.max(value["omitted"].as_u64().unwrap_or(0) as usize);chat.handoff=handoff;chat.updated=chrono::Utc::now().timestamp_millis();next.sort_by_key(|c|c.updated);
        while next.len()>20||serde_json::to_vec(&json!({"chats":next}))?.len()>8*1024*1024{anyhow::ensure!(next.len()>1,"Chat archive exceeds capacity.");next.remove(0);}
        let raw=serde_json::to_vec(&json!({"chats":next}))?;if let Some(parent)=self.path.parent(){std::fs::create_dir_all(parent)?;}let temp=self.path.with_extension("tmp");std::fs::write(&temp,raw)?;std::fs::rename(temp,&self.path)?;self.chats=next;Ok(())
    }
    fn latest(&self)->Value{if let Some(error)=&self.load_error{return json!({"ok":false,"error":error});}self.chats.last().map_or(json!({"ok":true,"handoff":null}),|c|json!({"ok":true,"handoff":c.handoff,"chat_id":c.id,"captured_messages":c.history.len(),"omitted":c.omitted}))}
}
static STORE:once_cell::sync::Lazy<tokio::sync::Mutex<Archive>>=once_cell::sync::Lazy::new(||{let root=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));tokio::sync::Mutex::new(Archive::load(root.join("elio").join("chat-history.json")))});
pub async fn get()->axum::Json<Value>{axum::Json(STORE.lock().await.latest())}
pub async fn post(axum::Json(value):axum::Json<Value>)->axum::response::Response{use axum::response::IntoResponse;let mut archive=STORE.lock().await;let result=if value["action"].is_string(){archive.inspect(&value)}else{archive.update(value).map(|_|json!({"ok":true}))};match result{Ok(result)=>axum::Json(result).into_response(),Err(e)=>(axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"ok":false,"error":e.to_string()}))).into_response()}}
#[cfg(test)]mod tests{use super::*;#[test]fn corrupted_chat_archive_is_preserved(){let path=std::env::temp_dir().join(format!("elio-corrupt-chat-{}.json",std::process::id()));let original=b"{broken archive";std::fs::write(&path,original).unwrap();let mut archive=Archive::load(path.clone());assert!(archive.update(json!({})).is_err());assert_eq!(std::fs::read(&path).unwrap(),original);assert_eq!(archive.latest()["ok"],false);std::fs::remove_file(path).unwrap();}
#[test]fn chat_capture_merges_updates_persists_and_rejects_invalid_identity(){let path=std::env::temp_dir().join(format!("elio-chat-{}.json",std::process::id()));let mut a=Archive::load(path.clone());let v=json!({"chat_id":"chatgpt|exact","provider":"ChatGPT","history":[{"id":"u1","role":"user","text":"Exact request"},{"id":"a1","role":"assistant","text":"Partial"}],"handoff":{"format":"elio-chat-transfer","history":[]}});a.update(v.clone()).unwrap();let mut newer=v;newer["history"]=json!([{"id":"a1","role":"assistant","text":"Complete"}]);a.update(newer.clone()).unwrap();let b=Archive::load(path.clone());assert_eq!(b.chats[0].history.len(),2);assert_eq!(b.chats[0].history[1].text,"Complete");assert_eq!(b.inspect(&json!({"action":"list"})).unwrap()["chats"][0]["messages"],2);assert_eq!(b.inspect(&json!({"action":"export","chat_id":"chatgpt|exact"})).unwrap()["log"]["history"][1]["text"],"Complete");newer["chat_id"]=json!("chatgpt|");assert!(a.update(newer).is_err());std::fs::remove_file(path).unwrap();}}

#[cfg(test)]mod linear_merge_tests{use super::*;#[test]fn large_updates_preserve_order_deduplicate_and_trim_bytes(){let path=std::env::temp_dir().join(format!("elio-chat-linear-{}.json",std::process::id()));let mut a=Archive::load(path.clone());let history=(0..2000).map(|i|json!({"id":format!("a{i}"),"role":"assistant","text":"x".repeat(300)})).collect::<Vec<_>>();let mut v=json!({"chat_id":"chat|stress","history":history,"handoff":{"format":"elio-chat-transfer"}});a.update(v.clone()).unwrap();a.update(v.clone()).unwrap();assert_eq!(a.chats[0].history.len(),2000);assert_eq!(a.chats[0].omitted,0);v["history"]=json!([{"id":"a100","role":"assistant","text":"revised"},{"id":"a100","role":"assistant","text":"final"},{"id":"extra","role":"user","text":"🐔".repeat(100000)}]);a.update(v).unwrap();let chat=&a.chats[0];assert!(chat.history.iter().map(|m|m.text.len()).sum::<usize>()<=800000);assert!(chat.history.len()<=2000);assert_eq!(chat.history.last().unwrap().id,"extra");assert!(chat.omitted>0);let _=std::fs::remove_file(path);}}
