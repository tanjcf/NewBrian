import { ipcMain } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";

export type DeliveryPreferenceClearScope = "thread" | "project" | "both";

export interface DeliveryPreferenceUiState {
  visible: boolean;
  hasStyle: boolean;
  scope: "thread" | "project" | null;
  scopeLabel: string;
  summary: string;
  values: Record<string, unknown>;
  canClear: boolean;
  canPin: boolean;
  canUnpin: boolean;
  styleGapQuestion: string;
}

type MaybePromise<T> = T | Promise<T>;

export interface DeliveryPreferencesIpcServices {
  get: () => MaybePromise<DeliveryPreferenceUiState>;
  clear: (scope: DeliveryPreferenceClearScope) => MaybePromise<DeliveryPreferenceUiState>;
  pin: () => MaybePromise<DeliveryPreferenceUiState>;
}

function parseClearScope(input: unknown): DeliveryPreferenceClearScope {
  const scope = typeof input === "string"
    ? input
    : (input && typeof input === "object" && "scope" in input
      ? String((input as { scope?: unknown }).scope || "")
      : "both");
  if (scope === "thread" || scope === "project" || scope === "both") return scope;
  return "both";
}

/** Registers Delivery Preference OS UI controls (get / clear / pin). */
export function registerDeliveryPreferencesIpcHandlers(services: DeliveryPreferencesIpcServices) {
  const channels = (desktopIpcChannels as { deliveryPreferences?: { get: string; clear: string; pin: string } })
    .deliveryPreferences;
  if (!channels?.get || !channels.clear || !channels.pin) {
    throw new Error("desktopIpcChannels.deliveryPreferences is required.");
  }
  ipcMain.handle(channels.get, () => services.get());
  ipcMain.handle(channels.clear, (_event, input: unknown) => services.clear(parseClearScope(input)));
  ipcMain.handle(channels.pin, () => services.pin());
}
