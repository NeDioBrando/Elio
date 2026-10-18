mod security;
#[cfg(test)]
mod integration {
    use axum::{Router, routing::post, body::Body, http::Request};
    use tower::ServiceExt;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    #[tokio::test]
    async fn unauthorized_calls_never_reach_command_handler() {
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let key = "a".repeat(64);
        let app = Router::new().route("/api/local-full", post(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            async { "ok" }
        })).layer(axum::middleware::from_fn_with_state(Arc::new(key.clone()), super::security::require_pairing));
        for (token, origin, expected) in [
            ("", "", 401), ("wrong", "", 401),
            (key.as_str(), "https://evil.example", 401),
            (key.as_str(), "null", 401),
            (key.as_str(), "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 200),
            (key.as_str(), "moz-extension://12345678-1234-1234-1234-123456789abc", 200),
            (key.as_str(), "moz-extension://not-a-uuid", 401),
            (key.as_str(), "moz-extension://12345678-1234-1234-1234-123456789abc/evil", 401),
        ] {
            let request = Request::builder().method("POST").uri("/api/local-full")
                .header("Authorization", format!("Bearer {token}"));
            let request = if origin.is_empty() { request } else { request.header("Origin", origin) };
            let response = app.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(response.status().as_u16(), expected);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    #[tokio::test]
    async fn auto_pair_rejects_webpages_and_accepts_extension_requests() {
        let app = Router::new().route("/api/pair", post(|| async { "unreachable" }))
            .layer(axum::middleware::from_fn_with_state(Arc::new("a".repeat(64)), super::security::require_pairing));
        for (id, origin, expected) in [
            ("", "", 403),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "https://example.com", 403),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "null", 403),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 403),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 200),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "", 200),
            ("12345678-1234-1234-1234-123456789abc", "moz-extension://12345678-1234-1234-1234-123456789abc", 200),
            ("12345678-1234-1234-1234-123456789abc", "", 200),
            ("12345678-1234-1234-1234-123456789abc", "moz-extension://12345678-1234-1234-1234-123456789abd", 403),
            ("12345678-1234-1234-1234-123456789abc", "https://example.com", 403),
            ("12345678-1234-1234-1234-123456789abc", "null", 403),
            ("12345678-1234-1234-1234-123456789abc", "chrome-extension://12345678-1234-1234-1234-123456789abc", 403),
            ("elio@elio.local", "", 403),
        ] {
            let request = Request::builder().method("POST").uri("/api/pair")
                .header("content-type", "application/json").header("x-elio-extension", id);
            let request = if origin.is_empty() { request } else { request.header("origin", origin) };
            let response = app.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(response.status().as_u16(), expected);
            if expected == 200 { assert_eq!(response.headers()["cache-control"], "no-store"); }
        }
        let get = Request::builder().uri("/api/pair").body(Body::empty()).unwrap();
        assert_ne!(app.oneshot(get).await.unwrap().status().as_u16(), 200);
    }

}
