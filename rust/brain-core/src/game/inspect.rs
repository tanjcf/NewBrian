use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

const IGNORED: &[&str] = &[
    ".git", ".idea", ".materialized", "node_modules", "dist", "build", "Library", "Temp", "Saved",
    "Intermediate", ".brain-game",
];

fn asset_kind(ext: &str) -> &'static str {
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "cs" | "gd" | "cpp" | "c" | "h" | "hpp" | "lua" | "py" => {
            "scripts"
        }
        "tscn" | "scn" | "unity" | "umap" | "scene" => "scenes",
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "tga" | "psd" => "images",
        "wav" | "mp3" | "ogg" | "flac" | "m4a" => "audio",
        "mp4" | "webm" | "mov" | "mkv" => "video",
        "fbx" | "obj" | "gltf" | "glb" | "blend" => "models",
        _ => "other",
    }
}

fn scene_ext(ext: &str) -> bool {
    matches!(ext, "tscn" | "scn" | "unity" | "umap" | "scene")
}

pub fn inspect_game_project(
    boundary: &ProjectBoundary,
    payload: &Value,
    _max_output_bytes: u64,
) -> Result<Value, &'static str> {
    let max_entries = payload
        .get("max_entries")
        .and_then(Value::as_u64)
        .unwrap_or(4_000)
        .clamp(1, 10_000) as usize;
    let root = boundary.root();
    let display_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project")
        .to_owned();

    let mut assets: HashMap<&str, u64> = HashMap::from([
        ("scripts", 0),
        ("scenes", 0),
        ("images", 0),
        ("audio", 0),
        ("video", 0),
        ("models", 0),
        ("other", 0),
    ]);
    let mut markers = HashSet::new();
    let mut queue: VecDeque<PathBuf> = VecDeque::from([root.to_path_buf()]);
    let mut scanned = 0usize;
    let mut truncated = false;
    let mut package_json = false;
    let mut godot = false;
    let mut uproject_path = String::new();
    let mut engine_association = String::new();

    while let Some(dir) = queue.pop_front() {
        if scanned >= max_entries {
            truncated = true;
            break;
        }
        let entries = fs::read_dir(&dir).map_err(|_| "BRAIN_GAME_INSPECT_FAILED")?;
        for entry in entries {
            if scanned >= max_entries {
                truncated = true;
                break;
            }
            scanned += 1;
            let entry = entry.map_err(|_| "BRAIN_GAME_INSPECT_FAILED")?;
            let path = entry.path();
            if path.is_symlink() {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if IGNORED.contains(&name.as_str()) {
                    continue;
                }
                queue.push_back(path);
                if relative == "ProjectSettings" {
                    markers.insert("ProjectSettings/".to_owned());
                }
                continue;
            }
            if !path.is_file() {
                continue;
            }
            if relative == "package.json" {
                markers.insert("package.json".to_owned());
                package_json = true;
            }
            if relative == "project.godot" {
                markers.insert("project.godot".to_owned());
                godot = true;
            }
            if relative.ends_with(".uproject") {
                markers.insert(relative.clone());
                uproject_path = relative.clone();
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(json) = serde_json::from_str::<Value>(&text) {
                        engine_association = json
                            .get("EngineAssociation")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned();
                    }
                }
            }
            let ext = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let kind = if scene_ext(&ext) {
                "scenes"
            } else {
                asset_kind(&ext)
            };
            *assets.get_mut(kind).unwrap_or(&mut 0) += 1;
        }
    }

    let engine = if markers.contains("ProjectSettings/") {
        "unity"
    } else if !uproject_path.is_empty() {
        "unreal"
    } else if godot {
        "godot"
    } else if package_json {
        "web"
    } else {
        "unknown"
    };

    let brain_manifest = root.join(".brain-game/manifest.json").is_file();

    Ok(json!({
        "schemaVersion": 1,
        "engine": engine,
        "displayName": display_name,
        "markers": markers.into_iter().collect::<Vec<_>>(),
        "assets": assets,
        "uprojectPath": uproject_path,
        "engineAssociation": engine_association,
        "brainManifestPresent": brain_manifest,
        "scannedEntries": scanned,
        "truncated": truncated,
        "pipeline": "brain-game-runtime-v1"
    }))
}
