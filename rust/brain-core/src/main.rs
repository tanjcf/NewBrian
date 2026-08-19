mod protocol;

use protocol::{validate_request, Request, Response};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, BufRead, Write};

fn handle(request: Request, cancelled: &mut HashSet<String>) -> Response {
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
        _ if cancelled.remove(&request.request_id) => {
            let mut response = Response::failed(request.request_id, "BRAIN_CORE_CANCELLED");
            response.status = "cancelled";
            response
        }
        _ => Response::failed(request.request_id, "BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut cancelled = HashSet::new();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle(request, &mut cancelled),
            Err(_) => Response::failed(String::new(), "BRAIN_CORE_INVALID_JSON"),
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
