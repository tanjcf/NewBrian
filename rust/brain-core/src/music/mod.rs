//! BRAIN Music Runtime — DAW editor and Cook operations.

mod daw;

pub use daw::{cook, daw_get, daw_save};

use crate::path_policy::ProjectBoundary;
use serde_json::Value;

pub fn handle(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    match operation {
        "music.daw_get" => daw_get(boundary),
        "music.daw_save" => daw_save(boundary, payload, request_id),
        "music.cook" => cook(boundary, payload, request_id),
        _ => Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

pub fn is_music_operation(operation: &str) -> bool {
    operation.starts_with("music.")
}

pub fn music_operation_requires_approval(operation: &str) -> bool {
    operation != "music.daw_get"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_music_operations_and_approval() {
        assert!(is_music_operation("music.cook"));
        assert!(!is_music_operation("data.cook"));
        assert!(!music_operation_requires_approval("music.daw_get"));
        assert!(music_operation_requires_approval("music.daw_save"));
    }
}
