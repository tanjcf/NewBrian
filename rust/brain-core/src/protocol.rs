use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "1";
pub const MAX_TIMEOUT_MS: u64 = 600_000;
pub const MAX_OUTPUT_BYTES: u64 = 16_777_216;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceLimits {
    pub timeout_ms: u64,
    pub max_output_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol_version: String,
    pub request_id: String,
    pub project_id: String,
    pub workspace_type: String,
    pub operation: String,
    pub approval_token: String,
    pub resource_limits: ResourceLimits,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
pub struct Artifact {
    pub id: Option<String>,
    pub path: Option<String>,
    pub media_type: Option<String>,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub status: &'static str,
    pub error_code: String,
    pub artifacts: Vec<Artifact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}

impl Response {
    pub fn completed(request_id: String, result: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            status: "completed",
            error_code: String::new(),
            artifacts: Vec::new(),
            result: Some(result),
        }
    }

    pub fn failed(request_id: String, error_code: &str) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            status: "failed",
            error_code: error_code.to_owned(),
            artifacts: Vec::new(),
            result: None,
        }
    }
}

fn contains_credential_key(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(contains_credential_key),
        Value::Object(entries) => entries.iter().any(|(key, item)| {
            let normalized = key.to_ascii_lowercase().replace('-', "_");
            [
                "api_key", "authorization", "bearer", "credential", "password",
                "private_key", "secret", "access_token", "refresh_token",
            ]
            .iter()
            .any(|forbidden| normalized.contains(forbidden))
                || contains_credential_key(item)
        }),
        _ => false,
    }
}

pub fn validate_request(request: &Request) -> Result<(), &'static str> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("BRAIN_CORE_PROTOCOL_VERSION");
    }
    if request.request_id.trim().is_empty()
        || request.project_id.trim().is_empty()
        || request.workspace_type.trim().is_empty()
        || request.operation.trim().is_empty()
    {
        return Err("BRAIN_CORE_REQUIRED_FIELD");
    }
    if request.resource_limits.timeout_ms == 0
        || request.resource_limits.timeout_ms > MAX_TIMEOUT_MS
        || request.resource_limits.max_output_bytes == 0
        || request.resource_limits.max_output_bytes > MAX_OUTPUT_BYTES
    {
        return Err("BRAIN_CORE_RESOURCE_LIMIT");
    }
    if contains_credential_key(&request.payload) {
        return Err("BRAIN_CORE_CREDENTIAL_FORBIDDEN");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> Request {
        serde_json::from_value(json!({
            "protocol_version": "1",
            "request_id": "req-1",
            "project_id": "project-1",
            "workspace_type": "software",
            "operation": "health.check",
            "approval_token": "",
            "resource_limits": { "timeout_ms": 1000, "max_output_bytes": 1024 },
            "payload": {}
        }))
        .expect("valid fixture")
    }

    #[test]
    fn accepts_a_bounded_request() {
        assert_eq!(validate_request(&request()), Ok(()));
    }

    #[test]
    fn rejects_credentials_in_payload() {
        let mut value = request();
        value.payload = json!({ "authorization": "Bearer secret" });
        assert_eq!(validate_request(&value), Err("BRAIN_CORE_CREDENTIAL_FORBIDDEN"));
    }
}
