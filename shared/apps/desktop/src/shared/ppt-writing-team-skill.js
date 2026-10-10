export const PPT_WRITING_TEAM_SKILL_NAME = "ppt-writing-team";
export const PPT_WRITING_TEAM_SKILL_LABEL = "PPT写作团队";
export const PPT_WRITING_TEAM_EXPERT_ID = "ppt-creation-expert";
export const PPT_WRITING_TEAM_SKILL_REVISION = "ppt-writing-team-1";

export const PPT_WRITING_TEAM_SKILL_SUMMARY =
  "PPT写作团队。按视觉、版式、可编辑幻灯片和复核完成商业演示，默认交付可编辑 PPTX。";

export const PPT_WRITING_TEAM_SKILL_MARKDOWN = `---
name: ${PPT_WRITING_TEAM_SKILL_NAME}
description: ${PPT_WRITING_TEAM_SKILL_SUMMARY}
expert: ${PPT_WRITING_TEAM_EXPERT_ID}
metadata:
  skill-revision: ${PPT_WRITING_TEAM_SKILL_REVISION}
---

# PPT写作团队

用户在 Brain 技能里选中本技能，就是要求使用演示文稿技能团队 \`ppt-creation-expert\`。不要再询问要不要召唤专家。

## 开工
1. 先调用 \`expert.summon\`，\`expertId\` 为 \`ppt-creation-expert\`。
2. 主理人只负责受众、故事线和逐页大纲，不替成员画页、选主题或导出文件。
3. 默认交付可编辑 PPTX。只有用户明确要求 HTML 翻页或把现有演示转成网页时，才改走网页成员。

## 默认链路
写出大纲后，按顺序 \`agent.delegate\` 并 \`agent.wait\`：

1. \`ppt-visual-designer\`：交出 theme id、字体、锚点色、墨色、底色。theme id 只能是 \`magazine\`、\`swiss\`、\`workplace\`。
2. \`ppt-layout-designer\`：沿用成片引擎版式，为每一页指定一个 layout。
3. \`ppt-native-producer\`：\`artifact.create\` 的 \`format\` 为 \`pptx\`，并传入同一个 \`theme.id\`。
4. \`ppt-deck-reviewer\`：对照大纲检查溢出、遮挡和几何。未通过则退回成片成员，通过后再交付文件。

用户明确要网页时，第 3 步改为 \`ppt-web-producer\`，\`format\` 为 \`html\`。复核仍然执行。

## 完成标准
交付说明写明文件位置、页数、故事线摘要和仍缺的素材。没有证据的数字和结论标为待确认，不补造。
`;
