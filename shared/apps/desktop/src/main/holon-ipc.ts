import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type HolonFeedbackInput,
  type HolonKnowledgeSnapshotInput,
  type HolonKnowledgeSnapshot,
  type HolonSyncStatus,
  type HolonWorkItemView,
  type HolonWorkItemIdInput,
  type StartHolonWorkItemInput
} from "@codex-forge/protocol";
import {
  parseHolonFeedbackInput,
  parseHolonKnowledgeSnapshotInput,
  parseHolonWorkItemIdInput,
  parseStartHolonWorkItemInput
} from "./holon-ipc-contract.js";

type MaybePromise<T> = T | Promise<T>;
export interface HolonIpcServices {
  getNextWorkItem: () => MaybePromise<HolonWorkItemView | null>;
  startWorkItem: (input: StartHolonWorkItemInput) => MaybePromise<HolonWorkItemView>;
  cancelWorkItem: (input: HolonWorkItemIdInput) => MaybePromise<HolonWorkItemView | null>;
  getWorkItemState: (input: HolonWorkItemIdInput) => MaybePromise<HolonWorkItemView | null>;
  getKnowledgeSnapshot: (input: HolonKnowledgeSnapshotInput) => MaybePromise<HolonKnowledgeSnapshot>;
  getSyncStatus: () => MaybePromise<HolonSyncStatus>;
  submitFeedback: (input: HolonFeedbackInput) => MaybePromise<Record<string, unknown>>;
}

export function registerHolonIpcHandlers(services: HolonIpcServices) {
  ipcMain.handle(desktopIpcChannels.holon.getNextWorkItem, () => services.getNextWorkItem());
  ipcMain.handle(desktopIpcChannels.holon.startWorkItem, (_event, value: unknown) => {
    const input = parseStartHolonWorkItemInput(value);
    return services.startWorkItem(input);
  });
  ipcMain.handle(desktopIpcChannels.holon.cancelWorkItem, (_event, value: unknown) =>
    services.cancelWorkItem(parseHolonWorkItemIdInput(value)));
  ipcMain.handle(desktopIpcChannels.holon.getWorkItemState, (_event, value: unknown) =>
    services.getWorkItemState(parseHolonWorkItemIdInput(value)));
  ipcMain.handle(desktopIpcChannels.holon.getKnowledgeSnapshot, (_event, value: unknown) =>
    services.getKnowledgeSnapshot(parseHolonKnowledgeSnapshotInput(value)));
  ipcMain.handle(desktopIpcChannels.holon.getSyncStatus, () => services.getSyncStatus());
  ipcMain.handle(desktopIpcChannels.holon.submitFeedback, (_event, value: unknown) =>
    services.submitFeedback(parseHolonFeedbackInput(value)));
}
