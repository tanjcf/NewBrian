import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

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

export type ExploreAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
};

const WRITE_FILE_TOOL = "workspace.write_file";
const originalExecutes = new Map<string, ToolExecute>();
const originalValidates = new Map<string, ToolValidate>();

const text = (value: unknown) => String(value ?? "").trim();

function mimeForName(name: string) {
  const extension = extname(name).toLowerCase();
  if (extension === ".md") return "text/markdown";
  if (extension === ".txt") return "text/plain";
  if (extension === ".json") return "application/json";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function artifactTypeForName(name: string) {
  const extension = extname(name).toLowerCase().replace(".", "");
  return extension || "file";
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function resolveUnderProject(projectRoot: string, relativePath: string) {
  const root = await realpath(projectRoot);
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary) && target !== root) throw new Error("BRAIN_EXPLORE_PATH_INVALID");
  return { root, target, relativePath: normalizeRelativePath(relative(root, target) || relativePath) };
}

function notify(deps: ExploreAgentToolDependencies, reason: string) {
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

/** Register a written workspace file into BRAIN 文件/产物/任务 for the explore scene. */
export async function persistExploreWrite(
  deps: ExploreAgentToolDependencies,
  relativePathInput: string
) {
  const relativePath = normalizeRelativePath(relativePathInput);
  if (!relativePath || relativePath.includes("..")) return null;
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
    sourceWorkspaceKey: "explore",
    artifactType: artifactTypeForName(logicalName),
    storageKey: relativePath,
    contentHash,
    validationStatus: "VALID"
  });
  const task = deps.storage.createTask({
    ownerId,
    projectId: deps.projectId,
    workspaceKey: "explore",
    taskType: "explore.workspace.write_file",
    requestId: `explore-write:${relativePath}:${contentHash}`,
    idempotencyKey: `explore-write:${deps.projectId}:${relativePath}:${contentHash}`
  });
  const completed = deps.storage.updateTask({
    ownerId,
    taskId: task.id,
    status: "SUCCEEDED",
    progress: 1,
    resultJson: JSON.stringify({ relativePath, sizeBytes: bytes.length, fileId: file.id, artifactId: artifact.id })
  });
  return { file, artifact, task: completed, relativePath, size: bytes.length };
}

function wrapWorkspaceWriteFile(runtime: ToolRuntime, deps: ExploreAgentToolDependencies) {
  const prior = captureOriginalHandlers(runtime, WRITE_FILE_TOOL);
  if (!prior.execute) return false;
  const meta = runtime.toolRegistry?.get?.(WRITE_FILE_TOOL);
  runtime.registerExternalTool({
    name: WRITE_FILE_TOOL,
    title: meta?.title || "Write workspace file",
    description: meta?.description || "Write a workspace file.",
    namespace: "explore",
    kind: meta?.kind || "write",
    risk: meta?.risk || "medium",
    requiresApproval: meta?.requiresApproval === true,
    inputSchema: meta?.inputSchema || { type: "object", additionalProperties: true }
  }, async (input, context) => {
    let prepared: Record<string, unknown> = { ...input };
    if (typeof prior.validate === "function") {
      try {
        const validated = prior.validate(prepared);
        if (validated && typeof validated === "object") prepared = { ...prepared, ...validated };
      } catch {
        // Keep original input; execute may still succeed.
      }
    }
    const result = await prior.execute!(prepared, { ...(context || {}), workspacePath: deps.projectRoot });
    if (result?.ok === true) {
      const artifactPath = text((result as { artifact?: { path?: unknown } }).artifact?.path)
        || text(prepared.targetPath)
        || text(prepared.path)
        || text(input.targetPath)
        || text(input.path);
      if (artifactPath) {
        try {
          await persistExploreWrite(deps, artifactPath);
          notify(deps, `${WRITE_FILE_TOOL}:${artifactPath}`);
        } catch {
          // Keep write success; panel sync can retry later.
        }
      }
    }
    return result as { ok: boolean; output?: string; [key: string]: unknown };
  });
  return true;
}

/** Register explore-scene wrappers so workspace writes appear in 文件/产物/任务. */
export function registerExploreAgentTools(runtime: ToolRuntime, deps: ExploreAgentToolDependencies) {
  if (!deps.projectId.trim() || !deps.projectRoot.trim()) return;
  runtime.unregisterExternalTools("explore");
  wrapWorkspaceWriteFile(runtime, deps);
}
