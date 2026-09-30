export class CapabilityCatalog {
  #entries = new Map();

  register(entry) {
    if (!entry?.id || !Array.isArray(entry.capabilities) || !entry.installation) throw new TypeError("catalog entry is invalid");
    if (entry.trust !== "core" && entry.trust !== "official") throw new TypeError("only core or official entries may enter the bundled catalog");
    this.#entries.set(entry.id, Object.freeze({ ...entry, capabilities: Object.freeze([...entry.capabilities]) }));
    return entry;
  }

  async find(capabilityId, context = {}) {
    return [...this.#entries.values()].filter((entry) => entry.capabilities.includes(capabilityId)
      && (!entry.platforms?.length || entry.platforms.includes(context.platform))
      && (!entry.minRuntimeVersion || !context.runtimeVersion || compareVersions(context.runtimeVersion, entry.minRuntimeVersion) >= 0));
  }

  async findForIntent(text, context = {}) {
    const normalized = String(text || "").toLowerCase();
    if (!normalized) return [];
    const capabilities = [];
    for (const entry of this.#entries.values()) {
      if (entry.platforms?.length && !entry.platforms.includes(context.platform)) continue;
      const matches = (entry.intents || []).some((intent) => normalized.includes(String(intent).toLowerCase()));
      if (matches) capabilities.push(...entry.capabilities);
    }
    return [...new Set(capabilities)];
  }

  list() { return [...this.#entries.values()]; }
}

export function createBundledCapabilityCatalog(entries = []) {
  const catalog = new CapabilityCatalog();
  for (const entry of entries) catalog.register({ trust: "core", local: true, privacy: "local", verificationCoverage: 1, ...entry });
  return catalog;
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
