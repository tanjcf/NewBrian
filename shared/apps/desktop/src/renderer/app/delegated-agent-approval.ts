const STALE_APPROVAL_ERROR = "Delegated task is not awaiting approval and cannot be resumed.";

export async function respondToDelegatedAgentApproval(input: {
  respond: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
}): Promise<{ ok: true; stale: false } | { ok: false; stale: boolean; error?: unknown }> {
  try {
    const result = await input.respond();
    if (isRecord(result) && result.stale === true) return { ok: false, stale: true };
    return { ok: true, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(STALE_APPROVAL_ERROR)) return { ok: false, stale: true };
    return { ok: false, stale: false, error };
  } finally {
    try {
      await input.refresh();
    } catch {
      // The approval result is authoritative; polling will retry the projection.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
