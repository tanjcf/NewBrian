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

/**
 * Whether unpackaged E2E may inject a spring-app Bearer without a desktop login file.
 * Must stay aligned with `resolveDesktopAuthStatus` fake-login: bypass alone is not
 * enough for the UI, but once remote-debug E2E is active the UI treats the session as
 * authenticated — Auto `/v1/auto/route` must receive the same bearer even when the
 * gateway URL lives only in config (not in NEWBRAIN_MODEL_BASE_URL).
 */
export function isDevE2eAuthBypassActive(): boolean {
  if (process.env.NEWBRAIN_E2E_AUTH_BYPASS !== "1") {
    return false;
  }
  const gatewayConfigured = Boolean(
    process.env.NEWBRAIN_MODEL_BASE_URL?.trim() || process.env.NEWBRAIN_MEDIA_GATEWAY_BASE_URL?.trim()
  );
  const e2eRemoteDebugSession = Boolean(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT?.trim());
  return gatewayConfigured || e2eRemoteDebugSession;
}

export function resolveDevE2eBearerToken(): string {
  if (!isDevE2eAuthBypassActive()) {
    return "";
  }
  return process.env.NEWBRAIN_E2E_AUTH_TOKEN?.trim() || "newbrain-e2e";
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
