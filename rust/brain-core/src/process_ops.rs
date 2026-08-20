use crate::path_policy::ProjectBoundary;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const ALLOWED_ENVIRONMENT: &[&str] = &[
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
];

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
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
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
    // SAFETY: the child was started in a new session whose process-group ID is its PID.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

pub fn run_process(
    boundary: &ProjectBoundary,
    payload: &Value,
    timeout_ms: u64,
    max_output_bytes: u64,
    cancelled: &AtomicBool,
) -> Result<Value, &'static str> {
    let entries = payload
        .as_object()
        .ok_or("BRAIN_CORE_PROCESS_PAYLOAD_INVALID")?;
    if entries
        .keys()
        .any(|key| !matches!(key.as_str(), "executable" | "args" | "cwd"))
    {
        return Err("BRAIN_CORE_PROCESS_FIELD_FORBIDDEN");
    }
    let executable = payload
        .get("executable")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("BRAIN_CORE_EXECUTABLE_REQUIRED")?;
    let args = payload
        .get("args")
        .and_then(Value::as_array)
        .ok_or("BRAIN_CORE_ARGUMENTS_REQUIRED")?
        .iter()
        .map(|value| value.as_str().ok_or("BRAIN_CORE_ARGUMENT_INVALID"))
        .collect::<Result<Vec<_>, _>>()?;
    if args.len() > 256 || args.iter().any(|argument| argument.len() > 32_768) {
        return Err("BRAIN_CORE_ARGUMENT_LIMIT");
    }
    let cwd = payload.get("cwd").and_then(Value::as_str).unwrap_or(".");
    let cwd = boundary
        .existing(std::path::Path::new(cwd))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    if !cwd.is_dir() {
        return Err("BRAIN_CORE_WORKING_DIRECTORY_REQUIRED");
    }

    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in ALLOWED_ENVIRONMENT {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|_| "BRAIN_CORE_PROCESS_SPAWN")?;
    let stdout = read_bounded(
        child.stdout.take().ok_or("BRAIN_CORE_PROCESS_PIPE")?,
        max_output_bytes,
    );
    let stderr = read_bounded(
        child.stderr.take().ok_or("BRAIN_CORE_PROCESS_PIPE")?,
        max_output_bytes,
    );
    let deadline = (timeout_ms > 0).then(|| Instant::now() + Duration::from_millis(timeout_ms));
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "BRAIN_CORE_PROCESS_WAIT")? {
            break status;
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err("BRAIN_CORE_PROCESS_TIMEOUT");
        }
        if cancelled.load(Ordering::Acquire) {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err("BRAIN_CORE_CANCELLED");
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout.join().map_err(|_| "BRAIN_CORE_PROCESS_PIPE")?;
    let stderr = stderr.join().map_err(|_| "BRAIN_CORE_PROCESS_PIPE")?;
    if stdout.len() as u64 + stderr.len() as u64 > max_output_bytes {
        return Err("BRAIN_CORE_OUTPUT_LIMIT");
    }
    Ok(json!({
        "exit_code": status.code(),
        "success": status.success(),
        "stdout_base64": STANDARD.encode(stdout),
        "stderr_base64": STANDARD.encode(stderr)
    }))
}
