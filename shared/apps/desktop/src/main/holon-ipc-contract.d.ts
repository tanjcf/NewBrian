import type {
  HolonFeedbackInput,
  HolonKnowledgeSnapshotInput,
  HolonWorkItemIdInput,
  LearningCandidateInput,
  LearningListInput,
  LearningRollbackInput,
  LearningSearchInput,
  StartHolonWorkItemInput
} from "@codex-forge/protocol";

export function parseHolonWorkItemIdInput(value: unknown): HolonWorkItemIdInput;
export function parseHolonKnowledgeSnapshotInput(value: unknown): HolonKnowledgeSnapshotInput;
export function parseStartHolonWorkItemInput(value: unknown): StartHolonWorkItemInput;
export function parseLearningListInput(value: unknown): Required<LearningListInput>;
export function parseLearningSearchInput(value: unknown): Required<LearningSearchInput>;
export function parseLearningCandidateInput(value: unknown): LearningCandidateInput;
export function parseLearningRollbackInput(value: unknown): LearningRollbackInput;
export function parseHolonFeedbackInput(value: unknown): HolonFeedbackInput;
