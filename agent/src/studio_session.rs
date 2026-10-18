use serde_json::Value;

pub fn needs_id(tools: &[Value], name: &str) -> bool {
    name != "list_roblox_studios" && tools.iter().any(|tool|
        tool["name"] == name && (tool["inputSchema"]["properties"].get("studio_id").is_some()
            || tool["inputSchema"]["required"].as_array().is_some_and(|keys| keys.iter().any(|key| key == "studio_id"))))
}

pub fn public_tools(tools: &[Value]) -> Vec<Value> {
    tools.iter().map(|tool| {
        let mut visible = tool.clone();
        if needs_id(tools, tool["name"].as_str().unwrap_or("")) {
            if let Some(required) = visible["inputSchema"]["required"].as_array_mut() { required.retain(|key| key != "studio_id"); }
            if let Some(property) = visible["inputSchema"]["properties"]["studio_id"].as_object_mut() {
                property.insert("description".into(), Value::String("Optional when one Studio is connected: elio supplies its ID. With multiple Studios, list_roblox_studios and select the intended ID.".into()));
            }
        }
        visible
    }).collect()
}

fn collect(value: &Value, ids: &mut Vec<Value>) {
    if let Some(items) = value.as_array() {
        for item in items { collect(item, ids); }
    } else if let Some(object) = value.as_object() {
        for key in ["studios", "instances", "roblox_studios", "connected_studios"] {
            if let Some(entries) = object.get(key) { collect(entries, ids); return; }
        }
        let id = ["studio_id", "studioId", "studio_instance_id", "studioInstanceId", "id"]
            .iter().find_map(|key| object.get(*key));
        if let Some(id) = id.filter(|id| id.is_number() || id.as_str().is_some_and(|text| !text.trim().is_empty())) {
            if !ids.contains(id) { ids.push(id.clone()); }
        }
    }
}

pub fn discover(result: &Value) -> anyhow::Result<Vec<Value>> {
    anyhow::ensure!(result["isError"] != true, "Studio discovery failed: {result}");
    let mut ids = Vec::new();
    if let Some(structured) = result.get("structuredContent") { collect(structured, &mut ids); }
    if let Some(content) = result["content"].as_array() {
        for block in content {
            if let Some(text) = block["text"].as_str() {
                let text = text.trim();
                let json = text.strip_prefix("```json").or_else(|| text.strip_prefix("```"))
                    .and_then(|value| value.trim().strip_suffix("```"));
                if let Ok(value) = serde_json::from_str::<Value>(json.unwrap_or(text).trim()) { collect(&value, &mut ids); }
            }
        }
    }
    if result.get("structuredContent").is_none() && result.get("content").is_none() { collect(result, &mut ids); }
    Ok(ids)
}

pub fn select(ids: &[Value], previous: Option<&Value>) -> anyhow::Result<Value> {
    if let Some(id) = previous {
        anyhow::ensure!(ids.contains(id), "The selected Studio disconnected. Run list_roblox_studios and choose a studio_id; the target was not switched automatically.");
        return Ok(id.clone());
    }
    match ids {
        [id] => Ok(id.clone()),
        [] => anyhow::bail!("No connected Roblox Studio instance was discovered. Enable Studio as MCP server in Studio's Assistant settings."),
        _ => anyhow::bail!("Multiple Studio instances are connected. Run list_roblox_studios and pass the intended studio_id; no instance was chosen automatically."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn discover_exact_ids_and_preserve_targets() {
        let result = json!({"content":[{"type":"text","text":"{\"studios\":[{\"name\":\"Game\",\"studio_id\":\"abc\",\"place_id\":123}]}"}]});
        let ids = discover(&result).unwrap();
        assert_eq!(select(&ids, None).unwrap(), json!("abc"));
        let ids = discover(&json!({"structuredContent":{"studios":[{"id":"one"},{"studio_id":"two"}]}})).unwrap();
        assert!(select(&ids, None).is_err());
        assert_eq!(select(&ids, Some(&json!("two"))).unwrap(), json!("two"));
        assert!(select(&ids, Some(&json!("stale"))).is_err());
        assert!(select(&[], None).is_err());
        assert!(discover(&json!({"isError":true})).is_err());
    }

    #[test]
    fn only_targeted_schemas_get_automatic_ids() {
        let tools = vec![json!({"name":"script_read","inputSchema":{"properties":{"studio_id":{"type":"string"}}}})];
        assert!(needs_id(&tools,"script_read"));
        assert!(!needs_id(&tools,"list_roblox_studios"));
        assert!(!needs_id(&tools,"old_tool"));
    }
}
