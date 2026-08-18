export interface ModelRequestAuthState {
  mode: "desktop_token" | "session_cookie";
  access_token?: string;
  session_cookie?: string;
}

export type ModelRequestAuthSource =
  | "desktop_access_token"
  | "configured_api_key"
  | "none";

export function selectModelRequestAuth(
  state: ModelRequestAuthState | null | undefined,
  configuredApiKey: string
) {
  const accessToken = state?.mode === "desktop_token" ? state.access_token?.trim() : "";
  if (accessToken) return { source: "desktop_access_token" as const, bearerToken: accessToken, useGatewayBaseUrl: true };
  const apiKey = configuredApiKey.trim();
  if (apiKey) return { source: "configured_api_key" as const, bearerToken: apiKey, useGatewayBaseUrl: false };
  return { source: "none" as const, bearerToken: "", useGatewayBaseUrl: false };
}
