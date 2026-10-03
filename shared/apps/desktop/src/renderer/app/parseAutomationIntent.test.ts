import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { automationIntentExamples, automationTaskPrompt, isAutomationCreationRequest, parseAutomationIntent, resolveAutomationCreationText } from "./parseAutomationIntent.ts";

test("parses a Chinese daily request and normalizes its time", () => {
  const result = parseAutomationIntent("每天 18:00 检查当前项目最近变更，整理完成事项和下一步计划");

  assert.equal(result.title, "每日项目进度整理");
  assert.equal(result.schedule, "daily");
  assert.equal(result.intervalMinutes, "1440");
  assert.equal(result.dailyTime, "18:00");
  assert.equal(result.action, "workspace_scan");
  assert.equal(result.prompt, "每天 18:00 检查当前项目最近变更，整理完成事项和下一步计划");
});

test("parses English intervals and daily meridiem times", () => {
  const interval = parseAutomationIntent("Every 2 hours check git status and report uncommitted changes");
  assert.equal(interval.schedule, "custom");
  assert.equal(interval.intervalMinutes, "120");
  assert.equal(interval.action, "git_status");
  assert.equal(interval.template, "发布前检查");

  const daily = parseAutomationIntent("Every day at 6:30 PM summarize workspace progress");
  assert.equal(daily.schedule, "daily");
  assert.equal(daily.dailyTime, "18:30");
});

test("parses weekly follow-up requests and exposes examples", () => {
  const result = parseAutomationIntent("每周一上午 9 点汇总对话进度并给出跟进建议");

  assert.equal(result.schedule, "weekly");
  assert.equal(result.intervalMinutes, "10080");
  assert.equal(result.dailyTime, "09:00");
  assert.equal(result.action, "thread_follow_up");
  assert.equal(result.rrule, "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0");
  assert.ok(automationIntentExamples().length >= 3);
});

test("recognizes a conversation request to create an automation", () => {
  const request = "请帮我创建一个自动化任务：\n每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。";
  assert.equal(isAutomationCreationRequest(request), true);
  assert.equal(isAutomationCreationRequest("你的创建自动化任务"), true);
  assert.equal(isAutomationCreationRequest("请帮我修改自动化任务“巡检”。当前计划：每天 08:00。"), false);
  assert.equal(isAutomationCreationRequest("每天早上 08:00 启动运维工程师 skill"), false);

  const parsed = parseAutomationIntent(request);
  assert.equal(parsed.schedule, "daily");
  assert.equal(parsed.dailyTime, "08:00");
  assert.equal(parsed.title, "每日运维巡检");
  assert.equal(parsed.prompt, "启动运维工程师 skill，对当前已配置的各节点进行巡检。");
  assert.equal(parsed.prompt, parsed.trigger);
});

test("a creation request stores the task instruction instead of the raw message", () => {
  const request = [
    "请帮我创建一个自动化任务：",
    "每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。检查服务可用性、节点状态、关键进程、Docker/Compose、数据库与 Redis、磁盘和资源、日志中的明显异常，以及 TLS/Nginx 等相关运行状态。汇总每个节点的检查结果、异常、风险和建议处理动作；如发现高风险问题，明确标注并通知我。若状态没有变化且没有异常，请保持安静。",
    "注意：巡检结果采用表格格式展示。",
    "I:\\G盘迁移备份\\workrpase\\spring-app\\operations-engineer.zip"
  ].join(" ");
  const prompt = automationTaskPrompt(request);
  assert.equal(prompt.startsWith("启动运维工程师"), true);
  assert.equal(prompt.includes("请帮我创建"), false);
  assert.equal(prompt.includes("operations-engineer.zip"), false);
  assert.equal(prompt.includes("08:00"), false);
  assert.match(prompt, /表格格式展示/);
  const parsed = parseAutomationIntent(request);
  assert.equal(parsed.prompt, prompt);
  assert.equal(parsed.dailyTime, "08:00");
  assert.equal(parsed.title, "每日运维巡检");
});

test("a short create nudge keeps the earlier scheduled request", () => {
  const resolved = resolveAutomationCreationText("你的创建自动化任务", [
    "每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。"
  ]);
  assert.match(resolved || "", /每天早上 08:00/);
  assert.equal(parseAutomationIntent(resolved || "").dailyTime, "08:00");
  assert.equal(parseAutomationIntent(resolved || "").schedule, "daily");
});
