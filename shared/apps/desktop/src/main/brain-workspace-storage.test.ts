import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  const project = storage.createProject({ ownerId: "owner-a", name: "策略实验", primaryWorkspaceKey: "quant" });
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
  storage.close();

  storage = new BrainWorkspaceStorage(root);
  try {
    assert.equal(storage.getProject("owner-a", project.id).lastConversationId, conversation.id);
    assert.equal(storage.listMessages("owner-a", conversation.id)[0]?.content, "测试 2025 年策略");
    assert.equal(storage.readDraft("owner-a", conversation.id)?.content, "未发送草稿");
  } finally {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  }
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
      assert.equal(Number(migrations.count), 1);
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
  const backupPath = `${databasePath}.v0-before-v1.bak`;
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(backup.prepare("SELECT value FROM legacy_local_data").get()?.value, "keep-me");
  backup.close();
  rmSync(root, { recursive: true, force: true });
});
