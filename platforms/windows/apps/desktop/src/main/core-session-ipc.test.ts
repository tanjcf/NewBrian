import assert from "node:assert/strict";
import test from "node:test";

const { parseGeneratePatchInput } = await import(new URL("./core-session-contract.ts", import.meta.url).href);
const { CoreSessionService } = await import(new URL("./core-session-service.ts", import.meta.url).href);

test("accepts bounded patch input including an empty replacement", () => {
  assert.deepEqual(parseGeneratePatchInput({ filePath: "src/app.ts", searchText: "old", replaceText: "" }), {
    filePath: "src/app.ts", searchText: "old", replaceText: ""
  });
});

test("rejects malformed or oversized patch input", () => {
  assert.throws(() => parseGeneratePatchInput({ filePath: "", searchText: "old", replaceText: "new" }), /invalid/);
  assert.throws(() => parseGeneratePatchInput({ filePath: "src/app.ts", searchText: "", replaceText: "new" }), /invalid/);
  assert.throws(() => parseGeneratePatchInput({ filePath: "src/app.ts", searchText: "x".repeat(1_048_577), replaceText: "new" }), /invalid/);
});

function createCoreSessionFixture(options: { requireApproval?: boolean; activeThread?: boolean } = {}) {
  const events: string[] = [];
  const runtime: any = {
    workspacePath: process.cwd(),
    sessionMachine: { events: [{ type: "before" }] },
    getSnapshot: () => ({ source: "runtime" }),
    queueWorkspaceScan: async () => { events.push("scan"); return { operation: "scan" }; },
    queueShellCommand: async (command: string, input: any) => {
      events.push(`shell:${command}:${input.permissionMode}`);
      return { operation: "git" };
    },
    generatePatch: async (input: any) => { events.push(`patch:${input.filePath}`); return { operation: "patch" }; },
    applyPatch: async () => { events.push("apply"); return { operation: "apply" }; }
  };
  const service = new CoreSessionService({
    appName: "NewBrain", platform: "Windows", phase: "phase-1", shell: "PowerShell",
    getRuntime: () => runtime,
    getActiveThread: async () => options.activeThread === false
      ? {}
      : { workspace: { path: process.cwd() }, thread: { id: "thread" } },
    readThreadState: async () => ({ source: "thread" }),
    refreshWorkspaceTree: async () => { events.push("refresh"); },
    mergeSnapshot: (snapshot: any, threadState: any) => ({ ...snapshot, ...threadState }),
    getPreferences: async () => ({
      configuration: { requireApprovalForShell: options.requireApproval ?? false },
      git: { statusCommand: "git status --short" }
    }),
    saveActiveThreadState: async (summary: string) => { events.push(`save:${summary}`); },
    appendRuntimeEventsSince: async (offset: number) => { events.push(`events:${offset}`); }
  });
  return { service, events };
}

test("builds the core snapshot and refreshes only the matching active workspace", async () => {
  const { service, events } = createCoreSessionFixture();
  assert.deepEqual(await service.bootstrap(), {
    appName: "NewBrain", platform: "Windows", phase: "phase-1", shell: "PowerShell", workspacePath: process.cwd()
  });
  assert.deepEqual(await service.snapshot(), { source: "thread" });
  assert.deepEqual(events, ["refresh"]);

  const inactive = createCoreSessionFixture({ activeThread: false });
  assert.deepEqual(await inactive.service.snapshot(), { source: "runtime" });
  assert.deepEqual(inactive.events, []);
});

test("persists core operations before appending runtime events", async () => {
  const { service, events } = createCoreSessionFixture({ requireApproval: true });
  await service.queueWorkspaceScan();
  await service.queueGitStatus();
  await service.generatePatch({ filePath: "src/app.ts", searchText: "old", replaceText: "new" });
  await service.applyPatch();
  assert.deepEqual(events, [
    "scan", "save:已刷新工作区文件树", "events:1",
    "shell:git status --short:approval", "save:已记录 Git 状态", "events:1",
    "patch:src/app.ts", "save:已生成补丁: src/app.ts",
    "apply", "save:已应用补丁"
  ]);
});
