import {
  DIRECT_CLAWHUB_BLOCKED_MESSAGE,
  MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG
} from "@codex-forge/protocol";

/**
 * Product flag gate for desktop ClawHub network installs.
 * When false, callers must use local zip import (or set preference / NEWBRAIN_MARKET_DIRECT_CLAWHUB=1).
 */
export function resolveDirectClawhubAllowed(input?: {
  preferenceAllowed?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input?.env ?? process.env;
  if (env.NEWBRAIN_MARKET_DIRECT_CLAWHUB === "1") return true;
  return input?.preferenceAllowed === true;
}

/** Throws the standard Chinese blocked message when direct ClawHub is closed. */
export function assertDirectClawhubAllowed(allowed: boolean): void {
  if (!allowed) {
    // to-be-redirected: spring-app market APIs replace clawhub-client product path.
    throw new Error(`${DIRECT_CLAWHUB_BLOCKED_MESSAGE} (${MARKET_DIRECT_CLAWHUB_ALLOWED_FLAG}=false)`);
  }
}
