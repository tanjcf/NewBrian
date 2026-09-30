import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type OpenClawSkillExportZipInput,
  type OpenClawSkillInstallClawHubInput,
  type OpenClawSkillInstallPathInput,
  type OpenClawSkillInspectPathInput,
  type OpenClawSkillSearchInput,
  type OpenClawSkillSelectInstallInput,
  type UninstallWritingSkillsInput
} from "@codex-forge/protocol";

interface OpenClawSkillIpcServices {
  search: (query: string, limit?: number) => unknown;
  installClawHub: (input: OpenClawSkillInstallClawHubInput) => unknown;
  installPath: (input: OpenClawSkillInstallPathInput) => unknown;
  selectAndInstall: (input: OpenClawSkillSelectInstallInput) => unknown;
  inspectPath: (path: string) => unknown;
  exportZip: (input: OpenClawSkillExportZipInput) => unknown;
  uninstallWritingSkills: (input: UninstallWritingSkillsInput) => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSearch(input: unknown): OpenClawSkillSearchInput {
  if (input == null) return { query: "*", limit: 20 };
  if (!isRecord(input)) throw new TypeError("OpenClaw skill search input is invalid.");
  if (input.query !== undefined && typeof input.query !== "string") throw new TypeError("query must be a string.");
  if (input.limit !== undefined && typeof input.limit !== "number") throw new TypeError("limit must be a number.");
  return { query: input.query, limit: input.limit };
}

function parseClawHubInstall(input: unknown): OpenClawSkillInstallClawHubInput {
  if (!isRecord(input) || typeof input.ref !== "string" || !input.ref.trim()) {
    throw new TypeError("OpenClaw ClawHub install requires ref.");
  }
  return {
    ref: input.ref.trim(),
    force: input.force === true,
    acknowledgeRisk: input.acknowledgeRisk === true,
    forceInstall: input.forceInstall === true
  };
}

function parsePathInstall(input: unknown): OpenClawSkillInstallPathInput {
  if (!isRecord(input) || typeof input.path !== "string" || !input.path.trim()) {
    throw new TypeError("OpenClaw path install requires path.");
  }
  return {
    path: input.path.trim(),
    force: input.force === true,
    acknowledgeRisk: input.acknowledgeRisk === true
  };
}

function parseSelectInstall(input: unknown): OpenClawSkillSelectInstallInput {
  if (input == null) return {};
  if (!isRecord(input)) throw new TypeError("OpenClaw select-install input is invalid.");
  return {
    force: input.force === true,
    acknowledgeRisk: input.acknowledgeRisk === true
  };
}

function parseInspect(input: unknown): OpenClawSkillInspectPathInput {
  if (!isRecord(input) || typeof input.path !== "string" || !input.path.trim()) {
    throw new TypeError("OpenClaw inspect requires path.");
  }
  return { path: input.path.trim() };
}

function parseExportZip(input: unknown): OpenClawSkillExportZipInput {
  if (input == null) return {};
  if (!isRecord(input)) throw new TypeError("OpenClaw skill zip export input is invalid.");
  if (input.skillId !== undefined && typeof input.skillId !== "string") {
    throw new TypeError("skillId must be a string.");
  }
  if (input.skillName !== undefined && typeof input.skillName !== "string") {
    throw new TypeError("skillName must be a string.");
  }
  if (input.destinationPath !== undefined && typeof input.destinationPath !== "string") {
    throw new TypeError("destinationPath must be a string.");
  }
  return {
    skillId: input.skillId,
    skillName: input.skillName,
    destinationPath: input.destinationPath
  };
}

function parseUninstallWriting(input: unknown): UninstallWritingSkillsInput {
  if (input == null) return {};
  if (!isRecord(input)) throw new TypeError("Uninstall writing skills input is invalid.");
  if (
    input.extraNames !== undefined
    && (!Array.isArray(input.extraNames) || !input.extraNames.every((item) => typeof item === "string"))
  ) {
    throw new TypeError("extraNames must be a string array.");
  }
  return { extraNames: input.extraNames as string[] | undefined };
}

/** Register ClawHub / OpenClaw skill install IPC channels. */
export function registerOpenClawSkillIpcHandlers(services: OpenClawSkillIpcServices) {
  const channels = desktopIpcChannels.openclawSkills;
  ipcMain.handle(channels.search, (_event, input: unknown) => {
    const parsed = parseSearch(input);
    return services.search(parsed.query || "*", parsed.limit);
  });
  ipcMain.handle(channels.installClawHub, (_event, input: unknown) => {
    return services.installClawHub(parseClawHubInstall(input));
  });
  ipcMain.handle(channels.installPath, (_event, input: unknown) => {
    return services.installPath(parsePathInstall(input));
  });
  ipcMain.handle(channels.selectAndInstall, (_event, input: unknown) => {
    return services.selectAndInstall(parseSelectInstall(input));
  });
  ipcMain.handle(channels.inspectPath, (_event, input: unknown) => {
    return services.inspectPath(parseInspect(input).path);
  });
  ipcMain.handle(channels.exportZip, (_event, input: unknown) => {
    return services.exportZip(parseExportZip(input));
  });
  ipcMain.handle(channels.uninstallWritingSkills, (_event, input: unknown) => {
    return services.uninstallWritingSkills(parseUninstallWriting(input));
  });
}
