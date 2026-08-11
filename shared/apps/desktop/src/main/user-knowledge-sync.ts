/**
 * Automatic git-like user-knowledge sync engine.
 *
 * UX: fully automatic — login / project open / after local learning writes
 * trigger background pull → merge → push. Users never manually sync.
 *
 * Project OS (`CODECN.md`) is included as doc type `project-os` so switching
 * devices restores project instructions with the same knowledge sync path.
 * Source files / whole workspaces are still NOT synced.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  KnowledgeSyncConflictError,
  pullKnowledgeDocuments,
  pushKnowledgeDocuments,
  type KnowledgeDocType,
  type KnowledgeDocumentSnapshot,
  type KnowledgePushDocument,
  type KnowledgeScope,
  type KnowledgeSpaceSnapshot
} from "./user-knowledge-gateway.ts";
import { clampKnowledgeContent, mergeKnowledgeDocuments } from "./user-knowledge-merge.ts";

export const GLOBAL_DOC_TYPES: KnowledgeDocType[] = [
  "user-output-rules",
  "learning-open-questions"
];

/**
 * Project-scoped knowledge docs.
 * `project-os` maps to repo-root CODECN.md; other types live under
 * `.codecn/skills/*-project-manager/references`.
 */
export const PROJECT_DOC_TYPES: KnowledgeDocType[] = [
  "user-output-rules",
  "project-knowledge",
  "session-digest",
  "learning-open-questions",
  "project-os"
];

/** Filename used for Project OS at the workspace root. */
export const PROJECT_OS_SYNC_FILENAME = "CODECN.md";

export type UserKnowledgeSyncState = {
  generation: number;
  contentHash: string;
  updatedAt: string;
  lastSyncAt?: string;
  lastError?: string;
  pendingPush?: boolean;
};

export type UserKnowledgeSyncPaths = {
  /** App-level .codecn root (holds user-knowledge/global + sync-state). */
  userCodecnRoot: string;
  /** Current project workspace root; optional for global-only sync. */
  projectWorkspacePath?: string;
  projectKey?: string;
};

export type UserKnowledgeSyncAuth = {
  gatewayBaseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
};

export type UserKnowledgeSyncResult = {
  ok: boolean;
  pulled: number;
  pushed: number;
  generation: number;
  conflictRetried: number;
  status: "synced" | "pending" | "conflict-queued" | "skipped" | "error";
  message?: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function safeProjectKey(value: string | undefined): string {
  const normalized = String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

/** Global cache directory for user-wide preference knowledge. */
export function resolveGlobalKnowledgeDir(userCodecnRoot: string): string {
  return path.join(userCodecnRoot, "user-knowledge", "global");
}

/** Sync-state JSON path (local generation mirror). */
export function resolveKnowledgeSyncStatePath(userCodecnRoot: string): string {
  return path.join(userCodecnRoot, "user-knowledge", "sync-state.json");
}

/** Project-manager references directory for a workspace. */
export function resolveProjectReferencesDir(projectWorkspacePath: string, projectKey?: string): string {
  const key = safeProjectKey(projectKey || path.basename(projectWorkspacePath));
  return path.join(projectWorkspacePath, ".codecn", "skills", `${key}-project-manager`, "references");
}

export function resolveDocFilePath(input: {
  userCodecnRoot: string;
  scope: KnowledgeScope;
  docType: KnowledgeDocType;
  projectWorkspacePath?: string;
  projectKey?: string;
}): string {
  // Project OS is the repo-root CODECN.md (not buried under .codecn references).
  if (input.docType === "project-os") {
    if (input.scope !== "PROJECT" || !input.projectWorkspacePath) {
      throw new Error("project-os knowledge requires PROJECT scope and projectWorkspacePath");
    }
    return path.join(path.resolve(input.projectWorkspacePath), PROJECT_OS_SYNC_FILENAME);
  }
  const fileName = `${input.docType}.md`;
  if (input.scope === "GLOBAL") {
    return path.join(resolveGlobalKnowledgeDir(input.userCodecnRoot), fileName);
  }
  if (!input.projectWorkspacePath) {
    throw new Error("PROJECT knowledge requires projectWorkspacePath");
  }
  return path.join(
    resolveProjectReferencesDir(input.projectWorkspacePath, input.projectKey),
    fileName
  );
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

/** Load local sync generation state. */
export async function readKnowledgeSyncState(userCodecnRoot: string): Promise<UserKnowledgeSyncState> {
  const raw = await readText(resolveKnowledgeSyncStatePath(userCodecnRoot));
  if (!raw.trim()) {
    return { generation: 0, contentHash: "", updatedAt: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserKnowledgeSyncState>;
    return {
      generation: Number(parsed.generation ?? 0) || 0,
      contentHash: String(parsed.contentHash ?? ""),
      updatedAt: String(parsed.updatedAt ?? ""),
      lastSyncAt: parsed.lastSyncAt ? String(parsed.lastSyncAt) : undefined,
      lastError: parsed.lastError ? String(parsed.lastError) : undefined,
      pendingPush: Boolean(parsed.pendingPush)
    };
  } catch {
    return { generation: 0, contentHash: "", updatedAt: "" };
  }
}

async function writeKnowledgeSyncState(
  userCodecnRoot: string,
  state: UserKnowledgeSyncState
): Promise<void> {
  await writeText(resolveKnowledgeSyncStatePath(userCodecnRoot), `${JSON.stringify(state, null, 2)}\n`);
}

async function applyRemoteDocument(
  paths: UserKnowledgeSyncPaths,
  remote: KnowledgeDocumentSnapshot
): Promise<boolean> {
  if (remote.scope === "PROJECT" && !paths.projectWorkspacePath) {
    return false;
  }
  if (
    remote.scope === "PROJECT"
    && paths.projectKey
    && remote.project_key
    && safeProjectKey(remote.project_key) !== safeProjectKey(paths.projectKey)
  ) {
    return false;
  }
  const filePath = resolveDocFilePath({
    userCodecnRoot: paths.userCodecnRoot,
    scope: remote.scope,
    docType: remote.doc_type,
    projectWorkspacePath: paths.projectWorkspacePath,
    projectKey: paths.projectKey || remote.project_key
  });
  const local = await readText(filePath);
  const merged = mergeKnowledgeDocuments({
    docType: remote.doc_type,
    localContent: local,
    remoteContent: remote.content
  });
  const next = clampKnowledgeContent(remote.doc_type, merged.content);
  if (next === local) return false;
  await writeText(filePath, next);
  return true;
}

async function collectLocalDocuments(paths: UserKnowledgeSyncPaths): Promise<KnowledgePushDocument[]> {
  const documents: KnowledgePushDocument[] = [];
  for (const docType of GLOBAL_DOC_TYPES) {
    const content = await readText(resolveDocFilePath({
      userCodecnRoot: paths.userCodecnRoot,
      scope: "GLOBAL",
      docType
    }));
    if (!content.trim()) continue;
    documents.push({
      scope: "GLOBAL",
      project_key: "",
      doc_type: docType,
      content: clampKnowledgeContent(docType, content)
    });
  }
  if (paths.projectWorkspacePath) {
    const projectKey = safeProjectKey(paths.projectKey || path.basename(paths.projectWorkspacePath));
    for (const docType of PROJECT_DOC_TYPES) {
      const content = await readText(resolveDocFilePath({
        userCodecnRoot: paths.userCodecnRoot,
        scope: "PROJECT",
        docType,
        projectWorkspacePath: paths.projectWorkspacePath,
        projectKey
      }));
      if (!content.trim()) continue;
      documents.push({
        scope: "PROJECT",
        project_key: projectKey,
        doc_type: docType,
        content: clampKnowledgeContent(docType, content)
      });
    }
  }
  return documents;
}

/**
 * Read bounded global + current-project knowledge for prompt injection (disk hot path).
 */
export async function loadLocalKnowledgeForInjection(input: {
  userCodecnRoot: string;
  projectWorkspacePath?: string;
  projectKey?: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = input.maxChars ?? 12_000;
  const chunks: string[] = [];
  for (const docType of GLOBAL_DOC_TYPES) {
    const content = (await readText(resolveDocFilePath({
      userCodecnRoot: input.userCodecnRoot,
      scope: "GLOBAL",
      docType
    }))).trim();
    if (!content) continue;
    chunks.push(`--- global/${docType}.md ---\n${content}`);
  }
  if (input.projectWorkspacePath) {
    const projectKey = safeProjectKey(input.projectKey || path.basename(input.projectWorkspacePath));
    // Prefer preference docs here; Project OS is injected separately via loadProjectOsInstruction
    // to avoid duplicating CODECN.md in the system prompt.
    for (const docType of ["user-output-rules", "project-knowledge", "learning-open-questions"] as KnowledgeDocType[]) {
      const content = (await readText(resolveDocFilePath({
        userCodecnRoot: input.userCodecnRoot,
        scope: "PROJECT",
        docType,
        projectWorkspacePath: input.projectWorkspacePath,
        projectKey
      }))).trim();
      if (!content) continue;
      chunks.push(`--- project/${docType}.md ---\n${content}`);
    }
  }
  const joined = chunks.join("\n\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars);
}

async function pushWithConflictRetry(input: {
  auth: UserKnowledgeSyncAuth;
  paths: UserKnowledgeSyncPaths;
  baseGeneration: number;
  documents: KnowledgePushDocument[];
  maxRetries?: number;
}): Promise<{ space: KnowledgeSpaceSnapshot; conflictRetried: number }> {
  const maxRetries = input.maxRetries ?? 3;
  let baseGeneration = input.baseGeneration;
  let documents = input.documents;
  let conflictRetried = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const pushed = await pushKnowledgeDocuments({
        ...input.auth,
        baseGeneration,
        documents
      });
      return { space: pushed.space, conflictRetried };
    } catch (error) {
      if (!(error instanceof KnowledgeSyncConflictError)) throw error;
      conflictRetried += 1;
      const remoteDocs = error.payload.documents ?? [];
      for (const remote of remoteDocs) {
        await applyRemoteDocument(input.paths, remote);
      }
      baseGeneration = Number(error.payload.current_generation
        ?? error.payload.space?.generation
        ?? baseGeneration);
      documents = await collectLocalDocuments(input.paths);
      if (!documents.length) {
        return {
          space: error.payload.space ?? {
            generation: baseGeneration,
            content_hash: "",
            document_count: 0,
            updated_at: ""
          },
          conflictRetried
        };
      }
    }
  }
  throw new Error("knowledge automatic sync exhausted conflict retries");
}

/**
 * Run one automatic pull → merge → push cycle. Safe to call in background;
 * never throws into chat hot path when wrapped by scheduleUserKnowledgeSync.
 */
export async function syncUserKnowledgeOnce(input: {
  auth: UserKnowledgeSyncAuth;
  paths: UserKnowledgeSyncPaths;
  forceFullPull?: boolean;
}): Promise<UserKnowledgeSyncResult> {
  if (!input.auth.bearerToken?.trim() || !input.auth.gatewayBaseUrl?.trim()) {
    return {
      ok: true,
      pulled: 0,
      pushed: 0,
      generation: 0,
      conflictRetried: 0,
      status: "skipped",
      message: "no auth"
    };
  }

  const state = await readKnowledgeSyncState(input.paths.userCodecnRoot);
  const since = input.forceFullPull ? null : state.generation;
  const pulled = await pullKnowledgeDocuments({
    ...input.auth,
    sinceGeneration: since && since > 0 ? since : null,
    projectKey: input.paths.projectKey
      ? safeProjectKey(input.paths.projectKey)
      : undefined
  });

  let pulledCount = 0;
  for (const document of pulled.documents) {
    if (await applyRemoteDocument(input.paths, document)) pulledCount += 1;
  }

  const localDocuments = await collectLocalDocuments(input.paths);
  let conflictRetried = 0;
  let generation = pulled.space.generation;
  let contentHash = pulled.space.content_hash;
  let pushedCount = 0;

  if (localDocuments.length) {
    const pushResult = await pushWithConflictRetry({
      auth: input.auth,
      paths: input.paths,
      baseGeneration: pulled.space.generation,
      documents: localDocuments
    });
    conflictRetried = pushResult.conflictRetried;
    generation = pushResult.space.generation;
    contentHash = pushResult.space.content_hash;
    pushedCount = localDocuments.length;
  }

  await writeKnowledgeSyncState(input.paths.userCodecnRoot, {
    generation,
    contentHash,
    updatedAt: pulled.space.updated_at || new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    pendingPush: false,
    lastError: undefined
  });

  return {
    ok: true,
    pulled: pulledCount,
    pushed: pushedCount,
    generation,
    conflictRetried,
    status: conflictRetried ? "synced" : "synced"
  };
}

type ScheduledSync = {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<UserKnowledgeSyncResult> | null;
};

const scheduledByRoot = new Map<string, ScheduledSync>();

/**
 * Debounced background sync. Chat/learning continues immediately; sync finishes quietly.
 */
export function scheduleUserKnowledgeSync(input: {
  auth: UserKnowledgeSyncAuth;
  paths: UserKnowledgeSyncPaths;
  delayMs?: number;
  forceFullPull?: boolean;
  onResult?: (result: UserKnowledgeSyncResult) => void;
  onError?: (error: unknown) => void;
}): void {
  const key = input.paths.userCodecnRoot;
  const existing = scheduledByRoot.get(key) ?? { timer: null, inFlight: null };
  if (existing.timer) clearTimeout(existing.timer);
  existing.timer = setTimeout(() => {
    existing.timer = null;
    const run = syncUserKnowledgeOnce({
      auth: input.auth,
      paths: input.paths,
      forceFullPull: input.forceFullPull
    }).then((result) => {
      input.onResult?.(result);
      return result;
    }).catch(async (error) => {
      input.onError?.(error);
      try {
        const state = await readKnowledgeSyncState(input.paths.userCodecnRoot);
        await writeKnowledgeSyncState(input.paths.userCodecnRoot, {
          ...state,
          pendingPush: true,
          lastError: error instanceof Error ? error.message : String(error)
        });
      } catch {
        // ignore state write failures
      }
      return {
        ok: false,
        pulled: 0,
        pushed: 0,
        generation: 0,
        conflictRetried: 0,
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error)
      };
    }).finally(() => {
      if (scheduledByRoot.get(key)?.inFlight === run) {
        existing.inFlight = null;
      }
    });
    existing.inFlight = run;
  }, input.delayMs ?? 1_500);
  scheduledByRoot.set(key, existing);
}

/**
 * After local absorbExchange, mirror durable prefs into the global cache then schedule sync.
 */
export async function mirrorProjectRulesToGlobal(input: {
  userCodecnRoot: string;
  projectWorkspacePath: string;
  projectKey?: string;
}): Promise<boolean> {
  const projectKey = safeProjectKey(input.projectKey || path.basename(input.projectWorkspacePath));
  const projectRules = await readText(resolveDocFilePath({
    userCodecnRoot: input.userCodecnRoot,
    scope: "PROJECT",
    docType: "user-output-rules",
    projectWorkspacePath: input.projectWorkspacePath,
    projectKey
  }));
  if (!projectRules.trim()) return false;
  const globalPath = resolveDocFilePath({
    userCodecnRoot: input.userCodecnRoot,
    scope: "GLOBAL",
    docType: "user-output-rules"
  });
  const globalRules = await readText(globalPath);
  const merged = mergeKnowledgeDocuments({
    docType: "user-output-rules",
    localContent: globalRules,
    remoteContent: projectRules
  });
  const next = clampKnowledgeContent("user-output-rules", merged.content);
  if (next === globalRules) return false;
  await writeText(globalPath, next);
  return true;
}

export function knowledgeDocContentHash(content: string): string {
  return sha256(content);
}
