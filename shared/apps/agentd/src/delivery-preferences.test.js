import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDocumentStyleDomain,
  attachResolvedStyleToInput,
  formatDeliveryPreferencesPromptBlock,
  mergeDocumentStyleValues,
  normalizeFontFamily,
  parseDeliveryPreferences,
  resolveDocumentStyle,
  summarizeDocumentStyle
} from "./delivery-preferences.js";
import {
  extractDeliveryPreferenceUpdate,
  extractDocumentStyleValues,
  isDocumentDeliveryIntent
} from "./delivery-preference-extract.js";

test("normalizes Chinese font aliases", () => {
  assert.equal(normalizeFontFamily("宋体"), "SimSun");
  assert.equal(normalizeFontFamily("微软雅黑"), "Microsoft YaHei");
});

test("merge prefers later layers and explicit tool args", () => {
  const resolved = resolveDocumentStyle({
    project: {
      version: 1,
      domains: {
        "document.style": {
          scope: "project",
          values: { fontFamily: "宋体", lineSpacing: 1.5 },
          summary: "宋体 行距1.5"
        }
      }
    },
    thread: {
      version: 1,
      domains: {
        "document.style": {
          scope: "thread",
          values: { fontSizePt: 12 },
          summary: "12pt"
        }
      }
    },
    turn: { fontFamily: "黑体" },
    explicit: { lineSpacing: 2 }
  });
  assert.equal(resolved.values.fontFamily, "SimHei");
  assert.equal(resolved.values.fontSizePt, 12);
  assert.equal(resolved.values.lineSpacing, 2);
});

test("one-shot extract stays turn-scoped and does not promote", () => {
  const update = extractDeliveryPreferenceUpdate({
    user: "仅本次用楷体、行距 1.5",
    assistant: "好的"
  });
  assert.equal(update.scope, "turn");
  assert.equal(update.promoteToProject, false);
  assert.equal(update.values.fontFamily, "KaiTi");
  assert.equal(update.values.lineSpacing, 1.5);
});

test("promote markers lift to project", () => {
  const update = extractDeliveryPreferenceUpdate({
    user: "以后默认正文宋体小四、行距1.5",
    assistant: "已记住"
  });
  assert.equal(update.scope, "project");
  assert.equal(update.promoteToProject, true);
  assert.equal(update.values.fontFamily, "SimSun");
  assert.equal(update.values.fontSizePt, 12);
});

test("extract understands 小四 and heading bold", () => {
  const values = extractDocumentStyleValues("标题加粗，正文小四");
  assert.equal(values.fontSizePt, 12);
  assert.equal(values.headingBold, true);
});

test("attachResolvedStyleToInput merges style object", () => {
  const next = attachResolvedStyleToInput({ title: "A" }, { fontFamily: "宋体", lineSpacing: 1.5 });
  assert.equal(next.style.fontFamily, "SimSun");
  assert.equal(next.style.lineSpacing, 1.5);
});

test("prompt block empty without values", () => {
  assert.equal(formatDeliveryPreferencesPromptBlock({}), "");
  const block = formatDeliveryPreferencesPromptBlock({
    thread: applyDocumentStyleDomain({}, {
      scope: "thread",
      values: { fontFamily: "宋体", lineSpacing: 1.5 }
    })
  });
  assert.match(block, /document\.style/);
  assert.match(block, /SimSun|宋体|行距/);
});

test("document delivery intent detection", () => {
  assert.equal(isDocumentDeliveryIntent("帮我写一份报告"), true);
  assert.equal(isDocumentDeliveryIntent("重构这个模块"), false);
});

test("buildDeliveryPreferenceUiState exposes clear/pin and gap question", async () => {
  const { buildDeliveryPreferenceUiState } = await import("./delivery-preferences.js");
  const withThread = buildDeliveryPreferenceUiState({
    thread: applyDocumentStyleDomain({}, {
      scope: "thread",
      values: { fontFamily: "宋体", lineSpacing: 1.5 }
    })
  });
  assert.equal(withThread.hasStyle, true);
  assert.equal(withThread.canPin, true);
  assert.equal(withThread.canClear, true);
  assert.equal(withThread.scope, "thread");

  const withGap = buildDeliveryPreferenceUiState({
    openQuestions: ["待确认交付版式: 正文用什么字体和行距？"]
  });
  assert.equal(withGap.visible, false);
  assert.ok(withGap.styleGapQuestion.includes("待确认交付版式"));
});

test("parseDeliveryPreferences ignores empty domains", () => {
  const parsed = parseDeliveryPreferences({ version: 1, domains: {} });
  assert.deepEqual(parsed.domains, {});
  assert.equal(summarizeDocumentStyle(mergeDocumentStyleValues({ fontFamily: "黑体" })), "SimHei");
});
