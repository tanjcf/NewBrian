import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const systemIpc = readFileSync(new URL("./system-ipc.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../preload/index.ts", import.meta.url), "utf8");
const protocol = readFileSync(new URL("../../../../../mac/packages/protocol/src/index.ts", import.meta.url), "utf8");

test("exposes a non-fatal renderer diagnostic IPC separate from crash restart failures", () => {
  assert.match(protocol, /reportRendererDiagnostic:\s*"phase1:report-renderer-diagnostic"/);
  assert.match(protocol, /export interface RendererDiagnosticInput/);
  assert.match(systemIpc, /parseRendererDiagnosticInput/);
  assert.match(systemIpc, /reportRendererDiagnostic/);
  assert.match(preload, /reportRendererDiagnostic:/);
  assert.match(main, /async function reportRendererDiagnostic/);
  assert.match(main, /severity: "diagnostic"/);
  const diagnosticFn = main.slice(
    main.indexOf("async function reportRendererDiagnostic"),
    main.indexOf("async function reportRendererDiagnostic") + 1400
  );
  assert.doesNotMatch(diagnosticFn, /app\.relaunch/);
  assert.doesNotMatch(diagnosticFn, /app\.exit\(70\)/);
});

test("diagnostic parser rejects empty kinds in source contract", () => {
  assert.match(systemIpc, /input\.kind\.trim\(\)/);
  assert.match(systemIpc, /input\.kind\.length > 80/);
  assert.match(systemIpc, /Renderer diagnostic input is invalid\./);
});
