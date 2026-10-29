import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type AddFeatureItemInput,
  type DeleteFeatureItemInput,
  type FeatureConfigPayload,
  type FeatureItemInput,
  type ManagedFeatureKind,
  type UpdateFeatureItemInput
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;
interface FeaturesIpcServices {
  getConfig: () => MaybePromise<FeatureConfigPayload>;
  addItem: (input: AddFeatureItemInput) => MaybePromise<FeatureConfigPayload>;
  updateItem: (input: UpdateFeatureItemInput) => MaybePromise<FeatureConfigPayload>;
  deleteItem: (input: DeleteFeatureItemInput) => MaybePromise<FeatureConfigPayload>;
}

const optionalStringFields = [
  "id", "name", "summary", "version", "source", "manifestPath", "path", "icon", "scope",
  "publisher", "title", "trigger", "status", "workspaceId", "threadId", "action", "intervalMinutes", "dailyTime",
  "prompt", "schedule", "runtime", "model", "reasoning", "rrule", "permissionMode"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureKind(value: unknown): value is ManagedFeatureKind {
  return value === "skills" || value === "plugins" || value === "automations";
}

function parseFeatureItem(input: unknown): FeatureItemInput {
  if (!isRecord(input)
    || optionalStringFields.some((field) => input[field] !== undefined && typeof input[field] !== "string")
    || (input.capabilities !== undefined
      && typeof input.capabilities !== "string"
      && (!Array.isArray(input.capabilities) || !input.capabilities.every((item) => typeof item === "string")))) {
    throw new TypeError("Feature item payload is invalid.");
  }
  return input;
}

function parseAddInput(input: unknown): AddFeatureItemInput {
  if (!isRecord(input) || !isFeatureKind(input.kind)) throw new TypeError("Add feature input is invalid.");
  return { kind: input.kind, item: parseFeatureItem(input.item) };
}

function parseUpdateInput(input: unknown): UpdateFeatureItemInput {
  const parsed = parseAddInput(input);
  if (!isRecord(input) || typeof input.id !== "string") throw new TypeError("Update feature input is invalid.");
  return { ...parsed, id: input.id };
}

function parseDeleteInput(input: unknown): DeleteFeatureItemInput {
  if (!isRecord(input) || !isFeatureKind(input.kind) || typeof input.id !== "string") {
    throw new TypeError("Delete feature input is invalid.");
  }
  return { kind: input.kind, id: input.id };
}

/** Register feature-catalog IPC with validation before configuration side effects. */
export function registerFeaturesIpcHandlers(services: FeaturesIpcServices) {
  ipcMain.handle(desktopIpcChannels.features.getConfig, () => services.getConfig());
  ipcMain.handle(desktopIpcChannels.features.addItem, (_event, input: unknown) => services.addItem(parseAddInput(input)));
  ipcMain.handle(desktopIpcChannels.features.updateItem, (_event, input: unknown) => services.updateItem(parseUpdateInput(input)));
  ipcMain.handle(desktopIpcChannels.features.deleteItem, (_event, input: unknown) => services.deleteItem(parseDeleteInput(input)));
}
