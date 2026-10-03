import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("annotation toolbar no longer saves a mark into the composer", () => {
  const layer = readFileSync(new URL("./DocumentAnnotationLayer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layer, /保存标注/);
  assert.doesNotMatch(layer, /document-annotation-editor/);
  assert.doesNotMatch(layer, /onSave/);
});

test("mark prompt sends the revision straight into the conversation", () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const marking = readFileSync(new URL("./DocumentMarkingLayer.tsx", import.meta.url), "utf8");
  const sendStart = modules.indexOf("const sendPendingDocumentMark = async () => {");
  const sendEnd = modules.indexOf("const handlePreviewMark =", sendStart);
  const sendSource = modules.slice(sendStart, sendEnd);
  assert.ok(sendStart > 0 && sendEnd > sendStart);
  assert.match(sendSource, /submitComposerRequest\(\{[\s\S]*keepComposer:\s*true/);
  assert.doesNotMatch(sendSource, /setQuestion\(/);
  assert.doesNotMatch(sendSource, /composerTextareaRef/);
  assert.match(marking, /data-testid="document-mark-prompt"/);
  assert.match(marking, /aria-label="发送修改"/);
  assert.match(marking, /markPrompt\.onSubmit\(\)/);
  assert.match(modules, /<DocumentMarkPromptProvider value=\{documentMarkPrompt\}>/);
  assert.doesNotMatch(modules, /saveDocumentAnnotation/);
});

test("direct mark send does not clear an unrelated composer draft", () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const windowsUi = readFileSync(new URL("../../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url), "utf8");
  const submitSource = modules.slice(modules.indexOf("function submitComposerRequest"), modules.indexOf("function renderBrainChatModule"));
  assert.match(submitSource, /if \(!outbound\.keepComposer\) clearComposerAfterSend\(\)/);
  assert.match(submitSource, /请再次发送/);
  assert.match(windowsUi, /keepComposer\?: boolean/);
  assert.match(windowsUi, /if \(!isQueuedDraftReplay && !keepComposer\)/);
});
