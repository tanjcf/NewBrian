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
    stdin: ChildStdin,
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
            .spawn()
            .expect("start brain-core");
        let stdin = child.stdin.take().expect("child stdin");
        let stdout = BufReader::new(child.stdout.take().expect("child stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn request(&mut self, request_id: &str, operation: &str, token: &str, payload: Value) -> Value {
        let request = json!({
            "protocol_version": "1",
            "request_id": request_id,
            "project_id": "project-1",
            "workspace_type": "software",
            "operation": operation,
            "approval_token": token,
            "resource_limits": { "timeout_ms": 1_000, "max_output_bytes": 4_096 },
            "payload": payload
        });
        serde_json::to_writer(&mut self.stdin, &request).expect("write request");
        self.stdin.write_all(b"\n").expect("frame delimiter");
        self.stdin.flush().expect("flush request");

        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("read response");
        assert!(!line.is_empty(), "brain-core exited without a response");
        serde_json::from_str(&line).expect("valid response")
    }
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
