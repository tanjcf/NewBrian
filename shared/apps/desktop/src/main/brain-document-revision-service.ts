import { createHash } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { BrainChangeSetExportResult, BrainChangeSetPreviewResult } from "@codex-forge/protocol";
import type { TextDocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { DocumentChangeSetService } from "./document-change-set-service.ts";
import { replaceDocxParagraph } from "./docx-paragraph-rewriter.ts";
import { replaceXlsxCell } from "./xlsx-cell-rewriter.ts";
import { replacePptxShapeText } from "./pptx-shape-rewriter.ts";
import { addPdfAnnotation } from "./pdf-annotation-writer.ts";

interface RevisionDependencies {
  storage: BrainWorkspaceStorage;
  resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  changeSets?: DocumentChangeSetService;
}

/** Coordinates owner-scoped annotation previews and versioned exports inside an authorized workspace. */
export class BrainDocumentRevisionService {
  private readonly dependencies: RevisionDependencies;
  private readonly changeSets: DocumentChangeSetService;

  constructor(dependencies: RevisionDependencies) {
    this.dependencies = dependencies;
    this.changeSets = dependencies.changeSets ?? new DocumentChangeSetService();
  }

  async preview(ownerId: string, projectId: string, changeSetId: string): Promise<BrainChangeSetPreviewResult> {
    const context = await this.context(ownerId, projectId, changeSetId);
    if (context.annotation.anchor.format === "docx") throw new Error("DOCUMENT_CHANGE_SET_BINARY_PREVIEW_UNSUPPORTED");
    const preview = await this.changeSets.previewText({
      projectRoot: context.root,
      relativePath: context.file.storageKey,
      currentFileVersion: context.file.versionNo,
      changeSet: context.changeSet,
      textAnchor: context.annotation.anchor as TextDocumentAnchor,
      expectedContentHash: context.file.contentHash
    });
    return {
      changeSetId, annotationId: context.annotation.id, fileId: context.file.id,
      fileVersion: context.file.versionNo, relativePath: context.file.storageKey,
      contentHash: preview.contentHash, before: preview.before, after: preview.after,
      operations: preview.operations
    };
  }

  async export(ownerId: string, projectId: string, changeSetId: string): Promise<BrainChangeSetExportResult> {
    const context = await this.context(ownerId, projectId, changeSetId);
    const outputRelativePath = revisionPath(context.file.storageKey, context.file.versionNo + 1);
    const operation = this.structuredOperation(context.changeSet.diffJson);
    if (operation?.format === "docx") {
      const source = await readFile(join(context.root, context.file.storageKey));
      const bytes = await replaceDocxParagraph({ bytes: source, paragraphIndex: operation.paragraphIndex, start: operation.start, end: operation.end, replacement: operation.replacement });
      const outputPath = join(context.root, outputRelativePath); await writeFile(outputPath, bytes, { flag: "wx" });
      try {
        const fileStat = await stat(outputPath);
        const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        const file = this.dependencies.storage.registerFile({ ownerId, projectId, logicalName: basename(outputRelativePath), mimeType: context.file.mimeType, sizeBytes: fileStat.size, contentHash, storageKey: outputRelativePath, versionNo: context.file.versionNo + 1 });
        const changeSet = this.dependencies.storage.updateChangeSet({ ownerId, projectId, changeSetId, status: "ACCEPTED", resultFileVersion: context.file.versionNo + 1 });
        return { file, changeSet, relativePath: outputRelativePath };
      } catch (error) { await unlink(outputPath).catch(() => undefined); throw error; }
    }
    if (operation?.format === "xlsx") {
      const source = await readFile(join(context.root, context.file.storageKey));
      const bytes = await replaceXlsxCell({ bytes: source, sheet: operation.sheet, cell: operation.cell, value: operation.value });
      const outputPath = join(context.root, outputRelativePath); await writeFile(outputPath, bytes, { flag: "wx" });
      try {
        const fileStat = await stat(outputPath);
        const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        const file = this.dependencies.storage.registerFile({ ownerId, projectId, logicalName: basename(outputRelativePath), mimeType: context.file.mimeType, sizeBytes: fileStat.size, contentHash, storageKey: outputRelativePath, versionNo: context.file.versionNo + 1 });
        const changeSet = this.dependencies.storage.updateChangeSet({ ownerId, projectId, changeSetId, status: "ACCEPTED", resultFileVersion: context.file.versionNo + 1 });
        return { file, changeSet, relativePath: outputRelativePath };
      } catch (error) { await unlink(outputPath).catch(() => undefined); throw error; }
    }
    if (operation?.format === "pptx") {
      const source = await readFile(join(context.root, context.file.storageKey));
      const bytes = await replacePptxShapeText({ bytes: source, slide: operation.slide, shapeId: operation.shapeId, start: operation.start, end: operation.end, replacement: operation.replacement });
      const outputPath = join(context.root, outputRelativePath); await writeFile(outputPath, bytes, { flag: "wx" });
      try {
        const fileStat = await stat(outputPath);
        const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        const file = this.dependencies.storage.registerFile({ ownerId, projectId, logicalName: basename(outputRelativePath), mimeType: context.file.mimeType, sizeBytes: fileStat.size, contentHash, storageKey: outputRelativePath, versionNo: context.file.versionNo + 1 });
        const changeSet = this.dependencies.storage.updateChangeSet({ ownerId, projectId, changeSetId, status: "ACCEPTED", resultFileVersion: context.file.versionNo + 1 });
        return { file, changeSet, relativePath: outputRelativePath };
      } catch (error) { await unlink(outputPath).catch(() => undefined); throw error; }
    }
    if (operation?.format === "pdf") {
      const source = await readFile(join(context.root, context.file.storageKey));
      const bytes = await addPdfAnnotation({ bytes: source, page: operation.page, rect: operation.rect, text: operation.text });
      const outputPath = join(context.root, outputRelativePath); await writeFile(outputPath, bytes, { flag: "wx" });
      try { const fileStat = await stat(outputPath); const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`; const file = this.dependencies.storage.registerFile({ ownerId, projectId, logicalName: basename(outputRelativePath), mimeType: context.file.mimeType, sizeBytes: fileStat.size, contentHash, storageKey: outputRelativePath, versionNo: context.file.versionNo + 1 }); const changeSet = this.dependencies.storage.updateChangeSet({ ownerId, projectId, changeSetId, status: "ACCEPTED", resultFileVersion: context.file.versionNo + 1 }); return { file, changeSet, relativePath: outputRelativePath }; } catch (error) { await unlink(outputPath).catch(() => undefined); throw error; }
    }
    const result = await this.changeSets.exportTextRevision({
      projectRoot: context.root,
      relativePath: context.file.storageKey,
      outputRelativePath,
      currentFileVersion: context.file.versionNo,
      changeSet: context.changeSet,
      textAnchor: context.annotation.anchor as TextDocumentAnchor,
      expectedContentHash: context.file.contentHash
    });
    try {
      const fileStat = await stat(result.path);
      const file = this.dependencies.storage.registerFile({
        ownerId, projectId, logicalName: basename(outputRelativePath), mimeType: context.file.mimeType,
        sizeBytes: fileStat.size, contentHash: result.contentHash, storageKey: outputRelativePath,
        versionNo: result.fileVersion
      });
      const changeSet = this.dependencies.storage.updateChangeSet({
        ownerId, projectId, changeSetId, status: "ACCEPTED", resultFileVersion: result.fileVersion
      });
      return { file, changeSet, relativePath: outputRelativePath };
    } catch (error) {
      await unlink(result.path).catch(() => undefined);
      throw error;
    }
  }

  private async context(ownerId: string, projectId: string, changeSetId: string) {
    const project = this.dependencies.storage.getProject(ownerId, projectId);
    if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const changeSet = this.dependencies.storage.getChangeSet(ownerId, projectId, changeSetId);
    const annotation = this.dependencies.storage.getAnnotation(ownerId, projectId, changeSet.annotationId);
    if (annotation.anchor.format !== "txt" && annotation.anchor.format !== "markdown" && annotation.anchor.format !== "docx" && annotation.anchor.format !== "xlsx" && annotation.anchor.format !== "pptx" && annotation.anchor.format !== "pdf") {
      throw new Error("DOCUMENT_CHANGE_SET_FORMAT_UNSUPPORTED");
    }
    const file = this.dependencies.storage.getFile(ownerId, projectId, annotation.fileId);
    if (file.versionNo !== annotation.fileVersion || file.versionNo !== changeSet.baseFileVersion) {
      throw new Error("DOCUMENT_CHANGE_SET_VERSION_CONFLICT");
    }
    return { project, changeSet, annotation, file, root: await this.dependencies.resolveWorkspaceRoot(project.localWorkspaceId) };
  }

  private structuredOperation(diffJson: string) { try { const value = JSON.parse(diffJson); return value && typeof value === "object" && value.format ? value as { format: string; paragraphIndex: number; start: number; end: number; replacement: string; sheet: string; cell: string; value: string | number | boolean | null; slide: number; shapeId: string; page: number; rect: { x: number; y: number; width: number; height: number }; text: string } : null; } catch { return null; } }
}

function revisionPath(storageKey: string, version: number) {
  const extension = extname(storageKey);
  const name = basename(storageKey, extension);
  return join(dirname(storageKey), `${name}.v${version}${extension}`);
}
