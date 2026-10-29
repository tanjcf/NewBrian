import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { resolveAppVersion, resolveElectronAppVersion } from "./resolve-app-version.ts";

test("prefers package.json version under app path over Electron getVersion", () => {
  const version = resolveAppVersion({
    getAppPath: () => "C:\\App\\resources\\app.asar",
    getVersion: () => "1.4.3",
    joinPath: (...parts) => parts.join("/"),
    readFileSync: (path) => {
      assert.equal(path, "C:\\App\\resources\\app.asar/package.json");
      return JSON.stringify({ name: "@codex-forge/desktop", version: "1.4.22" });
    }
  });
  assert.equal(version, "1.4.22");
});

test("falls back to getVersion when package.json is missing or invalid", () => {
  assert.equal(
    resolveAppVersion({
      getAppPath: () => "/missing",
      getVersion: () => "1.4.3",
      readFileSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
    }),
    "1.4.3"
  );
  assert.equal(
    resolveAppVersion({
      getAppPath: () => "/bad",
      getVersion: () => "1.4.3",
      readFileSync: () => "{not-json"
    }),
    "1.4.3"
  );
  assert.equal(
    resolveAppVersion({
      getAppPath: () => "/empty",
      getVersion: () => "1.4.3",
      readFileSync: () => JSON.stringify({ name: "desktop", version: "   " })
    }),
    "1.4.3"
  );
});

test("resolveElectronAppVersion falls back when package.json is absent", () => {
  assert.equal(
    resolveElectronAppVersion({
      getAppPath: () => "/newbrain-missing-app-path-for-test",
      getVersion: () => "9.9.9"
    }),
    "9.9.9"
  );
});
