import { promises as fs } from "node:fs";
import type { WorkspaceCatalogItem, WorkspaceThreadRecord } from "@codex-forge/protocol";
import { desktopIpcChannels } from "@codex-forge/protocol";
import { applyApplicationSkillPolicy } from "./application-skill-policy.js";
import { extractTextAttachment } from "./attachment-text.js";
import { DesktopArtifactPreviewService } from "./desktop-artifact-preview-service.js";
import { registerOfficialGovernmentWebTools } from "./official-government-web-tools.js";
import type { OfficialGovernmentWebService } from "./official-government-web-service.js";
import { registerDesktopWebSearchTools } from "./desktop-web-search-tools.js";
import type { DesktopWebSearchClient } from "./desktop-web-search-client.js";
import { resolveExistingFileInsideRoot } from "./path-security.js";
import {
  assertWorkspaceMediaKind,
  buildWorkspaceMediaOpenPayload,
  type WorkspaceMediaKind
} from "./workspace-media-tools.js";
import { ARTIFACT_PROTOCOL_MAX_BYTES } from "./workspace-artifact-protocol.js";

type ModelChatRuntime = {
  unregisterExternalTools(namespace: string): unknown;
  registerExternalTool(definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<unknown> | unknown): unknown;
  artifacts: { render(input: { targetPath: string; kind?: string }): Promise<Record<string, unknown>> };
  addSkillRoots(roots: string[]): Promise<unknown>;
  setDisabledSkills(names: string[]): Promise<unknown>;
};

export interface ModelChatRuntimeSetupDependencies {
  userSkillRoot: string;
  readFeatureSkills: () => Promise<Array<{ name: string; status: string }>>;
  officialGovernmentWebService: OfficialGovernmentWebService;
  desktopWebSearchClient: Pick<DesktopWebSearchClient, "search" | "searchMarketNews" | "fetchPage">;
  readWorkspaceCatalog: () => Promise<{ workspaces: WorkspaceCatalogItem[] }>;
  getActiveWorkspaceId: () => string;
  publishWorkspaceFilePreview: (event: { workspaceId: string; filePath: string; kind: WorkspaceMediaKind }) => void;
}

/**
 * Open a workspace-relative image/video in the side panel.
 * Used by workspace.open_* tools and Auto media download completion.
 */
export async function openWorkspaceMediaForAgent(
  deps: ModelChatRuntimeSetupDependencies,
  kind: WorkspaceMediaKind,
  targetPath: string,
  options?: { workspaceId?: string }
) {
  const catalog = await deps.readWorkspaceCatalog();
  const workspaceId = String(options?.workspaceId || deps.getActiveWorkspaceId() || "").trim();
  const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("No active workspace is available for media preview.");
  const requestedPath = assertWorkspaceMediaKind(targetPath, kind);
  const { targetPath: resolvedPath, relativePath } = await resolveExistingFileInsideRoot(
    workspace.path,
    requestedPath
  );
  assertWorkspaceMediaKind(relativePath, kind);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) throw new Error(`${relativePath} is not a file.`);
  if (stat.size > ARTIFACT_PROTOCOL_MAX_BYTES) {
    throw new Error(`Media file exceeds the ${ARTIFACT_PROTOCOL_MAX_BYTES} byte side-panel preview limit.`);
  }
  const payload = buildWorkspaceMediaOpenPayload({
    workspaceId: workspace.id,
    relativePath,
    kind,
    size: stat.size
  });
  deps.publishWorkspaceFilePreview({
    workspaceId: workspace.id,
    filePath: payload.path,
    kind
  });
  return {
    ok: true,
    exitCode: 0,
    output: JSON.stringify(payload),
    command: `${kind === "image" ? "workspace.open_image" : "workspace.open_video"} ${payload.path}`
  };
}

export function registerDesktopArtifactRenderer(
  targetRuntime: ModelChatRuntime,
  workspaceRoot: string
) {
  const previewService = new DesktopArtifactPreviewService({
    renderBase: (input) => targetRuntime.artifacts.render(input),
    resolveFile: (targetPath) => resolveExistingFileInsideRoot(workspaceRoot, targetPath),
    extractText: extractTextAttachment
  });
  targetRuntime.registerExternalTool({
    name: "artifact.render",
    title: "Render artifact preview",
    description: "Render a bounded semantic preview for code, web, PDF, Word, spreadsheet, and presentation artifacts.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "desktop-artifact-renderer",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", minLength: 1 },
        kind: { type: "string", enum: ["code", "document", "spreadsheet", "presentation", "web", "binary"] }
      },
      required: ["targetPath"],
      additionalProperties: false
    }
  }, async (toolInput) => {
    const input = toolInput as { targetPath: string; kind?: string };
    return previewService.render(input);
  });
}

export function registerWorkspaceMediaAgentTools(
  deps: ModelChatRuntimeSetupDependencies,
  targetRuntime: ModelChatRuntime,
  options?: { workspaceId?: string }
) {
  targetRuntime.unregisterExternalTools("workspace-media");
  const workspaceId = String(options?.workspaceId || "").trim() || undefined;
  const imageSchema = {
    type: "object",
    properties: {
      targetPath: {
        type: "string",
        minLength: 1,
        description: "Workspace-relative image path such as outputs/chart.png"
      }
    },
    required: ["targetPath"],
    additionalProperties: false
  };
  const videoSchema = {
    type: "object",
    properties: {
      targetPath: {
        type: "string",
        minLength: 1,
        description: "Workspace-relative video path such as outputs/demo.mp4"
      }
    },
    required: ["targetPath"],
    additionalProperties: false
  };
  const openImage = async (input: { targetPath?: string }) =>
    openWorkspaceMediaForAgent(deps, "image", String(input.targetPath ?? ""), { workspaceId });
  const openVideo = async (input: { targetPath?: string }) =>
    openWorkspaceMediaForAgent(deps, "video", String(input.targetPath ?? ""), { workspaceId });
  targetRuntime.registerExternalTool({
    name: "workspace.open_image",
    title: "打开图片预览",
    description: "Open a workspace image in the NewBrain side-panel viewer via newbrain-artifact://.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "workspace-media",
    inputSchema: imageSchema
  }, openImage);
  targetRuntime.registerExternalTool({
    name: "artifact.open_image",
    title: "打开图片预览",
    description: "Alias of workspace.open_image.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "workspace-media",
    inputSchema: imageSchema
  }, openImage);
  targetRuntime.registerExternalTool({
    name: "workspace.open_video",
    title: "打开视频预览",
    description: "Open a workspace video in the NewBrain side-panel player via newbrain-artifact://.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "workspace-media",
    inputSchema: videoSchema
  }, openVideo);
  targetRuntime.registerExternalTool({
    name: "artifact.open_video",
    title: "打开视频预览",
    description: "Alias of workspace.open_video.",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    namespace: "workspace-media",
    inputSchema: videoSchema
  }, openVideo);
}

export async function configureModelChatRuntime(
  deps: ModelChatRuntimeSetupDependencies,
  targetRuntime: ModelChatRuntime,
  workspace: WorkspaceCatalogItem,
  _thread: WorkspaceThreadRecord
) {
  registerDesktopArtifactRenderer(targetRuntime, workspace.path);
  registerWorkspaceMediaAgentTools(deps, targetRuntime, { workspaceId: workspace.id });
  registerOfficialGovernmentWebTools(targetRuntime, deps.officialGovernmentWebService);
  registerDesktopWebSearchTools(targetRuntime, deps.desktopWebSearchClient);
  await applyApplicationSkillPolicy(targetRuntime, deps.userSkillRoot, deps.readFeatureSkills);
}

export function publishWorkspaceFilePreviewFromMain(
  mainWindowRef: { webContents: { send(channel: string, payload: unknown): void } } | null,
  event: { workspaceId: string; filePath: string; kind: WorkspaceMediaKind }
) {
  mainWindowRef?.webContents.send(desktopIpcChannels.events.openWorkspaceFilePreview, event);
}
