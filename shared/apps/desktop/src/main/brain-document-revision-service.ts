import { stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { BrainChangeSetExportResult, BrainChangeSetPreviewResult } from "@codex-forge/protocol";
import type { TextDocumentAnchor } from "@codex-forge/protocol/document-anchor";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { DocumentChangeSetService } from "./document-change-set-service.ts";

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
    if (annotation.anchor.format !== "txt" && annotation.anchor.format !== "markdown") {
      throw new Error("DOCUMENT_CHANGE_SET_FORMAT_UNSUPPORTED");
    }
    const file = this.dependencies.storage.getFile(ownerId, projectId, annotation.fileId);
    if (file.versionNo !== annotation.fileVersion || file.versionNo !== changeSet.baseFileVersion) {
      throw new Error("DOCUMENT_CHANGE_SET_VERSION_CONFLICT");
    }
    return { project, changeSet, annotation, file, root: await this.dependencies.resolveWorkspaceRoot(project.localWorkspaceId) };
  }
}

function revisionPath(storageKey: string, version: number) {
  const extension = extname(storageKey);
  const name = basename(storageKey, extension);
  return join(dirname(storageKey), `${name}.v${version}${extension}`);
}
