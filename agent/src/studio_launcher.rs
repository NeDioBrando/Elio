use std::path::{Path, PathBuf};

/// Preserve Roblox's official launcher when present. Otherwise discover the
/// active or a complete installed version; never scan entire user drives.
pub fn windows_launcher(running: &[PathBuf], local: Option<&Path>, roots: &[PathBuf]) -> Option<PathBuf> {
    if let Some(local) = local {
        let official = local.join("Roblox/mcp.bat");
        if official.is_file() { return Some(official); }
    }
    for studio in running {
        if let Some(parent) = studio.parent() {
            let helper = parent.join("StudioMCP.exe");
            if helper.is_file() { return Some(helper); }
        }
    }
    let mut candidates = Vec::new();
    for root in roots {
        for versions in [root.join("Roblox/Versions"), root.join("Roblox Studio/Versions")] {
            let Ok(entries) = std::fs::read_dir(versions) else { continue; };
            for entry in entries.flatten().take(512) {
                let folder = entry.path();
                let helper = folder.join("StudioMCP.exe");
                if helper.is_file() && folder.join("RobloxStudioBeta.exe").is_file() {
                    let modified = helper.metadata().ok().and_then(|m| m.modified().ok()).unwrap_or(std::time::UNIX_EPOCH);
                    candidates.push((modified, helper));
                }
            }
        }
    }
    candidates.sort();
    candidates.pop().map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_windows_discovery_handles_missing_batch_and_running_installs() {
        let root=std::env::temp_dir().join(format!("elio-launcher-{}",std::process::id()));
        let _=std::fs::remove_dir_all(&root);
        let local=root.join("User Profile/Local");
        let program=root.join("Program Files");
        let complete=program.join("Roblox/Versions/version-complete");
        let incomplete=local.join("Roblox/Versions/version-incomplete");
        let running=root.join("Custom Studio/current");
        for dir in [&complete,&incomplete,&running] {std::fs::create_dir_all(dir).unwrap();}
        std::fs::write(complete.join("StudioMCP.exe"),b"helper").unwrap();
        std::fs::write(complete.join("RobloxStudioBeta.exe"),b"studio").unwrap();
        std::fs::write(incomplete.join("StudioMCP.exe"),b"stale").unwrap();
        let roots=vec![local.clone(),program];
        assert_eq!(windows_launcher(&[],Some(&local),&roots),Some(complete.join("StudioMCP.exe")),"Missing mcp.bat must not prevent a complete installation from connecting");
        let batch=local.join("Roblox/mcp.bat");std::fs::write(&batch,b"official").unwrap();
        assert_eq!(windows_launcher(&[],Some(&local),&roots),Some(batch.clone()));
        let active=running.join("RobloxStudioBeta.exe");let helper=running.join("StudioMCP.exe");
        std::fs::write(&active,b"active").unwrap();std::fs::write(&helper,b"matching").unwrap();
        assert_eq!(windows_launcher(&[active.clone()],Some(&local),&roots),Some(batch.clone()),"Preserve the official launcher when available");
        std::fs::remove_file(batch).unwrap();
        assert_eq!(windows_launcher(&[active],Some(&local),&roots),Some(helper),"When the batch launcher is missing, use the running Studio's matching helper");
        assert!(windows_launcher(&[],None,&[]).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
