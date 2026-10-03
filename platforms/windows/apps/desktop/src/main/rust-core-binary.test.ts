import assert from "node:assert/strict";
import test from "node:test";
import { resolveWindowsRustCoreBinary } from "./rust-core-binary.ts";

test("resolves only the bundled Rust Core binary in packaged mode", () => {
  const checked: string[] = [];
  const resolved = resolveWindowsRustCoreBinary({
    isPackaged: true,
    resourcesPath: "C:/Program Files/BRAIN/resources",
    appDirectory: "C:/Program Files/BRAIN/resources/app.asar/out/main",
    exists: (path) => { checked.push(path); return true; },
    verifyRelease: () => undefined
  });
  assert.match(resolved, /resources[\\/]brain-core[\\/]brain-core\.exe$/u);
  assert.equal(checked.length, 1);
});

test("walks repository ancestors for a fixed development build and rejects absence", () => {
  const resolved = resolveWindowsRustCoreBinary({
    isPackaged: false,
    resourcesPath: "C:/unused",
    appDirectory: "I:/workspace/BRAIN/.materialized/windows/apps/desktop/out/main",
    exists: (path) => (
      path.endsWith("BRAIN\\rust\\brain-core\\Cargo.toml")
      || path.endsWith("BRAIN\\rust\\brain-core\\target\\debug\\brain-core.exe")
    )
  });
  assert.match(resolved, /BRAIN[\\/]rust[\\/]brain-core[\\/]target[\\/]debug[\\/]brain-core\.exe$/u);
  assert.throws(() => resolveWindowsRustCoreBinary({
    isPackaged: false,
    resourcesPath: "C:/unused",
    appDirectory: "I:/workspace/BRAIN/.materialized/windows/apps/desktop/out/main",
    exists: () => false
  }), /BRAIN_CORE_BINARY_MISSING/u);
});
