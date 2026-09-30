/**
 * Scene knowledge + Tools sub-architecture seed for project skills.
 * Embedded baseline (mirrors docs/scene-knowledge/*.md) so agentd does not
 * depend on the BRAIN docs tree at runtime.
 */

import path from "node:path";
import fs from "node:fs/promises";

export const SCENE_TOOLS_TEMPLATE_MARKER = "Scene Tools sub-architecture (mandatory)";
export const PROJECT_INIT_SKILL_NAME = "project-init";
export const SCENE_KNOWLEDGE_FILENAME = "scene-knowledge.md";
export const SCENE_TOOLS_ROUTING_FILENAME = "scene-tools-routing.md";

/** @typedef {"explore"|"quant"|"game"|"video"|"music"|"data"|"software"|"document"} BrainWorkspaceKey */

export const SCENE_TITLES = {
  explore: "场景学习探索",
  quant: "量化交易",
  game: "游戏制作",
  video: "视频制作",
  music: "音乐创作",
  data: "数据与决策",
  software: "软件与自动化",
  document: "文档创作"
};

/** Built-in scene knowledge baseline (product contract for right-side Tools). */
export const SCENE_KNOWLEDGE_MARKDOWN = {
  explore: `# 场景学习探索

这是 NewBrain 原生工作台模式。右侧不挂业务场景专属 Tools，只保留项目资源：文件、产物、任务。

对话、项目、线程、Skill、知识检索和通用工具按原生能力工作。工作区检索请用 \`workspace.glob\` / \`workspace.grep\` / \`workspace.read\`（别名 \`glob\` / \`grep\` / \`read\`），不要用 shell 无边界递归检索。进入量化、游戏、视频、音乐等业务场景时，必须切换到对应场景并使用其右侧专属 Tools 子架构。
`,
  quant: `# 量化交易场景

能力：行情、K线/量柱、组合、策略、回测与风险分析。

**右侧 Tools 子架构（必走）：** 行情 / 组合 / 策略 / 雷达 / 研究笔记。

工具：\`quant.market.query\` 查询 OHLCV；\`quant.portfolio.create\` 创建 Skill 模拟组合并同步右侧组合面板；\`quant.strategy.run\` 运行策略并同步组合结果；\`quant.radar.create\` / \`quant.note.add\` 同步雷达与研究笔记。用户要求创建组合时，只生成 Skill 文档不算完成，必须调用组合工具。

约束：默认模拟交易，不连接真实券商；不得编造价格；真正行情和组合结果必须由右侧 tools 写入并刷新。
`,
  game: `# 游戏制作场景

能力：关卡、角色、世界观、战斗、资产与试玩测试。

**右侧 Tools 子架构（必走）：** 关卡 / 项目与文件 / 游戏策划 / 角色与世界观 / 战斗设计 / 资产与测试。

先读取项目状态，再通过右侧编辑器、内容树、试玩与 cook 工具保存结果。写入当前项目；工具失败必须返回真实错误；生成设计文档不等于关卡已修改。
`,
  video: `# 视频制作场景

能力：脚本、分镜、单镜生成、音视频轨、字幕、合成与导出。

**右侧 Tools 子架构（必走）：** 脚本 / 分镜 / 单镜生成 / 本镜音视频轨（\`VideoPipelineShell\`）。

对话必须调用场景 Agent 工具：\`video.project.inspect\`、\`video.pipeline.save\`、\`video.shot.generate\`、\`video.timeline.*\`、\`video.audio.*\`、\`video.render.*\`。裸 \`video_generate\` 仅作非视频场景 Auto 兜底；本场景优先 \`video.*\`，返回任务状态与实际产物路径。
`,
  music: `# 音乐创作场景

能力：生成整曲/片段、音轨、切片、编曲和导出。

**右侧 Tools 子架构（必走）：** 工作台「音乐创作」右侧 Tools 页签为 **生成 / 音轨 / 标记切片 / 导出**（\`MusicDawShell\`）。「生成」页含 Title / Lyrics / Style 与 **✦ 生成整曲**。

对话必须调用：\`music.daw.save\`（歌词/风格/曲名）、\`music.song.generate\`（整曲生成并写入 DAW）、\`music.project.inspect\`、\`music.render.*\`。\`music.song.generate\` 内部调用 spring-app \`music_generate\` 并落盘到 \`media/stems/\`；裸 \`music_generate\` 不在本场景替代右侧 Tools。
`,
  data: `# 数据与决策场景

能力：CSV/Excel 导入、数据集、摘要分析、图表和决策 Flow。

**右侧 Tools 子架构（必走）：** Julius / 数据导入 / 数据表格 / 数据清洗 / 图表 / 决策 Flow。

必须使用 \`data.file.import_local\`、\`data.analysis.summarize\` / \`aggregate\`、\`data.analysis.save\` / \`cook\` 等场景工具；禁止用 shell 手写分析脚本绕过 \`data.*\`。分析必须说明数据集、筛选条件和实际工具结果。
`,
  software: `# 软件与自动化场景

能力：项目文件、受控终端、代码、测试、部署和 Flow。

**右侧 Tools 子架构（必走）：** 终端 / 代码 / 测试 / 部署 / Flow / 项目文件。

命令限制在当前工作区，涉及外部副作用遵循审批；返回退出码和变更摘要。代码定位与阅读优先 \`workspace.glob\` / \`workspace.grep\` / \`workspace.read\`；不要用未审批的裸 shell 递归检索替代右侧终端与 Flow 工具。
`,
  document: `# 文档创作场景

能力：文稿、审校、批注、变更集与导出。

**右侧 Tools 子架构（必走）：** 文稿 / 审校 / 项目与文件。

通过文档工作台、批注、审校、变更集和导出工具操作右侧 Tools；文件变更先预览，用户确认后再导出。Skill 生成的说明不等于右侧文档已修改。
`
};

export function normalizeSceneKey(value) {
  const key = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(SCENE_KNOWLEDGE_MARKDOWN, key) ? key : "explore";
}

export function buildSceneToolsRoutingMarkdown(workspaceKey) {
  const key = normalizeSceneKey(workspaceKey);
  const title = SCENE_TITLES[key] || key;
  if (key === "explore") {
    return `# ${SCENE_TOOLS_TEMPLATE_MARKER}

当前场景：${title}（例外）。

本场景**没有**业务右侧 Tools 子架构。可用通用对话、文件/产物/任务与平台 Auto 工具（含 image_generate / video_generate / music_generate 兜底）。
工作区检索统一使用平台原生工具：\`workspace.glob\` / \`workspace.grep\` / \`workspace.read\`（别名 \`glob\` / \`grep\` / \`read\`）；全局/项目 Skill 只补充规则，不能改用 shell 递归检索。
进入业务场景后，必须改用该场景的 Tools 子架构，不得继续用探索态裸网关调用代替。
`;
  }
  const toolHint = {
    quant: "`quant.market.query` / `quant.portfolio.*` / `quant.strategy.run` / `quant.radar.create` / `quant.note.add`",
    game: "关卡/策划/试玩/cook 等右侧游戏 Tools",
    video: "`video.pipeline.save` / `video.shot.generate` / `video.timeline.*` / `video.render.*`",
    music: "`music.daw.save` / `music.song.generate` / `music.project.inspect` / `music.render.*`",
    data: "`data.file.import_local` / `data.analysis.*` / `data.dataset.*`",
    software: "右侧终端 / 代码 / 测试 / 部署 / Flow",
    document: "文档工作台 / 审校 / 导出 / document.create_*"
  }[key] || "本场景已注册的右侧 Tools";

  return `# ${SCENE_TOOLS_TEMPLATE_MARKER}

当前场景：${title}

## 强制规则

1. 除「场景学习探索」外，所有业务场景的 AI 交付必须走**右侧 Tools 子架构**（与视频流水线同级），不得只用聊天散文或裸网关工具绕过面板。
2. 本场景优先工具：${toolHint}
3. 先 inspect / 读取右侧状态，再写入；写入后提醒用户查看右侧对应页签。
4. 用户 Skill（全局与项目）与 project-manager 只补充领域规则，不能替代场景 Tools、审批、Project OS，也不能改用 shell 递归检索代替 \`workspace.glob\` / \`workspace.grep\` / \`workspace.read\`。
5. public-skill-creator 创建的领域 Skill 同样必须遵守本场景 Tools 路由与平台原生检索工具。
`;
}

export function buildProjectInitSkillMarkdown(projectName, workspaceKey) {
  const key = normalizeSceneKey(workspaceKey);
  const title = SCENE_TITLES[key] || key;
  return `---
name: ${PROJECT_INIT_SKILL_NAME}
description: 项目初始化。在创建或打开 BRAIN 场景项目时，把当前场景规则/知识文档与 Tools 子架构路由写入项目 Skill 包，供 AI 强制走右侧 Tools。
metadata:
  short-description: 初始化场景知识与 Tools 路由
---

# 项目初始化（project-init）

用于项目 **${projectName}** · 场景 **${title}**（\`workspaceKey=${key}\`）。

## 何时使用

- 新建场景项目、打开尚未初始化的项目、或用户要求「初始化项目 / 同步场景知识」时。
- 不要在探索场景伪造业务 Tools；探索场景只初始化通用说明。

## 必须写入的内容

1. \`.newbrain/skills/<project>-project-manager/references/${SCENE_KNOWLEDGE_FILENAME}\` — 当前场景规则知识文档基线。
2. \`.newbrain/skills/<project>-project-manager/references/${SCENE_TOOLS_ROUTING_FILENAME}\` — Tools 子架构强制路由。
3. 确保 always-on \`*-project-manager\` Skill 含「${SCENE_TOOLS_TEMPLATE_MARKER}」段落。
4. 本 Skill 包（\`project-init\`）自身保持可发现，便于用户显式调用。

## 执行后

告知用户：场景知识已进入项目 Skill；之后在本场景提问时，AI 应操作右侧 Tools（例如音乐「生成/音轨/标记切片/导出」），并刷新面板。
`;
}

async function writeIfMissingOrStale(filePath, content, marker) {
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.trim() && marker && existing.includes(marker) && existing.length >= Math.min(80, content.length / 2)) {
    // Refresh baseline when product marker present but content drifted short — still rewrite knowledge baseline.
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return { path: filePath, written: true };
}

/**
 * Seed scene knowledge + Tools routing into project-manager references,
 * and ensure the project-init skill pack exists.
 */
export async function ensureSceneProjectInit(input = {}) {
  const workspacePath = path.resolve(input.workspacePath || ".");
  const projectName = String(input.projectName || path.basename(workspacePath) || "project").trim() || "project";
  const workspaceKey = normalizeSceneKey(input.brainWorkspaceKey);
  const safeProject = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";

  const pmName = `${safeProject}-project-manager`;
  const pmReferences = path.join(workspacePath, ".newbrain", "skills", pmName, "references");
  const initSkillDir = path.join(workspacePath, ".newbrain", "skills", PROJECT_INIT_SKILL_NAME);

  await fs.mkdir(pmReferences, { recursive: true });
  await fs.mkdir(initSkillDir, { recursive: true });

  const knowledge = SCENE_KNOWLEDGE_MARKDOWN[workspaceKey] || SCENE_KNOWLEDGE_MARKDOWN.explore;
  const routing = buildSceneToolsRoutingMarkdown(workspaceKey);
  const knowledgePath = path.join(pmReferences, SCENE_KNOWLEDGE_FILENAME);
  const routingPath = path.join(pmReferences, SCENE_TOOLS_ROUTING_FILENAME);
  const initSkillPath = path.join(initSkillDir, "SKILL.md");

  await writeIfMissingOrStale(knowledgePath, knowledge, "#");
  await writeIfMissingOrStale(routingPath, routing, SCENE_TOOLS_TEMPLATE_MARKER);
  await writeIfMissingOrStale(
    initSkillPath,
    buildProjectInitSkillMarkdown(projectName, workspaceKey),
    "项目初始化"
  );

  // Also keep a copy under Docs/BRAIN for human browsing (non-destructive overwrite of scene baseline only).
  const docsBrain = path.join(workspacePath, "Docs", "BRAIN");
  await fs.mkdir(docsBrain, { recursive: true });
  await fs.writeFile(path.join(docsBrain, `scene-knowledge-${workspaceKey}.md`), knowledge, "utf8");
  await fs.writeFile(path.join(docsBrain, "scene-tools-routing.md"), routing, "utf8");

  return {
    workspaceKey,
    projectName,
    skillName: PROJECT_INIT_SKILL_NAME,
    skillPath: initSkillDir,
    knowledgePath,
    routingPath,
    docsPaths: [
      path.join(docsBrain, `scene-knowledge-${workspaceKey}.md`),
      path.join(docsBrain, "scene-tools-routing.md")
    ]
  };
}
