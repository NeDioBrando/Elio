use std::path::{Path,PathBuf};
pub fn installation_root_at(executable:&Path)->PathBuf {
    for ancestor in executable.ancestors().skip(1) {
        if ancestor.extension().is_some_and(|extension|extension=="app") {
            return ancestor.parent().unwrap_or_else(||Path::new(".")).to_owned();
        }
    }
    executable.parent().unwrap_or_else(||Path::new(".")).to_owned()
}
pub fn is_installation_root(root:&Path)->bool {root.join("manifest.json").is_file()||root.join("synerixcode-Extension/manifest.json").is_file()}
/// macOS Gatekeeper "App Translocation" runs a quarantined app from a random
/// read-only copy (/private/var/folders/.../AppTranslocation/<id>/d/synerixcode.app)
/// that contains only the .app, so its parent has no synerixcode files. The same
/// happens when only synerixcode.app is dragged to /Applications.
pub fn is_translocated(executable:&Path)->bool {executable.components().any(|part|part.as_os_str()=="AppTranslocation")}
/// Prefer the folder around the running app; when that is not a synerixcode
/// installation, fall back to the folder recorded by the launch scripts or an
/// earlier normal launch, provided it still contains a complete installation.
pub fn resolve_installation_root(executable:&Path,recorded:Option<PathBuf>)->PathBuf {
    let direct=installation_root_at(executable);
    if is_installation_root(&direct) { return direct; }
    match recorded { Some(root) if root.is_absolute()&&is_installation_root(&root)&&root.join("synerixcode.app").is_dir() => root, _ => direct }
}
#[cfg(target_os="macos")]
fn root_record()->PathBuf {configuration_root().join("install-root")}
#[cfg(target_os="macos")]
fn recorded_root()->Option<PathBuf> {std::fs::read_to_string(root_record()).ok().map(|raw|PathBuf::from(raw.trim_end_matches(['\r','\n'])))}
#[cfg(not(target_os="macos"))]
fn recorded_root()->Option<PathBuf> {None}
pub fn installation_root()->PathBuf {std::env::current_exe().ok().map(|path|resolve_installation_root(&path,recorded_root())).unwrap_or_default()}
/// Records a verified installation folder so a later translocated or moved
/// launch can still find it, and clears the download quarantine flag so macOS
/// stops translocating the app on the next launch.
#[cfg(target_os="macos")]
pub fn remember_installation_root() {
    let Ok(exe)=std::env::current_exe() else { return };
    let root=installation_root();
    if !is_installation_root(&root) { return; }
    if !is_translocated(&exe) && installation_root_at(&exe)==root {
        let record=root_record();
        if recorded_root().as_deref()!=Some(root.as_path()) {
            if let Some(parent)=record.parent() { let _=std::fs::create_dir_all(parent); }
            let pending=record.with_extension("pending");
            if std::fs::write(&pending,format!("{}\n",root.display())).is_ok() { let _=std::fs::rename(&pending,&record); }
        }
    }
    let _=std::process::Command::new("/usr/bin/xattr").arg("-dr").arg("com.apple.quarantine").arg(&root)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
}
#[cfg(target_os="macos")]
pub fn configuration_root()->PathBuf {PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join("Library/Application Support/synerixcode")}
#[cfg(test)]mod tests{use super::*;#[test]fn bundle_root_is_outside_signed_app(){assert_eq!(installation_root_at(Path::new("/Applications/synerixcode/synerixcode.app/Contents/MacOS/synerixcode")),Path::new("/Applications/synerixcode"));assert_eq!(installation_root_at(Path::new("/opt/synerixcode/synerixcode")),Path::new("/opt/synerixcode"));}}

#[cfg(target_os="macos")]
pub fn prepare_application_path() {
    // Finder does not inherit a user's interactive shell PATH.
    let mut paths=vec![PathBuf::from("/opt/homebrew/bin"),PathBuf::from("/usr/local/bin")];
    if let Some(home)=std::env::var_os("HOME") { paths.push(PathBuf::from(home).join(".local/bin")); }
    if let Some(existing)=std::env::var_os("PATH") { paths.extend(std::env::split_paths(&existing)); }
    if let Ok(path)=std::env::join_paths(paths) { std::env::set_var("PATH",path); }
}

#[cfg(test)] mod translocation_tests {
    use super::*;
    fn install(root:&Path){std::fs::create_dir_all(root.join("synerixcode.app/Contents/MacOS")).unwrap();std::fs::write(root.join("manifest.json"),"{}").unwrap();}
    #[test] fn translocated_launch_uses_recorded_installation() {
        let base=std::env::temp_dir().join(format!("synerixcode-transloc-{}",std::process::id()));let _=std::fs::remove_dir_all(&base);
        let real=base.join("Downloads/synerixcode");install(&real);
        let exe=base.join("private/var/folders/x/T/AppTranslocation/ABC/d/synerixcode.app/Contents/MacOS/synerixcode");std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert!(is_translocated(&exe));
        assert_eq!(resolve_installation_root(&exe,Some(real.clone())),real);
        // Without a usable record the original location is reported unchanged.
        assert_eq!(resolve_installation_root(&exe,None),base.join("private/var/folders/x/T/AppTranslocation/ABC/d"));
        assert_eq!(resolve_installation_root(&exe,Some(base.join("missing"))),base.join("private/var/folders/x/T/AppTranslocation/ABC/d"));
        assert_eq!(resolve_installation_root(&exe,Some(PathBuf::from("relative/synerixcode"))),base.join("private/var/folders/x/T/AppTranslocation/ABC/d"));
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test] fn normal_launch_ignores_record() {
        let base=std::env::temp_dir().join(format!("synerixcode-normal-{}",std::process::id()));let _=std::fs::remove_dir_all(&base);
        let a=base.join("A");let b=base.join("B");install(&a);install(&b);
        let exe=a.join("synerixcode.app/Contents/MacOS/synerixcode");
        assert!(!is_translocated(&exe));
        assert_eq!(resolve_installation_root(&exe,Some(b)),a);
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test] fn app_moved_to_applications_uses_record() {
        let base=std::env::temp_dir().join(format!("synerixcode-moved-{}",std::process::id()));let _=std::fs::remove_dir_all(&base);
        let real=base.join("synerixcode");install(&real);
        let exe=base.join("Applications/synerixcode.app/Contents/MacOS/synerixcode");std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert_eq!(resolve_installation_root(&exe,Some(real.clone())),real);
        std::fs::remove_dir_all(base).unwrap();
    }
}
