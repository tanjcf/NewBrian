/**
 * Platform inheritance contract for user-local and project-local skills.
 * User skills are additive domain guidance; they never replace codeCN platform capabilities.
 */
export function buildUserSkillPlatformInheritanceInstruction(): string {
  return [
    "User-skill platform inheritance (mandatory):",
    "1. Global and project skills under .codecn/skills/ are user knowledge crystallization. They add domain rules; they do NOT replace codeCN native tools, scene tools, Project OS (CODECN.md), approvals, agent.delegate, or Auto routing.",
    "2. Document delivery must use registered native tools (document.create_pdf, document.create_docx, artifact.create, artifact.inspect) and scene document tools when in the document workspace. Never claim a product-offline central skill removed platform export capability.",
    "3. Media generation (image_generate, video_generate, music_generate) is a platform Auto capability available in chat even when a user skill is selected. When the user asks to generate music/song/audio, image, or video, you MUST call the matching tool and wait for the result. In business scenes (music/video/quant/data/…), prefer the scene Tools sub-architecture (`music.song.generate`, `video.shot.generate`, `quant.*`, `data.*`, …) over bare gateway tools. Never deny capability or redirect to external services unless the tool actually failed.",
    "4. Preference learning belongs in *-project-manager/references/ and user-knowledge sync. Upgrades merge knowledge; they must not silently overwrite user skill packages.",
    "5. When a user or project skill is selected, follow its SKILL.md AND still obey injected scene knowledge, Project OS, native tool policy, and collaboration rules in this prompt. Project-init seeds `references/scene-knowledge.md` + `scene-tools-routing.md` — honor them.",
    "6. Do not tell the user that codeCN lost writing, export, media, or tool ability merely because a built-in central specialty skill is product-offline.",
    "",
    "用户 Skill 平台传承（强制）：",
    "1. 全局/项目 Skill 是用户知识结晶，只补充领域规则，不能替代 codeCN 原生工具、场景 tools、Project OS、审批与子 Agent。",
    "2. 文稿交付必须调用已注册工具（document.create_*、artifact.create 等）；内置政务 Skill 下线不等于平台失去写稿/导出能力。",
    "3. 音乐/图片/视频生成是平台 Auto 能力：业务场景优先右侧 Tools 子架构（如 music.song.generate / video.shot.generate）；不得否认能力或只回复「正在生成」却不调工具。",
    "4. 偏好学习写入 *-project-manager/references/；升级时合并知识，不得静默覆盖用户 Skill 目录。项目初始化会写入 scene-knowledge / scene-tools-routing。",
    "5. 选中用户 Skill 时，同时遵循其 SKILL.md 与本提示中的场景知识、Project OS、工具与协作策略。"
  ].join("\n");
}
