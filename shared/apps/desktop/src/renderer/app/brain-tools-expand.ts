/** Right-hand project panel: side list versus expanded preview. */

export type BrainToolsPlacement = "side" | "center" | "hidden";

/**
 * Expand stays on center. A second call with the same current value must not
 * flip back, or one click only flashes the wide layout.
 */
export function nextBrainToolsPlacement(current: BrainToolsPlacement): BrainToolsPlacement {
  return current === "center" ? "side" : "center";
}
