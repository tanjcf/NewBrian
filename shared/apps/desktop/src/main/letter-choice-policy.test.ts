import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expandLetterChoiceRequest,
  extractLetterChoiceOptions,
  isRepeatMenuComplaint,
  matchBareLetterChoice
} from "./letter-choice-policy.ts";

const menu = `方案整体框架已定。你选一个方向，我立刻开工：

A：写第一卷第1-3章正文（约6000-9000字），让你看文风和节奏
B：拆分第一卷完整章节大纲（20-30章级别），每章一句话梗概
C：先出全部主要人物小传
D：不满意的地方先调整，调整完再动笔
选哪个？`;

test("extracts Chinese A/B/C/D next-step menus", () => {
  const options = extractLetterChoiceOptions(menu);
  assert.deepEqual(
    options.map((option) => option.letter),
    ["A", "B", "C", "D"]
  );
  assert.match(options[1]!.text, /拆分第一卷完整章节大纲/);
});

test("matches bare letter choices", () => {
  assert.equal(matchBareLetterChoice("B"), "B");
  assert.equal(matchBareLetterChoice("b"), "B");
  assert.equal(matchBareLetterChoice("选B"), "B");
  assert.equal(matchBareLetterChoice("选择 A"), "A");
  assert.equal(matchBareLetterChoice("写第2章"), null);
});

test("expands bare B into the prior menu option and blocks re-asking", () => {
  const expanded = expandLetterChoiceRequest("B", [
    { role: "assistant", content: menu },
    { role: "user", content: "B" }
  ]);
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.letter, "B");
  assert.match(expanded.request, /用户选择：B — 拆分第一卷完整章节大纲/);
  assert.match(expanded.request, /不要再列出上一轮相同的/);
});

test("looks past a later menu that omits the chosen letter", () => {
  const later = `接下来？
A：继续写第2章
C：第1章有需要调整的地方先说
D：方案里有什么想调的
你说。`;
  const expanded = expandLetterChoiceRequest("B", [
    { role: "assistant", content: menu },
    { role: "assistant", content: later },
    { role: "user", content: "B" }
  ]);
  assert.equal(expanded.expanded, true);
  assert.match(expanded.request, /拆分第一卷完整章节大纲/);
});

test("expands repeat-menu complaints using the prior letter choice", () => {
  assert.equal(isRepeatMenuComplaint("为什么最后还是这个"), true);
  const expanded = expandLetterChoiceRequest("为什么最后还是这个", [
    { role: "assistant", content: menu },
    { role: "user", content: "B" },
    { role: "assistant", content: menu },
    { role: "user", content: "为什么最后还是这个" }
  ]);
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.letter, "B");
  assert.match(expanded.request, /用户此前已明确选择：B/);
  assert.match(expanded.request, /禁止再次给出相同/);
});

test("model chat service expands letter choices before the agent loop", () => {
  const servicePath = fileURLToPath(new URL("./model-chat-service.ts", import.meta.url));
  const service = readFileSync(servicePath, "utf8");
  assert.match(service, /expandLetterChoiceRequest/);
  assert.match(service, /已识别选项/);
  assert.match(service, /letterChoice\.expanded/);
});
