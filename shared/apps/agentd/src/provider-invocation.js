import { randomUUID } from "node:crypto";

function validateObjectSchema(value, schema, label) {
  if (!schema || schema.type !== "object") return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const field of schema.required || []) {
    if (!(field in value)) throw new TypeError(`${label} missing required field: ${field}`);
  }
}

export async function invokeProvider({ capability, input, handler, context = {}, signal }) {
  if (!capability || typeof handler !== "function") throw new TypeError("capability and handler are required");
  validateObjectSchema(input, capability.inputSchema, "input");
  const toolCallId = context.toolCallId || randomUUID();
  const abortController = new AbortController();
  const onAbort = () => abortController.abort(signal.reason || new Error("invocation cancelled"));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const output = await Promise.resolve(handler(input, { ...context, toolCallId, signal: abortController.signal }));
    validateObjectSchema(output, capability.outputSchema, "output");
    return { status: "completed", toolCallId, output, evidence: { providerId: capability.providerId, capabilityId: capability.id } };
  } catch (error) {
    return { status: abortController.signal.aborted ? "cancelled" : "failed", toolCallId, error: { code: error.code || "PROVIDER_FAILED", message: error.message } };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
