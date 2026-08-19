mod approval;
mod file_ops;
mod git_ops;
mod path_policy;
mod process_ops;
mod protocol;

use approval::ApprovalRegistry;
use path_policy::ProjectBoundary;
use protocol::{validate_request, Request, Response};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
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
        "git.status" | "git.diff" => match git_ops::read(
            &request.operation,
            boundary,
            &request.payload,
            request.resource_limits.timeout_ms,
            request.resource_limits.max_output_bytes,
        ) {
            Ok(result) => Response::completed(request.request_id, result),
            Err(code) => Response::failed(request.request_id, code),
        },
        "git.add" | "git.commit" => {
            if let Err(code) = approvals.consume(
                &request.approval_token,
                &request.project_id,
                &request.operation,
            ) {
                return Response::failed(request.request_id, code);
            }
            match git_ops::mutate(
                &request.operation,
                boundary,
                &request.payload,
                request.resource_limits.timeout_ms,
                request.resource_limits.max_output_bytes,
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

fn write_response<W: Write>(writer: &Arc<Mutex<W>>, response: &Response) -> io::Result<()> {
    let mut writer = writer
        .lock()
        .map_err(|_| io::Error::other("response writer poisoned"))?;
    serde_json::to_writer(&mut *writer, response)?;
    writer.write_all(b"\n")?;
    writer.flush()
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
    let stdout = Arc::new(Mutex::new(io::BufWriter::new(io::stdout())));
    let mut cancelled = HashSet::new();
    let mut approvals = ApprovalRegistry::default();
    let active_processes = Arc::new(Mutex::new(HashMap::<String, Arc<AtomicBool>>::new()));
    let mut workers: Vec<thread::JoinHandle<()>> = Vec::new();

    for line in stdin.lock().lines() {
        let mut running_workers = Vec::with_capacity(workers.len());
        for worker in workers.drain(..) {
            if worker.is_finished() {
                let _ = worker.join();
            } else {
                running_workers.push(worker);
            }
        }
        workers = running_workers;
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_response(
                    &stdout,
                    &Response::failed(String::new(), "BRAIN_CORE_INVALID_JSON"),
                )?;
                continue;
            }
        };
        if request.operation == "request.cancel" {
            let target = request
                .payload
                .get("target_request_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned();
            if let Some(flag) = active_processes
                .lock()
                .map_err(|_| io::Error::other("active process registry poisoned"))?
                .get(&target)
            {
                flag.store(true, Ordering::Release);
            }
            let response = handle(request, &boundary, &mut approvals, &mut cancelled);
            write_response(&stdout, &response)?;
            continue;
        }
        if request.operation == "process.run" {
            if let Err(code) = validate_request(&request) {
                write_response(&stdout, &Response::failed(request.request_id, code))?;
                continue;
            }
            if let Err(code) = approvals.consume(
                &request.approval_token,
                &request.project_id,
                &request.operation,
            ) {
                write_response(&stdout, &Response::failed(request.request_id, code))?;
                continue;
            }
            let request_id = request.request_id;
            let cancellation = Arc::new(AtomicBool::new(false));
            active_processes
                .lock()
                .map_err(|_| io::Error::other("active process registry poisoned"))?
                .insert(request_id.clone(), Arc::clone(&cancellation));
            let worker_boundary = boundary.clone();
            let worker_processes = Arc::clone(&active_processes);
            let worker_stdout = Arc::clone(&stdout);
            workers.push(thread::spawn(move || {
                let response = match process_ops::run_process(
                    &worker_boundary,
                    &request.payload,
                    request.resource_limits.timeout_ms,
                    request.resource_limits.max_output_bytes,
                    &cancellation,
                ) {
                    Ok(result) => Response::completed(request_id.clone(), result),
                    Err("BRAIN_CORE_CANCELLED") => {
                        let mut response =
                            Response::failed(request_id.clone(), "BRAIN_CORE_CANCELLED");
                        response.status = "cancelled";
                        response
                    }
                    Err(code) => Response::failed(request_id.clone(), code),
                };
                if let Ok(mut processes) = worker_processes.lock() {
                    processes.remove(&request_id);
                }
                let _ = write_response(&worker_stdout, &response);
            }));
            continue;
        }
        let response = handle(request, &boundary, &mut approvals, &mut cancelled);
        write_response(&stdout, &response)?;
    }
    if let Ok(processes) = active_processes.lock() {
        for cancellation in processes.values() {
            cancellation.store(true, Ordering::Release);
        }
    }
    for worker in workers {
        let _ = worker.join();
    }
    Ok(())
}
