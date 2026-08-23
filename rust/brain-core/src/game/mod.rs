//! BRAIN Game Runtime — Rust Engine layer (UE5-aligned).
//! Architecture: docs/architecture/brain-game-runtime-v1.md
//!
//! Operations:
//!   game.inspect          — AssetRegistry-style bounded scan
//!   game.scaffold_web     — Web mini-game project
//!   game.scaffold_unreal  — .uproject + Config/ + Content/ tree
//!   game.cook             — Editor sections → Docs/BRAIN + manifest
//!   game.level_editor_get — Level Editor state (read)
//!   game.level_editor_save — Level Editor state (write, approval)
//!   game.spawn_actor      — Append AI enemy/boss/npc to a level (approval)
//!   game.content_tree     — Content/ browser tree (read)
//!   game.launch_editor    — process.run UnrealEditor (approval required)
//!   game.launch_uat       — Phase 4 packaging

mod cook;
mod inspect;
mod level;
mod scaffold;
mod spec;
pub(crate) mod util;

pub use cook::cook_design_sections;
pub use inspect::inspect_game_project;
pub use level::{content_tree, level_editor_get, level_editor_save, spawn_actor};
pub use scaffold::{scaffold_unreal_project, scaffold_web_project};
pub use spec::{build_animation_spec, build_input_mapping_spec};

use crate::path_policy::ProjectBoundary;
use serde_json::Value;

pub fn handle(
    operation: &str,
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
    max_output_bytes: u64,
) -> Result<Value, &'static str> {
    match operation {
        "game.inspect" => inspect_game_project(boundary, payload, max_output_bytes),
        "game.scaffold_web" => scaffold_web_project(boundary, request_id),
        "game.scaffold_unreal" => scaffold_unreal_project(boundary, payload, request_id),
        "game.cook" => cook_design_sections(boundary, payload, request_id),
        "game.level_editor_get" => level_editor_get(boundary),
        "game.level_editor_save" => level_editor_save(boundary, payload, request_id),
        "game.spawn_actor" => spawn_actor(boundary, payload, request_id),
        "game.content_tree" => content_tree(boundary, payload),
        "game.launch_editor" | "game.launch_uat" => Err("BRAIN_GAME_LAUNCH_NOT_IMPLEMENTED"),
        _ => Err("BRAIN_CORE_OPERATION_UNSUPPORTED"),
    }
}

pub fn is_game_operation(operation: &str) -> bool {
    operation.starts_with("game.")
}

pub fn game_operation_requires_approval(operation: &str) -> bool {
    !matches!(
        operation,
        "game.inspect" | "game.level_editor_get" | "game.content_tree"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_game_operations() {
        assert!(is_game_operation("game.cook"));
        assert!(!is_game_operation("file.read"));
        assert!(game_operation_requires_approval("game.cook"));
        assert!(!game_operation_requires_approval("game.inspect"));
        assert!(!game_operation_requires_approval("game.level_editor_get"));
        assert!(game_operation_requires_approval("game.spawn_actor"));
    }
}
