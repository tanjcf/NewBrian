import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("quantitative execution has no live broker network path", () => {
  const root = process.cwd();
  const layered = existsSync(join(root, "shared/apps/desktop"));
  const executionFiles = ["quant-simulation-service.ts", "simulation-ledger.ts", "quant-strategy-task-runner.ts"]
    .map((name) => layered ? `shared/apps/desktop/src/main/${name}` : `apps/desktop/src/main/${name}`);
  for (const relative of executionFiles) {
    const source = readFileSync(join(root, relative), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/u, `${relative} must not send orders over the network`);
    assert.doesNotMatch(source, /broker|券商接口|live[_-]?order|submit[_-]?order/iu, `${relative} must not contain a live-order adapter`);
  }
  const ipc = readFileSync(join(root, layered ? "shared/packages/protocol/src/brain-workspace.ts" : "packages/protocol/src/brain-workspace.ts"), "utf8");
  assert.match(ipc, /quantOrderExecute:\s*"brain:quant:order-execute"/u);
  assert.doesNotMatch(ipc, /brain:quant:(?:broker|live|submit)/iu);
});
