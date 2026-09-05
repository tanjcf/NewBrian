import assert from "node:assert/strict";
import test from "node:test";

const {
  resolveAppUpdateProgressLabel,
  resolveAppUpdateProgressTitle,
  shouldShowAppUpdateAutoPrompt
} = await import(new URL("./app-update-progress-copy.ts", import.meta.url).href);

test("progress titles follow 正在下载 / 正在安装 / 安装完成即将重启", () => {
  assert.equal(resolveAppUpdateProgressTitle({ phase: "downloading" }), "正在下载");
  assert.equal(resolveAppUpdateProgressTitle({ phase: "installing" }), "正在安装");
  assert.equal(
    resolveAppUpdateProgressTitle({ phase: "installing", installMode: "patch" }),
    "正在应用补丁"
  );
  assert.equal(
    resolveAppUpdateProgressTitle({ phase: "done", installMode: "silent" }),
    "即将退出并更新"
  );
  assert.equal(
    resolveAppUpdateProgressTitle({ phase: "done", installMode: "patch" }),
    "即将退出并更新"
  );
  assert.equal(
    resolveAppUpdateProgressTitle({ phase: "done", installMode: "wizard" }),
    "更新包已就绪"
  );
  assert.equal(resolveAppUpdateProgressLabel({ phase: "downloading" }), "正在下载…");
  assert.equal(resolveAppUpdateProgressLabel({ phase: "installing" }), "正在安装…");
  assert.equal(
    resolveAppUpdateProgressLabel({ phase: "done", detail: "安装完成即将重启。" }),
    "准备退出应用…"
  );
});

test("auto-prompt is non-blocking and respects dismiss + busy", () => {
  assert.equal(shouldShowAppUpdateAutoPrompt({
    available: true,
    latestVersion: "1.2.1",
    busy: false,
    dismissedVersion: null,
    progressVisible: false
  }), true);
  assert.equal(shouldShowAppUpdateAutoPrompt({
    available: true,
    latestVersion: "1.2.1",
    busy: true,
    dismissedVersion: null,
    progressVisible: false
  }), false);
  assert.equal(shouldShowAppUpdateAutoPrompt({
    available: true,
    latestVersion: "1.2.1",
    busy: false,
    dismissedVersion: "1.2.1",
    progressVisible: false
  }), false);
  assert.equal(shouldShowAppUpdateAutoPrompt({
    available: true,
    latestVersion: "1.2.1",
    busy: false,
    dismissedVersion: null,
    progressVisible: true
  }), false);
});
