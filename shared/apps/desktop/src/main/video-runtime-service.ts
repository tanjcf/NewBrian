import { randomUUID } from "node:crypto";
import {
  brainVideoCoreOperations,
  type BrainVideoCookPayload,
  type BrainVideoCookResult,
  type BrainVideoPipelineState
} from "@codex-forge/protocol/brain-video-runtime";
import type { RustCoreResponse } from "@codex-forge/protocol/rust-core";

export interface VideoRuntimeRustClient {
  request(input: Record<string, unknown>): Promise<RustCoreResponse>;
  requestWithApproval(input: Record<string, unknown>): Promise<RustCoreResponse>;
}

type Binding = { projectId: string; projectRoot: string };

export class VideoRuntimeService {
  constructor(
    private readonly acquireRustCore: (
      binding: Binding & { workspaceType: "video" }
    ) => Promise<VideoRuntimeRustClient>
  ) {}

  private async invoke(binding: Binding, operation: string, payload: Record<string, unknown>, approved: boolean) {
    const client = await this.acquireRustCore({ ...binding, workspaceType: "video" });
    const request = {
      request_id: `video-${randomUUID()}`,
      project_id: binding.projectId,
      workspace_type: "video",
      operation,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload
    };
    const response = approved
      ? await client.requestWithApproval(request)
      : await client.request(request);
    if (response.status !== "completed") {
      throw new Error(response.error_code || "BRAIN_VIDEO_RUNTIME_FAILED");
    }
    return response.result;
  }

  pipelineGet(binding: Binding) {
    return this.invoke(binding, brainVideoCoreOperations.pipelineGet, {}, false);
  }

  pipelineSave(binding: Binding, state: BrainVideoPipelineState) {
    return this.invoke(binding, brainVideoCoreOperations.pipelineSave, { state }, true);
  }

  markShot(binding: Binding, shotIndex: number, ready: boolean) {
    return this.invoke(binding, brainVideoCoreOperations.markShot, {
      shot_index: shotIndex,
      ready
    }, true);
  }

  cook(binding: Binding, payload: BrainVideoCookPayload = {}): Promise<BrainVideoCookResult> {
    return this.invoke(binding, brainVideoCoreOperations.cook, { ...payload }, true) as Promise<BrainVideoCookResult>;
  }
}
