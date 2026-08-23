export type GameDesignSectionSchema = {
  fields: Array<{ key: string; label: string; rows?: number }>;
  prompts: string[];
};

export const gameDesignSectionSchemas: Record<string, GameDesignSectionSchema> = {
  world: {
    prompts: ["世界规则", "角色关系", "势力阵营", "剧情线"],
    fields: [
      { key: "worldRules", label: "世界规则" },
      { key: "characters", label: "角色关系", rows: 4 },
      { key: "factions", label: "势力阵营" },
      { key: "storylines", label: "剧情线", rows: 4 }
    ]
  },
  level: {
    prompts: ["关卡目标", "空间流程", "节奏设计", "敌人与奖励"],
    fields: [
      { key: "levelGoals", label: "关卡目标" },
      { key: "flow", label: "空间流程", rows: 4 },
      { key: "pacing", label: "节奏设计" },
      { key: "rewards", label: "敌人与奖励", rows: 3 }
    ]
  },
  combat: {
    prompts: ["玩家操作", "敌人机制", "数值目标", "验证标准"],
    fields: [
      { key: "playerActions", label: "玩家操作" },
      { key: "enemyMechanics", label: "敌人机制", rows: 4 },
      { key: "numbers", label: "数值目标" },
      { key: "validation", label: "验证标准" }
    ]
  }
};

export function emptyGameDesignFields(schema: GameDesignSectionSchema) {
  return Object.fromEntries(schema.fields.map((field) => [field.key, ""]));
}

export function parseGameDesignContent(content: string, schema: GameDesignSectionSchema) {
  const fallback = emptyGameDesignFields(schema);
  if (!content.trim()) return fallback;
  try {
    const parsed = JSON.parse(content) as Record<string, string>;
    return { ...fallback, ...parsed };
  } catch {
    const firstKey = schema.fields[0]?.key;
    if (firstKey) return { ...fallback, [firstKey]: content };
    return fallback;
  }
}

export function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] || trimmed).trim();
}
