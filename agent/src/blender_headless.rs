//! Owned, opt-in Blender process. No addon, window or continuous preview.
use serde_json::{json, Value};
use std::{path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::Mutex, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpStream};

#[derive(Clone)]
struct Config { executable: PathBuf, project: PathBuf, threads: u32, idle: u64 }
struct Worker { #[cfg(windows)] _job: Option<crate::blender_headless_job::OwnedJob>, child: Child, _stdin: ChildStdin, port: u16, token: String, id: String }
impl Drop for Worker { fn drop(&mut self) { let _=self.child.kill(); let _=self.child.wait(); } }
#[derive(Default)]
struct Manager { selected: bool, config: Option<Config>, worker: Option<Worker>, fault: bool, starting: bool, active_request: Option<String>, canceled: std::collections::VecDeque<String> }
static MANAGER: once_cell::sync::Lazy<Mutex<Manager>>=once_cell::sync::Lazy::new(||Mutex::new(Manager::default()));
fn manager()->std::sync::MutexGuard<'static,Manager>{MANAGER.lock().unwrap_or_else(|e|e.into_inner())}
fn nonce()->anyhow::Result<String>{let mut raw=[0u8;24];getrandom::getrandom(&mut raw).map_err(|e|anyhow::anyhow!("Random generator: {e}"))?;Ok(raw.iter().map(|v|format!("{v:02x}")).collect())}
pub fn selected()->bool{manager().selected}
fn reap(m:&mut Manager){if let Some(w)=m.worker.as_mut(){if let Ok(Some(status))=w.child.try_wait(){if !status.success(){m.fault=true;}m.worker=None;}}}
pub fn status()->Value{let mut m=manager();reap(&mut m);json!({"ok":true,"mode":if m.selected{"headless"}else{"desktop"},"running":m.worker.is_some(),"starting":m.starting,"faulted":m.fault,"project":m.config.as_ref().map(|c|c.project.to_string_lossy().to_string()),"threads":m.config.as_ref().map(|c|c.threads),"idle_seconds":m.config.as_ref().map(|c|c.idle),"pid":m.worker.as_ref().map(|w|w.child.id()),"preview":"on-demand CPU render; no viewport"})}
pub fn stop(desktop:bool){let mut m=manager();m.worker=None;m.active_request=None;m.fault=true;if desktop{m.selected=false;}}
fn abort_worker(id:&str){let mut m=manager();if m.worker.as_ref().is_some_and(|w|w.id==id){m.worker=None;m.fault=true;}}
struct InFlight { id:String, armed:bool, request:Option<String> }
impl Drop for InFlight{fn drop(&mut self){if self.armed{abort_worker(&self.id);}let mut m=manager();if self.request.is_some()&&m.active_request==self.request{m.active_request=None;}}}

fn executable(request:&Value)->anyhow::Result<PathBuf>{
 if let Some(path)=request["executable"].as_str().filter(|s|!s.trim().is_empty()).map(str::to_owned).or_else(||std::env::var("ELIO_BLENDER_PATH").ok()) {let p=PathBuf::from(path);anyhow::ensure!(p.is_absolute()&&p.is_file(),"Choose an absolute path to the installed Blender executable");return Ok(p);}
 if let Some(paths)=std::env::var_os("PATH"){for dir in std::env::split_paths(&paths){let p=dir.join(if cfg!(windows){"blender.exe"}else{"blender"});if p.is_file(){return Ok(p);}}}
 #[cfg(windows)]
 if let Some(root)=std::env::var_os("ProgramFiles"){let root=PathBuf::from(root).join("Blender Foundation");let mut dirs=std::fs::read_dir(root).into_iter().flatten().flatten().map(|d|d.path()).collect::<Vec<_>>();dirs.sort();for d in dirs.into_iter().rev(){let p=d.join("blender.exe");if p.is_file(){return Ok(p);}}}
 #[cfg(target_os="macos")] {let p=PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender");if p.is_file(){return Ok(p);}}
 anyhow::bail!("Blender was not found. Install Blender 3.6+ and enter its executable path. Elio does not download or install it automatically.")
}
fn slug(s:&str)->bool{!s.is_empty()&&s.len()<=64&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')}

async fn start(config:Config)->anyhow::Result<()>{
 {let mut m=manager();reap(&mut m);anyhow::ensure!(!m.starting,"Blender headless is already starting");if m.worker.is_some(){anyhow::ensure!(m.config.as_ref().is_some_and(|c|c.project==config.project),"Stop the current headless project before switching projects");return Ok(());}m.starting=true;m.selected=true;m.fault=false;m.config=Some(config.clone());}
 struct Starting;impl Drop for Starting{fn drop(&mut self){let mut m=manager();m.starting=false;if m.worker.is_none(){m.fault=true;}}}
 let _starting=Starting;
 std::fs::create_dir_all(&config.project)?;
 let token=nonce()?;let id=nonce()?;let ready_name=format!("ready-{id}.json");let ready=config.project.join(&ready_name);
 let script=config.project.join("elio-headless-worker.py");std::fs::write(&script,include_str!("blender_headless_worker.py"))?;
 let log=std::fs::File::create(config.project.join("worker.log"))?;
 let mut cmd=Command::new(&config.executable);
 cmd.args(["--background","--factory-startup","--disable-autoexec","--threads",&config.threads.to_string(),"--python-exit-code","1","--python"]).arg(&script)
  .env("ELIO_BLENDER_PROJECT",&config.project).env("ELIO_BLENDER_TOKEN",&token).env("ELIO_BLENDER_OWNER",std::process::id().to_string()).env("ELIO_BLENDER_READY",&ready_name).env("ELIO_BLENDER_IDLE",config.idle.to_string()).env("ELIO_BLENDER_THREADS",config.threads.to_string()).env("OMP_NUM_THREADS",config.threads.to_string()).env("OPENBLAS_NUM_THREADS",config.threads.to_string()).env("PYTHONIOENCODING","utf-8").env("PYTHONUTF8","1")
  .current_dir(&config.project).stdin(Stdio::piped()).stdout(Stdio::from(log.try_clone()?)).stderr(Stdio::from(log));
 #[cfg(windows)]{use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000|0x00004000);}
 let mut child=cmd.spawn()?;let stdin=child.stdin.take().ok_or_else(||anyhow::anyhow!("Missing worker owner pipe"))?;
 let child_pid=child.id();
 {let mut owned=Worker{#[cfg(windows)] _job:None,child,_stdin:stdin,port:0,token,id:id.clone()};#[cfg(windows)] {owned._job=Some(crate::blender_headless_job::OwnedJob::attach(&owned.child)?);}let mut m=manager();anyhow::ensure!(!m.fault&&m.selected,"Headless startup was canceled");m.worker=Some(owned);}
 let mut flight=InFlight{id:id.clone(),armed:true,request:None};
 let result=tokio::time::timeout(Duration::from_secs(60),async{
  loop{
   {let mut m=manager();reap(&mut m);anyhow::ensure!(m.worker.as_ref().is_some_and(|w|w.id==id),"Blender headless stopped during startup. See worker.log in the project folder.");}
   if let Ok(data)=tokio::fs::read(&ready).await {let receipt:Value=serde_json::from_slice(&data)?;anyhow::ensure!(receipt["pid"].as_u64()==Some(child_pid as u64)&&receipt["owner"].as_u64()==Some(std::process::id() as u64),"Invalid headless startup receipt");let port=receipt["port"].as_u64().filter(|n|*n>0&&*n<=65535).ok_or_else(||anyhow::anyhow!("Invalid headless port"))? as u16;
    let mut m=manager();let w=m.worker.as_mut().filter(|w|w.id==id).ok_or_else(||anyhow::anyhow!("Headless startup was stopped"))?;w.port=port;return Ok::<_,anyhow::Error>(());}
   tokio::time::sleep(Duration::from_millis(100)).await;
  }
 }).await;
 let _=std::fs::remove_file(ready);
 result.map_err(|_|anyhow::anyhow!("Blender headless startup timed out; its owned process was stopped"))??;
 flight.armed=false;Ok(())
}

pub async fn control(ws:&crate::workspace::Workspace,request:Value)->anyhow::Result<Value>{
 let action=request["action"].as_str().unwrap_or("status");
 match action{
  "status"=>{},
  "stop"=>stop(false),
  "cancel"=>{let mut m=manager();if let Some(id)=request["request_id"].as_str().filter(|id|!id.is_empty()&&id.len()<=128){if m.active_request.as_deref()==Some(id){m.worker=None;m.active_request=None;m.fault=true;}if !m.canceled.iter().any(|s|s==id){m.canceled.push_back(id.to_owned());}while m.canceled.len()>128{m.canceled.pop_front();}}},
  "desktop"=>stop(true),
  "start"=>{
   crate::safety::mutation()?;crate::safety::desktop_policy(false)?;
   let project=request["project"].as_str().unwrap_or("default");anyhow::ensure!(slug(project),"Project name must contain 1..64 ASCII letters, digits, - or _");
   let project=ws.resolve_path(&format!(".elio-blender/{project}"),false).map_err(anyhow::Error::msg)?;
   let config=Config{executable:executable(&request)?,project,threads:request["threads"].as_u64().unwrap_or(2).clamp(1,8) as u32,idle:request["idle_seconds"].as_u64().unwrap_or(120).clamp(30,1800)};
   start(config).await?;
  },_=>anyhow::bail!("Use status, start, stop or desktop"),
 }
 Ok(status())
}

pub async fn command(kind:&str,mut params:Value,limit:Duration)->anyhow::Result<Value>{
 let request=params.as_object_mut().and_then(|a|a.remove("__elio_request_id")).and_then(|v|v.as_str().map(str::to_owned));
 {let m=manager();anyhow::ensure!(!request.as_ref().is_some_and(|r|m.canceled.contains(r)),"Headless request was canceled before execution; no edit was replayed");}
 let resume={let mut m=manager();reap(&mut m);if m.worker.is_none()&&!m.fault{m.config.clone()}else{None}};
 if let Some(config)=resume{crate::safety::mutation()?;crate::safety::desktop_policy(false)?;start(config).await?;}

 let (port,token,id)={let mut m=manager();anyhow::ensure!(!request.as_ref().is_some_and(|r|m.canceled.contains(r)),"Headless request was canceled before execution");m.active_request=request.clone();let w=m.worker.as_ref().filter(|w|w.port!=0).ok_or_else(||anyhow::anyhow!("Headless Blender is stopped. Use Start / Resume headless; desktop Blender was not substituted."))?;(w.port,w.token.clone(),w.id.clone())};
 let mut flight=InFlight{id,armed:true,request};
 let result=tokio::time::timeout(limit,async{
  let mut socket=TcpStream::connect(("127.0.0.1",port)).await?;
  let mut raw=serde_json::to_vec(&json!({"type":kind,"params":params,"token":token}))?;raw.push(b'\n');socket.write_all(&raw).await?;
  let mut data=Vec::new();let mut buf=[0u8;8192];
  loop{let size=socket.read(&mut buf).await?;anyhow::ensure!(size>0,"Headless worker closed an incomplete response");data.extend_from_slice(&buf[..size]);anyhow::ensure!(data.len()<=16*1024*1024,"Headless response exceeds 16 MB");match serde_json::from_slice::<Value>(&data){Ok(v)=>{anyhow::ensure!(matches!(v["status"].as_str(),Some("success"|"error")),"Invalid headless response");return Ok::<_,anyhow::Error>(v);},Err(e) if e.is_eof()=>{},Err(e)=>return Err(e.into())}}
 }).await.map_err(|_|anyhow::anyhow!("Headless Blender timed out; its process was stopped. Resume the saved project and inspect it before another edit. No command was replayed."))?;
 if result.is_ok(){flight.armed=false;}
 result
}

#[cfg(test)]mod tests{use super::*;#[test]fn project_names_cannot_escape(){for s in ["../x","/tmp","","a/b","a.b","a\\b"]{assert!(!slug(s));}assert!(slug("my-project_2"));}#[test]fn worker_is_embedded_and_has_no_gui_dependency(){let s=include_str!("blender_headless_worker.py");assert!(s.contains("bpy.app.background"));assert!(!s.contains("bpy.app.timers"));assert!(s.contains("compare_digest"));assert!(s.contains("sys.stdin.buffer.read"));}}
