/**
 * BRAIN Game Runtime v1 — protocol contract (UE5-aligned).
 * Architecture: docs/architecture/brain-game-runtime-v1.md
 *
 * All mutating game.project operations MUST execute in Rust brain-core,
 * not in Electron main-process TypeScript.
 */

export const BRAIN_GAME_RUNTIME_VERSION = "brain-game-runtime-v1" as const;

/** Rust brain-core operations for the game workspace. */
export const brainGameCoreOperations = {
  inspect: "game.inspect",
  scaffoldWeb: "game.scaffold_web",
  scaffoldUnreal: "game.scaffold_unreal",
  cook: "game.cook",
  levelEditorGet: "game.level_editor_get",
  levelEditorSave: "game.level_editor_save",
  spawnActor: "game.spawn_actor",
  contentTree: "game.content_tree",
  launchEditor: "game.launch_editor",
  launchUat: "game.launch_uat"
} as const;

export type BrainGameCoreOperation =
  (typeof brainGameCoreOperations)[keyof typeof brainGameCoreOperations];

/** Editor draft sections (SQLite) — maps to UE5 pre-production docs. */
export const brainGameDesignSectionKeys = ["design", "world", "level", "combat"] as const;
export type BrainGameDesignSectionKey = (typeof brainGameDesignSectionKeys)[number];

export interface BrainGameDesignSectionPayload {
  sectionKey: BrainGameDesignSectionKey;
  content: string;
  revision: number;
}

/** Relative paths under project root after Cook (see architecture doc). */
export const brainGameCookedPaths = {
  brainMetaDir: ".brain-game",
  pipelineFile: ".brain-game/pipeline.json",
  manifestFile: ".brain-game/manifest.json",
  docsRoot: "Docs/BRAIN",
  designDoc: "Docs/BRAIN/design.md",
  worldDoc: "Docs/BRAIN/world.json",
  levelDoc: "Docs/BRAIN/level.json",
  combatDoc: "Docs/BRAIN/combat.json",
  inputMapping: "Docs/BRAIN/input-mapping.json",
  animationSpec: "Docs/BRAIN/animation-spec.json",
  configEngine: "Config/DefaultEngine.ini",
  configGame: "Config/DefaultGame.ini",
  configInput: "Config/DefaultInput.ini",
  configTags: "Config/DefaultGameplayTags.ini",
  contentReadme: "Content/README.md"
} as const;

export interface BrainGamePipelineManifest {
  schemaVersion: 1;
  pipeline: typeof BRAIN_GAME_RUNTIME_VERSION;
  exportedAt: string;
  projectName?: string;
  engineAssociation?: string;
  sections: Partial<Record<BrainGameDesignSectionKey, { path: string; revision: number; sha256: string }>>;
  files: Array<{ path: string; sha256: string; sizeBytes: number }>;
}

export interface BrainGamePipelineState {
  schemaVersion: 1;
  pipeline: typeof BRAIN_GAME_RUNTIME_VERSION;
  engineTargets: Array<"web" | "unreal" | "godot" | "unity">;
  lastCookAt?: string;
  lastInspectAt?: string;
}

/** game.inspect result — aligns with BrainGameProjectInspection. */
export interface BrainGameInspectCoreResult {
  engine: "web" | "godot" | "unity" | "unreal" | "unknown";
  displayName: string;
  markers: string[];
  assets: {
    scripts: number;
    scenes: number;
    images: number;
    audio: number;
    video: number;
    models: number;
    other: number;
  };
  uprojectPath?: string;
  engineAssociation?: string;
  brainManifestPresent: boolean;
  scannedEntries: number;
  truncated: boolean;
}

/** game.scaffold_unreal payload → brain-core. */
export interface BrainGameScaffoldUnrealPayload {
  projectName: string;
  engineAssociation: string;
  sections?: BrainGameDesignSectionPayload[];
  runCook?: boolean;
}

/** game.cook payload → brain-core. */
export interface BrainGameCookPayload {
  sections: BrainGameDesignSectionPayload[];
  projectName?: string;
  engineAssociation?: string;
}

/** game.scaffold_unreal / game.cook completed result. */
export interface BrainGameCookResult {
  pipeline: typeof BRAIN_GAME_RUNTIME_VERSION;
  docsRoot: string;
  exportedFiles: string[];
  manifestPath: string;
  uprojectPath?: string;
  projectName?: string;
  engineAssociation?: string;
}

/** Enhanced Input spec derived at Cook time (Editor creates uassets). */
export interface BrainGameInputMappingSpec {
  schemaVersion: 1;
  enhancedInput: {
    actions: Array<{
      name: string;
      type: "Digital" | "Axis1D" | "Axis2D";
      tag?: string;
      keys: string[];
    }>;
    mappingContexts: Array<{ name: string; priority: number }>;
  };
  combatDesign?: Record<string, string>;
}

/** Animation / Montage spec derived at Cook time. */
export interface BrainGameAnimationSpec {
  schemaVersion: 1;
  montages: Array<{
    id: string;
    slot: string;
    sections?: string[];
    rootMotion?: boolean;
    notifies: Array<{ frame: number; name: string; note?: string }>;
  }>;
}

/** Default UE5 plugin list for scaffold_unreal. */
export const brainGameUnrealDefaultPlugins = [
  "ModelingToolsEditorMode",
  "GameplayAbilities",
  "EnhancedInput",
  "CommonUI"
] as const;

export function isBrainGameCoreOperation(value: string): value is BrainGameCoreOperation {
  return (Object.values(brainGameCoreOperations) as string[]).includes(value);
}

export function requiresGameCoreApproval(operation: BrainGameCoreOperation): boolean {
  return operation !== brainGameCoreOperations.inspect
    && operation !== brainGameCoreOperations.levelEditorGet
    && operation !== brainGameCoreOperations.contentTree;
}

export type BrainGameActorKind = "prop" | "enemy" | "boss" | "npc" | "start";

export interface BrainGameLevelActor {
  id: string;
  name: string;
  type: string;
  loc: string;
  ai: string;
  beh: string;
  kind: BrainGameActorKind;
}

export interface BrainGameLevelSpec {
  id: string;
  title: string;
  umap: string;
  actors: BrainGameLevelActor[];
}

export interface BrainGameLevelEditorState {
  schemaVersion: 1;
  pipeline?: typeof BRAIN_GAME_RUNTIME_VERSION;
  selectedLevelIndex: number;
  levels: BrainGameLevelSpec[];
}

export interface BrainGameLevelEditorGetResult {
  pipeline: typeof BRAIN_GAME_RUNTIME_VERSION;
  path: string;
  persisted: boolean;
  state: BrainGameLevelEditorState;
}

export interface BrainGameContentTreeEntry {
  path: string;
  name: string;
  kind: "folder" | "file";
  ext: string;
}

export interface BrainGameContentTreeResult {
  pipeline: typeof BRAIN_GAME_RUNTIME_VERSION;
  root: string;
  exists: boolean;
  entries: BrainGameContentTreeEntry[];
  truncated?: boolean;
  note?: string;
}
