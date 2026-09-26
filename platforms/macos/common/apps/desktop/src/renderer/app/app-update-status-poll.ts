/**
 * Logged-in renderer cadence for refreshing sidebar/settings app-update badge.
 * Matches the desktop control-plane heartbeat (30s) so a newly promoted stable
 * release appears without requiring quit + reopen.
 */
export const APP_UPDATE_STATUS_POLL_MS = 30_000;

/** Whether a focus/visibility event should trigger an immediate app-update refresh. */
export function shouldRefreshAppUpdateOnWindowSignal(input: {
  isAuthenticated?: boolean;
  documentHidden: boolean;
}): boolean {
  // app-update is public; refresh whenever the window is visible.
  void input.isAuthenticated;
  return !input.documentHidden;
}
