import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import { persistExploreWrite, registerExploreAgentTools } from "./explore-agent-tools.ts";

test("persistExploreWrite registers file, artifact, and succeeded task", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-explore-tools-"));
  const storage = new BrainWorkspaceStorage(join(root, "brain.sqlite"));
  const project = storage.createProject({
    ownerId: "owner-a",
    name: "探索项目",
    primaryWorkspaceKey: "explore",
    localWorkspaceId: "ws-explore-1"
  });
  const relativePath = "explore-e2e-note.txt";
  await writeFile(join(root, relativePath), Buffer.from("场景学习探索E2E验收", "utf8"));

  const persisted = await persistExploreWrite({
    ownerId: async () => "owner-a",
    projectId: project.id,
    projectRoot: root,
    storage
  }, relativePath);

  assert.ok(persisted);
  assert.equal(persisted.file.logicalName, "explore-e2e-note.txt");
  assert.equal(persisted.file.storageKey, relativePath);
  assert.ok(persisted.file.sizeBytes > 0);
  assert.equal(persisted.artifact.sourceWorkspaceKey, "explore");
  assert.equal(persisted.task.status, "SUCCEEDED");
  assert.equal(storage.listFiles("owner-a", project.id).length, 1);
  assert.equal(storage.listArtifacts("owner-a", project.id).length, 1);
  assert.equal(storage.listTasks("owner-a", project.id).length, 1);
});

test("registerExploreAgentTools wraps write_file and notifies UI", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-explore-wrap-"));
  const storage = new BrainWorkspaceStorage(join(root, "brain.sqlite"));
  const project = storage.createProject({
    ownerId: "owner-b",
    name: "探索包装",
    primaryWorkspaceKey: "explore",
    localWorkspaceId: "ws-explore-2"
  });
  const notifies: Array<{ projectId: string; reason: string }> = [];
  const toolState = {
    execute: async (input: Record<string, unknown>) => {
      const targetPath = String(input.targetPath || "note.txt");
      await writeFile(join(root, targetPath), Buffer.from("hello explore", "utf8"));
      return { ok: true, artifact: { path: targetPath, size: 13, changeType: "created" } };
    }
  };
  const runtime = {
    unregisterExternalTools() {},
    registerExternalTool(_definition: Record<string, unknown>, execute: typeof toolState.execute) {
      toolState.execute = execute as typeof toolState.execute;
    },
    toolRegistry: {
      get(name: string) {
        if (name !== "workspace.write_file") return undefined;
        return {
          name,
          title: "Write",
          description: "Write",
          execute: async (input: Record<string, unknown>) => {
            const targetPath = String(input.targetPath || "note.txt");
            await writeFile(join(root, targetPath), Buffer.from("hello explore", "utf8"));
            return { ok: true, artifact: { path: targetPath, size: 13, changeType: "created" } };
          }
        };
      }
    }
  };

  registerExploreAgentTools(runtime as never, {
    ownerId: async () => "owner-b",
    projectId: project.id,
    projectRoot: root,
    storage,
    notifyUi: (payload) => notifies.push(payload)
  });

  const result = await toolState.execute({ targetPath: "wrapped-note.txt" });
  assert.equal(result.ok, true);
  assert.equal(storage.listFiles("owner-b", project.id).length, 1);
  assert.equal(storage.listArtifacts("owner-b", project.id).length, 1);
  assert.equal(storage.listTasks("owner-b", project.id).length, 1);
  assert.ok(notifies.some((item) => item.projectId === project.id));
});
