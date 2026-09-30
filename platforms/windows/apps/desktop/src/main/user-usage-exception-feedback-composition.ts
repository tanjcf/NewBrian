import { randomUUID } from "node:crypto";
import { app } from "electron";
import { resolveElectronAppVersion } from "./resolve-app-version.js";
import type { ModelConfig } from "@codex-forge/protocol";
import { UserUsageExceptionFeedbackService, type TrustedUsageExceptionContext } from "./user-usage-exception-feedback-service.js";
import { registerUserUsageExceptionFeedbackIpc } from "./user-usage-exception-feedback-ipc.js";
import { readTextWithTransientRetry } from "./atomic-file.js";

interface UsageExceptionFeedbackCompositionDeps {
  readWorkspaceCatalog: () => Promise<any>;
  requireWorkspaceThreadSelection: (workspaces: any[], workspaceId: string, threadId: string) => { workspace: any; thread: any };
  readThreadState: (workspace: any, thread: any) => Promise<{ messages: TrustedUsageExceptionContext["messages"] }>;
  desktopDiagnosticsLogPath: string;
  desktopDebugLogPath: string;
  collectDesktopDeviceFingerprint: () => { device_id: string };
  readDesktopAuthState: () => Promise<{ user?: { id?: string; email?: string } } | null>;
  collectDesktopErrorEnvironment: () => Record<string, unknown>;
  readAuthorizedDesktopModelConfig: (candidate?: Partial<ModelConfig>) => Promise<ModelConfig>;
  callModelApi: (input: any) => Promise<{ content: string }>;
  reportUsageExceptionFailure: (failure: any) => Promise<{
    capture?: unknown;
    flush?: unknown;
  }>;
}

export function registerUsageExceptionFeedbackComposition(deps: UsageExceptionFeedbackCompositionDeps) {
  const usageExceptionFeedbackService = new UserUsageExceptionFeedbackService({
    now: () => new Date(),
    makeId: () => `usage-feedback-${randomUUID()}`,
    readTrustedContext: async (input) => {
      const catalog = await deps.readWorkspaceCatalog();
      const { workspace, thread } = deps.requireWorkspaceThreadSelection(
        catalog.workspaces,
        input.workspaceId,
        input.threadId
      );
      const state = await deps.readThreadState(workspace, thread);
      const [diagnostics, debugLog] = await Promise.all([
        readTextWithTransientRetry(deps.desktopDiagnosticsLogPath).catch(() => ""),
        readTextWithTransientRetry(deps.desktopDebugLogPath).catch(() => "")
      ]);
      const device = deps.collectDesktopDeviceFingerprint();
      const authState = await deps.readDesktopAuthState();
      return {
        messages: state.messages,
        environment: deps.collectDesktopErrorEnvironment(),
        diagnostics: `${diagnostics.slice(-8_000)}\n${debugLog.slice(-8_000)}`.trim(),
        stackTrace: "",
        deviceId: device.device_id,
        appVersion: resolveElectronAppVersion(app),
        ownerKey: String(authState?.user?.id || authState?.user?.email || `device:${device.device_id}`)
      };
    },
    analyze: async (prompt) => {
      const config = await deps.readAuthorizedDesktopModelConfig();
      const result = await deps.callModelApi({
        ...config,
        disableResponseStorage: true,
        systemPrompt: "你是 NewBrain 异常归因分析器。只返回请求要求的 JSON，不执行工具。",
        messages: [{ role: "user", content: prompt }]
      });
      return result.content;
    },
    report: async (failure) => {
      const result = await deps.reportUsageExceptionFailure(failure);
      const capture = result.capture as { id?: string } | undefined;
      const flush = result.flush as { failed?: number } | undefined;
      if (!capture?.id) throw new Error("Usage exception feedback was not persisted.");
      return {
        localReportId: capture.id,
        delivery: flush && Number(flush.failed ?? 0) === 0 ? "uploaded" as const : "queued" as const
      };
    },
    getCurrentOwnerKey: async () => {
      const authState = await deps.readDesktopAuthState();
      const device = deps.collectDesktopDeviceFingerprint();
      return String(authState?.user?.id || authState?.user?.email || `device:${device.device_id}`);
    }
  });
  registerUserUsageExceptionFeedbackIpc({
    createPreview: (input) => usageExceptionFeedbackService.createPreview(input),
    confirm: (input) => usageExceptionFeedbackService.confirm(input)
  });
}
