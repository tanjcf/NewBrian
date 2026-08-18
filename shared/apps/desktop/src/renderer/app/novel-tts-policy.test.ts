import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NOVEL_TTS_VOICE_ID,
  NOVEL_TTS_SELECTABLE_VOICES,
  NOVEL_TTS_VOICES,
  buildSpeechProgressWeights,
  chunkNovelSpeechText,
  estimateFollowAbsoluteIndex,
  estimateFollowDurationMs,
  mapSpeechOffsetToSourceLines,
  prepareNovelSpeechText,
  readStoredNovelTtsVoiceId,
  resolveNovelTtsVoice,
  speechRatioToAbsoluteIndex,
  stripMarkdownForSpeech
} from "../../shared/novel-tts-policy.ts";

test("exposes the requested novel voice catalog", () => {
  assert.equal(NOVEL_TTS_VOICES.length, 8);
  assert.deepEqual(
    NOVEL_TTS_VOICES.map((voice) => voice.label),
    [
      "多角色对话-自然流畅",
      "双角色对话-双音灵动",
      "成熟大叔音-超自然",
      "成熟大叔音-经典",
      "甜美少女音-感然力",
      "开朗青年音-轻快",
      "清亮青叔音-活力",
      "沉稳旁白-清晰"
    ]
  );
  assert.equal(resolveNovelTtsVoice("missing").id, DEFAULT_NOVEL_TTS_VOICE_ID);
  assert.ok(NOVEL_TTS_VOICES.every((voice) => Boolean(voice.kokoroVoice)));
  assert.equal(NOVEL_TTS_SELECTABLE_VOICES.length, 1);
  assert.equal(NOVEL_TTS_SELECTABLE_VOICES[0]?.id, DEFAULT_NOVEL_TTS_VOICE_ID);
  assert.equal(readStoredNovelTtsVoiceId(), DEFAULT_NOVEL_TTS_VOICE_ID);
});

test("strips markdown and prepares bounded speakable text", () => {
  assert.equal(
    stripMarkdownForSpeech("# 标题\n\n这是**加粗**与[链接](https://a.test)和`代码`。"),
    "标题\n\n这是加粗与链接和代码。"
  );
  assert.equal(prepareNovelSpeechText("   ").ok, false);
  const long = "甲".repeat(9_000);
  const prepared = prepareNovelSpeechText(long);
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.truncated, true);
    assert.ok(prepared.text.endsWith("……"));
    assert.ok(prepared.text.length < long.length);
  }
});

test("chunks long speech text so local synthesis stays responsive", () => {
  const text = `${"这是一句测试。".repeat(40)}结尾。`;
  const chunks = chunkNovelSpeechText(text, 40);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 41));
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
  assert.equal(chunks[0]?.start, 0);
  assert.equal(chunks[chunks.length - 1]?.end, text.length);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
  }
});

test("maps speech offsets back to source lines for follow-along", () => {
  const source = "# 标题\n\n第一行正文。\n第二行正文。\n第三行正文。";
  const prepared = prepareNovelSpeechText(source);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const first = mapSpeechOffsetToSourceLines(source, 0, "标题");
  assert.equal(first.line, 1);
  assert.equal(first.endLine, first.line);
  assert.equal(first.totalLines, 5);
  const secondLineAt = prepared.text.indexOf("第二行正文");
  assert.ok(secondLineAt >= 0);
  const later = mapSpeechOffsetToSourceLines(source, secondLineAt, "第二行正文");
  assert.equal(later.line, 4);
  assert.equal(later.endLine, later.line);
  assert.match(later.snippet, /第二行正文/);
});

test("maps deep offsets far down a long novel preview", () => {
  const lines = Array.from({ length: 80 }, (_, index) => `第${index + 1}行内容，继续往下读。`);
  const source = lines.join("\n");
  const prepared = prepareNovelSpeechText(source);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const target = "第60行内容";
  const offset = prepared.text.indexOf(target);
  assert.ok(offset > 0);
  const mapped = mapSpeechOffsetToSourceLines(source, offset, target);
  assert.equal(mapped.line, 60);
  assert.equal(mapped.endLine, 60);
});

test("skips thematic breaks and blank lines when following novel markdown", () => {
  const source = [
    "第七层楼 · 试读",
    "",
    "---",
    "",
    "凌晨两点十七分，林昭接到那通电话。",
    "",
    "电话响到第三声，他才摸到手机。"
  ].join("\n");
  const prepared = prepareNovelSpeechText(source);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.text.includes("---"), false);

  const storyAt = prepared.text.indexOf("凌晨两点十七分");
  assert.ok(storyAt >= 0);
  const story = mapSpeechOffsetToSourceLines(source, storyAt);
  assert.equal(story.line, 5);
  assert.equal(story.endLine, 5);
  assert.match(story.snippet, /凌晨两点十七分/);

  // Gap between paragraphs must stay on the previous speakable line (not the blank row).
  const afterFirst = prepared.text.indexOf("电话响到第三声");
  assert.ok(afterFirst > storyAt);
  const gap = mapSpeechOffsetToSourceLines(source, afterFirst - 1);
  assert.equal(gap.line, 5);
  assert.equal(gap.endLine, 5);

  const second = mapSpeechOffsetToSourceLines(source, afterFirst);
  assert.equal(second.line, 7);
  assert.equal(second.endLine, 7);
});

test("weighted speech progress lingers on paragraph breaks instead of racing ahead", () => {
  const text = "第一句完。\n\n第二段开始读。";
  const { total } = buildSpeechProgressWeights(text);
  assert.ok(total > text.length);

  const linearMid = Math.floor(text.length * 0.45);
  const weightedMid = speechRatioToAbsoluteIndex(text, 0.45);
  // Around mid-timeline we should still be before or in the break, not deep into paragraph 2.
  assert.ok(weightedMid <= text.indexOf("第二段"));
  assert.ok(weightedMid <= linearMid + 2);

  assert.equal(speechRatioToAbsoluteIndex(text, 0), 0);
  assert.equal(speechRatioToAbsoluteIndex(text, 1), text.length);
});

test("highlight playhead trails audio and dwells on lines without changing speech timing", () => {
  const text = "凌晨两点十七分，林昭接到那通电话。\n\n电话响到第三声，他才摸到手机。\n\n屏幕上没有备注。";
  const duration = 30_000;
  // Early on, trail keeps highlight at the start even though audio has begun.
  assert.equal(estimateFollowAbsoluteIndex(text, 400, duration), 0);

  const highlighted = estimateFollowAbsoluteIndex(text, 12_000, duration);
  // With trail + line dwell, 12s into a 30s clip should still be before the last paragraph.
  assert.ok(highlighted < text.indexOf("屏幕上没有备注"));

  assert.equal(estimateFollowDurationMs(text, 27_150), 27_150);
  assert.equal(estimateFollowAbsoluteIndex(text, duration, duration), text.length);
});
