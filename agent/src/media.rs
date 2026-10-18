// SPDX-License-Identifier: GPL-3.0-or-later
// Optional local codec fallback; never bundle a large decoder in the share ZIP.
use axum::{body::Bytes, extract::Query, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::{path::PathBuf, time::Duration};
const MAX_INPUT: usize = 64 * 1024 * 1024;
const MAX_OUTPUT: usize = 12 * 1024 * 1024;
const FORMATS: &str = "mov,matroska,avi,mpeg,mpegvideo,flv,asf,ogg,gif,image2,png_pipe,jpeg_pipe,webp_pipe,tiff_pipe,bmp_pipe";
#[derive(Deserialize)]
pub struct Options { #[serde(default)] video: bool }
struct Scratch(PathBuf);
impl Drop for Scratch { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
fn decoder() -> PathBuf {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Some(root) = std::env::current_exe().ok().and_then(|p|p.parent().map(PathBuf::from)) {
        for path in [root.join("runtimes/ffmpeg").join(name),root.join(name)] { if path.is_file() { return path; } }
    }
    name.into()
}
async fn run(program: &std::path::Path, args: &[String]) -> anyhow::Result<std::process::Output> {
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(30),command.output()).await
        .map_err(|_|anyhow::anyhow!("Media conversion timed out. Try a shorter or smaller video."))?
        .map_err(|_|anyhow::anyhow!("This codec needs FFmpeg. Install FFmpeg or place ffmpeg.exe and ffprobe.exe in elio/runtimes/ffmpeg, then retry."))?;
    anyhow::ensure!(output.status.success(),"The local decoder could not convert this media. Try a valid PNG/JPEG or MP4/WebM file.");
    Ok(output)
}
async fn convert(bytes: Bytes, video: bool) -> anyhow::Result<serde_json::Value> {
    anyhow::ensure!(!bytes.is_empty() && bytes.len() <= MAX_INPUT,"Local conversion accepts files up to 64 MB.");
    let mut nonce=[0u8;16];getrandom::getrandom(&mut nonce).map_err(|_|anyhow::anyhow!("Cannot create media conversion session."))?;
    let path=std::env::temp_dir().join(format!("elio-media-{}",nonce.iter().map(|b|format!("{b:02x}")).collect::<String>()));
    std::fs::create_dir(&path)?;let scratch=Scratch(path);
    let input=scratch.0.join("input.bin");tokio::fs::write(&input,bytes).await?;
    let decoder=decoder();let mut filter="scale=1600:1600:force_original_aspect_ratio=decrease".to_string();
    if video {
        let probe=if decoder.components().count()>1 {decoder.with_file_name(if cfg!(windows){"ffprobe.exe"}else{"ffprobe"})} else {PathBuf::from(if cfg!(windows){"ffprobe.exe"}else{"ffprobe"})};
        let args=["-v".into(),"error".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-format_whitelist".into(),FORMATS.into(),"-show_entries".into(),"format=duration".into(),"-of".into(),"default=noprint_wrappers=1:nokey=1".into(),input.to_string_lossy().into_owned()];
        let output=run(&probe,&args).await?;
        let duration=std::str::from_utf8(&output.stdout)?.trim().parse::<f64>()?;
        anyhow::ensure!(duration.is_finite() && duration>0.,"Cannot read video duration.");
        filter=format!("fps={},{}",8./duration,filter);
    }
    let args=["-hide_banner".into(),"-loglevel".into(),"error".into(),"-nostdin".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-format_whitelist".into(),FORMATS.into(),"-i".into(),input.to_string_lossy().into_owned(),"-an".into(),"-vf".into(),filter,"-frames:v".into(),if video{"8"}else{"1"}.into(),"-q:v".into(),"3".into(),scratch.0.join("frame-%02d.jpg").to_string_lossy().into_owned()];
    run(&decoder,&args).await?;
    let mut paths=std::fs::read_dir(&scratch.0)?.filter_map(Result::ok).map(|e|e.path()).filter(|p|p.extension().is_some_and(|e|e=="jpg")).collect::<Vec<_>>();paths.sort();
    anyhow::ensure!(!paths.is_empty() && paths.len()<=8,"The decoder did not produce usable frames.");
    let mut files=Vec::new();let mut total=0;
    for (i,path) in paths.iter().enumerate(){let data=tokio::fs::read(path).await?;total+=data.len();anyhow::ensure!(total<=MAX_OUTPUT,"Converted media exceeds the 12 MB transfer limit.");files.push(json!({"name":format!("converted-frame-{}.jpg",i+1),"mimeType":"image/jpeg","data":crate::workspace::base64_encode(&data)}));}
    Ok(json!({"ok":true,"files":files,"notice":if video{"Converted to sampled frames; audio and motion between frames are not included."}else{"Converted to JPEG with the local decoder."}}))
}
pub async fn post(Query(options):Query<Options>,bytes:Bytes)->axum::response::Response {
    match convert(bytes,options.video).await {Ok(value)=>Json(value).into_response(),Err(error)=>(axum::http::StatusCode::UNPROCESSABLE_ENTITY,Json(json!({"ok":false,"error":error.to_string()}))).into_response()}
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_empty_and_oversized_without_starting_decoder() {
        assert!(convert(Bytes::new(),true).await.unwrap_err().to_string().contains("64 MB"));
        assert!(convert(Bytes::from(vec![0;MAX_INPUT+1]),false).await.unwrap_err().to_string().contains("64 MB"));
    }
    #[tokio::test]
    async fn actual_decoder_converts_image_and_samples_video() {
        if std::process::Command::new("ffmpeg").arg("-version").output().is_err() { return; }
        let image=convert(Bytes::from_static(include_bytes!(concat!(env!("ELIO_EXTENSION_ROOT"), "/icon.png"))),false).await.unwrap();
        assert_eq!(image["files"].as_array().unwrap().len(),1);
        assert!(image["files"][0]["data"].as_str().unwrap().starts_with("/9j/"));
        let path=std::env::temp_dir().join(format!("elio-codec-fixture-{}.webm",std::process::id()));
        let output=std::process::Command::new("ffmpeg").args(["-hide_banner","-loglevel","error","-nostdin","-y","-f","lavfi","-i","color=c=red:s=64x64:r=10:d=2","-c:v","libvpx"]).arg(&path).output().unwrap();assert!(output.status.success());
        let bytes=std::fs::read(&path).unwrap();std::fs::remove_file(&path).unwrap();
        let video=convert(Bytes::from(bytes),true).await.unwrap();let frames=video["files"].as_array().unwrap();assert!(!frames.is_empty() && frames.len()<=8);assert!(frames.iter().all(|f|f["data"].as_str().unwrap().starts_with("/9j/")));
    }
    #[test]
    fn scratch_only_removes_its_own_session() {
        let root=std::env::temp_dir().join(format!("elio-media-test-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();std::fs::write(root.join("keep"),"keep").unwrap();let child=root.join("convert");std::fs::create_dir(&child).unwrap();std::fs::write(child.join("temporary"),"data").unwrap();drop(Scratch(child.clone()));assert!(!child.exists());assert!(root.join("keep").exists());std::fs::remove_dir_all(root).unwrap();
    }
}
