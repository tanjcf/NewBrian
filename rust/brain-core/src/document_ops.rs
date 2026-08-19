use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct DocumentWorkerConfig {
    pub runtime: PathBuf,
    pub worker: PathBuf,
}

impl DocumentWorkerConfig {
    pub fn bind(runtime: PathBuf, worker: PathBuf) -> std::io::Result<Self> {
        let runtime = process_path(std::fs::canonicalize(runtime)?);
        let worker = process_path(std::fs::canonicalize(worker)?);
        if !runtime.is_file() || !worker.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "document worker runtime and entry must be files",
            ));
        }
        Ok(Self { runtime, worker })
    }
}

#[cfg(windows)]
fn process_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    value
        .strip_prefix(r"\\?\")
        .map(PathBuf::from)
        .unwrap_or(path)
}

#[cfg(not(windows))]
fn process_path(path: PathBuf) -> PathBuf {
    path
}

fn read_bounded<R: Read + Send + 'static>(reader: R, limit: u64) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let _ = reader.take(limit + 1).read_to_end(&mut output);
        output
    })
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0000_0200);
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: pre_exec invokes only the async-signal-safe setsid syscall.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child) {
    // SAFETY: the child starts in a new session whose process-group ID is its PID.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

pub fn ingest(
    boundary: &ProjectBoundary,
    config: &DocumentWorkerConfig,
    request_id: &str,
    payload: &Value,
    timeout_ms: u64,
    max_output_bytes: u64,
    cancelled: &AtomicBool,
) -> Result<Value, &'static str> {
    let entries = payload
        .as_object()
        .ok_or("BRAIN_CORE_DOCUMENT_PAYLOAD_INVALID")?;
    if entries
        .keys()
        .any(|key| !matches!(key.as_str(), "relative_path" | "max_bytes"))
    {
        return Err("BRAIN_CORE_DOCUMENT_FIELD_FORBIDDEN");
    }
    let relative_path = payload
        .get("relative_path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("BRAIN_CORE_DOCUMENT_PATH_REQUIRED")?;
    boundary
        .existing(std::path::Path::new(relative_path))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let max_bytes = payload
        .get("max_bytes")
        .and_then(Value::as_u64)
        .unwrap_or(5 * 1024 * 1024)
        .clamp(1, 20 * 1024 * 1024);

    let mut command = Command::new(&config.runtime);
    command
        .arg(&config.worker)
        .arg("--once")
        .current_dir(boundary.root())
        .env_clear()
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PATH",
        "Path",
        "SystemRoot",
        "WINDIR",
        "HOME",
        "USERPROFILE",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|_| "BRAIN_CORE_DOCUMENT_SPAWN")?;
    let frame = json!({
        "protocol_version": "2",
        "request_id": request_id,
        "project_root": boundary.root(),
        "relative_path": relative_path,
        "max_bytes": max_bytes
    });
    if let Some(mut stdin) = child.stdin.take() {
        serde_json::to_writer(&mut stdin, &frame).map_err(|_| "BRAIN_CORE_DOCUMENT_PIPE")?;
        stdin
            .write_all(b"\n")
            .map_err(|_| "BRAIN_CORE_DOCUMENT_PIPE")?;
    } else {
        return Err("BRAIN_CORE_DOCUMENT_PIPE");
    }
    let stdout = read_bounded(
        child.stdout.take().ok_or("BRAIN_CORE_DOCUMENT_PIPE")?,
        max_output_bytes,
    );
    let stderr = read_bounded(
        child.stderr.take().ok_or("BRAIN_CORE_DOCUMENT_PIPE")?,
        64 * 1024,
    );
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "BRAIN_CORE_DOCUMENT_WAIT")? {
            break status;
        }
        if cancelled.load(Ordering::Acquire) {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err("BRAIN_CORE_CANCELLED");
        }
        if Instant::now() >= deadline {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err("BRAIN_CORE_DOCUMENT_TIMEOUT");
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout.join().map_err(|_| "BRAIN_CORE_DOCUMENT_PIPE")?;
    let _stderr = stderr.join().map_err(|_| "BRAIN_CORE_DOCUMENT_PIPE")?;
    if stdout.len() as u64 > max_output_bytes {
        return Err("BRAIN_CORE_OUTPUT_LIMIT");
    }
    if !status.success() {
        return Err("BRAIN_CORE_DOCUMENT_EXIT");
    }
    let mut lines = BufReader::new(stdout.as_slice()).lines();
    let response: Value = serde_json::from_str(
        &lines
            .next()
            .ok_or("BRAIN_CORE_DOCUMENT_EMPTY")?
            .map_err(|_| "BRAIN_CORE_DOCUMENT_PIPE")?,
    )
    .map_err(|_| "BRAIN_CORE_DOCUMENT_PROTOCOL")?;
    if lines.any(|line| line.map(|value| !value.trim().is_empty()).unwrap_or(true))
        || response.get("protocol_version").and_then(Value::as_str) != Some("2")
        || response.get("request_id").and_then(Value::as_str) != Some(request_id)
        || !matches!(
            response.get("status").and_then(Value::as_str),
            Some("completed" | "failed")
        )
    {
        return Err("BRAIN_CORE_DOCUMENT_PROTOCOL");
    }
    Ok(response)
}
