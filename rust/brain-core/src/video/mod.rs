//! BRAIN Video Runtime — pipeline editor and Cook operations.

mod pipeline;

pub use pipeline::{cook, mark_shot, pipeline_get, pipeline_save};

use crate::path_policy::ProjectBoundary;
use serde_json::Value;

pub fn handle(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    match operation {
        "video.pipeline_get" => pipeline_get(boundary),
        "video.pipeline_save" => pipeline_save(boundary, payload, request_id),
        "video.mark_shot" => mark_shot(boundary, payload, request_id),
        "video.cook" => cook(boundary, payload, request_id),
        _ => Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

pub fn is_video_operation(operation: &str) -> bool {
    operation.starts_with("video.")
}

pub fn video_operation_requires_approval(operation: &str) -> bool {
    operation != "video.pipeline_get"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_video_operations_and_approval() {
        assert!(is_video_operation("video.cook"));
        assert!(!is_video_operation("music.cook"));
        assert!(!video_operation_requires_approval("video.pipeline_get"));
        assert!(video_operation_requires_approval("video.pipeline_save"));
    }
}
