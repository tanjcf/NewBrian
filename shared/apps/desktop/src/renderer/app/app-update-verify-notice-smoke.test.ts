/**
 * APP-UPDATE-VERIFY-NOTICE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 *
 * Regression: Settings「更新说明」曾把 verify IPC 英文错误
 * （desktop app release was not found）与频道后缀、数据保留句拼在一起，
 * 且异常文案可重复出现。验证失败必须单独成中文错误，不得混入更新说明。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  formatAccountAppUpdateNotice,
  mapAppUpdateVerifyError
} from "./app-update-progress-copy.ts";

export const CASE_ID = "APP-UPDATE-VERIFY-NOTICE-SMOKE-001";

const RAW_IPC =
  "Error invoking remote method 'phase1:verify-app-update': Error: desktop app release was not found";
const EXPECTED_ZH =
  "服务端未找到对应更新记录，无法提交验证。若软件已升级成功，可忽略此提示。";

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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

test(`${CASE_ID} maps release-not-found to Chinese and never mixes into update notes`, () => {
  assert.equal(mapAppUpdateVerifyError(RAW_IPC), EXPECTED_ZH);
  assert.equal(mapAppUpdateVerifyError(new Error(RAW_IPC)), EXPECTED_ZH);

  const fromMessage = formatAccountAppUpdateNotice({
    message: RAW_IPC,
    detail: "发现新版本 1.4.44。更新仅替换程序文件，不会删除聊天记录、项目与本地历史。",
    channel: "stable"
  });
  assert.equal(fromMessage, EXPECTED_ZH);
  assert.doesNotMatch(fromMessage, /不会删除/);
  assert.doesNotMatch(fromMessage, /desktop app release was not found/i);
  assert.doesNotMatch(fromMessage, /（stable）/);
  assert.equal(countOccurrences(fromMessage, "服务端未找到"), 1);

  const fromDetailOnly = formatAccountAppUpdateNotice({
    detail: `${RAW_IPC}（stable）`,
    channel: "stable"
  });
  assert.equal(fromDetailOnly, EXPECTED_ZH);
  assert.equal(countOccurrences(fromDetailOnly, EXPECTED_ZH), 1);

  // Double-pasted English error (seen twice in the notice field) still maps once.
  const duplicated = formatAccountAppUpdateNotice({
    message: `${RAW_IPC}\n${RAW_IPC}`,
    channel: "stable"
  });
  assert.equal(duplicated, EXPECTED_ZH);
  assert.equal(countOccurrences(duplicated, "服务端未找到"), 1);
});

test(`${CASE_ID} already-latest failure must not show a stale older hero version`, async () => {
  const {
    buildAppUpdateErrorProgress,
    formatAppUpdateVersionLine,
    resolveAppUpdateDialogHeroVersion,
    shouldAutoOpenAppUpdateDiscover
  } = await import("./app-update-progress-copy.ts");
  assert.equal(
    resolveAppUpdateDialogHeroVersion({
      phase: "error",
      currentVersion: "1.4.43",
      latestVersion: "1.4.34",
      detail: "当前版本 1.4.43 已是最新。"
    }),
    "1.4.43"
  );
  assert.equal(
    formatAppUpdateVersionLine({
      phase: "error",
      currentVersion: "1.4.43",
      latestVersion: "1.4.34",
      detail: "当前版本 1.4.43 已是最新。"
    }),
    "当前版本 v1.4.43 已是最新。"
  );
  assert.equal(
    buildAppUpdateErrorProgress({
      detail: "当前版本 1.4.43 已是最新。",
      latestVersion: "1.4.34",
      currentVersion: "1.4.43"
    }).latestVersion,
    undefined
  );
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.34",
    currentVersion: "1.4.43"
  }), false);
});

test(`${CASE_ID} healthy status notice still keeps the data-preservation sentence once`, () => {
  const notice = formatAccountAppUpdateNotice({
    detail: "当前版本 1.4.44 已是最新。",
    channel: "stable"
  });
  assert.match(notice, /当前版本 1\.4\.44 已是最新/);
  assert.match(notice, /（stable）/);
  assert.equal(countOccurrences(notice, "不会删除聊天记录"), 1);
  assert.doesNotMatch(notice, /not found/i);
});

test(`${CASE_ID} SettingsWorkspace routes verify errors through notice helpers`, () => {
  const settings = readFileSync(fileURLToPath(new URL("./SettingsWorkspace.tsx", import.meta.url)), "utf8");
  assert.match(settings, /formatAccountAppUpdateNotice/);
  assert.match(settings, /mapAppUpdateVerifyError/);
  assert.match(settings, /formatAccountAppUpdateNotice\(\{[\s\S]*?message:\s*appUpdateMessage/);
  assert.match(settings, /catch \(error\) \{[\s\S]*?mapAppUpdateVerifyError\(error\)/);
  assert.doesNotMatch(
    settings,
    /account-password-notice[\s\S]{0,200}\$\{[^}]*appUpdateMessage[^}]*\}\$\{[^}]*channel/
  );
});

test(`${CASE_ID} Windows verifyUpdate catches IPC failures instead of throwing`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const service = readFirst([
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "main", "desktop-app-update-service.ts"),
    path.join(root, ".materialized", "windows", "apps", "desktop", "src", "main", "desktop-app-update-service.ts")
  ]);
  const blockStart = service.indexOf("async verifyUpdate(");
  assert.ok(blockStart >= 0, "verifyUpdate missing");
  const blockEnd = service.indexOf("\n  private ", blockStart);
  const block = service.slice(blockStart, blockEnd > blockStart ? blockEnd : blockStart + 2500);
  assert.match(block, /try \{/);
  assert.match(block, /catch \(error\)/);
  assert.match(block, /desktop app release was not found/i);
  assert.match(block, /服务端未找到对应更新记录/);
  assert.match(block, /return \{ ok: false, releaseId, detail \}/);
});

test(`${CASE_ID} macOS verifyUpdate mirrors Windows catch mapping`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const service = readFileSync(
    path.join(root, "platforms", "macos", "common", "apps", "desktop", "src", "main", "desktop-app-update-service.ts"),
    "utf8"
  );
  const blockStart = service.indexOf("async verifyUpdate(");
  assert.ok(blockStart >= 0, "macos verifyUpdate missing");
  const blockEnd = service.indexOf("\n  private ", blockStart);
  const block = service.slice(blockStart, blockEnd > blockStart ? blockEnd : blockStart + 2500);
  assert.match(block, /catch \(error\)/);
  assert.match(block, /desktop app release was not found/i);
  assert.match(block, /服务端未找到对应更新记录/);
});
