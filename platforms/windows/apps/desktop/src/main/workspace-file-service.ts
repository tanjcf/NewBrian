import { promises as fs } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { SearchResultSpec } from "@codex-forge/protocol";
import mammoth from "mammoth";
import {
  buildWorkspaceArtifactPreviewUrl,
  isAudioArtifactCandidate,
  isAudioArtifactPath,
  isHtmlArtifactExtension,
  isImageArtifactExtension,
  isVideoArtifactExtension,
  mimeTypeForArtifactPath,
  resolveArtifactMimeType,
  sniffAudioMimeFromBytes
} from "./workspace-artifact-protocol.js";
import { buildSpreadsheetPreview } from "./spreadsheet-preview.ts";

const spreadsheetExtensions = new Set([".xlsx", ".csv", ".tsv"]);

interface WorkspaceEntry {
  id: string;
  path: string;
}

export interface WorkspaceFileServiceDependencies {
  readWorkspaces: () => Promise<WorkspaceEntry[]>;
  resolveFile: (root: string, targetPath: string) => Promise<{ targetPath: string; relativePath: string }>;
}

const skippedDirectories = new Set([".git", "node_modules", ".newbrain", ".desktop-profile", "out", "dist", "build", "target"]);

/** Owns bounded workspace file discovery and safe file projections. */
export class WorkspaceFileService {
  private readonly dependencies: WorkspaceFileServiceDependencies;

  constructor(dependencies: WorkspaceFileServiceDependencies) {
    this.dependencies = dependencies;
  }

  async search(keyword: string): Promise<SearchResultSpec[]> {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const results: SearchResultSpec[] = [];
    for (const workspace of await this.dependencies.readWorkspaces()) {
      const pending = [workspace.path];
      while (pending.length > 0 && results.length < 40) {
        const directory = pending.shift();
        if (!directory) break;
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const entryPath = join(directory, entry.name);
          if (entry.isDirectory()) {
            if (!skippedDirectories.has(entry.name)) pending.push(entryPath);
            continue;
          }
          const relativePath = relative(workspace.path, entryPath);
          if (!normalizedKeyword
            || entry.name.toLowerCase().includes(normalizedKeyword)
            || relativePath.toLowerCase().includes(normalizedKeyword)) {
            results.push({
              id: `file-${workspace.id}-${relativePath}`,
              kind: "file",
              title: entry.name,
              detail: relativePath,
              workspaceId: workspace.id,
              filePath: entryPath
            });
          }
          if (results.length >= 40) break;
        }
      }
      if (results.length >= 40) break;
    }
    return results;
  }

  async read(input: { workspaceId: string; filePath: string }) {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const { targetPath, relativePath } = await this.dependencies.resolveFile(workspace.path, input.filePath);
    const stat = await fs.stat(targetPath);
    const maxBytes = 512 * 1024;
    const handle = await fs.open(targetPath, "r");
    try {
      const bytesToRead = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, 0);
      const binary = buffer.includes(0);
      return {
        path: relativePath,
        name: basename(targetPath),
        language: extname(targetPath).slice(1).toLowerCase() || "text",
        content: binary ? "" : buffer.toString("utf8"),
        binary,
        truncated: stat.size > maxBytes,
        size: stat.size
      };
    } finally {
      await handle.close();
    }
  }

  async preview(input: { workspaceId: string; filePath: string }) {
    try {
      const workspace = await this.requireWorkspace(input.workspaceId);
      const { targetPath, relativePath } = await this.dependencies.resolveFile(workspace.path, input.filePath);
      const stat = await fs.stat(targetPath);
      const extension = extname(targetPath).toLowerCase();
      const maxBytes = 40 * 1024 * 1024;
      if (stat.size > maxBytes) {
        return {
          ok: false as const,
          error: "文件超过 40 MB，无法在侧栏中预览。",
          reason: "read_failed" as const,
          path: relativePath,
          name: basename(targetPath)
        };
      }
      const buffer = await fs.readFile(targetPath);
      if (extension === ".pdf") {
        return {
          kind: "pdf" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: "application/pdf" as const,
          size: stat.size,
          dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}`
        };
      }
      if (extension === ".docx") {
        const result = await mammoth.convertToHtml({ buffer });
        return {
          kind: "docx" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
          size: stat.size,
          html: result.value
        };
      }
      if (extension === ".pptx") {
        return {
          kind: "pptx" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const,
          size: stat.size,
          dataUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${buffer.toString("base64")}`
        };
      }
      if (isHtmlArtifactExtension(extension)) {
        const normalizedRelative = relativePath.replace(/\\/g, "/");
        return {
          kind: "html" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: "text/html" as const,
          size: stat.size,
          content: buffer.toString("utf8"),
          previewUrl: buildWorkspaceArtifactPreviewUrl(input.workspaceId, normalizedRelative)
        };
      }
      if (isImageArtifactExtension(extension)) {
        const normalizedRelative = relativePath.replace(/\\/g, "/");
        return {
          kind: "image" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: mimeTypeForArtifactPath(targetPath),
          size: stat.size,
          previewUrl: buildWorkspaceArtifactPreviewUrl(input.workspaceId, normalizedRelative)
        };
      }
      if (isVideoArtifactExtension(extension)) {
        const normalizedRelative = relativePath.replace(/\\/g, "/");
        return {
          kind: "video" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: mimeTypeForArtifactPath(targetPath),
          size: stat.size,
          previewUrl: buildWorkspaceArtifactPreviewUrl(input.workspaceId, normalizedRelative)
        };
      }
      const sniffedAudio = sniffAudioMimeFromBytes(buffer);
      if (isAudioArtifactPath(targetPath) || isAudioArtifactCandidate(targetPath, input.filePath) || sniffedAudio) {
        const normalizedRelative = relativePath.replace(/\\/g, "/");
        return {
          kind: "audio" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: resolveArtifactMimeType(targetPath, buffer),
          size: stat.size,
          previewUrl: buildWorkspaceArtifactPreviewUrl(input.workspaceId, normalizedRelative)
        };
      }
      if (spreadsheetExtensions.has(extension)) {
        const preview = await buildSpreadsheetPreview(buffer, extension);
        return {
          kind: "spreadsheet" as const,
          path: relativePath,
          name: basename(targetPath),
          mimeType: extension === ".csv"
            ? "text/csv"
            : extension === ".tsv"
              ? "text/tab-separated-values"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: stat.size,
          sheets: preview.sheets
        };
      }
      if (extension === ".xls") {
        return {
          ok: false as const,
          error: "不支持旧版 .xls 格式，请转换为 .xlsx 或 .csv。",
          reason: "preview_unsupported" as const,
          path: relativePath,
          name: basename(targetPath)
        };
      }
      return {
        ok: false as const,
        error: "此文件类型不支持文档侧栏预览。",
        reason: "preview_unsupported" as const,
        path: relativePath,
        name: basename(targetPath)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false as const,
        error: message,
        reason: (/文件不存在|ENOENT|not found|无法预览/i.test(message) ? "missing_file" : "read_failed") as const,
        path: input.filePath,
        name: basename(input.filePath)
      };
    }
  }

  async open(input: { workspaceId: string; filePath: string }) {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const { relativePath } = await this.dependencies.resolveFile(workspace.path, input.filePath);
    return { ok: true, detail: "", path: relativePath };
  }

  async resolve(input: { workspaceId: string; filePath: string }) {
    const workspace = await this.requireWorkspace(input.workspaceId);
    return this.dependencies.resolveFile(workspace.path, input.filePath);
  }

  private async requireWorkspace(workspaceId: string) {
    const workspace = (await this.dependencies.readWorkspaces()).find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("Project not found.");
    return workspace;
  }
}
