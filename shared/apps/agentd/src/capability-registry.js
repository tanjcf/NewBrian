import { assertCapabilityDescriptor, assertProviderDescriptor } from "./capability-contract.js";

export class CapabilityRegistry {
  #capabilities = new Map();
  #providers = new Map();

  registerProvider(provider) {
    const descriptor = assertProviderDescriptor(provider);
    if (this.#providers.has(descriptor.id)) throw new Error(`provider already registered: ${descriptor.id}`);
    this.#providers.set(descriptor.id, descriptor);
    return descriptor;
  }

  registerCapability(capability) {
    const descriptor = assertCapabilityDescriptor(capability);
    if (!this.#providers.has(descriptor.providerId)) throw new Error(`provider not registered: ${descriptor.providerId}`);
    const providers = this.#capabilities.get(descriptor.id) || new Map();
    if (providers.has(descriptor.providerId)) throw new Error(`capability already registered: ${descriptor.id} by ${descriptor.providerId}`);
    providers.set(descriptor.providerId, descriptor);
    this.#capabilities.set(descriptor.id, providers);
    return descriptor;
  }

  getProvider(id) { return this.#providers.get(id) || null; }
  getCapability(id, { providerId } = {}) {
    const providers = this.#capabilities.get(id);
    if (!providers) return null;
    if (providerId) return providers.get(providerId) || null;
    return [...providers.values()].find((item) => this.#providers.get(item.providerId)?.status === "active") || [...providers.values()][0] || null;
  }
  listProviders() { return [...this.#providers.values()]; }
  listCapabilities({ activeOnly = false } = {}) {
    return [...this.#capabilities.values()].flatMap((providers) => [...providers.values()]).filter((item) => !activeOnly || this.#providers.get(item.providerId)?.status === "active");
  }

  setProviderStatus(id, status) {
    const provider = this.#providers.get(id);
    if (!provider) throw new Error(`provider not registered: ${id}`);
    this.#providers.set(id, Object.freeze({ ...provider, status }));
    return this.#providers.get(id);
  }

  unregisterCapability(id, { providerId } = {}) {
    const providers = this.#capabilities.get(id);
    if (!providers) return false;
    if (!providerId) return this.#capabilities.delete(id);
    const removed = providers.delete(providerId);
    if (providers.size === 0) this.#capabilities.delete(id);
    return removed;
  }

  unregisterProvider(id) {
    if (!this.#providers.has(id)) return false;
    for (const [capabilityId, providers] of this.#capabilities) {
      providers.delete(id);
      if (providers.size === 0) this.#capabilities.delete(capabilityId);
    }
    return this.#providers.delete(id);
  }
}
