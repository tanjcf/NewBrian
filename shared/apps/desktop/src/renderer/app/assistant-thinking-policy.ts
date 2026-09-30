/**
 * Decide whether the thinking body should be open.
 * - Live + no answer yet → always open (avoid empty “stuck” UI).
 * - Once answer exists (or historical) → collapsed unless the user expands it.
 */
export function resolveThinkingPanelOpen(input: {
  live: boolean;
  hasAnswer: boolean;
  userOpen: boolean | null;
}): boolean {
  if (input.live && !input.hasAnswer) return true;
  if (input.userOpen == null) return false;
  return input.userOpen;
}
