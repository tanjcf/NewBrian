//! BRAIN Data Runtime — analysis editor and Cook operations.

mod analysis;

pub use analysis::{analysis_get, analysis_save, cook};

use crate::path_policy::ProjectBoundary;
use serde_json::Value;

pub fn handle(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    match operation {
        "data.analysis_get" => analysis_get(boundary),
        "data.analysis_save" => analysis_save(boundary, payload, request_id),
        "data.cook" => cook(boundary, payload, request_id),
        _ => Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

pub fn is_data_operation(operation: &str) -> bool {
    operation.starts_with("data.")
}

pub fn data_operation_requires_approval(operation: &str) -> bool {
    operation != "data.analysis_get"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_data_operations_and_approval() {
        assert!(is_data_operation("data.cook"));
        assert!(!is_data_operation("video.cook"));
        assert!(!data_operation_requires_approval("data.analysis_get"));
        assert!(data_operation_requires_approval("data.analysis_save"));
    }
}
