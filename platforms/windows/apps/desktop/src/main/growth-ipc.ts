import { ipcMain } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";

export type GrowthIpcServices = {
  listInstances: (limit?: number) => Promise<Record<string, unknown>>;
  listHumanTasks: (input?: { status?: string; limit?: number }) => Promise<Record<string, unknown>>;
  completeHumanTask: (input: { token: string; result?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  publishSkill: (input: { skillId: string }) => Promise<Record<string, unknown>>;
  listSkills: (input?: { tier?: string; limit?: number }) => Promise<Record<string, unknown>>;
  upsertMemory: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listConnectors: (limit?: number) => Promise<Record<string, unknown>>;
  solidifyConnector: (input: { connectorId: string; publishCompany?: boolean }) => Promise<Record<string, unknown>>;
  listTemplates: () => Promise<{ items: Array<Record<string, unknown>> }>;
  importTemplate: (input: { templateId: string; name?: string }) => Promise<Record<string, unknown>>;
  completeAsyncWebhook: (input: {
    connectorId: string;
    body?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  runtimeStatus: () => Promise<Record<string, unknown>>;
  setKillSwitch: (input: { enabled: boolean; reason?: string }) => Promise<Record<string, unknown>>;
  listRuntimeAudits: (input?: { limit?: number }) => Promise<{ items: Array<Record<string, unknown>> }>;
  caseAsyncHumanDemo: (input?: { templateId?: string }) => Promise<Record<string, unknown>>;
};

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

/**
 * Register Growth Worker projection IPC (handbook §7.4 + G3–G6).
 */
export function registerGrowthIpc(services: GrowthIpcServices): void {
  ipcMain.handle(desktopIpcChannels.growth.listInstances, (_event, input?: unknown) => {
    const limit = Number(asRecord(input).limit);
    return services.listInstances(Number.isFinite(limit) ? limit : undefined);
  });
  ipcMain.handle(desktopIpcChannels.growth.listHumanTasks, (_event, input?: unknown) => {
    const body = asRecord(input);
    const status = typeof body.status === "string" ? body.status : undefined;
    const limit = Number(body.limit);
    return services.listHumanTasks({
      status,
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });
  ipcMain.handle(desktopIpcChannels.growth.completeHumanTask, (_event, input?: unknown) => {
    const body = asRecord(input);
    const token = String(body.token || "").trim();
    if (!token) throw new Error("GROWTH_TOKEN_REQUIRED");
    const result = body.result && typeof body.result === "object" && !Array.isArray(body.result)
      ? body.result as Record<string, unknown>
      : {};
    return services.completeHumanTask({ token, result });
  });
  ipcMain.handle(desktopIpcChannels.growth.publishSkill, (_event, input?: unknown) => {
    const skillId = String(asRecord(input).skillId || asRecord(input).skill_id || "").trim();
    if (!skillId) throw new Error("GROWTH_SKILL_ID_REQUIRED");
    return services.publishSkill({ skillId });
  });
  ipcMain.handle(desktopIpcChannels.growth.listSkills, (_event, input?: unknown) => {
    const body = asRecord(input);
    const tier = typeof body.tier === "string" ? body.tier : undefined;
    const limit = Number(body.limit);
    return services.listSkills({
      tier,
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });
  ipcMain.handle(desktopIpcChannels.growth.upsertMemory, (_event, input?: unknown) => {
    return services.upsertMemory(asRecord(input));
  });
  ipcMain.handle(desktopIpcChannels.growth.listConnectors, (_event, input?: unknown) => {
    const limit = Number(asRecord(input).limit);
    return services.listConnectors(Number.isFinite(limit) ? limit : undefined);
  });
  ipcMain.handle(desktopIpcChannels.growth.solidifyConnector, (_event, input?: unknown) => {
    const body = asRecord(input);
    const connectorId = String(body.connectorId || body.connector_id || "").trim();
    if (!connectorId) throw new Error("GROWTH_CONNECTOR_ID_REQUIRED");
    const publishCompany = body.publishCompany !== false && body.publish_company !== false;
    return services.solidifyConnector({ connectorId, publishCompany });
  });
  ipcMain.handle(desktopIpcChannels.growth.listTemplates, () => services.listTemplates());
  ipcMain.handle(desktopIpcChannels.growth.importTemplate, (_event, input?: unknown) => {
    const body = asRecord(input);
    const templateId = String(body.templateId || body.template_id || "").trim();
    if (!templateId) throw new Error("GROWTH_TEMPLATE_ID_REQUIRED");
    const name = typeof body.name === "string" ? body.name : undefined;
    return services.importTemplate({ templateId, name });
  });
  ipcMain.handle(desktopIpcChannels.growth.completeAsyncWebhook, (_event, input?: unknown) => {
    const body = asRecord(input);
    const connectorId = String(body.connectorId || body.connector_id || "").trim();
    if (!connectorId) throw new Error("GROWTH_CONNECTOR_ID_REQUIRED");
    const payload = body.body && typeof body.body === "object" && !Array.isArray(body.body)
      ? body.body as Record<string, unknown>
      : body;
    return services.completeAsyncWebhook({ connectorId, body: payload });
  });
  ipcMain.handle(desktopIpcChannels.growth.runtimeStatus, () => services.runtimeStatus());
  ipcMain.handle(desktopIpcChannels.growth.setKillSwitch, (_event, input?: unknown) => {
    const body = asRecord(input);
    const enabled = body.enabled === true || body.enabled === "true";
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    return services.setKillSwitch({ enabled, reason });
  });
  ipcMain.handle(desktopIpcChannels.growth.listRuntimeAudits, (_event, input?: unknown) => {
    const limit = Number(asRecord(input).limit);
    return services.listRuntimeAudits({
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });
  ipcMain.handle(desktopIpcChannels.growth.caseAsyncHumanDemo, (_event, input?: unknown) => {
    const templateId = String(asRecord(input).templateId || asRecord(input).template_id || "").trim();
    return services.caseAsyncHumanDemo({
      templateId: templateId || undefined
    });
  });
}
