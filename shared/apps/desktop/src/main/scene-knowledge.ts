import type { BrainWorkspaceKey } from "@codex-forge/protocol";

type SceneSection = { title: string; keywords: string[]; content: string };

const scenes: Record<BrainWorkspaceKey, { title: string; sections: SceneSection[] }> = {
  explore: { title: "场景学习探索", sections: [
    { title: "通用 Brain", keywords: ["探索", "学习", "场景"], content: "这是原生 Brain 的无专用场景模式。对话、项目、线程、Skill、知识检索和工具调用均按通用能力工作；明确进入量化、游戏、视频等业务场景时，再切换到对应场景。" }
  ] },
  quant: { title: "量化交易", sections: [
    { title: "能力", keywords: ["行情", "股票", "K线", "量柱", "组合", "策略"], content: "查询真实行情、查看K线与成交量、组合持仓、策略回测和风险分析。默认不连接真实券商，不执行真实下单。" },
    { title: "工具接口", keywords: ["quant.market.query", "quant.portfolio.create", "quant.portfolio.delete", "quant.radar.create", "quant.note.add", "bars", "行情", "组合", "雷达", "笔记"], content: "quant.market.query：查询股票/指数行情。quant.portfolio.create：用户要求创建组合或组合 Skill 时必须调用，必须传 skillId、title、symbol、strategyId；工具会原子创建当前项目 .codecn/skills Skill 包、独立模拟账本和右侧同名组合卡片，只生成文字不算完成。quant.strategy.run：用同一个 skillId 承载成交，用 strategyId 选择 trend-following 或 mean-reversion，运行后同步同一张右侧组合卡片。quant.portfolio.delete：同时删除该工具管理的 Skill 包、组合账本和右侧卡片。quant.radar.create：创建交易日自动执行计划，并立即基于最近 12 个月真实行情模拟一次，同步右侧雷达和组合。quant.note.add：用户要求总结并添加研究笔记时必须调用，把总结真实写入右侧研究笔记；只回复文字不算完成。行情参数包括 symbol、startDate、endDate、interval、adjustment。必须使用工具返回的数据，不编造实时价格。" }
  ] },
  game: { title: "游戏制作", sections: [
    { title: "能力", keywords: ["关卡", "角色", "世界观", "战斗", "资产", "测试"], content: "管理关卡、角色与世界观、战斗设计、资产和试玩测试。先读取项目状态，再通过右侧工具保存可追踪的设计结果。" },
    { title: "工具接口", keywords: ["level", "actor", "preview", "cook"], content: "使用关卡编辑、内容树、Actor、试玩和导出工具操作右侧面板；写入前遵循项目权限和审批，工具失败要如实反馈。" }
  ] },
  video: { title: "视频制作", sections: [
    { title: "能力", keywords: ["脚本", "分镜", "镜头", "音轨", "字幕", "合成", "导出"], content: "编写脚本、管理分镜、生成单镜、编辑本镜音视频轨、导入字幕、合成和导出。每次修改应绑定当前项目。" },
    { title: "工具接口", keywords: ["storyboard", "shot", "timeline", "render", "export"], content: "通过视频流水线、时间线、字幕、渲染和导出工具操作右侧 tools；生成类操作必须返回任务状态和产物路径，不能只说正在生成。" }
  ] },
  music: { title: "音乐创作", sections: [
    { title: "能力", keywords: ["生成", "音轨", "切片", "编曲", "导出"], content: "创建音乐片段、编辑音轨、标记切片、编排时间线和导出音频。所有音轨操作使用当前项目和时间线。" },
    { title: "工具接口", keywords: ["daw", "track", "clip", "render"], content: "使用音乐 DAW、时间线、音轨、片段和渲染工具；保存后再刷新右侧面板，向用户报告实际状态。" }
  ] },
  data: { title: "数据与决策", sections: [
    { title: "能力", keywords: ["数据", "CSV", "Excel", "分析", "图表", "Julius", "Flow"], content: "导入CSV/Excel、浏览数据集、生成摘要分析、绘制图表和运行决策 Flow。分析结论必须引用实际数据集和筛选条件。" },
    { title: "工具接口", keywords: ["dataset", "import", "summarize", "flow"], content: "通过数据集导入、行读取、分析摘要、图表和 Flow 工具操作右侧 tools；大数据操作要说明范围、耗时和失败原因。" }
  ] },
  software: { title: "软件与自动化", sections: [
    { title: "能力", keywords: ["终端", "代码", "测试", "部署", "Flow", "文件"], content: "查看项目文件、运行受控终端、编辑代码、执行测试、部署和自动化 Flow。涉及外部副作用时遵循审批和工作区边界。" },
    { title: "工具接口", keywords: ["terminal", "shell", "test", "deploy", "flow"], content: "使用右侧终端、脚本、测试、部署和 Flow 工具；命令必须限制在当前工作区，先展示风险，执行后返回退出码和摘要。" }
  ] },
  document: { title: "文档创作", sections: [
    { title: "能力", keywords: ["文稿", "审校", "项目", "文件", "政务", "写作"], content: "创建和编辑文稿、审校批注、管理项目文件、生成政务写作规格和导出文档。保持当前线程上下文，避免混入其他项目对话。" },
    { title: "工具接口", keywords: ["document", "review", "export", "annotation"], content: "通过文档工作台、批注、审校、变更集和导出工具操作右侧 tools；文件变更先预览，用户确认后再导出。" }
  ] }
};

export function searchSceneKnowledge(scene: BrainWorkspaceKey, query: string, limit = 4): string {
  const entry = scenes[scene];
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
  const ranked = entry.sections.map((section) => ({ section, score: section.keywords.reduce((n, key) => n + (tokens.some((token) => key.toLowerCase().includes(token) || token.includes(key.toLowerCase())) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score);
  return [
    `当前场景：${entry.title}`,
    "以下是本场景知识检索结果。它描述右侧 tools 的能力和调用方式；真实结果必须来自工具，不得凭空声称已执行。",
    ...ranked.slice(0, Math.max(1, limit)).map(({ section }) => `## ${section.title}\n${section.content}`)
  ].join("\n\n");
}
