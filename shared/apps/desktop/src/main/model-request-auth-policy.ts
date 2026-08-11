export interface ModelRequestAuthState {
  mode: "desktop_token" | "session_cookie";
  gateway_api_key?: string;
  access_token?: string;
  session_cookie?: string;
}

export type ModelRequestAuthSource =
  | "desktop_gateway_key"
  | "desktop_access_token"
  | "configured_api_key"
  | "session_gateway_key"
  | "none";

export function selectModelRequestAuth(
  state: ModelRequestAuthState | null | undefined,
  configuredApiKey: string
) {
  const gatewayKey = state?.mode === "desktop_token" ? state.gateway_api_key?.trim() : "";
  if (gatewayKey) return { source: "desktop_gateway_key" as const, bearerToken: gatewayKey, useGatewayBaseUrl: true };
  const accessToken = state?.mode === "desktop_token" ? state.access_token?.trim() : "";
  if (accessToken) return { source: "desktop_access_token" as const, bearerToken: accessToken, useGatewayBaseUrl: true };
  const apiKey = configuredApiKey.trim();
  if (apiKey) return { source: "configured_api_key" as const, bearerToken: apiKey, useGatewayBaseUrl: false };
  const sessionCookie = state?.mode === "session_cookie" ? state.session_cookie?.trim() : "";
  if (sessionCookie) return {
    source: "session_gateway_key" as const,
    bearerToken: "",
    sessionCookie,
    useGatewayBaseUrl: true
  };
  return { source: "none" as const, bearerToken: "", useGatewayBaseUrl: false };
}
