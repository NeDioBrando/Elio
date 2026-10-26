// SPDX-License-Identifier: GPL-3.0-or-later
//! Built-in Eclipse reference, scoped routing and bounded read-only resources.
use serde_json::{json, Value};
use std::path::Path;
pub const ID: &str = "builtin-eclipse-animator";
pub fn catalog() -> Value { serde_json::from_str(include_str!("eclipse-skill-index.json")).expect("validated Eclipse card") }
fn has(query: &str, pattern: &str) -> bool { regex::Regex::new(pattern).expect("static Eclipse pattern").is_match(query) }
pub fn should_use(query: &str, domain: &str, blender: Option<bool>) -> bool {
    if domain != "roblox" { return false; }
    let q = query.to_lowercase();
    if has(&q, r"(?:(?:don't|do not|never)\s+(?:use\s+)?|(?:without|не используй|не применяй|без)\s+)(?:the\s+)?(?:eclipse|эклипс)") { return false; }
    let explicit = has(&q, r"(?:eclipse|эклипс)");
    if explicit { return true; }
    if has(&q, r"(?:only|только)\s+(?:in\s+|в\s+|через\s+)?(?:blender|блендер)|(?:blender|блендер)\s+(?:only|только)") { return false; }
    if has(&q, r"\b(?:css|website|webpage|html|button|menu|tween)\b|кнопк|меню|интерфейс|веб.страниц") { return false; }
    let animation = has(&q, r"\banimat(?:e|ion|ions|ing)\b|анимир|анимаци|\b(?:keyframesequence|animsaves|emote)\b|\b(?:walk|run|idle)\s+(?:cycle|animation|pose)\b") ||
        (has(&q, r"\b(?:character|rig|avatar)\b|персонаж|геро") && has(&q, r"\b(?:walk|run|idle|punch|jump|wave|dance|death|swing)\b|ходьб|\bбег|эмоц|походк|удар|прыж|взмах|танц"));
    animation && blender != Some(true)
}
const RESOURCES: &[&str] = &["SKILL.md", "NOTICE.txt", "references/craft.md", "references/joints.md", "scripts/build_sequence.luau", "scripts/inspect_pose.luau", "upstream/SKILL.md", "upstream/scripts/build_sequence.luau", "upstream/scripts/inspect_pose.luau"];
pub fn read(root: &Path, request: &Value) -> anyhow::Result<Value> {
    let relative = request["resource"].as_str().unwrap_or("SKILL.md");
    anyhow::ensure!(RESOURCES.contains(&relative), "Unknown Eclipse resource");
    let root = std::fs::canonicalize(root).map_err(|_|anyhow::anyhow!("Eclipse skill files are missing; extract the complete Elio ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "Eclipse resource escapes bundle");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024*1024, "Eclipse resource too large");
    let text = std::fs::read_to_string(&path)?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(12000).clamp(1,24000) as usize;
    let end = offset.saturating_add(limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,"next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),"bundle_root":root,"resources":RESOURCES,"source":"User-provided Eclipse Animator skill; Elio adaptation","adaptation":"Reference only. Read scripts/, not upstream/scripts/. No plugin installation, UI save, publishing or live verification is implied."}))
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn routing_respects_blender_scope_and_explicit_choice() {
  for (q,b,want) in [("Animate this character",None,true),("Сделай анимацию удара",Some(false),true),("Animate this character",Some(true),false),("Use Eclipse Animator for a walk",Some(true),true),("Анимируй через Эклипс",Some(true),true),("Не используй Eclipse",Some(false),false),("Do not use Eclipse",Some(false),false),("Animate the character only in Blender",Some(false),false),("Animate a CSS button",Some(false),false),("Сделай анимацию меню",None,false),("Fix inventory code",None,false),("Run all unit tests",None,false),("Make the character wave",None,true),("Сделай удар персонажа",Some(false),true)] {assert_eq!(should_use(q,"roblox",b),want,"{q}");}
  assert!(!should_use("Use Eclipse Animator","local",Some(false)));
 }
 #[test] fn shipped_resources_are_complete_and_unicode_safe() {
  let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../starter-skills/eclipse-animator");
  for resource in RESOURCES {let r=read(&root,&json!({"resource":resource,"limit":24000})).unwrap();assert!(!r["content"].as_str().unwrap().is_empty(),"{resource}");}
  assert_eq!(catalog()["enabled"],true);assert_eq!(catalog()["confirmed"],false);
 }
 #[test] fn resources_are_bounded_and_cannot_traverse() {
  let root=std::env::temp_dir().join(format!("elio-eclipse-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();std::fs::write(root.join("SKILL.md"),"абв🐔text").unwrap();
  let a=read(&root,&json!({"limit":3})).unwrap();assert_eq!(a["content"],"абв");assert_eq!(a["next_offset"],3);
  let b=read(&root,&json!({"offset":3,"limit":1})).unwrap();assert_eq!(b["content"],"🐔");
  assert!(read(&root,&json!({"resource":"../SKILL.md"})).is_err());assert!(read(&root,&json!({"resource":"/etc/passwd"})).is_err());
  let _=std::fs::remove_dir_all(root);
 }
}
