// Tests compile the real module, including its persistence and migration regressions.
// This harness deliberately does not test application-specific settings_path discovery.
#[cfg(target_os = "macos")]
mod platform {
    pub fn configuration_root() -> std::path::PathBuf { std::env::temp_dir() }
}
#[path = "../../agent/src/preferences.rs"]
mod preferences;
