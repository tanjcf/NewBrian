use serde_json::{json, Value};

pub fn build_input_mapping_spec(combat_content: &str) -> Value {
    let combat_design = serde_json::from_str::<Value>(combat_content).unwrap_or(json!({}));
    json!({
        "schemaVersion": 1,
        "enhancedInput": {
            "actions": [
                { "name": "IA_Move", "type": "Axis2D", "keys": ["Gamepad_LeftThumbstick2D", "WASD"] },
                { "name": "IA_Look", "type": "Axis2D", "keys": ["Gamepad_RightThumbstick2D", "Mouse2D"] },
                { "name": "IA_LightAttack", "type": "Digital", "tag": "Input.Attack.Light", "keys": ["Gamepad_FaceButton_Left", "LeftMouseButton"] },
                { "name": "IA_HeavyAttack", "type": "Digital", "tag": "Input.Attack.Heavy", "keys": ["Gamepad_FaceButton_Top", "RightMouseButton"] },
                { "name": "IA_Dodge", "type": "Digital", "tag": "Input.Dodge", "keys": ["Gamepad_FaceButton_Right", "LeftShift"] },
                { "name": "IA_Block", "type": "Digital", "tag": "Input.Block", "keys": ["Gamepad_LeftShoulder", "Q"] }
            ],
            "mappingContexts": [{ "name": "IMC_Gameplay", "priority": 0 }]
        },
        "combatDesign": combat_design
    })
}

pub fn build_animation_spec(combat_content: &str) -> Value {
    let _combat: Value = serde_json::from_str(combat_content).unwrap_or(json!({}));
    json!({
        "schemaVersion": 1,
        "montages": [
            {
                "id": "AM_LightAttack",
                "slot": "DefaultSlot",
                "sections": ["WindUp", "Strike", "Recovery"],
                "rootMotion": true,
                "notifies": [
                    { "frame": 10, "name": "EnableWeaponTrace" },
                    { "frame": 14, "name": "DisableWeaponTrace" }
                ]
            },
            {
                "id": "AM_HeavyAttack",
                "slot": "DefaultSlot",
                "sections": ["Charge", "Strike", "Recovery"],
                "rootMotion": true,
                "notifies": [
                    { "frame": 18, "name": "EnableWeaponTrace" },
                    { "frame": 24, "name": "DisableWeaponTrace" }
                ]
            }
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_input_mapping_from_combat_json() {
        let spec = build_input_mapping_spec(r#"{"playerActions":"轻击"}"#);
        assert_eq!(spec["schemaVersion"], 1);
        assert!(spec["enhancedInput"]["actions"].is_array());
    }
}
