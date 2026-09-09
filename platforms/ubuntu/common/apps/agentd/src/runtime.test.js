import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalRuntime } from "./runtime.js";

test("runtime exposes agent approval state and resumes the model loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-runtime-"));
  try {
    writeFileSync(join(root, "hello.txt"), "hello");
    const runtime = await createLocalRuntime({
      runtimeId: "test",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test",
      skillRoots: []
    });
    let requests = 0;
    const events = [];
    const callModel = async () => {
      requests += 1;
      return requests === 1
        ? { toolCalls: [{ id: "scan-1", name: "workspace.scan", arguments: "{}" }] }
        : { content: "Scan complete." };
    };
    runtime.startAgentLoop([{ role: "user", content: "scan" }], {
      permissionMode: "approval",
      onEvent: (event) => events.push(event.type)
    });
    const paused = await runtime.advanceAgentLoop(callModel);
    assert.equal(paused.status, "awaiting-approval");
    assert.equal(runtime.getSnapshot().approval?.toolRequestId, "scan-1");
    const completed = await runtime.resumeAgentApproval(true, callModel);
    assert.equal(completed.status, "completed");
    assert.equal(runtime.getSnapshot().approval, undefined);
    assert.equal(runtime.getSnapshot().messages.at(-1)?.content, "Scan complete.");
    assert.equal(runtime.getSnapshot().runs[0]?.status, "completed");
    assert.ok(events.includes("tool_call"));
    assert.ok(events.includes("approval_requested"));
    assert.ok(events.includes("tool_result"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime blocks critical shell commands before creating an approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-runtime-policy-"));
  try {
    const runtime = await createLocalRuntime({
      runtimeId: "policy-test", workspacePath: root, platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    const snapshot = await runtime.queueShellCommand("shutdown /s /t 0", { permissionMode: "full" });
    assert.equal(snapshot.approval, undefined);
    assert.equal(snapshot.session.status, "failed");
    assert.equal(snapshot.runs[0].status, "failed");
    assert.match(snapshot.runs[0].output, /blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime exposes dynamically registered MCP-style tools to the agent loop", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-runtime-mcp-"));
  try {
    const runtime = await createLocalRuntime({
      runtimeId: "mcp-test", workspacePath: root, platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    runtime.registerExternalTool({
      name: "mcp__demo__lookup", namespace: "mcp", description: "Lookup", inputSchema: { type: "object" }
    }, async () => ({ ok: true, output: "found" }));
    assert.ok(runtime.getToolDescriptors().some((tool) => tool.name === "mcp__demo__lookup"));
    runtime.startAgentLoop([{ role: "user", content: "lookup" }], { permissionMode: "full" });
    let calls = 0;
    const result = await runtime.advanceAgentLoop(async ({ tools }) => {
      calls += 1;
      assert.ok(tools.some((tool) => tool.name === "mcp__demo__lookup"));
      return calls === 1
        ? { toolCalls: [{ id: "m1", name: "mcp__demo__lookup", arguments: "{}" }] }
        : { content: "done" };
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(runtime.unregisterExternalTools("mcp"), ["mcp__demo__lookup"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty shell commands are returned to the model instead of aborting the turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-runtime-empty-shell-"));
  try {
    const runtime = await createLocalRuntime({
      runtimeId: "empty-shell-test", workspacePath: root, platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    runtime.startAgentLoop([{ role: "user", content: "run" }], { permissionMode: "full" });
    let calls = 0;
    const result = await runtime.advanceAgentLoop(async ({ messages }) => {
      calls += 1;
      return calls === 1
        ? { toolCalls: [{ id: "bad-shell", name: "shell.exec", arguments: "{}" }] }
        : { content: messages.at(-1)?.content || "missing tool error" };
    });
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /Shell command cannot be empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime creates and loads the project manager skill for user shadow updates", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shadow-"));
  try {
    const runtime = await createLocalRuntime({
      runtimeId: "shadow-test",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test"
    });
    const projectSkill = runtime.matchSkills("普通项目请求")[0];
    assert.equal(projectSkill.name, `${root.split(/[\\/]/).at(-1).toLowerCase()}-project-manager`);
    assert.ok(existsSync(join(root, ".newbrain", "skills", projectSkill.name, "SKILL.md")));
    const loadedSkill = await runtime.loadSkill(projectSkill.name);
    assert.deepEqual(loadedSkill.resources.references, [
      "project-knowledge.md",
      "session-digest.md",
      "user-output-rules.md"
    ]);

    const result = await runtime.rememberExchangeWithShadow({
      user: "以后这个项目必须把架构和功能细节写进知识文档，输出要中文总结。",
      assistant: "已更新项目规则。",
      scope: "session"
    });
    assert.ok(result.shadow.changed.includes("user-output-rules"));
    const rules = readFileSync(join(root, ".newbrain", "skills", projectSkill.name, "references", "user-output-rules.md"), "utf8");
    assert.match(rules, /架构和功能细节/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("user shadow preserves concurrent thread updates for the same project", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shadow-race-"));
  try {
    const first = await createLocalRuntime({
      runtimeId: "shadow-race-a",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test"
    });
    const second = await createLocalRuntime({
      runtimeId: "shadow-race-b",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test"
    });
    const projectSkill = first.matchSkills("project")[0];
    await Promise.all([
      first.rememberExchangeWithShadow({
        user: "Thread A must preserve RULE_ALPHA_UNIQUE in project skill.",
        assistant: "A done",
        scope: "session"
      }),
      second.rememberExchangeWithShadow({
        user: "Thread B must preserve RULE_BETA_UNIQUE in project skill.",
        assistant: "B done",
        scope: "session"
      })
    ]);
    const refs = join(root, ".newbrain", "skills", projectSkill.name, "references");
    const rules = readFileSync(join(refs, "user-output-rules.md"), "utf8");
    const digest = readFileSync(join(refs, "session-digest.md"), "utf8");
    assert.match(rules, /RULE_ALPHA_UNIQUE/);
    assert.match(rules, /RULE_BETA_UNIQUE/);
    assert.match(digest, /RULE_ALPHA_UNIQUE/);
    assert.match(digest, /RULE_BETA_UNIQUE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("user shadow creates the workspace root before writing project skills", async () => {
  const parent = mkdtempSync(join(tmpdir(), "newbrain-shadow-parent-"));
  const root = join(parent, "New Project");
  try {
    const runtime = await createLocalRuntime({
      runtimeId: "shadow-missing-root",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test"
    });
    const projectSkill = runtime.matchSkills("new project")[0];
    assert.ok(existsSync(join(root, ".newbrain", "skills", projectSkill.name, "SKILL.md")));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("user shadow preserves updates from separate runtime processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-shadow-process-"));
  try {
    const worker = `
      import { createLocalRuntime } from "./src/runtime.js";
      const runtime = await createLocalRuntime({
        runtimeId: "process-" + process.env.NEWBRAIN_TEST_INDEX,
        workspacePath: process.env.NEWBRAIN_TEST_ROOT,
        platformLabel: "test",
        shellLabel: "test"
      });
      await runtime.rememberExchangeWithShadow({
        user: "Process " + process.env.NEWBRAIN_TEST_INDEX + " must preserve UNIQUE_PROCESS_" + process.env.NEWBRAIN_TEST_INDEX + " in output rules.",
        assistant: "done " + process.env.NEWBRAIN_TEST_INDEX,
        scope: "session"
      });
    `;
    await Promise.all([0, 1, 2, 3].map((index) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", worker], {
        cwd: process.cwd(),
        env: { ...process.env, NEWBRAIN_TEST_INDEX: String(index), NEWBRAIN_TEST_ROOT: root },
        stdio: "pipe"
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve(undefined);
        else reject(new Error(`worker ${index} exited ${code}\n${output}`));
      });
    })));
    const runtime = await createLocalRuntime({
      runtimeId: "process-audit",
      workspacePath: root,
      platformLabel: "test",
      shellLabel: "test"
    });
    const projectSkill = runtime.matchSkills("project")[0];
    const refs = join(root, ".newbrain", "skills", projectSkill.name, "references");
    const rules = readFileSync(join(refs, "user-output-rules.md"), "utf8");
    const digest = readFileSync(join(refs, "session-digest.md"), "utf8");
    for (const index of [0, 1, 2, 3]) {
      assert.match(rules, new RegExp(`UNIQUE_PROCESS_${index}`));
      assert.match(digest, new RegExp(`UNIQUE_PROCESS_${index}`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patch generation rejects symlinks that escape the workspace", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "newbrain-runtime-link-"));
  const outside = mkdtempSync(join(tmpdir(), "newbrain-runtime-outside-"));
  try {
    const outsideFile = join(outside, "secret.txt");
    writeFileSync(outsideFile, "secret");
    try {
      symlinkSync(outsideFile, join(root, "linked.txt"), "file");
    } catch (error) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    const runtime = await createLocalRuntime({
      runtimeId: "link-test", workspacePath: root, platformLabel: "test", shellLabel: "test", skillRoots: []
    });
    await assert.rejects(
      runtime.generatePatch({ filePath: "linked.txt", searchText: "secret", replaceText: "changed" }),
      /resolves outside/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
