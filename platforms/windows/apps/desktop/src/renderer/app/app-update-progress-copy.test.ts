import assert from "node:assert/strict";
import test from "node:test";

const {
  buildAppUpdateErrorProgress,
  formatAccountAppUpdateNotice,
  formatAppUpdateVersionLine,
  isNewerAppUpdateVersion,
  isSameAppUpdateVersion,
  mapAppUpdateVerifyError,
  resolveAppUpdateDialogHeroVersion,
  resolveAppUpdateProgressLabel,
  resolveAppUpdateProgressTitle,
  shouldAutoOpenAppUpdateDiscover,
  shouldShowAppUpdateAutoPrompt
} = await import(new URL("../../../../../../../shared/apps/desktop/src/renderer/app/app-update-progress-copy.ts", import.meta.url).href);

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
    latestVersion: "v1.2.1",
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

test("discover dialog stays closed after skip/cancel until a newer version", () => {
  assert.equal(isSameAppUpdateVersion("v1.4.42", "1.4.42"), true);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.42",
    skippedVersion: null,
    suppressedVersion: null
  }), true);
  // 「取消」持久化为 skippedVersion 后，轮询也不能再弹同一版本。
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: false,
    latestVersion: "1.4.42",
    skippedVersion: "1.4.42",
    suppressedVersion: "1.4.42"
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.42",
    skippedVersion: "1.4.42",
    suppressedVersion: null
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.42",
    skippedVersion: null,
    suppressedVersion: "v1.4.42"
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: false,
    latestVersion: "1.4.42",
    skippedVersion: "1.4.42"
  }), false);
  assert.equal(shouldAutoOpenAppUpdateDiscover({
    available: true,
    latestVersion: "1.4.43",
    skippedVersion: "1.4.42",
    suppressedVersion: "1.4.42"
  }), true);
});

test("already-latest errors never advertise a stale older target version", () => {
  assert.equal(isNewerAppUpdateVersion("1.4.34", "1.4.43"), false);
  assert.equal(isNewerAppUpdateVersion("1.4.45", "1.4.43"), true);
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
    resolveAppUpdateDialogHeroVersion({
      phase: "error",
      currentVersion: "1.4.43",
      latestVersion: "1.4.34",
      detail: "当前版本 1.4.43 已是最新。"
    }),
    "1.4.43"
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

test("verify errors stay as errors and are not mixed into update notes", () => {
  assert.match(
    mapAppUpdateVerifyError(
      "Error invoking remote method 'phase1:verify-app-update': Error: desktop app release was not found"
    ),
    /服务端未找到对应更新记录/
  );
  assert.equal(
    formatAccountAppUpdateNotice({
      message: "Error invoking remote method 'phase1:verify-app-update': Error: desktop app release was not found",
      detail: "发现新版本 1.4.44。更新仅替换程序文件，不会删除聊天记录、项目与本地历史。",
      channel: "stable"
    }),
    "服务端未找到对应更新记录，无法提交验证。若软件已升级成功，可忽略此提示。"
  );
  assert.match(
    formatAccountAppUpdateNotice({
      detail: "当前版本 1.4.44 已是最新。",
      channel: "stable"
    }),
    /不会删除聊天记录/
  );
  assert.doesNotMatch(
    formatAccountAppUpdateNotice({
      message: "desktop app release was not found",
      channel: "stable"
    }),
    /不会删除/
  );
  assert.equal(
    formatAccountAppUpdateNotice({
      detail: "Error invoking remote method 'phase1:verify-app-update': Error: desktop app release was not found（stable）",
      channel: "stable"
    }),
    "服务端未找到对应更新记录，无法提交验证。若软件已升级成功，可忽略此提示。"
  );
});
