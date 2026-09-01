import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiSource = await readFile(new URL("../ui.tsx", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");

test("diverts usage exception commands before clearing or ordinary chat submission", () => {
  assert.match(uiSource, /parseUsageExceptionCommand\(draftQuestion\)/);
  const parserIndex = uiSource.indexOf("parseUsageExceptionCommand(draftQuestion)");
  const clearIndex = uiSource.indexOf('setQuestion("")', parserIndex);
  const chatIndex = uiSource.indexOf("api.chatWithModel", parserIndex);
  assert.ok(parserIndex >= 0 && parserIndex < clearIndex && clearIndex < chatIndex);
  assert.match(uiSource, /createUsageExceptionFeedbackPreview/);
  assert.match(uiSource, /const isQueuedDraftReplay = Boolean\(draftOverride\?\.createdAt\)/);
  assert.match(uiSource, /if \(!isQueuedDraftReplay\)/);
});

test("renders a non-editable confirmation dialog with only cancel and confirm commands", () => {
  const start = workspaceSource.indexOf('data-testid="usage-exception-feedback-dialog"');
  assert.ok(start >= 0);
  const end = workspaceSource.indexOf("</section>", start);
  const dialog = workspaceSource.slice(start, end);
  assert.match(dialog, /异常标题/);
  assert.match(dialog, /可能原因/);
  assert.match(dialog, /上下文摘要/);
  assert.match(dialog, />取消</);
  assert.match(dialog, />确认提交</);
  assert.doesNotMatch(dialog, /<input|<textarea|contentEditable/);
  assert.match(dialog, /disabled=\{usageExceptionFeedbackBusy\}/);
});

test("cancel and confirm use separate handlers", () => {
  assert.match(workspaceSource, /onClick=\{cancelUsageExceptionFeedback\}>取消/);
  assert.match(workspaceSource, /onClick=\{\(\) => void confirmUsageExceptionFeedback\(\)\}>确认提交/);
});

test("generation failure card can start usage exception feedback without ordinary chat", () => {
  assert.match(uiSource, /async function startUsageExceptionFeedback/);
  assert.match(uiSource, /async function reportGenerationFailureFeedback/);
  assert.match(uiSource, /reportGenerationFailureFeedback=\{reportGenerationFailureFeedback\}/);
  assert.match(uiSource, /政务写作或对话生成异常终止：\$\{generationFailure\.message\}/);
  const cardStart = workspaceSource.indexOf('data-testid="generation-failure-card"');
  assert.ok(cardStart >= 0);
  const cardEnd = workspaceSource.indexOf("</section>", cardStart);
  const card = workspaceSource.slice(cardStart, cardEnd);
  assert.match(card, /data-testid="generation-failure-report-feedback"/);
  assert.match(card, /反馈此异常/);
  assert.match(card, /reportGenerationFailureFeedback/);
  assert.doesNotMatch(card, /chatWithModel/);
});
