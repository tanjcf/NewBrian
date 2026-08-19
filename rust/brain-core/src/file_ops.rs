use crate::path_policy::ProjectBoundary;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn read_file(
    boundary: &ProjectBoundary,
    payload: &Value,
    max_output_bytes: u64,
) -> Result<Value, &'static str> {
    let relative = payload
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("BRAIN_CORE_PATH_REQUIRED")?;
    let path = boundary
        .existing(Path::new(relative))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let metadata = fs::metadata(&path).map_err(|_| "BRAIN_CORE_FILE_METADATA")?;
    if !metadata.is_file() {
        return Err("BRAIN_CORE_FILE_REQUIRED");
    }
    if metadata.len() > max_output_bytes {
        return Err("BRAIN_CORE_OUTPUT_LIMIT");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .and_then(|file| file.take(max_output_bytes + 1).read_to_end(&mut bytes))
        .map_err(|_| "BRAIN_CORE_FILE_READ")?;
    if bytes.len() as u64 > max_output_bytes {
        return Err("BRAIN_CORE_OUTPUT_LIMIT");
    }
    Ok(json!({
        "path": relative,
        "size_bytes": bytes.len(),
        "sha256": hash(&bytes),
        "data_base64": STANDARD.encode(&bytes)
    }))
}

pub fn write_file(
    boundary: &ProjectBoundary,
    payload: &Value,
    max_output_bytes: u64,
    request_id: &str,
) -> Result<Value, &'static str> {
    let relative = payload
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("BRAIN_CORE_PATH_REQUIRED")?;
    let encoded = payload
        .get("data_base64")
        .and_then(Value::as_str)
        .ok_or("BRAIN_CORE_FILE_DATA_REQUIRED")?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "BRAIN_CORE_FILE_DATA_INVALID")?;
    if bytes.len() as u64 > max_output_bytes {
        return Err("BRAIN_CORE_OUTPUT_LIMIT");
    }
    let path = boundary
        .writable(Path::new(relative))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("BRAIN_CORE_PATH_INVALID")?;
    let temporary = path.with_file_name(format!(".{file_name}.{request_id}.tmp"));
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("BRAIN_CORE_FILE_WRITE");
    }
    Ok(json!({
        "path": relative,
        "size_bytes": bytes.len(),
        "sha256": hash(&bytes)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "brain-core-file-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(path.join("nested")).expect("root");
        path
    }

    #[test]
    fn writes_and_reads_a_bounded_file() {
        let root = root();
        let boundary = ProjectBoundary::bind(&root).expect("bind");
        write_file(
            &boundary,
            &json!({ "path": "nested/report.txt", "data_base64": STANDARD.encode(b"report") }),
            1024,
            "req-1",
        )
        .expect("write");
        let output =
            read_file(&boundary, &json!({ "path": "nested/report.txt" }), 1024).expect("read");
        assert_eq!(output["data_base64"], STANDARD.encode(b"report"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_output_beyond_the_request_limit() {
        let root = root();
        fs::write(root.join("nested/large.bin"), b"large").expect("fixture");
        let boundary = ProjectBoundary::bind(&root).expect("bind");
        assert_eq!(
            read_file(&boundary, &json!({ "path": "nested/large.bin" }), 2),
            Err("BRAIN_CORE_OUTPUT_LIMIT")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
