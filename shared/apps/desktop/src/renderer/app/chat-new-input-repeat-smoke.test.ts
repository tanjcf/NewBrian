/**
 * CHAT-NEW-INPUT-REPEAT-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A newly sent question must not show the previous turn's answer underneath it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { liveTurnAnswerText, retainStreamingText } from "./chat-scroll-stability.ts";

const CASE_ID = "CHAT-NEW-INPUT-REPEAT-SMOKE-001";
const PREVIOUS_ANSWER = "健康检查路径是 /api/health，不是 /health。";

test(`${CASE_ID} hides the previous answer under a new question while the new stream is empty`, () => {
  const shown = liveTurnAnswerText({
    streamText: "",
    turnText: PREVIOUS_ANSWER,
    earlierTurnTexts: [PREVIOUS_ANSWER],
    retained: PREVIOUS_ANSWER,
    sameRequest: false
  });
  assert.equal(shown, "");
});

test(`${CASE_ID} does not keep a retained answer after the request id changes`, () => {
  const shown = liveTurnAnswerText({
    streamText: "",
    turnText: "",
    earlierTurnTexts: [PREVIOUS_ANSWER],
    retained: PREVIOUS_ANSWER,
    sameRequest: false
  });
  assert.equal(shown, "");
});

test(`${CASE_ID} keeps the in-progress answer when a later chunk on the same request is empty`, () => {
  const current = "新回答已经开始";
  assert.equal(retainStreamingText(current, ""), current);
  const shown = liveTurnAnswerText({
    streamText: "",
    turnText: "",
    earlierTurnTexts: [PREVIOUS_ANSWER],
    retained: current,
    sameRequest: true
  });
  assert.equal(shown, current);
});

test(`${CASE_ID} shows the new stream once it differs from the previous answer`, () => {
  const shown = liveTurnAnswerText({
    streamText: "已经启动。",
    turnText: PREVIOUS_ANSWER,
    earlierTurnTexts: [PREVIOUS_ANSWER],
    retained: "",
    sameRequest: true
  });
  assert.equal(shown, "已经启动。");
});

test(`${CASE_ID} scopes live retention to the active request in the workspace`, () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(modules, /retainedLiveAnswerRequestRef/);
  assert.match(modules, /liveTurnAnswerText/);
  assert.match(modules, /sameRequest: Boolean\(requestId\) && sameRequest/);
  assert.doesNotMatch(
    modules,
    /rememberLiveAnswer\(sanitizeVisibleModelContent\(activeStreamContent \|\| turn\.assistant\.content\)\)/
  );
});
