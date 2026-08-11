import assert from "node:assert/strict";
import test from "node:test";
const { DesktopNativeCapabilityService } = await import(new URL("./desktop-native-capability-service.ts", import.meta.url).href);

function makeService(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const service = new DesktopNativeCapabilityService({
    platform: "win32",
    userSkillRoot: "C:\\skills",
    projectSkillRoot: "C:\\project-skills",
    logRoot: "C:\\logs",
    logFiles: { debug: "debug.log", diagnostics: "diagnostics.log", auth: "auth.log", sqlite: "logs.sqlite" },
    getDefaultWorkspacePath: () => "C:\\default",
    getActiveWorkspaceId: () => "workspace-1",
    readWorkspaces: async () => [{ id: "workspace-1", path: "C:\\project" }],
    readSkills: async () => [{ id: "skill-1", name: "safe-skill" }],
    normalizeSkillName: (name: string) => name.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    skillManifestExists: (path: string) => path === "C:\\skills\\safe-skill\\SKILL.md",
    ensureDirectory: async (path: string) => { events.push(`mkdir:${path}`); },
    openPath: async (path: string) => { events.push(`open:${path}`); return ""; },
    getTools: () => [{ id: "terminal", label: "Terminal", kind: "system", icon: "TM", available: true, appName: "Terminal", commands: ["wt.exe"] }],
    resolveToolCommand: () => "wt.exe",
    commandAvailable: () => true,
    spawnDetached: async (command: string, args: string[]) => { events.push(`spawn:${command}:${args.join("|")}`); },
    ...overrides
  });
  return { service, events };
}

test("opens only a resolved managed skill directory", async () => {
  const { service, events } = makeService();
  assert.deepEqual(await service.openSkill({ id: "skill-1" }), { ok: true, detail: "Skill directory opened." });
  assert.deepEqual(events, ["open:C:\\skills\\safe-skill"]);
  await assert.rejects(() => service.openSkill({ name: "missing" }), /was not found/);
});

test("opens a catalog workspace through the finite terminal command", async () => {
  const { service, events } = makeService();
  assert.deepEqual(await service.openTool({ toolId: "terminal", workspaceId: "workspace-1" }), {
    ok: true,
    detail: "已在 Terminal 中打开当前项目。"
  });
  assert.deepEqual(events, ["spawn:wt.exe:-d|C:\\project"]);
});

test("rejects missing workspaces and unavailable native tools", async () => {
  const { service } = makeService({
    readWorkspaces: async () => [],
    getTools: () => []
  });
  await assert.rejects(() => service.openWorkspace({ workspaceId: "missing", target: "explorer" }), /not found/);
  assert.deepEqual(await service.openTool({ toolId: "unknown" }), { ok: false, detail: "未找到可用应用。" });
});
