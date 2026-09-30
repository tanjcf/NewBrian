import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { automationIntentExamples, parseAutomationIntent } from "./parseAutomationIntent.ts";

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
