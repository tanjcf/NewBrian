use crate::game::util::write_text_atomic;
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const STATE_PATH: &str = ".brain-video/pipeline-editor.json";
const COOKED_PIPELINE_PATH: &str = ".brain-video/pipeline.json";
const SCRIPT_PATH: &str = "Docs/BRAIN/script.md";
const STORYBOARD_PATH: &str = "Docs/BRAIN/storyboard.json";
const MANIFEST_PATH: &str = ".brain-video/manifest.json";

fn default_state() -> Value {
    json!({
        "schemaVersion": 1,
        "pipeline": "brain-video-runtime-v1",
        "script": "一段等待创作的故事。",
        "shots": [
            { "title": "镜头 1", "line": "建立场景", "prompt": "电影感远景，建立环境与人物关系", "clip": "", "ready": false, "transition": "cut" },
            { "title": "镜头 2", "line": "推进叙事", "prompt": "中景，人物行动推动情节", "clip": "", "ready": false, "transition": "dissolve" },
            { "title": "镜头 3", "line": "收束段落", "prompt": "特写，情绪落点与余韵", "clip": "", "ready": false, "transition": "fade" }
        ],
        "exportFormat": "mp4"
    })
}

fn load_state(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    if !boundary.root().join(STATE_PATH).is_file() {
        return Ok(default_state());
    }
    let path = boundary
        .existing(Path::new(STATE_PATH))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let raw = fs::read_to_string(path).map_err(|_| "BRAIN_VIDEO_PIPELINE_READ_FAILED")?;
    serde_json::from_str(&raw).map_err(|_| "BRAIN_VIDEO_PIPELINE_INVALID")
}

fn validate_state(state: &Value) -> Result<(), &'static str> {
    if !state.is_object() {
        return Err("BRAIN_VIDEO_PIPELINE_STATE_INVALID");
    }
    if state.get("script").and_then(Value::as_str).is_none() {
        return Err("BRAIN_VIDEO_SCRIPT_REQUIRED");
    }
    if state.get("shots").and_then(Value::as_array).is_none() {
        return Err("BRAIN_VIDEO_SHOTS_REQUIRED");
    }
    Ok(())
}

fn persist_state(
    boundary: &ProjectBoundary,
    state: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    validate_state(state)?;
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(state).map_err(|_| "BRAIN_VIDEO_PIPELINE_INVALID")?
    );
    let (sha256, size_bytes) =
        write_text_atomic(boundary, Path::new(STATE_PATH), &body, request_id)?;
    let storyboard = json!({
        "schemaVersion": 1,
        "pipeline": "brain-video-runtime-v1",
        "source": STATE_PATH,
        "shots": state["shots"],
        "exportFormat": state.get("exportFormat").cloned().unwrap_or(json!("mp4"))
    });
    let storyboard_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&storyboard).map_err(|_| "BRAIN_VIDEO_PIPELINE_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(STORYBOARD_PATH),
        &storyboard_body,
        request_id,
    )?;
    Ok(json!({
        "pipeline": "brain-video-runtime-v1",
        "path": STATE_PATH,
        "storyboardPath": STORYBOARD_PATH,
        "sha256": sha256,
        "sizeBytes": size_bytes,
        "state": state
    }))
}

pub fn pipeline_get(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    let state = load_state(boundary)?;
    let path = boundary.root().join(STATE_PATH);
    Ok(json!({
        "pipeline": "brain-video-runtime-v1",
        "path": STATE_PATH,
        "persisted": path.is_file(),
        "state": state
    }))
}

pub fn pipeline_save(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let mut state = payload
        .get("state")
        .cloned()
        .ok_or("BRAIN_VIDEO_PIPELINE_STATE_REQUIRED")?;
    validate_state(&state)?;
    if state.get("schemaVersion").is_none() {
        state["schemaVersion"] = json!(1);
    }
    if state.get("pipeline").is_none() {
        state["pipeline"] = json!("brain-video-runtime-v1");
    }
    persist_state(boundary, &state, request_id)
}

pub fn mark_shot(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let shot_index = payload
        .get("shot_index")
        .and_then(Value::as_u64)
        .ok_or("BRAIN_VIDEO_SHOT_INDEX_REQUIRED")? as usize;
    let ready = payload
        .get("ready")
        .and_then(Value::as_bool)
        .ok_or("BRAIN_VIDEO_SHOT_READY_REQUIRED")?;
    let mut state = load_state(boundary)?;
    let shots = state
        .get_mut("shots")
        .and_then(Value::as_array_mut)
        .ok_or("BRAIN_VIDEO_SHOTS_REQUIRED")?;
    let shot = shots
        .get_mut(shot_index)
        .ok_or("BRAIN_VIDEO_SHOT_INDEX_INVALID")?;
    if !shot.is_object() {
        return Err("BRAIN_VIDEO_SHOT_INVALID");
    }
    shot["ready"] = json!(ready);
    persist_state(boundary, &state, request_id)
}

pub fn cook(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let mut state = load_state(boundary)?;
    if let Some(script) = payload.get("script") {
        if !script.is_string() {
            return Err("BRAIN_VIDEO_SCRIPT_INVALID");
        }
        state["script"] = script.clone();
    }
    if let Some(shots) = payload.get("shots") {
        if !shots.is_array() {
            return Err("BRAIN_VIDEO_SHOTS_REQUIRED");
        }
        state["shots"] = shots.clone();
    }
    validate_state(&state)?;
    let script = state["script"]
        .as_str()
        .ok_or("BRAIN_VIDEO_SCRIPT_REQUIRED")?;
    write_text_atomic(
        boundary,
        Path::new(SCRIPT_PATH),
        &format!("{script}\n"),
        request_id,
    )?;
    let saved = persist_state(boundary, &state, request_id)?;
    let pipeline_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&state).map_err(|_| "BRAIN_VIDEO_PIPELINE_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(COOKED_PIPELINE_PATH),
        &pipeline_body,
        request_id,
    )?;
    let manifest = json!({
        "schemaVersion": 1,
        "pipeline": "brain-video-runtime-v1",
        "statePath": COOKED_PIPELINE_PATH,
        "editorStatePath": STATE_PATH,
        "files": [SCRIPT_PATH, STORYBOARD_PATH, COOKED_PIPELINE_PATH],
        "shotCount": state["shots"].as_array().map_or(0, Vec::len),
        "exportFormat": state.get("exportFormat").cloned().unwrap_or(json!("mp4"))
    });
    let manifest_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest).map_err(|_| "BRAIN_VIDEO_PIPELINE_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(MANIFEST_PATH),
        &manifest_body,
        request_id,
    )?;
    Ok(json!({
        "pipeline": "brain-video-runtime-v1",
        "exportedFiles": [SCRIPT_PATH, STORYBOARD_PATH, COOKED_PIPELINE_PATH, STATE_PATH, MANIFEST_PATH],
        "manifestPath": MANIFEST_PATH,
        "saved": saved
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_pipeline_has_three_shots() {
        assert_eq!(default_state()["shots"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn rejects_state_without_shots() {
        assert_eq!(
            validate_state(&json!({ "script": "test" })).unwrap_err(),
            "BRAIN_VIDEO_SHOTS_REQUIRED"
        );
    }
}
