import { randomUUID } from "node:crypto";
import {
  brainDataCoreOperations,
  type BrainDataAnalysisState
} from "@codex-forge/protocol/brain-data-runtime";
import type { RustCoreResponse } from "@codex-forge/protocol/rust-core";

export interface DataRuntimeRustClient {
  request(input: Record<string, unknown>): Promise<RustCoreResponse>;
  requestWithApproval(input: Record<string, unknown>): Promise<RustCoreResponse>;
}

type Binding = { projectId: string; projectRoot: string };

export class DataRuntimeService {
  constructor(
    private readonly acquireRustCore: (
      binding: Binding & { workspaceType: "data" }
    ) => Promise<DataRuntimeRustClient>
  ) {}

  private async invoke(binding: Binding, operation: string, payload: Record<string, unknown>, approved: boolean) {
    const client = await this.acquireRustCore({ ...binding, workspaceType: "data" });
    const request = {
      request_id: `data-${randomUUID()}`,
      project_id: binding.projectId,
      workspace_type: "data",
      operation,
      resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 },
      payload
    };
    const response = approved
      ? await client.requestWithApproval(request)
      : await client.request(request);
    if (response.status !== "completed") {
      throw new Error(response.error_code || "BRAIN_DATA_RUNTIME_FAILED");
    }
    return response.result;
  }

  analysisGet(binding: Binding) {
    return this.invoke(binding, brainDataCoreOperations.analysisGet, {}, false);
  }

  analysisSave(binding: Binding, state: BrainDataAnalysisState) {
    return this.invoke(binding, brainDataCoreOperations.analysisSave, { state }, true);
  }

  cook(binding: Binding, state?: BrainDataAnalysisState) {
    return this.invoke(binding, brainDataCoreOperations.cook, state ? { state } : {}, true);
  }
}
