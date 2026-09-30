/**
 * Client for spring-app automatic git-like user knowledge sync APIs:
 * GET /api/desktop/v1/knowledge/space|pull|documents
 * POST /api/desktop/v1/knowledge/push
 *
 * Not on the /v1/responses hot path. Desktop syncs in the background after
 * login / project open / local learning writes.
 */

export type KnowledgeScope = "GLOBAL" | "PROJECT";

export type KnowledgeDocType =
  | "user-output-rules"
  | "project-knowledge"
  | "session-digest"
  | "learning-open-questions"
  /** Repo-root NEWBRAIN.md Project OS (synced across devices with the knowledge space). */
  | "project-os";

export type KnowledgeSpaceSnapshot = {
  owner_user_id?: number;
  generation: number;
  revision?: number;
  content_hash: string;
  etag?: string;
  document_count: number;
  updated_at: string;
};

export type KnowledgeDocumentSnapshot = {
  id?: string;
  scope: KnowledgeScope;
  project_key: string;
  doc_type: KnowledgeDocType;
  content: string;
  content_hash: string;
  etag?: string;
  byte_size?: number;
  generation: number;
  updated_at?: string;
};

export type KnowledgePullResult = {
  ok: boolean;
  space: KnowledgeSpaceSnapshot;
  documents: KnowledgeDocumentSnapshot[];
  since_generation?: number | null;
};

export type KnowledgePushDocument = {
  scope: KnowledgeScope;
  project_key?: string;
  doc_type: KnowledgeDocType;
  content: string;
};

export type KnowledgePushResult = {
  ok: boolean;
  space: KnowledgeSpaceSnapshot;
  written?: Array<Record<string, unknown>>;
};

export type KnowledgeConflictPayload = {
  ok: false;
  error: "USER_KNOWLEDGE_CONFLICT";
  message?: string;
  base_generation?: number;
  current_generation?: number;
  space?: KnowledgeSpaceSnapshot;
  documents?: KnowledgeDocumentSnapshot[];
};

export class KnowledgeSyncConflictError extends Error {
  readonly status = 409;
  readonly payload: KnowledgeConflictPayload;

  constructor(payload: KnowledgeConflictPayload) {
    super(payload.message || "USER_KNOWLEDGE_CONFLICT");
    this.name = "KnowledgeSyncConflictError";
    this.payload = payload;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Resolve spring-app origin from a gateway base URL that may end with /v1. */
export function resolveKnowledgeApiOrigin(gatewayBaseUrl: string): string {
  const trimmed = gatewayBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Gateway base URL is required for knowledge sync.");
  try {
    const url = new URL(/\/v1$/i.test(trimmed) ? trimmed.replace(/\/v1$/i, "") : trimmed);
    return url.origin;
  } catch {
    return /\/v1$/i.test(trimmed) ? trimmed.replace(/\/v1$/i, "") : trimmed;
  }
}

function parseSpace(value: unknown): KnowledgeSpaceSnapshot {
  const body = asRecord(value) ?? {};
  return {
    owner_user_id: body.owner_user_id == null ? undefined : Number(body.owner_user_id),
    generation: Number(body.generation ?? body.revision ?? 0) || 0,
    revision: Number(body.revision ?? body.generation ?? 0) || 0,
    content_hash: String(body.content_hash ?? ""),
    etag: body.etag == null ? undefined : String(body.etag),
    document_count: Number(body.document_count ?? 0) || 0,
    updated_at: String(body.updated_at ?? "")
  };
}

function parseDocument(value: unknown): KnowledgeDocumentSnapshot | null {
  const body = asRecord(value);
  if (!body) return null;
  const scopeRaw = String(body.scope ?? "").toUpperCase();
  const scope: KnowledgeScope = scopeRaw === "PROJECT" ? "PROJECT" : "GLOBAL";
  const docType = String(body.doc_type ?? body.docType ?? "").replace(/\.md$/i, "") as KnowledgeDocType;
  if (!docType) return null;
  return {
    id: body.id == null ? undefined : String(body.id),
    scope,
    project_key: String(body.project_key ?? body.projectKey ?? ""),
    doc_type: docType,
    content: String(body.content ?? ""),
    content_hash: String(body.content_hash ?? body.contentHash ?? ""),
    etag: body.etag == null ? undefined : String(body.etag),
    byte_size: body.byte_size == null && body.byteSize == null
      ? undefined
      : Number(body.byte_size ?? body.byteSize),
    generation: Number(body.generation ?? 0) || 0,
    updated_at: body.updated_at == null ? undefined : String(body.updated_at)
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw_body: text };
  }
}

export type KnowledgeGatewayAuth = {
  gatewayBaseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/** GET knowledge space metadata for cheap unchanged checks. */
export async function fetchKnowledgeSpace(input: KnowledgeGatewayAuth): Promise<KnowledgeSpaceSnapshot> {
  const origin = resolveKnowledgeApiOrigin(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${origin}/api/desktop/v1/knowledge/space`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.bearerToken}`,
      Accept: "application/json"
    },
    signal: input.signal
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const record = asRecord(payload);
    throw new Error(String(record?.message ?? `knowledge space HTTP ${response.status}`));
  }
  const record = asRecord(payload);
  return parseSpace(record?.space ?? payload);
}

/** Pull remote documents (full or changes-since) for automatic sync. */
export async function pullKnowledgeDocuments(input: KnowledgeGatewayAuth & {
  sinceGeneration?: number | null;
  scope?: KnowledgeScope;
  projectKey?: string;
}): Promise<KnowledgePullResult> {
  const origin = resolveKnowledgeApiOrigin(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams();
  if (input.sinceGeneration != null && Number.isFinite(input.sinceGeneration)) {
    params.set("since_generation", String(input.sinceGeneration));
  }
  if (input.scope) params.set("scope", input.scope);
  if (input.projectKey) params.set("project_key", input.projectKey);
  const query = params.toString() ? `?${params}` : "";
  const response = await fetchImpl(`${origin}/api/desktop/v1/knowledge/pull${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.bearerToken}`,
      Accept: "application/json"
    },
    signal: input.signal
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const record = asRecord(payload);
    throw new Error(String(record?.message ?? `knowledge pull HTTP ${response.status}`));
  }
  const record = asRecord(payload) ?? {};
  const documents = Array.isArray(record.documents)
    ? record.documents.map(parseDocument).filter((item): item is KnowledgeDocumentSnapshot => Boolean(item))
    : [];
  return {
    ok: record.ok !== false,
    space: parseSpace(record.space),
    documents,
    since_generation: record.since_generation == null ? null : Number(record.since_generation)
  };
}

/** Push local merged documents with baseGeneration; throws KnowledgeSyncConflictError on 409. */
export async function pushKnowledgeDocuments(input: KnowledgeGatewayAuth & {
  baseGeneration: number;
  documents: KnowledgePushDocument[];
}): Promise<KnowledgePushResult> {
  const origin = resolveKnowledgeApiOrigin(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${origin}/api/desktop/v1/knowledge/push`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.bearerToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    signal: input.signal,
    body: JSON.stringify({
      baseGeneration: input.baseGeneration,
      documents: input.documents.map((document) => ({
        scope: document.scope,
        project_key: document.project_key ?? "",
        doc_type: document.doc_type,
        content: document.content
      }))
    })
  });
  const payload = await readJson(response);
  if (response.status === 409) {
    const record = asRecord(payload) ?? {};
    throw new KnowledgeSyncConflictError({
      ok: false,
      error: "USER_KNOWLEDGE_CONFLICT",
      message: String(record.message ?? "USER_KNOWLEDGE_CONFLICT"),
      base_generation: record.base_generation == null ? undefined : Number(record.base_generation),
      current_generation: record.current_generation == null ? undefined : Number(record.current_generation),
      space: record.space ? parseSpace(record.space) : undefined,
      documents: Array.isArray(record.documents)
        ? record.documents.map(parseDocument).filter((item): item is KnowledgeDocumentSnapshot => Boolean(item))
        : undefined
    });
  }
  if (!response.ok) {
    const record = asRecord(payload);
    throw new Error(String(record?.message ?? `knowledge push HTTP ${response.status}`));
  }
  const record = asRecord(payload) ?? {};
  return {
    ok: record.ok !== false,
    space: parseSpace(record.space),
    written: Array.isArray(record.written) ? record.written as Array<Record<string, unknown>> : undefined
  };
}
