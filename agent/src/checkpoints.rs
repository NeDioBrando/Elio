// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::workspace::Workspace;

const FILE_LIMIT: u64 = 4 * 1024 * 1024;
const STORE_LIMIT: usize = 24 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct FileChange { path: String, before: Option<Vec<u8>>, after: Option<Vec<u8>> }
#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptChange { pub path:String, pub class:String, pub before:String, pub after:String, pub studio_id:Value, pub session:String }
pub static SNAPSHOT_SESSION:once_cell::sync::Lazy<String>=once_cell::sync::Lazy::new(||format!("{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
#[derive(Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default)] pub request: String,
    pub id: String, pub label: String, pub engine: String, pub chat: String,
    #[serde(default)] pub approved: bool,
    pub status: String, pub started: String, pub ended: String,
    #[serde(default)] pub workspace: String,
    #[serde(default)] pub learning: Vec<crate::shared_learning::Observation>,
    pub steps: Vec<String>, pub warnings: Vec<String>, files: Vec<FileChange>,
    pub waypoints: Vec<String>,
    #[serde(default)] pub scripts:Vec<ScriptChange>,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Journal { #[serde(default)] pub projects: std::collections::HashMap<String,String>, tasks: Vec<Task>, #[serde(default)] pub protected: Vec<String>, #[serde(skip)] path: PathBuf }
pub static STORE: once_cell::sync::Lazy<tokio::sync::Mutex<Journal>> = once_cell::sync::Lazy::new(|| {
    let root = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"));
    tokio::sync::Mutex::new(Journal::load(root.join("synerixcode").join("checkpoints.json")))
});
impl Journal {
    fn load(path: PathBuf) -> Self {
        let mut journal: Self = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        journal.path = path;
        for task in &mut journal.tasks {
            if task.status == "working" { task.status = "interrupted".into(); }
            if task.engine == "roblox" && !task.waypoints.is_empty() {
                task.warnings.push("Studio undo checkpoints belong to the previous bridge session and cannot be restored here.".into());
            }
        }
        journal
    }
    fn bytes(&self) -> usize { self.tasks.iter().map(|t|t.files.iter().map(|f|f.before.as_ref().map_or(0,Vec::len)+f.after.as_ref().map_or(0,Vec::len)).sum::<usize>()+t.scripts.iter().map(|s|s.before.len()+s.after.len()).sum::<usize>()).sum() }
    pub fn save(&mut self) -> anyhow::Result<()> {
        while self.tasks.len() > 30 || self.bytes() > STORE_LIMIT {
            let Some(index) = self.tasks.iter().position(|t| t.status != "working") else { anyhow::bail!("Checkpoint storage is full; finish active tasks first."); };
            self.tasks.remove(index);
        }
        if let Some(parent) = self.path.parent() { std::fs::create_dir_all(parent)?; }
        let temp = self.path.with_extension("tmp");
        std::fs::write(&temp, serde_json::to_vec(self)?)?;
        std::fs::rename(temp, &self.path)?;
        Ok(())
    }
    pub fn begin(&mut self, req: &Value) -> anyhow::Result<String> {
        let engine = req["engine"].as_str().unwrap_or("roblox");
        anyhow::ensure!(matches!(engine, "local" | "roblox"), "Unknown checkpoint engine.");
        let id = format!("{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
        let original=req["label"].as_str().unwrap_or("Agent task").chars().take(100000).collect::<String>();
        let parent=req["resume_id"].as_str().and_then(|id|self.tasks.iter().find(|task|task.id==id && task.engine==engine && task.chat==req["chat"].as_str().unwrap_or("")));
        let approved=parent.map_or(false,|task|task.approved);
        self.tasks.push(Task { request:original, id: id.clone(), label: req["label"].as_str().unwrap_or("Agent task").chars().take(240).collect(),
            approved, engine: engine.into(), chat: req["chat"].as_str().unwrap_or("").chars().take(1000).collect(), status: "working".into(),
            started: chrono::Utc::now().to_rfc3339(), ended: String::new(), workspace: String::new(), learning:Vec::new(), steps: Vec::new(), warnings: Vec::new(), files: Vec::new(), waypoints: Vec::new(),scripts:Vec::new() });
        self.save()?; Ok(id)
    }
    pub fn task(&self, id: &str) -> anyhow::Result<&Task> { self.tasks.iter().find(|t| t.id == id).ok_or_else(|| anyhow::anyhow!("Task checkpoint not found.")) }
    pub fn task_mut(&mut self, id: &str) -> anyhow::Result<&mut Task> { self.tasks.iter_mut().find(|t| t.id == id).ok_or_else(|| anyhow::anyhow!("Task checkpoint not found.")) }
    pub fn finish(&mut self, id: &str, complete: bool) -> anyhow::Result<()> {
        let task = self.task_mut(id)?;
        if task.status == "working" { task.status = if complete { "worked" } else { "interrupted" }.into(); task.ended = chrono::Utc::now().to_rfc3339(); }
        self.save()
    }
    pub fn summaries(&self) -> Value {
        Value::Array(self.tasks.iter().rev().map(|t| json!({"id":t.id,"label":t.label,"engine":t.engine,"chat":t.chat,"status":t.status,"started":t.started,"ended":t.ended,"steps":t.steps,"warnings":t.warnings,
            "changes":t.files.iter().map(|f| json!({"path":f.path,"kind":if f.before.is_none(){"created"}else if f.after.is_none(){"deleted"}else{"edited"},"before_bytes":f.before.as_ref().map_or(0,Vec::len),"after_bytes":f.after.as_ref().map_or(0,Vec::len)})).chain(t.scripts.iter().map(|s|json!({"path":s.path,"kind":"script","before_bytes":s.before.len(),"after_bytes":s.after.len()}))).collect::<Vec<_>>(),
            "can_revert":t.status != "working" && t.status != "reverted" && t.warnings.is_empty() && (!t.files.is_empty() || !t.waypoints.is_empty()),"can_resume":t.status=="interrupted"})).collect())
    }
    pub fn warn(&mut self, id: &str, message: &str) {
        if let Ok(task) = self.task_mut(id) { if task.warnings.len()<12 && !task.warnings.iter().any(|s| s == message) { task.warnings.push(message.into()); } }
    }
    pub fn step(&mut self, id: &str, name: &str) {
        if let Ok(task) = self.task_mut(id) { if task.steps.len() < 100 { task.steps.push(name.chars().take(100).collect()); } }
    }
    pub fn project(&self,chat:&str)->&str {self.projects.get(chat).map(String::as_str).unwrap_or("")}
    pub fn set_project(&mut self,req:&Value)->anyhow::Result<()> {
        let chat=req["chat"].as_str().unwrap_or("");let project=req["project"].as_str().unwrap_or("").trim();
        anyhow::ensure!(!chat.is_empty() && !chat.ends_with('|') && chat.len()<=1000 && project.chars().count()<=80,"Open a saved chat and enter a project name up to 80 characters.");
        if project.is_empty(){self.projects.remove(chat);}else{anyhow::ensure!(self.projects.len()<500 || self.projects.contains_key(chat),"Project chat assignments are full.");self.projects.insert(chat.into(),project.into());}self.save()
    }
    pub fn protect(&mut self, req:&Value) -> anyhow::Result<()> {
        let engine=req["engine"].as_str().unwrap_or("local");
        let path=req["path"].as_str().unwrap_or("").trim();
        anyhow::ensure!(matches!(engine,"local"|"roblox") && !path.is_empty() && path.len()<=500,"Choose an engine and a path.");
        let value=format!("{engine}:{path}");
        if req["remove"].as_bool()==Some(true){self.protected.retain(|p|p!=&value);}else if !self.protected.contains(&value){anyhow::ensure!(self.protected.len()<50,"At most 50 protected paths.");self.protected.push(value);}
        self.save()
    }
    pub fn check_protection(&self, ws:&Workspace, id:&str, engine:&str, name:&str, args:&Value) -> anyhow::Result<()> {
        if self.task(id)?.approved{return Ok(());}
        let prefix=format!("{engine}:");
        for protected in self.protected.iter().filter_map(|p|p.strip_prefix(&prefix)) {
            if engine=="roblox" {anyhow::bail!("Protected Studio systems: approve this task in Tasks before any mutating Studio command.");}
            if name=="run_command" {anyhow::bail!("Protected workspace systems: commands require task approval because their write targets cannot be predicted.");}
            for key in ["path","source","destination"] {
                if let Some(raw)=args[key].as_str(){let target=ws.resolve_path(raw,false).map_err(anyhow::Error::msg)?;let boundary=ws.resolve_path(protected,false).map_err(anyhow::Error::msg)?;
                    anyhow::ensure!(!target.starts_with(&boundary) && !boundary.starts_with(&target),"Protected path: {protected}. Approve this task in Tasks before changing it.");}
            }
        }
        Ok(())
    }
    pub fn prepare_files(&mut self, ws: &Workspace, id: &str, name: &str, args: &Value) -> anyhow::Result<Vec<String>> {
        anyhow::ensure!(self.task(id)?.status == "working" && self.task(id)?.engine == "local", "Checkpoint task is not active for AgentScript.");
        let root=ws.root_display();
        let task=self.task_mut(id)?;
        anyhow::ensure!(task.workspace.is_empty() || task.workspace==root,"Task belongs to a different workspace.");
        task.workspace=root;
        self.step(id, name);
        if matches!(name,"write_file"|"edit_file"|"delete_path"|"download_file"|"move_path"|"create_folder"|"run_command"){self.check_protection(ws,id,"local",name,args)?;}
        let keys: &[&str] = match name { "write_file" | "edit_file" | "delete_path" | "download_file" => &["path"], "move_path" => &["source", "destination"], _ => &[] };
        if name=="run_command" {self.check_protection(ws,id,"local",name,args)?;}
        if keys.is_empty() {
            if matches!(name, "run_command" | "create_folder" | "process_kill" | "key_type" | "mouse_click") { self.warn(id, "This task includes commands, folders or external side effects without a complete inverse. Revert is disabled for the whole task.");self.save()?; }
            return Ok(Vec::new());
        }
        if name=="move_path" && args["destination"].as_str().and_then(|p|ws.resolve_path(p,false).ok()).map_or(false,|p|p.is_dir()) {
            self.warn(id,"Move into an existing directory has no complete checkpoint; task revert is disabled.");return Ok(Vec::new());
        }
        if !keys.is_empty() {self.check_protection(ws,id,"local",name,args)?;}
        let mut paths = Vec::new();
        for key in keys {
            let Some(raw) = args[*key].as_str() else { continue; };
            let resolved = ws.resolve_path(raw, false).map_err(anyhow::Error::msg)?;
            let path = ws.display(&resolved);
            let before = match read(&resolved) { Ok(bytes) => bytes, Err(_) => { self.warn(id, "A changed target is a folder, symlink or larger than 4 MB; this task cannot be safely reverted automatically."); continue; } };
            let task = self.task_mut(id)?;
            if let Some(existing) = task.files.iter().find(|f| f.path == path) {
                if existing.after != before { self.warn(id, "A file changed outside this task between steps. Revert is disabled to protect those edits."); }
            } else { task.files.push(FileChange { path: path.clone(), before: before.clone(), after: before }); }
            paths.push(path);
        }
        self.save()?; Ok(paths)
    }
    pub fn commit_files(&mut self, ws: &Workspace, id: &str, paths: &[String]) -> anyhow::Result<()> {
        if paths.is_empty(){return Ok(());}
        for path in paths {
            match ws.resolve_path(path,false).map_err(anyhow::Error::msg).and_then(|p|read(&p)) {
                Ok(after) => if let Some(file) = self.task_mut(id)?.files.iter_mut().find(|f| &f.path == path) { file.after = after; },
                Err(_) => self.warn(id, "A target could not be verified after execution. Revert is disabled."),
            }
        }
        self.task_mut(id)?.files.retain(|f| f.before != f.after);
        self.save()
    }
    pub fn record_script(&mut self,id:&str,before:&Value,after:&Value,studio_id:Value)->anyhow::Result<()> {
        let path=before["path"].as_str().ok_or_else(||anyhow::anyhow!("Snapshot path missing"))?;
        let class=before["class"].as_str().unwrap_or("");let source=before["source"].as_str().unwrap_or("");let changed=after["source"].as_str().ok_or_else(||anyhow::anyhow!("Snapshot source missing"))?;
        anyhow::ensure!(before["synerixcode_script"]==true && after["synerixcode_script"]==true && after["path"]==path && after["class"]==class && source.len()<=FILE_LIMIT as usize && changed.len()<=FILE_LIMIT as usize,"Script identity or snapshot size changed.");
        let task=self.task_mut(id)?;
        if let Some(existing)=task.scripts.iter_mut().find(|s|s.path==path&&s.studio_id==studio_id){anyhow::ensure!(existing.after==source,"Script changed outside this task; selective snapshot not updated.");existing.after=changed.into();}
        else{anyhow::ensure!(task.scripts.len()<40,"At most 40 script snapshots per task.");task.scripts.push(ScriptChange{path:path.into(),class:class.into(),before:source.into(),after:changed.into(),studio_id,session:SNAPSHOT_SESSION.clone()});}
        task.scripts.retain(|s|s.before!=s.after);self.save()
    }
    pub fn details(&self, id: &str) -> anyhow::Result<Value> {
        let task=self.task(id)?;let idle=task.status!="working"&&task.status!="reverted";
        let mut files=task.files.iter().take(40).map(|f|json!({"path":f.path,"kind":"local","can_restore":idle&&task.warnings.is_empty(),"before":f.before.as_ref().and_then(|b|std::str::from_utf8(b).ok()).map(|s|s.chars().take(12000).collect::<String>()),"after":f.after.as_ref().and_then(|b|std::str::from_utf8(b).ok()).map(|s|s.chars().take(12000).collect::<String>()),"preview_limited":f.before.as_ref().map_or(false,|b|b.len()>12000)||f.after.as_ref().map_or(false,|b|b.len()>12000)})).collect::<Vec<_>>();
        files.extend(task.scripts.iter().take(40).map(|s|json!({"path":s.path,"kind":"roblox","studio_id":s.studio_id,"can_restore":idle&&s.session==*SNAPSHOT_SESSION,"before":s.before.chars().take(12000).collect::<String>(),"after":s.after.chars().take(12000).collect::<String>(),"preview_limited":s.before.len()>12000||s.after.len()>12000})));
        Ok(json!({"id":id,"request":task.request,"files":files}))
    }
    pub fn revert_file(&mut self,ws:&Workspace,id:&str,path:&str)->anyhow::Result<()> {
        let task=self.task(id)?;anyhow::ensure!(task.engine=="local"&&task.status!="working"&&task.status!="reverted"&&task.warnings.is_empty(),"Selective file restore is unavailable for this task.");
        anyhow::ensure!(task.workspace==ws.root_display(),"Return to this task's workspace.");
        let file=task.files.iter().find(|f|f.path==path).cloned().ok_or_else(||anyhow::anyhow!("File snapshot not found."))?;
        let resolved=ws.resolve_path(path,false).map_err(anyhow::Error::msg)?;anyhow::ensure!(read(&resolved)?==file.after,"Conflict: file changed after this task. Nothing restored.");
        write(&resolved,&file.before)?;self.task_mut(id)?.files.retain(|f|f.path!=path);self.save()
    }
    pub fn revert_files(&mut self, ws: &Workspace, id: &str) -> anyhow::Result<()> {
        let task = self.task(id)?.clone();
        anyhow::ensure!(task.engine == "local" && task.status != "working" && task.status != "reverted" && task.warnings.is_empty(), "This task cannot be safely reverted.");
        anyhow::ensure!(!task.files.is_empty(), "No checkpointed file changes.");
        anyhow::ensure!(task.workspace==ws.root_display(),"Return to the workspace where this task ran.");
        let mut resolved = Vec::new();
        for file in &task.files {
            let path = ws.resolve_path(&file.path, false).map_err(anyhow::Error::msg)?;
            anyhow::ensure!(read(&path)? == file.after, "Conflict: {} changed after this task. Nothing was reverted.", file.path);
            resolved.push(path);
        }
        let mut applied = 0;
        for (file, path) in task.files.iter().zip(&resolved) {
            if let Err(error) = write(path, &file.before) {
                let mut rollback_error = None;
                for (old, old_path) in task.files.iter().zip(&resolved).take(applied).rev() { if let Err(e)=write(old_path,&old.after){rollback_error=Some(e);} }
                anyhow::bail!("Restore failed: {error}. Rollback: {}", rollback_error.map_or("completed".into(),|e|e.to_string()));
            }
            applied += 1;
        }
        self.task_mut(id)?.status = "reverted".into(); self.save()
    }
}
fn read(path: &PathBuf) -> anyhow::Result<Option<Vec<u8>>> {
    let meta = match std::fs::symlink_metadata(path) { Ok(meta)=>meta, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None), Err(e)=>return Err(e.into()) };
    anyhow::ensure!(meta.is_file() && !meta.file_type().is_symlink() && meta.len() <= FILE_LIMIT, "Unsupported checkpoint target.");
    Ok(Some(std::fs::read(path)?))
}
fn write(path: &PathBuf, bytes: &Option<Vec<u8>>) -> anyhow::Result<()> {
    match bytes { Some(bytes)=>{ if let Some(parent)=path.parent(){std::fs::create_dir_all(parent)?;} std::fs::write(path,bytes)?; }, None=>{ if path.exists(){std::fs::remove_file(path)?;} } }
    Ok(())
}
pub fn script_target(path:&str)->String {
    let raw=serde_json::to_string(path).unwrap();
    format!("local Path={raw}\nlocal Target=game\nPath=Path:gsub('^game%.','')\nfor Name in Path:gmatch('[^%.]+') do local Found=nil for _,Child in Target:GetChildren() do if Child.Name==Name then if Found then error('Ambiguous script path') end Found=Child end end if not Found then error('Script path missing') end Target=Found end\nif not Target:IsA('LuaSourceContainer') then error('Target is not a script') end\n")
}
pub fn script_snapshot(path:&str)->String {format!("{}if #Target.Source>4194304 then error('Script snapshot exceeds 4 MB') end\nreturn game:GetService('HttpService'):JSONEncode({{synerixcode_script=true,path=Target:GetFullName(),class=Target.ClassName,source=Target.Source}})",script_target(path))}
pub fn script_restore(snapshot:&ScriptChange)->String {
    let payload=serde_json::to_string(&json!({"before":snapshot.before,"after":snapshot.after,"class":snapshot.class})).unwrap();let literal=serde_json::to_string(&payload).unwrap();
    format!("if game:GetService('RunService'):IsRunning() then error('Stop Play before restoring a script') end\n{}local Snapshot=game:GetService('HttpService'):JSONDecode({literal})\nif Target.ClassName~=Snapshot.class or Target.Source~=Snapshot.after then error('Conflict: script changed after this task. Nothing restored.') end\nlocal History=game:GetService('ChangeHistoryService')\nHistory:SetWaypoint('Before synerixcode selective script restore')\nTarget.Source=Snapshot.before\nHistory:SetWaypoint('synerixcode selective script restore')\nreturn 'SYNERIXCODE_SCRIPT_RESTORED'",script_target(&snapshot.path))
}
pub fn parse_snapshot(text:&str)->Option<Value>{let a=text.find('{')?;let z=text.rfind('}')?;let value:Value=serde_json::from_str(&text[a..=z]).ok()?;(value["synerixcode_script"]==true).then_some(value)}
pub fn studio_mark(label: &str) -> String {
    format!("local Chs=game:GetService('ChangeHistoryService')\nif game:GetService('RunService'):IsRunning() then error('Stop Play before checkpointing') end\nChs:SetWaypoint({})\nlocal Available,Name=Chs:GetCanUndo()\nreturn game:GetService('HttpService'):JSONEncode({{available=Available,name=Name}})", serde_json::to_string(label).unwrap())
}
pub fn studio_revert(labels: &[String]) -> String {
    let labels = serde_json::to_string(labels).unwrap();
    format!("local Chs=game:GetService('ChangeHistoryService')\nif game:GetService('RunService'):IsRunning() then error('Stop Play before reverting') end\nlocal Labels=game:GetService('HttpService'):JSONDecode([==[{labels}]==])\nlocal Undone=0\nfor Index=#Labels,1,-1 do\n local Available,Name=Chs:GetCanUndo()\n if not Available or Name~=Labels[Index] then\n  for Restore=1,Undone do Chs:Redo() end\n  error('Conflict: Studio history changed. Task restore cancelled.')\n end\n Chs:Undo()\n Undone+=1\nend\nreturn 'SYNERIXCODE_TASK_REVERTED'")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn selective_restore_preserves_other_files_and_rejects_conflicts() {
        let dir=std::env::temp_dir().join(format!("synerixcode-selective-{}",std::process::id()));let ws=Workspace::new(dir.to_str()).unwrap();let mut j=Journal::load(dir.join("history.json"));let id=j.begin(&json!({"engine":"local"})).unwrap();
        for name in ["a.lua","b.lua"]{std::fs::write(dir.join(name),b"before").unwrap();let paths=j.prepare_files(&ws,&id,"edit_file",&json!({"path":name})).unwrap();std::fs::write(dir.join(name),b"after").unwrap();j.commit_files(&ws,&id,&paths).unwrap();}
        j.finish(&id,true).unwrap();std::fs::write(dir.join("a.lua"),b"manual").unwrap();assert!(j.revert_file(&ws,&id,"a.lua").is_err());assert_eq!(std::fs::read(dir.join("b.lua")).unwrap(),b"after");
        j.revert_file(&ws,&id,"b.lua").unwrap();assert_eq!(std::fs::read(dir.join("a.lua")).unwrap(),b"manual");assert_eq!(std::fs::read(dir.join("b.lua")).unwrap(),b"before");assert_eq!(Journal::load(dir.join("history.json")).task(&id).unwrap().files.len(),1);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn studio_source_snapshots_preserve_literals_and_refuse_changed_identity() {
        let dir=std::env::temp_dir().join(format!("synerixcode-script-snapshot-{}",std::process::id()));let mut j=Journal::load(dir.join("journal.json"));let id=j.begin(&json!({"engine":"roblox"})).unwrap();
        let before=json!({"synerixcode_script":true,"path":"ServerScriptService.Exact","class":"Script","source":"local x = \" ]==] \"\n"});let mut after=before.clone();after["source"]=json!("local x = 2");j.record_script(&id,&before,&after,json!("studio-exact")).unwrap();
        let snapshot=&j.task(&id).unwrap().scripts[0];assert_eq!(snapshot.before,before["source"]);let code=script_restore(snapshot);assert!(code.find("Target.Source~=Snapshot.after").unwrap()<code.find("Target.Source=Snapshot.before").unwrap());assert!(code.contains("IsRunning()"));assert!(code.contains("Ambiguous script path"));assert!(parse_snapshot(&format!("Result: {}",before)).is_some());
        let mut wrong=after.clone();wrong["path"]=json!("ServerScriptService.Other");assert!(j.record_script(&id,&before,&wrong,json!("studio-exact")).is_err());assert!(j.record_script(&id,&before,&after,json!("studio-exact")).is_err());j.finish(&id,true).unwrap();assert_eq!(j.details(&id).unwrap()["files"][0]["kind"],"roblox");std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn checkpoint_survives_restart_and_refuses_later_edits() {
        let dir=std::env::temp_dir().join(format!("synerixcode-checkpoint-test-{}",std::process::id()));let _=std::fs::remove_dir_all(&dir);
        let ws=Workspace::new(dir.to_str()).unwrap(); let path=dir.join("code.txt");std::fs::write(&path,b"before\r\n").unwrap();
        let mut journal=Journal::load(dir.join("history.json"));let id=journal.begin(&json!({"engine":"local"})).unwrap();
        let paths=journal.prepare_files(&ws,&id,"edit_file",&json!({"path":"code.txt"})).unwrap();std::fs::write(&path,b"after\r\n").unwrap();journal.commit_files(&ws,&id,&paths).unwrap();journal.finish(&id,true).unwrap();
        let mut journal=Journal::load(dir.join("history.json"));std::fs::write(&path,b"manual").unwrap();assert!(journal.revert_files(&ws,&id).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"manual");
        std::fs::write(&path,b"after\r\n").unwrap();journal.revert_files(&ws,&id).unwrap();assert_eq!(std::fs::read(&path).unwrap(),b"before\r\n");let _=std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn multifile_restore_is_prevalidated_and_protection_persists() {
        let dir=std::env::temp_dir().join(format!("synerixcode-checkpoint-multi-{}",std::process::id()));let _=std::fs::remove_dir_all(&dir);
        let ws=Workspace::new(dir.to_str()).unwrap();let a=dir.join("a.txt");let b=dir.join("b.txt");std::fs::write(&a,b"original").unwrap();
        let mut journal=Journal::load(dir.join("history.json"));let id=journal.begin(&json!({"engine":"local","chat":"chatgpt|/c/a"})).unwrap();
        for path in ["a.txt","b.txt"] {let paths=journal.prepare_files(&ws,&id,"write_file",&json!({"path":path})).unwrap();std::fs::write(dir.join(path),b"changed").unwrap();journal.commit_files(&ws,&id,&paths).unwrap();}
        journal.finish(&id,true).unwrap();std::fs::write(&b,b"later edit").unwrap();assert!(journal.revert_files(&ws,&id).is_err());assert_eq!(std::fs::read(&a).unwrap(),b"changed");
        std::fs::write(&b,b"changed").unwrap();journal.revert_files(&ws,&id).unwrap();assert_eq!(std::fs::read(&a).unwrap(),b"original");assert!(!b.exists());
        journal.protect(&json!({"engine":"local","path":"a.txt"})).unwrap();journal.set_project(&json!({"chat":"chatgpt|/c/a","project":"Game A"})).unwrap();
        let mut reopened=Journal::load(dir.join("history.json"));assert_eq!(reopened.project("chatgpt|/c/a"),"Game A");assert_eq!(reopened.project("chatgpt|/c/b"),"");
        let id=reopened.begin(&json!({"engine":"local"})).unwrap();assert!(reopened.prepare_files(&ws,&id,"write_file",&json!({"path":"a.txt"})).is_err());assert!(reopened.prepare_files(&ws,&id,"run_command",&json!({"command":"echo hi"})).is_err());
        reopened.task_mut(&id).unwrap().approved=true;assert!(reopened.prepare_files(&ws,&id,"write_file",&json!({"path":"a.txt"})).is_ok());
        assert!(reopened.set_project(&json!({"chat":"chatgpt|","project":"bad"})).is_err());let _=std::fs::remove_dir_all(dir);
    }
    #[test]
    fn studio_restore_checks_every_waypoint_and_rolls_back_on_a_gap() {
        let code=studio_revert(&["synerixcode task-a 1".into(),"synerixcode task-a 2".into()]);
        assert!(code.contains("Name~=Labels[Index]"));assert!(code.contains("Chs:Redo()"));assert!(code.contains("IsRunning()"));
    }
}
