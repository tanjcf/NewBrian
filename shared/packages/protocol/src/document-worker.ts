import type { DocumentAnchor, DocumentFormat } from "./document-anchor.js";

const { validateDocumentAnchor } = await import(
  new URL(import.meta.url.endsWith(".ts") ? "./document-anchor.ts" : "./document-anchor.js", import.meta.url).href
) as typeof import("./document-anchor.js");

export const DOCUMENT_WORKER_PROTOCOL_VERSION = "2" as const;

export interface DocumentWorkerRequest {
  protocol_version: typeof DOCUMENT_WORKER_PROTOCOL_VERSION;
  request_id: string;
  project_root: string;
  relative_path: string;
  max_bytes: number;
}

export interface DocumentWorkerResponse {
  protocol_version: typeof DOCUMENT_WORKER_PROTOCOL_VERSION;
  request_id: string;
  status: "completed" | "failed";
  error_code: string;
  format?: DocumentFormat;
  text?: string;
  anchors?: DocumentAnchor[];
  warnings?: string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function parseDocumentWorkerResponse(value: unknown): DocumentWorkerResponse {
  const input = record(value, "document worker response");
  if (input.protocol_version !== DOCUMENT_WORKER_PROTOCOL_VERSION) throw new TypeError("document worker protocol version is invalid");
  if (typeof input.request_id !== "string" || !input.request_id.trim()) throw new TypeError("document worker request_id is invalid");
  if (input.status !== "completed" && input.status !== "failed") throw new TypeError("document worker status is invalid");
  if (typeof (input.error_code ?? "") !== "string") throw new TypeError("document worker error_code is invalid");
  if (input.status === "completed") {
    if (typeof input.text !== "string" || !Array.isArray(input.anchors) || !Array.isArray(input.warnings)) {
      throw new TypeError("completed document worker response is incomplete");
    }
    for (const anchor of input.anchors) validateDocumentAnchor(anchor as DocumentAnchor);
    if (!input.warnings.every((warning) => typeof warning === "string")) throw new TypeError("document worker warnings are invalid");
  }
  return input as unknown as DocumentWorkerResponse;
}
