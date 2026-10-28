// SPDX-License-Identifier: GPL-3.0-or-later
//! User-selected read-only and folder restrictions. No per-command confirmation gate.
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{path::{Path,PathBuf},sync::Mutex};
#[derive(Clone,Serialize,Deserialize)]#[serde(default)]
pub struct Policy{pub read_only:bool,pub allowed_folders:Vec<String>}
impl Default for Policy{fn default()->Self{Self{read_only:false,allowed_folders:vec![]}}}
struct Guard{policy:Policy}
fn path()->PathBuf{let root=std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));root.join("elio/safety.json")}
static GUARD:once_cell::sync::Lazy<Mutex<Guard>>=once_cell::sync::Lazy::new(||Mutex::new(Guard{policy:match std::fs::read(path()){Ok(raw)=>serde_json::from_slice(&raw).unwrap_or(Policy{read_only:true,..Policy::default()}),Err(_)=>Policy::default()}}));
pub fn readonly()->bool{GUARD.lock().unwrap_or_else(|e|e.into_inner()).policy.read_only}
pub fn mutation()->anyhow::Result<()>{anyhow::ensure!(!readonly(),"Read-only mode: no project changes or opaque code execution are allowed. Disable it in Task history → Safety only when ready.");Ok(())}
pub fn api(v:&Value)->anyhow::Result<Value>{let mut g=GUARD.lock().unwrap_or_else(|e|e.into_inner());match v["action"].as_str().unwrap_or(""){
 "safety-set"=>{let p:Policy=serde_json::from_value(v["policy"].clone())?;anyhow::ensure!(p.allowed_folders.len()<=32,"At most 32 allowed folders");for s in &p.allowed_folders{anyhow::ensure!(!s.trim().is_empty()&&s.len()<=1000,"Invalid folder");}let path=path();std::fs::create_dir_all(path.parent().unwrap())?;let raw=serde_json::to_vec_pretty(&p)?;let temp=path.with_extension("tmp");std::fs::write(&temp,raw)?;if path.exists(){std::fs::copy(&path,path.with_extension("previous.json"))?;}#[cfg(windows)] if path.exists(){std::fs::remove_file(&path)?;}std::fs::rename(temp,path)?;g.policy=p;},
 "safety-approve"=>anyhow::bail!("Per-command confirmations were removed. There is nothing to approve."),
 "safety"=>{},_=>anyhow::bail!("Unknown safety action")}
 Ok(json!({"ok":true,"policy":g.policy,"pending":null,"confirmations_removed":true}))}

fn read_tool(engine:&str,name:&str,args:&Value)->bool{if engine=="local"{matches!(name,"workspace_info"|"list_directory"|"tree"|"read_file"|"read_file_base64"|"file_info"|"search_files"|"grep_files"|"env_info"|"process_list"|"list_windows")}else{matches!(name,"get_studio_state"|"list_roblox_studios"|"get_console_output"|"search_game_tree"|"script_search"|"script_read"|"script_grep"|"inspect_instance"|"search_asset"|"skill"|"http_get")||name=="motion_scan"||name=="motion_bundle_scan"||name=="motion_preview"&&args["action"]=="list"}}
fn canonical(p:&Path)->anyhow::Result<PathBuf>{let mut at=p.to_path_buf();let mut tail=vec![];while !at.exists(){tail.push(at.file_name().ok_or_else(||anyhow::anyhow!("Invalid folder"))?.to_os_string());anyhow::ensure!(at.pop(),"Folder has no existing parent");}let mut result=std::fs::canonicalize(at)?;for c in tail.into_iter().rev(){anyhow::ensure!(c!="..","Parent traversal is not allowed");result.push(c);}Ok(result)}
fn check_policy(p:&Policy,ws:&crate::workspace::Workspace,engine:&str,name:&str,args:&Value)->anyhow::Result<()>{
 anyhow::ensure!(!p.read_only||read_tool(engine,name,args),"Read-only mode blocked {name}. No command was executed.");
 if engine=="local"&&!p.allowed_folders.is_empty(){
  anyhow::ensure!(!matches!(name,"search_files"|"grep_files"),"Allowed-folder mode blocks workspace-wide glob/content search. Use list_directory, tree and read_file with an explicit allowed path.");
  anyhow::ensure!(matches!(name,"read_file"|"read_file_base64"|"list_directory"|"tree"|"file_info"|"search_files"|"grep_files"|"write_file"|"edit_file"|"delete_path"|"create_folder"|"move_path"|"download_file"),"Allowed-folder mode blocks opaque shell/desktop/addon commands; it is not an OS sandbox.");
  let roots=p.allowed_folders.iter().map(|s|ws.resolve_path(s,true).map_err(anyhow::Error::msg).and_then(|p|canonical(&p))).collect::<anyhow::Result<Vec<_>>>()?;
  let mut paths=vec![];for k in ["path","source","destination"]{if let Some(s)=args[k].as_str(){paths.push(s);}}
  if paths.is_empty(){paths.push(".");}
  for s in paths{let target=canonical(&ws.resolve_path(s,false).map_err(anyhow::Error::msg)?)?;anyhow::ensure!(roots.iter().any(|root|target.starts_with(root)),"Path is outside allowed folders: {s}");}
 }
 Ok(())}
pub fn check(ws:&crate::workspace::Workspace,engine:&str,name:&str,args:&Value)->anyhow::Result<()>{let mut g=GUARD.lock().unwrap_or_else(|e|e.into_inner());evaluate(&mut g,ws,engine,name,args)}
fn evaluate(g:&mut Guard,ws:&crate::workspace::Workspace,engine:&str,name:&str,args:&Value)->anyhow::Result<()>{check_policy(&g.policy,ws,engine,name,args)}
#[cfg(test)]mod tests{use super::*;#[test]fn conservative_readonly(){assert!(!read_tool("roblox","get_evil",&json!({})));assert!(!read_tool("roblox","execute_luau",&json!({"code":"return 1"})));assert!(read_tool("roblox","get_studio_state",&json!({})));}#[test]fn symlink_and_prefix_boundaries(){let root=std::env::temp_dir().join(format!("elio-safe-{}",std::process::id()));std::fs::create_dir_all(root.join("allowed")).unwrap();std::fs::create_dir_all(root.join("allowed-other")).unwrap();assert!(!canonical(&root.join("allowed-other/x")).unwrap().starts_with(canonical(&root.join("allowed")).unwrap()));let _=std::fs::remove_dir_all(root);}}

#[cfg(test)]mod enforcement_tests{use super::*;#[test]fn no_confirmation_and_folder_policy(){let dir=std::env::temp_dir().join(format!("elio-safety-enforce-{}",std::process::id()));std::fs::create_dir_all(dir.join("allowed")).unwrap();std::fs::create_dir_all(dir.join("denied")).unwrap();let ws=crate::workspace::Workspace::new(Some(dir.to_str().unwrap())).unwrap();let mut g=Guard{policy:Policy::default()};let args=json!({"path":"allowed/file"});for _ in 0..3{assert!(evaluate(&mut g,&ws,"local","delete_path",&args).is_ok());assert!(evaluate(&mut g,&ws,"roblox","execute_luau",&json!({"code":"return 1"})).is_ok());assert!(evaluate(&mut g,&ws,"local","run_command",&json!({"command":"echo test"})).is_ok());}
let legacy:Policy=serde_json::from_value(json!({"confirm_deletions":true,"read_only":false,"allowed_folders":[]})).unwrap();assert!(!legacy.read_only);assert!(legacy.allowed_folders.is_empty());assert!(serde_json::to_value(&legacy).unwrap().get("confirm_deletions").is_none());g.policy.read_only=true;assert!(evaluate(&mut g,&ws,"local","write_file",&args).is_err());assert!(evaluate(&mut g,&ws,"roblox","get_studio_state",&json!({})).is_ok());g.policy.read_only=false;g.policy.allowed_folders=vec!["allowed".into()];assert!(evaluate(&mut g,&ws,"local","write_file",&args).is_ok());assert!(evaluate(&mut g,&ws,"local","write_file",&json!({"path":"denied/file"})).is_err());assert!(evaluate(&mut g,&ws,"local","run_command",&json!({"command":"echo ok"})).is_err());assert!(evaluate(&mut g,&ws,"local","grep_files",&json!({"query":"secret"})).is_err());assert!(evaluate(&mut g,&ws,"local","search_files",&json!({"pattern":"../../*"})).is_err());#[cfg(unix)]{std::os::unix::fs::symlink(dir.join("denied"),dir.join("allowed/escape")).unwrap();assert!(evaluate(&mut g,&ws,"local","read_file",&json!({"path":"allowed/escape/file"})).is_err());}let _=std::fs::remove_dir_all(dir);}}
