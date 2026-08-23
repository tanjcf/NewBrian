use crate::game::util::write_text_atomic;
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const STATE_PATH: &str = ".brain-data/analysis-editor.json";
const ANALYSIS_PATH: &str = "Docs/BRAIN/analysis.json";
const MANIFEST_PATH: &str = ".brain-data/manifest.json";

fn default_state() -> Value {
    json!({
        "schemaVersion": 1,
        "pipeline": "brain-data-runtime-v1",
        "fileName": "",
        "rows": [],
        "insight": "",
        "regionRows": [
            { "region": "华东", "yoy": 0, "height": 40 },
            { "region": "华南", "yoy": 0, "height": 40 },
            { "region": "华北", "yoy": 0, "height": 40 }
        ],
        "analyzing": false
    })
}

fn load_state(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    if !boundary.root().join(STATE_PATH).is_file() {
        return Ok(default_state());
    }
    let path = boundary
        .existing(Path::new(STATE_PATH))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let raw = fs::read_to_string(path).map_err(|_| "BRAIN_DATA_ANALYSIS_READ_FAILED")?;
    serde_json::from_str(&raw).map_err(|_| "BRAIN_DATA_ANALYSIS_INVALID")
}

fn validate_state(state: &Value) -> Result<(), &'static str> {
    if !state.is_object() {
        return Err("BRAIN_DATA_ANALYSIS_STATE_INVALID");
    }
    if state.get("fileName").and_then(Value::as_str).is_none() {
        return Err("BRAIN_DATA_FILE_NAME_REQUIRED");
    }
    if state.get("rows").and_then(Value::as_array).is_none() {
        return Err("BRAIN_DATA_ROWS_REQUIRED");
    }
    if state.get("regionRows").and_then(Value::as_array).is_none() {
        return Err("BRAIN_DATA_REGION_ROWS_REQUIRED");
    }
    if state.get("analyzing").and_then(Value::as_bool).is_none() {
        return Err("BRAIN_DATA_ANALYZING_REQUIRED");
    }
    Ok(())
}

fn analysis_document(state: &Value) -> Value {
    json!({
        "schemaVersion": 1,
        "pipeline": "brain-data-runtime-v1",
        "source": STATE_PATH,
        "fileName": state.get("fileName").cloned().unwrap_or(json!("")),
        "rows": state.get("rows").cloned().unwrap_or(json!([])),
        "insight": state.get("insight").cloned().unwrap_or(json!("")),
        "regionRows": state.get("regionRows").cloned().unwrap_or(json!([]))
    })
}

fn persist_state(
    boundary: &ProjectBoundary,
    state: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    validate_state(state)?;
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(state).map_err(|_| "BRAIN_DATA_ANALYSIS_INVALID")?
    );
    let (sha256, size_bytes) =
        write_text_atomic(boundary, Path::new(STATE_PATH), &body, request_id)?;
    Ok(json!({
        "pipeline": "brain-data-runtime-v1",
        "path": STATE_PATH,
        "sha256": sha256,
        "sizeBytes": size_bytes,
        "state": state
    }))
}

pub fn analysis_get(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    Ok(json!({
        "pipeline": "brain-data-runtime-v1",
        "path": STATE_PATH,
        "persisted": boundary.root().join(STATE_PATH).is_file(),
        "state": load_state(boundary)?
    }))
}

pub fn analysis_save(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let mut state = payload
        .get("state")
        .cloned()
        .ok_or("BRAIN_DATA_ANALYSIS_STATE_REQUIRED")?;
    validate_state(&state)?;
    if state.get("schemaVersion").is_none() {
        state["schemaVersion"] = json!(1);
    }
    if state.get("pipeline").is_none() {
        state["pipeline"] = json!("brain-data-runtime-v1");
    }
    persist_state(boundary, &state, request_id)
}

pub fn cook(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let mut state = if let Some(value) = payload.get("state") {
        value.clone()
    } else {
        let mut current = load_state(boundary)?;
        for key in ["fileName", "rows", "insight", "regionRows", "analyzing"] {
            if let Some(value) = payload.get(key) {
                current[key] = value.clone();
            }
        }
        current
    };
    if state.get("schemaVersion").is_none() {
        state["schemaVersion"] = json!(1);
    }
    if state.get("pipeline").is_none() {
        state["pipeline"] = json!("brain-data-runtime-v1");
    }
    validate_state(&state)?;
    let saved = persist_state(boundary, &state, request_id)?;
    let document = analysis_document(&state);
    let document_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&document).map_err(|_| "BRAIN_DATA_ANALYSIS_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(ANALYSIS_PATH),
        &document_body,
        request_id,
    )?;
    let manifest = json!({
        "schemaVersion": 1,
        "pipeline": "brain-data-runtime-v1",
        "statePath": STATE_PATH,
        "files": [ANALYSIS_PATH],
        "rowCount": state["rows"].as_array().map_or(0, Vec::len),
        "regionCount": state["regionRows"].as_array().map_or(0, Vec::len)
    });
    let manifest_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest).map_err(|_| "BRAIN_DATA_ANALYSIS_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(MANIFEST_PATH),
        &manifest_body,
        request_id,
    )?;
    Ok(json!({
        "pipeline": "brain-data-runtime-v1",
        "exportedFiles": [ANALYSIS_PATH, STATE_PATH, MANIFEST_PATH],
        "manifestPath": MANIFEST_PATH,
        "saved": saved
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_state_without_rows() {
        let state = json!({
            "fileName": "sales.csv",
            "regionRows": [],
            "analyzing": false
        });
        assert_eq!(
            validate_state(&state).unwrap_err(),
            "BRAIN_DATA_ROWS_REQUIRED"
        );
    }
}
