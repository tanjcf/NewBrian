/**
 * APP-UPDATE-SKIP-CANCEL-SMOKE-001
 * Packaging must run this case and stop when it fails.
 *
 * 「取消 / 稍后 / 跳过此版本」必须持久抑制当前 latestVersion，
 * 轮询不得没完没了重弹；仅当出现更新的版本时再自动提示。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  isSameAppUpdateVersion,
  shouldAutoOpenAppUpdateDiscover,
  shouldShowAppUpdateAutoPrompt
} from "./app-update-progress-copy.ts";

export const CASE_ID = "APP-UPDATE-SKIP-CANCEL-SMOKE-001";

function brainSourceRoot() {
  const envRoot = String(process.env.NEWBRAIN_SOURCE_ROOT || "").trim();
  if (envRoot && existsSync(path.join(envRoot, "platforms", "windows"))) return envRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(current, "platforms", "windows")) && existsSync(path.join(current, "shared"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function readFirst(candidates: string[]) {
  for (const filePath of candidates) {
    if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  }
  throw new Error(`Missing source: ${candidates.join(" | ")}`);
}

test(`${CASE_ID} cancel/skip keep discover closed for the same version`, () => {
  assert.equal(isSameAppUpdateVersion("v1.4.42", "1.4.42"), true);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.42",
    skippedVersion: null,
    suppressedVersion: null
  }), true);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: false,
    latestVersion: "1.4.42",
    skippedVersion: "1.4.42",
    suppressedVersion: "1.4.42"
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.42",
    skippedVersion: null,
    suppressedVersion: "v1.4.42"
  }), false);
  assert.equal(shouldShowAppUpdateAutoPrompt({
    available: true,
    latestVersion: "1.4.42",
    busy: false,
    dismissedVersion: "1.4.42",
    progressVisible: false
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.43",
    skippedVersion: "1.4.42",
    suppressedVersion: "1.4.42"
  }), true);
});

test(`${CASE_ID} WorkspaceModules cancel/skip/close persist via skipDesktopAppUpdate`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const workspace = readFirst([
    path.join(root, "shared", "apps", "desktop", "src", "renderer", "app", "WorkspaceModules.tsx"),
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "renderer", "app", "WorkspaceModules.tsx"),
    fileURLToPath(new URL("./WorkspaceModules.tsx", import.meta.url))
  ]);
  const discoverStart = workspace.indexOf('mode={appUpdateProgress ? "progress" : "discover"}');
  assert.ok(discoverStart >= 0, "discover/progress AppUpdateDialog missing");
  const autoPromptStart = workspace.indexOf("shouldShowAppUpdateAutoPrompt({", discoverStart);
  assert.ok(autoPromptStart > discoverStart, "auto-prompt block missing after discover dialog");
  const dialogBlock = workspace.slice(discoverStart, autoPromptStart);
  assert.match(dialogBlock, /onLater=\{\(\) => \{/);
  assert.match(dialogBlock, /onSkip=\{\(\) => \{/);
  assert.match(dialogBlock, /onClose=\{\(\) => \{/);
  assert.equal(
    (dialogBlock.match(/void skipDesktopAppUpdate\?\.\(version\)/g) || []).length,
    3,
    "cancel/skip/close must all call skipDesktopAppUpdate(version)"
  );
  assert.match(dialogBlock, /appUpdateProgress\?\.latestVersion/);
});

test(`${CASE_ID} Windows UI skip/cancel suppress before status refresh`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const ui = readFileSync(
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "renderer", "ui.tsx"),
    "utf8"
  );
  assert.match(ui, /appUpdateSuppressedVersion/);
  assert.match(ui, /shouldAutoOpenAppUpdateDiscover/);
  assert.match(ui, /async function skipDesktopAppUpdate\(versionHint\?: string\)/);
  assert.match(ui, /function dismissAppUpdateDiscover\(\) \{[\s\S]*?void skipDesktopAppUpdate\(\)/);
  assert.match(ui, /已跳过版本 \$\{version\}\。有更新版本时再提醒/);
});
