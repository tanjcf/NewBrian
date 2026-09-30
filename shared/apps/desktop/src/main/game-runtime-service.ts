import { randomUUID } from "node:crypto";
import {
  brainGameCoreOperations,
  type BrainGameContentTreeResult,
  type BrainGameCookPayload,
  type BrainGameCookResult,
  type BrainGameDesignSectionPayload,
  type BrainGameInspectCoreResult,
  type BrainGameLevelEditorGetResult,
  type BrainGameLevelEditorState,
  type BrainGameScaffoldUnrealPayload
} from "@codex-forge/protocol/brain-game-runtime";
import type { RustCoreResponse } from "@codex-forge/protocol/rust-core";

export interface GameRuntimeRustClient {
  request(input: Record<string, unknown>): Promise<RustCoreResponse>;
  requestWithApproval(input: Record<string, unknown>): Promise<RustCoreResponse>;
}

export class GameRuntimeService {
  constructor(
    private readonly acquireRustCore: (binding: {
      projectId: string;
      projectRoot: string;
      workspaceType: "game";
    }) => Promise<GameRuntimeRustClient>
  ) {}

  private async invoke(
    binding: { projectId: string; projectRoot: string },
    operation: string,
    payload: Record<string, unknown>,
    approved: boolean
  ) {
    const client = await this.acquireRustCore({ ...binding, workspaceType: "game" });
    const base = {
      request_id: `game-${randomUUID()}`,
      project_id: binding.projectId,
      workspace_type: "game",
      operation,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload
    };
    const response = approved
      ? await client.requestWithApproval(base)
      : await client.request(base);
    if (response.status !== "completed") {
      throw new Error(response.error_code || "BRAIN_GAME_RUNTIME_FAILED");
    }
    return response.result;
  }

  inspect(binding: { projectId: string; projectRoot: string }, maxEntries = 4000): Promise<BrainGameInspectCoreResult> {
    return this.invoke(binding, brainGameCoreOperations.inspect, { max_entries: maxEntries }, false) as Promise<BrainGameInspectCoreResult>;
  }

  scaffoldWeb(binding: { projectId: string; projectRoot: string }) {
    return this.invoke(binding, brainGameCoreOperations.scaffoldWeb, {}, true);
  }

  async scaffoldUnreal(
    binding: { projectId: string; projectRoot: string },
    input: Omit<BrainGameScaffoldUnrealPayload, "sections"> & { sections?: BrainGameDesignSectionPayload[] }
  ) {
    const scaffolded = await this.invoke(binding, brainGameCoreOperations.scaffoldUnreal, {
      project_name: input.projectName,
      engine_association: input.engineAssociation ?? "5.4"
    }, true);
    if (input.runCook && input.sections?.length) {
      const cooked = await this.cook(binding, { sections: input.sections });
      return { ...scaffolded, ...cooked };
    }
    return scaffolded;
  }

  cook(binding: { projectId: string; projectRoot: string }, input: BrainGameCookPayload): Promise<BrainGameCookResult> {
    return this.invoke(binding, brainGameCoreOperations.cook, {
      sections: input.sections.map((section) => ({
        section_key: section.sectionKey,
        content: section.content,
        revision: section.revision
      })),
      project_name: input.projectName,
      engine_association: input.engineAssociation
    }, true) as Promise<BrainGameCookResult>;
  }

  levelEditorGet(binding: { projectId: string; projectRoot: string }): Promise<BrainGameLevelEditorGetResult> {
    return this.invoke(binding, brainGameCoreOperations.levelEditorGet, {}, false) as Promise<BrainGameLevelEditorGetResult>;
  }

  levelEditorSave(
    binding: { projectId: string; projectRoot: string },
    state: BrainGameLevelEditorState
  ): Promise<{ path: string; sha256: string; state: BrainGameLevelEditorState }> {
    return this.invoke(binding, brainGameCoreOperations.levelEditorSave, { state }, true) as Promise<{
      path: string;
      sha256: string;
      state: BrainGameLevelEditorState;
    }>;
  }

  spawnActor(
    binding: { projectId: string; projectRoot: string },
    input: { kind: "enemy" | "boss" | "npc"; levelIndex?: number }
  ) {
    return this.invoke(binding, brainGameCoreOperations.spawnActor, {
      kind: input.kind,
      level_index: input.levelIndex ?? 0
    }, true);
  }

  contentTree(binding: { projectId: string; projectRoot: string }, maxEntries = 500): Promise<BrainGameContentTreeResult> {
    return this.invoke(binding, brainGameCoreOperations.contentTree, { max_entries: maxEntries }, false) as Promise<BrainGameContentTreeResult>;
  }
}
