import assert from "node:assert/strict";
import test from "node:test";

const {
  resolveAppUpdateProgressLabel,
  resolveAppUpdateProgressTitle,
  shouldShowAppUpdateAutoPrompt
} = await import(new URL("./app-update-progress-copy.ts", import.meta.url).href);

test("progress titles follow Cockpit-style discover / install / restart copy", () => {
  assert.equal(resolveAppUpdateProgressTitle({ phase: "downloading" }), "发现新版本");
  assert.equal(resolveAppUpdateProgressTitle({ phase: "ready", latestVersion: "1.4.10" }), "发现新版本");
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
    resolveAppUpdateProgressTitle({ phase: "done", installMode: "nsis" }),
    "即将退出并更新"
  );
  assert.equal(
    resolveAppUpdateProgressTitle({ phase: "done", installMode: "wizard" }),
    "更新包已就绪"
  );
  assert.equal(resolveAppUpdateProgressTitle({ phase: "success" }), "更新成功!");
  assert.equal(resolveAppUpdateProgressLabel({ phase: "downloading", detail: "x 14%" }), "下载中... 14%");
  assert.equal(
    resolveAppUpdateProgressLabel({ phase: "ready", latestVersion: "1.4.10" }),
    "v1.4.10 已就绪，重启后生效。"
  );
  assert.equal(resolveAppUpdateProgressLabel({ phase: "installing" }), "正在安装…");
  assert.equal(
    resolveAppUpdateProgressLabel({ phase: "done", detail: "安装完成即将重启。" }),
    "准备退出应用…"
  );
});

test("auto-prompt is non-blocking and respects dismiss + skip + busy", () => {
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
    skippedVersion: "1.2.1",
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
