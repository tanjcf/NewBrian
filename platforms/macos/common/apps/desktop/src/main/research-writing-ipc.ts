import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type ResearchWritingExportInput,
  type ResearchWritingIntakeInput,
  type ResearchWritingPayload
} from "@codex-forge/protocol";
import {
  parseResearchWritingExportInput,
  parseResearchWritingIntakeInput,
  parseResearchWritingPayload
} from "./research-writing-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface ResearchWritingIpcServices {
  generateIntake: (input: ResearchWritingIntakeInput) => MaybePromise<unknown>;
  review: (payload: ResearchWritingPayload) => MaybePromise<unknown>;
  export: (input: ResearchWritingExportInput) => MaybePromise<unknown>;
}

/** Registers the validated research-writing IPC boundary. */
export function registerResearchWritingIpcHandlers(services: ResearchWritingIpcServices) {
  ipcMain.handle(desktopIpcChannels.researchWriting.generateIntake, (_event, input: unknown) =>
    services.generateIntake(parseResearchWritingIntakeInput(input)));
  ipcMain.handle(desktopIpcChannels.researchWriting.review, (_event, payload: unknown) =>
    services.review(parseResearchWritingPayload(payload)));
  ipcMain.handle(desktopIpcChannels.researchWriting.export, (_event, input: unknown) =>
    services.export(parseResearchWritingExportInput(input)));
}
