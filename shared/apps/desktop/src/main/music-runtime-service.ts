import { randomUUID } from "node:crypto";
import {
  brainMusicCoreOperations,
  type BrainMusicDawState
} from "@codex-forge/protocol/brain-music-runtime";
import type { RustCoreResponse } from "@codex-forge/protocol/rust-core";

export interface MusicRuntimeRustClient {
  request(input: Record<string, unknown>): Promise<RustCoreResponse>;
  requestWithApproval(input: Record<string, unknown>): Promise<RustCoreResponse>;
}

type Binding = { projectId: string; projectRoot: string };

export class MusicRuntimeService {
  constructor(
    private readonly acquireRustCore: (
      binding: Binding & { workspaceType: "music" }
    ) => Promise<MusicRuntimeRustClient>
  ) {}

  private async invoke(binding: Binding, operation: string, payload: Record<string, unknown>, approved: boolean) {
    const client = await this.acquireRustCore({ ...binding, workspaceType: "music" });
    const request = {
      request_id: `music-${randomUUID()}`,
      project_id: binding.projectId,
      workspace_type: "music",
      operation,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload
    };
    const response = approved
      ? await client.requestWithApproval(request)
      : await client.request(request);
    if (response.status !== "completed") {
      throw new Error(response.error_code || "BRAIN_MUSIC_RUNTIME_FAILED");
    }
    return response.result;
  }

  dawGet(binding: Binding) {
    return this.invoke(binding, brainMusicCoreOperations.dawGet, {}, false);
  }

  dawSave(binding: Binding, state: BrainMusicDawState) {
    return this.invoke(binding, brainMusicCoreOperations.dawSave, { state }, true);
  }

  cook(binding: Binding, state?: BrainMusicDawState) {
    return this.invoke(binding, brainMusicCoreOperations.cook, state ? { state } : {}, true);
  }
}
