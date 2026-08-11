import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type CreateWorkspaceWorktreeInput,
  type RecordMessageFeedbackInput,
  type SwitchWorkspaceBranchInput,
  type WorkspaceBranchStatus,
  type WorkspaceHeaderStatus,
  type WorkspaceReviewChanges,
  type WorkspaceReviewInput
} from "@codex-forge/protocol";
import { parseCreateWorkspaceWorktreeInput } from "./workspace-lifecycle-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface WorkspaceGitIpcServices {
  getHeaderStatus: (workspaceId: string) => MaybePromise<WorkspaceHeaderStatus>;
  getReviewChanges: (input: WorkspaceReviewInput) => MaybePromise<WorkspaceReviewChanges>;
  getBranches: (workspaceId: string) => MaybePromise<WorkspaceBranchStatus>;
  switchBranch: (input: SwitchWorkspaceBranchInput) => MaybePromise<WorkspaceBranchStatus>;
  recordFeedback: (input: RecordMessageFeedbackInput) => MaybePromise<{ ok: boolean }>;
  createWorktree: (input: CreateWorkspaceWorktreeInput) => MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkspaceId(input: unknown): string {
  if (typeof input !== "string") {
    throw new TypeError("Workspace id must be a string.");
  }
  return input;
}

function parseReviewInput(input: unknown): WorkspaceReviewInput {
  if (input === undefined) return {};
  if (!isRecord(input)
    || (input.workspaceId !== undefined && typeof input.workspaceId !== "string")
    || (input.threadId !== undefined && typeof input.threadId !== "string")) {
    throw new TypeError("Workspace review input is invalid.");
  }
  return { workspaceId: input.workspaceId, threadId: input.threadId };
}

function parseSwitchBranchInput(input: unknown): SwitchWorkspaceBranchInput {
  if (!isRecord(input)
    || typeof input.workspaceId !== "string"
    || typeof input.branch !== "string"
    || (input.create !== undefined && typeof input.create !== "boolean")) {
    throw new TypeError("Workspace branch input is invalid.");
  }
  return { workspaceId: input.workspaceId, branch: input.branch, create: input.create };
}

function parseFeedbackInput(input: unknown): RecordMessageFeedbackInput {
  if (!isRecord(input)
    || (input.workspaceId !== undefined && typeof input.workspaceId !== "string")
    || (input.threadId !== undefined && typeof input.threadId !== "string")
    || typeof input.messageId !== "string"
    || (input.rating !== "helpful" && input.rating !== "unhelpful")) {
    throw new TypeError("Message feedback input is invalid.");
  }
  return {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    messageId: input.messageId,
    rating: input.rating
  };
}

/** Register workspace Git IPC with validation before filesystem and Git access. */
export function registerWorkspaceGitIpcHandlers(services: WorkspaceGitIpcServices) {
  ipcMain.handle(desktopIpcChannels.workspaceGit.getHeaderStatus, (_event, workspaceId: unknown) =>
    services.getHeaderStatus(parseWorkspaceId(workspaceId))
  );
  ipcMain.handle(desktopIpcChannels.workspaceGit.getReviewChanges, (_event, input: unknown) =>
    services.getReviewChanges(parseReviewInput(input))
  );
  ipcMain.handle(desktopIpcChannels.workspaceGit.getBranches, (_event, workspaceId: unknown) =>
    services.getBranches(parseWorkspaceId(workspaceId))
  );
  ipcMain.handle(desktopIpcChannels.workspaceGit.switchBranch, (_event, input: unknown) =>
    services.switchBranch(parseSwitchBranchInput(input))
  );
  ipcMain.handle(desktopIpcChannels.workspaceGit.recordFeedback, (_event, input: unknown) =>
    services.recordFeedback(parseFeedbackInput(input))
  );
  ipcMain.handle(desktopIpcChannels.workspaceGit.createWorktree, (_event, input: unknown) =>
    services.createWorktree(parseCreateWorkspaceWorktreeInput(input))
  );
}
