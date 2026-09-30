import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type ListDelegatedAgentsInput,
  type MergeDelegatedAgentResultsInput,
  type RespondDelegatedAgentApprovalInput,
  type RunDelegatedAgentInput
} from "@codex-forge/protocol";
import {
  parseListDelegatedAgentsInput,
  parseMergeDelegatedAgentResultsInput,
  parseRespondDelegatedAgentApprovalInput,
  parseRunDelegatedAgentInput
} from "./collaboration-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface CollaborationIpcServices {
  run: (input: RunDelegatedAgentInput) => MaybePromise<unknown>;
  list: (input: ListDelegatedAgentsInput) => MaybePromise<unknown>;
  respondApproval: (input: RespondDelegatedAgentApprovalInput) => MaybePromise<unknown>;
  mergeResults: (input: MergeDelegatedAgentResultsInput) => MaybePromise<unknown>;
}

/** Registers delegated-agent operations behind validated collaboration contracts. */
export function registerCollaborationIpcHandlers(services: CollaborationIpcServices) {
  ipcMain.handle(desktopIpcChannels.collaboration.run, (_event, input: unknown) =>
    services.run(parseRunDelegatedAgentInput(input)));
  ipcMain.handle(desktopIpcChannels.collaboration.list, (_event, input: unknown) =>
    services.list(parseListDelegatedAgentsInput(input)));
  ipcMain.handle(desktopIpcChannels.collaboration.respondApproval, (_event, input: unknown) =>
    services.respondApproval(parseRespondDelegatedAgentApprovalInput(input)));
  ipcMain.handle(desktopIpcChannels.collaboration.mergeResults, (_event, input: unknown) =>
    services.mergeResults(parseMergeDelegatedAgentResultsInput(input)));
}
