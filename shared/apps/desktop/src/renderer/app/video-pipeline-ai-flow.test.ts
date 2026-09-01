import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoPipelineAgentQuestion,
  looksLikeAiInstructionPrompt,
  looksLikeLiteralDialogueLine
} from "./video-pipeline-ai-flow.ts";

test("detects Chinese AI instruction prompts used as fake TTS content", () => {
  assert.equal(
    looksLikeAiInstructionPrompt("给这个视频写个背景旁白，然后转换成语音"),
    true
  );
  assert.equal(looksLikeAiInstructionPrompt("写一段旁白并转换成语音"), true);
  assert.equal(looksLikeAiInstructionPrompt("请帮我重新生成这镜视频"), true);
  assert.equal(looksLikeAiInstructionPrompt("按提示词更新生成"), true);
});

test("literal short dialogue is not treated as AI instruction", () => {
  assert.equal(looksLikeAiInstructionPrompt("夜色渐浓，狐狸抬头望月。"), false);
  assert.equal(looksLikeLiteralDialogueLine("夜色渐浓，狐狸抬头望月。"), true);
  assert.equal(looksLikeLiteralDialogueLine("给这个视频写个背景旁白，然后转换成语音"), false);
});

test("agent question includes scene context and anti-TTS-instruction guard", () => {
  const question = buildVideoPipelineAgentQuestion({
    projectId: "proj-1",
    shotIndex: 0,
    shotId: "shot-1",
    shotTitle: "开场",
    canvasSize: "1920x1080",
    kind: "narration",
    userPrompt: "给这个视频写个背景旁白，然后转换成语音",
    currentLine: "给这个视频写个背景旁白，然后转换成语音"
  });
  assert.match(question, /视频流水线/);
  assert.match(question, /镜 1/);
  assert.match(question, /1920x1080/);
  assert.match(question, /video\.audio\.speech/);
  assert.match(question, /禁止把整段/);
});
