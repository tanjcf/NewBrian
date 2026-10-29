import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { countDelegateFailuresSince } from "./agent-collaboration.ts";
import { agentLoopAllowedToolNames } from "./automation-creation-loop-policy.ts";
import {
  automationSkillZipPaths,
  automationTaskPrompt,
  isAutomationCreationRequest
} from "../renderer/app/parseAutomationIntent.ts";

export const CASE_ID = "AUTOMATION-RUN-SMOKE-001";

const TOOLS = ["shell.exec", "workspace.read", "agent.delegate"];
const ZIP_PATH = "I:\\G盘迁移备份\\workrpase\\spring-app\\operations-engineer.zip";
const CREATE_REQUEST = `请帮我创建一个自动化任务： 每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。检查服务可用性、节点状态、关键进程、Docker/Compose、数据库与 Redis、磁盘和资源、日志中的明显异常，以及 TLS/Nginx 等相关运行状态。汇总每个节点的检查结果、异常、风险和建议处理动作；如发现高风险问题，明确标注并通知我。若状态没有变化且没有异常，请保持安静。 注意：巡检结果采用表格格式展示。 ${ZIP_PATH}`;
const BLOCKING_WRAPPER = [
  "这是已保存的定时任务，请直接执行下面的指令，不要再创建自动化任务，也不要处理压缩包路径。",
  "",
  "启动运维工程师 skill，对当前已配置的各节点进行巡检。"
].join("\n");

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

async function loadSchedulePolicy() {
  const candidates = [
    new URL("../../../../../platforms/windows/apps/desktop/src/main/automation-schedule-policy.ts", import.meta.url),
    new URL("./automation-schedule-policy.ts", import.meta.url)
  ];
  for (const url of candidates) {
    if (!existsSync(url)) continue;
    return import(url.href) as Promise<{
      resolveAutomationSkillNames: (prompt: string, skills: Array<{ name?: string; summary?: string; status?: string }>) => string[];
      scheduledAutomationRequest: (instruction: string) => string;
    }>;
  }
  throw new Error("automation-schedule-policy.ts was not found");
}

test(`${CASE_ID} a saved automation run keeps tools, the installed skill, and a fresh delegation budget`, async () => {
  assert.equal(isAutomationCreationRequest(CREATE_REQUEST), true);
  assert.equal(isAutomationCreationRequest(BLOCKING_WRAPPER), false);
  assert.deepEqual(agentLoopAllowedToolNames({
    latestUserRequest: BLOCKING_WRAPPER,
    governmentRevisionPreview: false,
    remoteAllowedToolNames: TOOLS
  }), TOOLS);
  assert.deepEqual(agentLoopAllowedToolNames({
    latestUserRequest: CREATE_REQUEST,
    governmentRevisionPreview: false,
    remoteAllowedToolNames: TOOLS
  }), []);

  assert.deepEqual(automationSkillZipPaths(CREATE_REQUEST), [ZIP_PATH]);
  const prompt = automationTaskPrompt(CREATE_REQUEST);
  assert.equal(prompt.includes("operations-engineer.zip"), false);
  assert.equal(prompt.includes("请帮我创建"), false);
  assert.match(prompt, /启动运维工程师 skill/);
  assert.match(prompt, /表格格式展示/);
  assert.equal(isAutomationCreationRequest(prompt), false);

  const policy = await loadSchedulePolicy();
  assert.deepEqual(policy.resolveAutomationSkillNames(prompt, [
    { name: "operations-engineer", summary: "运维巡检", status: "enabled" },
    { name: "writing-style", summary: "文风", status: "enabled" }
  ]), ["operations-engineer"]);
  const scheduled = policy.scheduledAutomationRequest(prompt);
  assert.equal(isAutomationCreationRequest(scheduled), false);
  assert.deepEqual(agentLoopAllowedToolNames({
    latestUserRequest: scheduled,
    governmentRevisionPreview: false,
    remoteAllowedToolNames: TOOLS
  }), TOOLS);
  assert.match(scheduled, /启动运维工程师 skill/);
  assert.doesNotMatch(scheduled, /不要再创建自动化任务/);

  const turnStartedAt = "2026-10-05T00:00:00.000Z";
  assert.equal(countDelegateFailuresSince([
    { status: "failed", createdAt: "2026-10-03T00:00:00.000Z" },
    { status: "failed", createdAt: "2026-10-03T00:01:00.000Z" },
    { status: "failed", createdAt: "2026-10-05T00:00:01.000Z" }
  ], turnStartedAt), 1);

  const main = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url),
    new URL("./index.ts", import.meta.url)
  ]);
  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(main, /scheduledAutomationRequest\(request\)/);
  assert.match(main, /selectedSkillNames: installedSkillNames/);
  assert.match(main, /countDelegateFailuresSince\(/);
  assert.doesNotMatch(main, /不要再创建自动化任务/);
  const createSlice = workspace.slice(workspace.indexOf("async function materializeCreatorFromChat"), workspace.indexOf("function submitComposerRequest"));
  assert.match(createSlice, /automationSkillZipPaths\(text\)/);
  assert.match(createSlice, /importSkillZipToProject\(\{[\s\S]*zipPath/);
  const runSlice = workspace.slice(workspace.indexOf("async function runAutomationNow"), workspace.indexOf("async function deleteAutomation"));
  assert.match(runSlice, /automationTaskPrompt\(/);
});
