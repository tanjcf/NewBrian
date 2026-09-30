import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

export type DocumentRevisionProposalInput = {
  ownerId: string;
  projectId: string;
  annotationId: string;
  baseFileVersion: number;
  changeSummary: string;
  diffJson?: string;
  conversationId?: string;
  taskId?: string;
};

export function createDocumentRevisionProposal(
  storage: BrainWorkspaceStorage,
  input: DocumentRevisionProposalInput
) {
  const annotation = storage.getAnnotation(input.ownerId, input.projectId, input.annotationId);
  let taskId = input.taskId?.trim() || "";
  if (!taskId) {
    const task = storage.createTask({
      ownerId: input.ownerId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      workspaceKey: "document",
      taskType: "document.revision",
      idempotencyKey: `document.revision:${input.annotationId}:${Date.now()}`
    });
    taskId = task.id;
    storage.updateTask({
      ownerId: input.ownerId,
      taskId,
      status: "RUNNING",
      progress: 0.15,
      resultJson: JSON.stringify({
        changeSetPending: true,
        annotationId: annotation.id,
        fileId: annotation.fileId
      })
    });
  }
  const changeSet = storage.createChangeSet({
    ownerId: input.ownerId,
    projectId: input.projectId,
    annotationId: input.annotationId,
    taskId,
    baseFileVersion: input.baseFileVersion,
    changeSummary: input.changeSummary,
    diffJson: input.diffJson
  });
  storage.updateTask({
    ownerId: input.ownerId,
    taskId,
    status: "RUNNING",
    progress: 0.35,
    resultJson: JSON.stringify({
      changeSetId: changeSet.id,
      annotationId: annotation.id,
      fileId: annotation.fileId
    })
  });
  return { changeSet, taskId };
}

export function syncDocumentRevisionTask(
  storage: BrainWorkspaceStorage,
  input: {
    ownerId: string;
    projectId: string;
    changeSetId: string;
    outcome: "accepted" | "rejected" | "exported";
  }
) {
  const changeSet = storage.getChangeSet(input.ownerId, input.projectId, input.changeSetId);
  if (!changeSet.taskId) return null;
  if (input.outcome === "rejected") {
    storage.updateTask({
      ownerId: input.ownerId,
      taskId: changeSet.taskId,
      status: "CANCELLED",
      progress: 1,
      errorCode: "DOCUMENT_REVISION_REJECTED"
    });
    return changeSet;
  }
  if (input.outcome === "accepted") {
    return storage.updateTask({
      ownerId: input.ownerId,
      taskId: changeSet.taskId,
      status: "RUNNING",
      progress: 0.7
    });
  }
  storage.updateAnnotationStatus({
    ownerId: input.ownerId,
    projectId: input.projectId,
    annotationId: changeSet.annotationId,
    status: "APPLIED"
  });
  return storage.updateTask({
    ownerId: input.ownerId,
    taskId: changeSet.taskId,
    status: "SUCCEEDED",
    progress: 1,
    resultJson: JSON.stringify({
      changeSetId: changeSet.id,
      annotationId: changeSet.annotationId,
      exported: true
    })
  });
}
