/** True when text claims the draft/delivery is done but is only process meta, not the article. */
export function isGovernmentDraftClaimWithoutBody(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return true;
  const compact = normalized.replace(/\s+/g, "");
  const claim = /(?:报道已完成交付|最终定稿已交付|最终成果摘要|成果摘要|执行摘要|初稿已完成|正文(?:已)?(?:完成|生成|交付|呈现)|完整正文已在(?:上方|聊天|对话)|全文已在(?:上面|上方|聊天|对话)|已完成全部\s*\d+\s*个步骤|风格统一与事实|请确认以下事项|是否进入(?:风格统一|事实核验|终审)|Continue with the current deliverable|do not call goal\.finish|Government writing completion is controlled|Government writing completion is owned|验证项\s*[|｜]\s*标准|篇幅验证|风格验证|事实边界验证)/i.test(normalized);
  const hasArticleShape = /(?:^|\n)#+\s+\S|(?:^|\n)[一二三四五六七八九十]+[、.．]|(?:^|\n)\d+[、.．]|同志们|各位领导|案例[一二三四五六七八九十\d]|【待核验】/m.test(normalized);
  // Only treat explicit completion/meta claims as missing bodies. Short progress
  // notes like「开始起草」must remain eligible for a follow-up drafting turn.
  if (claim && !hasArticleShape) return true;
  if (claim && compact.length < 800) return true;
  return false;
}

/** True when assistant text looks like a real government-writing article body. */
export function hasSubstantiveGovernmentDraftBody(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized || isGovernmentDraftClaimWithoutBody(normalized)) return false;
  return normalized.replace(/\s+/g, "").length >= 220;
}

/** Instruction injected when the runtime forces visible article drafting. */
export function governmentDraftBodyInstruction() {
  return [
    "You are drafting the government-writing article body now.",
    "Stream the COMPLETE Chinese article body in this turn as visible assistant content.",
    "Never claim the draft is complete, pause for style/fact confirmation, or summarize verification unless the full body already appears in the same message.",
    "Do not invent a user-confirmation gate between drafting and style unification or fact checking; the desktop runtime runs those natively after the body is delivered.",
    "Do not output English self-talk, internal scratch work, goal.finish commentary, or checklist/validation tables in place of the article.",
    "Output only the article body, preserving structure and 【待核验】 markers as needed."
  ].join(" ");
}
