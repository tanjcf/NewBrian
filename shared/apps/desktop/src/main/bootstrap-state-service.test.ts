import assert from "node:assert/strict";
import test from "node:test";

const { BootstrapStateService } = await import(new URL("./bootstrap-state-service.ts", import.meta.url).href);

function missingFile() {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function fixture(files: Record<string, string> = {}) {
  const writes: Array<{ path: string; content: string }> = [];
  const logs: string[] = [];
  const service = new BootstrapStateService({
    configPath: "config",
    bundledConfigPath: "bundled",
    statePath: "state",
    defaultConfig: { version: 1, tasks: [] },
    readText: async (path: string) => {
      if (!(path in files)) throw missingFile();
      return files[path];
    },
    writeText: async (path: string, content: string) => { writes.push({ path, content }); },
    ensureStateDirectory: async () => undefined,
    parseJson: JSON.parse,
    normalizeConfig: (input: object, defaults: object) => ({ ...defaults, ...input }),
    createTaskDefinitions: (config: { tasks?: unknown[] }) => config.tasks ?? [],
    mergeTaskStates: (definitions: unknown[], state?: { tasks?: unknown[] }) => state?.tasks ?? definitions,
    createStatusPayload: (state: object, tasks: unknown[]) => ({ state, tasks }),
    appendDebugLog: async (entry: string) => { logs.push(entry); },
    nowIso: () => "2026-07-18T00:00:00.000Z"
  } as never);
  return { service, writes, logs };
}

test("falls back from project config to bundled config and defaults", async () => {
  const bundled = fixture({ bundled: JSON.stringify({ version: 2, tasks: [{ id: "one" }] }) });
  assert.equal((await bundled.service.readConfig()).version, 2);
  const defaults = fixture();
  assert.equal((await defaults.service.readConfig()).version, 1);
});

test("resets malformed state and persists one canonical transition timestamp", async () => {
  const malformed = fixture({ config: JSON.stringify({ version: 1, tasks: [{ id: "conda" }] }), state: "{" });
  assert.deepEqual(await malformed.service.readState(), {});
  assert.match(malformed.logs[0], /parse failed/);

  const next = await malformed.service.updateTaskState({}, "conda", {
    overallStatus: "running",
    message: "Installing"
  });
  assert.equal(next.overall?.updatedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(next.tasks?.[0]?.startedAt, "2026-07-18T00:00:00.000Z");
  assert.equal(malformed.writes.length, 1);
  assert.match(malformed.writes[0].content, /"Installing"/);
});
