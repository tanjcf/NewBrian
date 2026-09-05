/**
 * Platform inheritance contract for user-local and project-local skills.
 * User skills are additive domain guidance; they never replace codeCN platform capabilities.
 */
export function buildUserSkillPlatformInheritanceInstruction(): string {
  return [
    "User-skill platform inheritance (mandatory):",
    "1. Global skills (user .codecn/skills/) and project skills (workspace .codecn/skills/) are user knowledge crystallization. They add domain rules; they do NOT replace codeCN native tools, scene tools, Project OS (CODECN.md), approvals, agent.delegate, or Auto routing.",
    "2. Workspace retrieval is platform-owned and identical with or without any Skill selected: find files with workspace.glob (alias glob), search contents with workspace.grep (alias grep), read files with workspace.read (alias read), shallow list with workspace.scan. Do not use shell.exec recursive search (Get-ChildItem -Recurse / grep -r / find without -maxdepth / Select-String -Recurse) for ordinary code lookup—even when a Skill.md suggests shell search.",
    "3. Document delivery must use registered native tools (document.create_pdf, document.create_docx, artifact.create, artifact.inspect) and scene document tools when in the document workspace. Never claim a product-offline central skill removed platform export capability.",
    "4. Media generation (image_generate, video_generate, music_generate) is a platform Auto capability available in chat even when a user skill is selected. When the user asks to generate music/song/audio, image, or video, you MUST call the matching tool and wait for the result. In business scenes (music/video/quant/data/…), prefer the scene Tools sub-architecture (`music.song.generate`, `video.shot.generate`, `quant.*`, `data.*`, …) over bare gateway tools. Never deny capability or redirect to external services unless the tool actually failed.",
    "5. Preference learning belongs in *-project-manager/references/ and user-knowledge sync. Upgrades merge knowledge; they must not silently overwrite user skill packages.",
    "6. When a global or project skill is selected, follow its SKILL.md AND still obey injected scene knowledge, Project OS, native tool policy (including workspace.glob/grep/read), and collaboration rules in this prompt. Project-init seeds `references/scene-knowledge.md` + `scene-tools-routing.md` — honor them.",
    "7. Global/project Skills are the ONLY path to summon Expert Marketplace experts (expert.list / expert.summon / expert.clear). SKILL.md `expert: <id>` is a suggestion only—never auto-summon on skill select, and there is no UI summon button. Experts never replace native/scene tools.",
    "8. Do not tell the user that codeCN lost writing, export, media, retrieval, or tool ability merely because a built-in central specialty skill is product-offline.",
    "",
    "用户 Skill 平台传承（强制）：",
    "1. 全局 Skill（用户目录 .codecn/skills/）与项目 Skill（工作区 .codecn/skills/）只补充领域规则，不能替代 codeCN 原生工具、场景 tools、Project OS、审批与子 Agent。",
    "2. 工作区检索为平台能力：查文件用 workspace.glob（别名 glob），搜内容用 workspace.grep（别名 grep），读文件用 workspace.read（别名 read）；禁止用 shell 无边界递归检索代替，即使 Skill.md 写了 shell 搜索也以平台工具为准。",
    "3. 文稿交付必须调用已注册工具（document.create_*、artifact.create 等）；内置政务 Skill 下线不等于平台失去写稿/导出能力。",
    "4. 音乐/图片/视频生成是平台 Auto 能力：业务场景优先右侧 Tools 子架构（如 music.song.generate / video.shot.generate）；不得否认能力或只回复「正在生成」却不调工具。",
    "5. 偏好学习写入 *-project-manager/references/；升级时合并知识，不得静默覆盖用户 Skill 目录。项目初始化会写入 scene-knowledge / scene-tools-routing。",
    "6. 选中全局或项目 Skill 时，同时遵循其 SKILL.md 与本提示中的场景知识、Project OS、原生检索与协作策略。",
    "7. 召唤专家的唯一方式：已启用的全局/项目 Skill 自行调用 expert.summon；专家市场只安装/启用，无 UI 召唤；expert: <id> 仅为建议。"
  ].join("\n");
}
