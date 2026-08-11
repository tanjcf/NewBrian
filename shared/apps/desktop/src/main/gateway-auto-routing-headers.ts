/** Gateway headers written by spring-app Auto routing. */
export const GATEWAY_SELECTED_MODEL_HEADER = "x-codecn-selected-model";
export const GATEWAY_ROUTING_REASON_HEADER = "x-codecn-routing-reason";
export const GATEWAY_MODEL_ALIAS_HEADER = "x-codecn-model-alias";
export const GATEWAY_ROUTING_CHANNEL_HEADER = "x-codecn-routing-channel";

export function readGatewayAutoRoutingHeaders(headers: Headers | null | undefined): {
  selectedModel: string;
  routingReason: string;
  modelAlias: string;
  routingChannel: string;
} {
  if (!headers) {
    return { selectedModel: "", routingReason: "", modelAlias: "", routingChannel: "" };
  }
  return {
    selectedModel: String(headers.get(GATEWAY_SELECTED_MODEL_HEADER) || "").trim(),
    routingReason: String(headers.get(GATEWAY_ROUTING_REASON_HEADER) || "").trim(),
    modelAlias: String(headers.get(GATEWAY_MODEL_ALIAS_HEADER) || "").trim(),
    routingChannel: String(headers.get(GATEWAY_ROUTING_CHANNEL_HEADER) || "").trim()
  };
}
