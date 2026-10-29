import assert from "node:assert/strict";
import test from "node:test";
import { resolveUnixRustCoreBinary } from "./rust-core-binary-unix.ts";

test("resolves only the bundled Unix Rust Core binary in packaged mode", () => {
  assert.equal(resolveUnixRustCoreBinary({
    isPackaged: true,
    resourcesPath: "C:/opt/newbrain/resources",
    appDirectory: "C:/opt/newbrain/app.asar/out/main",
    exists: (path) => path.replaceAll("\\", "/") === "C:/opt/newbrain/resources/brain-core/brain-core",
    verifyRelease: () => undefined
  }).replaceAll("\\", "/"), "C:/opt/newbrain/resources/brain-core/brain-core");
  assert.throws(() => resolveUnixRustCoreBinary({
    isPackaged: true,
    resourcesPath: "/opt/newbrain/resources",
    appDirectory: "/tmp/source",
    exists: () => false
  }), /BRAIN_CORE_BINARY_MISSING/u);
});

test("walks repository ancestors for a fixed Unix development binary", () => {
  const existing = new Set([
    "C:/work/brain/rust/brain-core/Cargo.toml",
    "C:/work/brain/rust/brain-core/target/release/brain-core"
  ]);
  assert.equal(resolveUnixRustCoreBinary({
    isPackaged: false,
    resourcesPath: "/unused",
    appDirectory: "C:/work/brain/apps/desktop/out/main",
    exists: (path) => existing.has(path.replaceAll("\\", "/"))
  }).replaceAll("\\", "/"), "C:/work/brain/rust/brain-core/target/release/brain-core");
});
