/**
 * Extract document.style delivery preferences from a user/assistant exchange.
 */

import {
  DOCUMENT_STYLE_DOMAIN,
  normalizeDocumentStyleValues,
  summarizeDocumentStyle
} from "./delivery-preferences.js";

const STYLE_MARKERS = [
  "字体", "字号", "行距", "行间距", "版式", "页边距", "标题加粗", "小四", "五号", "三号",
  "宋体", "黑体", "楷体", "仿宋", "微软雅黑", "雅黑",
  "font", "line spacing", "line-height", "margin", "simsun", "yahei"
];

const PROMOTE_MARKERS = [
  "以后", "今后", "每次", "始终", "记住", "长期", "默认", "作为默认", "from now on", "always", "remember", "every time"
];

const ONE_SHOT_MARKERS = [
  "仅本次", "这一次", "仅此", "就这一次", "只这一次", "这次请求", "本次", "this time only", "only this", "just this"
];

const CORRECTION_MARKERS = [
  "不要", "别再", "改成", "改为", "应该是", "不对", "错了", "instead", "don't", "do not", "never", "change to", "should be"
];

const CLEAR_MARKERS = [
  "恢复默认版式", "取消版式", "别用之前版式", "清除版式", "reset style", "clear document style", "default formatting"
];

const DOCUMENT_INTENT_MARKERS = [
  "报告", "公文", "文档", "docx", "pdf", "word", "宣讲", "材料", "生成文档", "写一份", "出一份",
  "document", "report", "memo"
];

function includesAny(text, markers) {
  const lower = String(text || "").toLowerCase();
  return markers.some((marker) => lower.includes(String(marker).toLowerCase()));
}

function parseFontFamily(text) {
  const patterns = [
    /(?:字体|font(?:\s*family)?)[：:\s]*([宋体黑体楷体仿宋微软雅黑雅黑A-Za-z][A-Za-z\u4e00-\u9fa5]*)/i,
    /用([\u4e00-\u9fa5]{1,6}体)/,
    /(微软雅黑|雅黑|宋体|黑体|楷体|仿宋|SimSun|SimHei|KaiTi|FangSong|Microsoft YaHei)/i
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function parseFontSizePt(text) {
  const source = String(text || "");
  if (/小四/.test(source)) return 12;
  if (/五号/.test(source)) return 10.5;
  if (/三号/.test(source)) return 16;
  const pt = source.match(/(?:字号|字号为|font\s*size)[：:\s]*(\d+(?:\.\d+)?)\s*(?:pt|磅)?/i)
    || source.match(/(\d+(?:\.\d+)?)\s*(?:pt|磅)/i);
  if (pt?.[1]) return Number(pt[1]);
  return null;
}

function parseLineSpacing(text) {
  const match = String(text || "").match(/(?:行距|行间距|line\s*spacing|line-height)[：:\s]*(\d+(?:\.\d+)?)/i)
    || String(text || "").match(/(\d+(?:\.\d+)?)\s*倍行距/);
  if (match?.[1]) return Number(match[1]);
  return null;
}

function parseHeadingBold(text) {
  const source = String(text || "");
  if (/标题加粗|标题.*加粗|heading.*bold/i.test(source)) return true;
  if (/标题不加粗|标题.*不加粗|heading.*not\s*bold/i.test(source)) return false;
  return null;
}

function parseMarginsMm(text) {
  const match = String(text || "").match(/页边距[：:\s]*(\d+(?:\.\d+)?)\s*(?:mm|毫米)?/i);
  if (!match?.[1]) return null;
  const mm = Number(match[1]);
  if (!Number.isFinite(mm)) return null;
  return { top: mm, right: mm, bottom: mm, left: mm };
}

export function isDocumentStyleSensitive(text) {
  return includesAny(text, STYLE_MARKERS);
}

export function isDocumentDeliveryIntent(text) {
  return includesAny(text, DOCUMENT_INTENT_MARKERS);
}

export function extractDocumentStyleValues(text) {
  const source = String(text || "");
  const draft = {};
  const fontFamily = parseFontFamily(source);
  if (fontFamily) draft.fontFamily = fontFamily;
  const fontSizePt = parseFontSizePt(source);
  if (fontSizePt != null) draft.fontSizePt = fontSizePt;
  const lineSpacing = parseLineSpacing(source);
  if (lineSpacing != null) draft.lineSpacing = lineSpacing;
  const headingBold = parseHeadingBold(source);
  if (headingBold != null) draft.headingBold = headingBold;
  const marginsMm = parseMarginsMm(source);
  if (marginsMm) draft.marginsMm = marginsMm;
  return normalizeDocumentStyleValues(draft);
}

/**
 * @returns {null | { clear?: true, domain: string, scope: "turn"|"thread"|"project", values?: object, source: string, summary: string, promoteToProject: boolean }}
 */
export function extractDeliveryPreferenceUpdate(input = {}) {
  const user = String(input.user || "");
  const assistant = String(input.assistant || "");
  const combined = `${user}\n${assistant}`;

  if (includesAny(user, CLEAR_MARKERS)) {
    return {
      clear: true,
      domain: DOCUMENT_STYLE_DOMAIN,
      scope: includesAny(user, PROMOTE_MARKERS) ? "project" : "thread",
      source: "user_correction",
      summary: "清除交付版式",
      promoteToProject: includesAny(user, PROMOTE_MARKERS)
    };
  }

  const fromUser = extractDocumentStyleValues(user);
  const fromAssistant = Object.keys(fromUser).length ? {} : extractDocumentStyleValues(assistant);
  const values = Object.keys(fromUser).length ? fromUser : fromAssistant;
  if (!Object.keys(values).length) return null;
  if (!isDocumentStyleSensitive(combined) && !Object.keys(values).length) return null;

  const oneShot = includesAny(user, ONE_SHOT_MARKERS);
  const promote = !oneShot && includesAny(user, PROMOTE_MARKERS);
  const correction = includesAny(user, CORRECTION_MARKERS);
  const scope = oneShot ? "turn" : promote ? "project" : "thread";
  const source = correction
    ? "user_correction"
    : (input.openQuestions?.length ? "learning_answer" : "user_explicit");

  return {
    domain: DOCUMENT_STYLE_DOMAIN,
    scope,
    values,
    source,
    summary: summarizeDocumentStyle(values),
    promoteToProject: promote,
    confidence: correction || promote ? 0.95 : 0.85
  };
}
