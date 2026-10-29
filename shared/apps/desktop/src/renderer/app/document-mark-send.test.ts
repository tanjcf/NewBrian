import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { placeDocumentMarkPrompt } from "./document-mark-prompt-placement.ts";

test("annotation toolbar no longer saves a mark into the composer", () => {
  const layer = readFileSync(new URL("./DocumentAnnotationLayer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layer, /保存标注/);
  assert.doesNotMatch(layer, /document-annotation-editor/);
  assert.doesNotMatch(layer, /onSave/);
  assert.doesNotMatch(layer, /加入对话/);
});

test("mark prompt sends the revision straight into the conversation", () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const marking = readFileSync(new URL("./DocumentMarkingLayer.tsx", import.meta.url), "utf8");
  const sendStart = modules.indexOf("const sendPendingDocumentMark = async () => {");
  const sendEnd = modules.indexOf("const handlePreviewMark =", sendStart);
  const sendSource = modules.slice(sendStart, sendEnd);
  assert.ok(sendStart > 0 && sendEnd > sendStart);
  assert.match(sendSource, /clearPendingDocumentMark\(\)/);
  assert.match(sendSource, /resolveAnnotatedMarkImages/);
  assert.match(sendSource, /submitComposerRequest\(\{[\s\S]*keepComposer:\s*true/);
  assert.doesNotMatch(marking, /data-testid="document-marking-saved"/);
  assert.doesNotMatch(sendSource, /setQuestion\(/);
  assert.doesNotMatch(sendSource, /composerTextareaRef/);
  assert.match(marking, /data-testid="document-mark-prompt"/);
  assert.match(marking, /aria-label="发送修改"/);
  assert.match(marking, /markPrompt\.onSubmit\(\)/);
  assert.match(modules, /<DocumentMarkPromptProvider value=\{documentMarkPrompt\}>/);
  assert.match(modules, /documentAnnotationSnapshotPromiseRef/);
  assert.match(modules, /mark:\s*\{\s*rect:\s*input\.rect/);
  assert.doesNotMatch(modules, /saveDocumentAnnotation/);
});

test("the yellow dashed mark stays on the region and the prompt sits outside it", () => {
  const marking = readFileSync(new URL("./DocumentMarkingLayer.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(marking, /document-marking-region-label">标记区域/);
  assert.doesNotMatch(marking, /加入对话/);
  assert.match(styles, /\.document-marking-pending\.select-rect[\s\S]*border:\s*2px dashed/);
  const below = placeDocumentMarkPrompt({ x: 20, y: 30, width: 80, height: 40 }, { width: 400, height: 300 });
  assert.equal(below.top, 80);
  assert.equal(below.left, 20);
  const above = placeDocumentMarkPrompt({ x: 20, y: 250, width: 80, height: 40 }, { width: 400, height: 300 });
  assert.equal(above.top, 200);
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
