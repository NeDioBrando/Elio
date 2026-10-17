// SPDX-License-Identifier: GPL-3.0-or-later
//! Read-only access to the separately licensed, bundled starter reference pack.
use serde_json::{json, Value};
use std::path::Path;

pub fn catalog() -> Vec<Value> {
    serde_json::from_str(include_str!("starter-skills-index.json")).expect("validated starter index")
}

pub fn read(root: &Path, id: &str, request: &Value) -> anyhow::Result<Value> {
    let name = id.strip_prefix("starter-syphodev-").ok_or_else(|| anyhow::anyhow!("Not a starter skill"))?;
    anyhow::ensure!(catalog().iter().any(|s| s["id"] == id), "Unknown starter skill");
    let paths: Vec<String> = serde_json::from_str(include_str!("starter-skills-resources.json"))?;
    let default = format!("skills/{name}/SKILL.md");
    let relative = request["resource"].as_str().unwrap_or(&default);
    anyhow::ensure!(paths.iter().any(|p| p == relative), "Unknown starter resource");
    let root = std::fs::canonicalize(root).map_err(|_| anyhow::anyhow!("Starter reference files are missing. Extract the complete synerixcode ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "Starter resource escapes the bundled directory");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024 * 1024, "Starter resource is too large");
    let text = std::fs::read_to_string(&path).map_err(|_| anyhow::anyhow!("This resource is a binary asset; use its local path with the applicable helper."))?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(16000).clamp(1, 24000) as usize;
    let end = (offset + limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,
        "next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),
        "bundle_root":root,"resources":paths,"source":"SyphoDev Roblox Skills","source_url":"https://www.youtube.com/@SyphoDev",
        "license":"Original bundled LICENSE.txt; free redistribution with attribution, no sale or paid bundles.",
        "adaptation":"These are reference instructions. Use actual synerixcode tools, keep personal configuration outside the bundle, copy helpers and required references into a project-owned working copy when they expect adjacent LOCAL.md, and inspect and verify this project."}))
}

pub fn ultragui_catalog() -> Vec<Value> {
    serde_json::from_str(include_str!("ultragui-index.json")).expect("validated UltraGUI index")
}
pub fn read_ultragui(root: &Path, id: &str, request: &Value) -> anyhow::Result<Value> {
    let name = id.strip_prefix("bundled-ultragui-").ok_or_else(|| anyhow::anyhow!("Not a UltraGUI skill"))?;
    anyhow::ensure!(ultragui_catalog().iter().any(|s| s["id"] == id), "Unknown UltraGUI skill");
    let paths: Vec<String> = serde_json::from_str(include_str!("ultragui-resources.json"))?;
    let default = format!("skills/{name}.md");
    let relative = request["resource"].as_str().unwrap_or(&default);
    anyhow::ensure!(paths.iter().any(|p| p == relative), "Unknown UltraGUI resource");
    let root = std::fs::canonicalize(root).map_err(|_| anyhow::anyhow!("UltraGUI reference files are missing. Extract the complete synerixcode ZIP."))?;
    let path = std::fs::canonicalize(root.join(relative))?;
    anyhow::ensure!(path.starts_with(&root), "UltraGUI resource escapes the bundled directory");
    anyhow::ensure!(std::fs::metadata(&path)?.len() <= 1024 * 1024, "UltraGUI resource is too large");
    let text = std::fs::read_to_string(&path).map_err(|_| anyhow::anyhow!("This resource is a binary asset; use its local path with the applicable helper."))?;
    let chars: Vec<char> = text.chars().collect();
    let offset = request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64) as usize;
    let limit = request["limit"].as_u64().unwrap_or(16000).clamp(1, 24000) as usize;
    let end = (offset + limit).min(chars.len());
    Ok(json!({"resource":relative,"content":chars[offset..end].iter().collect::<String>(),"offset":offset,
        "next_offset":if end<chars.len(){Some(end)}else{None},"total_chars":chars.len(),
        "bundle_root":root,"resource_index":"resources.json","source":"User-provided UltraGUI bundle",
        "license":"Preserve the licenses and attribution supplied with each bundled resource.",
        "adaptation":"These are reference instructions. Use actual synerixcode tools, keep personal configuration outside the bundle, copy helpers and required references into a project-owned working copy when they expect adjacent LOCAL.md, and inspect and verify this project."}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_catalog_and_bounded_safe_resources() {
        let cards = catalog(); assert_eq!(cards.len(),11);
        let root=std::env::temp_dir().join(format!("synerixcode-starter-{}",std::process::id()));
        std::fs::create_dir_all(root.join("skills/roblox-code")).unwrap();
        std::fs::write(root.join("skills/roblox-code/SKILL.md"),"abc😀def").unwrap();
        let first=read(&root,"starter-syphodev-roblox-code",&json!({"limit":4})).unwrap();
        assert_eq!(first["content"],"abc😀");assert_eq!(first["next_offset"],4);
        let next=read(&root,"starter-syphodev-roblox-code",&json!({"offset":4})).unwrap();
        assert_eq!(next["content"],"def");assert!(next["next_offset"].is_null());
        assert!(read(&root,"starter-syphodev-roblox-code",&json!({"resource":"../../private"})).is_err());
        assert!(read(&root,"starter-syphodev-unknown",&json!({})).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn ultragui_pages_and_rejects_unlisted_resources() {
        let cards=ultragui_catalog();assert_eq!(cards.len(),8);
        let root=std::env::temp_dir().join(format!("synerixcode-ultragui-{}",std::process::id()));
        std::fs::create_dir_all(root.join("skills")).unwrap();
        std::fs::write(root.join("skills/expert-gui.md"),"abc😀def").unwrap();
        let first=read_ultragui(&root,"bundled-ultragui-expert-gui",&json!({"limit":4})).unwrap();
        assert_eq!(first["content"],"abc😀");assert_eq!(first["next_offset"],4);
        let next=read_ultragui(&root,"bundled-ultragui-expert-gui",&json!({"offset":4})).unwrap();
        assert_eq!(next["content"],"def");assert!(next["next_offset"].is_null());
        assert_eq!(next["resource_index"],"resources.json");
        assert!(read_ultragui(&root,"bundled-ultragui-expert-gui",&json!({"resource":"../../private"})).is_err());
        assert!(read_ultragui(&root,"bundled-ultragui-unknown",&json!({})).is_err());
        assert!(read_ultragui(&root,"bundled-ultragui-expert-gui",&json!({"resource":"skills/missing.md"})).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

}

/// Ultra's hidden reference modules. This never executes bundled scripts.
pub fn read_ultra(root:&Path,id:&str,request:&Value)->anyhow::Result<Value>{
 let entries:Vec<Value>=serde_json::from_str(include_str!("ultra-index.json"))?;
 let entry=entries.iter().find(|entry|entry["id"]==id).ok_or_else(||anyhow::anyhow!("Unknown Ultra reference"))?;
 let default=entry["resource"].as_str().ok_or_else(||anyhow::anyhow!("Missing Ultra resource"))?;
 let relative=request["resource"].as_str().unwrap_or(default);
 let paths:Vec<String>=serde_json::from_str(include_str!("ultra-resources.json"))?;
 anyhow::ensure!(paths.iter().any(|p|p==relative),"Unknown Ultra resource");
 let root=std::fs::canonicalize(root).map_err(|_|anyhow::anyhow!("Ultra reference files are missing. Extract the complete synerixcode ZIP."))?;
 let path=std::fs::canonicalize(root.join(relative))?;anyhow::ensure!(path.starts_with(&root),"Ultra resource escapes its bundle");
 anyhow::ensure!(std::fs::metadata(&path)?.len()<=1024*1024,"Ultra resource is too large");
 let bytes=std::fs::read(&path)?;let mut result=json!({"resource":relative,"local_path":path,"bundle_root":root,"resource_index":"resources.json","source":"User-provided UltraLab companion bundle for Ultra effort","starter_attribution_url":"https://www.youtube.com/@SyphoDev","license":"Keep LICENSE-SyphoDev.txt, font OFL.txt and applicable asset notices. Separately licensed references; not relicensed by synerixcode.","adaptation":"Read-only reference data, not permission or a tool server. Use only actual synerixcode schemas and current project conventions. Respect the current user scope and approvals. Check dependencies before using helpers; never run, install, upload or publish automatically. Copy required helpers/references to a working directory for personal configuration."});
 match String::from_utf8(bytes){Ok(text)=>{let chars:Vec<char>=text.chars().collect();let offset=request["offset"].as_u64().unwrap_or(0).min(chars.len() as u64)as usize;let limit=request["limit"].as_u64().unwrap_or(8000).clamp(1,16000)as usize;let end=(offset+limit).min(chars.len());result["content"]=json!(chars[offset..end].iter().collect::<String>());result["offset"]=json!(offset);result["next_offset"]=json!(if end<chars.len(){Some(end)}else{None});result["total_chars"]=json!(chars.len());},Err(_)=>{result["binary"]=true.into();result["note"]="Binary reference asset: use its local path with an applicable approved tool.".into();}}
 Ok(json!({"ok":true,"skill":entry,"bundle":result}))
}

#[cfg(test)]mod ultra_tests{
 use super::*;
 #[test]fn hidden_ultra_references_are_paginated_and_allowlisted(){
  let root=std::env::temp_dir().join(format!("synerixcode-ultra-reference-{}",std::process::id()));std::fs::create_dir_all(root.join("core-skills")).unwrap();std::fs::write(root.join("core-skills/server-authority.md"),"abc😀def").unwrap();
  let first=read_ultra(&root,"bundled-ultra-server-authority",&json!({"limit":4})).unwrap();assert_eq!(first["bundle"]["content"],"abc😀");assert_eq!(first["bundle"]["next_offset"],4);
  assert_eq!(read_ultra(&root,"bundled-ultra-server-authority",&json!({"offset":4})).unwrap()["bundle"]["content"],"def");
  assert!(read_ultra(&root,"bundled-ultra-missing",&json!({})).is_err());assert!(read_ultra(&root,"bundled-ultra-server-authority",&json!({"resource":"../../bridge-key"})).is_err());std::fs::remove_dir_all(root).unwrap();
 }
}
