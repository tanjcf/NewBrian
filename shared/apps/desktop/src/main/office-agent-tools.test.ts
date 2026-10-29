import assert from "node:assert/strict";
import test from "node:test";
import { registerOfficeAgentTools } from "./office-agent-tools.ts";
import type { OfficeSuiteDependencies } from "./office-suite.ts";

test("registers office status, open, and convert tools", async () => {
  const tools = new Map<string, (input: Record<string, unknown>) => Promise<{ ok: boolean; output?: string }>>();
  const suite: OfficeSuiteDependencies = {
    platform: "win32",
    env: {},
    accessPath: async () => { throw new Error("missing"); },
    lookup: () => ({ status: 1, stdout: "" }),
    spawnCommand: async () => ({ status: 0, stdout: "", stderr: "" }),
    openDetached: () => undefined,
    realpath: async (path) => path,
    statFile: async () => ({ isFile: () => true, size: 1 }),
    ensureDir: async () => undefined
  };
  registerOfficeAgentTools({
    unregisterExternalTools() {},
    registerExternalTool(definition, execute) {
      tools.set(String(definition.name), execute);
    }
  }, { projectRoot: "I:\\project", suite });
  assert.deepEqual([...tools.keys()], ["office.status", "office.open", "office.convert"]);
  const status = await tools.get("office.status")!({});
  assert.equal(status.ok, true);
  assert.match(status.output ?? "", /"preferred":null/);
  const missing = await tools.get("office.open")!({});
  assert.equal(missing.ok, false);
});
