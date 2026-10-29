/** Keep a pinned chat scroller from bouncing while streamed text grows. */

export const CHAT_NEAR_BOTTOM_PX = 140;

export function nextStickToBottom(input: {
  distanceFromBottom: number;
  nearBottomPx?: number;
  programmatic: boolean;
  currentlyStuck: boolean;
}): boolean {
  if (input.programmatic) return input.currentlyStuck;
  const nearBottomPx = input.nearBottomPx ?? CHAT_NEAR_BOTTOM_PX;
  return input.distanceFromBottom <= nearBottomPx;
}

export function nextScrollTop(input: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  stick: boolean;
}): number | null {
  if (!input.stick) return null;
  const target = Math.max(0, input.scrollHeight - input.clientHeight);
  if (Math.abs(input.scrollTop - target) <= 1) return null;
  return target;
}

/** Keep the last visible stream when a later chunk sanitizes to nothing. */
export function retainStreamingText(previous: string, next: string): string {
  return next.trim() ? next : previous;
}

/**
 * Text shown under the live turn. A new request must not reuse the previous
 * turn's answer, and an empty stream must not fall back to that answer either.
 */
export function liveTurnAnswerText(input: {
  streamText: string;
  turnText: string;
  earlierTurnTexts: string[];
  retained: string;
  sameRequest: boolean;
}): string {
  const streamText = String(input.streamText || "");
  const turnText = String(input.turnText || "");
  const earlier = new Set(
    input.earlierTurnTexts.map((text) => text.trim()).filter(Boolean)
  );
  const candidate = streamText.trim() ? streamText : turnText;
  if (!streamText.trim() && earlier.has(candidate.trim())) return "";
  const baseline = input.sameRequest ? input.retained : "";
  const retained = retainStreamingText(baseline, candidate);
  if (!streamText.trim() && earlier.has(retained.trim())) return "";
  return retained;
}
