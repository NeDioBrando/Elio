//! 1.22.0: Settings -> Copy debug report.
//!
//! The browser extension forwards elio's own errors, warnings and info, the
//! AI site's own errors and failed API calls, and recent agent events
//! (`POST /api/debug/browser-log`). `GET /api/debug/report` combines them with
//! the desktop status and log into one Markdown report that can be pasted into
//! an AI chat. Everything is capped and redacted again here, whatever the
//! extension already removed.
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Instant;

const PROBLEM_CAP: usize = 400;
const INFO_CAP: usize = 150;
const TAB_CAP: usize = 8;
const POST_ENTRY_CAP: usize = 200;
const TEXT_CAP: usize = 800;
pub const BODY_LIMIT: usize = 512 * 1024;

struct Browser {
    version: String,
    user_agent: String,
    seen: Instant,
    dropped: u64,
    tabs: HashMap<String, Value>,
}

#[derive(Default)]
struct Store {
    problems: VecDeque<Value>,
    info: VecDeque<Value>,
    browsers: HashMap<String, Browser>,
}

static STORE: Lazy<Mutex<Store>> = Lazy::new(|| Mutex::new(Store::default()));

static REDACTIONS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    [
        (r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}", "$1 [hidden]"),
        (r"(?i)\b[a-f0-9]{40,}\b", "[hidden-key]"),
        (r"\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|AIza)[-_A-Za-z0-9]{10,}", "[hidden-token]"),
        (r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}", "[hidden-jwt]"),
        (r#"(?i)((?:api[-_]?key|token|secret|password|passwd|auth|cookie|session|pairing[-_]?key)["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}"#, "${1}[hidden]"),
        (r#"([?&#][^=\s&#]+=)[^&#\s"')]+"#, "${1}…"),
        (r#"([A-Za-z]:\\Users\\|/Users/|/home/)[^\\/\s"']+"#, "${1}<user>"),
        (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "<email>"),
    ]
    .into_iter()
    .map(|(pattern, replacement)| (Regex::new(pattern).expect("valid redaction pattern"), replacement))
    .collect()
});

/// Removes keys, tokens, cookies, query values, user names and e-mail addresses.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for (pattern, replacement) in REDACTIONS.iter() {
        out = pattern.replace_all(&out, *replacement).into_owned();
    }
    out
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max { return text.to_string(); }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

fn clean_str(value: &Value, max: usize) -> String { clip(&redact(value.as_str().unwrap_or("")), max) }

fn clean_entry(raw: &Value, browser: &str) -> Option<Value> {
    let text = clean_str(&raw["text"], TEXT_CAP);
    if text.trim().is_empty() { return None; }
    let level = match raw["level"].as_str() { Some("error") => "error", Some("warn") => "warn", _ => "info" };
    let source = if raw["source"].as_str() == Some("site") { "site" } else { "extension" };
    let mut entry = json!({
        "t": raw["t"].as_f64().unwrap_or(0.0) as i64,
        "source": source,
        "level": level,
        "kind": clip(raw["kind"].as_str().unwrap_or("console"), 20),
        "text": text,
        "tab": clean_str(&raw["tab"], 80),
        "browser": browser,
    });
    if let Some(list) = raw["where"].as_array() {
        let items: Vec<Value> = list.iter().take(4).map(|w| Value::String(clean_str(w, 120))).filter(|w| w.as_str() != Some("")).collect();
        if !items.is_empty() { entry["where"] = Value::Array(items); }
    }
    let file = clean_str(&raw["file"], 200);
    if !file.is_empty() { entry["file"] = Value::String(file); }
    if let Some(status) = raw["status"].as_u64().filter(|s| (100..1000).contains(s)) { entry["status"] = json!(status); }
    if let Some(repeats) = raw["repeats"].as_u64().filter(|r| *r > 1) { entry["repeats"] = json!(repeats.min(1_000_000)); }
    Some(entry)
}

fn clean_tab(raw: &Value) -> Option<(String, Value)> {
    let id = clip(raw["id"].as_str().unwrap_or(""), 24);
    if id.is_empty() { return None; }
    let diag: Vec<Value> = raw["diag"].as_array().map(|list| list.iter().rev().take(40).rev().map(|event| {
        let mut line = clip(&redact(&event["data"].to_string()), 240);
        if line == "null" { line.clear(); }
        json!({"t": event["t"].as_f64().unwrap_or(0.0) as i64, "event": clip(event["event"].as_str().unwrap_or(""), 60), "data": line})
    }).collect()).unwrap_or_default();
    Some((id, json!({"host": clean_str(&raw["host"], 80), "path": clean_str(&raw["path"], 80), "diag": diag})))
}

/// Accepts one batch from a browser. Returns the number of stored entries.
pub fn accept(body: &Value) -> Result<usize, String> {
    let browser_id = body["browser_id"].as_str().unwrap_or("");
    if browser_id.is_empty() || browser_id.len() > 64 { return Err("browser_id is required".into()); }
    let short: String = browser_id.chars().take(8).collect();
    let entries: Vec<Value> = body["entries"].as_array().map(|list| list.iter().take(POST_ENTRY_CAP).filter_map(|raw| clean_entry(raw, &short)).collect()).unwrap_or_default();
    let mut store = STORE.lock().unwrap_or_else(|error| error.into_inner());
    if store.browsers.len() >= 8 && !store.browsers.contains_key(browser_id) {
        if let Some(oldest) = store.browsers.iter().min_by_key(|(_, b)| b.seen).map(|(k, _)| k.clone()) { store.browsers.remove(&oldest); }
    }
    let browser = store.browsers.entry(browser_id.to_string()).or_insert_with(|| Browser { version: String::new(), user_agent: String::new(), seen: Instant::now(), dropped: 0, tabs: HashMap::new() });
    browser.version = clip(body["extension_version"].as_str().unwrap_or(""), 20);
    browser.user_agent = clip(&redact(body["user_agent"].as_str().unwrap_or("")), 200);
    browser.seen = Instant::now();
    browser.dropped = browser.dropped.saturating_add(body["dropped"].as_u64().unwrap_or(0));
    for (id, tab) in body["tabs"].as_array().map(|list| list.iter().take(TAB_CAP).filter_map(clean_tab).collect::<Vec<_>>()).unwrap_or_default() {
        browser.tabs.insert(id, tab);
    }
    while browser.tabs.len() > TAB_CAP {
        if let Some(key) = browser.tabs.keys().next().cloned() { browser.tabs.remove(&key); }
    }
    let stored = entries.len();
    for entry in entries {
        let (list, cap) = if entry["level"] == "info" { (&mut store.info, INFO_CAP) } else { (&mut store.problems, PROBLEM_CAP) };
        list.push_back(entry);
        while list.len() > cap { list.pop_front(); }
    }
    Ok(stored)
}

/// Desktop-side facts gathered by the HTTP handler.
pub struct Context {
    pub desktop_version: String,
    pub status: Value,
    pub desktop_log: Vec<String>,
}

struct Cause { title: String, evidence: String, place: String, next: &'static str }

fn time_of(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ms).single().map(|t| t.format("%H:%M:%S").to_string()).unwrap_or_else(|| "--:--:--".into())
}

fn first_where(entries: &[&Value]) -> String {
    entries.iter().find_map(|e| e["where"].as_array().and_then(|w| w.first()).and_then(|w| w.as_str()).map(str::to_string))
        .or_else(|| entries.iter().find_map(|e| e["file"].as_str().map(str::to_string)))
        .unwrap_or_default()
}

fn count(entries: &[&Value]) -> u64 { entries.iter().map(|e| e["repeats"].as_u64().unwrap_or(1)).sum() }

fn likely_causes(problems: &[Value], info: &[Value], diag: &[(String, String)], extension_versions: &[String], ctx: &Context, seen_secs: Option<u64>) -> Vec<Cause> {
    let mut causes = Vec::new();
    let pick = |f: &dyn Fn(&Value) -> bool| problems.iter().filter(|e| f(e)).collect::<Vec<_>>();
    let text = |e: &Value| e["text"].as_str().unwrap_or("").to_string();
    let bridge = pick(&|e| e["kind"] == "bridge");
    let timeouts: Vec<&Value> = bridge.iter().copied().filter(|e| text(e).contains("TimeoutError") || text(e).contains("timed out")).collect();
    let unreachable: Vec<&Value> = bridge.iter().copied().filter(|e| { let t = text(e); t.contains("Failed to fetch") || t.contains("NetworkError") || t.contains("pairing failed") }).collect();
    if !timeouts.is_empty() {
        causes.push(Cause { title: "elio bridge connected but did not answer".into(),
            evidence: format!("{} bridge request(s) timed out; last: {}", count(&timeouts), text(timeouts[timeouts.len() - 1])),
            place: "background.js › bridgeFetch; desktop bridge on 127.0.0.1:3000".into(),
            next: "The desktop app was busy or stuck. Check the desktop log section for what it was doing at that time, then restart elio if it stays stuck." });
    }
    if !unreachable.is_empty() {
        causes.push(Cause { title: "The extension could not reach the elio bridge".into(),
            evidence: format!("{} failed connection(s); last: {}", count(&unreachable), text(unreachable[unreachable.len() - 1])),
            place: "background.js › bridgeFetch / ensurePairing".into(),
            next: "Make sure the desktop app is running and that the browser allows the extension to access localhost (Edge/Brave: site access and local network access)." });
    }
    let invalidated = pick(&|e| text(e).contains("Extension context invalidated"));
    if !invalidated.is_empty() {
        causes.push(Cause { title: "The extension was reloaded while an AI tab was open".into(), evidence: format!("{} 'Extension context invalidated' message(s)", count(&invalidated)),
            place: first_where(&invalidated), next: "Refresh the AI tab after reloading or updating the extension." });
    }
    for (status, title, next) in [
        (429u64, "The AI site rate-limited requests (HTTP 429)", "Wait before sending more, or raise 'Seconds between commands' in Settings."),
        (401, "The AI site rejected the session (HTTP 401)", "Sign in to the AI site again in this browser."),
        (403, "The AI site refused a request (HTTP 403)", "Sign in again; a captcha, region block or account limit can also cause this."),
    ] {
        let hits = pick(&|e| e["source"] == "site" && e["status"].as_u64() == Some(status));
        if !hits.is_empty() { causes.push(Cause { title: title.into(), evidence: format!("{} response(s); last: {}", count(&hits), text(hits[hits.len() - 1])), place: "AI site (not elio)".into(), next }); }
    }
    let server = pick(&|e| e["source"] == "site" && e["status"].as_u64().map_or(false, |s| s >= 500));
    if !server.is_empty() {
        causes.push(Cause { title: "The AI service returned server errors (HTTP 5xx)".into(), evidence: format!("{} response(s); last: {}", count(&server), text(server[server.len() - 1])),
            place: "AI site (not elio)".into(), next: "The AI service had an outage or overload. Retry later; elio cannot fix this." });
    }
    let site_errors = pick(&|e| e["source"] == "site" && (e["kind"] == "error" || e["kind"] == "rejection"));
    if !site_errors.is_empty() {
        causes.push(Cause { title: "The AI site itself reported script errors (can be unrelated)".into(), evidence: format!("{} error(s); last: {}", count(&site_errors), clip(&text(site_errors[site_errors.len() - 1]), 200)),
            place: first_where(&site_errors), next: "If these line up with the failure, the site changed or broke. Refreshing the tab often helps; a site change may need a elio provider update." });
    }
    let mut seen_places: Vec<String> = Vec::new();
    for entry in problems.iter().filter(|e| e["source"] == "extension" && e["level"] == "error" && e["kind"] != "bridge") {
        let place = entry["where"].as_array().and_then(|w| w.first()).and_then(|w| w.as_str()).unwrap_or("elio extension").to_string();
        if seen_places.contains(&place) || seen_places.len() >= 3 { continue; }
        seen_places.push(place.clone());
        causes.push(Cause { title: format!("elio script error in {}", place), evidence: clip(&text(entry), 240), place,
            next: "This is a elio bug. The file and function above are where it was thrown; the stack is in the errors section." });
    }
    let stalls: Vec<&(String, String)> = diag.iter().filter(|(event, _)| event == "stall.detected").collect();
    if !stalls.is_empty() {
        causes.push(Cause { title: "The AI page froze (main thread blocked)".into(), evidence: format!("{} stall(s); last: {}", stalls.len(), stalls[stalls.len() - 1].1),
            place: "AI tab main thread (see the agent events before the stall)".into(), next: "A long synchronous task blocked the page. The agent events just before the stall show what was running." });
    }
    let loop_fail: Vec<&(String, String)> = diag.iter().filter(|(event, _)| matches!(event.as_str(), "send.failed" | "loop.dead" | "loop.error" | "loop.fail" | "start.aborted" | "bridge.lost")).collect();
    if !loop_fail.is_empty() {
        let last = loop_fail[loop_fail.len() - 1];
        causes.push(Cause { title: format!("The agent loop reported '{}'", last.0), evidence: format!("{} such event(s); last data: {}", loop_fail.len(), if last.1.is_empty() { "none" } else { &last.1 }),
            place: "core/main.js (agent loop)".into(), next: "See the recent agent events for the steps leading up to it." });
    }
    let desktop = &ctx.desktop_version;
    let mismatched: Vec<&String> = extension_versions.iter().filter(|v| !v.is_empty() && *v != desktop).collect();
    if !mismatched.is_empty() {
        causes.push(Cause { title: "Extension and desktop versions differ".into(), evidence: format!("desktop {}, extension {}", desktop, mismatched.iter().map(|v| v.as_str()).collect::<Vec<_>>().join(", ")),
            place: "browser extension".into(), next: "Reload the extension (chrome://extensions or about:debugging) and refresh the AI tab." });
    }
    match seen_secs {
        None => causes.push(Cause { title: "No browser extension has connected to this desktop app".into(), evidence: "no browser report received since the desktop app started".into(),
            place: "browser extension".into(), next: "Open an AI chat with the elio extension enabled; reload the extension if it was just updated." }),
        Some(secs) if secs > 60 => causes.push(Cause { title: "The browser extension stopped reporting".into(), evidence: format!("last report {} s ago", secs),
            place: "browser extension / background.js".into(), next: "Check that the browser is open and the extension is enabled; reload it if needed." }),
        _ => {}
    }
    if ctx.status["studio_running"] == true && ctx.status["mcp_alive"] == false {
        causes.push(Cause { title: "Roblox Studio is open but its MCP connection is off".into(), evidence: "studio_running = true, mcp_alive = false".into(),
            place: "Roblox Studio MCP".into(), next: "Enable the Studio MCP server in Studio, or close other AI tools holding the Studio MCP connection." });
    }
    let desktop_errors: Vec<&String> = ctx.desktop_log.iter().filter(|line| line.contains(" ERROR ")).collect();
    if !desktop_errors.is_empty() {
        causes.push(Cause { title: "The desktop app logged errors".into(), evidence: format!("{} error line(s); last: {}", desktop_errors.len(), clip(&redact(desktop_errors[desktop_errors.len() - 1]), 240)),
            place: "desktop app (agent/src)".into(), next: "See the desktop log section." });
    }
    let _ = info;
    causes
}

fn entry_line(entry: &Value) -> String {
    let mut line = format!("- `{}` **{}**", time_of(entry["t"].as_i64().unwrap_or(0)), entry["level"].as_str().unwrap_or("info"));
    let tab = entry["tab"].as_str().unwrap_or("");
    if !tab.is_empty() { line += &format!(" [{}]", tab); }
    if entry["kind"] != "console" { line += &format!(" ({})", entry["kind"].as_str().unwrap_or("")); }
    if let Some(place) = entry["where"].as_array().filter(|w| !w.is_empty()) {
        line += &format!(" `{}`", place.iter().filter_map(|w| w.as_str()).collect::<Vec<_>>().join(" ← "));
    } else if let Some(file) = entry["file"].as_str() { line += &format!(" `{}`", file); }
    let text = entry["text"].as_str().unwrap_or("").replace('\n', " ⏎ ");
    line += &format!(" — {}", text);
    if let Some(repeats) = entry["repeats"].as_u64() { line += &format!(" (×{})", repeats); }
    line
}

pub fn render(ctx: &Context) -> String {
    let store = STORE.lock().unwrap_or_else(|error| error.into_inner());
    let problems: Vec<Value> = store.problems.iter().cloned().collect();
    let info: Vec<Value> = store.info.iter().cloned().collect();
    let newest = store.browsers.values().max_by_key(|b| b.seen);
    let seen_secs = newest.map(|b| b.seen.elapsed().as_secs());
    let versions: Vec<String> = store.browsers.values().filter(|b| b.seen.elapsed().as_secs() < 600).map(|b| b.version.clone()).collect();
    let mut diag: Vec<(String, String)> = Vec::new();
    let mut tab_sections = String::new();
    for browser in store.browsers.values() {
        for tab in browser.tabs.values() {
            let events = tab["diag"].as_array().cloned().unwrap_or_default();
            if events.is_empty() { continue; }
            tab_sections += &format!("\n**{}{}**\n\n```text\n", tab["host"].as_str().unwrap_or(""), tab["path"].as_str().unwrap_or(""));
            for event in events.iter().rev().take(25).rev() {
                let name = event["event"].as_str().unwrap_or("").to_string();
                let data = event["data"].as_str().unwrap_or("").to_string();
                tab_sections += &format!("{} {} {}\n", time_of(event["t"].as_i64().unwrap_or(0)), name, data);
                diag.push((name, data));
            }
            tab_sections += "```\n";
        }
    }
    let causes = likely_causes(&problems, &info, &diag, &versions, ctx, seen_secs);
    let mut out = String::new();
    out += "# elio debug report\n\n";
    out += &format!("Generated {} · elio desktop {} · {} {}\n\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S %:z"), ctx.desktop_version, std::env::consts::OS, std::env::consts::ARCH);
    out += "Paste this into an AI chat and ask it to find the cause. Keys, tokens, cookies, query values, user names, e-mail addresses and chat text were removed. \"Where\" shows `file › function` for elio code; AI-site entries come from the site itself.\n\n";
    out += "## Likely causes\n\n";
    if causes.is_empty() {
        out += "No known problem pattern matched. Check the errors below.\n";
    } else {
        for (index, cause) in causes.iter().enumerate() {
            out += &format!("{}. **{}**\n   - Evidence: {}\n", index + 1, cause.title, redact(&cause.evidence));
            if !cause.place.is_empty() { out += &format!("   - Where: {}\n", redact(&cause.place)); }
            out += &format!("   - Next step: {}\n", cause.next);
        }
    }
    out += "\n## Status\n\n";
    out += &format!("- Desktop app {}; extension {}\n", ctx.desktop_version, if versions.is_empty() { "not reporting".to_string() } else { versions.join(", ") });
    if let Some(browser) = newest { out += &format!("- Browser: {} (last report {} s ago)\n", browser.user_agent, browser.seen.elapsed().as_secs()); }
    for (key, label) in [("bridge_connected", "Extension connected to bridge"), ("studio_running", "Roblox Studio running"), ("mcp_alive", "Studio MCP connected"), ("roblox_connected", "Studio editor connected"), ("blender_connected", "Blender connected"), ("workspace_ready", "AgentScript workspace ready"), ("mcp_busy", "Studio command running")] {
        if let Some(value) = ctx.status.get(key).filter(|v| !v.is_null()) { out += &format!("- {}: {}\n", label, if value == true { "yes" } else if value == false { "no" } else { "?" }); }
    }
    let dropped: u64 = store.browsers.values().map(|b| b.dropped).sum();
    if dropped > 0 { out += &format!("- {} older entries were dropped to stay within the size limit\n", dropped); }
    let extension_problems: Vec<&Value> = problems.iter().filter(|e| e["source"] == "extension").collect();
    let site_problems: Vec<&Value> = problems.iter().filter(|e| e["source"] == "site").collect();
    out += &format!("\n## elio errors and warnings ({}, newest last)\n\n", extension_problems.len());
    if extension_problems.is_empty() { out += "None recorded.\n"; }
    for entry in extension_problems.iter().rev().take(80).rev() { out += &entry_line(entry); out.push('\n'); }
    out += &format!("\n## AI site errors and failed requests ({}, newest last)\n\n", site_problems.len());
    if site_problems.is_empty() { out += "None recorded.\n"; }
    for entry in site_problems.iter().rev().take(60).rev() { out += &entry_line(entry); out.push('\n'); }
    out += "\n## elio info (latest 40)\n\n";
    if info.is_empty() { out += "None recorded.\n"; }
    for entry in info.iter().rev().take(40).rev() { out += &entry_line(entry); out.push('\n'); }
    out += "\n## Recent agent events (latest 25 per AI tab)\n";
    out += if tab_sections.is_empty() { "\nNone recorded.\n" } else { &tab_sections };
    let important: Vec<&String> = ctx.desktop_log.iter().filter(|l| l.contains(" WARN ") || l.contains(" ERROR ")).collect();
    out += "\n## Desktop log\n\nWarnings and errors (latest 60):\n\n```text\n";
    for line in important.iter().rev().take(60).rev() { out += &clip(&redact(line), 400); out.push('\n'); }
    out += "```\n\nLatest 30 lines:\n\n```text\n";
    for line in ctx.desktop_log.iter().rev().take(30).rev() { out += &clip(&redact(line), 400); out.push('\n'); }
    out += "```\n";
    out.replace("```text\n```", "```text\n(none)\n```")
}

#[cfg(test)]
pub fn reset_for_tests() { *STORE.lock().unwrap_or_else(|e| e.into_inner()) = Store::default(); }

#[cfg(test)]
mod tests {
    use super::*;
    static SERIAL: Mutex<()> = Mutex::new(());
    fn ctx() -> Context { Context { desktop_version: "1.22.0".into(), status: json!({"studio_running": true, "mcp_alive": false, "bridge_connected": true}), desktop_log: vec!["2026-10-07T03:00:00Z  WARN elio: slow probe".into(), "2026-10-07T03:00:01Z ERROR elio: Studio MCP call failed".into()] } }

    #[test]
    fn redaction_removes_secrets_and_personal_data() {
        let key = "a".repeat(64);
        let raw = format!("Authorization: Bearer abcdefghijklmnop key {key} sk-ABCDEFGHIJKLMNOP token=supersecret C:\\Users\\Alice\\x /Users/bob/y me@example.com https://x.test/a?session=123&b=2 eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl");
        let out = redact(&raw);
        for secret in [key.as_str(), "abcdefghijklmnop", "sk-ABCDEFGHIJKLMNOP", "supersecret", "Alice", "bob", "me@example.com", "123", "eyJzdWIiOiIx"] { assert!(!out.contains(secret), "{secret} leaked: {out}"); }
        assert!(out.contains("Bearer [hidden]") && out.contains("<user>") && out.contains("<email>"));
    }

    #[test]
    fn report_flags_causes_with_files_and_caps_input() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        let mut entries = vec![
            json!({"t": 1, "source": "extension", "level": "warn", "kind": "bridge", "text": "Bridge request /api/status failed: TimeoutError: signal timed out", "where": ["background.js › bridgeFetch"], "repeats": 3}),
            json!({"t": 2, "source": "extension", "level": "error", "kind": "uncaught", "text": "TypeError: x is undefined", "where": ["core/main.js › sendPrompt"], "tab": "chatgpt.com"}),
            json!({"t": 3, "source": "site", "level": "error", "kind": "http", "status": 429, "text": "HTTP 429 https://chatgpt.com/backend-api/conversation", "tab": "chatgpt.com"}),
            json!({"t": 4, "source": "site", "level": "error", "kind": "error", "text": "Script error", "file": "https://cdn.test/app.js:1:2"}),
            json!({"t": 5, "source": "extension", "level": "info", "text": "[elio] started token=abcd1234"}),
        ];
        for i in 0..500 { entries.push(json!({"t": 10 + i, "source": "extension", "level": "warn", "text": format!("filler {i}")})); }
        let body = json!({"browser_id": "browser-1", "extension_version": "1.21.1", "user_agent": "Chrome/140", "entries": entries,
            "tabs": [{"id": "7", "host": "chatgpt.com", "path": "/c/x", "diag": [{"t": 9, "event": "stall.detected", "data": {"ms": 4000}}]}]});
        assert_eq!(accept(&body).unwrap(), POST_ENTRY_CAP);
        let report = render(&ctx());
        for needle in ["bridge connected but did not answer", "background.js › bridgeFetch", "elio script error in core/main.js › sendPrompt", "rate-limited requests (HTTP 429)", "AI site itself reported script errors",
                       "AI page froze", "Extension and desktop versions differ", "MCP connection is off", "desktop app logged errors", "3 bridge request(s) timed out", "stall.detected"] {
            assert!(report.contains(needle), "missing {needle}\n{report}");
        }
        assert!(!report.contains("abcd1234"));
        for _ in 0..10 { accept(&body).unwrap(); }
        let store = STORE.lock().unwrap();
        assert!(store.problems.len() <= PROBLEM_CAP && store.info.len() <= INFO_CAP);
        drop(store);
        assert!(render(&ctx()).len() < 200_000, "report stays pasteable");
        assert!(accept(&json!({"entries": []})).is_err());
    }

    #[test]
    fn empty_report_says_extension_not_connected() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_for_tests();
        let report = render(&Context { desktop_version: "1.22.0".into(), status: json!({}), desktop_log: vec![] });
        assert!(report.contains("No browser extension has connected") && report.contains("None recorded.") && report.contains("(none)"));
    }
}
