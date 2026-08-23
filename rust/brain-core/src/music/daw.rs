use crate::game::util::write_text_atomic;
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const STATE_PATH: &str = ".brain-music/daw-editor.json";
const LYRICS_PATH: &str = "Docs/BRAIN/lyrics.md";
const STYLE_PATH: &str = "Docs/BRAIN/style.json";
const MANIFEST_PATH: &str = ".brain-music/manifest.json";

fn default_state() -> Value {
    json!({
        "schemaVersion": 1,
        "pipeline": "brain-music-runtime-v1",
        "title": "未命名歌曲",
        "lyrics": "",
        "style": { "genre": "cinematic", "mood": "hopeful", "bpm": 90 },
        "tracks": [
            { "id": "vocal", "name": "主唱", "clip": "", "start": 0, "width": 32, "muted": false },
            { "id": "music", "name": "配乐", "clip": "", "start": 0, "width": 32, "muted": false }
        ],
        "markers": [],
        "segments": [],
        "exportFormat": "wav"
    })
}

fn load_state(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    if !boundary.root().join(STATE_PATH).is_file() {
        return Ok(default_state());
    }
    let path = boundary
        .existing(Path::new(STATE_PATH))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let raw = fs::read_to_string(path).map_err(|_| "BRAIN_MUSIC_DAW_READ_FAILED")?;
    serde_json::from_str(&raw).map_err(|_| "BRAIN_MUSIC_DAW_INVALID")
}

fn validate_state(state: &Value) -> Result<(), &'static str> {
    if !state.is_object() {
        return Err("BRAIN_MUSIC_DAW_STATE_INVALID");
    }
    if state.get("title").and_then(Value::as_str).is_none() {
        return Err("BRAIN_MUSIC_TITLE_REQUIRED");
    }
    if state.get("lyrics").and_then(Value::as_str).is_none() {
        return Err("BRAIN_MUSIC_LYRICS_REQUIRED");
    }
    if state.get("tracks").and_then(Value::as_array).is_none() {
        return Err("BRAIN_MUSIC_TRACKS_REQUIRED");
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
        serde_json::to_string_pretty(state).map_err(|_| "BRAIN_MUSIC_DAW_INVALID")?
    );
    let (sha256, size_bytes) =
        write_text_atomic(boundary, Path::new(STATE_PATH), &body, request_id)?;
    Ok(json!({
        "pipeline": "brain-music-runtime-v1",
        "path": STATE_PATH,
        "sha256": sha256,
        "sizeBytes": size_bytes,
        "state": state
    }))
}

pub fn daw_get(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    Ok(json!({
        "pipeline": "brain-music-runtime-v1",
        "path": STATE_PATH,
        "persisted": boundary.root().join(STATE_PATH).is_file(),
        "state": load_state(boundary)?
    }))
}

pub fn daw_save(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let mut state = payload
        .get("state")
        .cloned()
        .ok_or("BRAIN_MUSIC_DAW_STATE_REQUIRED")?;
    validate_state(&state)?;
    if state.get("schemaVersion").is_none() {
        state["schemaVersion"] = json!(1);
    }
    if state.get("pipeline").is_none() {
        state["pipeline"] = json!("brain-music-runtime-v1");
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
        for key in ["title", "lyrics", "style", "tracks", "markers", "segments", "exportFormat"] {
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
        state["pipeline"] = json!("brain-music-runtime-v1");
    }
    validate_state(&state)?;
    let lyrics = state["lyrics"]
        .as_str()
        .ok_or("BRAIN_MUSIC_LYRICS_REQUIRED")?;
    write_text_atomic(
        boundary,
        Path::new(LYRICS_PATH),
        &format!("# {}\n\n{lyrics}\n", state["title"].as_str().unwrap_or("未命名歌曲")),
        request_id,
    )?;
    let style_body = format!(
        "{}\n",
        serde_json::to_string_pretty(state.get("style").unwrap_or(&Value::Null))
            .map_err(|_| "BRAIN_MUSIC_STYLE_INVALID")?
    );
    write_text_atomic(boundary, Path::new(STYLE_PATH), &style_body, request_id)?;
    let saved = persist_state(boundary, &state, request_id)?;
    let manifest = json!({
        "schemaVersion": 1,
        "pipeline": "brain-music-runtime-v1",
        "statePath": STATE_PATH,
        "files": [LYRICS_PATH, STYLE_PATH],
        "trackCount": state["tracks"].as_array().map_or(0, Vec::len),
        "exportFormat": state.get("exportFormat").cloned().unwrap_or(json!("wav"))
    });
    let manifest_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest).map_err(|_| "BRAIN_MUSIC_DAW_INVALID")?
    );
    write_text_atomic(
        boundary,
        Path::new(MANIFEST_PATH),
        &manifest_body,
        request_id,
    )?;
    Ok(json!({
        "pipeline": "brain-music-runtime-v1",
        "exportedFiles": [LYRICS_PATH, STYLE_PATH, STATE_PATH, MANIFEST_PATH],
        "manifestPath": MANIFEST_PATH,
        "saved": saved
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_state_without_tracks() {
        let state = json!({ "title": "Song", "lyrics": "Words" });
        assert_eq!(
            validate_state(&state).unwrap_err(),
            "BRAIN_MUSIC_TRACKS_REQUIRED"
        );
    }
}
