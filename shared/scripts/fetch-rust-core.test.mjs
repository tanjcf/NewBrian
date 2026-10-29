import assert from "node:assert/strict";
import test from "node:test";
import { rustCoreCatalogKey, selectRustCoreCatalogEntry } from "./fetch-rust-core.mjs";

const catalog = {
  windows: { url: "https://example.invalid/windows/brain-core.exe", sha256: "aa" },
  "macos-arm64": { url: "https://example.invalid/macos-arm64/brain-core", sha256: "bb" },
  "macos-x64": { url: "https://example.invalid/macos-x64/brain-core", sha256: "cc" },
  "ubuntu-x64": { url: "https://example.invalid/ubuntu-x64/brain-core", sha256: "dd" },
  "ubuntu-arm64": { url: "https://example.invalid/ubuntu-arm64/brain-core", sha256: "ee" },
  unix: { url: "https://example.invalid/unix/brain-core", sha256: "ff" }
};

test("maps each desktop platform onto its brain-core catalog entry", () => {
  assert.equal(rustCoreCatalogKey("win32", "x64"), "windows");
  assert.equal(rustCoreCatalogKey("darwin", "arm64"), "macos-arm64");
  assert.equal(rustCoreCatalogKey("darwin", "x64"), "macos-x64");
  assert.equal(rustCoreCatalogKey("linux", "x64"), "ubuntu-x64");
  assert.equal(rustCoreCatalogKey("linux", "arm64"), "ubuntu-arm64");
  assert.equal(selectRustCoreCatalogEntry(catalog, "darwin", "arm64").sha256, "bb");
  assert.equal(selectRustCoreCatalogEntry(catalog, "linux", "x64").sha256, "dd");
});

test("keeps the shared unix binary only when that platform has no published url", () => {
  const partial = {
    windows: catalog.windows,
    "macos-arm64": { url: "", sha256: "" },
    unix: catalog.unix
  };
  assert.equal(selectRustCoreCatalogEntry(partial, "darwin", "arm64").sha256, "ff");
  assert.equal(selectRustCoreCatalogEntry(partial, "win32", "x64").sha256, "aa");
});
