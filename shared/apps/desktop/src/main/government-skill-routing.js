/**
 * Keyword heuristic for "looks like a government writing request".
 * Advisory only unless Settings personalization.autoSkillEnabled is ON and the
 * government-research-writing product skill is online
 * (`GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED` in central-skills).
 * When the product is offline or auto-skill is OFF, ModelChatGoalService /
 * selectModelChatSkills must NOT inject government-research-writing.
 */
export function shouldAutomaticallyUseGovernmentWriting(requestText) {
  const text = String(requestText ?? "").trim();
  if (!text) return false;
  const asksToWrite = /(?:写|撰写|起草|拟写|生成|输出|整理|完善|修改|润色|write|draft|generate|produce)/i.test(text);
  const governmentDeliverable = /(?:发言稿|讲话稿|致辞|工作总结|年终总结|年度总结|述职报告|汇报材料|调研报告|情况报告|工作报告|典型案例研究文章|典型案例文章|理论案例文章|实施方案|通知|请示|批复|纪要|公文)/i.test(text);
  return asksToWrite && governmentDeliverable;
}

export function isGovernmentRevisionPreviewRequest(requestText) {
  const text = String(requestText ?? "").trim();
  if (!text) return false;
  const asksForPreview = /(?:修改说明|调整说明|改写说明|先在对话中)/i.test(text);
  const forbidsArtifact = /(?:不要|暂不|先不|不立即).{0,16}(?:生成|输出|创建).{0,10}(?:文件|PDF|Word|DOCX)/i.test(text);
  return asksForPreview && forbidsArtifact;
}

export function isGovernmentConfirmedRevisionDeliveryRequest(requestText) {
  const text = String(requestText ?? "").trim();
  if (!text) return false;
  return /(?:确认修改|确认以上修改|按上述修改|按以上修改)/u.test(text)
    && /第二版/u.test(text)
    && /pdf/i.test(text)
    && /(?:docx|word)/i.test(text);
}
