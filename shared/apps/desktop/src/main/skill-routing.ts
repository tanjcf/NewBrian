import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRoutingRole } from "@codex-forge/protocol";
import { isGovernmentResearchWritingSkill } from "./central-skills.ts";

export type SkillRoutingScope = "central" | "user" | "project";
export type SkillRoutingTaskClass = "chat" | "code" | "gov_write" | "research" | "general";
export type SkillRoutingTier = 1 | 2 | 3;

export type SkillRoutingHint = {
  skillName: string;
  scope: SkillRoutingScope;
  roles?: ModelRoutingRole[];
  min_tier?: SkillRoutingTier;
  capabilities?: string[];
  task_class?: SkillRoutingTaskClass;
};

export type RoutingConstraint = {
  roles: ModelRoutingRole[];
  min_tier: SkillRoutingTier;
  capabilities: string[];
  task_class?: SkillRoutingTaskClass;
  skill_scopes_applied: SkillRoutingScope[];
  summary: string;
};

const SCOPE_RANK: Record<SkillRoutingScope, number> = {
  central: 1,
  user: 2,
  project: 3
};

const ROLE_SET = new Set<string>([
  "chat",
  "code",
  "gov",
  "research",
  "vision",
  "review"
]);

const TASK_SET = new Set<string>([
  "chat",
  "code",
  "gov_write",
  "research",
  "general"
]);

function asRole(value: unknown): ModelRoutingRole | undefined {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_SET.has(role) ? (role as ModelRoutingRole) : undefined;
}

function asTask(value: unknown): SkillRoutingTaskClass | undefined {
  const task = String(value || "").trim().toLowerCase();
  return TASK_SET.has(task) ? (task as SkillRoutingTaskClass) : undefined;
}

function asTier(value: unknown): SkillRoutingTier | undefined {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

export function parseSkillRoutingJson(
  raw: unknown,
  skillName: string,
  scope: SkillRoutingScope
): SkillRoutingHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schema_version != null && Number(record.schema_version) !== 1) return undefined;
  const roles = (Array.isArray(record.roles) ? record.roles : [])
    .map(asRole)
    .filter((role): role is ModelRoutingRole => Boolean(role));
  const capabilities = (Array.isArray(record.capabilities) ? record.capabilities : [])
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean);
  const minTier = asTier(record.min_tier);
  const taskClass = asTask(record.task_class);
  if (!roles.length && !capabilities.length && minTier == null && !taskClass) return undefined;
  return {
    skillName,
    scope,
    ...(roles.length ? { roles } : {}),
    ...(minTier != null ? { min_tier: minTier } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(taskClass ? { task_class: taskClass } : {})
  };
}

export function inferSkillRoutingHint(
  skillName: string,
  scope: SkillRoutingScope = "user"
): SkillRoutingHint | undefined {
  const name = String(skillName || "").trim();
  if (!name) return undefined;
  const lower = name.toLowerCase();
  if (
    isGovernmentResearchWritingSkill(name)
    || lower.includes("government")
    || lower.includes("research-writing")
  ) {
    return {
      skillName: name,
      scope,
      roles: ["gov", "research"],
      min_tier: 2,
      capabilities: ["tools"],
      task_class: "gov_write"
    };
  }
  if (/vision|multimodal|vl\b|识图|多模态/i.test(lower)) {
    return {
      skillName: name,
      scope,
      capabilities: ["vision"],
      roles: ["vision"]
    };
  }
  return {
    skillName: name,
    scope
  };
}

export async function readSkillRoutingHintFromDir(input: {
  skillDir: string;
  skillName: string;
  scope: SkillRoutingScope;
}): Promise<SkillRoutingHint | undefined> {
  const path = join(input.skillDir, "routing.json");
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return (
      parseSkillRoutingJson(parsed, input.skillName, input.scope)
      ?? inferSkillRoutingHint(input.skillName, input.scope)
    );
  } catch {
    return inferSkillRoutingHint(input.skillName, input.scope);
  }
}

export function mergeSkillRoutingHints(hints: SkillRoutingHint[]): RoutingConstraint {
  const ordered = [...hints].sort(
    (left, right) => SCOPE_RANK[left.scope] - SCOPE_RANK[right.scope]
  );
  const roles = new Set<ModelRoutingRole>();
  const capabilities = new Set<string>();
  let minTier: SkillRoutingTier = 1;
  let taskClass: SkillRoutingTaskClass | undefined;
  const scopes = new Set<SkillRoutingScope>();
  for (const hint of ordered) {
    scopes.add(hint.scope);
    for (const role of hint.roles ?? []) roles.add(role);
    for (const cap of hint.capabilities ?? []) capabilities.add(cap.toLowerCase());
    if (hint.min_tier != null && hint.min_tier > minTier) minTier = hint.min_tier;
    if (hint.task_class) taskClass = hint.task_class;
  }
  const roleList = [...roles];
  const capList = [...capabilities];
  const scopeList = [...scopes].sort((a, b) => SCOPE_RANK[a] - SCOPE_RANK[b]);
  const parts = [
    minTier > 1 ? `min_tier>=${minTier}` : "",
    roleList.length ? `roles=${roleList.join(",")}` : "",
    capList.length ? `caps=${capList.join(",")}` : "",
    taskClass ? `task=${taskClass}` : ""
  ].filter(Boolean);
  return {
    roles: roleList,
    min_tier: minTier,
    capabilities: capList,
    ...(taskClass ? { task_class: taskClass } : {}),
    skill_scopes_applied: scopeList,
    summary: parts.join("; ") || "none"
  };
}

export function buildSkillRoutingHints(input: {
  selectedSkillNames?: string[];
  explicitHints?: SkillRoutingHint[];
  skillScopes?: Partial<Record<string, SkillRoutingScope>>;
}): SkillRoutingHint[] {
  const byName = new Map<string, SkillRoutingHint>();
  for (const hint of input.explicitHints ?? []) {
    byName.set(hint.skillName.toLowerCase(), hint);
  }
  for (const name of input.selectedSkillNames ?? []) {
    const key = String(name || "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (byName.has(lower)) continue;
    const scope =
      input.skillScopes?.[key]
      ?? input.skillScopes?.[lower]
      ?? (isGovernmentResearchWritingSkill(key) ? "central" : "user");
    const inferred = inferSkillRoutingHint(key, scope);
    if (inferred) byName.set(lower, inferred);
  }
  return [...byName.values()];
}
