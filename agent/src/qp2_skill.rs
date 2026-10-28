// SPDX-License-Identifier: GPL-3.0-or-later
//! Built-in QP2 installed-plugin reference, scoped routing and bounded read-only resources.
use serde_json::{json, Value};
use std::path::Path;
pub const ID: &str = "builtin-qwinkles-particles-2";
pub fn catalog() -> Value { serde_json::from_str(include_str!("qp2-skill-index.json")).expect("validated QP2 card") }
fn has(query: &str, pattern: &str) -> bool { regex::Regex::new(pattern).expect("static QP2 pattern").is_match(query) }
pub fn explicit_request(query: &str) -> bool { has(&query.to_lowercase(), r"\bqp2\b|qwinkle|квинкл|квинкль") }
pub fn should_use(query: &str, domain: &str) -> bool {
 if domain!="roblox" {return false;}
 let q=query.to_lowercase();
 if has(&q,r"(?:(?:don't|do not|never)\s+(?:use\s+)?|(?:without|не используй|не применяй|без)\s+)(?:(?:the|plugin|плагин|плагина)\s+)?(?:qp2\b|qwinkle[^,.;\n]*|квинкл[а-я]*)") {return false;}
 if explicit_request(&q) {return true;}
 if has(&q,r"\bvfx\s*studio\b|вфх\s*студи|\b(?:css|website|webpage|html)\b|веб.страниц") {return false;}
 has(&q,r"\b(?:vfx|particles?|emitters?|flipbooks?|beams?|trails?|auras?|sparks?|smoke|explosions?|(?:spell|hit|impact|fire)\s+effects?)\b|частиц|искр|дым|плам|вспышк|взрыв|аур[ауы]|визуальн.{0,12}эффект|эффект.{0,20}(?:удар|заклинан|огн)|(?:удар|заклинан|огн).{0,20}эффект")
}
pub const RESOURCES: &[&str] = &["SKILL.md", "references/workflow.md", "references/runtime-contract.md", "references/sources.md", "NOTICE.txt", "scripts/inspect_effect.luau"];
pub fn read(root: &Path, request: &Value) -> anyhow::Result<Value> {
    let relative = request["resource"].as_str().unwrap_or("SKILL.md");
    anyhow::ensure!(RESOURCES.contains(&relative), "Unknown QP2 resource");
    let root = std::fs::canonicalize(root).map_err(|_|anyhow::anyhow!("QP2 skill files are missing; extract the complete Elio ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "QP2 resource escapes bundle");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024*1024, "QP2 resource too large");
    let text = std::fs::read_to_string(&path)?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(12000).clamp(1,24000) as usize;
    let end = offset.saturating_add(limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,"next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),"bundle_root":root,"resources":RESOURCES,"source":"Elio-authored QP2 reference based on public Qwinkle documentation","adaptation":"Reference only. No bundled assets, private plugin API or live UI verification. Inspector reads materialized exports only."}))
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn scoped_routing(){for(q,want)in[("Use QP2",true),("Qwinkle’s Particles 2",true),("Квинкл частицы",true),("Make mesh particles",true),("Сделай эффект удара",true),("Do not use QP2",false),("Без QP2",false),("Не используй плагин QP2",false),("Use VFX Studio",false),("Animate character walking",false),("CSS particles on a website",false),("Fix inventory",false)]{assert_eq!(should_use(q,"roblox"),want,"{q}");}assert!(!should_use("Use QP2","local"));}
 #[test]fn resources_are_bounded_and_complete(){let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../starter-skills/qwinkles-particles-2");for resource in RESOURCES{assert!(!read(&root,&json!({"resource":resource})).unwrap()["content"].as_str().unwrap().is_empty());}assert!(read(&root,&json!({"resource":"../config.json"})).is_err());let text=std::fs::read_to_string(root.join("SKILL.md")).unwrap();let mut out=String::new();let mut offset=0;loop{let row=read(&root,&json!({"offset":offset,"limit":17})).unwrap();out.push_str(row["content"].as_str().unwrap());if let Some(n)=row["next_offset"].as_u64(){offset=n}else{break}}assert_eq!(out,text);assert_eq!(catalog()["confirmed"],false);assert_eq!(catalog()["enabled"],true);}
 #[cfg(unix)]#[test]fn resource_symlink_cannot_escape(){let base=std::env::temp_dir().join(format!("elio-qp2-symlink-{}",std::process::id()));let root=base.join("bundle");std::fs::create_dir_all(&root).unwrap();std::fs::write(base.join("outside"),"private").unwrap();std::os::unix::fs::symlink(base.join("outside"),root.join("SKILL.md")).unwrap();assert!(read(&root,&json!({})).is_err());let _=std::fs::remove_dir_all(base);}
}
