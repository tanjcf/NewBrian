import { extractFirstJsonObject } from "./json-extraction.js";
import {
  governmentDraftBodyInstruction,
  hasSubstantiveGovernmentDraftBody,
  isGovernmentDraftClaimWithoutBody
} from "./government-draft-body.js";

export type GovernmentWritingFinalization = {
  finalDraft: string;
  styleReview: string;
  factReview: string;
  verificationNeeded: string[];
};

export {
  governmentDraftBodyInstruction,
  hasSubstantiveGovernmentDraftBody,
  isGovernmentDraftClaimWithoutBody
};

export function createGovernmentFinalizationReplacementEmitter(
  requestId: string,
  emit: (payload: { requestId: string; delta: string; reset?: boolean }) => void
) {
  let replacementStarted = false;
  return (delta: string) => {
    if (!delta) return;
    emit({ requestId, delta, ...(replacementStarted ? {} : { reset: true }) });
    replacementStarted = true;
  };
}

const UNSUPPORTED_IMPLEMENTATION_PATTERN = /(?:即日起|本周内?|本月内?|下月起?|今年|明年|成立.{0,20}(?:工作组|专班)|由.{0,16}(?:科|处|局|办)牵头|设立.{0,20}(?:投诉|举报)?(?:热线|专线))/u;
const PAST_ACHIEVEMENT_PATTERN = /(?:前一阶段|今年以来|近年来|目前|截至|已经|已)[^。！？]*(?:提升|提高|增长|下降|减少|压缩|完成|建成|推出|建立|形成|取得|成效|成绩|进展|满意度|覆盖率|办结率)/u;
const FACT_TOKEN_PATTERN = /(?:《[^》]{2,80}》|20\d{2}年(?:\d{1,2}月(?:\d{1,2}日)?)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:亿元|万元|万人|万亩|平方公里|个项目)|(?:县级市|地级市|副省级市|自治州))/gu;

export function sanitizeGovernmentDraftForDelivery(input: string, sourceText = "") {
  let draft = String(input ?? "").trim();
  const evidence = String(sourceText ?? "").replace(/\s+/g, "");
  const firstSalutation = draft.indexOf("同志们");
  if (firstSalutation >= 0) draft = draft.slice(firstSalutation);
  draft = draft.split(/\n(?:---+|检查事实边界|现在更新计划|正文初稿已生成|这个版本大约|大约\s*\d+\s*字)/u)[0];
  draft = draft
    .replace(/(?:the user\s+(?:is asking|wants|requested)|let me\b|i need to\b|i should\b|i'm executing)[\s\S]*?(?=同志们|$)/gi, "")
    .replace(/今年以来[^。！？]*[。！？]/gu, "")
    .replace(/取得(?:了)?[^。！？]*(?:成效|成绩|进展)[^。！？]*[。！？]/gu, "")
    .replace(/对照上级要求/gu, "对照工作要求")
    .replace(/各科室/gu, "各责任主体");
  const sentences = draft.match(/[^。！？\n]+[。！？]?|\n+/gu) ?? [draft];
  return sentences
    .map((sentence) => {
      if (!evidence || sentence.includes("【待核验】")) return sentence;
      return sentence.replace(/贯彻落实[^，。；]*(?:部署|要求)[，,]?/gu, "围绕当前工作任务，");
    })
    .filter((sentence) => {
      if (UNSUPPORTED_IMPLEMENTATION_PATTERN.test(sentence)) return false;
      if (sentence.includes("【待核验】")) return true;
      const factTokens = sentence.match(FACT_TOKEN_PATTERN) ?? [];
      if (factTokens.length && (!evidence || !factTokens.every((token) => evidence.includes(token.replace(/\s+/g, ""))))) return false;
      if (!evidence) return true;
      if (PAST_ACHIEVEMENT_PATTERN.test(sentence) && !evidence.includes(sentence.replace(/[。！？\s]/g, ""))) return false;
      return true;
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function selectGovernmentDraftCandidate(current: string, priorAssistantMessages: string[]) {
  const completionSummaryPattern = /goal\s+completed|\u76ee\u6807\u5df2\u5b8c\u6210|\u6d41\u7a0b\u5168\u90e8\u95ed\u73af/i;
  const normalizedCurrent = String(current ?? "").trim();
  const priorCandidates = priorAssistantMessages
    .map((text) => String(text ?? "").trim())
    .filter((text) =>
      text
      && text !== normalizedCurrent
      && !completionSummaryPattern.test(text)
      && !isGovernmentDraftClaimWithoutBody(text)
    );
  const candidates = [normalizedCurrent, ...priorCandidates]
    .filter((text) => text && !isGovernmentDraftClaimWithoutBody(text));
  const substantive = candidates.filter((text) => hasSubstantiveGovernmentDraftBody(text));
  const currentIsCompletionSummary = completionSummaryPattern.test(normalizedCurrent)
    || isGovernmentDraftClaimWithoutBody(normalizedCurrent);
  if (!currentIsCompletionSummary && hasSubstantiveGovernmentDraftBody(normalizedCurrent)) {
    return normalizedCurrent;
  }
  return substantive[0] ?? "";
}

/**
 * Pick government article body for native PDF/DOCX delivery.
 * Prefer the same substantive candidate as finalization; fall back to a short
 * complete speech (salutation) so brief closing remarks still export.
 */
export function prepareGovernmentPdfContent(content: string, priorAssistantMessages: string[], _sourceText = "") {
  void _sourceText;
  const preferred = selectGovernmentDraftCandidate(content, priorAssistantMessages);
  const candidates = [content, ...priorAssistantMessages]
    .map((candidate) => String(candidate ?? "").trim())
    .filter(Boolean);
  const salutations = ["同志们"];
  const selected = preferred
    || candidates.find((candidate) =>
      salutations.some((salutation) => candidate.includes(salutation))
      && candidate.replace(/\s+/g, "").length >= 80
    )
    || "";
  if (!selected) return "";
  const salutationOffsets = salutations
    .map((salutation) => selected.indexOf(salutation))
    .filter((offset) => offset >= 0);
  const salutationOffset = salutationOffsets.length ? Math.min(...salutationOffsets) : -1;
  return (salutationOffset >= 0 ? selected.slice(salutationOffset) : selected)
    .split(/\n#{1,6}\s*终审结果/u)[0]
    .replace(/\n*PDF (?:文件)?尚未生成并验证[\s\S]*$/u, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

export function buildGovernmentWritingFinalizationRequest(userRequest: string, draft: string) {
  return [
    "Finalize a government-writing draft after the user confirmed its outline.",
    "Return JSON only: {\"finalDraft\":\"...\",\"styleReview\":\"...\",\"factReview\":\"...\",\"verificationNeeded\":[\"...\"]}.",
    "The finalDraft must preserve the confirmed structure, genre, audience, scenario, and requested length.",
    "Unify the prose into disciplined Chinese public-sector research style: concrete, restrained, and not news-like or slogan-heavy.",
    "Do not invent policy titles, program names, statistics, dates, administrative facts, local practices, achievements, or attributed statements.",
    "Treat factual detail as verified only when the supplied evidence contains a primary official source from the originating government authority, such as a government website, official gazette, official policy document, or official statistical bulletin.",
    "Media reports, search snippets, encyclopedias, model memory, and plausible inference do not establish a government fact. Never invent a source title, URL, document number, quotation, issuing authority, or publication date.",
    "Preserve useful sourced detail, but remove or mark every unsupported policy, number, date, organization, action, achievement, and attributed statement as 【待核验】 or 【待补充】.",
    "Remove unsupported specificity when it is not essential. If it must remain, mark it inline with \u3010\u5f85\u6838\u9a8c\u3011 and include it in verificationNeeded.",
    "styleReview and factReview must briefly state what was actually checked; do not claim external verification without sources.",
    "Do not include Markdown fences, workflow commentary, or a word-count claim inside finalDraft.",
    "",
    `User request: ${userRequest}`,
    "",
    `Draft to finalize: ${draft}`
  ].join("\n");
}

export function parseGovernmentWritingFinalization(content: string): GovernmentWritingFinalization {
  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) throw new Error("Government writing finalizer did not return JSON.");
  const parsed = JSON.parse(jsonText) as Partial<GovernmentWritingFinalization>;
  const finalDraft = String(parsed.finalDraft ?? "").trim();
  const styleReview = String(parsed.styleReview ?? "").trim();
  const factReview = String(parsed.factReview ?? "").trim();
  const verificationNeeded = Array.isArray(parsed.verificationNeeded)
    ? parsed.verificationNeeded.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    : [];
  const substantiveLength = (value: string) => value.replace(/[\s.…。，、；：！？,.!?;:'"`~*_#|\-—–()[\]{}<>《》【】]/g, "").length;
  if (substantiveLength(finalDraft) < 80 || substantiveLength(styleReview) < 6 || substantiveLength(factReview) < 6) {
    throw new Error("Government writing finalizer requires a draft, style review, and fact review.");
  }
  if (/(?:the user\s+(?:is asking|wants|requested)|let me\b|i need to\b|i should\b|i'm executing|现在需要调用|让我(?:先|来|生成)|我需要(?:先|调用|生成))/i.test(finalDraft)) {
    throw new Error("Government writing finalDraft contains private planning narration.");
  }
  if (UNSUPPORTED_IMPLEMENTATION_PATTERN.test(finalDraft)) {
    throw new Error("Government writing finalDraft contains unsupported dates, organizations, or implementation facts.");
  }
  return { finalDraft, styleReview, factReview, verificationNeeded };
}
