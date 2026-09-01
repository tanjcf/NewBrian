export interface ModelRequestAuthState {
  mode: "desktop_token" | "session_cookie";
  access_token?: string;
  session_cookie?: string;
}

export type ModelRequestAuthSource =
  | "desktop_access_token"
  | "configured_api_key"
  | "dev_e2e_bypass"
  | "none";

export function resolveDevE2eBearerToken(): string {
  const bypassEnabled = process.env.CODECN_E2E_AUTH_BYPASS === "1";
  const gatewayConfigured = Boolean(
    process.env.CODECN_MODEL_BASE_URL?.trim() || process.env.CODECN_MEDIA_GATEWAY_BASE_URL?.trim()
  );
  if (!bypassEnabled || !gatewayConfigured) {
    return "";
  }
  return process.env.CODECN_E2E_AUTH_TOKEN?.trim() || "codecn-e2e";
}

export function selectModelRequestAuth(
  state: ModelRequestAuthState | null | undefined,
  configuredApiKey: string
) {
  const accessToken = state?.mode === "desktop_token" ? state.access_token?.trim() : "";
  if (accessToken) {
    return { source: "desktop_access_token" as const, bearerToken: accessToken, useGatewayBaseUrl: true };
  }
  const devE2eBearerToken = resolveDevE2eBearerToken();
  if (devE2eBearerToken) {
    return {
      source: "dev_e2e_bypass" as const,
      bearerToken: devE2eBearerToken,
      useGatewayBaseUrl: true
    };
  }
  const apiKey = configuredApiKey.trim();
  if (apiKey) return { source: "configured_api_key" as const, bearerToken: apiKey, useGatewayBaseUrl: false };
  return { source: "none" as const, bearerToken: "", useGatewayBaseUrl: false };
}
