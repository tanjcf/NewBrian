use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn write_text_atomic(
    boundary: &ProjectBoundary,
    relative: &Path,
    content: &str,
    request_id: &str,
) -> Result<(String, u64), &'static str> {
    if let Some(parent) = relative.parent() {
        if !parent.as_os_str().is_empty() {
            let parent_path = boundary
                .writable(parent)
                .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
            fs::create_dir_all(parent_path).map_err(|_| "BRAIN_GAME_WRITE_FAILED")?;
        }
    }
    let path = boundary
        .writable(relative)
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("BRAIN_CORE_PATH_INVALID")?;
    let temporary = path.with_file_name(format!(".{file_name}.{request_id}.tmp"));
    let bytes = content.as_bytes();
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("BRAIN_GAME_WRITE_FAILED");
    }
    Ok((hash_bytes(bytes), bytes.len() as u64))
}

pub fn sanitize_project_name(name: &str) -> String {
    let ascii: String = name
        .trim()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '_' { ch } else { '_' })
        .collect();
    let trimmed = ascii.trim_matches('_');
    if !trimmed.is_empty()
        && trimmed
            .chars()
            .next()
            .map(|ch| ch.is_ascii_alphabetic() || ch == '_')
            .unwrap_or(false)
        && trimmed.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return trimmed.to_owned();
    }
    "BrainGame".to_owned()
}

pub fn pipeline_state_json() -> Value {
    json!({
        "schemaVersion": 1,
        "pipeline": "brain-game-runtime-v1",
        "engineTargets": ["web", "unreal"]
    })
}
