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
  "已完戝",
  // Automation / catalog / MCP copy corruption (2026-03)
  "坝称",
  "杜索",
  "挝续",
  "排庝",
  "戝功",
  "酝置",
  "触坑",
  "扫杝",
  "梳睆",
  "来溝",
  "坪能",
  "坯用",
  "針夝",
  "浝览",
  "游戝",
  "定佝",
  "丝支",
  "保挝",
  "坎会",
  "冝坑",
  "剝坑",
  "杝供",
  "杝纲",
  "话杮",
  "素杝",
  "依杮",
  "读坖",
  "坯夝",
  "毝日",
  "稝坎",
  "代砝",
  "左坳",
  "坑言",
  "窗坣",
  "平坰",
  "坠佝",
  "验话",
  "坎续",
  "坊逝",
  "支挝",
  "坚法",
  "針覝",
  "开箱操控",
  "开箱控制",
  "杜索任务坝称",
  "集中管理定时任务〝",
  "组坈",
  "坕镜生成",
  "折坠显示",
  "自定义调整愝觝",
  "审批杝醒",
  "团队频靓",
  "坯觝回复",
  "毝周回顾",
  "匹酝的项目",
  "这坰电脑",
  "酝对地址",
  "窗堂",
  "坑现",
  "蝚焦",
  "截屝",
  "刷新窗堂",
  "本机窗堂",
  "全部来溝",
  "全部来满",
  "祂供方",
  "已安签",
  "杜索插件",
] as const;

const REQUIRED_LABELS = [
  "发送",
  "取消",
  "停止",
  "生成异常终止",
  "生成超时中断",
  "生成中断",
  "重试并从断点继续",
  "修改要求后继续",
  "反馈此异常",
] as const;

const REQUIRED_AUTOMATION_COPY = [
  "集中管理定时任务、持续监测和自动执行结果。",
  "搜索任务名称、计划或指令",
  "配置名称、触发说明、执行动作和循环间隔。",
  "把重复的项目扫描、状态检查和线程跟进交给 NewBrain 定时执行。",
  "线程跟进提醒",
  "每日工作区扫描",
  "键鼠控制任意 Windows 窗口",
  "列表 / 聚焦 / 输入 / 截屏",
  "点击「刷新窗口列表」发现当前桌面上的应用窗口。",
  "刷新窗口列表",
  "本机窗口",
  "搜索插件、分类或提供方",
  "全部来源",
  "按热度排序",
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
  assert.equal(
    source.includes("〝"),
    false,
    `${label} must not contain corrupted separator 〝`
  );
}

test(`${CASE_ID} keeps edit-send and failure-card labels as valid Chinese`, () => {
  const { source: workspace } = readFirstExisting([
    "../renderer/app/WorkspaceModules.tsx",
    "../../../../platforms/windows/apps/desktop/src/renderer/app/WorkspaceModules.tsx",
  ]);

  assertNoMojibake(workspace, "WorkspaceModules.tsx");

  for (const label of REQUIRED_LABELS) {
    assert.ok(workspace.includes(label), `WorkspaceModules.tsx missing required label ${label}`);
  }

  for (const phrase of REQUIRED_AUTOMATION_COPY) {
    assert.ok(
      workspace.includes(phrase),
      `WorkspaceModules.tsx missing automation copy ${JSON.stringify(phrase)}`
    );
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
    "../renderer/ui.tsx",
  ]);
  assertNoMojibake(ui, "platforms/windows/.../ui.tsx");
  assert.match(ui, /当前分支：\$\{workspaceBranches\.current\}/);
  assert.match(ui, /已停止生成/);
});

test(`${CASE_ID} keeps platform desktop-model MCP copy free of 开箱 mojibake`, () => {
  const models = [
    "../../../../../platforms/windows/apps/desktop/src/renderer/app/desktop-model.tsx",
    "../../../../../platforms/macos/common/apps/desktop/src/renderer/app/desktop-model.tsx",
    "../../../../../platforms/ubuntu/common/apps/desktop/src/renderer/app/desktop-model.tsx",
  ];
  for (const relativeUrl of models) {
    const file = fileURLToPath(new URL(relativeUrl, import.meta.url));
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("开箱控制"), false, `${file} still has 开箱控制`);
    assert.equal(source.includes("开箱操控"), false, `${file} still has 开箱操控`);
    assert.match(source, /键鼠控制/);
  }
});
