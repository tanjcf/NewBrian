import { ipcMain } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";
import { CustomModelEndpointError, normalizeCustomModelEndpointDraft } from "../shared/custom-model-endpoint.ts";
import type { CustomModelEndpointStore } from "./custom-model-endpoint-store.ts";

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_INVALID", "自备模型参数无效。");
  }
  return value as Record<string, unknown>;
}

/** Registers the renderer API for user-owned model endpoints. Secrets never return. */
export function registerCustomModelEndpointIpc(store: CustomModelEndpointStore) {
  ipcMain.handle(desktopIpcChannels.customModels.list, () => store.list());
  ipcMain.handle(desktopIpcChannels.customModels.save, (_event, input: unknown) => {
    const draft = record(input);
    return store.save(normalizeCustomModelEndpointDraft({
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      model: draft.model
    }));
  });
  ipcMain.handle(desktopIpcChannels.customModels.delete, (_event, input: unknown) => {
    const id = record(input).id;
    if (typeof id !== "string") throw new CustomModelEndpointError("CUSTOM_MODEL_NOT_FOUND", "自备模型不存在或已被删除。");
    return store.delete(id);
  });
  ipcMain.handle(desktopIpcChannels.customModels.select, (_event, input: unknown) => {
    const id = record(input).id;
    if (typeof id !== "string") throw new CustomModelEndpointError("CUSTOM_MODEL_NOT_FOUND", "自备模型不存在或已被删除。");
    return store.select(id);
  });
}
