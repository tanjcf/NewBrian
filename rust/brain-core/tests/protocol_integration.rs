use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct CoreProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl CoreProcess {
    fn start(project_root: &PathBuf) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_brain-core"))
            .arg("--project-root")
            .arg(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("BRAIN_TEST_SECRET", "must-not-reach-command")
            .spawn()
            .expect("start brain-core");
        let stdin = child.stdin.take().expect("child stdin");
        let stdout = BufReader::new(child.stdout.take().expect("child stdout"));
        Self {
            child,
            stdin: Some(stdin),
            stdout,
        }
    }

    fn request(&mut self, request_id: &str, operation: &str, token: &str, payload: Value) -> Value {
        self.request_with_limits(request_id, operation, token, payload, 1_000, 4_096)
    }

    fn request_with_limits(
        &mut self,
        request_id: &str,
        operation: &str,
        token: &str,
        payload: Value,
        timeout_ms: u64,
        max_output_bytes: u64,
    ) -> Value {
        self.send_with_limits(
            request_id,
            operation,
            token,
            payload,
            timeout_ms,
            max_output_bytes,
        );
        self.response()
    }

    fn send_with_limits(
        &mut self,
        request_id: &str,
        operation: &str,
        token: &str,
        payload: Value,
        timeout_ms: u64,
        max_output_bytes: u64,
    ) {
        let request = json!({
            "protocol_version": "1",
            "request_id": request_id,
            "project_id": "project-1",
            "workspace_type": "software",
            "operation": operation,
            "approval_token": token,
            "resource_limits": { "timeout_ms": timeout_ms, "max_output_bytes": max_output_bytes },
            "payload": payload
        });
        let stdin = self.stdin.as_mut().expect("open child stdin");
        serde_json::to_writer(&mut *stdin, &request).expect("write request");
        stdin.write_all(b"\n").expect("frame delimiter");
        stdin.flush().expect("flush request");
    }

    fn response(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("read response");
        assert!(!line.is_empty(), "brain-core exited without a response");
        serde_json::from_str(&line).expect("valid response")
    }

    fn close_input_and_wait(&mut self, timeout: std::time::Duration) -> bool {
        self.stdin.take();
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if self.child.try_wait().expect("child status").is_some() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }
}

#[cfg(windows)]
fn command(script: &str) -> Value {
    json!({ "executable": "cmd.exe", "args": ["/D", "/S", "/C", script], "cwd": "." })
}

#[cfg(not(windows))]
fn command(script: &str) -> Value {
    json!({ "executable": "/bin/sh", "args": ["-c", script], "cwd": "." })
}

impl Drop for CoreProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn temporary_project() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "brain-core-integration-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(root.join("nested")).expect("project root");
    fs::write(root.join("nested/input.txt"), b"input").expect("input fixture");
    root
}

#[test]
fn enforces_project_boundary_approval_replay_and_cancellation_over_stdio() {
    let root = temporary_project();
    let mut core = CoreProcess::start(&root);

    let health = core.request("health", "health.check", "", json!({}));
    assert_eq!(health["status"], "completed");
    assert_eq!(health["result"]["protocol_version"], "1");

    let read = core.request(
        "read",
        "file.read",
        "",
        json!({ "path": "nested/input.txt" }),
    );
    assert_eq!(read["result"]["data_base64"], STANDARD.encode(b"input"));

    let traversal = core.request(
        "traversal",
        "file.read",
        "",
        json!({ "path": "../outside.txt" }),
    );
    assert_eq!(traversal["error_code"], "BRAIN_CORE_PATH_ESCAPE");

    let token = "0123456789abcdef0123456789abcdef";
    let registration = core.request(
        "approval",
        "approval.register",
        "",
        json!({ "token": token, "operation": "file.write", "ttl_ms": 30_000 }),
    );
    assert_eq!(registration["status"], "completed");

    let write = core.request(
        "write",
        "file.write",
        token,
        json!({
            "path": "nested/output.txt",
            "data_base64": STANDARD.encode(b"output")
        }),
    );
    assert_eq!(write["status"], "completed");
    assert_eq!(
        fs::read(root.join("nested/output.txt")).expect("written file"),
        b"output"
    );

    let replay = core.request(
        "write-replay",
        "file.write",
        token,
        json!({
            "path": "nested/replayed.txt",
            "data_base64": STANDARD.encode(b"replay")
        }),
    );
    assert_eq!(replay["error_code"], "BRAIN_CORE_APPROVAL_REQUIRED");
    assert!(!root.join("nested/replayed.txt").exists());

    let cancellation = core.request(
        "cancel",
        "request.cancel",
        "",
        json!({ "target_request_id": "future-request" }),
    );
    assert_eq!(cancellation["status"], "completed");
    let cancelled = core.request("future-request", "future.operation", "", json!({}));
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(cancelled["error_code"], "BRAIN_CORE_CANCELLED");

    drop(core);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn runs_an_approved_process_with_bounded_output_timeout_and_clean_environment() {
    let root = temporary_project();
    let mut core = CoreProcess::start(&root);
    let token = "abcdef0123456789abcdef0123456789";
    let registration = core.request(
        "process-approval",
        "approval.register",
        "",
        json!({ "token": token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    assert_eq!(registration["status"], "completed");

    #[cfg(windows)]
    let script = "if defined BRAIN_TEST_SECRET (echo leaked) else (echo clean)";
    #[cfg(not(windows))]
    let script = "if [ -n \"$BRAIN_TEST_SECRET\" ]; then echo leaked; else echo clean; fi";
    let run = core.request("process", "process.run", token, command(script));
    assert_eq!(run["status"], "completed");
    let stdout = STANDARD
        .decode(run["result"]["stdout_base64"].as_str().expect("stdout"))
        .expect("base64 stdout");
    assert_eq!(String::from_utf8_lossy(&stdout).trim(), "clean");
    assert_eq!(run["result"]["exit_code"], 0);

    let output_token = "fedcba9876543210fedcba9876543210";
    core.request(
        "output-approval",
        "approval.register",
        "",
        json!({ "token": output_token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    let output_limit = core.request_with_limits(
        "output-limit",
        "process.run",
        output_token,
        command("echo 123456789"),
        1_000,
        4,
    );
    assert_eq!(output_limit["error_code"], "BRAIN_CORE_OUTPUT_LIMIT");

    let combined_token = "1234567890abcdef1234567890abcdef";
    core.request(
        "combined-approval",
        "approval.register",
        "",
        json!({ "token": combined_token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    #[cfg(windows)]
    let combined_output = "<nul set /p =123 & <nul set /p =456 1>&2";
    #[cfg(not(windows))]
    let combined_output = "printf 123; printf 456 >&2";
    let combined_limit = core.request_with_limits(
        "combined-limit",
        "process.run",
        combined_token,
        command(combined_output),
        1_000,
        4,
    );
    assert_eq!(combined_limit["error_code"], "BRAIN_CORE_OUTPUT_LIMIT");

    let timeout_token = "00112233445566778899aabbccddeeff";
    core.request(
        "timeout-approval",
        "approval.register",
        "",
        json!({ "token": timeout_token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    #[cfg(windows)]
    let sleep = "ping 127.0.0.1 -n 6 > nul";
    #[cfg(not(windows))]
    let sleep = "sleep 5";
    let timeout = core.request_with_limits(
        "timeout",
        "process.run",
        timeout_token,
        command(sleep),
        100,
        1_024,
    );
    assert_eq!(timeout["error_code"], "BRAIN_CORE_PROCESS_TIMEOUT");

    let tree_token = "aabbccddeeff00112233445566778899";
    core.request(
        "tree-approval",
        "approval.register",
        "",
        json!({ "token": tree_token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    #[cfg(windows)]
    let process_tree = "start \"\" /B cmd /D /S /C \"ping 127.0.0.1 -n 4 > nul & echo orphan>nested\\orphan.txt\" & ping 127.0.0.1 -n 20 > nul";
    #[cfg(not(windows))]
    let process_tree = "(sleep 2; echo orphan > nested/orphan.txt) & sleep 20";
    let tree_timeout = core.request_with_limits(
        "tree-timeout",
        "process.run",
        tree_token,
        command(process_tree),
        100,
        1_024,
    );
    assert_eq!(tree_timeout["error_code"], "BRAIN_CORE_PROCESS_TIMEOUT");
    std::thread::sleep(std::time::Duration::from_secs(4));
    assert!(
        !root.join("nested/orphan.txt").exists(),
        "timed-out child process survived its process group"
    );

    drop(core);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn cancels_a_running_process_without_waiting_for_its_timeout() {
    let root = temporary_project();
    let mut core = CoreProcess::start(&root);
    let token = "99887766554433221100ffeeddccbbaa";
    core.request(
        "cancel-run-approval",
        "approval.register",
        "",
        json!({ "token": token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    #[cfg(windows)]
    let sleep = "ping 127.0.0.1 -n 20 > nul";
    #[cfg(not(windows))]
    let sleep = "sleep 20";
    core.send_with_limits(
        "cancel-run",
        "process.run",
        token,
        command(sleep),
        30_000,
        1_024,
    );
    core.send_with_limits(
        "cancel-command",
        "request.cancel",
        "",
        json!({ "target_request_id": "cancel-run" }),
        1_000,
        1_024,
    );
    let first = core.response();
    let second = core.response();
    let responses = [first, second];
    let cancellation = responses
        .iter()
        .find(|response| response["request_id"] == "cancel-command")
        .expect("cancellation response");
    assert_eq!(cancellation["status"], "completed");
    let process = responses
        .iter()
        .find(|response| response["request_id"] == "cancel-run")
        .expect("process response");
    assert_eq!(process["status"], "cancelled");
    assert_eq!(process["error_code"], "BRAIN_CORE_CANCELLED");

    drop(core);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn rejects_caller_environment_and_stops_active_processes_on_core_shutdown() {
    let root = temporary_project();
    let mut core = CoreProcess::start(&root);
    let token = "11223344556677889900aabbccddeeff";
    core.request(
        "environment-approval",
        "approval.register",
        "",
        json!({ "token": token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    let mut environment_payload = command("echo should-not-run");
    environment_payload["environment"] = json!({ "CUSTOM_VALUE": "forbidden" });
    let environment = core.request("environment", "process.run", token, environment_payload);
    assert_eq!(
        environment["error_code"],
        "BRAIN_CORE_PROCESS_FIELD_FORBIDDEN"
    );

    let shutdown_token = "ffeeddccbbaa00998877665544332211";
    core.request(
        "shutdown-approval",
        "approval.register",
        "",
        json!({ "token": shutdown_token, "operation": "process.run", "ttl_ms": 30_000 }),
    );
    #[cfg(windows)]
    let sleep = "ping 127.0.0.1 -n 20 > nul";
    #[cfg(not(windows))]
    let sleep = "sleep 20";
    core.send_with_limits(
        "shutdown-run",
        "process.run",
        shutdown_token,
        command(sleep),
        30_000,
        1_024,
    );
    assert!(core.close_input_and_wait(std::time::Duration::from_secs(2)));

    drop(core);
    fs::remove_dir_all(root).expect("cleanup");
}
