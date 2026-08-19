mod approval;
mod file_ops;
mod path_policy;
mod protocol;

use approval::ApprovalRegistry;
use path_policy::ProjectBoundary;
use protocol::{validate_request, Request, Response};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Duration;

fn handle(
    request: Request,
    boundary: &ProjectBoundary,
    approvals: &mut ApprovalRegistry,
    cancelled: &mut HashSet<String>,
) -> Response {
    if let Err(code) = validate_request(&request) {
        return Response::failed(request.request_id, code);
    }
    match request.operation.as_str() {
        "health.check" => Response::completed(
            request.request_id,
            json!({ "ready": true, "protocol_version": protocol::PROTOCOL_VERSION }),
        ),
        "request.cancel" => {
            let target = request
                .payload
                .get("target_request_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if target.is_empty() {
                Response::failed(request.request_id, "BRAIN_CORE_CANCEL_TARGET_REQUIRED")
            } else {
                cancelled.insert(target.to_owned());
                Response::completed(request.request_id, json!({ "cancelled": target }))
            }
        }
        "approval.register" => {
            let token = request
                .payload
                .get("token")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let operation = request
                .payload
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let ttl_ms = request
                .payload
                .get("ttl_ms")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            match approvals.register(
                token.to_owned(),
                request.project_id,
                operation.to_owned(),
                Duration::from_millis(ttl_ms),
            ) {
                Ok(()) => Response::completed(request.request_id, json!({ "registered": true })),
                Err(code) => Response::failed(request.request_id, code),
            }
        }
        "file.read" => match file_ops::read_file(
            boundary,
            &request.payload,
            request.resource_limits.max_output_bytes,
        ) {
            Ok(result) => Response::completed(request.request_id, result),
            Err(code) => Response::failed(request.request_id, code),
        },
        "file.write" => {
            if let Err(code) = approvals.consume(
                &request.approval_token,
                &request.project_id,
                &request.operation,
            ) {
                return Response::failed(request.request_id, code);
            }
            match file_ops::write_file(
                boundary,
                &request.payload,
                request.resource_limits.max_output_bytes,
                &request.request_id,
            ) {
                Ok(result) => Response::completed(request.request_id, result),
                Err(code) => Response::failed(request.request_id, code),
            }
        }
        _ if cancelled.remove(&request.request_id) => {
            let mut response = Response::failed(request.request_id, "BRAIN_CORE_CANCELLED");
            response.status = "cancelled";
            response
        }
        _ => Response::failed(request.request_id, "BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

fn main() -> io::Result<()> {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(std::ffi::OsStr::new("--project-root")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--project-root is required",
        ));
    }
    let project_root = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "project root is required"))?;
    let boundary = ProjectBoundary::bind(&project_root)?;
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut cancelled = HashSet::new();
    let mut approvals = ApprovalRegistry::default();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle(request, &boundary, &mut approvals, &mut cancelled),
            Err(_) => Response::failed(String::new(), "BRAIN_CORE_INVALID_JSON"),
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
