/**
 * PPT-MARK-SEND-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * The slide mark prompt send button must deliver the typed instruction.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planDocumentMarkSend } from "./document-mark-send-policy.ts";

const CASE_ID = "PPT-MARK-SEND-SMOKE-001";

test(`${CASE_ID} sends a written slide instruction instead of ignoring the click`, () => {
  assert.deepEqual(planDocumentMarkSend({
    instruction: "改成卡通咖啡的图片",
    hasBrainFile: false,
    hasProject: false,
    hasCandidate: true,
    hasAnnotationApi: false
  }), { action: "chat" });
  assert.deepEqual(planDocumentMarkSend({
    instruction: "改成卡通咖啡的图片",
    hasBrainFile: true,
    hasProject: true,
    hasCandidate: true,
    hasAnnotationApi: true
  }), { action: "annotate-and-chat" });
  assert.deepEqual(planDocumentMarkSend({
    instruction: "   ",
    hasBrainFile: true,
    hasProject: true,
    hasCandidate: true,
    hasAnnotationApi: true
  }), { action: "ignore" });
});

test(`${CASE_ID} keeps the send click on the button and out of the marking drag`, () => {
  const marking = readFileSync(new URL("./DocumentMarkingLayer.tsx", import.meta.url), "utf8");
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const pointerStart = marking.indexOf("onPointerDown={(event) => {");
  const pointerEnd = marking.indexOf("if (!props.active || event.button !== 0) return;", pointerStart);
  const pointerGuard = marking.slice(pointerStart, pointerEnd);
  assert.ok(pointerStart > 0 && pointerEnd > pointerStart);
  assert.match(pointerGuard, /closest\("\.pptx-mark-prompt, button, input, textarea"\)/);
  assert.match(pointerGuard, /return;/);
  assert.match(marking, /aria-label="发送修改"/);
  assert.match(marking, /type="button"/);
  assert.match(marking, /onClick=\{\(event\) => \{[\s\S]*markPrompt\.onSubmit\(\)/);
  const sendStart = modules.indexOf("const sendPendingDocumentMark = async () => {");
  const sendEnd = modules.indexOf("const handlePreviewMark =", sendStart);
  const sendSource = modules.slice(sendStart, sendEnd);
  assert.match(sendSource, /planDocumentMarkSend\(/);
  assert.match(sendSource, /action === "chat"/);
  assert.match(sendSource, /resolveAnnotatedMarkImages/);
  assert.match(sendSource, /submitComposerRequest\(\{[\s\S]*question: instruction[\s\S]*keepComposer:\s*true/);
  assert.doesNotMatch(sendSource, /if \(!activeBrainFile \|\| !selectedBrainProjectId \|\| !documentAnnotationCandidate \|\| !documentAnnotationInstruction\.trim\(\)\) return;/);
});
