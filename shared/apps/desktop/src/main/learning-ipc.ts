import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type HolonKnowledgeSearchResult,
  type HolonLearningCandidate,
  type LearningCandidateInput,
  type LearningRollbackInput,
  type LearningSearchInput
} from "@codex-forge/protocol";
import {
  parseLearningCandidateInput,
  parseLearningListInput,
  parseLearningRollbackInput,
  parseLearningSearchInput
} from "./holon-ipc-contract.js";

type MaybePromise<T> = T | Promise<T>;
export interface LearningIpcServices {
  listCandidates: (limit: number) => MaybePromise<HolonLearningCandidate[]>;
  searchPrivateKnowledge: (input: Required<LearningSearchInput>) => MaybePromise<HolonKnowledgeSearchResult[]>;
  approveCandidate: (input: LearningCandidateInput) => MaybePromise<Record<string, unknown>>;
  rejectCandidate: (input: LearningCandidateInput) => MaybePromise<Record<string, unknown>>;
  rollbackPrivateSkill: (input: LearningRollbackInput) => MaybePromise<Record<string, unknown>>;
}

export function registerLearningIpcHandlers(services: LearningIpcServices) {
  ipcMain.handle(desktopIpcChannels.learning.listCandidates, (_event, value: unknown) =>
    services.listCandidates(parseLearningListInput(value).limit));
  ipcMain.handle(desktopIpcChannels.learning.searchPrivateKnowledge, (_event, value: unknown) =>
    services.searchPrivateKnowledge(parseLearningSearchInput(value)));
  ipcMain.handle(desktopIpcChannels.learning.approveCandidate, (_event, value: unknown) =>
    services.approveCandidate(parseLearningCandidateInput(value)));
  ipcMain.handle(desktopIpcChannels.learning.rejectCandidate, (_event, value: unknown) =>
    services.rejectCandidate(parseLearningCandidateInput(value)));
  ipcMain.handle(desktopIpcChannels.learning.rollbackPrivateSkill, (_event, value: unknown) =>
    services.rollbackPrivateSkill(parseLearningRollbackInput(value)));
}
