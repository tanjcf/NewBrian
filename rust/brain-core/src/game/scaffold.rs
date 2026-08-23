use super::util::{pipeline_state_json, sanitize_project_name, write_text_atomic};
use crate::path_policy::ProjectBoundary;
use serde_json::{json, Value};
use std::path::Path;

const WEB_PACKAGE: &str = r#"{
  "name": "brain-web-game",
  "private": true,
  "scripts": {
    "start": "node server.mjs"
  }
}
"#;

const WEB_SERVER: &str = r#"import { createServer } from "node:http";
createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>BRAIN Web Game</title><main data-testid=game-page>BRAIN Web 游戏模板</main>");
}).listen(5173, "127.0.0.1");
"#;

fn unreal_uproject(project_name: &str, engine_association: &str) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "FileVersion": 3,
            "EngineAssociation": engine_association,
            "Category": "Games",
            "Description": "Created by BRAIN game runtime",
            "Plugins": [
                { "Name": "ModelingToolsEditorMode", "Enabled": true },
                { "Name": "GameplayAbilities", "Enabled": true },
                { "Name": "EnhancedInput", "Enabled": true },
                { "Name": "CommonUI", "Enabled": true }
            ]
        }))
        .unwrap_or_default()
    )
}

fn default_engine_ini(project_name: &str) -> String {
    format!(
        r#"[/Script/EngineSettings.GameMapsSettings]
GameDefaultMap=/Engine/Maps/Templates/OpenWorld.OpenWorld
EditorStartupMap=/Engine/Maps/Templates/OpenWorld.OpenWorld
GlobalDefaultGameMode=/Script/Engine.GameModeBase

[/Script/Engine.RendererSettings]
r.DynamicGlobalIlluminationMethod=1
r.ReflectionMethod=1

[/Script/Engine.Engine]
+ActiveGameNameRedirects=(OldGameName="TP_BlankBP",NewGameName="/Script/{project_name}")

"#
    )
}

fn default_game_ini(project_name: &str) -> String {
    format!(
        r#"[/Script/EngineSettings.GeneralProjectSettings]
ProjectName={project_name}
CompanyName=BRAIN

"#
    )
}

fn default_input_ini() -> &'static str {
    r#"[/Script/Engine.PlayerInput]
DefaultInputComponentClass=/Script/EnhancedInput.EnhancedInputComponent
DefaultPlayerInputClass=/Script/EnhancedInput.EnhancedPlayerInput

[/Script/Engine.InputSettings]
bEnableLegacyInputScales=False

"#
}

fn default_tags_ini() -> &'static str {
    r#"[/Script/GameplayTags.GameplayTagsSettings]
ImportTagsFromConfig=True
+GameplayTagList=(Tag="Ability.Attack.Light",DevComment="BRAIN")
+GameplayTagList=(Tag="Ability.Attack.Heavy",DevComment="BRAIN")
+GameplayTagList=(Tag="Input.Attack.Light",DevComment="BRAIN")
+GameplayTagList=(Tag="Input.Attack.Heavy",DevComment="BRAIN")
+GameplayTagList=(Tag="State.Attacking",DevComment="BRAIN")

"#
}

pub fn scaffold_web_project(boundary: &ProjectBoundary, request_id: &str) -> Result<Value, &'static str> {
    write_text_atomic(boundary, Path::new("package.json"), WEB_PACKAGE, request_id)?;
    write_text_atomic(boundary, Path::new("server.mjs"), WEB_SERVER, request_id)?;
    write_text_atomic(
        boundary,
        Path::new(".brain-game/pipeline.json"),
        &serde_json::to_string_pretty(&pipeline_state_json()).unwrap_or_default(),
        request_id,
    )?;
    Ok(json!({
        "engine": "web",
        "previewCommand": "npm run start",
        "previewUrl": "http://127.0.0.1:5173",
        "pipeline": "brain-game-runtime-v1"
    }))
}

pub fn scaffold_unreal_project(
    boundary: &ProjectBoundary,
    payload: &Value,
    request_id: &str,
) -> Result<Value, &'static str> {
    let project_name = payload
        .get("project_name")
        .and_then(Value::as_str)
        .map(sanitize_project_name)
        .unwrap_or_else(|| "BrainGame".to_owned());
    let engine_association = payload
        .get("engine_association")
        .and_then(Value::as_str)
        .unwrap_or("5.4");
    let uproject_rel = format!("{project_name}.uproproject");
    write_text_atomic(
        boundary,
        Path::new(&uproject_rel),
        &unreal_uproject(&project_name, engine_association),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Config/DefaultEngine.ini"),
        &default_engine_ini(&project_name),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Config/DefaultGame.ini"),
        &default_game_ini(&project_name),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Config/DefaultInput.ini"),
        default_input_ini(),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Config/DefaultGameplayTags.ini"),
        default_tags_ini(),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new(".brain-game/pipeline.json"),
        &serde_json::to_string_pretty(&pipeline_state_json()).unwrap_or_default(),
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Content/README.md"),
        "# Content\n\nCreate `_Core/Input`, `Characters`, and `Maps` in Unreal Editor.\n",
        request_id,
    )?;
    write_text_atomic(
        boundary,
        Path::new("Docs/BRAIN/README.md"),
        &format!("# BRAIN × UE5\n\nOpen `{uproject_rel}` in Epic/Unreal Editor.\n"),
        request_id,
    )?;
    Ok(json!({
        "engine": "unreal",
        "projectName": project_name,
        "uprojectPath": uproject_rel,
        "engineAssociation": engine_association,
        "docsRoot": "Docs/BRAIN",
        "pipeline": "brain-game-runtime-v1"
    }))
}
