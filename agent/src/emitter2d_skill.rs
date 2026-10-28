// SPDX-License-Identifier: GPL-3.0-or-later
//! Built-in Emitter2D installed-plugin reference, scoped routing and bounded read-only resources.
use serde_json::{json, Value};
use std::path::Path;
pub const ID: &str = "builtin-emitter2d";
pub fn catalog() -> Value { serde_json::from_str(include_str!("emitter2d-skill-index.json")).expect("validated Emitter2D card") }
fn has(query: &str, pattern: &str) -> bool { regex::Regex::new(pattern).expect("static Emitter2D pattern").is_match(query) }
pub fn should_use(query:&str,domain:&str)->bool {
 if domain!="roblox"{return false;}let q=query.to_lowercase();
 if has(&q,r"(?:(?:don't|do not|never)\s+(?:use\s+)?|(?:without|не используй|не применяй|без)\s+)(?:(?:the|plugin|плагин|плагина)\s+)?(?:emitter\s*2d|эмиттер\s*2[дd])"){return false;}
 if has(&q,r"\bemitter\s*2d\b|эмиттер\s*2[дd]"){return true;}
 if has(&q,r"\b(?:css|website|webpage|html|qp2|qwinkle)\b|веб.страниц|vfx\s*studio|квинкл"){return false;}
 let particles=has(&q,r"particles?|emitters?|confetti|частиц|конфетти");
 let ui=has(&q,r"\b(?:ui|gui|hud|2d|screen|interface)\b|интерфейс|экран|кнопк|меню|2д");particles&&ui
}
pub const RESOURCES: &[&str] = &["SKILL.md", "references/workflow.md", "references/runtime-contract.md", "references/sources.md", "NOTICE.txt", "scripts/inspect_emitter.luau"];
pub fn read(root: &Path, request: &Value) -> anyhow::Result<Value> {
    let relative = request["resource"].as_str().unwrap_or("SKILL.md");
    anyhow::ensure!(RESOURCES.contains(&relative), "Unknown Emitter2D resource");
    let root = std::fs::canonicalize(root).map_err(|_|anyhow::anyhow!("Emitter2D skill files are missing; extract the complete Elio ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "Emitter2D resource escapes bundle");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024*1024, "Emitter2D resource too large");
    let text = std::fs::read_to_string(&path)?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(12000).clamp(1,24000) as usize;
    let end = offset.saturating_add(limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,"next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),"bundle_root":root,"resources":RESOURCES,"source":"Elio-authored Emitter2D reference based on public dogwarrior24 documentation","adaptation":"Installed-plugin reference only; no redistributed client or plugin, invented API or live verification. Inspector does not execute or alter anything."}))
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn scoped_routing(){for(q,want)in[("Use Emitter2D",true),("Emitter 2D GUI particles",true),("Сделай частицы на кнопке",true),("UI confetti",true),("Do not use Emitter2D",false),("Без Emitter2D",false),("Не используй плагин Emitter2D",false),("Use QP2 GUI particles",false),("Use VFX Studio",false),("Animate character walking",false),("CSS particles on a website",false),("Make 3D particles",false),("Fix inventory",false)]{assert_eq!(should_use(q,"roblox"),want,"{q}");}assert!(!should_use("Use Emitter2D","local"));}
 #[test]fn resources_are_bounded_and_complete(){let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../starter-skills/emitter2d");for resource in RESOURCES{assert!(!read(&root,&json!({"resource":resource})).unwrap()["content"].as_str().unwrap().is_empty());}assert!(read(&root,&json!({"resource":"../config.json"})).is_err());let text=std::fs::read_to_string(root.join("SKILL.md")).unwrap();let mut out=String::new();let mut offset=0;loop{let row=read(&root,&json!({"offset":offset,"limit":17})).unwrap();out.push_str(row["content"].as_str().unwrap());if let Some(n)=row["next_offset"].as_u64(){offset=n}else{break}}assert_eq!(out,text);assert_eq!(catalog()["confirmed"],false);assert_eq!(catalog()["enabled"],true);}
 #[cfg(unix)]#[test]fn resource_symlink_cannot_escape(){let base=std::env::temp_dir().join(format!("elio-emitter2d-symlink-{}",std::process::id()));let root=base.join("bundle");std::fs::create_dir_all(&root).unwrap();std::fs::write(base.join("outside"),"private").unwrap();std::os::unix::fs::symlink(base.join("outside"),root.join("SKILL.md")).unwrap();assert!(read(&root,&json!({})).is_err());let _=std::fs::remove_dir_all(base);}
}
