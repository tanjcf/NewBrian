export const RUST_CORE_PROTOCOL_VERSION = "1" as const;

export interface RustCoreResourceLimits {
  timeout_ms: number;
  max_output_bytes: number;
}

export interface RustCoreRequest {
  protocol_version: typeof RUST_CORE_PROTOCOL_VERSION;
  request_id: string;
  project_id: string;
  workspace_type: string;
  operation: string;
  approval_token: string;
  resource_limits: RustCoreResourceLimits;
  payload: Record<string, unknown>;
}

export type RustCoreStatus = "accepted" | "running" | "completed" | "failed" | "cancelled";

export interface RustCoreArtifact {
  id?: string;
  path?: string;
  media_type?: string;
  size_bytes?: number;
  sha256?: string;
}

export interface RustCoreResponse {
  protocol_version: typeof RUST_CORE_PROTOCOL_VERSION;
  request_id: string;
  status: RustCoreStatus;
  error_code: string;
  artifacts: RustCoreArtifact[];
  result?: unknown;
}

const credentialKeyPattern = /(?:api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|access[_-]?token|refresh[_-]?token)/iu;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > 512) throw new TypeError(`${label} is too long`);
  return normalized;
}

function assertNoCredentials(value: unknown, path = "payload") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentials(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (credentialKeyPattern.test(key)) throw new TypeError(`credential field is forbidden at ${path}.${key}`);
    assertNoCredentials(item, `${path}.${key}`);
  }
}

function version(value: unknown) {
  if (value !== RUST_CORE_PROTOCOL_VERSION) throw new TypeError(`protocol_version must be ${RUST_CORE_PROTOCOL_VERSION}`);
  return RUST_CORE_PROTOCOL_VERSION;
}

export function parseRustCoreRequest(value: unknown): RustCoreRequest {
  const input = record(value, "Rust Core request");
  const limits = record(input.resource_limits, "resource_limits");
  const timeoutMs = Number(limits.timeout_ms);
  const maxOutputBytes = Number(limits.max_output_bytes);
  if (timeoutMs !== 0) {
    throw new TypeError("resource_limits.timeout_ms must be 0 because BRAIN execution has no fixed deadline");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16_777_216) {
    throw new TypeError("resource_limits.max_output_bytes must be between 1 and 16777216");
  }
  const payload = record(input.payload ?? {}, "payload");
  assertNoCredentials(payload);
  return {
    protocol_version: version(input.protocol_version),
    request_id: text(input.request_id, "request_id"),
    project_id: text(input.project_id, "project_id"),
    workspace_type: text(input.workspace_type, "workspace_type"),
    operation: text(input.operation, "operation"),
    approval_token: text(input.approval_token ?? "", "approval_token", true),
    resource_limits: { timeout_ms: timeoutMs, max_output_bytes: maxOutputBytes },
    payload
  };
}

export function parseRustCoreResponse(value: unknown): RustCoreResponse {
  const input = record(value, "Rust Core response");
  const allowedStatuses = new Set<RustCoreStatus>(["accepted", "running", "completed", "failed", "cancelled"]);
  if (!allowedStatuses.has(input.status as RustCoreStatus)) throw new TypeError("status is invalid");
  if (!Array.isArray(input.artifacts)) throw new TypeError("artifacts must be an array");
  const response: RustCoreResponse = {
    protocol_version: version(input.protocol_version),
    request_id: text(input.request_id, "request_id"),
    status: input.status as RustCoreStatus,
    error_code: text(input.error_code ?? "", "error_code", true),
    artifacts: input.artifacts.map((artifact) => record(artifact, "artifact"))
  };
  if ("result" in input) response.result = input.result;
  return response;
}
