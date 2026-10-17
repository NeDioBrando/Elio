// SPDX-License-Identifier: GPL-3.0-or-later
//! Persistent creator drafts live outside the installation; updates cannot replace them.
use std::{path::PathBuf,sync::Mutex,collections::{BTreeMap,HashSet}};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
#[derive(Default,Clone,Serialize,Deserialize)]
struct Catalog { records:BTreeMap<String,Record>, #[serde(default)] feedback:Vec<Value> }
#[derive(Clone,Serialize,Deserialize)]
struct Record { blueprint:Value, revision:u64, status:String, stage:String, updated:i64, #[serde(default)] history:Vec<Value> }
struct Store { path:PathBuf, data:Mutex<Catalog>, load_error:Option<String> }
impl Store {
    fn new(path:PathBuf)->Self {
        let loaded=(||->anyhow::Result<Catalog>{
            match std::fs::metadata(&path) {Ok(metadata)=>anyhow::ensure!(metadata.len()<=32*1024*1024,"Creator library exceeds 32 MB"),Err(error) if error.kind()==std::io::ErrorKind::NotFound=>return Ok(Catalog::default()),Err(error)=>return Err(error.into())}
            Ok(serde_json::from_slice(&std::fs::read(&path)?)?)
        })();
        match loaded {Ok(data)=>Self{path,data:Mutex::new(data),load_error:None},Err(error)=>Self{path,data:Mutex::new(Catalog::default()),load_error:Some(error.to_string())}}
    }
    fn persist(&self,data:&Catalog)->anyhow::Result<()> {let bytes=serde_json::to_vec(data)?;anyhow::ensure!(bytes.len()<=32*1024*1024,"Creator library exceeds 32 MB. Remove an unused draft first.");std::fs::create_dir_all(self.path.parent().unwrap())?;let tmp=self.path.with_extension("tmp");{use std::io::Write;let mut file=std::fs::File::create(&tmp)?;file.write_all(&bytes)?;file.sync_all()?;}std::fs::rename(tmp,&self.path)?;Ok(())}
    fn request(&self,req:&Value)->anyhow::Result<Value>{
        anyhow::ensure!(self.load_error.is_none(),"Creator library could not be loaded ({}). Existing data was left unchanged; restore a valid backup and restart.",self.load_error.as_deref().unwrap_or(""));
        let mut slot=self.data.lock().unwrap_or_else(|e|e.into_inner());let id=req["build_id"].as_str().unwrap_or("");
        let action=req["action"].as_str().unwrap_or("list");
        if action=="list" {return Ok(json!({"ok":true,"records":slot.records.iter().map(|(id,r)|json!({"build_id":id,"name":r.blueprint["root_name"],"mode":r.blueprint["mode"],"revision":r.revision,"status":r.status,"stage":r.stage,"updated":r.updated,"nodes":r.blueprint["nodes"].as_array().map(Vec::len)})).collect::<Vec<_>>(),"feedback":slot.feedback}));}
        anyhow::ensure!(!id.is_empty() && id.len()<=96 && id.bytes().all(|b|b.is_ascii_alphanumeric() || b"._:-".contains(&b)),"Invalid build identity.");
        if action=="read" {let r=slot.records.get(id).ok_or_else(||anyhow::anyhow!("Draft not found."))?;return Ok(json!({"ok":true,"record":{"blueprint":r.blueprint,"revision":r.revision,"status":r.status,"stage":r.stage,"updated":r.updated,"undo_count":r.history.len()},"feedback":slot.feedback}));}
        if action=="export" {let r=slot.records.get(id).ok_or_else(||anyhow::anyhow!("Draft not found."))?;anyhow::ensure!(req["revision"].as_u64()==Some(r.revision),"Draft changed. Reload before exporting.");let mut blueprint=r.blueprint.clone();if req["welded"].as_bool().unwrap_or(false){anyhow::ensure!(blueprint["mode"]=="model","Welded export is for models.");let nodes=blueprint["nodes"].as_array_mut().unwrap();let parts=nodes.iter().filter(|n|matches!(n["class"].as_str(),Some("Part"|"WedgePart"|"CornerWedgePart"|"Seat"|"VehicleSeat"|"MeshPart"|"UnionOperation"|"TrussPart"))).map(|n|n["id"].as_str().unwrap().to_owned()).collect::<Vec<_>>();anyhow::ensure!(nodes.len()+parts.len().saturating_sub(1)<=800,"Welded model exceeds 800 nodes.");let mut ids=nodes.iter().map(|n|n["id"].as_str().unwrap().to_owned()).collect::<HashSet<_>>();for n in nodes.iter_mut().filter(|n|parts.iter().any(|id|n["id"]==*id)){if !n["properties"].is_object(){n["properties"]=json!({});}n["properties"]["Anchored"]=false.into();}for id in parts.iter().skip(1){let mut serial=0;let mut weld=format!("pcweld_{serial}");while ids.contains(&weld){serial+=1;weld=format!("pcweld_{serial}");}ids.insert(weld.clone());nodes.push(json!({"id":weld,"class":"WeldConstraint","parent":r.blueprint["root_id"],"properties":{"Part0":{"type":"Ref","id":parts[0]},"Part1":{"type":"Ref","id":id}}}));}}
            validate(&blueprint)?;let xml=crate::creation_export::export(&blueprint,req["animations"].as_bool().unwrap_or(false))?;return Ok(json!({"ok":true,"xml":xml}));}
        let mut data=slot.clone();
        match action {
            "save"=>{
                let blueprint=&req["blueprint"];validate(blueprint)?;anyhow::ensure!(blueprint["build_id"].as_str()==Some(id),"Blueprint identity mismatch.");
                let status=req["status"].as_str().unwrap_or("building");anyhow::ensure!(matches!(status,"building"|"ready"|"partial"),"Invalid build status.");
                let stage=req["stage"].as_str().unwrap_or("Draft");anyhow::ensure!(stage.chars().count()<=120,"Stage is too long.");
                let existing=data.records.get(id);let revision=existing.map(|r|r.revision).unwrap_or(0);
                if let Some(current)=existing {if current.blueprint==*blueprint && current.status==status && current.stage==stage {return Ok(json!({"ok":true,"revision":revision,"duplicate":true}));}}
                anyhow::ensure!(req["revision"].as_u64()==Some(revision),"Draft changed. Read the latest revision before editing; no edit was applied.");
                anyhow::ensure!(existing.is_some() || data.records.len()<40,"Creator library is full (40 drafts). Remove one first.");
                let mut history=existing.map(|r|r.history.clone()).unwrap_or_default();if let Some(r)=existing {history.push(r.blueprint.clone());if history.len()>10{history.remove(0);}}
                data.records.insert(id.into(),Record{blueprint:blueprint.clone(),revision:revision+1,status:status.into(),stage:stage.into(),updated:chrono::Utc::now().timestamp_millis(),history});
                self.persist(&data)?;*slot=data;return Ok(json!({"ok":true,"revision":revision+1}));
            },
            "undo"=>{let record=data.records.get_mut(id).ok_or_else(||anyhow::anyhow!("Draft not found."))?;anyhow::ensure!(req["revision"].as_u64()==Some(record.revision),"Draft changed. Reload before undo.");record.blueprint=record.history.pop().ok_or_else(||anyhow::anyhow!("No earlier saved change."))?;record.revision+=1;record.updated=chrono::Utc::now().timestamp_millis();record.status="ready".into();record.stage="Undone draft edit (Studio unchanged)".into();},
            "remove"=>{let record=data.records.get(id).ok_or_else(||anyhow::anyhow!("Draft not found."))?;anyhow::ensure!(req["revision"].as_u64()==Some(record.revision),"Draft changed. Reload before removing it.");data.records.remove(id);},
            "feedback"=>{let rating=req["rating"].as_str().unwrap_or("");anyhow::ensure!(matches!(rating,"like"|"dislike"|"forget"),"Invalid feedback rating.");let record=data.records.get(id).ok_or_else(||anyhow::anyhow!("Draft not found."))?;let mode=record.blueprint["mode"].as_str().unwrap_or("").to_owned();if rating=="forget"{data.feedback.retain(|entry|entry["build_id"]!=id);}else{let note=req["note"].as_str().unwrap_or("");anyhow::ensure!(note.chars().count()<=1000,"Feedback must be at most 1,000 characters.");anyhow::ensure!(rating=="like" || !note.trim().is_empty(),"Describe what should improve.");data.feedback.retain(|entry|entry["build_id"]!=id);anyhow::ensure!(data.feedback.len()<100,"Feedback library is full. Forget an old note first.");data.feedback.push(json!({"build_id":id,"mode":mode,"rating":rating,"note":note}));}},
            _=>anyhow::bail!("Unknown creator action.")
        }
        self.persist(&data)?;*slot=data;Ok(json!({"ok":true}))
    }
}
fn validate(value:&Value)->anyhow::Result<()> {
    anyhow::ensure!(serde_json::to_vec(value)?.len()<=1200000,"Draft exceeds 1.2 MB.");
    let nodes=value["nodes"].as_array().ok_or_else(||anyhow::anyhow!("Missing nodes."))?;anyhow::ensure!(!nodes.is_empty() && nodes.len()<=800,"Draft must contain 1–800 nodes.");
    let mode=value["mode"].as_str().unwrap_or("");anyhow::ensure!(matches!(mode,"model"|"ui"),"Invalid creator mode.");
    let root=value["root_id"].as_str().unwrap_or("");let mut map=BTreeMap::new();let mut roots=0;
    for node in nodes {let id=node["id"].as_str().unwrap_or("");anyhow::ensure!(!id.is_empty()&&id.len()<=64&&id.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b)),"Invalid node ID.");anyhow::ensure!(map.insert(id,node).is_none(),"Duplicate node ID.");if node["parent"].as_str().unwrap_or("").is_empty(){roots+=1;anyhow::ensure!(id==root,"Root identity mismatch.");}}
    anyhow::ensure!(roots==1,"Draft needs exactly one root.");
    for node in nodes {
        anyhow::ensure!(!matches!(node["class"].as_str(),Some("Script"|"LocalScript"|"ModuleScript")),"Blueprints cannot provide executable scripts.");
        for (name,property) in node["properties"].as_object().into_iter().flatten() {
            anyhow::ensure!(!matches!(name.as_str(),"Source"|"LinkedSource"|"Parent"|"Name"),"Reserved blueprint property.");
            if property["type"]=="Ref" {anyhow::ensure!(property["id"].as_str().is_some_and(|id|map.contains_key(id)),"Missing blueprint reference.");}
        }
    }
    for node in nodes {let mut seen=HashSet::new();let mut current=node;loop{anyhow::ensure!(seen.insert(current["id"].as_str().unwrap_or(""))&&seen.len()<=33,"Cyclic or too-deep hierarchy.");let parent=current["parent"].as_str().unwrap_or("");if parent.is_empty(){break;}current=map.get(parent).copied().ok_or_else(||anyhow::anyhow!("Missing parent."))?;}}
    Ok(())
}
static STORE:once_cell::sync::Lazy<Store>=once_cell::sync::Lazy::new(||{
    let base=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));Store::new(base.join("synerixcode").join("creations.json"))
});
pub async fn post(axum::Json(req):axum::Json<Value>)->axum::response::Response {use axum::response::IntoResponse;let result=tokio::task::spawn_blocking(move||STORE.request(&req)).await.unwrap_or_else(|e|Err(anyhow::anyhow!("Creator request failed: {e}")));match result {Ok(v)=>axum::Json(v).into_response(),Err(e)=>(axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"ok":false,"error":e.to_string()}))).into_response()}}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn corrupt_library_is_not_overwritten(){let path=std::env::temp_dir().join(format!("synerixcode-corrupt-creators-{}.json",std::process::id()));std::fs::write(&path,b"broken existing library").unwrap();let store=Store::new(path.clone());assert!(store.request(&json!({"action":"save","build_id":"test","revision":0,"blueprint":draft()})).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"broken existing library");std::fs::remove_file(path).unwrap();}
    #[test]fn exported_welds_survive_id_collisions_and_long_names(){let path=std::env::temp_dir().join(format!("synerixcode-export-creators-{}.json",std::process::id()));let _=std::fs::remove_file(&path);let store=Store::new(path.clone());let mut blueprint=draft();blueprint["nodes"].as_array_mut().unwrap().push(json!({"id":"pcweld_0","class":"Part","parent":"root"}));store.request(&json!({"action":"save","build_id":"test","revision":0,"blueprint":blueprint})).unwrap();assert!(store.request(&json!({"action":"export","build_id":"test","revision":0,"welded":true})).is_err());let output=store.request(&json!({"action":"export","build_id":"test","revision":1,"welded":true})).unwrap();assert!(output["xml"].as_str().unwrap().contains("WeldConstraint"));let mut bad=draft();bad["nodes"][1]["properties"]["Part0"]=json!({"type":"Ref","id":"missing"});assert!(validate(&bad).is_err());std::fs::remove_file(path).unwrap();}
    fn draft()->Value{json!({"build_id":"test","root_id":"root","root_name":"Test","mode":"model","nodes":[{"id":"root","class":"Model"},{"id":"part","class":"Part","parent":"root","properties":{"Size":{"type":"Vector3","x":1,"y":2,"z":3}}}]})}
    #[test]fn persistence_revisions_duplicates_undo_feedback_and_failures(){let path=std::env::temp_dir().join(format!("synerixcode-creators-{}.json",std::process::id()));let _=std::fs::remove_file(&path);let store=Store::new(path.clone());let mut req=json!({"action":"save","build_id":"test","revision":0,"blueprint":draft(),"status":"building","stage":"Shape"});assert_eq!(store.request(&req).unwrap()["revision"],1);assert_eq!(store.request(&req).unwrap()["duplicate"],true);req["blueprint"]["root_name"]="Changed".into();assert!(store.request(&req).is_err());req["revision"]=1.into();assert_eq!(store.request(&req).unwrap()["revision"],2);let reopened=Store::new(path.clone());assert_eq!(reopened.request(&json!({"action":"read","build_id":"test"})).unwrap()["record"]["blueprint"]["root_name"],"Changed");assert!(reopened.request(&json!({"action":"undo","build_id":"test","revision":1})).is_err());reopened.request(&json!({"action":"undo","build_id":"test","revision":2})).unwrap();assert_eq!(reopened.request(&json!({"action":"read","build_id":"test"})).unwrap()["record"]["blueprint"]["root_name"],"Test");assert!(reopened.request(&json!({"action":"feedback","build_id":"test","rating":"dislike"})).is_err());reopened.request(&json!({"action":"feedback","build_id":"test","rating":"like","note":"Readable proportions"})).unwrap();assert_eq!(reopened.request(&json!({"action":"list"})).unwrap()["feedback"].as_array().unwrap().len(),1);reopened.request(&json!({"action":"feedback","build_id":"test","rating":"forget"})).unwrap();let mut bad=draft();bad["nodes"][1]["parent"]="missing".into();assert!(validate(&bad).is_err());bad["nodes"][1]["parent"]="part".into();assert!(validate(&bad).is_err());let mut too_big=draft();too_big["nodes"]=Value::Array(vec![json!({"id":"x"});801]);assert!(validate(&too_big).is_err());let _=std::fs::remove_file(path);}
}
