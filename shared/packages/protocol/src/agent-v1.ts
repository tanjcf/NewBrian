/**
 * NewBrain ↔ spring-app agent runtime protocol v1 (`newbrain.agent.v1`).
 * Phase 0 freeze: types + enums shared with spring-app DTOs / JSON fixtures.
 * Hybrid authority (Mode A): local checkpoint + spring policy/skills/cancel.
 */

export const AGENT_PROTOCOL_ID = "newbrain.agent.v1" as const;
export const AGENT_RUNTIME_PROTOCOL_VERSION = 1 as const;

/** Preference / fleet flag: when false, desktop must not call ClawHub directly. */
export const MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG = "market.direct_clawhub_allowed" as const;

export const DIRECT_CLAWHUB_BLOCKED_MESSAGE = "市场安装须经服务端，直连已关闭" as const;

export type AgentSessionStatusV1 = "idle" | "active" | "archived";

export type AgentMessageRoleV1 = "user" | "assistant" | "system" | "tool";

export type AgentTurnStatusV1 =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentToolCallStatusV1 =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentToolRiskV1 = "low" | "medium" | "high";

export type AgentSideEffectClassV1 =
  | "none"
  | "workspace"
  | "process"
  | "network"
  | "credential";

export type AgentApprovalStatusV1 =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type AgentApprovalDecisionV1 = "approve" | "deny";

export type AgentSkillSourceV1 =
  | "builtin"
  | "workspace"
  | "personal"
  | "managed"
  | "market_private"
  | "market_clawhub";

export type AgentSkillSignatureStatusV1 =
  | "unsigned"
  | "valid"
  | "invalid"
  | "revoked";

export type AgentSkillScanStatusV1 =
  | "not_required"
  | "pending"
  | "passed"
  | "failed";

export type AgentSkillToolCompatibilityV1 = "full" | "mapped" | "incompatible";

export type AgentSkillLifecycleV1 =
  | "active"
  | "proposed"
  | "quarantined"
  | "rejected";

/** Stream event names (S→C). Keep in sync with fixtures/agent-v1/events.json */
export const AGENT_STREAM_EVENTS_V1 = [
  "session.updated",
  "message.created",
  "message.delta",
  "turn.started",
  "turn.status",
  "turn.completed",
  "tool.proposed",
  "approval.required",
  "approval.resolved",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "skill.context_injected",
  "error",
  "heartbeat"
] as const;

export type AgentStreamEventNameV1 = (typeof AGENT_STREAM_EVENTS_V1)[number];

/** Client commands (C→S or IPC equivalent). */
export const AGENT_COMMANDS_V1 = [
  "turn.start",
  "turn.cancel",
  "approval.resolve",
  "skill.set_enabled"
] as const;

export type AgentCommandNameV1 = (typeof AGENT_COMMANDS_V1)[number];

/** Stable error codes. Keep in sync with fixtures/agent-v1/error-codes.json */
export const AGENT_ERROR_CODES_V1 = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "PROTOCOL_UNSUPPORTED",
  "IDEMPOTENCY_CONFLICT",
  "TURN_NOT_FOUND",
  "TURN_NOT_CANCELABLE",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_EXPIRED",
  "TOOL_DENIED_BY_POLICY",
  "TOOL_INCOMPATIBLE_SKILL",
  "SKILL_NOT_ALLOWLISTED",
  "SKILL_VERIFY_FAILED",
  "SKILL_SCAN_FAILED",
  "SKILL_DISABLED",
  "MARKET_SOURCE_BLOCKED",
  "UPSTREAM_CANCELLED",
  "INTERNAL"
] as const;

export type AgentErrorCodeV1 = (typeof AGENT_ERROR_CODES_V1)[number];

export interface AgentSessionV1 {
  sessionId: string;
  tenantId?: string;
  userId?: string;
  title: string;
  status: AgentSessionStatusV1;
  workspaceRef?: string;
  createdAt: string;
  updatedAt: string;
  etag: string;
}

export interface AgentMessageV1 {
  messageId: string;
  sessionId: string;
  role: AgentMessageRoleV1;
  seq: number;
  clientMessageId?: string;
  content: string | Array<Record<string, unknown>>;
  turnId?: string;
  createdAt: string;
}

export interface AgentTurnV1 {
  turnId: string;
  sessionId: string;
  status: AgentTurnStatusV1;
  model: string;
  startedAt: string;
  endedAt?: string;
  cancelRequested: boolean;
  errorCode?: AgentErrorCodeV1 | string;
  errorMessage?: string;
}

export interface AgentToolCallV1 {
  toolCallId: string;
  turnId: string;
  name: string;
  arguments: Record<string, unknown>;
  status: AgentToolCallStatusV1;
  approvalId?: string;
  risk: AgentToolRiskV1;
  sideEffectClass: AgentSideEffectClassV1;
}

export interface AgentApprovalV1 {
  approvalId: string;
  toolCallId: string;
  status: AgentApprovalStatusV1;
  message: string;
  expiresAt?: string;
}

/**
 * Skill metadata v1 — name/version/source/verification/enabled.
 * Field names must match spring-app DTOs and fixtures.
 */
export interface SkillMetadataV1 {
  skillKey: string;
  displayName: string;
  version: string;
  source: AgentSkillSourceV1;
  originRef?: string;
  contentHash: string;
  signatureStatus: AgentSkillSignatureStatusV1;
  scanStatus: AgentSkillScanStatusV1;
  enabled: boolean;
  allowlisted: boolean;
  toolCompatibility: AgentSkillToolCompatibilityV1;
  injectionBudgetTokens?: number;
  lifecycle: AgentSkillLifecycleV1;
  /** Alias for verificationStatus product copy; equals signatureStatus + scanStatus rollup when set. */
  verificationStatus?: string;
  name?: string;
}

export interface AgentStreamEventEnvelopeV1<TPayload = Record<string, unknown>> {
  event: AgentStreamEventNameV1;
  id?: string | number;
  seq?: number;
  turnId?: string;
  sessionId?: string;
  mock?: boolean;
  data: TPayload;
}

export interface AgentErrorPayloadV1 {
  code: AgentErrorCodeV1 | string;
  message: string;
  retriable: boolean;
}

export interface AgentProtocolCapabilityV1 {
  protocol: typeof AGENT_PROTOCOL_ID;
  runtime_protocol_version: typeof AGENT_RUNTIME_PROTOCOL_VERSION;
  agent_turn_v1: boolean;
  skill_allowlist: boolean;
  market_proxy: boolean;
  [MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG]: boolean;
}

export function isAgentStreamEventNameV1(value: string): value is AgentStreamEventNameV1 {
  return (AGENT_STREAM_EVENTS_V1 as readonly string[]).includes(value);
}

export function isAgentErrorCodeV1(value: string): value is AgentErrorCodeV1 {
  return (AGENT_ERROR_CODES_V1 as readonly string[]).includes(value);
}

export function createDefaultAgentProtocolCapabilityV1(
  overrides: Partial<AgentProtocolCapabilityV1> = {}
): AgentProtocolCapabilityV1 {
  return {
    protocol: AGENT_PROTOCOL_ID,
    runtime_protocol_version: AGENT_RUNTIME_PROTOCOL_VERSION,
    agent_turn_v1: true,
    skill_allowlist: false,
    market_proxy: false,
    [MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG]: false,
    ...overrides
  };
}
