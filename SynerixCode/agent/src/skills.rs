// SPDX-License-Identifier: GPL-3.0-or-later
//! Reusable, reviewed methods. Stores observable steps, never hidden reasoning.
use axum::{extract::State,Json,response::{Response,IntoResponse}};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::{BTreeMap,BTreeSet},path::PathBuf};
use sha2::{Digest,Sha256};
use futures::StreamExt;
#[derive(Clone,Serialize,Deserialize)]
struct Skill {id:String,#[serde(default)]title:String,description:String,domain:String,#[serde(default)]scope:String,steps:Vec<String>,#[serde(default)]pitfalls:Vec<String>,#[serde(default)]verification:Vec<String>,#[serde(default)]confirmed:bool,#[serde(default)]enabled:bool,#[serde(default)]revision:u64,#[serde(default)]community:bool,#[serde(default,skip_serializing_if="std::ops::Not::not")]favorite:bool}
#[derive(Clone,Serialize,Deserialize)]
struct DeletedSkill {#[serde(flatten)]skill:Skill,deleted_at:u64}
#[derive(Default,Clone,Serialize,Deserialize)]
struct Catalog {skills:BTreeMap<String,Skill>,#[serde(default)]deleted:BTreeMap<String,DeletedSkill>,#[serde(default)]suppressed:BTreeSet<String>,#[serde(default)]trash_revision:u64,#[serde(default)]starter_pack_version:u64,#[serde(default)]ultragui_pack_version:u64,#[serde(default)]candidate_cleanup_version:u64}
struct Store {path:PathBuf,data:Catalog,error:Option<String>}
impl Store {
 fn load(path:PathBuf)->Self {
  let (mut data,error): (Catalog,Option<String>)=match std::fs::read(&path){Ok(bytes)=>match serde_json::from_slice(&bytes){Ok(data)=>(data,None),Err(e)=>(Catalog::default(),Some(e.to_string()))},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(Catalog::default(),None),Err(e)=>(Catalog::default(),Some(e.to_string()))};
  if error.is_none() && data.starter_pack_version<1 {
   for value in crate::starter_skills::catalog() {if let Ok(skill)=serde_json::from_value::<Skill>(value){if !data.deleted.contains_key(&skill.id)&&!data.suppressed.contains(&skill.id){data.skills.entry(skill.id.clone()).or_insert(skill);}}}
   data.starter_pack_version=1;
  }
  // UltraGUI pack 2 (1.24.12) replaces the original 12 reference cards with the
  // user's completed UltraGUI. Retired bundled cards are removed, current ones
  // refreshed (keeping the user's enabled choice); user skills are untouched.
  if error.is_none() && data.ultragui_pack_version<2 {
   let cards:Vec<Skill>=crate::starter_skills::ultragui_catalog().into_iter().filter_map(|value|serde_json::from_value::<Skill>(value).ok()).collect();
   data.skills.retain(|id,_|!id.starts_with("bundled-ultragui-")||cards.iter().any(|card|&card.id==id));
   for mut card in cards {if data.deleted.contains_key(&card.id)||data.suppressed.contains(&card.id){continue;}if let Some(old)=data.skills.get(&card.id){card.enabled=old.enabled;}data.skills.insert(card.id.clone(),card);}
   data.ultragui_pack_version=2;
  }
  // 1.24.13: earlier builds saved one automatic candidate per finished task,
  // so a repeated label filled the library with identical cards. Collapse
  // untouched automatic duplicates and placeholder-named ones once. Edited,
  // tested, enabled or favourite cards are never removed.
  if error.is_none() && data.candidate_cleanup_version<1 {
   let mut seen=std::collections::BTreeSet::new();
   let remove:Vec<String>=data.skills.values().filter(|s|untouched_auto_candidate(s)).filter(|s|placeholder_title(&s.title)||!seen.insert((s.domain.clone(),normal_title(&s.title)))).map(|s|s.id.clone()).collect();
   for id in remove {data.skills.remove(&id);}
   data.candidate_cleanup_version=1;
  }
  Self{path,data,error}
 }

 fn persist(&mut self,data:Catalog)->anyhow::Result<()> {self.persist_with_backup(data,false)}
 fn persist_with_backup(&mut self,data:Catalog,redact_backup:bool)->anyhow::Result<()> {
  anyhow::ensure!(self.error.is_none(),"Skills could not be loaded. Existing data was left unchanged; restore a valid backup and restart.");
  anyhow::ensure!(data.skills.len()<=1000,"Skill library limit reached.");
  anyhow::ensure!(data.deleted.len()<=10000,"Deleted Skills is full. Permanently delete unwanted items before removing more skills.");
  let bytes=serde_json::to_vec_pretty(&data)?;anyhow::ensure!(bytes.len()<=12*1024*1024,"Skill library exceeds 12 MB.");
  let parent=self.path.parent().ok_or_else(||anyhow::anyhow!("Missing skill directory."))?;std::fs::create_dir_all(parent)?;
  let temporary=self.path.with_extension("json.tmp");std::fs::write(&temporary,bytes)?;
  if redact_backup {let temporary_backup=self.path.with_extension("json.backup.tmp");std::fs::write(&temporary_backup,serde_json::to_vec_pretty(&data)?)?;std::fs::rename(temporary_backup,self.path.with_extension("json.backup"))?;}
  else if self.path.is_file(){std::fs::copy(&self.path,self.path.with_extension("json.backup"))?;}
  std::fs::rename(&temporary,&self.path)?;self.data=data;Ok(())
 }
 fn request(&mut self,request:&Value)->anyhow::Result<Value> {
  anyhow::ensure!(self.error.is_none(),"Skills could not be loaded; existing data is preserved.");
  let action=request["action"].as_str().unwrap_or("list");
  if action=="list" {return Ok(json!({"ok":true,"skills":self.data.skills.values().collect::<Vec<_>>() }));}
  if action=="list_deleted" {return Ok(json!({"ok":true,"skills":self.data.deleted.values().collect::<Vec<_>>(),"trash_revision":self.data.trash_revision}));}
  if action=="match" {
   let query=request["query"].as_str().unwrap_or("").to_lowercase();let domain=request["domain"].as_str().unwrap_or("");let scope=request["scope"].as_str().unwrap_or("");
   let mut terms=query.split(|c:char|!c.is_alphanumeric()).filter(|s|s.len()>2&&!STOPWORDS.contains(s)).take(80).collect::<Vec<_>>();terms.sort_unstable();terms.dedup();
   let mut hits=self.data.skills.values().filter(|s|request["effort"]=="ultracode"||!s.id.starts_with("bundled-ultragui-")).filter(|s|(s.confirmed||s.enabled||s.favorite)&&(s.scope.is_empty()||s.scope==scope)&&(s.domain=="all"||s.domain==domain||(domain=="roblox"&&matches!(s.domain.as_str(),"model"|"ui"))||(domain=="local"&&s.domain=="blender"))).filter_map(|s|{let title=s.title.to_lowercase();let hay=format!("{} {} {}",title,s.description,s.steps.join(" ")).to_lowercase();let score=terms.iter().filter(|word|hay.contains(**word)).count()+terms.iter().filter(|word|title.contains(**word)).count();(score>0||s.enabled||s.favorite).then_some((score+if s.scope.is_empty(){0}else{3}+if s.enabled{8}else{0}+if s.favorite{6}else{0},s))}).collect::<Vec<_>>();hits.sort_by_key(|(score,_)|std::cmp::Reverse(*score));
   // 1.24.13: favourites are always used in their project/engine: every starred
   // skill (up to 8) comes first, then the 3 best other matches.
   let (starred,rest):(Vec<_>,Vec<_>)=hits.into_iter().partition(|(_,s)|s.favorite);
   return Ok(json!({"ok":true,"skills":starred.into_iter().take(8).chain(rest.into_iter().take(3)).map(|(_,skill)|skill).collect::<Vec<_>>() }));
  }
  let id=request["id"].as_str().unwrap_or("");
  if action=="read"&&id.starts_with("bundled-ultra-"){return crate::starter_skills::read_ultra(&crate::platform::installation_root().join("synerixcode-Extension/ultra"),id,request);}
  // Hidden GUI methods remain usable at Ultra even if their old library card was deleted.
  if action=="read"&&id.starts_with("bundled-ultragui-")&&request["effort"]=="ultracode" {let skill=crate::starter_skills::ultragui_catalog().into_iter().find(|s|s["id"]==id).ok_or_else(||anyhow::anyhow!("Unknown built-in Ultra method"))?;let bundle=crate::starter_skills::read_ultragui(&crate::platform::installation_root().join("synerixcode-Extension/ultragui"),id,request)?;return Ok(json!({"ok":true,"skill":skill,"bundle":bundle}));}
  if action=="read"||action=="export" {let skill=self.data.skills.get(id).ok_or_else(||anyhow::anyhow!("Skill not found."))?;let mut result=json!({"ok":true,"skill":if action=="export"{public(skill)}else{serde_json::to_value(skill)?}});
   if action=="read" && id.starts_with("starter-syphodev-") {result["bundle"]=crate::starter_skills::read(&crate::platform::installation_root().join("synerixcode-Extension/starter-skills/syphodev"),id,request)?;}
   if action=="read" && id.starts_with("bundled-ultragui-") {result["bundle"]=crate::starter_skills::read_ultragui(&crate::platform::installation_root().join("synerixcode-Extension/ultragui"),id,request)?;}
   return Ok(result);}
  let mut data=self.data.clone();
  match action {
   "save"=>{let input=&request["skill"];let mut skill:Skill=serde_json::from_value(input.clone())?;if skill.title.trim().is_empty()||matches!(skill.title.trim().to_lowercase().as_str(),"skill"|"untitled"|"new skill"){let text=if skill.description.trim().is_empty(){skill.steps.first().map(String::as_str).unwrap_or("")}else{&skill.description};skill.title=text.split(['\n','.','!','?']).next().unwrap_or("").trim().chars().take(100).collect();}validate(&skill)?;anyhow::ensure!(!skill.id.starts_with("starter-syphodev-")&&!skill.id.starts_with("bundled-ultragui-"),"Starter references are read-only; save your adapted method under a new ID.");anyhow::ensure!(!skill.id.starts_with("global-workflow-"),"Automatic workflow lessons cannot be edited; save an adapted method under a new ID.");anyhow::ensure!(!data.deleted.contains_key(&skill.id),"This skill is in Deleted Skills. Restore it before editing, or save with a new ID.");let previous=data.skills.get(&skill.id);anyhow::ensure!(request["revision"].as_u64().unwrap_or(0)==previous.map_or(0,|s|s.revision),"Skill changed. Reload before saving.");skill.revision=previous.map_or(1,|s|s.revision+1);skill.favorite=previous.map_or(skill.favorite,|s|s.favorite);skill.community=false;data.suppressed.remove(&skill.id);data.skills.insert(skill.id.clone(),skill.clone());self.persist(data)?;return Ok(json!({"ok":true,"skill":skill}));},
   "delete"=>{let current=data.skills.get(id).ok_or_else(||anyhow::anyhow!("Skill not found."))?;anyhow::ensure!(request["revision"].as_u64()==Some(current.revision),"Skill changed. Reload before deleting.");move_to_deleted(&mut data,id)?;},
   "restore"=>{let deleted=data.deleted.get(id).ok_or_else(||anyhow::anyhow!("Deleted skill not found."))?;anyhow::ensure!(request["revision"].as_u64()==Some(deleted.skill.revision),"Deleted skill changed. Refresh before restoring.");anyhow::ensure!(!data.skills.contains_key(id),"An active skill already uses this ID; nothing was overwritten.");let mut skill=data.deleted.remove(id).unwrap().skill;skill.revision+=1;data.skills.insert(id.to_owned(),skill.clone());data.suppressed.remove(id);data.trash_revision+=1;self.persist(data)?;return Ok(json!({"ok":true,"skill":skill}));},
   "purge"=>{anyhow::ensure!(request["confirm"]==true,"Confirm permanent deletion; this cannot be undone.");let deleted=data.deleted.get(id).ok_or_else(||anyhow::anyhow!("Deleted skill not found."))?;anyhow::ensure!(request["revision"].as_u64()==Some(deleted.skill.revision),"Deleted skill changed. Refresh before permanently deleting.");data.deleted.remove(id);data.suppressed.insert(id.to_owned());data.trash_revision+=1;self.persist_with_backup(data,true)?;return Ok(json!({"ok":true,"purged":1}));},
   "purge_all"=>{anyhow::ensure!(request["confirm"]==true,"Confirm permanent deletion of all Deleted Skills; this cannot be undone.");anyhow::ensure!(request["trash_revision"].as_u64()==Some(data.trash_revision),"Deleted Skills changed. Refresh and confirm again.");let purged=data.deleted.len();data.suppressed.extend(data.deleted.keys().cloned());data.deleted.clear();data.trash_revision+=1;self.persist_with_backup(data,true)?;return Ok(json!({"ok":true,"purged":purged}));},
   "favorite"=>{let favorite=request["favorite"].as_bool().ok_or_else(||anyhow::anyhow!("Choose favourite true or false."))?;let skill=data.skills.get_mut(id).ok_or_else(||anyhow::anyhow!("Skill not found."))?;skill.favorite=favorite;let skill=skill.clone();self.persist(data)?;return Ok(json!({"ok":true,"skill":skill}));},
   "delete_all"=>{let ids:Vec<String>=data.skills.iter().filter(|(id,s)|!s.favorite&&!kept_by_delete_all(id)).map(|(id,_)|id.clone()).collect();let removed=ids.len();for id in ids{move_to_deleted(&mut data,&id)?;}let kept=data.skills.len();self.persist(data)?;return Ok(json!({"ok":true,"removed":removed,"kept":kept}));},
   _=>anyhow::bail!("Unknown skill action.")
  }
  self.persist(data)?;Ok(json!({"ok":true}))
 }
}
fn move_to_deleted(data:&mut Catalog,id:&str)->anyhow::Result<()> {
 anyhow::ensure!(!data.deleted.contains_key(id),"A deleted skill already has this ID; nothing was overwritten.");
 let mut skill=data.skills.remove(id).ok_or_else(||anyhow::anyhow!("Skill not found."))?;skill.revision+=1;
 let deleted_at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
 data.deleted.insert(id.to_owned(),DeletedSkill{skill,deleted_at});data.trash_revision+=1;Ok(())
}
fn validate(s:&Skill)->anyhow::Result<()> {
 anyhow::ensure!(!s.id.is_empty()&&s.id.len()<=96&&s.id.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b)),"Invalid skill ID.");
 anyhow::ensure!(!s.title.trim().is_empty()&&s.title.len()<=200&&s.description.len()<=2000&&s.scope.len()<=2000,"Skill title, description or scope is too long.");
 anyhow::ensure!(matches!(s.domain.as_str(),"all"|"roblox"|"local"|"blender"|"model"|"ui"),"Invalid skill domain.");
 anyhow::ensure!(!s.steps.is_empty()&&s.steps.len()<=30&&s.pitfalls.len()<=20&&s.verification.len()<=20,"Add 1–30 steps; at most 20 pitfalls and checks.");
 for text in s.steps.iter().chain(&s.pitfalls).chain(&s.verification){anyhow::ensure!(!text.trim().is_empty()&&text.len()<=1000,"Each step, pitfall and check must contain 1–1000 bytes.");}
 anyhow::ensure!(!s.confirmed||!s.verification.is_empty(),"Add verification before marking a skill tested.");Ok(())
}
const CANDIDATE_TEXT:&str="Candidate from observable tool steps. Edit into a reusable method, add checks and confirm it worked before reuse.";
const STOPWORDS:&[&str]=&["the","and","for","with","that","this","from","into","onto","you","your","are","was","were","can","could","should","would","will","please","make","add","use","using","all","any","its","not","but","then","than","also","just","now","get","set","new","our","out","has","have","had","him","her","them","they","what","when","where","which","who","how","why","there","here","some","more","most","very","one","two","about","over","like","want","need","game","roblox"];
fn normal_title(title:&str)->String{title.to_lowercase().split(|c:char|!c.is_alphanumeric()).filter(|s|!s.is_empty()).collect::<Vec<_>>().join(" ")}
/// Titles the task tracker uses before the AI names the goal. They never
/// describe a reusable method, so automatic candidates with them are noise.
fn placeholder_title(title:&str)->bool{let t=normal_title(title);t.is_empty()||matches!(t.as_str(),"planning project work"|"task checklist"|"task"|"continue"|"keep going"|"go on"|"proceed"|"yes"|"ok"|"okay"|"next"|"done"|"untitled"|"skill"|"new skill"|"hi"|"hello"|"thanks"|"thank you")}
/// An automatic candidate the user never edited, tested, enabled or starred.
fn untouched_auto_candidate(s:&Skill)->bool{s.id.starts_with("task-")&&s.revision<=1&&!s.confirmed&&!s.enabled&&!s.favorite&&!s.community&&s.description==CANDIDATE_TEXT}
fn kept_by_delete_all(id:&str)->bool{id.starts_with("starter-syphodev-")||id.starts_with("bundled-ultragui-")||id.starts_with("global-workflow-")}
fn public(skill:&Skill)->Value {json!({"id":skill.id,"title":skill.title,"description":skill.description,"domain":skill.domain,"scope":"","steps":skill.steps,"pitfalls":skill.pitfalls,"verification":skill.verification,"confirmed":skill.confirmed,"revision":1,"community":true})}
static STORE:once_cell::sync::Lazy<tokio::sync::Mutex<Store>>=once_cell::sync::Lazy::new(||{let base=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));tokio::sync::Mutex::new(Store::load(base.join("synerixcode/skills.json")))});
fn repository()->anyhow::Result<String>{let value=std::env::var("SYNERIXCODE_LEARNING_REPOSITORY").unwrap_or_else(|_|"stoveez/synerixcode".into());let parts=value.split('/').collect::<Vec<_>>();anyhow::ensure!(parts.len()==2&&parts.iter().all(|s|!s.is_empty()&&s.len()<=100&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_- .".contains(&b))&&!s.contains(' ')),"Learning repository must be owner/repository on GitHub.");Ok(value)}
fn client()->anyhow::Result<reqwest::Client>{Ok(reqwest::Client::builder().user_agent("synerixcode-skills").timeout(std::time::Duration::from_secs(25)).build()?)}
async fn github(client:&reqwest::Client,method:reqwest::Method,path:&str,body:Option<Value>,token:&str)->anyhow::Result<Value>{let mut req=client.request(method,format!("https://api.github.com/{path}")).bearer_auth(token).header("Accept","application/vnd.github+json");if let Some(body)=body{req=req.json(&body);}let response=req.send().await?;let status=response.status();let value:Value=response.json().await?;anyhow::ensure!(status.is_success(),"Shared Git request failed ({}): {}",status,value["message"].as_str().unwrap_or("GitHub rejected the operation"));Ok(value)}
async fn sync()->anyhow::Result<Value>{
 let repo=repository()?;let response=client()?.get(format!("https://raw.githubusercontent.com/{repo}/main/learned-skills/index.json")).send().await?.error_for_status()?;
 anyhow::ensure!(response.content_length().unwrap_or(0)<=1024*1024,"Community index is too large.");
 let mut chunks=response.bytes_stream();let mut bytes=Vec::new();while let Some(chunk)=chunks.next().await{let chunk=chunk?;anyhow::ensure!(bytes.len()+chunk.len()<=1024*1024,"Community index is too large.");bytes.extend_from_slice(&chunk);}let lessons:Vec<Skill>=serde_json::from_slice(&bytes)?;anyhow::ensure!(lessons.len()<=100,"Too many community lessons.");
 let mut store=STORE.lock().await;let mut data=store.data.clone();let mut count=0;
 for mut skill in lessons {validate(&skill)?;anyhow::ensure!(skill.confirmed&&skill.scope.is_empty(),"Community index contains an unreviewed or project-specific lesson.");skill.id=format!("community-{}",skill.id);validate(&skill)?;skill.community=true;if data.deleted.contains_key(&skill.id)||data.suppressed.contains(&skill.id){continue;}if data.skills.get(&skill.id).is_some_and(|s|!s.community){continue;}skill.favorite=data.skills.get(&skill.id).is_some_and(|s|s.favorite);data.skills.insert(skill.id.clone(),skill);count+=1;}
 store.persist(data)?;Ok(json!({"ok":true,"count":count}))
}
async fn publish(request:&Value)->anyhow::Result<Value>{
 anyhow::ensure!(request["reviewed"]==true,"Review the exact public lesson and remove private project details before sharing.");
 let value=STORE.lock().await.request(&json!({"action":"read","id":request["id"]}))?;let skill:Skill=serde_json::from_value(value["skill"].clone())?;
 anyhow::ensure!(skill.confirmed&&request["revision"].as_u64()==Some(skill.revision),"Only the current tested skill can be shared.");
 let token=std::env::var("SYNERIXCODE_GITHUB_TOKEN").map_err(|_|anyhow::anyhow!("Set SYNERIXCODE_GITHUB_TOKEN with write access to the learning repository, or export the lesson and contribute from GitHub."))?;
 let repo=repository()?;let client=client()?;let content=serde_json::to_string_pretty(&public(&skill))?;let digest=format!("{:x}",Sha256::digest(content.as_bytes()));let branch=format!("skill-contribution-{}",&digest[..16]);
 let get=reqwest::Method::GET;let post=reqwest::Method::POST;
 let base=github(&client,get.clone(),&format!("repos/{repo}/git/ref/heads/main"),None,&token).await?;let sha=base["object"]["sha"].as_str().ok_or_else(||anyhow::anyhow!("Missing main commit."))?;
 let commit=github(&client,get,&format!("repos/{repo}/git/commits/{sha}"),None,&token).await?;
 let tree=github(&client,post.clone(),&format!("repos/{repo}/git/trees"),Some(json!({"base_tree":commit["tree"]["sha"],"tree":[{"path":format!("learned-skills/proposals/{}.json",&digest[..16]),"mode":"100644","type":"blob","content":content}]})),&token).await?;
 let created=github(&client,post.clone(),&format!("repos/{repo}/git/commits"),Some(json!({"message":"Propose reviewed reusable synerixcode skill","tree":tree["sha"],"parents":[sha]})),&token).await?;
 github(&client,post.clone(),&format!("repos/{repo}/git/refs"),Some(json!({"ref":format!("refs/heads/{branch}"),"sha":created["sha"]})),&token).await?;
 let pull=github(&client,post,&format!("repos/{repo}/pulls"),Some(json!({"title":format!("Shared skill: {}",skill.title),"head":branch,"base":"main","body":"Reviewed reusable method. Maintainers: verify the lesson, remove private details and add approved content to learned-skills/index.json. No raw chat logs or project files are included.","draft":true})),&token).await?;
 Ok(json!({"ok":true,"url":pull["html_url"],"message":"Draft contribution created. Global use starts after maintainer review and index approval."}))
}
static LAST_COMMUNITY_SYNC:std::sync::atomic::AtomicI64=std::sync::atomic::AtomicI64::new(0);
fn maybe_sync(){
 let now=chrono::Utc::now().timestamp();let previous=LAST_COMMUNITY_SYNC.load(std::sync::atomic::Ordering::Relaxed);
 if now-previous<3600{return;}
 if LAST_COMMUNITY_SYNC.compare_exchange(previous,now,std::sync::atomic::Ordering::SeqCst,std::sync::atomic::Ordering::Relaxed).is_ok(){tokio::spawn(async{if let Err(error)=sync().await{tracing::warn!("Community skill sync unavailable: {error}");}});}
}
async fn refresh_global(force:bool)->usize{
  let lessons=crate::shared_learning::lessons(force).await;let mut store=STORE.lock().await;
  let favorites:std::collections::BTreeSet<String>=store.data.skills.values().filter(|s|s.favorite&&s.id.starts_with("global-workflow-")).map(|s|s.id.clone()).collect();
  store.data.skills.retain(|id,_|!id.starts_with("global-workflow-"));
  let count=lessons.len();
  for lesson in lessons {let recipe=lesson.recipe;let id=format!("global-workflow-{}",recipe.id());if store.data.deleted.contains_key(&id)||store.data.suppressed.contains(&id){continue;}store.data.skills.insert(id.clone(),Skill{id,title:recipe.title().into(),description:format!("Generalized local code fix, bug search, feature, file edit and test workflow. {} successful test-command reports; anonymous reports are not proof of task correctness. Adapt to this project and run relevant checks.",lesson.successes),domain:"local".into(),scope:String::new(),steps:recipe.steps(),pitfalls:vec!["Do not assume old paths, implementation or test commands apply to this project.".into()],verification:vec!["The recorded project test command exited successfully after the final edit. Recheck behavior in the current project.".into()],confirmed:true,enabled:false,revision:lesson.revision,community:true,favorite:favorites.contains(&format!("global-workflow-{}",recipe.id()))});}
 count
}
pub async fn post(State(state):State<crate::AppState>,Json(request):Json<Value>)->Response {
 if request["action"]=="match" {maybe_sync();crate::shared_learning::retry();refresh_global(false).await;}
 let result:anyhow::Result<Value>=async {
  match request["action"].as_str().unwrap_or("list") {
   "sync"|"publish"=>{if request["action"]=="sync"{let count=refresh_global(true).await;let mut result=sync().await?;result["count"]=json!(result["count"].as_u64().unwrap_or(0)+count as u64);Ok(result)}else{publish(&request).await}},
   // 1.24.13: automatic task candidates are off; they filled the library with
   // near-identical cards. Only the explicit "Save candidate" action remains.
   "checkpoint"=>{let _=&state;if request["manual"]!=true{return Ok(json!({"ok":true,"skipped":true,"reason":"automatic task candidates are off"}));}let journal=crate::checkpoints::STORE.lock().await;let task=journal.task(request["checkpoint"].as_str().unwrap_or(""))?;anyhow::ensure!(task.status=="worked","Finish the task before saving a candidate.");let project=journal.project(&task.chat);let scope=if project.is_empty(){format!("chat:{}",task.chat)}else{format!("project:{project}")};let id=format!("task-{}",task.id);let manual=request["manual"]==true;let skill=Skill{id:id.clone(),title:task.label.chars().take(50).collect(),description:CANDIDATE_TEXT.into(),domain:task.engine.clone(),scope,steps:if task.steps.is_empty(){vec!["Describe the method that solved this task.".into()]}else{task.steps.iter().take(30).cloned().collect()},pitfalls:task.warnings.iter().take(20).map(|s|s.chars().take(1000).collect()).collect(),verification:vec![],confirmed:false,enabled:false,revision:0,community:false,favorite:false};drop(journal);let mut store=STORE.lock().await;if store.data.skills.contains_key(&id){return Ok(json!({"ok":true,"id":id}));}anyhow::ensure!(manual&&!placeholder_title(&skill.title),"This task has no descriptive name yet. Add the skill manually with a clear title.");store.request(&json!({"action":"save","skill":skill,"revision":0})).map(|mut result|{result["id"]=id.into();result})},
   _=>STORE.lock().await.request(&request)
  }
 }.await;
 match result{Ok(value)=>Json(value).into_response(),Err(error)=>(axum::http::StatusCode::BAD_REQUEST,Json(json!({"ok":false,"error":error.to_string()}))).into_response()}
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn explicit_saved_guidance_is_matched_without_claiming_verification(){
  let path=std::env::temp_dir().join(format!("synerixcode-enabled-skills-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut store=Store::load(path.clone());let mut saved=skill();saved.id="guidance".into();saved.confirmed=false;saved.enabled=true;saved.verification.clear();saved.domain="all".into();
  store.request(&json!({"action":"save","skill":saved,"revision":0})).unwrap();
  let mut candidate=saved.clone();candidate.id="candidate".into();candidate.enabled=false;candidate.scope=String::new();store.request(&json!({"action":"save","skill":candidate,"revision":0})).unwrap();
  let mut reloaded=Store::load(path.clone());
  let matched=reloaded.request(&json!({"action":"match","query":"continue","domain":"roblox","scope":"project:A"})).unwrap();
  assert!(matched["skills"].as_array().unwrap().iter().any(|s|s["id"]=="guidance"&&s["confirmed"]==false&&s["enabled"]==true));
  assert!(!matched["skills"].as_array().unwrap().iter().any(|s|s["id"]=="candidate"));
  let other=reloaded.request(&json!({"action":"match","query":"inventory","domain":"roblox","scope":"project:B"})).unwrap();assert!(!other["skills"].as_array().unwrap().iter().any(|s|s["id"]=="guidance"));
  let exported=public(&saved);assert!(exported.get("enabled").is_none());assert_eq!(exported["scope"],"");assert!(!serde_json::from_value::<Skill>(exported).unwrap().enabled);
  let _=std::fs::remove_file(path.with_extension("json.backup"));std::fs::remove_file(path).unwrap();
 }
 fn skill()->Skill{Skill{id:"test".into(),title:"Inventory".into(),description:"Inventory menu".into(),domain:"roblox".into(),scope:"project:A".into(),steps:vec!["Inspect existing UI conventions".into()],pitfalls:vec![],verification:vec!["Test open and close".into()],confirmed:true,enabled:false,revision:0,community:false,favorite:false}}
 #[test]fn scope_revision_and_corruption(){let path=std::env::temp_dir().join(format!("synerixcode-skills-{}.json",std::process::id()));let _=std::fs::remove_file(&path);let mut store=Store::load(path.clone());let s=skill();store.request(&json!({"action":"save","skill":s,"revision":0})).unwrap();assert!(store.request(&json!({"action":"save","skill":s,"revision":0})).is_err());assert_eq!(store.request(&json!({"action":"match","domain":"roblox","scope":"project:B","query":"inventory"})).unwrap()["skills"].as_array().unwrap().iter().filter(|s|s["id"]=="test").count(),0);assert_eq!(store.request(&json!({"action":"match","domain":"roblox","scope":"project:A","query":"inventory"})).unwrap()["skills"].as_array().unwrap().iter().filter(|s|s["id"]=="test").count(),1);assert_eq!(public(&s)["scope"],"");std::fs::write(&path,b"broken").unwrap();let mut broken=Store::load(path.clone());assert!(broken.request(&json!({"action":"save","skill":s})).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"broken");let _=std::fs::remove_file(path.with_extension("json.backup"));let _=std::fs::remove_file(path);}
 #[test]fn ultragui_pack_two_replaces_retired_cards(){
  let path=std::env::temp_dir().join(format!("synerixcode-ultragui-pack-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut old=serde_json::from_value::<Skill>(json!({"id":"bundled-ultragui-gui-syntax","title":"Old","description":"old","domain":"ui","steps":["x"],"enabled":true})).unwrap();old.revision=1;
  let mut retired=old.clone();retired.id="bundled-ultragui-gui-layout".into();let mut mine=skill();mine.id="mine".into();
  let mut catalog=Catalog{starter_pack_version:1,ultragui_pack_version:1,..Default::default()};for s in [old,retired,mine]{catalog.skills.insert(s.id.clone(),s);}
  std::fs::write(&path,serde_json::to_vec(&catalog).unwrap()).unwrap();
  let store=Store::load(path.clone());assert_eq!(store.data.ultragui_pack_version,2);
  assert!(!store.data.skills.contains_key("bundled-ultragui-gui-layout"));assert!(store.data.skills.contains_key("mine"));
  let syntax=&store.data.skills["bundled-ultragui-gui-syntax"];assert!(syntax.enabled);assert_ne!(syntax.title,"Old");
  assert_eq!(store.data.skills.keys().filter(|id|id.starts_with("bundled-ultragui-")).count(),8);
  std::fs::remove_file(path).unwrap();
 }
 #[test]fn starter_seed_preserves_user_data_and_deletions(){
  let path=std::env::temp_dir().join(format!("synerixcode-starter-store-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut store=Store::load(path.clone());assert_eq!(store.data.skills.len(),19);
  let s=skill();store.request(&json!({"action":"save","skill":s,"revision":0})).unwrap();
  store.request(&json!({"action":"delete","id":"starter-syphodev-roblox-code","revision":1})).unwrap();
  store.request(&json!({"action":"delete","id":"bundled-ultragui-expert-gui","revision":1})).unwrap();
  let reloaded=Store::load(path.clone());assert!(!reloaded.data.skills.contains_key("bundled-ultragui-expert-gui"));assert_eq!(reloaded.data.ultragui_pack_version,2);assert!(reloaded.data.skills.contains_key("test"));assert!(!reloaded.data.skills.contains_key("starter-syphodev-roblox-code"));
  std::fs::remove_file(path.with_extension("json.backup")).unwrap();std::fs::remove_file(path).unwrap();
 }

 fn auto(id:&str,title:&str)->Skill{Skill{id:id.into(),title:title.into(),description:CANDIDATE_TEXT.into(),domain:"roblox".into(),scope:"chat:x".into(),steps:vec!["execute_luau".into(),"get_children".into(),"execute_luau".into()],pitfalls:vec![],verification:vec![],confirmed:false,enabled:false,revision:1,community:false,favorite:false}}
 #[test]fn cleanup_collapses_untouched_duplicates_once(){
  let path=std::env::temp_dir().join(format!("synerixcode-candidate-cleanup-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut catalog=Catalog{starter_pack_version:1,ultragui_pack_version:2,..Default::default()};
  for n in 0..6 {let s=auto(&format!("task-a{n}"),"Back up the full current map, terrain and lighting");catalog.skills.insert(s.id.clone(),s);}
  for n in 0..4 {let s=auto(&format!("task-p{n}"),"Planning project work");catalog.skills.insert(s.id.clone(),s);}
  let mut edited=auto("task-a9","Back up the full current map, terrain and lighting");edited.revision=2;catalog.skills.insert(edited.id.clone(),edited);
  let mut starred=auto("task-p9","Planning project work");starred.favorite=true;catalog.skills.insert(starred.id.clone(),starred);
  let mut mine=skill();mine.id="mine".into();catalog.skills.insert(mine.id.clone(),mine);
  std::fs::write(&path,serde_json::to_vec(&catalog).unwrap()).unwrap();
  let store=Store::load(path.clone());let ids:Vec<&String>=store.data.skills.keys().collect();
  assert_eq!(ids.iter().filter(|id|id.starts_with("task-a")).count(),2,"one untouched copy plus the edited card");
  assert!(store.data.skills.contains_key("task-a9"));assert!(store.data.skills.contains_key("task-p9"));assert!(store.data.skills.contains_key("mine"));
  assert_eq!(ids.iter().filter(|id|id.starts_with("task-p")).count(),1);
  assert_eq!(store.data.candidate_cleanup_version,1);
  std::fs::remove_file(path).unwrap();
 }
 #[test]fn favourite_and_delete_all_keep_bundled_and_starred(){
  let path=std::env::temp_dir().join(format!("synerixcode-favourite-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut store=Store::load(path.clone());let bundled=store.data.skills.len();
  let mut a=skill();a.id="keep-me".into();store.request(&json!({"action":"save","skill":a,"revision":0})).unwrap();
  let mut b=skill();b.id="drop-me".into();store.request(&json!({"action":"save","skill":b,"revision":0})).unwrap();
  let starred=store.request(&json!({"action":"favorite","id":"keep-me","favorite":true})).unwrap();assert_eq!(starred["skill"]["favorite"],true);assert_eq!(starred["skill"]["revision"],1,"starring is not an edit");
  store.request(&json!({"action":"favorite","id":"starter-syphodev-roblox-code","favorite":true})).unwrap();
  let mut edited=store.data.skills["keep-me"].clone();edited.description="changed".into();edited.favorite=false;store.request(&json!({"action":"save","skill":edited,"revision":1})).unwrap();
  assert!(store.data.skills["keep-me"].favorite,"saving from the editor keeps the star");
  let result=store.request(&json!({"action":"delete_all"})).unwrap();assert_eq!(result["removed"],1);assert_eq!(result["kept"],bundled+1);
  let reloaded=Store::load(path.clone());assert!(reloaded.data.skills.contains_key("keep-me"));assert!(!reloaded.data.skills.contains_key("drop-me"));
  assert_eq!(reloaded.data.skills.keys().filter(|id|id.starts_with("starter-syphodev-")).count(),11);assert!(reloaded.data.skills["starter-syphodev-roblox-code"].favorite);
  assert!(public(&reloaded.data.skills["keep-me"]).get("favorite").is_none());
  let _=std::fs::remove_file(path.with_extension("json.backup"));std::fs::remove_file(path).unwrap();
 }
 #[test]fn matching_ignores_filler_words(){
  let path=std::env::temp_dir().join(format!("synerixcode-match-words-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut store=Store::load(path.clone());
  let mut shop=skill();shop.id="shop".into();shop.title="Sword shop".into();shop.description="Shop UI with prices".into();shop.scope=String::new();store.request(&json!({"action":"save","skill":shop,"revision":0})).unwrap();
  let hit=store.request(&json!({"action":"match","query":"please make the and for with this game","domain":"roblox","scope":""})).unwrap();
  assert!(!hit["skills"].as_array().unwrap().iter().any(|s|s["id"]=="shop"),"filler words alone never match");
  let hit=store.request(&json!({"action":"match","query":"add a shop","domain":"roblox","scope":""})).unwrap();
  assert!(hit["skills"].as_array().unwrap().iter().any(|s|s["id"]=="shop"));
  let _=std::fs::remove_file(path.with_extension("json.backup"));std::fs::remove_file(path).unwrap();
 }

 #[test]fn favourites_get_priority_in_matching(){
  let path=std::env::temp_dir().join(format!("synerixcode-favourite-match-{}.json",std::process::id()));let _=std::fs::remove_file(&path);
  let mut store=Store::load(path.clone());
  for (id,title) in [("a","Shop layout one"),("b","Shop layout two"),("c","Shop layout three"),("d","Shop layout four")]{let mut s=skill();s.id=id.into();s.title=title.into();s.description="shop".into();s.scope=String::new();store.request(&json!({"action":"save","skill":s,"revision":0})).unwrap();}
  let ids=|store:&mut Store|store.request(&json!({"action":"match","query":"shop layout","domain":"roblox","scope":""})).unwrap()["skills"].as_array().unwrap().iter().map(|s|s["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
  assert!(!ids(&mut store).contains(&"d".to_string()));
  store.request(&json!({"action":"favorite","id":"d","favorite":true})).unwrap();
  assert_eq!(ids(&mut store)[0],"d","a starred skill is ranked first");
  let mut candidate=skill();candidate.id="starred-candidate".into();candidate.title="Shop pricing".into();candidate.confirmed=false;candidate.verification.clear();candidate.scope=String::new();store.request(&json!({"action":"save","skill":candidate,"revision":0})).unwrap();
  assert!(!store.request(&json!({"action":"match","query":"pricing","domain":"roblox","scope":""})).unwrap()["skills"].as_array().unwrap().iter().any(|s|s["id"]=="starred-candidate"));
  store.request(&json!({"action":"favorite","id":"starred-candidate","favorite":true})).unwrap();
  assert!(store.request(&json!({"action":"match","query":"pricing","domain":"roblox","scope":""})).unwrap()["skills"].as_array().unwrap().iter().any(|s|s["id"]=="starred-candidate"),"starring a skill makes it eligible");
  let mut unrelated=skill();unrelated.id="starred-unrelated".into();unrelated.title="Tabs for indentation".into();unrelated.description="Coding style".into();unrelated.steps=vec!["Indent with tabs".into()];unrelated.confirmed=false;unrelated.scope=String::new();store.request(&json!({"action":"save","skill":unrelated,"revision":0})).unwrap();store.request(&json!({"action":"favorite","id":"starred-unrelated","favorite":true})).unwrap();
  for id in ["a","b","c"]{store.request(&json!({"action":"favorite","id":id,"favorite":true})).unwrap();}
  let mut other=skill();other.id="plain-match".into();other.title="Shop layout five".into();other.scope=String::new();store.request(&json!({"action":"save","skill":other,"revision":0})).unwrap();
  let got=ids(&mut store);
  for id in ["a","b","c","d","starred-unrelated"]{assert!(got.contains(&id.to_string()),"favourite {id} is always used");}
  assert!(got.contains(&"plain-match".to_string()),"other matches still follow the favourites");
  assert!(got.iter().position(|id|id=="plain-match").unwrap()>4,"favourites come first");
  let blender=store.request(&json!({"action":"match","query":"anything","domain":"blender","scope":""})).unwrap()["skills"].as_array().unwrap().iter().map(|s|s["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
  assert!(!blender.contains(&"d".to_string()),"a Roblox favourite is not used for Blender work");
  let _=std::fs::remove_file(path.with_extension("json.backup"));std::fs::remove_file(path).unwrap();
 }
}

#[cfg(test)] mod deleted_skills_tests {
 use super::*;
 fn path(name:&str)->PathBuf {let p=std::env::temp_dir().join(format!("synerixcode-trash-{name}-{}.json",std::process::id()));for suffix in ["json","json.backup","json.tmp","json.backup.tmp"]{let _=std::fs::remove_file(p.with_extension(suffix));}p}
 fn skill(id:&str)->Value {json!({"id":id,"title":"Reusable method","description":"TRASH_BODY_MUST_NOT_SURVIVE_PURGE","domain":"roblox","scope":"project:A","steps":["Inspect before editing"],"pitfalls":["Keep unrelated state"],"verification":["Run a real test"],"confirmed":true,"enabled":true,"favorite":true})}
 #[test]fn delete_reload_restore_preserves_method_and_rejects_stale_operations(){
  let path=path("restore");let mut store=Store::load(path.clone());store.request(&json!({"action":"save","skill":skill("mine")})).unwrap();
  store.request(&json!({"action":"delete","id":"mine","revision":1})).unwrap();
  assert!(!store.data.skills.contains_key("mine"));let d=&store.data.deleted["mine"];assert_eq!(d.skill.revision,2);assert!(d.deleted_at>0);assert!(d.skill.favorite&&d.skill.enabled&&d.skill.confirmed);assert_eq!(d.skill.scope,"project:A");
  let hit=store.request(&json!({"action":"match","query":"method","domain":"roblox","scope":"project:A"})).unwrap();assert!(!hit["skills"].as_array().unwrap().iter().any(|s|s["id"]=="mine"));
  let mut store=Store::load(path.clone());assert!(store.request(&json!({"action":"restore","id":"mine","revision":1})).is_err());
  let restored=store.request(&json!({"action":"restore","id":"mine","revision":2})).unwrap();assert_eq!(restored["skill"]["revision"],3);assert_eq!(restored["skill"]["pitfalls"][0],"Keep unrelated state");assert!(store.data.deleted.is_empty());
  store.request(&json!({"action":"delete","id":"mine","revision":3})).unwrap();assert!(store.request(&json!({"action":"purge","id":"mine","revision":2,"confirm":true})).is_err());assert!(store.data.deleted.contains_key("mine"));
  let _=std::fs::remove_file(path);
 }
 #[test]fn permanent_delete_requires_confirmation_and_redacts_app_backup(){
  let path=path("purge");let mut store=Store::load(path.clone());store.request(&json!({"action":"save","skill":skill("mine")})).unwrap();store.request(&json!({"action":"delete","id":"mine","revision":1})).unwrap();
  assert!(store.request(&json!({"action":"purge","id":"mine","revision":2})).is_err());assert!(store.data.deleted.contains_key("mine"));
  store.request(&json!({"action":"purge","id":"mine","revision":2,"confirm":true})).unwrap();
  assert!(!std::fs::read_to_string(&path).unwrap().contains("TRASH_BODY_MUST_NOT_SURVIVE_PURGE"));assert!(!std::fs::read_to_string(path.with_extension("json.backup")).unwrap().contains("TRASH_BODY_MUST_NOT_SURVIVE_PURGE"));
  let mut store=Store::load(path.clone());assert!(store.request(&json!({"action":"restore","id":"mine","revision":2})).is_err());assert!(store.data.suppressed.contains("mine"));let _=std::fs::remove_file(path);
 }
 #[test]fn bulk_purge_is_revision_checked_and_never_deletes_active_skills(){
  let path=path("bulk");let mut store=Store::load(path.clone());let mut a=skill("removed");a["favorite"]=false.into();store.request(&json!({"action":"save","skill":a})).unwrap();store.request(&json!({"action":"save","skill":skill("keep-starred")})).unwrap();
  store.request(&json!({"action":"delete_all"})).unwrap();assert!(store.data.deleted.contains_key("removed"));assert!(store.data.skills.contains_key("keep-starred"));let revision=store.data.trash_revision;
  assert!(store.request(&json!({"action":"purge_all","trash_revision":revision})).is_err());assert!(store.request(&json!({"action":"purge_all","trash_revision":revision+1,"confirm":true})).is_err());
  let result=store.request(&json!({"action":"purge_all","trash_revision":revision,"confirm":true})).unwrap();assert_eq!(result["purged"],1);assert!(store.data.deleted.is_empty());assert!(store.data.skills.contains_key("keep-starred"));let _=std::fs::remove_file(path);
 }
 #[test]fn legacy_catalog_adds_empty_trash_without_losing_skills(){let legacy=json!({"skills":{"mine":skill("mine")},"starter_pack_version":1,"ultragui_pack_version":2});let data:Catalog=serde_json::from_value(legacy).unwrap();assert!(data.skills.contains_key("mine"));assert!(data.deleted.is_empty());assert_eq!(data.trash_revision,0);}
}
