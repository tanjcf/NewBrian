import { invokeProvider } from "./provider-invocation.js";
import { verifyCapabilityResult } from "./capability-verifier.js";

const WRITE_PERMISSIONS = new Set(["workspace.write", "workspace.overwrite", "workspace.delete"]);

export class CapabilityRuntime {
  constructor({ registry, providers = new Map(), policy = {}, verifiers = new Map() }) {
    if (!registry) throw new TypeError("registry is required");
    this.registry = registry;
    this.providers = providers;
    this.policy = policy;
    this.verifiers = verifiers;
  }

  async invoke(capabilityId, input, context = {}) {
    const capability = this.registry.getCapability(capabilityId);
    if (!capability) return { status: "failed", error: { code: "CAPABILITY_UNAVAILABLE", message: `Capability unavailable: ${capabilityId}` } };
    const provider = this.registry.getProvider(capability.providerId);
    if (!provider || provider.status !== "active") return { status: "failed", error: { code: "PROVIDER_UNAVAILABLE", message: `Provider unavailable: ${capability.providerId}` } };
    const decision = await this.#authorize(capability, input, context);
    if (!decision.allowed) return { status: "denied", error: { code: "POLICY_DENIED", message: decision.reason } };
    const handler = this.providers.get(capability.providerId);
    if (typeof handler !== "function") return { status: "failed", error: { code: "PROVIDER_HANDLER_MISSING", message: `Provider handler missing: ${capability.providerId}` } };
    const result = await invokeProvider({ capability, input, handler, context: { ...context, capabilityId }, signal: context.signal });
    return verifyCapabilityResult({ capability, result, verifiers: this.verifiers, context });
  }

  async #authorize(capability, input, context) {
    const needsApproval = capability.approval === "always" || (capability.approval === "conditional" && capability.permissions.some((permission) => WRITE_PERMISSIONS.has(permission)));
    if (!needsApproval) return { allowed: true };
    if (context.approved === true) return { allowed: true };
    if (typeof this.policy.requestApproval === "function") return this.policy.requestApproval({ capability, input, context });
    return { allowed: false, reason: "This operation requires approval before it can modify or remove data." };
  }
}
