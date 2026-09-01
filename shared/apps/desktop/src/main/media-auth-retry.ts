import { MediaGenerationHttpError } from "./media-generation-gateway.ts";

export type MediaAuthenticationRetryInput<T> = {
  initialToken: string;
  refreshAccessToken: () => Promise<string>;
  execute: (accessToken: string) => Promise<T>;
};

let refreshInFlight: Promise<string> | null = null;

function isRecoverableTokenError(error: unknown): boolean {
  if (!(error instanceof MediaGenerationHttpError) || error.status !== 401) return false;
  const payload = error.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const record = payload as Record<string, unknown>;
  const code = String(record.code ?? record.error_code ?? record.errorCode ?? "").toLowerCase();
  const message = String(record.message ?? record.error ?? record.detail ?? "").toLowerCase();
  return !code && !message
    || /token|credential|authorization|unauthoriz|expired|invalid.*(access|session)/i.test(`${code} ${message}`);
}

async function refreshOnce(refresh: () => Promise<string>): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * Executes one idempotent media operation and refreshes the desktop access
 * token exactly once when Spring rejects it. Provider failures are never
 * retried here, so this cannot duplicate a successful paid generation.
 */
export async function executeWithMediaAuthenticationRetry<T>(
  input: MediaAuthenticationRetryInput<T>
): Promise<T> {
  try {
    return await input.execute(input.initialToken);
  } catch (error) {
    if (!isRecoverableTokenError(error)) throw error;
    const refreshedToken = await refreshOnce(input.refreshAccessToken);
    if (!refreshedToken) throw error;
    return input.execute(refreshedToken);
  }
}
