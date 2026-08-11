import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { UserUsageExceptionFeedbackService, redactUsageExceptionText, selectUsageExceptionConversation } from "./user-usage-exception-feedback-service.ts";

const validAnalysis = JSON.stringify({
  title: "文档生成任务无法完成",
  symptomSummary: "文档生成后任务持续运行且没有完成结果。",
  possibleCause: "生成流程的完成事件可能未正确投影。",
  category: "document_generation_stuck",
  stableFeatures: ["document_generation", "completion_event_missing"],
  contextSummary: "用户触发文档生成后长时间无完成状态。"
});

function createHarness(overrides: Record<string, unknown> = {}) {
  const analyses: string[] = [];
  const reports: Array<Record<string, unknown>> = [];
  let analysisIndex = 0;
  const analysisResponses = (overrides.analysisResponses as string[] | undefined) ?? [validAnalysis];
  const service = new UserUsageExceptionFeedbackService({
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    makeId: () => "preview-fixed",
    readTrustedContext: async () => ({
      messages: Array.from({ length: 15 }, (_, index) => ({
        id: `message-${index + 1}`,
        role: index === 1 ? "tool" : index === 2 ? "system" : index % 2 ? "assistant" : "user",
        content: index === 4 ? "password=secret-value" : `message content ${index + 1}`,
        excludeFromModelContext: index === 3,
        attachments: index === 5 ? [{ path: "C:/secret/customer.docx", content: "attachment body" }] : undefined
      })),
      environment: { platform: "win32", codecnVersion: "0.1.60" },
      diagnostics: "Bearer secret-token\napi_key=top-secret\nrequest failed",
      stackTrace: "Error: password=hunter2",
      deviceId: "trusted-device",
      appVersion: "0.1.60",
      ownerKey: "user-7"
    }),
    analyze: async (prompt) => {
      analyses.push(prompt);
      return analysisResponses[Math.min(analysisIndex++, analysisResponses.length - 1)]!;
    },
    report: async (failure) => {
      reports.push(failure as unknown as Record<string, unknown>);
      return { localReportId: "desktop-error-1", delivery: "uploaded" as const };
    },
    ...overrides
  });
  return { service, analyses, reports };
}

test("selects only the last ten visible user and assistant messages", () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: String(index),
    role: index === 2 ? "tool" : index === 3 ? "system" : index % 2 ? "assistant" : "user",
    content: `content-${index}`,
    excludeFromModelContext: index === 4,
    reasoningSummary: "private reasoning",
    attachments: [{ content: "attachment body", path: "C:/private.txt" }]
  }));
  const selected = selectUsageExceptionConversation(messages);
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.map((item) => item.id), ["6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]);
  assert.ok(selected.every((item) => !("attachments" in item) && !("reasoningSummary" in item)));
});

test("redacts common credentials, URL secrets, and private key blocks", () => {
  const redacted = redactUsageExceptionText([
    "Authorization: Bearer abc.def.ghi",
    "password=hunter2",
    "api_key: secret-key",
    "https://example.test/path?access_token=url-secret&safe=yes",
    "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----"
  ].join("\n"));
  for (const secret of ["abc.def.ghi", "hunter2", "secret-key", "url-secret", "private-material"]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /\[REDACTED\]/);
});

test("creates a non-persistent preview from bounded redacted trusted context", async () => {
  const { service, analyses, reports } = createHarness();
  const preview = await service.createPreview({
    workspaceId: "workspace-1",
    threadId: "thread-1",
    description: "生成文档后一直没有完成"
  });
  assert.equal(preview.title, "文档生成任务无法完成");
  assert.equal(preview.previewId, "preview-fixed");
  assert.equal(preview.expiresAt, "2026-08-01T12:05:00.000Z");
  assert.equal(reports.length, 0);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0]!.includes("secret-value"), false);
  assert.equal(analyses[0]!.includes("secret-token"), false);
  assert.equal(analyses[0]!.includes("attachment body"), false);
  assert.equal(analyses[0]!.includes('"id":"message-1"'), false);
});

test("repairs one invalid overlong model title and falls back after a second invalid result", async () => {
  const invalid = JSON.stringify({ ...JSON.parse(validAnalysis), title: "这是一条明显超过三十个中文字符并且不应该进入异常管理系统的异常标题文本" });
  const repaired = createHarness({ analysisResponses: [invalid, validAnalysis] });
  assert.equal((await repaired.service.createPreview({ workspaceId: "w", threadId: "t", description: "x" })).title, "文档生成任务无法完成");
  assert.equal(repaired.analyses.length, 2);
  assert.match(repaired.analyses[1]!, /修复/);

  const fallback = createHarness({ analysisResponses: [invalid, invalid] });
  const preview = await fallback.service.createPreview({
    workspaceId: "w",
    threadId: "t",
    description: "没有输出结果，达到安全步数上限"
  });
  assert.equal(preview.title, "没有输出结果，达到安全步数上限".slice(0, 30));
  assert.match(preview.possibleCause, /本地启发式|模型分析暂不可用/);
  assert.equal(fallback.reports.length, 0);
});

test("confirms a preview exactly once with the existing error-report shape", async () => {
  const { service, reports } = createHarness();
  await service.createPreview({ workspaceId: "workspace-1", threadId: "thread-1", description: "生成失败" });
  const result = await service.confirm({ previewId: "preview-fixed" });
  assert.deepEqual(result, { ok: true, localReportId: "desktop-error-1", delivery: "uploaded" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.kind, "user_reported_usage_exception");
  assert.equal(reports[0]!.message, "文档生成任务无法完成");
  assert.equal(reports[0]!.deviceId, "trusted-device");
  assert.equal(reports[0]!.appVersion, "0.1.60");
  assert.equal((reports[0]!.context as Record<string, unknown>).feedbackSchemaVersion, 1);
  await assert.rejects(service.confirm({ previewId: "preview-fixed" }), /already submitted/);
  assert.equal(reports.length, 1);
});

test("rejects expired previews without reporting", async () => {
  let current = new Date("2026-08-01T12:00:00.000Z");
  const harness = createHarness({ now: () => current });
  await harness.service.createPreview({ workspaceId: "w", threadId: "t", description: "x" });
  current = new Date("2026-08-01T12:06:00.000Z");
  await assert.rejects(harness.service.confirm({ previewId: "preview-fixed" }), /expired/);
  assert.equal(harness.reports.length, 0);
});
