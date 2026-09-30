import type { PersistedGoalSnapshot } from "./codex-storage.js";

export function shouldUseGoalRuntimeForSkills(explicitSkillNames: string[]) {
  return explicitSkillNames.length > 0;
}

export function buildSkillGoalRuntimeInstruction(
  explicitSkillNames: string[],
  snapshot: PersistedGoalSnapshot | null
) {
  if (!shouldUseGoalRuntimeForSkills(explicitSkillNames)) return "";
  return [
    `用户显式选择了以下 Skill（内部标识）：${explicitSkillNames.join(", ")}。`,
    "通过持久化目标运行时执行 Skill；Skill 是叠加在目标上的执行规则，不是一次性提示词模板。",
    snapshot?.goal.status === "active"
      ? "继续现有目标及其持久化计划，不得创建并行的 Skill 专用目标。"
      : "生成实质结果前，先创建一个具体目标和执行计划；步骤必须对应真实交付物与验证证据。",
    "计划步骤的标题、描述、结果和用户可见进度必须使用中文，并按顺序执行；只允许依据真实模型或工具结果更新。",
    "只有当用户决策会实质改变目标结果时才提问。目标拆解、内部分析和常规进度应保存在目标上下文中，不得塞入用户选择卡片。",
    "不得根据意图或虚构结果把步骤标记完成。只有请求的目标结果已真实产出并验证后才能结束目标。"
  ].join("\n");
}
