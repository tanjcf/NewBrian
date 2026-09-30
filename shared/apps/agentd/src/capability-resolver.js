const TRUST_SCORE = Object.freeze({ core: 100, official: 80, verified: 60, third_party: 20, untrusted: -1000 });

export class CapabilityResolver {
  constructor({ registry, catalog, supervisor, activatePackage, onEvent }) {
    this.registry = registry;
    this.catalog = catalog;
    this.supervisor = supervisor;
    this.activatePackage = activatePackage;
    this.onEvent = onEvent || (async () => {});
  }

  async resolve(capabilityId, context = {}) {
    const active = this.registry.listCapabilities({ activeOnly: true }).filter((item) => item.id === capabilityId);
    if (active.length) return { status: "resolved", source: "active", capability: rank(active, context)[0] };
    await this.onEvent({ type: "capability_resolution_started", capabilityId });
    const candidates = (await this.catalog.find(capabilityId, context)).filter((candidate) => candidate.capabilities?.includes(capabilityId));
    const candidate = rank(candidates.filter((item) => isEligible(item, context)), context)[0];
    if (!candidate) {
      const result = { status: "unavailable", capabilityId, reason: "No trusted compatible provider is available." };
      await this.onEvent({ type: "capability_unavailable", ...result });
      return result;
    }
    if (!canInstallSilently(candidate, context)) {
      const result = { status: "approval_required", capabilityId, candidate, reason: "Provider requires elevated permissions or external access." };
      await this.onEvent({ type: "capability_approval_required", capabilityId, candidateId: candidate.id, permissions: candidate.permissions || [] });
      return result;
    }
    await this.onEvent({ type: "capability_install_started", capabilityId, candidateId: candidate.id });
    let installation;
    let activated;
    try {
      installation = candidate.installation?.type === "bundled"
        ? { status: "active", packageId: candidate.id, version: candidate.version, bundled: true }
        : await this.supervisor.install(candidate.installation);
      activated = await this.activatePackage({ candidate, installation });
    } catch (error) {
      if (installation && !installation.bundled) await this.supervisor.rollbackFailedActivation?.(installation);
      await this.onEvent({ type: "capability_install_failed", capabilityId, candidateId: candidate.id, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    const capability = this.registry.getCapability(capabilityId, { providerId: activated.providerId });
    if (!capability) throw new Error(`installed provider did not register capability: ${capabilityId}`);
    const result = { status: "resolved", source: "acquired", capability, installation };
    await this.onEvent({ type: "capability_activated", capabilityId, providerId: activated.providerId, packageId: installation.packageId });
    return result;
  }

  async resolveForIntent(text, context = {}) {
    if (typeof this.catalog.findForIntent !== "function") return [];
    const capabilityIds = await this.catalog.findForIntent(text, context);
    const results = [];
    for (const capabilityId of capabilityIds) results.push(await this.resolve(capabilityId, context));
    return results;
  }
}

function isEligible(candidate, context) {
  if ((TRUST_SCORE[candidate.trust] ?? -1000) < 0) return false;
  if (candidate.platforms?.length && !candidate.platforms.includes(context.platform)) return false;
  if (candidate.minRuntimeVersion && context.runtimeVersion && compareVersions(context.runtimeVersion, candidate.minRuntimeVersion) < 0) return false;
  return true;
}

function canInstallSilently(candidate, context) {
  if (context.approved === true) return true;
  const permissions = new Set(candidate.permissions || []);
  return !["process.execute", "network.connect", "credential.use", "workspace.overwrite", "workspace.delete"].some((permission) => permissions.has(permission));
}

function rank(candidates, context) {
  return [...candidates].sort((left, right) => score(right, context) - score(left, context));
}

function score(candidate, context) {
  return (TRUST_SCORE[candidate.trust] ?? 50)
    + Number(candidate.semanticFit ?? 0) * 20
    + Number(candidate.verificationCoverage ?? 0) * 15
    + (candidate.local ? 20 : 0)
    + (candidate.privacy === "local" ? 15 : 0)
    - Number(candidate.cost ?? 0) * 10
    - Number(candidate.latency ?? 0) * 5
    - Number(candidate.permissions?.length ?? 0);
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
