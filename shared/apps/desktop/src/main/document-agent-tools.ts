import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { createDocumentRevisionProposal } from "./document-revision-task.js";

type ToolExecute = (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ToolValidate = (input: Record<string, unknown>) => Record<string, unknown> | void;

type BuiltinTool = {
  name?: string;
  title?: string;
  description?: string;
  kind?: string;
  risk?: string;
  requiresApproval?: boolean;
  inputSchema?: unknown;
  execute?: ToolExecute;
  validate?: ToolValidate;
};

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<{ ok: boolean; output?: string; [key: string]: unknown }>
  ): unknown;
  toolRegistry?: {
    get(name: string): BuiltinTool | undefined;
  };
};

export type DocumentAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
};

const DOCUMENT_CREATE_TOOLS = ["document.create_pdf", "document.create_docx", "artifact.create"] as const;
const WRITE_FILE_TOOL = "workspace.write_file";
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".md", ".txt"]);

/** Keep builtin execute/validate handlers across unregister/replace cycles. */
const originalExecutes = new Map<string, ToolExecute>();
const originalValidates = new Map<string, ToolValidate>();

const text = (value: unknown) => String(value ?? "").trim();

/** Ensure create tools still get format when wrap skips registry.validate. */
export function prepareDocumentToolInput(name: string, input: Record<string, unknown>, validate?: ToolValidate | null) {
  let next: Record<string, unknown> = { ...input };
  if (typeof validate === "function") {
    try {
      const validated = validate(next);
      if (validated && typeof validated === "object") next = { ...next, ...validated };
    } catch {
      // Fall through to format injection; execute may still succeed or return a clear error.
    }
  }
  if (name === "document.create_pdf" && text(next.format) !== "pdf") next = { ...next, format: "pdf" };
  if (name === "document.create_docx" && text(next.format) !== "docx") next = { ...next, format: "docx" };
  return next;
}

function mimeForName(name: string) {
  const extension = extname(name).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === ".md") return "text/markdown";
  if (extension === ".txt") return "text/plain";
  return "application/octet-stream";
}

function artifactTypeForName(name: string) {
  const extension = extname(name).toLowerCase().replace(".", "");
  return extension || "document";
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isDocumentOutputPath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  if (!DOCUMENT_EXTENSIONS.has(extname(normalized).toLowerCase())) return false;
  return normalized.startsWith("outputs/") || normalized.includes("/outputs/");
}

async function resolveUnderProject(projectRoot: string, relativePath: string) {
  const root = await realpath(projectRoot);
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary) && target !== root) throw new Error("BRAIN_DOCUMENT_PATH_INVALID");
  return { root, target, relativePath: normalizeRelativePath(relative(root, target) || relativePath) };
}

export async function persistDocumentOutput(
  deps: DocumentAgentToolDependencies,
  relativePathInput: string,
  options: { validationStatus?: string } = {}
) {
  const relativePath = normalizeRelativePath(relativePathInput);
  if (!isDocumentOutputPath(relativePath)) return null;
  const { target } = await resolveUnderProject(deps.projectRoot, relativePath);
  const fileStat = await stat(target);
  if (!fileStat.isFile() || fileStat.size <= 0) return null;
  const bytes = await readFile(target);
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const ownerId = await deps.ownerId();
  const logicalName = basename(relativePath);
  const existingFiles = deps.storage.listFiles(ownerId, deps.projectId);
  const samePath = existingFiles.filter((file) => file.storageKey === relativePath);
  const sameHash = samePath.find((file) => file.contentHash === contentHash);
  const file = sameHash || deps.storage.registerFile({
    ownerId,
    projectId: deps.projectId,
    logicalName,
    mimeType: mimeForName(logicalName),
    sizeBytes: bytes.length,
    contentHash,
    storageKey: relativePath,
    versionNo: (samePath[0]?.versionNo || 0) + 1
  });
  const artifacts = deps.storage.listArtifacts(ownerId, deps.projectId);
  const existingArtifact = artifacts.find((item) => item.storageKey === relativePath && item.contentHash === contentHash);
  const artifact = existingArtifact || deps.storage.registerArtifact({
    ownerId,
    projectId: deps.projectId,
    sourceFileId: file.id,
    sourceWorkspaceKey: "document",
    artifactType: artifactTypeForName(logicalName),
    storageKey: relativePath,
    contentHash,
    validationStatus: options.validationStatus || "VALID"
  });
  return { file, artifact, relativePath, size: bytes.length };
}

export async function syncDocumentOutputs(deps: DocumentAgentToolDependencies) {
  const { root } = await resolveUnderProject(deps.projectRoot, ".");
  const outputsDir = join(root, "outputs");
  let entries: string[] = [];
  try {
    entries = await readdir(outputsDir);
  } catch {
    return { synced: [] as string[] };
  }
  const synced: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(join("outputs", entry));
    if (!isDocumentOutputPath(relativePath)) continue;
    try {
      const persisted = await persistDocumentOutput(deps, relativePath);
      if (persisted) synced.push(persisted.relativePath);
    } catch {
      // Skip unreadable or raced files; next tool result can retry.
    }
  }
  return { synced };
}

function notify(deps: DocumentAgentToolDependencies, reason: string) {
  deps.notifyUi?.({ projectId: deps.projectId, reason });
}

function captureOriginalHandlers(runtime: ToolRuntime, name: string) {
  const tool = runtime.toolRegistry?.get?.(name);
  if (typeof tool?.execute === "function" && !originalExecutes.has(name)) {
    originalExecutes.set(name, tool.execute);
  }
  if (typeof tool?.validate === "function" && !originalValidates.has(name)) {
    originalValidates.set(name, tool.validate);
  }
  return {
    execute: originalExecutes.get(name) || null,
    validate: originalValidates.get(name) || (typeof tool?.validate === "function" ? tool.validate : null)
  };
}

function wrapDocumentTool(runtime: ToolRuntime, name: string, deps: DocumentAgentToolDependencies) {
  const prior = captureOriginalHandlers(runtime, name);
  if (!prior.execute) return false;
  const meta = runtime.toolRegistry?.get?.(name);
  runtime.registerExternalTool({
    name,
    title: meta?.title || name,
    description: meta?.description || "Create or write a document artifact and register it in the BRAIN document project.",
    namespace: "document",
    kind: meta?.kind || "write",
    risk: meta?.risk || "medium",
    requiresApproval: meta?.requiresApproval === true,
    inputSchema: meta?.inputSchema || { type: "object", additionalProperties: true }
  }, async (input, context) => {
    const prepared = prepareDocumentToolInput(name, input, prior.validate);
    const notifyArtifactPath = async (artifactPath) => {
      if (!artifactPath) return;
      try {
        await persistDocumentOutput(deps, artifactPath);
        notify(deps, `${name}:${artifactPath}`);
      } catch {
        // Keep the original tool success; registration can be repaired by sync.
      }
    };
    const result = await prior.execute!(prepared, {
      ...(context || {}),
      workspacePath: deps.projectRoot,
      onArtifactProgress: async (progress) => {
        await notifyArtifactPath(text(progress?.path));
      }
    });
    if (result?.ok === true) {
      const artifactPath = text((result as { artifact?: { path?: unknown } }).artifact?.path)
        || text(prepared.targetPath)
        || text(input.targetPath);
      await notifyArtifactPath(artifactPath);
    }
    return result as { ok: boolean; output?: string; [key: string]: unknown };
  });
  return true;
}

function wrapWorkspaceWriteFile(runtime: ToolRuntime, deps: DocumentAgentToolDependencies) {
  const prior = captureOriginalHandlers(runtime, WRITE_FILE_TOOL);
  if (!prior.execute) return false;
  const meta = runtime.toolRegistry?.get?.(WRITE_FILE_TOOL);
  runtime.registerExternalTool({
    name: WRITE_FILE_TOOL,
    title: meta?.title || "Write workspace file",
    description: meta?.description || "Write a workspace file.",
    namespace: "document",
    kind: meta?.kind || "write",
    risk: meta?.risk || "medium",
    requiresApproval: meta?.requiresApproval === true,
    inputSchema: meta?.inputSchema || { type: "object", additionalProperties: true }
  }, async (input, context) => {
    const prepared = prepareDocumentToolInput(WRITE_FILE_TOOL, input, prior.validate);
    const result = await prior.execute!(prepared, { ...(context || {}), workspacePath: deps.projectRoot });
    if (result?.ok === true) {
      const artifactPath = text((result as { artifact?: { path?: unknown } }).artifact?.path)
        || text(prepared.targetPath)
        || text(input.targetPath);
      if (artifactPath && isDocumentOutputPath(artifactPath)) {
        try {
          await persistDocumentOutput(deps, artifactPath);
          notify(deps, `${WRITE_FILE_TOOL}:${artifactPath}`);
        } catch {
          // Keep write success.
        }
      }
    }
    return result as { ok: boolean; output?: string; [key: string]: unknown };
  });
  return true;
}

/** Register document-scene wrappers so created outputs appear in 文件/产物. */
export function registerDocumentAgentTools(runtime: ToolRuntime, deps: DocumentAgentToolDependencies) {
  if (!deps.projectId.trim() || !deps.projectRoot.trim()) return;
  runtime.unregisterExternalTools("document");
  for (const name of DOCUMENT_CREATE_TOOLS) wrapDocumentTool(runtime, name, deps);
  wrapWorkspaceWriteFile(runtime, deps);

  runtime.registerExternalTool({
    name: "document.project.sync_outputs",
    title: "同步文档产物到右侧面板",
    description: "扫描当前文档项目 outputs/ 下的 PDF/DOCX/PPTX/Markdown，登记到右侧「文件」与「产物」。",
    namespace: "document",
    kind: "write",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const result = await syncDocumentOutputs(deps);
    notify(deps, "document.project.sync_outputs");
    return { ok: true, output: JSON.stringify(result) };
  });

  void syncDocumentOutputs(deps)
    .then((result) => {
      if (result.synced.length) notify(deps, "document.sync_existing");
    })
    .catch(() => undefined);

  runtime.registerExternalTool({
    name: "file.changeSet.create",
    title: "创建文档修订方案",
    description: "基于已有标注创建修改方案，并关联 document.revision 任务。",
    namespace: "document",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      required: ["annotationId", "baseFileVersion", "changeSummary"],
      properties: {
        annotationId: { type: "string" },
        baseFileVersion: { type: "number" },
        changeSummary: { type: "string" },
        diffJson: { type: "string" },
        conversationId: { type: "string" }
      },
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const annotationId = text(input.annotationId);
    const baseFileVersion = Number(input.baseFileVersion);
    const changeSummary = text(input.changeSummary);
    if (!annotationId || !Number.isFinite(baseFileVersion) || !changeSummary) {
      return { ok: false, output: "annotationId/baseFileVersion/changeSummary are required" };
    }
    const proposal = createDocumentRevisionProposal(deps.storage, {
      ownerId,
      projectId: deps.projectId,
      annotationId,
      baseFileVersion,
      changeSummary,
      diffJson: typeof input.diffJson === "string" ? input.diffJson : "{}",
      conversationId: typeof input.conversationId === "string" ? input.conversationId : undefined
    });
    notify(deps, `file.changeSet.create:${proposal.changeSet.id}`);
    return { ok: true, output: JSON.stringify(proposal) };
  });
}
