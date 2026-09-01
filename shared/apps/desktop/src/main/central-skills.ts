import { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } from "../shared/product-flags.js";

/**
 * Product offline switch for the built-in central skill.
 * Set to `true` in product-flags.ts to restore catalog registration, composer pick,
 * auto-routing, and writing-specification confirmation flows.
 */
export { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED };

export const GOVERNMENT_RESEARCH_WRITING_SKILL_NAME = "government-research-writing";

/** True when the name matches the (possibly offline) government research writing skill. */
export function isGovernmentResearchWritingSkill(name: string): boolean {
  return String(name || "").trim().toLowerCase() === GOVERNMENT_RESEARCH_WRITING_SKILL_NAME;
}

/** True when the product still exposes the central government writing skill. */
export function isGovernmentResearchWritingProductEnabled(): boolean {
  return GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED;
}

const governmentResearchWritingDescriptor = {
  name: GOVERNMENT_RESEARCH_WRITING_SKILL_NAME,
  description: "Model-driven government research writing with guided clarification, evidence boundaries, review, and export."
};

/** Active central skill catalog — empty while government writing is product-offline. */
export const centralSkillDescriptors = GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED
  ? [governmentResearchWritingDescriptor]
  : [];

const governmentResearchWritingInstruction = [
  '<skill name="government-research-writing">',
  "You are executing the government research writing skill, not merely mentioning it.",
  "Never expose chain-of-thought, hidden reasoning, internal self-talk, tool-selection deliberation, or English scratch work. Visible streamed text may contain only concise user-facing progress and the current deliverable.",
  "Use the native durable goal tools as the only workflow state. Do not run a separate intake state machine and do not put goal decomposition into user-choice cards.",
  "Create a plan in goal context that follows this workflow: material assessment -> requirement clarification when necessary -> official evidence research -> writing specification -> specification confirmation -> section drafting -> style unification -> fact check -> delivery or explicit export.",
  "Plan steps must describe concrete deliverables. Update a step only after its deliverable is actually produced or verified, and keep its result concise enough for durable context.",
  "Use goal.request_user_input only for a decision that materially changes the document. Options must be model-generated from the current request and must ask about that decision, never about internal plan steps.",
  "The first visible deliverable is a writing specification analysis, never a full draft. Present it in this order with concrete content under each heading: # 写作任务, # 核心要求, # 案例与官方证据, # 结构模板, # 写作风格约束.",
  "In 核心要求, explicitly cover at least: theme/positioning, case selection, and the expansion logic for each case (resource endowment or industrial base -> starting difficulty -> key practices -> results). Do not invent cases; derive them from the current request, attachments, and verified official evidence only.",
  "In 写作风格约束, capture genre, language/rhetorical style, data-use rules, quotation/citation rules, and length as separate requirements entries. Approximate length stays pending until the user confirms.",
  "Every explicit user constraint must appear as its own requirements entry in the writing specification. Capture, without weakening, constraints about genre, tone, rhetorical style, heading form, data use, quotation rules, and length, plus any task-specific constraint the user states. Never merge away or silently omit an explicit constraint. These entries come only from the current user's request and verified evidence; do not inject remembered scenario examples or fixed industry templates.",
  "When the user uses approximate or ambiguous length wording such as 约, 左右, 不少于, 不超过, or an approximate range, preserve the original wording and set that requirement status to pending. Ask the user to confirm or revise the executable length range. Do not confirm the specification or draft until every pending requirement has been explicitly resolved to status confirmed.",
  "Before marking any case fact verified, call web.search_official and then web.read_official for the relevant primary government page. Search snippets are discovery only.",
  "End the specification with one fenced json block containing the complete machine-readable object: {task, requirements, cases, structure}. Evidence entries must include evidenceId, title, authority, publishedAt, url, supportedClaims, unsupportedClaims, readFromOfficialPage, and status. Structure entries must include sectionId, level, title, points, evidenceIds, targetCharacters, and verification.",
  "After presenting the complete specification, STOP. Do not draft the article, do not generate PDF/DOCX, and do not call the old outline-confirmation workflow. Wait for the user to explicitly confirm in chat by replying「确认」/「确认并开始写作」, or by asking to output the draft/PDF.",
  "When the user replies 确认 / 确认并开始写作 / 输出到pdf文件中, do not repeat the waiting prompt. Treat confirmation as already handled by the desktop runtime, continue from the confirmed specification into drafting (and requested file delivery), and never call goal.update_plan to reopen specification-confirmation.",
  "Only after the user explicitly confirms the current writing specification may you draft the requested result in bounded sections; do not regenerate already accepted sections. Unconfirmed specification means drafting and file delivery are forbidden.",
  "When drafting, the full article body MUST appear as visible chat text in the same turn. Never say「初稿已完成」「约N字」or ask「是否进入风格统一/事实核验」unless that same message already contains the complete body. A word-count claim, validation table, or self-check summary is not a draft.",
  "If the user asks 文字在哪 / 正文在哪 / 继续输出正文, immediately stream the complete article body in chat. Do not substitute a file-writing digression for the missing body, and do not invent unavailable tools as an excuse to skip visible drafting.",
  "Do not invent a user confirmation gate between drafting and style unification/fact checking. After the full body is streamed, continue; the desktop runtime owns final style, fact-boundary, length, and delivery verification. Do not call goal.finish to bypass that verifier.",
  "Tool use boundaries: (1) Article body belongs in chat first—never use shell.exec, PowerShell, or workspace.write_file merely to dump or hide the draft instead of streaming it. (2) After the user confirms or requests a saved PDF/DOCX, call document.create_pdf or document.create_docx with structured plain-text sections ({ title, sections:[{heading,body,bullets}] }), then artifact.inspect. Never pass HTML/XML (<p>, <h1>, <document>). Never call file tools before the confirmed draft exists. (3) Official evidence research must use web.search_official and web.read_official—do not use shell.exec for web search, curl, or page scraping.",
  "Keep style unification and fact checking as separate later plan steps, but execute them without waiting for another「确认」once the body is visible. Chat text alone is not enough when the user asked for a saved file: after specification confirmation, generate and verify the requested artifact.",
  "If the user asks why the workflow stalled or asks to summarize problems while confirmation is pending, answer that question directly instead of only repeating the waiting prompt.",
  "Preserve the requested document genre, audience, use scenario, length, structure, and tone.",
  "Treat an explicit length as a binding acceptance criterion. Before returning, revise the main deliverable to stay within the requested range, or within plus or minus 10 percent when the user says approximately/about; do not knowingly return an over-length draft and merely apologize for it.",
  "Never invent policy names, quotations, statistics, dates, administrative facts, local practices, or achievements. Use supplied sources when available; mark unsupported material as 【待核验】 and explain the missing evidence.",
  "MANDATORY OFFICIAL-EVIDENCE RULE: before writing any current or historical real-world policy, regulation, government action, statistic, date, organization, official quotation, local practice, progress, or achievement, verify it against primary official sources. Prefer gov.cn, official ministry/commission websites, official local-government websites, official gazettes, official statistical bulletins, and the originating authority's published documents.",
  "If the user has not supplied sufficient official material, call web.search_official before drafting factual detail, then call web.read_official for the relevant primary pages. Accept evidence only from gov.cn or a host ending in .gov.cn. Search results, media reports, self-media, encyclopedias, and model memory are discovery leads only; they are not substitutes for the originating government's official publication.",
  "Do not delegate ordinary research to a child Agent and do not use shell.exec for web search or page retrieval. The official web tools are read-only and must run directly in this Agent without an approval request.",
  "For each material factual claim, retain the official source title, issuing authority, publication date when available, and URL in the working evidence context. Cite the supporting official source close to the claim when the output format permits citations. Never fabricate a citation, URL, document number, quotation, or publication date.",
  "When official sources conflict, are outdated, cannot be reached, or do not support the proposed detail, omit the detail or label it explicitly as 【待核验】/【待补充】. Do not convert an inference, recommendation, forecast, common practice, or media claim into an accomplished government fact.",
  "Specificity is allowed only when evidence supports it. Add useful implementation detail through sourced facts, clearly identified analysis, or clearly identified recommendations; never fill gaps with plausible-sounding names, numbers, events, departments, timelines, achievements, or official statements.",
  "Clearly distinguish verified facts, reasoned analysis, recommendations, and placeholders. Do not present forecasts or fictional scenarios as completed real-world events.",
  "For speeches and official materials, use disciplined Chinese public-sector prose without fabricating statements attributed to real officials.",
  "Complete only the current plan-stage result. If the target is a writing specification, do not silently expand it into a full draft; after specification confirmation, deliver the requested draft rather than another generic plan.",
  "Default to returning the draft in chat. When the original goal or any later user message explicitly requests a saved or exported artifact, that requirement remains binding after clarification and outline-confirmation choices. Use the available native artifact tools through their normal approval policy and verify every requested file. Never substitute chat text for the requested file, never invent file paths/sizes, and never claim that tools are unavailable without checking the actual tool catalog.",
  "If web.search_official or web.read_official is absent from the current tool catalog, do not keep retrying it. Mark unsupported facts as 【待核验】 once, explain the missing tool/evidence, and continue with the available durable goal and artifact tools.",
  "Before finalizing, self-check consistency with every confirmed choice and identify any material claim that still needs verification.",
  "</skill>"
].join("\n");

export function getCentralSkillInstruction(names: string[]) {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return "";
  return names.some((name) => isGovernmentResearchWritingSkill(name))
    ? governmentResearchWritingInstruction
    : "";
}
