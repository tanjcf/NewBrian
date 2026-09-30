import type {
  HolonKnowledgeSearchResult,
  HolonKnowledgeSnapshot,
  HolonLearningCandidate,
  HolonRuntimeEvent,
  HolonWorkItem
} from "@codex-forge/protocol";

export function parseHolonWorkItem(value: unknown): HolonWorkItem;
export function parseHolonKnowledgeSnapshot(value: unknown): HolonKnowledgeSnapshot;
export function parseHolonLearningCandidate(value: unknown): HolonLearningCandidate;
export function parseHolonKnowledgeSearchResult(value: unknown): HolonKnowledgeSearchResult;
export function validateHolonRuntimeEvents(value: unknown): HolonRuntimeEvent[];
