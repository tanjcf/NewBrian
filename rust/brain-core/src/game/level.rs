//! Level Editor state — Content tree + Outliner actors (P2 Rust Tools).
//! Persistence: `.brain-game/level-editor.json` (Editor draft on disk).
//! Architecture: docs/architecture/brain-game-runtime-v1.md · brain-scene-prototype-alignment-v1.md

use super::util::write_text_atomic;
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const STATE_PATH: &str = ".brain-game/level-editor.json";
const LEVEL_DOC_PATH: &str = "Docs/BRAIN/level.json";

fn default_state() -> Value {
    // Empty until the editor saves real levels. Never invent trial maps/actors.
    json!({
      "schemaVersion": 1,
      "pipeline": "brain-game-runtime-v1",
      "selectedLevelIndex": 0,
      "levels": []
    })
}

fn resolve_under_root(boundary: &ProjectBoundary, relative: &str) -> Result<PathBuf, &'static str> {
    let rel = Path::new(relative);
    if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("BRAIN_CORE_PATH_ESCAPE");
    }
    Ok(boundary.root().join(rel))
}

fn load_state(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    let path = resolve_under_root(boundary, STATE_PATH)?;
    if !path.is_file() {
        return Ok(default_state());
    }
    let raw = fs::read_to_string(&path).map_err(|_| "BRAIN_GAME_LEVEL_READ_FAILED")?;
    serde_json::from_str(&raw).map_err(|_| "BRAIN_GAME_LEVEL_INVALID")
}

fn persist_state(
    boundary: &ProjectBoundary,
    state: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let body = format!(
        "{}\n",
        serde_json::to_string_pretty(state).map_err(|_| "BRAIN_GAME_LEVEL_INVALID")?
    );
    let (sha256, size_bytes) =
        write_text_atomic(boundary, Path::new(STATE_PATH), &body, request_id)?;

    // Mirror a summary into Docs/BRAIN/level.json for Cook visibility.
    let mirror = json!({
      "schemaVersion": 1,
      "source": STATE_PATH,
      "selectedLevelIndex": state.get("selectedLevelIndex").cloned().unwrap_or(json!(0)),
      "levels": state.get("levels").cloned().unwrap_or(json!([])),
      "sha256": sha256
    });
    let mirror_body = format!(
        "{}\n",
        serde_json::to_string_pretty(&mirror).unwrap_or_else(|_| "{}".to_owned())
    );
    let _ = write_text_atomic(boundary, Path::new(LEVEL_DOC_PATH), &mirror_body, request_id);

    Ok(json!({
      "pipeline": "brain-game-runtime-v1",
      "path": STATE_PATH,
      "levelDocPath": LEVEL_DOC_PATH,
      "sha256": sha256,
      "sizeBytes": size_bytes,
      "state": state
    }))
}

pub fn level_editor_get(boundary: &ProjectBoundary) -> Result<Value, &'static str> {
    let state = load_state(boundary)?;
    Ok(json!({
      "pipeline": "brain-game-runtime-v1",
      "path": STATE_PATH,
      "persisted": resolve_under_root(boundary, STATE_PATH)?.is_file(),
      "state": state
    }))
}

pub fn level_editor_save(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let state = payload
        .get("state")
        .cloned()
        .ok_or("BRAIN_GAME_LEVEL_STATE_REQUIRED")?;
    if state.get("levels").and_then(Value::as_array).is_none() {
        return Err("BRAIN_GAME_LEVELS_REQUIRED");
    }
    let mut next = state;
    if next.get("schemaVersion").is_none() {
        next["schemaVersion"] = json!(1);
    }
    if next.get("pipeline").is_none() {
        next["pipeline"] = json!("brain-game-runtime-v1");
    }
    persist_state(boundary, &next, request_id)
}

pub fn spawn_actor(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("BRAIN_GAME_ACTOR_KIND_REQUIRED")?;
    if !matches!(kind, "enemy" | "boss" | "npc") {
        return Err("BRAIN_GAME_ACTOR_KIND_UNSUPPORTED");
    }
    let level_index = payload
        .get("level_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;

    let mut state = load_state(boundary)?;
    let levels = state
        .get_mut("levels")
        .and_then(Value::as_array_mut)
        .ok_or("BRAIN_GAME_LEVELS_REQUIRED")?;
    if level_index >= levels.len() {
        return Err("BRAIN_GAME_LEVEL_INDEX_INVALID");
    }
    let level = levels
        .get_mut(level_index)
        .ok_or("BRAIN_GAME_LEVEL_INDEX_INVALID")?;
    let actors = level
        .get_mut("actors")
        .and_then(Value::as_array_mut)
        .ok_or("BRAIN_GAME_ACTORS_REQUIRED")?;

    let count = actors
        .iter()
        .filter(|actor| actor.get("kind").and_then(Value::as_str) == Some(kind))
        .count()
        + 1;
    let (name, type_label, beh) = match kind {
        "enemy" => (
            format!("Enemy_AI_{count}"),
            "AI 敌人",
            "巡逻 / 仇恨",
        ),
        "boss" => (format!("Boss_AI_{count}"), "AI Boss", "阶段战"),
        "npc" => (format!("NPC_AI_{count}"), "AI NPC", "对话图"),
        _ => unreachable!(),
    };
    let actor = json!({
      "id": format!("spawn-{kind}-{request_id}"),
      "name": name,
      "type": type_label,
      "loc": format!("{}, 0, {}", 80 + count * 20, 10 + count * 5),
      "ai": "待生成",
      "beh": beh,
      "kind": kind
    });
    actors.push(actor.clone());
    state["selectedLevelIndex"] = json!(level_index);

    let saved = persist_state(boundary, &state, request_id)?;
    Ok(json!({
      "actor": actor,
      "levelIndex": level_index,
      "saved": saved
    }))
}

fn walk_content(
    root: &Path,
    dir: &Path,
    max_entries: usize,
    out: &mut Vec<Value>,
) -> Result<(), &'static str> {
    if out.len() >= max_entries {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|_| "BRAIN_GAME_CONTENT_READ_FAILED")?;
    let mut items: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());
    for entry in items {
        if out.len() >= max_entries {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let is_dir = path.is_dir();
        out.push(json!({
          "path": rel,
          "name": if is_dir { format!("{name}/") } else { name },
          "kind": if is_dir { "folder" } else { "file" },
          "ext": path.extension().and_then(|v| v.to_str()).unwrap_or("")
        }));
        if is_dir {
            walk_content(root, &path, max_entries, out)?;
        }
    }
    Ok(())
}

pub fn content_tree(
    boundary: &ProjectBoundary,
    payload: &Value,
) -> Result<Value, &'static str> {
    let max_entries = payload
        .get("max_entries")
        .and_then(Value::as_u64)
        .unwrap_or(500)
        .clamp(1, 5_000) as usize;
    let content_root = resolve_under_root(boundary, "Content")?;
    if !content_root.is_dir() {
        // Honest empty: do not fabricate Content/ or empty .umap markers.
        return Ok(json!({
          "pipeline": "brain-game-runtime-v1",
          "root": "Content/",
          "exists": false,
          "entries": [],
          "truncated": false
        }));
    }
    let mut entries = Vec::new();
    entries.push(json!({
      "path": "Content",
      "name": "Content/",
      "kind": "folder",
      "ext": ""
    }));
    walk_content(&content_root, &content_root, max_entries, &mut entries)?;
    // Rewrite paths to include Content/ prefix for UI
    for entry in &mut entries {
        if let Some(path) = entry.get("path").and_then(Value::as_str) {
            if path != "Content" && !path.starts_with("Content/") {
                entry["path"] = json!(format!("Content/{path}"));
            }
        }
    }
    Ok(json!({
      "pipeline": "brain-game-runtime-v1",
      "root": "Content/",
      "exists": true,
      "entries": entries,
      "truncated": entries.len() >= max_entries
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn default_state_has_no_demo_levels() {
        let state = default_state();
        assert_eq!(state["levels"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn content_tree_does_not_fabricate_umaps_when_missing() {
        let dir = env::temp_dir().join(format!("brain-game-content-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let boundary = ProjectBoundary::bind(&dir).unwrap();
        let tree = content_tree(&boundary, &json!({})).unwrap();
        assert_eq!(tree["exists"], false);
        assert_eq!(tree["entries"].as_array().unwrap().len(), 0);
        assert!(!dir.join("Content").join("Levels").join("L_Trial_Phase1.umap").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn spawn_rejects_bad_kind() {
        let dir = env::temp_dir().join(format!("brain-game-level-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let boundary = ProjectBoundary::bind(&dir).unwrap();
        let err = spawn_actor(&boundary, &json!({ "kind": "prop" }), "req").unwrap_err();
        assert_eq!(err, "BRAIN_GAME_ACTOR_KIND_UNSUPPORTED");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn spawn_rejects_empty_levels() {
        let dir = env::temp_dir().join(format!("brain-game-spawn-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let boundary = ProjectBoundary::bind(&dir).unwrap();
        let err = spawn_actor(&boundary, &json!({ "kind": "enemy" }), "req").unwrap_err();
        assert_eq!(err, "BRAIN_GAME_LEVEL_INDEX_INVALID");
        let _ = fs::remove_dir_all(&dir);
    }
}
