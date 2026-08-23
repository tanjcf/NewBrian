//! BRAIN Quant Runtime — health bridge for the existing TypeScript market,
//! portfolio, strategy, and order services.

use serde_json::{json, Value};

pub fn handle(operation: &str) -> Result<Value, &'static str> {
    match operation {
        "quant.health" => Ok(json!({
            "ready": true,
            "pipeline": "brain-quant-runtime-v1"
        })),
        _ => Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

pub fn is_quant_operation(operation: &str) -> bool {
    operation.starts_with("quant.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_quant_runtime_health() {
        assert!(is_quant_operation("quant.health"));
        assert!(!is_quant_operation("data.health"));
        assert_eq!(
            handle("quant.health").expect("quant health"),
            json!({ "ready": true, "pipeline": "brain-quant-runtime-v1" })
        );
    }
}
