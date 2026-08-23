export function activateProviderManifest({ manifest, registry, providers, createHandler }) {
  if (!manifest || !registry) throw new TypeError("manifest and registry are required");
  const activated = [];
  const registeredProviders = [];
  const registeredCapabilities = [];
  const registeredHandlers = [];
  try {
  for (const provider of manifest.providers || []) {
    const providerId = `${manifest.id}.${provider.id}`;
    registry.registerProvider({
      id: providerId,
      type: provider.type,
      version: manifest.version,
      status: "active",
      capabilities: provider.capabilities || []
    });
    registeredProviders.push(providerId);
    if (providers && createHandler) {
      const handler = createHandler(provider, providerId);
      if (typeof handler !== "function") throw new Error(`provider handler unavailable: ${providerId}`);
      providers.set(providerId, handler);
      registeredHandlers.push(providerId);
    }
    for (const capability of provider.capabilities || []) {
      const descriptor = typeof capability === "string" ? { id: capability } : capability;
      registry.registerCapability({
        id: descriptor.id,
        version: manifest.version,
        providerId,
        providerType: provider.type,
        inputSchema: descriptor.inputSchema || { type: "object" },
        outputSchema: descriptor.outputSchema || { type: "object" },
        risk: descriptor.risk || "read",
        permissions: descriptor.permissions || manifest.permissions || [],
        approval: descriptor.approval || "never",
        idempotency: descriptor.idempotency || "safe",
        verification: descriptor.verification || manifest.verification?.suite || "builtin.basic.v1"
      });
      registeredCapabilities.push({ id: descriptor.id, providerId });
      activated.push({ capabilityId: descriptor.id, providerId });
    }
  }
  return activated;
  } catch (error) {
    for (const item of registeredCapabilities.reverse()) registry.unregisterCapability(item.id, { providerId: item.providerId });
    for (const providerId of registeredHandlers) providers.delete(providerId);
    for (const providerId of registeredProviders.reverse()) registry.unregisterProvider(providerId);
    throw error;
  }
}
