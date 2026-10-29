import { ipcMain } from "electron";

export interface ExpertMarketplaceIpcChannels {
  list: string;
  install: string;
  setEnabled: string;
  summon: string;
  clearSummon: string;
  getSummon: string;
  resolveFromSkill?: string;
  summonFromSkill?: string;
}

export interface ExpertMarketplaceIpcServices {
  list: () => unknown;
  install: (expertId: string) => unknown;
  setEnabled: (expertId: string, enabled: boolean) => unknown;
  summon: (threadId: string, expertId: string, userConfirmed?: boolean) => unknown;
  clearSummon: (threadId: string) => unknown;
  getSummon: (threadId: string) => unknown;
  resolveFromSkill?: (skillName: string, skillNames?: string[]) => unknown;
  summonFromSkill?: (threadId: string, skillName: string) => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(input: unknown, field: string) {
  if (!isRecord(input) || typeof input[field] !== "string" || !String(input[field]).trim()) {
    throw new TypeError(`${field} is required.`);
  }
  return String(input[field]).trim();
}

export function registerExpertMarketplaceIpcHandlers(
  channels: ExpertMarketplaceIpcChannels,
  services: ExpertMarketplaceIpcServices
) {
  ipcMain.handle(channels.list, () => services.list());
  ipcMain.handle(channels.install, (_event, input: unknown) => services.install(requireId(input, "expertId")));
  ipcMain.handle(channels.setEnabled, (_event, input: unknown) => {
    if (!isRecord(input) || typeof input.enabled !== "boolean") {
      throw new TypeError("enabled boolean is required.");
    }
    return services.setEnabled(requireId(input, "expertId"), input.enabled);
  });
  ipcMain.handle(channels.summon, (_event, input: unknown) =>
    services.summon(
      requireId(input, "threadId"),
      requireId(input, "expertId"),
      isRecord(input) && input.userConfirmed === true
    ));
  ipcMain.handle(channels.clearSummon, (_event, input: unknown) =>
    services.clearSummon(requireId(input, "threadId")));
  ipcMain.handle(channels.getSummon, (_event, input: unknown) =>
    services.getSummon(requireId(input, "threadId")));
  if (channels.resolveFromSkill && services.resolveFromSkill) {
    ipcMain.handle(channels.resolveFromSkill, (_event, input: unknown) => {
      const skillName = requireId(input, "skillName");
      const skillNames = isRecord(input) && Array.isArray(input.skillNames)
        ? input.skillNames.map((item) => String(item)).filter(Boolean)
        : undefined;
      return services.resolveFromSkill?.(skillName, skillNames);
    });
  }
  if (channels.summonFromSkill && services.summonFromSkill) {
    ipcMain.handle(channels.summonFromSkill, (_event, input: unknown) =>
      services.summonFromSkill?.(requireId(input, "threadId"), requireId(input, "skillName")));
  }
}
