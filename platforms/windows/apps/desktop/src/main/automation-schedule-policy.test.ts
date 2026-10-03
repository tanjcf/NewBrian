import assert from "node:assert/strict";
import test from "node:test";

const {
  automationTaskPrompt,
  computeNextWeeklyRunAt,
  createAutomationSpec,
  parseWeeklyWeekdayFromRrule,
  selectDueAutomations
} = await import(new URL("./automation-schedule-policy.ts", import.meta.url).href);

test("weekly rrule parses Monday", () => {
  assert.equal(parseWeeklyWeekdayFromRrule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0"), 1);
});

test("weekly next run lands on requested weekday", () => {
  const mondayMorning = Date.parse("2026-09-21T01:00:00.000Z");
  const next = computeNextWeeklyRunAt({ weekday: 1, dailyTime: "09:00" }, mondayMorning);
  const date = new Date(next);
  assert.equal(date.getDay(), 1);
});

test("createAutomationSpec stores weekly rrule and schedules nextRunAt", () => {
  const spec = createAutomationSpec({
    title: "每周汇总",
    trigger: "每周一 09:00",
    prompt: "汇总",
    schedule: "weekly",
    intervalMinutes: "10080",
    dailyTime: "09:00",
    rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
    status: "scheduled",
    action: "workspace_scan"
  }, { makeId: () => "a1", nowMs: Date.parse("2026-09-22T01:00:00.000Z") });
  assert.equal(spec.schedule, "weekly");
  assert.equal(spec.permissionMode, undefined);
  assert.ok(spec.nextRunAt);
  assert.equal(selectDueAutomations([spec], Date.parse(spec.nextRunAt) + 1).length, 1);
});

test("creation text becomes the task instruction and full access is stored", () => {
  const raw = "请帮我创建一个自动化任务： 每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。 I:\\G盘迁移备份\\workrpase\\spring-app\\operations-engineer.zip";
  const prompt = automationTaskPrompt(raw);
  assert.equal(prompt, "启动运维工程师 skill，对当前已配置的各节点进行巡检。");
  const spec = createAutomationSpec({
    title: "每日运维巡检",
    trigger: prompt,
    prompt,
    schedule: "daily",
    intervalMinutes: "1440",
    dailyTime: "08:00",
    status: "scheduled",
    action: "workspace_scan",
    permissionMode: "full"
  }, { makeId: () => "ops", nowMs: Date.parse("2026-10-03T01:00:00.000Z") });
  assert.equal(spec.prompt, prompt);
  assert.equal(spec.permissionMode, "full");
});
