import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type ComposerAttachment,
  type OpenComposerAttachmentInput,
  type SaveComposerClipboardFileInput
} from "@codex-forge/protocol";
import {
  parseOpenComposerAttachmentInput,
  parseSaveComposerClipboardFileInput
} from "./composer-contract.js";
import type { ComposerAttachmentSelectionResult } from "./composer-attachment-service.js";

type MaybePromise<T> = T | Promise<T>;

interface ComposerIpcServices {
  selectAttachments: () => MaybePromise<ComposerAttachmentSelectionResult>;
  openAttachment: (input: OpenComposerAttachmentInput) => MaybePromise<{ ok: boolean; detail: string }>;
  saveClipboardFile: (input: SaveComposerClipboardFileInput) => MaybePromise<ComposerAttachment>;
}

/** Registers composer file capabilities behind validated, narrow contracts. */
export function registerComposerIpcHandlers(services: ComposerIpcServices) {
  ipcMain.handle(desktopIpcChannels.composer.selectImages, () => services.selectAttachments());
  ipcMain.handle(desktopIpcChannels.composer.openAttachment, (_event, input: unknown) =>
    services.openAttachment(parseOpenComposerAttachmentInput(input)));
  ipcMain.handle(desktopIpcChannels.composer.saveClipboardFile, (_event, input: unknown) =>
    services.saveClipboardFile(parseSaveComposerClipboardFileInput(input)));
}
