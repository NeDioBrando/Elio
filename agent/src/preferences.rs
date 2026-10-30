use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopPreferences {
    /// elio interface language only; never used to rewrite AI prompts or tool arguments.
    #[serde(rename = "rsLanguage", deserialize_with = "deserialize_language")]
    pub language: String,
    #[serde(rename = "rsColorMode")]
    pub color_mode: String,
    #[serde(rename = "rs-engine")]
    pub engine: String,
    #[serde(rename = "rsWorkMode")]
    pub work_mode: String,
    #[serde(rename = "rsPermMode")]
    pub perm_mode: String,
    #[serde(rename = "rsStopMode")]
    pub stop_mode: String,
    #[serde(rename = "rsToolBudget")]
    pub tool_budget: u32,
    #[serde(rename = "rsRunLimitsEnabled")]
    pub run_limits_enabled: bool,
    #[serde(rename = "rsInputLimitEnabled")]
    pub input_limit_enabled: bool,
    #[serde(rename = "rsInputCharLimit")]
    pub input_char_limit: u32,
    #[serde(rename = "rsOutputLimitEnabled")]
    pub output_limit_enabled: bool,
    #[serde(rename = "rsOutputCharLimit")]
    pub output_char_limit: u32,
    #[serde(rename = "rsTaskMinutes")]
    pub task_minutes: u32,
    #[serde(rename = "rsVisualCheck")]
    pub visual_check: bool,
    #[serde(rename = "rsContinuationOffer")]
    pub continuation_offer: bool,
    #[serde(rename = "rsCommandCooldown")]
    pub command_cooldown: f64,
    #[serde(rename = "rsSounds")]
    pub sounds: bool,
    #[serde(rename = "rsExtraThinking")]
    pub extra_thinking: bool,
    #[serde(rename = "rsShowApproach")]
    pub show_approach: bool,
    #[serde(rename = "rsPlanMode")]
    pub plan_mode: bool,
    #[serde(rename = "rsThinkingLevel")]
    pub thinking_level: String,
    #[serde(rename = "rsForgeMode")]
    pub forge_mode: bool,
    #[serde(rename = "rsAutoFix")]
    pub auto_fix: bool,
    #[serde(rename = "rsBgMode")]
    pub bg_mode: bool,
    #[serde(rename = "rsCustomPrompt", skip_serializing_if = "Option::is_none")]
    pub custom_prompt: Option<String>,
    #[serde(rename = "rsAppearance", skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Appearance>,
    #[serde(rename = "rsSidebarCollapsed")]
    pub sidebar_collapsed: bool,
    #[serde(rename = "rsExplorerAutoSync")]
    pub explorer_auto_sync: bool,
    #[serde(rename = "rsSkillAutoLearn")]
    pub skill_auto_learn: bool,
    #[serde(rename = "rsSharedLearning")]
    pub shared_learning: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Appearance {
    pub theme: String,
    pub glow: String,
    pub gradients: String,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            color_mode: "dark".to_string(),
            engine: "roblox".to_string(),
            work_mode: "balanced".to_string(),
            perm_mode: "sandbox".to_string(),
            sounds: true,
            stop_mode: "immediate".into(),
            input_limit_enabled:true,input_char_limit:120000,output_limit_enabled:true,output_char_limit:32000,tool_budget:0,run_limits_enabled:false,task_minutes:0,visual_check:true,continuation_offer:true,command_cooldown:0.0,
            extra_thinking: false,
            show_approach: false,
            plan_mode: false,
            thinking_level: "default".to_string(),
            forge_mode: true,
            auto_fix: true,
            bg_mode: true,
            custom_prompt: None,
            appearance: None,
            sidebar_collapsed: false, explorer_auto_sync: true, skill_auto_learn: true, shared_learning: true,
        }
    }
}

// Keep this allowlist aligned with the shared interface picker, not OS/browser locales.
fn normalize_language(code: &str) -> &str {
    match code {
        "en" | "es" | "fr" | "ru" | "ar" | "zh-CN" | "zh-TW" | "ja" | "ko" |
        "de" | "pt-BR" | "it" | "hi" | "tr" | "pl" => code,
        _ => "en",
    }
}

fn deserialize_language<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    // A malformed language must not discard the user's other saved preferences.
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(normalize_language(value.as_str().unwrap_or("en")).to_string())
}

impl DesktopPreferences {
    pub fn normalize(&mut self) {
        self.language = normalize_language(&self.language).to_string();
        self.shared_learning=true; // mandatory privacy-safe global workflow learning
        self.input_char_limit=self.input_char_limit.clamp(1000,2000000);self.output_char_limit=self.output_char_limit.clamp(1000,2000000);
        self.tool_budget=self.tool_budget.min(1000);self.task_minutes=self.task_minutes.min(240);
        self.command_cooldown=if self.command_cooldown.is_finite(){(self.command_cooldown.clamp(0.0,120.0)*10.0).round()/10.0}else{0.0};
        if !matches!(self.stop_mode.as_str(),"safe"|"immediate") {self.stop_mode="immediate".into();}
        if !matches!(self.color_mode.as_str(), "light" | "dark") {self.color_mode="dark".into();}
        if let Some(value) = &mut self.appearance {
            if value.theme=="solar" {value.theme="default".into();}
            if !matches!(value.theme.as_str(), "default" | "amethyst" | "cyan" | "rose" | "emerald" | "graphite" | "crimson" | "ocean" | "copper" | "aurora" | "orchid") { value.theme = "default".into(); }
            if !matches!(value.glow.as_str(), "off" | "subtle" | "strong") { value.glow = "subtle".into(); }
            if !matches!(value.gradients.as_str(), "off" | "on") { value.gradients = "on".into(); }
        }
        if !matches!(self.engine.as_str(), "roblox" | "local") {
            self.engine = "roblox".to_string();
        }
        if !matches!(self.work_mode.as_str(), "fast" | "balanced" | "thorough") {
            self.work_mode = "balanced".to_string();
        }
        if !matches!(self.perm_mode.as_str(), "sandbox" | "ask" | "full") {
            self.perm_mode = "sandbox".to_string();
        }
        if !matches!(self.thinking_level.as_str(), "default" | "low" | "mid" | "high" | "max" | "ultracode") {
            self.thinking_level = "default".to_string();
        }
    }
}

pub struct PreferencesStore {
    path: PathBuf,
    inner: RwLock<DesktopPreferences>,
}

impl PreferencesStore {
    pub fn load() -> Self {
        Self::load_from(settings_path())
    }

    fn load_from(path: PathBuf) -> Self {
        let mut prefs = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<DesktopPreferences>(&raw).ok())
            .unwrap_or_default();
        prefs.normalize();
        Self { path, inner: RwLock::new(prefs) }
    }

    pub fn persisted(&self) -> bool {
        self.path.exists()
    }

    pub fn snapshot(&self) -> DesktopPreferences {
        self.inner.read().map(|p| p.clone()).unwrap_or_default()
    }

    fn edit_persisted(&self, edit:impl FnOnce(&mut DesktopPreferences)->anyhow::Result<()>) -> anyhow::Result<DesktopPreferences> {
        let mut guard=self.inner.write().map_err(|_|anyhow::anyhow!("preferences lock poisoned"))?;
        let mut next=guard.clone();edit(&mut next)?;next.normalize();
        // Keep read/modify/write serialized, and publish only after durable save succeeds.
        self.save(&next)?;*guard=next.clone();Ok(next)
    }
    pub fn replace(&self, prefs:DesktopPreferences)->anyhow::Result<DesktopPreferences> {
        self.edit_persisted(|next|{*next=prefs;Ok(())})
    }
    pub fn patch(&self, patch:serde_json::Value)->anyhow::Result<DesktopPreferences> {
        self.edit_persisted(|next|{
            let mut value=serde_json::to_value(&*next)?;
            let dst=value.as_object_mut().ok_or_else(||anyhow::anyhow!("preferences are not an object"))?;
            let src=patch.as_object().ok_or_else(||anyhow::anyhow!("preferences patch must be an object"))?;
            for (key,val) in src {if dst.contains_key(key)||key=="rsCustomPrompt"||key=="rsAppearance"{dst.insert(key.clone(),val.clone());}}
            *next=serde_json::from_value(value)?;Ok(())
        })
    }
    pub fn update<F>(&self,mut edit:F)->anyhow::Result<DesktopPreferences> where F:FnMut(&mut DesktopPreferences) {
        self.edit_persisted(|next|{edit(next);Ok(())})
    }

    fn save(&self, prefs: &DesktopPreferences) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(prefs)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn settings_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    { return crate::platform::configuration_root().join("elio-settings.json"); }
    #[cfg(not(target_os = "macos"))]
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("elio-settings.json")))
        .unwrap_or_else(|| PathBuf::from("elio-settings.json"))
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path() -> PathBuf {
        // macOS clocks can return the same timestamp in parallel test threads.
        // A process-local sequence keeps both final and .tmp paths isolated.
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("elio-settings-{}-{nonce}-{sequence}.json", std::process::id()))
    }

    #[test]
    fn language_defaults_to_english_and_migrates_old_settings_without_losing_choices() {
        let path = temp_settings_path();
        let store = PreferencesStore::load_from(path.clone());
        assert_eq!(store.snapshot().language, "en");
        assert_eq!(serde_json::to_value(store.snapshot()).unwrap()["rsLanguage"], "en");
        std::fs::write(&path, serde_json::to_vec(&serde_json::json!({
            "rs-engine":"local", "rsStopMode":"safe",
            "rsThinkingLevel":"ultracode", "rsCustomPrompt":"Settings\nمرحبا café 你好",
            "rsAppearance":{"theme":"cyan","glow":"strong","gradients":"off"}
        })).unwrap()).unwrap();
        let legacy = PreferencesStore::load_from(path.clone());
        assert_eq!(legacy.snapshot().language, "en");
        legacy.patch(serde_json::json!({"rsLanguage":"ar"})).unwrap();
        let reopened = PreferencesStore::load_from(path.clone()).snapshot();
        assert_eq!(reopened.language, "ar");
        assert_eq!(reopened.engine, "local");
        assert_eq!(reopened.stop_mode, "safe");
        assert_eq!(reopened.thinking_level, "ultracode");
        assert_eq!(reopened.custom_prompt.as_deref(), Some("Settings\nمرحبا café 你好"));
        assert_eq!(reopened.appearance.unwrap().theme, "cyan");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn every_supported_language_persists_across_reopen_and_unrelated_patches() {
        let path = temp_settings_path();
        for language in ["en", "es", "fr", "ru", "ar", "zh-CN", "zh-TW", "ja", "ko", "de", "pt-BR", "it", "hi", "tr", "pl"] {
            let store = PreferencesStore::load_from(path.clone());
            store.patch(serde_json::json!({"rsLanguage":language})).unwrap();
            let reopened = PreferencesStore::load_from(path.clone());
            assert_eq!(reopened.snapshot().language, language);
            reopened.patch(serde_json::json!({"rsSounds":false})).unwrap();
            assert_eq!(PreferencesStore::load_from(path.clone()).snapshot().language, language);
            let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["rsLanguage"], language);
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_language_falls_back_without_resetting_other_preferences() {
        let path = temp_settings_path();
        let store = PreferencesStore::load_from(path.clone());
        store.patch(serde_json::json!({"rsStopMode":"safe","rsCustomPrompt":"Do not translate Settings or C:\\Game\\main.lua"})).unwrap();
        for value in [serde_json::json!(""), serde_json::json!("xx"), serde_json::json!("AR"),
            serde_json::json!("zh"), serde_json::json!("pt"), serde_json::json!(" es "),
            serde_json::json!(null), serde_json::json!(42), serde_json::json!(false),
            serde_json::json!([]), serde_json::json!({"code":"es"})] {
            store.patch(serde_json::json!({"rsLanguage":"fr"})).unwrap();
            store.patch(serde_json::json!({"rsLanguage":value})).unwrap();
            let reopened = PreferencesStore::load_from(path.clone()).snapshot();
            assert_eq!(reopened.language, "en");
            assert_eq!(reopened.stop_mode, "safe");
            assert_eq!(reopened.custom_prompt.as_deref(), Some("Do not translate Settings or C:\\Game\\main.lua"));
        }
        // Invalid saved types should also preserve unrelated settings on load.
        std::fs::write(&path, br#"{"rsLanguage":{},"rsStopMode":"safe"}"#).unwrap();
        let loaded = PreferencesStore::load_from(path.clone()).snapshot();
        assert_eq!(loaded.language, "en");
        assert_eq!(loaded.stop_mode, "safe");
        let mut direct = loaded;
        direct.language = "invalid".into();
        store.replace(direct).unwrap();
        assert_eq!(PreferencesStore::load_from(path.clone()).snapshot().language, "en");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ultracode_and_legacy_solar_preferences_are_preserved() {
        let mut prefs=DesktopPreferences::default();prefs.thinking_level="ultracode".into();
        prefs.appearance=Some(Appearance{theme:"solar".into(),glow:"strong".into(),gradients:"off".into()});
        prefs.normalize();assert_eq!(prefs.thinking_level,"ultracode");
        let appearance=prefs.appearance.unwrap();assert_eq!(appearance.theme,"default");assert_eq!(appearance.glow,"strong");assert_eq!(appearance.gradients,"off");
    }
    #[test]
    fn immediate_stop_default_and_selected_safe_mode_persist() {
        let path=temp_settings_path();let store=PreferencesStore::load_from(path.clone());
        assert_eq!(store.snapshot().stop_mode,"immediate");
        store.patch(serde_json::json!({"rsStopMode":"safe"})).unwrap();
        assert_eq!(PreferencesStore::load_from(path.clone()).snapshot().stop_mode,"safe");
        store.patch(serde_json::json!({"rsStopMode":"invalid"})).unwrap();
        assert_eq!(store.snapshot().stop_mode,"immediate");let _=std::fs::remove_file(path);
    }
    #[test]
    fn continuation_offer_defaults_on_and_persists_off() {
        let path=temp_settings_path();let store=PreferencesStore::load_from(path.clone());
        assert!(store.snapshot().continuation_offer,"new installs keep the continuation prompt on");
        assert_eq!(serde_json::to_value(store.snapshot()).unwrap()["rsContinuationOffer"],serde_json::json!(true));
        store.patch(serde_json::json!({"rsContinuationOffer":false})).unwrap();
        assert!(!PreferencesStore::load_from(path.clone()).snapshot().continuation_offer,"turning the prompt off survives a restart");
        std::fs::write(&path,br#"{"rsStopMode":"safe"}"#).unwrap();
        assert!(PreferencesStore::load_from(path.clone()).snapshot().continuation_offer,"settings saved by older versions default to on");
        let _=std::fs::remove_file(path);
    }
    #[test]
    fn shared_appearance_persists_and_normalizes() {
        let path = temp_settings_path();
        let store = PreferencesStore::load_from(path.clone());
        assert!(store.snapshot().appearance.is_none());
        store.patch(serde_json::json!({"rsAppearance":{"theme":"cyan","glow":"strong","gradients":"off"}})).unwrap();
        let reopened = PreferencesStore::load_from(path.clone());
        let value = reopened.snapshot().appearance.unwrap();
        assert_eq!(value.theme, "cyan");
        assert_eq!(value.glow, "strong");
        assert_eq!(value.gradients, "off");
        reopened.patch(serde_json::json!({"rsAppearance":{"theme":"unknown","glow":"bad","gradients":"bad"}})).unwrap();
        let value = reopened.snapshot().appearance.unwrap();
        assert_eq!(value.theme, "default");
        assert_eq!(value.glow, "subtle");
        assert_eq!(value.gradients, "on");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn preferences_persist_across_reopen() {
        let path = temp_settings_path();
        let store = PreferencesStore::load_from(path.clone());
        assert!(!store.persisted());

        let mut prefs = store.snapshot();
        prefs.engine = "local".to_string();
        prefs.work_mode = "thorough".to_string();
        prefs.perm_mode = "ask".to_string();
        prefs.sounds = false;
        prefs.extra_thinking = true;
        assert!(!prefs.show_approach);
        prefs.show_approach = true;
        prefs.plan_mode = true;
        prefs.thinking_level = "max".to_string();
        prefs.forge_mode = false;
        prefs.auto_fix = false;
        prefs.bg_mode = false;
        store.replace(prefs).expect("save preferences");
        assert!(store.persisted());

        let reopened = PreferencesStore::load_from(path.clone()).snapshot();
        assert_eq!(reopened.engine, "local");
        assert_eq!(reopened.work_mode, "thorough");
        assert_eq!(reopened.perm_mode, "ask");
        assert!(!reopened.sounds);
        assert!(reopened.extra_thinking);
        assert!(reopened.show_approach);
        assert!(reopened.plan_mode);
        assert_eq!(reopened.thinking_level, "max");
        assert!(!reopened.forge_mode);
        assert!(!reopened.auto_fix);
        assert!(!reopened.bg_mode);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn instructions_preserve_old_settings_and_persist_multiline_and_clear() {
        let path = temp_settings_path();
        let store = PreferencesStore::load_from(path.clone());
        assert!(serde_json::to_value(store.snapshot()).unwrap().get("rsCustomPrompt").is_none());
        let text = "Keep working behavior.\nPreserve Unicode: café.";
        store.patch(serde_json::json!({"rsCustomPrompt":text})).unwrap();
        let reopened = PreferencesStore::load_from(path.clone());
        assert_eq!(reopened.snapshot().custom_prompt.as_deref(), Some(text));
        reopened.patch(serde_json::json!({"rsCustomPrompt":""})).unwrap();
        let cleared = PreferencesStore::load_from(path.clone());
        assert_eq!(serde_json::to_value(cleared.snapshot()).unwrap()["rsCustomPrompt"], "");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_saved_choices_are_normalized() {
        let path = temp_settings_path();
        std::fs::write(&path, r#"{
            "rs-engine":"bad",
            "rsWorkMode":"bad",
            "rsPermMode":"bad",
            "rsThinkingLevel":"bad"
        }"#).expect("write invalid preferences");

        let reopened = PreferencesStore::load_from(path.clone()).snapshot();
        assert_eq!(reopened.engine, "roblox");
        assert_eq!(reopened.work_mode, "balanced");
        assert_eq!(reopened.perm_mode, "sandbox");
        assert_eq!(reopened.thinking_level, "default");

        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn elio_color_mode_persists_and_rejects_unknown() {
        let root=temp_settings_path();
        let store=PreferencesStore::load_from(root.clone());
        assert_eq!(store.snapshot().color_mode,"dark");
        store.patch(serde_json::json!({"rsColorMode":"dark"})).unwrap();
        assert_eq!(store.snapshot().color_mode,"dark");
        drop(store);
        let reopened=PreferencesStore::load_from(root.clone());
        assert_eq!(reopened.snapshot().color_mode,"dark");
        reopened.patch(serde_json::json!({"rsColorMode":"light"})).unwrap();
        assert_eq!(PreferencesStore::load_from(root.clone()).snapshot().color_mode,"light");
        reopened.patch(serde_json::json!({"rsColorMode":"invalid"})).unwrap();
        assert_eq!(reopened.snapshot().color_mode,"dark");
        let _=std::fs::remove_file(root);
    }

}

#[cfg(test)] mod audit_persistence_tests {
    use super::*;
    #[test] fn failed_settings_save_does_not_publish_unsaved_preferences() {
        let root=std::env::temp_dir().join(format!("elio-audit-preferences-fail-{}",std::process::id()));std::fs::create_dir_all(root.join("settings.json")).unwrap();
        let store=PreferencesStore::load_from(root.join("settings.json"));let before=serde_json::to_value(store.snapshot()).unwrap();
        assert!(store.patch(serde_json::json!({"rsLanguage":"ru"})).is_err());assert_eq!(serde_json::to_value(store.snapshot()).unwrap(),before);assert!(root.join("settings.json").is_dir());std::fs::remove_dir_all(root).unwrap();
    }
    #[test] fn concurrent_updates_do_not_lose_changes() {
        let root=std::env::temp_dir().join(format!("elio-audit-preferences-concurrent-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();let path=root.join("settings.json");
        let store=std::sync::Arc::new(PreferencesStore::load_from(path.clone()));store.update(|p|p.custom_prompt=Some(String::new())).unwrap();
        let mut workers=Vec::new();for _ in 0..16{let store=store.clone();workers.push(std::thread::spawn(move||store.update(|p|p.custom_prompt.as_mut().unwrap().push('x')).unwrap()));}for worker in workers{worker.join().unwrap();}
        assert_eq!(store.snapshot().custom_prompt.as_deref(),Some("xxxxxxxxxxxxxxxx"));assert_eq!(PreferencesStore::load_from(path).snapshot().custom_prompt,store.snapshot().custom_prompt);std::fs::remove_dir_all(root).unwrap();
    }
}
