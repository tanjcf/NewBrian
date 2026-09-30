import {
  GrowthControlPlaneService,
  readGrowthEnabledFromCapabilities,
  type GrowthConnection
} from "./growth-control-plane-service.ts";
import { GrowthHostService } from "./growth-host-service.ts";
import { registerGrowthIpc } from "./growth-ipc.ts";

export type GrowthCompositionDeps = {
  getConnection: () => Promise<GrowthConnection>;
  refreshConnection?: () => Promise<GrowthConnection>;
  readCapabilities?: () => Promise<Record<string, unknown> | null | undefined>;
  isLocallyEnabled?: () => boolean;
  startHost?: boolean;
  leaseOwner?: string;
  intervalMs?: number;
  onHostError?: (error: unknown) => void;
};

/**
 * Wire Growth control-plane client, Host poller, and IPC handlers.
 */
export function registerGrowthComposition(deps: GrowthCompositionDeps) {
  const client = new GrowthControlPlaneService({
    getConnection: deps.getConnection,
    refreshConnection: deps.refreshConnection
  });
  const host = new GrowthHostService({
    client,
    leaseOwner: deps.leaseOwner,
    intervalMs: deps.intervalMs,
    isLocallyEnabled: deps.isLocallyEnabled,
    readCapabilities: deps.readCapabilities,
    onError: deps.onHostError
  });
  registerGrowthIpc({
    listInstances: (limit) => client.listInstances(limit),
    listHumanTasks: (input) => client.listHumanTasks(input?.status, input?.limit),
    completeHumanTask: (input) => client.completeHumanCallback(input.token, input.result ?? {}),
    publishSkill: (input) => client.publishSkill(input.skillId),
    listSkills: (input) => client.listSkills(input?.tier, input?.limit),
    upsertMemory: (input) => client.upsertMemory(input),
    listConnectors: (limit) => client.listConnectors(limit),
    solidifyConnector: (input) =>
      client.solidifyConnector(input.connectorId, input.publishCompany !== false),
    listTemplates: async () => ({ items: await client.listTemplates() }),
    importTemplate: (input) => client.importTemplate(input.templateId, input.name),
    completeAsyncWebhook: (input) =>
      client.completeAsyncWebhook(input.connectorId, input.body ?? {}),
    runtimeStatus: () => client.getRuntimeStatus(),
    setKillSwitch: (input) => client.setKillSwitch(input.enabled, input.reason),
    listRuntimeAudits: async (input) => ({
      items: await client.listRuntimeAudits(input?.limit)
    }),
    caseAsyncHumanDemo: (input) => client.runCaseAsyncHumanDemo(input?.templateId)
  });
  if (deps.startHost !== false) {
    host.start();
  }
  return { client, host, readGrowthEnabledFromCapabilities };
}
