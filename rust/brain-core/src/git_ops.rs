use crate::path_policy::ProjectBoundary;
use crate::process_ops;
use serde_json::{json, Value};
use std::path::{Component, Path};
use std::sync::atomic::AtomicBool;

fn relative_path(value: &str) -> Result<&str, &'static str> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err("BRAIN_CORE_PATH_ESCAPE");
    }
    Ok(value)
}

fn repository(payload: &Value) -> Result<&str, &'static str> {
    relative_path(
        payload
            .get("repository")
            .and_then(Value::as_str)
            .unwrap_or("."),
    )
}

fn paths(payload: &Value) -> Result<Vec<&str>, &'static str> {
    payload
        .get("paths")
        .and_then(Value::as_array)
        .map(|items| {
            if items.len() > 256 {
                return Err("BRAIN_CORE_ARGUMENT_LIMIT");
            }
            items
                .iter()
                .map(|item| {
                    item.as_str()
                        .ok_or("BRAIN_CORE_ARGUMENT_INVALID")
                        .and_then(relative_path)
                })
                .collect()
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

pub fn read(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    timeout_ms: u64,
    max_output_bytes: u64,
) -> Result<Value, &'static str> {
    let repository = repository(payload)?;
    boundary
        .existing(Path::new(repository))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let arguments = match operation {
        "git.status" => vec![
            "status".to_owned(),
            "--porcelain=v2".to_owned(),
            "--branch".to_owned(),
            "--untracked-files=all".to_owned(),
        ],
        "git.diff" => {
            let mut arguments = vec!["diff".to_owned(), "--no-ext-diff".to_owned()];
            if payload.get("staged").and_then(Value::as_bool) == Some(true) {
                arguments.push("--cached".to_owned());
            }
            let paths = paths(payload)?;
            if !paths.is_empty() {
                arguments.push("--".to_owned());
                arguments.extend(paths.into_iter().map(str::to_owned));
            }
            arguments
        }
        _ => return Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    };
    let cancelled = AtomicBool::new(false);
    let result = process_ops::run_process(
        boundary,
        &json!({ "executable": "git", "args": arguments, "cwd": repository }),
        timeout_ms,
        max_output_bytes,
        &cancelled,
    )?;
    if result.get("success").and_then(Value::as_bool) != Some(true) {
        return Err("BRAIN_CORE_GIT_FAILED");
    }
    Ok(result)
}

pub fn mutate(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    timeout_ms: u64,
    max_output_bytes: u64,
) -> Result<Value, &'static str> {
    let repository = repository(payload)?;
    boundary
        .existing(Path::new(repository))
        .map_err(|_| "BRAIN_CORE_PATH_ESCAPE")?;
    let hooks = tempfile::tempdir().map_err(|_| "BRAIN_CORE_GIT_HOOK_ISOLATION")?;
    let hooks_path = hooks
        .path()
        .to_str()
        .ok_or("BRAIN_CORE_GIT_HOOK_ISOLATION")?;
    let mut arguments = vec![
        "-c".to_owned(),
        format!("core.hooksPath={hooks_path}"),
        "-c".to_owned(),
        "commit.gpgSign=false".to_owned(),
    ];
    match operation {
        "git.add" => {
            let paths = paths(payload)?;
            if paths.is_empty() {
                return Err("BRAIN_CORE_GIT_PATHS_REQUIRED");
            }
            arguments.push("add".to_owned());
            arguments.push("--".to_owned());
            arguments.extend(paths.into_iter().map(str::to_owned));
        }
        "git.commit" => {
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or("BRAIN_CORE_GIT_MESSAGE_REQUIRED")?;
            if message.len() > 10_000 {
                return Err("BRAIN_CORE_GIT_MESSAGE_LIMIT");
            }
            arguments.extend(["commit".to_owned(), "-m".to_owned(), message.to_owned()]);
        }
        _ => return Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
    let cancelled = AtomicBool::new(false);
    let result = process_ops::run_process(
        boundary,
        &json!({ "executable": "git", "args": arguments, "cwd": repository }),
        timeout_ms,
        max_output_bytes,
        &cancelled,
    )?;
    if result.get("success").and_then(Value::as_bool) != Some(true) {
        return Err("BRAIN_CORE_GIT_FAILED");
    }
    Ok(result)
}
