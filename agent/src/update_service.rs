// SPDX-License-Identifier: GPL-3.0-or-later
//! One trusted update authority for native UI and extension UI. No arbitrary
//! URL, repository, command, or install destination is accepted over HTTP.
use anyhow::{ensure, Context};
use futures::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicUsize, Ordering}}, time::Duration};
use tokio::io::AsyncWriteExt;

pub const REPOSITORY: &str = "NeDioBrando/SynerixCode";
pub const MAX_ZIP: u64 = 256 * 1024 * 1024;
#[derive(Clone, Debug)]
pub struct Release { pub version: String, pub url: String, pub sha256: String, pub size: u64 }
#[derive(Default)]
struct Status { phase: String, release: Option<Release>, error: String, checked: i64, downloaded: u64 }
pub struct Service {
    status: Mutex<Status>,
    checking: AtomicBool,
    pub installing: AtomicBool,
    pub active_tools: AtomicUsize,
    pub busy_browsers: Mutex<std::collections::HashMap<String, (std::time::Instant, bool)>>,
}
impl Default for Service { fn default()->Self { Self {status:Mutex::new(Status::default()),checking:AtomicBool::new(false),installing:AtomicBool::new(false),active_tools:AtomicUsize::new(0),busy_browsers:Mutex::new(std::collections::HashMap::new())} } }
pub fn version(value:&str)->anyhow::Result<[u64;3]> {
    let parts=value.split('.').collect::<Vec<_>>();
    ensure!(parts.len()==3 && parts.iter().all(|p| !p.is_empty() && p.len()<=9 && p.bytes().all(|b|b.is_ascii_digit()) && (p.len()==1 || !p.starts_with('0'))),"Expected a stable x.y.z version");
    Ok([parts[0].parse()?,parts[1].parse()?,parts[2].parse()?])
}
pub fn parse_release(value:&Value)->anyhow::Result<Release> {
    ensure!(value["draft"]==false && value["prerelease"]==false,"Only published stable releases are accepted");
    let tag=value["tag_name"].as_str().context("Release has no tag")?;
    let v=tag.strip_prefix('v').context("Tag must start with v")?;version(v)?;
    let name=format!("synerixcode-v{v}-Windows-x64.zip");
    let candidates=value["assets"].as_array().context("Missing release assets")?.iter().filter(|a|a["name"]==name).collect::<Vec<_>>();
    ensure!(candidates.len()==1,"Release must contain exactly one {name}");let asset=candidates[0];
    let url=format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}");
    ensure!(asset["state"]=="uploaded" && asset["browser_download_url"]==url,"Unexpected release asset location or state");
    let digest=asset["digest"].as_str().and_then(|s|s.strip_prefix("sha256:")).context("GitHub has not supplied a SHA-256 digest; update refused")?;
    ensure!(digest.len()==64 && digest.bytes().all(|c|c.is_ascii_hexdigit()),"Invalid GitHub SHA-256 digest");
    let size=asset["size"].as_u64().context("Missing asset size")?;ensure!(size>0&&size<=MAX_ZIP,"Invalid release archive size");
    Ok(Release{version:v.into(),url,sha256:digest.to_ascii_lowercase(),size})
}
fn client()->anyhow::Result<reqwest::Client>{
    Ok(reqwest::Client::builder().user_agent(concat!("SynerixCode/",env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt|{
            let host=attempt.url().host_str().unwrap_or("");
            if attempt.previous().len()<5 && attempt.url().scheme()=="https" && matches!(host,"github.com"|"api.github.com"|"release-assets.githubusercontent.com"|"objects.githubusercontent.com") {attempt.follow()} else {attempt.error("Unexpected update redirect")}
        })).build()?)
}
impl Service {
    pub fn snapshot(&self)->Value{
        let s=self.status.lock().unwrap_or_else(|e|e.into_inner());
        let latest=s.release.as_ref().map(|r|r.version.as_str());
        let available=latest.and_then(|v|version(v).ok()).is_some_and(|v|v>version(env!("CARGO_PKG_VERSION")).unwrap());
        json!({"current":env!("CARGO_PKG_VERSION"),"latest":latest,"outdated":available,"phase":if s.phase.is_empty(){"idle"}else{&s.phase},"error":s.error,"checked_at":s.checked,"downloaded":s.downloaded,"size":s.release.as_ref().map(|r|r.size),"installing":self.installing.load(Ordering::SeqCst),"supported":cfg!(windows),"repository":REPOSITORY})
    }
    fn phase(&self,phase:&str,error:&str){let mut s=self.status.lock().unwrap_or_else(|e|e.into_inner());s.phase=phase.into();s.error=error.into();}
    pub fn note_browser(&self,id:&str,busy:bool){
        if id.is_empty()||id.len()>128{return;}
        let mut browsers=self.busy_browsers.lock().unwrap_or_else(|e|e.into_inner());
        browsers.retain(|_,(at,_)|at.elapsed()<Duration::from_secs(180));
        if browsers.len()<50 || browsers.contains_key(id){browsers.insert(id.into(),(std::time::Instant::now(),busy));}
    }
    pub fn browser_busy(&self)->bool{self.busy_browsers.lock().unwrap_or_else(|e|e.into_inner()).values().any(|(at,busy)|*busy && at.elapsed()<Duration::from_secs(180))}
    pub fn begin_tool(&self)->anyhow::Result<ToolGuard<'_>>{
        ensure!(!self.installing.load(Ordering::SeqCst),"Update in progress. No command was dispatched.");
        self.active_tools.fetch_add(1,Ordering::SeqCst);
        if self.installing.load(Ordering::SeqCst){self.active_tools.fetch_sub(1,Ordering::SeqCst);anyhow::bail!("Update in progress. No command was dispatched.");}
        Ok(ToolGuard(self))
    }
    pub async fn check(&self)->anyhow::Result<()> {
        if self.installing.load(Ordering::SeqCst) || self.checking.swap(true,Ordering::SeqCst){return Ok(());}
        self.phase("checking","");
        let result=async {
            let response=client()?.get(format!("https://api.github.com/repos/{REPOSITORY}/releases/latest")).header("Accept","application/vnd.github+json").header("X-GitHub-Api-Version","2022-11-28").timeout(Duration::from_secs(25)).send().await?;
            if response.status()==reqwest::StatusCode::NOT_FOUND { self.phase("unpublished","Нет опубликованного стабильного релиза.");return Ok(()); }
            let response=response.error_for_status()?;
            ensure!(response.content_length().unwrap_or(0)<=2*1024*1024,"Release metadata is too large");
            let mut body=Vec::new();let mut stream=response.bytes_stream();while let Some(chunk)=stream.next().await{let chunk=chunk?;ensure!(body.len()+chunk.len()<=2*1024*1024,"Release metadata is too large");body.extend_from_slice(&chunk);}
            let release=parse_release(&serde_json::from_slice(&body)?)?;
            let available=version(&release.version)?>version(env!("CARGO_PKG_VERSION"))?;
            let mut s=self.status.lock().unwrap_or_else(|e|e.into_inner());s.release=Some(release);s.phase=if available{"available"}else{"current"}.into();s.error.clear();Ok::<_,anyhow::Error>(())
        }.await;
        {self.status.lock().unwrap_or_else(|e|e.into_inner()).checked=chrono::Utc::now().timestamp_millis();}
        if let Err(error)=&result{self.phase("error",&error.to_string());}
        self.checking.store(false,Ordering::SeqCst);result
    }
    pub async fn install(self:Arc<Self>, ui:Arc<crate::gui::UiShared>)->anyhow::Result<()> {
        ensure!(cfg!(windows),"Автоматическая установка пока доступна только на Windows x64.");
        ensure!(!self.browser_busy(),"Сначала завершите активные задачи ИИ во всех браузерах.");
        ensure!(!self.installing.swap(true,Ordering::SeqCst),"Обновление уже запущено.");
        if self.active_tools.load(Ordering::SeqCst)>0 {self.installing.store(false,Ordering::SeqCst);anyhow::bail!("Дождитесь завершения выполняющегося инструмента.");}
        let result=self.prepare_and_launch().await;
        match result {Ok(())=>{self.phase("installing","");tokio::spawn(async move{tokio::time::sleep(Duration::from_millis(700)).await;ui.request_quit();});Ok(())},Err(e)=>{self.installing.store(false,Ordering::SeqCst);self.phase("error",&e.to_string());Err(e)}}
    }
    async fn prepare_and_launch(&self)->anyhow::Result<()> {
        // Use a recent verified GitHub snapshot. Never use an
        // asset URL or expected digest supplied by a browser page.
        ensure!(!self.checking.load(Ordering::SeqCst),"Проверка версии ещё идёт. Повторите после её завершения.");
        let release={let s=self.status.lock().unwrap_or_else(|e|e.into_inner());ensure!(chrono::Utc::now().timestamp_millis()-s.checked<15*60*1000,"Сначала повторите проверку обновлений.");s.release.clone().context("Проверенный релиз не найден")?};
        ensure!(version(&release.version)?>version(env!("CARGO_PKG_VERSION"))?,"Новая версия приложения не требуется. Если устарело расширение, перезагрузите его и вкладки ИИ.");
        let root=update_root()?;std::fs::create_dir_all(&root)?;
        let nonce=nonce()?;let stage=root.join(format!("stage-{nonce}"));std::fs::create_dir(&stage)?;
        let zip=stage.join("release.zip");self.phase("downloading","");
        let response=client()?.get(&release.url).send().await?.error_for_status()?;
        let mut stream=response.bytes_stream();let mut file=tokio::fs::File::create(&zip).await?;let mut hash=Sha256::new();let mut size=0u64;
        while let Some(chunk)=stream.next().await {let chunk=chunk?;size+=chunk.len() as u64;ensure!(size<=release.size && size<=MAX_ZIP,"Download exceeds verified size");hash.update(&chunk);file.write_all(&chunk).await?;self.status.lock().unwrap_or_else(|e|e.into_inner()).downloaded=size;}
        file.flush().await?;drop(file);ensure!(size==release.size && format!("{:x}",hash.finalize())==release.sha256,"Download checksum/size mismatch. Installed files were not changed.");
        ensure!(!self.browser_busy() && self.active_tools.load(Ordering::SeqCst)==0,"Задача ИИ ещё активна. Установка отменена без замены файлов.");
        let helper=stage.join("apply-update.ps1");std::fs::write(&helper,include_str!("../../updater/apply-update.ps1"))?;
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            let install=std::env::current_exe()?.parent().context("Missing installation directory")?.to_path_buf();
            let mut child=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned","-File"]).arg(&helper)
                .arg("-InstallDir").arg(install).arg("-ZipPath").arg(zip).arg("-ExpectedSha256").arg(&release.sha256)
                .arg("-ExpectedVersion").arg(&release.version).arg("-ParentPid").arg(std::process::id().to_string())
                .arg("-Receipt").arg(stage.join(format!("ready-{nonce}")))
                .creation_flags(0x0800_0000).spawn().context("Не удалось запустить локальный обновлятор; возможно, PowerShell заблокирован политикой системы")?;
            let prepared=stage.join("prepared");
            let mut ready=false;
            for _ in 0..180 {
                if prepared.is_file(){ready=true;break;}
                if let Some(status)=child.try_wait()?{anyhow::bail!("Обновлятор не прошёл подготовку ({status}). Журнал: {}",stage.display());}
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            if !ready {let _=child.kill();anyhow::bail!("Истекло время подготовки обновления. Файлы приложения не изменены.");}
            if self.browser_busy() || self.active_tools.load(Ordering::SeqCst)>0 {let _=child.kill();anyhow::bail!("Задача стала активной. Обновление отменено без замены файлов.");}
            Ok(())
        }
        #[cfg(not(windows))] {let _=release;anyhow::bail!("Windows updater required")}
    }
}
pub struct ToolGuard<'a>(&'a Service);
impl Drop for ToolGuard<'_>{fn drop(&mut self){self.0.active_tools.fetch_sub(1,Ordering::SeqCst);}}
pub fn update_root()->anyhow::Result<PathBuf>{Ok(std::env::var_os("LOCALAPPDATA").or_else(||std::env::var_os("XDG_CONFIG_HOME")).map(PathBuf::from).or_else(||std::env::var_os("HOME").map(|p|PathBuf::from(p).join(".config"))).context("Missing user data directory")?.join("synerixcode").join("updates"))}
fn nonce()->anyhow::Result<String>{let mut bytes=[0u8;16];getrandom::getrandom(&mut bytes).map_err(|e|anyhow::anyhow!("Random source failed: {e}"))?;Ok(bytes.iter().map(|b|format!("{b:02x}")).collect())}
pub fn mark_ready(path:&Path)->anyhow::Result<()> {
    let root=update_root()?.canonicalize()?;let parent=path.parent().context("Invalid update receipt")?.canonicalize()?;
    let name=path.file_name().and_then(|s|s.to_str()).context("Invalid receipt filename")?;
    ensure!(parent.starts_with(root) && name.strip_prefix("ready-").is_some_and(|v|v.len()==32 && v.bytes().all(|b|b.is_ascii_hexdigit())),"Invalid update receipt path");
    std::fs::write(path,env!("CARGO_PKG_VERSION"))?;Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn release()->Value{json!({"tag_name":"v1.2.3","draft":false,"prerelease":false,"assets":[{"name":"synerixcode-v1.2.3-Windows-x64.zip","state":"uploaded","browser_download_url":"https://github.com/NeDioBrando/SynerixCode/releases/download/v1.2.3/synerixcode-v1.2.3-Windows-x64.zip","digest":format!("sha256:{}","a".repeat(64)),"size":123}]})}
    #[test]fn numeric_versions_not_lexical(){assert!(version("1.10.0").unwrap()>version("1.9.9").unwrap());for bad in ["1","1.2","1.2.3.4","01.2.3","1.2.3-beta","1.2.-3","9999999999.1.1"]{assert!(version(bad).is_err());}}
    #[test]fn strict_repository_digest_and_stable_release(){assert!(parse_release(&release()).is_ok());for(field,value)in [("draft",json!(true)),("prerelease",json!(true)),("tag_name",json!("v1.2.3-beta"))]{let mut v=release();v[field]=value;assert!(parse_release(&v).is_err());}for(field,value)in [("browser_download_url",json!("https://example.com/evil.zip")),("digest",Value::Null),("size",json!(MAX_ZIP+1)),("state",json!("new"))]{let mut v=release();v["assets"][0][field]=value;assert!(parse_release(&v).is_err());}let mut v=release();let duplicate=v["assets"][0].clone();v["assets"].as_array_mut().unwrap().push(duplicate);assert!(parse_release(&v).is_err());}
    #[test]fn tool_gate_blocks_during_install(){let s=Service::default();{let _guard=s.begin_tool().unwrap();assert_eq!(s.active_tools.load(Ordering::SeqCst),1);}assert_eq!(s.active_tools.load(Ordering::SeqCst),0);s.installing.store(true,Ordering::SeqCst);assert!(s.begin_tool().is_err());assert_eq!(s.active_tools.load(Ordering::SeqCst),0);}
    #[test]fn background_browser_runs_are_not_ignored(){let s=Service::default();s.note_browser("b1",true);s.note_browser("b2",false);assert!(s.browser_busy());s.note_browser("b1",false);assert!(!s.browser_busy());}
}
