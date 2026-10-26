// SPDX-License-Identifier: GPL-3.0-or-later
//! Built-in VFX Studio library-first reference, scoped routing and bounded read-only resources.
use serde_json::{json, Value};
use std::path::Path;
pub const ID: &str = "builtin-vfx-studio";
pub fn catalog() -> Value { serde_json::from_str(include_str!("vfx-studio-skill-index.json")).expect("validated VFX Studio card") }
fn has(query: &str, pattern: &str) -> bool { regex::Regex::new(pattern).expect("static VFX Studio pattern").is_match(query) }
pub fn should_use(query: &str, domain: &str) -> bool {
    if domain != "roblox" { return false; }
    let q = query.to_lowercase();
    if has(&q, r"(?:(?:don't|do not|never)\s+(?:use\s+)?|(?:without|не используй|не применяй|без)\s+)(?:(?:the|plugin|плагин|плагина)\s+)?(?:vfx\s*studio|вфх\s*студи[яю])") { return false; }
    if has(&q, r"\bvfx\s*studio\b|вфх\s*студи") { return true; }
    if has(&q, r"\b(?:css|website|webpage|html)\b|веб.страниц") { return false; }
    has(&q, r"\b(?:vfx|particles?|emitters?|flipbooks?|beams?|trails?|auras?|sparks?|smoke|explosions?|muzzle\s+flash|(?:spell|hit|fire|impact)\s+effects?)\b|частиц|искр|дым|плам|вспышк|взрыв|аур[ауы]|визуальн.{0,12}эффект|эффект.{0,20}(?:удар|заклинан|взрыв|огн)|(?:удар|заклинан|взрыв|огн).{0,20}эффект")
}
pub const RESOURCES: &[&str] = &["SKILL.md", "references/library-workflow.md", "references/feature-analysis.md", "references/sources.md", "NOTICE.txt", "scripts/inspect_asset.luau"];
pub fn read(root: &Path, request: &Value) -> anyhow::Result<Value> {
    let relative = request["resource"].as_str().unwrap_or("SKILL.md");
    anyhow::ensure!(RESOURCES.contains(&relative), "Unknown VFX Studio resource");
    let root = std::fs::canonicalize(root).map_err(|_|anyhow::anyhow!("VFX Studio skill files are missing; extract the complete Elio ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "VFX Studio resource escapes bundle");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024*1024, "VFX Studio resource too large");
    let text = std::fs::read_to_string(&path)?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(12000).clamp(1,24000) as usize;
    let end = offset.saturating_add(limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,"next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),"bundle_root":root,"resources":RESOURCES,"source":"User-provided VFX Studio Animator skill; Elio adaptation","adaptation":"Reference only. No bundled assets, private plugin API or live UI verification. Inspector reads materialized exports only."}))
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn relevant_tasks_only() {
  for (q,want) in [("Use VFX Studio",true),("Сделай эффект удара",true),("Добавь искры и дым",true),("Create a particle aura",true),("Use VFX Studio with Blender",true),("Make VFX for this spell",true),("Do not use VFX Studio",false),("Без VFX Studio",false),("Не используй плагин VFX Studio",false),("Without plugin VFX Studio",false),("Create smoke and sparks",true),("Make an explosion",true),("Не используй VFX Studio",false),("Animate a CSS particle button",false),("Animate the character walking",false),("Fix inventory saving",false),("Сделай красивый интерфейс",false)] {assert_eq!(should_use(q,"roblox"),want,"{q}");}
  assert!(!should_use("Use VFX Studio","local"));
 }
 #[test] fn shipped_resources_and_unicode_bounds() {
  let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../starter-skills/vfx-studio");
  for resource in RESOURCES {assert!(!read(&root,&json!({"resource":resource})).unwrap()["content"].as_str().unwrap().is_empty());}
  assert!(read(&root,&json!({"resource":"../SKILL.md"})).is_err());
  assert!(read(&root,&json!({"resource":"/etc/passwd"})).is_err());
  let text=std::fs::read_to_string(root.join("SKILL.md")).unwrap();
  let mut out=String::new();let mut offset=0;
  loop {let row=read(&root,&json!({"offset":offset,"limit":17})).unwrap();out.push_str(row["content"].as_str().unwrap());if let Some(n)=row["next_offset"].as_u64(){offset=n}else{break}}
  assert_eq!(text,out);assert_eq!(catalog()["enabled"],true);assert_eq!(catalog()["confirmed"],false);
 }
}

#[cfg(all(test,unix))] mod symlink_tests {
 use super::*;
 #[test]fn cannot_follow_resource_symlink_outside_bundle(){
  let base=std::env::temp_dir().join(format!("elio-vfx-symlink-{}",std::process::id()));let root=base.join("bundle");std::fs::create_dir_all(&root).unwrap();std::fs::write(base.join("outside"),"private").unwrap();std::os::unix::fs::symlink(base.join("outside"),root.join("SKILL.md")).unwrap();
  assert!(read(&root,&json!({})).is_err());let _=std::fs::remove_dir_all(base);
 }
}
