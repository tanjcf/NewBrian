import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BrainStorageError, BrainWorkspaceStorage } from "./brain-workspace-storage.ts";

function withStorage(run: (storage: BrainWorkspaceStorage, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "brain-storage-"));
  const storage = new BrainWorkspaceStorage(root);
  try {
    run(storage, root);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("seeds all seven workspaces and rejects unknown workspace keys", () => {
  withStorage((storage) => {
    assert.deepEqual(storage.listWorkspaces().map((item) => item.workspaceKey), [
      "quant", "game", "video", "music", "data", "software", "document"
    ]);
    assert.throws(
      () => storage.createProject({ ownerId: "owner-a", name: "bad", primaryWorkspaceKey: "unknown" }),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_WORKSPACE_UNSUPPORTED"
    );
  });
});

test("persists projects conversations messages and drafts across restart", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-restart-"));
  let storage = new BrainWorkspaceStorage(root);
  const project = storage.createProject({ ownerId: "owner-a", name: "策略实验", primaryWorkspaceKey: "quant", localWorkspaceId: "workspace-local-1" });
  const conversation = storage.createConversation({ ownerId: "owner-a", projectId: project.id, title: "回测讨论" });
  storage.appendMessage({
    ownerId: "owner-a",
    conversationId: conversation.id,
    role: "user",
    content: "测试 2025 年策略",
    toolCallsJson: "[]",
    sourceRefsJson: "[]",
    requestId: "req-1"
  });
  storage.saveDraft({ ownerId: "owner-a", projectId: project.id, conversationId: conversation.id, content: "未发送草稿" });
  storage.saveQuantState(project.id, '{"version":1,"ledger":"durable"}');
  storage.close();

  storage = new BrainWorkspaceStorage(root);
  try {
    assert.equal(storage.getProject("owner-a", project.id).localWorkspaceId, "workspace-local-1");
    assert.equal(storage.getProject("owner-a", project.id).lastConversationId, conversation.id);
    assert.equal(storage.listMessages("owner-a", conversation.id)[0]?.content, "测试 2025 年策略");
    assert.equal(storage.readDraft("owner-a", conversation.id)?.content, "未发送草稿");
    assert.equal(storage.loadQuantState(project.id), '{"version":1,"ledger":"durable"}');
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("marks interrupted game previews failed on restart without replaying them", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "试玩恢复", primaryWorkspaceKey: "game" });
    const task = storage.createTask({
      ownerId: "owner-a",
      projectId: project.id,
      workspaceKey: "game",
      taskType: "game.preview",
      requestId: "preview-request",
      idempotencyKey: "preview-session",
      maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: task.id, status: "RUNNING", progress: 0.5 });

    assert.equal(storage.reconcileInterruptedGamePreviews(), 1);
    const recovered = storage.getTask("owner-a", task.id);
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.errorCode, "BRAIN_GAME_PREVIEW_INTERRUPTED");
    assert.match(recovered.resultJson, /replayed.*false/);
    assert.equal(storage.reconcileInterruptedGamePreviews(), 0);
  });
});

test("marks interrupted software tasks failed on restart without replaying side effects", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "自动化恢复", primaryWorkspaceKey: "software" });
    const task = storage.createTask({
      ownerId: "owner-a",
      projectId: project.id,
      workspaceKey: "software",
      taskType: "software.test",
      requestId: "software-request",
      idempotencyKey: "software-session",
      maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: task.id, status: "RUNNING", progress: 0.2 });

    assert.equal(storage.reconcileInterruptedSoftwareTasks(), 1);
    const recovered = storage.getTask("owner-a", task.id);
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.errorCode, "BRAIN_SOFTWARE_TASK_INTERRUPTED");
    assert.equal(JSON.parse(recovered.resultJson).replayed, false);
    assert.equal(storage.reconcileInterruptedSoftwareTasks(), 0);
  });
});

test("marks interrupted media renders failed on restart without replaying them", () => {
  withStorage((storage) => {
    const videoProject = storage.createProject({ ownerId: "owner-a", name: "视频恢复", primaryWorkspaceKey: "video" });
    const musicProject = storage.createProject({ ownerId: "owner-a", name: "音乐恢复", primaryWorkspaceKey: "music" });
    const videoTask = storage.createTask({
      ownerId: "owner-a",
      projectId: videoProject.id,
      workspaceKey: "video",
      taskType: "video_render",
      requestId: "video-request",
      idempotencyKey: "video-session",
      maxAttempts: 1
    });
    const musicTask = storage.createTask({
      ownerId: "owner-a",
      projectId: musicProject.id,
      workspaceKey: "music",
      taskType: "music_render",
      requestId: "music-request",
      idempotencyKey: "music-session",
      maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: videoTask.id, status: "RUNNING", progress: 0.2 });
    storage.updateTask({ ownerId: "owner-a", taskId: musicTask.id, status: "QUEUED", progress: 0 });

    assert.equal(storage.reconcileInterruptedMediaRenders(), 2);
    assert.equal(storage.getTask("owner-a", videoTask.id).errorCode, "BRAIN_MEDIA_RENDER_INTERRUPTED");
    assert.equal(storage.getTask("owner-a", musicTask.id).status, "FAILED");
    assert.equal(storage.reconcileInterruptedMediaRenders(), 0);
  });
});

test("enforces local owner boundaries", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "私有项目", primaryWorkspaceKey: "document" });
    assert.throws(
      () => storage.getProject("owner-b", project.id),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_PROJECT_FORBIDDEN"
    );
    assert.deepEqual(storage.listProjects({ ownerId: "owner-b" }), []);
  });
});

test("persists owner-scoped strategy schedules and claims one run per trading date", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "量化项目", primaryWorkspaceKey: "quant" });
    const scheduleInput = { ownerId: "owner-a", projectId: project.id, skillId: "trend", exchange: "SSE" as const, runAt: "15:10", symbol: "600519", quantity: 100 };
    const schedule = storage.createQuantStrategySchedule(scheduleInput);
    assert.equal(storage.createQuantStrategySchedule(scheduleInput).id, schedule.id);
    assert.equal(storage.listQuantStrategySchedules("owner-a", project.id)[0]?.id, schedule.id);
    assert.throws(() => storage.listQuantStrategySchedules("owner-b", project.id), /Project belongs to another local owner/);
    const runs = storage.quantStrategyScheduleStore();
    assert.equal(runs.listEnabled("owner-b").length, 0);
    assert.equal(runs.listEnabled("owner-a").length, 1);
    const key = `quant-strategy:${schedule.id}:2026-08-20`;
    const queued = storage.enqueueQuantStrategyExecution({ scheduleId: schedule.id, projectId: project.id, skillId: "trend", exchange: "SSE", tradingDate: "2026-08-20", idempotencyKey: key, symbol: "600519", quantity: 100 });
    assert.equal(queued.idempotencyKey, key);
    assert.match(queued.taskType, /^quant\.strategy\./u);
    assert.equal(JSON.parse(queued.resourceLimitsJson).symbol, "600519");
    assert.equal(storage.listRunnableQuantStrategyTasks("owner-b").length, 0);
    assert.equal(storage.listRunnableQuantStrategyTasks("owner-a").length, 1);
    assert.equal(storage.claimQuantStrategyTask("owner-b", queued.id), null);
    assert.equal(storage.claimQuantStrategyTask("owner-a", queued.id)?.status, "RUNNING");
    assert.equal(storage.claimQuantStrategyTask("owner-a", queued.id), null);
    assert.equal(runs.claim(schedule.id, "2026-08-20", key), true);
    assert.equal(runs.claim(schedule.id, "2026-08-20", key), false);
    runs.complete(schedule.id, "2026-08-20", key);
    assert.equal(runs.claim(schedule.id, "2026-08-20", key), false);
  });
});

test("lists conversations by owner project and workspace without leaking archived or foreign data", () => {
  withStorage((storage) => {
    const quant = storage.createProject({ ownerId: "owner-a", name: "量化项目", primaryWorkspaceKey: "quant" });
    const docs = storage.createProject({ ownerId: "owner-a", name: "文档项目", primaryWorkspaceKey: "document" });
    const foreign = storage.createProject({ ownerId: "owner-b", name: "其他用户", primaryWorkspaceKey: "quant" });
    const quantChat = storage.createConversation({ ownerId: "owner-a", projectId: quant.id, title: "策略讨论" });
    storage.createConversation({ ownerId: "owner-a", projectId: docs.id, title: "报告讨论" });
    storage.createConversation({ ownerId: "owner-b", projectId: foreign.id, title: "不可见" });

    assert.deepEqual(storage.listConversations({ ownerId: "owner-a", workspaceKey: "quant" }).map((item) => item.id), [quantChat.id]);
    assert.deepEqual(storage.listConversations({ ownerId: "owner-a", projectId: quant.id }).map((item) => item.title), ["策略讨论"]);
    assert.throws(
      () => storage.listConversations({ ownerId: "owner-a", projectId: foreign.id }),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_PROJECT_FORBIDDEN"
    );
  });
});

test("persists owner-scoped files idempotent tasks and validated artifacts", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "文档项目", primaryWorkspaceKey: "document" });
    const conversation = storage.createConversation({ ownerId: "owner-a", projectId: project.id, title: "修改报告" });
    const file = storage.registerFile({
      ownerId: "owner-a", projectId: project.id, logicalName: "报告.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1024, contentHash: "sha256:file", storageKey: "files/report.docx"
    });
    const taskInput = {
      ownerId: "owner-a", projectId: project.id, conversationId: conversation.id,
      workspaceKey: "document", taskType: "document.render", idempotencyKey: "render-report-v1"
    };
    const task = storage.createTask(taskInput);
    assert.equal(storage.createTask(taskInput).id, task.id);
    assert.equal(storage.updateTask({ ownerId: "owner-a", taskId: task.id, status: "RUNNING", progress: 0.5 }).progress, 0.5);
    const artifact = storage.registerArtifact({
      ownerId: "owner-a", projectId: project.id, taskId: task.id, sourceFileId: file.id,
      artifactType: "docx", storageKey: "artifacts/report-v2.docx", contentHash: "sha256:artifact", validationStatus: "VALID"
    });
    assert.deepEqual(storage.listFiles("owner-a", project.id).map((item) => item.id), [file.id]);
    assert.deepEqual(storage.listTasks("owner-a", project.id).map((item) => item.id), [task.id]);
    assert.deepEqual(storage.listArtifacts("owner-a", project.id).map((item) => item.id), [artifact.id]);
    assert.throws(
      () => storage.listFiles("owner-b", project.id),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_PROJECT_FORBIDDEN"
    );
  });
});

test("persists annotations and enforces file project ownership", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "文档项目", primaryWorkspaceKey: "document" });
    const file = storage.registerFile({ ownerId: "owner-a", projectId: project.id, logicalName: "说明.md", mimeType: "text/markdown", sizeBytes: 12, contentHash: "sha", storageKey: "files/readme.md" });
    const anchor = {
      anchorId: "markdown:line:2", objectId: "markdown:line:2", format: "markdown" as const,
      locator: { kind: "text-range" as const, startLine: 2, endLine: 2, startCharacter: 0, endCharacter: 3 },
      selectedText: "旧内容"
    };
    const annotation = storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, anchor, instruction: "替换为新内容" });
    assert.equal(storage.listAnnotations("owner-a", project.id)[0]?.id, annotation.id);
    assert.deepEqual(storage.listAnnotations("owner-a", project.id)[0]?.anchor, anchor);
    assert.equal(annotation.instruction, "替换为新内容");
    const dismissed = storage.createAnnotation({
      ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1,
      anchor, instruction: "不再修改", status: "DISMISSED", supersedesAnnotationId: annotation.id
    });
    assert.equal(dismissed.supersedesAnnotationId, annotation.id);
    const change = storage.createChangeSet({ ownerId: "owner-a", projectId: project.id, annotationId: annotation.id, baseFileVersion: 1, changeSummary: "替换标注文本", diffJson: JSON.stringify({ replace: "新内容" }) });
    assert.equal(storage.listChangeSets("owner-a", project.id)[0]?.status, "PROPOSED");
    assert.equal(change.annotationId, annotation.id);
    const accepted = storage.updateChangeSet({ ownerId: "owner-a", projectId: project.id, changeSetId: change.id, status: "ACCEPTED", resultFileVersion: 2 });
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(accepted.resultFileVersion, 2);
    assert.ok(accepted.reviewedAt);
    assert.throws(
      () => storage.updateChangeSet({ ownerId: "owner-b", projectId: project.id, changeSetId: change.id, status: "REJECTED" }),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_PROJECT_FORBIDDEN"
    );
    assert.throws(() => storage.createAnnotation({ ownerId: "owner-b", projectId: project.id, fileId: file.id, fileVersion: 1, anchor, instruction: "越权" }), (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_PROJECT_FORBIDDEN");
    assert.throws(
      () => storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 2, anchor, instruction: "过期版本" }),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_FILE_VERSION_CONFLICT"
    );
    assert.throws(
      () => storage.createAnnotation({ ownerId: "owner-a", projectId: project.id, fileId: file.id, fileVersion: 1, anchor: { ...anchor, anchorId: "" }, instruction: "无效锚点" }),
      (error: unknown) => error instanceof BrainStorageError && error.code === "BRAIN_ANNOTATION_INVALID"
    );
  });
});

test("migration is idempotent and private model metadata has no secret columns", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-migration-"));
  let storage = new BrainWorkspaceStorage(root);
  try {
    storage.close();
    storage = new BrainWorkspaceStorage(root);
    storage.close();
    const database = new DatabaseSync(join(root, "brain.db"), { readOnly: true });
    try {
      const migrations = database.prepare("SELECT COUNT(*) AS count FROM brain_schema_migration").get() as { count: number };
      assert.equal(Number(migrations.count), 10);
      const columns = database.prepare("PRAGMA table_info(brain_private_model_profile)").all() as Array<{ name: string }>;
      const columnNames = columns.map((column) => column.name);
      assert.equal(columnNames.some((name) => /api.?key|secret|authorization|token/i.test(name)), false);
      assert.ok(columnNames.includes("credential_ref"));
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persists reproducible data analysis artifacts by source hash", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-analysis-"));
  const storage = new BrainWorkspaceStorage(root);
  try {
    const project = storage.createProject({ ownerId: "owner-a", name: "数据", primaryWorkspaceKey: "data" });
    storage.saveDataset({ ownerId: "owner-a", dataset: { schemaVersion: 1, id: "d1", projectId: project.id, name: "指标", columns: [{ key: "close", label: "收盘", type: "number" }], rowCount: 2, contentHash: "a".repeat(64), updatedAt: "2026-08-20T00:00:00Z" } });
    const result = { datasetId: "d1", operation: "summary", inputHash: "b".repeat(64), columns: [{ key: "close", count: 2, min: 1, max: 2, mean: 1.5 }] };
    storage.saveDataAnalysis({ ownerId: "owner-a", projectId: project.id, datasetId: "d1", operation: "summary", inputHash: result.inputHash, result, createdAt: "2026-08-20T00:00:00Z" });
    storage.saveDataAnalysis({ ownerId: "owner-a", projectId: project.id, datasetId: "d1", operation: "summary", inputHash: result.inputHash, result, createdAt: "2026-08-20T00:01:00Z" });
    assert.equal(storage.listDataAnalyses("owner-a", project.id, "d1").length, 1);
  } finally { storage.close(); rmSync(root, { recursive: true, force: true }); }
});

test("backs up an existing database before applying a newer migration", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-backup-"));
  const databasePath = join(root, "brain.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE brain_schema_migration (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      installed_at TEXT NOT NULL
    );
    CREATE TABLE legacy_local_data(value TEXT NOT NULL);
    INSERT INTO legacy_local_data(value) VALUES ('keep-me');
  `);
  legacy.close();

  const storage = new BrainWorkspaceStorage(root);
  storage.close();
  const backupPath = `${databasePath}.v0-before-v10.bak`;
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(backup.prepare("SELECT value FROM legacy_local_data").get()?.value, "keep-me");
  backup.close();
  rmSync(root, { recursive: true, force: true });
});

test("creates verified snapshots and restores the latest snapshot after database corruption", () => {
  const root = mkdtempSync(join(tmpdir(), "brain-recovery-"));
  let storage = new BrainWorkspaceStorage(root);
  const project = storage.createProject({ ownerId: "owner-a", name: "可恢复项目", primaryWorkspaceKey: "software" });
  const backupPath = storage.createBackup("test");
  assert.equal(storage.verifyIntegrity().ok, true);
  storage.close();
  assert.equal(Boolean(backupPath), true);
  writeFileSync(join(root, "brain.db"), "not-a-sqlite-database", "utf8");

  storage = new BrainWorkspaceStorage(root);
  try {
    assert.equal(storage.getProject("owner-a", project.id).name, "可恢复项目");
    assert.equal(storage.verifyIntegrity().ok, true);
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prunes artifacts cache and terminal task metadata with separate retention budgets", () => {
  withStorage((storage) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "保留策略", primaryWorkspaceKey: "document" });
    const keep = storage.registerArtifact({
      ownerId: "owner-a", projectId: project.id, artifactType: "preview", storageKey: "keep.bin", contentHash: "sha256:keep"
    });
    const drop = storage.registerArtifact({
      ownerId: "owner-a", projectId: project.id, artifactType: "preview", storageKey: "drop.bin", contentHash: "sha256:drop"
    });
    const oldTask = storage.createTask({
      ownerId: "owner-a", projectId: project.id, workspaceKey: "document", taskType: "document.export",
      requestId: "old-task", idempotencyKey: "old-task", maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: oldTask.id, status: "SUCCEEDED", progress: 1 });

    const pruned = storage.pruneRetention({
      nowMs: Date.parse("2026-08-20T00:00:00.000Z"),
      budgets: {
        projectMetadata: { maxCount: 0, maxAgeMs: Number.MAX_SAFE_INTEGER },
        cache: { maxCount: 100, maxAgeMs: Number.MAX_SAFE_INTEGER },
        artifacts: { maxCount: 1, maxAgeMs: Number.MAX_SAFE_INTEGER },
        diagnostics: { maxCount: 100, maxAgeMs: Number.MAX_SAFE_INTEGER }
      }
    });
    assert.equal(pruned.artifacts, 1);
    assert.equal(pruned.projectMetadata, 1);
    assert.equal(storage.listArtifacts("owner-a", project.id).map((item) => item.id).join(","), drop.id);
    assert.equal(storage.listArtifacts("owner-a", project.id).some((item) => item.id === keep.id), false);
  });
});
test("restores interrupted tasks and cancelled markers after restart without replaying", () => {
  withStorage((storage, root) => {
    const project = storage.createProject({ ownerId: "owner-a", name: "恢复", primaryWorkspaceKey: "video" });
    const running = storage.createTask({
      ownerId: "owner-a", projectId: project.id, workspaceKey: "video", taskType: "video_render",
      requestId: "render-running", idempotencyKey: "render-running", maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: running.id, status: "RUNNING", progress: 0.4 });
    const cancelled = storage.createTask({
      ownerId: "owner-a", projectId: project.id, workspaceKey: "video", taskType: "video_render",
      requestId: "render-cancelled", idempotencyKey: "render-cancelled", maxAttempts: 1
    });
    storage.updateTask({ ownerId: "owner-a", taskId: cancelled.id, status: "CANCELLED", progress: 0.1 });
    const missingPath = join(root, "missing-output.mp4");
    const artifact = storage.registerArtifact({
      ownerId: "owner-a", projectId: project.id, taskId: cancelled.id, artifactType: "video",
      storageKey: "renders/missing-output.mp4", contentHash: "sha256:missing", validationStatus: "VALID"
    });

    const recovery = storage.restoreWorkspaceAfterRestart({
      resolveArtifactPath: () => missingPath
    });
    assert.equal(recovery.interruptedMediaRenders, 1);
    assert.equal(recovery.cancelledTasks, 1);
    assert.equal(recovery.artifactsInvalidated, 1);
    assert.equal(storage.getTask("owner-a", running.id).status, "FAILED");
    assert.equal(storage.getTask("owner-a", cancelled.id).status, "CANCELLED");
    assert.equal(storage.listArtifacts("owner-a", project.id).find((item) => item.id === artifact.id)?.validationStatus, "MISSING_AFTER_RESTART");
  });
});
