use axum::response::IntoResponse;
use axum::http::HeaderMap;

pub fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

fn chromium_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|c| (b'a'..=b'p').contains(&c))
}

fn firefox_uuid(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i, c)| {
        if matches!(i, 8 | 13 | 18 | 23) { c == b'-' } else { c.is_ascii_hexdigit() }
    })
}

pub fn can_auto_pair(headers: &HeaderMap) -> bool {
    let Some(id) = headers.get("x-synerixcode-extension").and_then(|v| v.to_str().ok()) else { return false; };
    let scheme = if chromium_id(id) { "chrome-extension" }
        else if firefox_uuid(id) { "moz-extension" } else { return false; };
    if headers.get("content-type").and_then(|v| v.to_str().ok()) != Some("application/json") { return false; }
    match headers.get("origin") {
        Some(origin) => origin.to_str().ok().map(|v| v == format!("{scheme}://{id}")).unwrap_or(false),
        None => true,
    }
}

pub fn allowed_origin(headers: &HeaderMap) -> bool {
    match headers.get("origin") {
        None => true,
        Some(value) => {
            let Ok(origin) = value.to_str() else { return false; };
            if matches!(origin, "http://127.0.0.1:3000" | "http://localhost:3000" | "http://synerixcode.localhost") {
                return true;
            }
            origin.strip_prefix("chrome-extension://").map(chromium_id).unwrap_or(false)
                || origin.strip_prefix("moz-extension://").map(firefox_uuid).unwrap_or(false)
        }
    }
}

pub fn authorized(headers: &HeaderMap, key: &str) -> bool {
    if !valid_key(key) || !allowed_origin(headers) { return false; }
    let bearer = headers.get("authorization").and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let protocol = headers.get("sec-websocket-protocol").and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').find_map(|p| p.trim().strip_prefix("synerixcode-auth.")));
    bearer.or(protocol).map(|candidate| {
        candidate.len() == key.len() && candidate.bytes().zip(key.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
    }).unwrap_or(false)
}

pub fn load_key() -> anyhow::Result<String> {
    use std::io::Write;
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("XDG_CONFIG_HOME"))
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| std::path::PathBuf::from(p).join(".config")))
        .ok_or_else(|| anyhow::anyhow!("Cannot locate the user's pairing-key directory"))?;
    let dir = base.join("synerixcode");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let path = dir.join("bridge-key");
    if path.exists() {
        let key = std::fs::read_to_string(&path)?;
        anyhow::ensure!(valid_key(&key), "Invalid pairing key: {}", path.display());
        return Ok(key);
    }
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| anyhow::anyhow!("Cannot generate pairing key: {e}"))?;
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(&path)?.write_all(key.as_bytes())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_wrong_and_web_origin_credentials() {
        let key = "a".repeat(64);
        let mut h = HeaderMap::new();
        assert!(!authorized(&h, &key));
        h.insert("authorization", format!("Bearer {}", "b".repeat(64)).parse().unwrap());
        assert!(!authorized(&h, &key));
        h.insert("authorization", format!("Bearer {key}").parse().unwrap());
        assert!(authorized(&h, &key));
        h.insert("origin", "https://example.com".parse().unwrap());
        assert!(!authorized(&h, &key));
        h.insert("origin", format!("chrome-extension://{}", "a".repeat(32)).parse().unwrap());
        assert!(authorized(&h, &key));
        h.remove("authorization");
        h.insert("sec-websocket-protocol", format!("synerixcode, synerixcode-auth.{key}").parse().unwrap());
        assert!(authorized(&h, &key));
        h.insert("origin", "null".parse().unwrap());
        assert!(!authorized(&h, &key));
        h.insert("origin", "http://synerixcode.localhost".parse().unwrap());
        assert!(authorized(&h, &key));
    }
}

pub async fn require_pairing(
    axum::extract::State(key): axum::extract::State<std::sync::Arc<String>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    if request.uri().path() == "/api/pair" && request.method() == axum::http::Method::POST {
        if !can_auto_pair(request.headers()) {
            return (axum::http::StatusCode::FORBIDDEN, "Browser extension pairing required").into_response();
        }
        let mut response = axum::Json(serde_json::json!({ "key": key.as_str() })).into_response();
        response.headers_mut().insert("cache-control", "no-store".parse().unwrap());
        return response;
    }
    if !authorized(request.headers(), &key) {
        return (axum::http::StatusCode::UNAUTHORIZED, "Pair synerixcode using the key in the agent window").into_response();
    }
    next.run(request).await
}
