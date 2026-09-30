/**
 * Expert marketplace core: pack schema, catalog listing, install registry, summon prompts.
 * Runtime stays BRAIN: skills + agent.delegate — no WorkBuddy TeamCreate.
 */

import { promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { expertWorkspaceKeys, isExpertAvailableInWorkspace } from "../shared/expert-workspace-policy.ts";

export type ExpertType = "agent" | "team";

export type LocalizedText = { en?: string; zh?: string } | string;

export interface ExpertPackManifest {
  workspaceKeys?: string[];
  name: string;
  version: string;
  description?: string;
  expertType: ExpertType;
  agentName: string;
  teamInfo?: {
    leadAgent: string;
    memberAgents: string[];
  };
  agents: string[];
  skills?: string[];
  displayName: LocalizedText;
  profession: LocalizedText;
  displayDescription?: LocalizedText;
  avatar?: string;
  categoryId: string;
  defaultInitPrompt?: LocalizedText;
  tags?: LocalizedText[];
  quickPrompts?: LocalizedText[];
  members?: Array<{
    id: string;
    name?: LocalizedText;
    profession?: LocalizedText;
    avatar?: string;
    role: "lead" | "member";
  }>;
  preferredWorkspaceKey?: string;
  plugin?: string;
}

export interface ExpertCatalogEntry {
  workspaceKeys?: string[];
  id: string;
  name: string;
  expertType: ExpertType;
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  tags: string[];
  quickPrompts: string[];
  defaultInitPrompt: string;
  avatar?: string;
  preferredWorkspaceKey?: string;
  installed: boolean;
  enabled: boolean;
  source: "builtin" | "installed";
  rootPath: string;
  agentName: string;
  memberAgentIds: string[];
  skillNames: string[];
}

export interface ExpertInstallRecord {
  id: string;
  enabled: boolean;
  installedAt: string;
  sourcePath: string;
}

export interface ExpertRegistryState {
  version: 1;
  installed: ExpertInstallRecord[];
  /** threadId -> expert id */
  summons: Record<string, string>;
}

export interface ExpertSummonContext {
  expertId: string;
  expertType: ExpertType;
  profession: string;
  displayName: string;
  agentName: string;
  memberAgentIds: string[];
  skillNames: string[];
  preferredWorkspaceKey?: string;
  systemInstruction: string;
  allowedDelegateRoles: string[];
}

const textOf = (value: LocalizedText | undefined, fallback = "") => {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  return String(value.zh || value.en || "").trim() || fallback;
};

const ROLE_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;

export function isValidExpertRoleId(role: string) {
  return ROLE_ID_RE.test(String(role || "").trim());
}

export function emptyExpertRegistry(): ExpertRegistryState {
  return { version: 1, installed: [], summons: {} };
}

export async function readExpertRegistry(filePath: string): Promise<ExpertRegistryState> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ExpertRegistryState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.installed)) return emptyExpertRegistry();
    return {
      version: 1,
      installed: parsed.installed.filter((item) => item && item.id),
      summons: parsed.summons && typeof parsed.summons === "object" ? parsed.summons : {}
    };
  } catch {
    return emptyExpertRegistry();
  }
}

export async function writeExpertRegistry(filePath: string, state: ExpertRegistryState) {
  await fs.mkdir(resolve(filePath, ".."), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readManifest(expertRoot: string): Promise<ExpertPackManifest | null> {
  for (const meta of [".codex-plugin", ".codebuddy-plugin", ".workbuddy-plugin"]) {
    const candidate = join(expertRoot, meta, "plugin.json");
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const manifest = JSON.parse(raw) as ExpertPackManifest;
      if (!manifest?.name || !manifest.expertType || !manifest.agentName) return null;
      return manifest;
    } catch {
      // try next
    }
  }
  return null;
}

async function listSkillNames(expertRoot: string, manifest: ExpertPackManifest) {
  const names: string[] = [];
  const declared = Array.isArray(manifest.skills) ? manifest.skills : [];
  for (const rel of declared) {
    const skillDir = resolve(expertRoot, rel);
    try {
      const skillMd = await fs.readFile(join(skillDir, "SKILL.md"), "utf8");
      const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
      const nameLine = match?.[1].split(/\r?\n/).find((line) => /^name:\s*/.test(line));
      const name = nameLine ? nameLine.replace(/^name:\s*/, "").trim().replace(/^["']|["']$/g, "") : basename(skillDir);
      if (name) names.push(name);
    } catch {
      names.push(basename(rel));
    }
  }
  return [...new Set(names)];
}

async function catalogFromRoot(input: {
  root: string;
  source: "builtin" | "installed";
  installedIds: Set<string>;
  enabledMap: Map<string, boolean>;
}): Promise<ExpertCatalogEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(input.root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ExpertCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const expertRoot = join(input.root, entry.name);
    const manifest = await readManifest(expertRoot);
    if (!manifest) continue;
    const id = String(manifest.name || entry.name).trim();
    const memberAgentIds = [
      ...(manifest.teamInfo?.memberAgents ?? []),
      ...(manifest.members ?? []).filter((m) => m.role === "member").map((m) => m.id)
    ].filter(isValidExpertRoleId);
    const skillNames = await listSkillNames(expertRoot, manifest);
    const installed = input.source === "installed" || input.installedIds.has(id);
    const enabled = input.enabledMap.has(id) ? Boolean(input.enabledMap.get(id)) : installed;
    out.push({
      id,
      name: id,
      expertType: manifest.expertType,
      displayName: textOf(manifest.displayName, id),
      profession: textOf(manifest.profession, id),
      description: textOf(manifest.displayDescription, manifest.description || ""),
      categoryId: String(manifest.categoryId || "12-IndustryConsultant"),
      tags: (manifest.tags ?? []).map((tag) => textOf(tag)).filter(Boolean).slice(0, 3),
      quickPrompts: (manifest.quickPrompts ?? []).map((prompt) => textOf(prompt)).filter(Boolean).slice(0, 3),
      defaultInitPrompt: textOf(manifest.defaultInitPrompt, textOf((manifest.quickPrompts ?? [])[0])),
      avatar: manifest.avatar,
      preferredWorkspaceKey: manifest.preferredWorkspaceKey,
      workspaceKeys: expertWorkspaceKeys({ ...manifest, id }),
      installed,
      enabled,
      source: input.source,
      rootPath: expertRoot,
      agentName: manifest.agentName,
      memberAgentIds: [...new Set(memberAgentIds)],
      skillNames
    });
  }
  return out;
}

export async function listExpertCatalog(input: {
  builtinRoot: string;
  installedRoot: string;
  registry: ExpertRegistryState;
}): Promise<ExpertCatalogEntry[]> {
  const installedIds = new Set(input.registry.installed.map((item) => item.id));
  const enabledMap = new Map(input.registry.installed.map((item) => [item.id, item.enabled !== false]));
  const builtin = await catalogFromRoot({
    root: input.builtinRoot,
    source: "builtin",
    installedIds,
    enabledMap
  });
  const installed = await catalogFromRoot({
    root: input.installedRoot,
    source: "installed",
    installedIds,
    enabledMap
  });
  const byId = new Map<string, ExpertCatalogEntry>();
  for (const item of [...builtin, ...installed]) {
    const prev = byId.get(item.id);
    if (!prev || item.source === "installed") byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.profession.localeCompare(b.profession, "zh"));
}

export async function installExpertFromBuiltin(input: {
  expertId: string;
  builtinRoot: string;
  installedRoot: string;
  registryPath: string;
}): Promise<ExpertCatalogEntry> {
  const registry = await readExpertRegistry(input.registryPath);
  const catalog = await listExpertCatalog({
    builtinRoot: input.builtinRoot,
    installedRoot: input.installedRoot,
    registry
  });
  const source = catalog.find((item) => item.id === input.expertId);
  if (!source) throw new Error(`专家不存在：${input.expertId}`);
  await fs.mkdir(input.installedRoot, { recursive: true });
  const target = join(input.installedRoot, input.expertId);
  await fs.cp(source.rootPath, target, { recursive: true, force: true });
  const now = new Date().toISOString();
  const nextInstalled = registry.installed.filter((item) => item.id !== input.expertId);
  nextInstalled.push({
    id: input.expertId,
    enabled: true,
    installedAt: now,
    sourcePath: target
  });
  await writeExpertRegistry(input.registryPath, {
    ...registry,
    installed: nextInstalled
  });
  const updated = await listExpertCatalog({
    builtinRoot: input.builtinRoot,
    installedRoot: input.installedRoot,
    registry: await readExpertRegistry(input.registryPath)
  });
  const entry = updated.find((item) => item.id === input.expertId);
  if (!entry) throw new Error(`安装后未找到专家：${input.expertId}`);
  return entry;
}

export async function setExpertEnabled(input: {
  expertId: string;
  enabled: boolean;
  registryPath: string;
  builtinRoot: string;
  installedRoot: string;
}) {
  const registry = await readExpertRegistry(input.registryPath);
  const existing = registry.installed.find((item) => item.id === input.expertId);
  if (existing) {
    existing.enabled = input.enabled;
  } else if (input.enabled) {
    await installExpertFromBuiltin({
      expertId: input.expertId,
      builtinRoot: input.builtinRoot,
      installedRoot: input.installedRoot,
      registryPath: input.registryPath
    });
    return;
  } else {
    return;
  }
  await writeExpertRegistry(input.registryPath, registry);
}

export async function summonExpertToThread(input: {
  workspaceKey?: string;
  threadId: string;
  expertId: string;
  registryPath: string;
  builtinRoot: string;
  installedRoot: string;
}) {
  const threadId = String(input.threadId || "").trim();
  if (!threadId) throw new Error("threadId 不能为空。");
  let registry = await readExpertRegistry(input.registryPath);
  const catalog = await listExpertCatalog({
    builtinRoot: input.builtinRoot,
    installedRoot: input.installedRoot,
    registry
  });
  const expert = catalog.find((item) => item.id === input.expertId);
  if (!expert) throw new Error(`专家不存在：${input.expertId}`);
  if (input.workspaceKey && !isExpertAvailableInWorkspace(expert, input.workspaceKey)) {
    throw new Error("当前工作台不支持此专家；场景学习探索可使用全部专家。");
  }
  if (!expert.installed) {
    await installExpertFromBuiltin({
      expertId: expert.id,
      builtinRoot: input.builtinRoot,
      installedRoot: input.installedRoot,
      registryPath: input.registryPath
    });
    registry = await readExpertRegistry(input.registryPath);
  }
  registry.summons[threadId] = expert.id;
  await writeExpertRegistry(input.registryPath, registry);
  return buildExpertSummonContext(expert);
}

export async function clearExpertSummon(input: {
  threadId: string;
  registryPath: string;
}) {
  const registry = await readExpertRegistry(input.registryPath);
  delete registry.summons[String(input.threadId || "").trim()];
  await writeExpertRegistry(input.registryPath, registry);
}

export async function resolveSummonedExpert(input: {
  workspaceKey?: string;
  threadId: string;
  registryPath: string;
  builtinRoot: string;
  installedRoot: string;
}): Promise<ExpertSummonContext | null> {
  const registry = await readExpertRegistry(input.registryPath);
  const expertId = registry.summons[String(input.threadId || "").trim()];
  if (!expertId) return null;
  const catalog = await listExpertCatalog({
    builtinRoot: input.builtinRoot,
    installedRoot: input.installedRoot,
    registry
  });
  const expert = catalog.find((item) => item.id === expertId && item.enabled !== false);
  if (!expert) return null;
  if (input.workspaceKey && !isExpertAvailableInWorkspace(expert, input.workspaceKey)) return null;
  const context = buildExpertSummonContext(expert);
  try {
    const manifest = await readManifest(expert.rootPath);
    if (manifest?.agents?.length) {
      const docs = await loadExpertAgentDocuments(expert.rootPath, manifest.agents);
      const lead = docs.find((doc) => doc.name === expert.agentName) || docs[0];
      if (lead?.content) {
        context.systemInstruction = `${context.systemInstruction}\n\n---\n【专家主理人设】\n${lead.content.slice(0, 12_000)}`;
      }
      const memberDocs = docs.filter((doc) => expert.memberAgentIds.includes(doc.name));
      if (memberDocs.length) {
        context.systemInstruction = `${context.systemInstruction}\n\n---\n【可委派成员摘要】\n${memberDocs
          .map((doc) => `### ${doc.name}\n${doc.content.slice(0, 2_500)}`)
          .join("\n\n")
          .slice(0, 10_000)}`;
      }
    }
  } catch {
    // persona enrichment is best-effort
  }
  return context;
}

export async function loadExpertAgentDocuments(expertRoot: string, agentRelPaths: string[]) {
  const docs: Array<{ name: string; content: string }> = [];
  for (const rel of agentRelPaths) {
    try {
      const content = await fs.readFile(resolve(expertRoot, rel), "utf8");
      docs.push({ name: basename(rel, ".md"), content });
    } catch {
      // skip missing
    }
  }
  return docs;
}

export function buildExpertSummonContext(expert: ExpertCatalogEntry): ExpertSummonContext {
  const allowedDelegateRoles = [...new Set([expert.agentName, ...expert.memberAgentIds].filter(isValidExpertRoleId))];
  const memberLine = expert.memberAgentIds.length
    ? `专家团成员（必须通过 agent.delegate 的 role 指定成员 id，禁止由主理人代写成员产出）：${expert.memberAgentIds.join(", ")}。`
    : "当前为单专家：可按需 agent.delegate 给通用角色或保持本专家主理人直接作答。";
  const systemInstruction = [
    `你已被召唤为 BRAIN 专家「${expert.profession}」（${expert.displayName}，id=${expert.id}）。`,
    `expertType=${expert.expertType}；主理人 agentName=${expert.agentName}。`,
    memberLine,
    "协作协议只能使用 BRAIN 现有能力：agent.delegate → agent.wait → 主理人统一答复。禁止 TeamCreate/SendMessage。",
    "召唤专家期间关闭通用 Auto「必须先 delegate 给 planner/researcher」强委派；改按本专家 SOP 决定是否委派。",
    expert.skillNames.length ? `关联 Skill（应优先加载）：${expert.skillNames.join(", ")}。` : "",
    expert.preferredWorkspaceKey ? `建议场景 preferredWorkspaceKey=${expert.preferredWorkspaceKey}（可提示用户切换，不强制打断）。` : "",
    "工具执行仍走 BRAIN native tools / 场景 Tools / 审批与路径安全；不得伪造工具结果。"
  ].filter(Boolean).join("\n");

  return {
    expertId: expert.id,
    expertType: expert.expertType,
    profession: expert.profession,
    displayName: expert.displayName,
    agentName: expert.agentName,
    memberAgentIds: expert.memberAgentIds,
    skillNames: expert.skillNames,
    preferredWorkspaceKey: expert.preferredWorkspaceKey,
    systemInstruction,
    allowedDelegateRoles
  };
}

/** Extends collaboration roles with summoned expert member ids for one turn. */
export function resolveDelegationRole(input: {
  requestedRole: string;
  allowedExtraRoles?: string[];
  fallback?: string;
}) {
  const requested = String(input.requestedRole || "").trim();
  const builtin = ["planner", "researcher", "verifier", "editor"];
  if (builtin.includes(requested)) return requested;
  if (input.allowedExtraRoles?.includes(requested) && isValidExpertRoleId(requested)) return requested;
  return input.fallback || "researcher";
}
