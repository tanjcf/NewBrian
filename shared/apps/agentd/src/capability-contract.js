export const PROVIDER_TYPES = Object.freeze(["instruction", "builtin", "process", "mcp"]);
export const RISK_LEVELS = Object.freeze(["read", "local-write", "overwrite", "delete", "external"]);
export const PROVIDER_STATUSES = Object.freeze(["discovered", "validated", "installed", "awaiting_permission", "active", "degraded", "failed", "disabled", "removed"]);

export function assertCapabilityDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("capability descriptor must be an object");
  for (const field of ["id", "version", "providerId", "inputSchema", "outputSchema", "risk", "permissions", "verification"]) {
    if (!(field in descriptor)) throw new TypeError(`capability descriptor missing ${field}`);
  }
  if (!/^[a-z][a-z0-9_.-]+$/.test(String(descriptor.id))) throw new TypeError("capability id is invalid");
  if (!PROVIDER_TYPES.includes(descriptor.providerType)) throw new TypeError("provider type is invalid");
  if (!RISK_LEVELS.includes(descriptor.risk)) throw new TypeError("capability risk is invalid");
  if (!Array.isArray(descriptor.permissions)) throw new TypeError("capability permissions must be an array");
  return Object.freeze({ ...descriptor, permissions: Object.freeze([...descriptor.permissions]) });
}

export function assertProviderDescriptor(provider) {
  if (!provider || typeof provider !== "object") throw new TypeError("provider descriptor must be an object");
  for (const field of ["id", "type", "version", "status"]) {
    if (!(field in provider)) throw new TypeError(`provider descriptor missing ${field}`);
  }
  if (!PROVIDER_TYPES.includes(provider.type)) throw new TypeError("provider type is invalid");
  if (!PROVIDER_STATUSES.includes(provider.status)) throw new TypeError("provider status is invalid");
  return Object.freeze({ ...provider, capabilities: Object.freeze([...(provider.capabilities || [])]) });
}
