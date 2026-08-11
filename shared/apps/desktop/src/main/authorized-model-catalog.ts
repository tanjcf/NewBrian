import type {
  ModelConfig,
  ModelRoutingProfile,
  ModelRoutingRole,
  ModelRoutingStatus,
  ModelRoutingTaskClass
} from "@codex-forge/protocol";

export type AuthorizedModel = NonNullable<ModelConfig["availableModels"]>[number];

export interface AuthorizedModelCatalogDependencies {
  fetchRemote: () => Promise<AuthorizedModel[] | null>;
  readCache: () => Promise<AuthorizedModel[]>;
  writeCache: (models: AuthorizedModel[]) => Promise<void>;
}

const ROUTING_ROLES = new Set<ModelRoutingRole>([
  "chat",
  "code",
  "gov",
  "research",
  "vision",
  "review"
]);

const ROUTING_STATUSES = new Set<ModelRoutingStatus>([
  "probing",
  "active",
  "failed",
  "disabled"
]);

const ROUTING_TASKS = new Set<ModelRoutingTaskClass>([
  "chat",
  "code",
  "gov_write",
  "research",
  "general"
]);

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,;\s]+/).map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function parseTier(value: unknown): 1 | 2 | 3 | undefined {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

/** Parse and validate a gateway routing profile; returns undefined when invalid. */
export function parseModelRoutingProfile(raw: unknown): ModelRoutingProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (Number(record.schema_version) !== 1) return undefined;
  const status = String(record.status || "").trim() as ModelRoutingStatus;
  if (!ROUTING_STATUSES.has(status)) return undefined;
  const tier = parseTier(record.tier);
  if (!tier) return undefined;
  const costWeight = Number(record.cost_weight);
  const qualityWeight = Number(record.quality_weight);
  if (!Number.isFinite(costWeight) || !Number.isFinite(qualityWeight)) return undefined;

  const roles = asStringArray(record.roles)
    .map((role) => role.toLowerCase() as ModelRoutingRole)
    .filter((role) => ROUTING_ROLES.has(role));
  const capabilities = asStringArray(record.capabilities).map((tag) => tag.toLowerCase());

  let qualityByTask: ModelRoutingProfile["quality_by_task"];
  if (record.quality_by_task && typeof record.quality_by_task === "object") {
    const source = record.quality_by_task as Record<string, unknown>;
    const parsed: NonNullable<ModelRoutingProfile["quality_by_task"]> = {};
    for (const key of Object.keys(source)) {
      const task = key as ModelRoutingTaskClass;
      if (!ROUTING_TASKS.has(task)) continue;
      const score = Number(source[key]);
      if (Number.isFinite(score)) parsed[task] = score;
    }
    if (Object.keys(parsed).length) qualityByTask = parsed;
  }

  const maxContext = Number(record.max_context);
  const probedAt = typeof record.probed_at === "string" ? record.probed_at.trim() : "";
  const probeVersion = typeof record.probe_version === "string" ? record.probe_version.trim() : "";

  return {
    schema_version: 1,
    status,
    tier,
    cost_weight: costWeight,
    quality_weight: qualityWeight,
    ...(qualityByTask ? { quality_by_task: qualityByTask } : {}),
    roles,
    capabilities,
    ...(Number.isFinite(maxContext) && maxContext > 0 ? { max_context: maxContext } : {}),
    ...(probedAt ? { probed_at: probedAt } : {}),
    ...(probeVersion ? { probe_version: probeVersion } : {})
  };
}

function mergeCapabilities(
  topLevel: string[] | undefined,
  routing: ModelRoutingProfile | undefined
): string[] | undefined {
  const merged = [
    ...(topLevel ?? []),
    ...(routing?.capabilities ?? [])
  ]
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
  if (!merged.length) return undefined;
  return [...new Set(merged.map((tag) => tag.toLowerCase()))];
}

export function parseAuthorizedModelPayload(items: unknown[]): AuthorizedModel[] {
  return items.flatMap((item): AuthorizedModel[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const providerModel = String(record.id || "").trim();
    const alias = String(record.name || providerModel).trim();
    if (!alias) return [];
    const provider = String(record.owned_by || record.provider || "").trim();
    const rawCapabilities = record.capabilities ?? record.capability_tags ?? record.capabilityTags;
    const topLevelCapabilities = asStringArray(rawCapabilities);
    const routing = parseModelRoutingProfile(record.routing);
    const capabilities = mergeCapabilities(
      topLevelCapabilities.length ? topLevelCapabilities : undefined,
      routing
    );
    const inputPrice = Number(
      record.input_token_price_per_million
      ?? record.inputTokenPricePerMillion
      ?? record.input_price_per_million
    );
    const outputPrice = Number(
      record.output_token_price_per_million
      ?? record.outputTokenPricePerMillion
      ?? record.output_price_per_million
    );
    const capabilityIntro = String(record.capability_intro ?? record.capabilityIntro ?? "").trim();
    const bestFor = String(record.best_for ?? record.bestFor ?? "").trim();
    const strengths = String(record.strengths ?? "").trim();
    return [{
      id: String(record.config_id || alias),
      model: alias,
      label: alias || (provider ? `${provider} ${providerModel}` : providerModel),
      provider,
      ...(capabilities?.length ? { capabilities } : {}),
      ...(Number.isFinite(inputPrice) ? { input_token_price_per_million: inputPrice } : {}),
      ...(Number.isFinite(outputPrice) ? { output_token_price_per_million: outputPrice } : {}),
      ...(capabilityIntro ? { capability_intro: capabilityIntro } : {}),
      ...(bestFor ? { best_for: bestFor } : {}),
      ...(strengths ? { strengths } : {}),
      ...(routing ? { routing } : {})
    }];
  });
}

function canonicalizeModels(models: AuthorizedModel[]): AuthorizedModel[] {
  const seen = new Set<string>();
  const canonical: AuthorizedModel[] = [];
  for (let index = models.length - 1; index >= 0; index -= 1) {
    const item = models[index];
    const key = item.model.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    canonical.unshift(item);
  }
  return canonical;
}

export async function loadAuthorizedModelCatalog(
  dependencies: AuthorizedModelCatalogDependencies
): Promise<AuthorizedModel[]> {
  const remote = await dependencies.fetchRemote();
  if (remote !== null) {
    const canonical = canonicalizeModels(remote);
    if (canonical.length > 0) await dependencies.writeCache(canonical);
    return canonical;
  }
  return canonicalizeModels(await dependencies.readCache());
}
