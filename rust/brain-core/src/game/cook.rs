use super::spec::{build_animation_spec, build_input_mapping_spec};
use super::util::{write_text_atomic};
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::path::Path;

fn section_relative_path(section_key: &str) -> Option<&'static str> {
    match section_key {
        "design" => Some("Docs/BRAIN/design.md"),
        "world" => Some("Docs/BRAIN/world.json"),
        "level" => Some("Docs/BRAIN/level.json"),
        "combat" => Some("Docs/BRAIN/combat.json"),
        _ => None,
    }
}

fn normalize_section_body(section_key: &str, content: &str) -> String {
    let trimmed = content.trim();
    if section_key == "design" {
        if trimmed.is_empty() {
            return "# 游戏策划\n\n在 BRAIN 编辑后 Cook。\n".to_owned();
        }
        return format!("{trimmed}\n");
    }
    if trimmed.is_empty() {
        return "{}\n".to_owned();
    }
    format!("{trimmed}\n")
}

pub fn cook_design_sections(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let sections = payload
        .get("sections")
        .and_then(Value::as_array)
        .ok_or("BRAIN_GAME_SECTIONS_REQUIRED")?;
    let mut exported_files: Vec<String> = Vec::new();
    let mut manifest_sections = json!({});
    let mut combat_content = String::new();
    let mut file_records = Vec::new();

    for entry in sections {
        let section_key = entry
            .get("section_key")
            .and_then(Value::as_str)
            .ok_or("BRAIN_GAME_SECTION_KEY_REQUIRED")?;
        let content = entry
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        let revision = entry
            .get("revision")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let Some(relative) = section_relative_path(section_key) else {
            continue;
        };
        let body = normalize_section_body(section_key, content);
        let (sha256, size_bytes) =
            write_text_atomic(boundary, Path::new(relative), &body, request_id)?;
        exported_files.push(relative.to_owned());
        manifest_sections[section_key] = json!({
            "path": relative,
            "revision": revision,
            "sha256": sha256
        });
        file_records.push(json!({ "path": relative, "sha256": sha256, "sizeBytes": size_bytes }));
        if section_key == "combat" {
            combat_content = content.to_owned();
        }
    }

    let input_mapping = build_input_mapping_spec(&combat_content);
    let input_json = format!("{}\n", serde_json::to_string_pretty(&input_mapping).unwrap_or_default());
    let (input_sha, input_size) =
        write_text_atomic(boundary, Path::new("Docs/BRAIN/input-mapping.json"), &input_json, request_id)?;
    exported_files.push("Docs/BRAIN/input-mapping.json".to_owned());
    file_records.push(json!({
        "path": "Docs/BRAIN/input-mapping.json",
        "sha256": input_sha,
        "sizeBytes": input_size
    }));

    let animation_spec = build_animation_spec(&combat_content);
    let anim_json = format!("{}\n", serde_json::to_string_pretty(&animation_spec).unwrap_or_default());
    let (anim_sha, anim_size) =
        write_text_atomic(boundary, Path::new("Docs/BRAIN/animation-spec.json"), &anim_json, request_id)?;
    exported_files.push("Docs/BRAIN/animation-spec.json".to_owned());
    file_records.push(json!({
        "path": "Docs/BRAIN/animation-spec.json",
        "sha256": anim_sha,
        "sizeBytes": anim_size
    }));

    let exported_at = chrono_lite_iso8601();
    let manifest = json!({
        "schemaVersion": 1,
        "pipeline": "brain-game-runtime-v1",
        "exportedAt": exported_at,
        "sections": manifest_sections,
        "files": file_records
    });
    let manifest_body = format!("{}\n", serde_json::to_string_pretty(&manifest).unwrap_or_default());
    write_text_atomic(boundary, Path::new(".brain-game/manifest.json"), &manifest_body, request_id)?;
    write_text_atomic(boundary, Path::new("Docs/BRAIN/manifest.json"), &manifest_body, request_id)?;
    exported_files.push(".brain-game/manifest.json".to_owned());
    exported_files.push("Docs/BRAIN/manifest.json".to_owned());

    Ok(json!({
        "pipeline": "brain-game-runtime-v1",
        "docsRoot": "Docs/BRAIN",
        "exportedFiles": exported_files,
        "manifestPath": ".brain-game/manifest.json"
    }))
}

fn chrono_lite_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", duration.as_secs())
}
