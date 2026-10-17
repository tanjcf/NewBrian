/**
 * UI-CHINESE-NO-MOJIBAKE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Visible workspace UI copy must stay valid Chinese. Known encoding
 * damage such as "坑逝" (should be 发送) must never ship.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

export const CASE_ID = "UI-CHINESE-NO-MOJIBAKE-SMOKE-001";

/** Tokens observed from UTF-8 Chinese damage in WorkspaceModules / chat UI. */
const FORBIDDEN_MOJIBAKE = [
  "坑逝",
  "坖消",
  "坜止",
  "当剝",
  "生戝",
  "违行",
  "覝求",
  "坝馈",
  "針试",
  "针试",
  "修改覝求坎",
  "消杯",
  "杒入",
  "处睆",
  "丝坯",
  "丝能",
  "所选佝置",
  "已完戝"
] as const;

  const REQUIRED_LABELS = [
  "发送",
  "取消",
  "停止",
  "生成异常终止",
  "生成中断",
  "重试并从断点继续",
  "修改要求后继续",
  "反馈此异常"
] as const;

function readFirstExisting(relativeUrls: string[]) {
  for (const relativeUrl of relativeUrls) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (existsSync(file)) return { file, source: readFileSync(file, "utf8") };
  }
  throw new Error(`Missing smoke source: ${relativeUrls.join(" | ")}`);
}

function assertNoMojibake(source: string, label: string) {
  for (const token of FORBIDDEN_MOJIBAKE) {
    assert.equal(
      source.includes(token),
      false,
      `${label} must not contain mojibake token ${JSON.stringify(token)}`
    );
  }
}

test(`${CASE_ID} keeps edit-send and failure-card labels as valid Chinese`, () => {
  const { source: workspace } = readFirstExisting([
    "../renderer/app/WorkspaceModules.tsx",
    "../../../../platforms/windows/apps/desktop/src/renderer/app/WorkspaceModules.tsx"
  ]);

  assertNoMojibake(workspace, "WorkspaceModules.tsx");

  for (const label of REQUIRED_LABELS) {
    assert.ok(workspace.includes(label), `WorkspaceModules.tsx missing required label ${label}`);
  }

  const sendStart = workspace.indexOf('className="request-edit-send"');
  assert.ok(sendStart >= 0, "missing request-edit-send button");
  const sendButton = workspace.slice(sendStart, sendStart + 420);
  assert.match(sendButton, /aria-label="发送修改后的问题"/);
  assert.match(sendButton, />\s*发送\s*</);
  assert.doesNotMatch(sendButton, /坑逝/);

  const cancelNearEdit = workspace.slice(
    workspace.indexOf("cancelEditUserMessage"),
    workspace.indexOf('className="request-edit-send"')
  );
  assert.match(cancelNearEdit, />取消</);
  assert.doesNotMatch(cancelNearEdit, /坖消/);

  assert.match(
    workspace,
    /!isUserCancelledModelError\(ctx\.generationFailure\.message\)/
  );
  assert.match(workspace, /当前分支：\$\{newChatBranches\.current\}/);
  assert.match(workspace, /当前分支：\(detached HEAD\)/);
});

test(`${CASE_ID} keeps Windows renderer shell free of the same mojibake set`, () => {
  const { source: ui } = readFirstExisting([
    "../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx",
    "../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx",
    "../renderer/ui.tsx"
  ]);
  assertNoMojibake(ui, "platforms/windows/.../ui.tsx");
  assert.match(ui, /当前分支：\$\{workspaceBranches\.current\}/);
  assert.match(ui, /已停止生成/);
});
