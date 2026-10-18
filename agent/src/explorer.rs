use axum::{extract::State, Json, response::{Response,IntoResponse}};
use serde_json::{json,Value};
fn quote(value:&str)->String {
    let mut delimiter=String::new();
    while value.contains(&format!("]{delimiter}]")) { delimiter.push('='); }
    format!("[{delimiter}[{value}]{delimiter}]")
}
fn code(request:&Value)->anyhow::Result<String> {
    anyhow::ensure!(matches!(request["action"].as_str(),Some("tree"|"read"|"write")),"Unknown Explorer action.");
    let id=request["id"].as_str().unwrap_or("");
    anyhow::ensure!(id=="root" || (!id.is_empty() && id.len()<20 && id.bytes().all(|b|b.is_ascii_digit())),"Invalid Explorer handle.");
    let offset=request["offset"].as_u64().unwrap_or(0);
    anyhow::ensure!(offset<=1000000,"Invalid tree offset.");
    if request["action"]=="write" && request["properties"].is_null() {
        for field in ["source","expected"] {anyhow::ensure!(request[field].as_str().is_some_and(|s|s.len()<=1000000),"Script source exceeds 1 MB or is missing.");}
    }
    if !request["properties"].is_null() {anyhow::ensure!(request["properties"].is_object()&&request["expected_properties"].is_object()&&serde_json::to_vec(request)?.len()<=30000,"Invalid or oversized object properties.");}
    anyhow::ensure!(request["session"].is_null() || request["session"].as_str().is_some_and(|s|s.len()<=100),"Invalid session.");
    Ok(include_str!("explorer.luau").replace("__REQUEST__", &quote(&serde_json::to_string(request)?)))
}
fn payload(text:&str)->anyhow::Result<Value> {
    if let Ok(value)=serde_json::from_str::<Value>(text) {
        fn visit(value:&Value)->Option<Value>{match value {
            Value::String(text)=>payload(text).ok(),
            Value::Array(values)=>values.iter().find_map(visit),
            Value::Object(values)=>values.values().find_map(visit),_=>None
        }}
        if let Some(value)=visit(&value){return Ok(value);}
    }
    let marker="ELIO_EXPLORER:";
    let start=text.find(marker).ok_or_else(||anyhow::anyhow!("Studio did not confirm Explorer result: {}",text.chars().take(1200).collect::<String>()))?+marker.len();
    serde_json::Deserializer::from_str(&text[start..]).into_iter::<Value>().next().ok_or_else(||anyhow::anyhow!("Empty Explorer result."))?.map_err(Into::into)
}
pub async fn post(State(state):State<crate::AppState>,Json(request):Json<Value>)->Response {
    let result:anyhow::Result<Value>=async {
        let script=code(&request)?;
        let mut arguments=json!({"code":script,"datamodel_type":"Edit"});
        if let Some(id)=request.get("studio_id").filter(|v| !v.is_null()) {arguments["studio_id"]=id.clone();}
        let response=crate::roblox_tool(&state,"execute_luau",arguments).await?;
        let value=payload(&response.text)?;
        anyhow::ensure!(value["ok"]==true,"Studio did not confirm Explorer operation.");
        Ok(value)
    }.await;
    match result {Ok(v)=>Json(v).into_response(),Err(e)=>(axum::http::StatusCode::BAD_REQUEST,Json(json!({"ok":false,"error":e.to_string()}))).into_response()}
}
#[cfg(test)]mod tests {use super::*;
 #[test]fn quoted_request_is_data(){let v=json!({"action":"write","id":"12","session":"s","source":"]];error('bad') --","expected":""});let s=code(&v).unwrap();assert!(s.contains("JSONDecode([=["));assert!(code(&json!({"action":"read","id":"1;error()"})).is_err());}
 #[test]fn nested_mcp_payload_is_decoded(){let text="ELIO_EXPLORER:{\"ok\":true,\"session\":\"test\"}";assert_eq!(payload(text).unwrap()["session"],"test");let wrapper=json!({"result":{"text":text}}).to_string();assert_eq!(payload(&wrapper).unwrap()["ok"],true);}
 #[test]fn guards_are_required(){let source=include_str!("explorer.luau");for guard in ["request.session ~= state.session","current ~= request.expected","Run:IsRunning()","UpdateSourceAsync","TryBeginRecording","IsDescendantOf(game)"]{assert!(source.contains(guard));}}
}
