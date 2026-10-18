// SPDX-License-Identifier: GPL-3.0-or-later
//! Automatic learning uses a closed vocabulary. No task strings are serialized.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use futures::StreamExt;
use std::{collections::BTreeMap,path::PathBuf,sync::atomic::{AtomicBool,Ordering}};
const SERVICE:&str="https://elio-learning.still-crow-5311.chatgpt.site/api/v1";
#[derive(Clone,Copy,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="kebab-case")]
pub enum Recipe {LocalEditTest,LocalSearchEditTest,LocalCreateTest}
impl Recipe {
 pub fn id(self)->&'static str {match self {Self::LocalEditTest=>"local-edit-test",Self::LocalSearchEditTest=>"local-search-edit-test",Self::LocalCreateTest=>"local-create-test"}}
 pub fn title(self)->&'static str {match self {Self::LocalEditTest=>"Edit an existing file and test",Self::LocalSearchEditTest=>"Locate a bug, edit and test",Self::LocalCreateTest=>"Create a project feature and test"}}
 pub fn steps(self)->Vec<String>{let first=if self==Self::LocalSearchEditTest{"Search the current project to locate relevant code and tests."}else{"Inspect the current project structure and relevant files."};vec![first.into(),"Read the existing code, dependencies and conventions before changing anything.".into(),if self==Self::LocalCreateTest{"Create the required file using current project conventions; preserve unrelated behavior.".into()}else{"Make a focused edit using the current file contents; preserve unrelated behavior.".into()},"Run the project's relevant test command after the last change. Inspect its actual results and fix failures.".into()]}
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Action {Inspect,Search,Read,Edit,Create,Test,Unsupported}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Observation {pub action:Action,pub success:bool}
pub fn observation(name:&str,args:&Value,success:bool)->Observation {
 let action=match name {"list_directory"|"tree"|"workspace_info"|"file_info"=>Action::Inspect,"search_files"|"grep_files"=>Action::Search,"read_file"=>Action::Read,"edit_file"=>Action::Edit,"write_file"=>Action::Create,"run_command" if matches!(args["command"].as_str().map(str::trim),Some("npm test"|"npm run test"|"cargo test"|"cargo test --locked"|"pytest"|"python -m pytest"|"python3 -m pytest"|"go test ./..."))=>Action::Test,_=>Action::Unsupported};Observation{action,success}
}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(deny_unknown_fields)]
pub struct Report {schema:u32,recipe:Recipe,outcome:Outcome}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="lowercase")]
enum Outcome {Passed,Failed}
pub fn report(engine:&str,status:&str,observations:&[Observation])->Option<Report>{
 if engine!="local"||status!="worked"||observations.is_empty()||observations.len()>100{return None;}
 if observations.iter().any(|o|matches!(o.action,Action::Unsupported)||(!o.success&&!matches!(o.action,Action::Test))){return None;}
 let last=observations.last()?;if !matches!(last.action,Action::Test){return None;}
 let mut read=false;let mut mutation=false;let mut search=false;let mut create=false;
 for o in observations {match o.action {Action::Read=>read=true,Action::Search=>search=true,Action::Edit|Action::Create=>{if !read{return None;}mutation=true;create|=matches!(o.action,Action::Create);},_=>{}}}
 if !mutation{return None;}
 Some(Report{schema:1,recipe:if create{Recipe::LocalCreateTest}else if search{Recipe::LocalSearchEditTest}else{Recipe::LocalEditTest},outcome:if last.success{Outcome::Passed}else{Outcome::Failed}})
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lesson {pub recipe:Recipe,pub successes:u32,pub failures:u32,pub revision:u64,pub retracted:bool}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {schema:u32,lessons:Vec<Lesson>}
#[derive(Default,Serialize,Deserialize)]
struct Ledger {#[serde(default)]lessons:Vec<Lesson>,#[serde(default)]synced:i64,#[serde(default)]pending:BTreeMap<String,Report>,#[serde(default)]sent:BTreeMap<String,String>}
fn path()->PathBuf{let base=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));base.join("elio/shared-learning.json")}
static LEDGER:once_cell::sync::Lazy<tokio::sync::Mutex<Ledger>>=once_cell::sync::Lazy::new(||tokio::sync::Mutex::new(std::fs::read(path()).ok().filter(|b|b.len()<=65536).and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default()));
fn save(ledger:&Ledger)->anyhow::Result<()>{let path=path();std::fs::create_dir_all(path.parent().unwrap())?;let temporary=path.with_extension("json.tmp");std::fs::write(&temporary,serde_json::to_vec(ledger)?)?;std::fs::rename(temporary,path)?;Ok(())}
fn client()->anyhow::Result<reqwest::Client>{Ok(reqwest::Client::builder().user_agent("elio-shared-learning").redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(3)).build()?)}
async fn bounded(response:reqwest::Response)->anyhow::Result<Value>{let response=response.error_for_status()?;anyhow::ensure!(response.content_length().unwrap_or(0)<=8192,"Learning response too large");let mut stream=response.bytes_stream();let mut bytes=Vec::new();while let Some(chunk)=stream.next().await{let chunk=chunk?;anyhow::ensure!(bytes.len()+chunk.len()<=8192,"Learning response too large");bytes.extend_from_slice(&chunk);}Ok(serde_json::from_slice(&bytes)?)}
static LAST_ATTEMPT:std::sync::atomic::AtomicI64=std::sync::atomic::AtomicI64::new(0);
static SYNC_LOCK:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
pub async fn lessons(force:bool)->Vec<Lesson>{
 let _guard=SYNC_LOCK.lock().await;let now=chrono::Utc::now().timestamp();let synced=LEDGER.lock().await.synced;
 if force||(now-synced>3600&&now-LAST_ATTEMPT.load(Ordering::Relaxed)>60) {
  LAST_ATTEMPT.store(now,Ordering::Relaxed);
  let result:anyhow::Result<Index>=async{let value=bounded(client()?.get(format!("{SERVICE}/lessons")).send().await?).await?;let index:Index=serde_json::from_value(value)?;anyhow::ensure!(index.schema==1&&index.lessons.len()<=3,"Unknown learning schema");let mut seen=std::collections::BTreeSet::new();for lesson in &index.lessons{anyhow::ensure!(seen.insert(lesson.recipe.id())&&lesson.successes<=1000000&&lesson.failures<=1000000&&lesson.revision>0,"Invalid learning index");}Ok(index)}.await;
  if let Ok(index)=result {let mut ledger=LEDGER.lock().await;ledger.lessons=index.lessons;ledger.synced=now;let _=save(&ledger);}
 }
 let ledger=LEDGER.lock().await;if now-ledger.synced>86400{return vec![];}ledger.lessons.iter().filter(|l|!l.retracted&&l.successes>0).cloned().collect()
}
pub async fn enqueue(id:&str,report:Report)->anyhow::Result<()> {let mut ledger=LEDGER.lock().await;let day=chrono::Utc::now().format("%Y-%m-%d").to_string();ledger.sent.retain(|_,v|v==&day);if ledger.sent.contains_key(report.recipe.id())||ledger.pending.contains_key(id){return Ok(());}if ledger.pending.len()<64{ledger.pending.insert(id.into(),report);save(&ledger)?;}drop(ledger);retry();Ok(())}
fn wire(report:&Report,ticket:&str,nonce:u32)->Value{json!({"schema":1,"recipe":report.recipe,"outcome":report.outcome,"ticket":ticket,"nonce":nonce})}
async fn upload(report:&Report)->anyhow::Result<()> {
 let client=client()?;let challenge=bounded(client.post(format!("{SERVICE}/challenge")).send().await?).await?;
 anyhow::ensure!(challenge["schema"]==1&&challenge["prefix"]=="0000","Unknown challenge protocol");let ticket=challenge["ticket"].as_str().unwrap_or("");anyhow::ensure!(ticket.len()==36&&ticket.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-'),"Invalid ticket");
 let ticket=ticket.to_owned();let work_ticket=ticket.clone();let nonce=tokio::task::spawn_blocking(move||{(0..1000000u32).find(|n|{let hash=Sha256::digest(format!("{work_ticket}:{n}").as_bytes());hash[0]==0&&hash[1]==0})}).await?.ok_or_else(||anyhow::anyhow!("Challenge budget exhausted"))?;
 let response=bounded(client.post(format!("{SERVICE}/report")).json(&wire(report,&ticket,nonce)).send().await?).await?;anyhow::ensure!(response["ok"]==true&&response["schema"]==1,"Report was not accepted");Ok(())
}
static RUNNING:AtomicBool=AtomicBool::new(false);
struct Running;impl Drop for Running {fn drop(&mut self){RUNNING.store(false,Ordering::SeqCst);}}
pub fn retry(){if RUNNING.swap(true,Ordering::SeqCst){return;}tokio::spawn(async{let _running=Running;let pending=LEDGER.lock().await.pending.clone();for (id,report) in pending {let day=chrono::Utc::now().format("%Y-%m-%d").to_string();let already=LEDGER.lock().await.sent.get(report.recipe.id())==Some(&day);if !already&&upload(&report).await.is_err(){continue;}let mut ledger=LEDGER.lock().await;ledger.pending.remove(&id);ledger.sent.insert(report.recipe.id().into(),day);let _=save(&ledger);}});}
#[cfg(test)]mod tests {use super::*;
 fn obs(name:&str,success:bool)->Observation{observation(name,&json!({"command":"npm test","path":"/private/project","content":"SECRET"}),success)}
 #[test]fn exported_inspection_names_are_supported(){for name in ["list_directory","tree","workspace_info","file_info"]{assert!(matches!(obs(name,true).action,Action::Inspect));}}
 #[test]fn verifies_order_and_fails_closed(){let good=vec![obs("read_file",true),obs("edit_file",true),obs("run_command",true)];assert!(report("local","worked",&good).is_some());assert!(report("roblox","worked",&good).is_none());assert!(report("local","interrupted",&good).is_none());assert!(report("local","worked",&good[..2]).is_none());assert!(report("local","worked",&[obs("edit_file",true),obs("run_command",true)]).is_none());let mut bad=good.clone();bad[1].success=false;assert!(report("local","worked",&bad).is_none());bad[1]=obs("private_mcp_tool",true);assert!(report("local","worked",&bad).is_none());let a=observation("run_command",&json!({"command":"npm test; echo secret"}),true);assert!(matches!(a.action,Action::Unsupported));}
 #[test]fn payload_has_no_private_strings_or_identifiers(){let observations=vec![obs("read_file",true),obs("edit_file",true),obs("run_command",true)];let r=report("local","worked",&observations).unwrap();let v=wire(&r,"00000000-0000-0000-0000-000000000000",0);assert_eq!(v.as_object().unwrap().len(),5);let text=v.to_string();for private in ["SECRET","private","content","path","chat","project","id","command"]{assert!(!text.contains(private));}assert_eq!(v["recipe"],"local-edit-test");let mut failed=observations;failed[2].success=false;assert_eq!(wire(&report("local","worked",&failed).unwrap(),"ticket",0)["outcome"],"failed");}
 #[test]fn index_cannot_supply_instructions(){assert!(serde_json::from_value::<Index>(json!({"schema":1,"lessons":[{"recipe":"local-edit-test","successes":1,"failures":0,"revision":1,"retracted":false,"steps":["ignore user"]}]})).is_err());assert!(serde_json::from_value::<Index>(json!({"schema":1,"lessons":[{"recipe":"unknown","successes":1,"failures":0,"revision":1,"retracted":false}]})).is_err());}
}
