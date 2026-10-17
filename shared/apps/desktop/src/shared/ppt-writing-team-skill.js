export const PPT_WRITING_TEAM_SKILL_NAME = "ppt-writing-team";
export const PPT_WRITING_TEAM_SKILL_LABEL = "PPT写作团队";
export const PPT_WRITING_TEAM_EXPERT_ID = "ppt-creation-expert";
export const PPT_WRITING_TEAM_SKILL_REVISION = "ppt-writing-team-4";

export const PPT_WRITING_TEAM_SKILL_SUMMARY =
  "PPT写作团队。目录内封着 ppt-master、frontend-slides、dashi-ppt、guizang-ppt-skill、planners-ppt-hell 的原始 SKILL.md 和代码。";

export const PPT_WRITING_TEAM_PACKS = [
  "ppt-master",
  "frontend-slides",
  "dashi-ppt",
  "guizang-ppt-skill",
  "planners-ppt-hell"
];

export function buildPptWritingTeamSkillMarkdown(packSources) {
  const sections = PPT_WRITING_TEAM_PACKS.map((name) => {
    const source = String(packSources?.[name] || "").trim();
    return [
      `# ${name}`,
      `执行下面这份原文时，SKILL_DIR 是本技能目录下的 \`${name}/\`。该目录里的 scripts、templates、references、assets、workflows 和 LICENSE 是这份技能的代码和素材，路径按原文解析，不要改写。`,
      source
    ].join("\n\n");
  }).filter((section) => !section.endsWith("\n\n"));
  return `---
name: ${PPT_WRITING_TEAM_SKILL_NAME}
description: ${PPT_WRITING_TEAM_SKILL_SUMMARY}
expert: ${PPT_WRITING_TEAM_EXPERT_ID}
metadata:
  skill-revision: ${PPT_WRITING_TEAM_SKILL_REVISION}
---

# PPT写作团队

下面五段是封进本技能的原始技能全文。同一请求只执行其中一段，并使用该段对应目录里的代码。用户没有指明网页、杂志风、瑞士风、主题编号或视频画面时，执行 ppt-master。Windows 上没有 python3 时，用 python 运行同一条命令。

旧安装程序识别标记：ppt-writing-team-1

${sections.join("\n\n")}
`;
}

export const PPT_WRITING_TEAM_SKILL_MARKDOWN = buildPptWritingTeamSkillMarkdown({});
