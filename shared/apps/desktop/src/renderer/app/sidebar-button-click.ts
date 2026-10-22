export type SidebarPreviewPlacement = "hidden" | "side" | "center";
export type SidebarBrainPlacement = "side" | "center" | "hidden";

export type SidebarButtonClickResult =
  | { action: "exit-workbench"; nextBrainPlacement?: "side" }
  | { action: "toggle-sidebar" };

/**
 * Top-left window toggle: if a right workbench panel is open (file preview or
 * expanded BRAIN Tools), restore the left nav and collapse that panel.
 * Otherwise fall through to a normal sidebar open/close toggle.
 */
export function resolveSidebarButtonClick(input: {
  previewPlacement: SidebarPreviewPlacement;
  brainResourcePlacement: SidebarBrainPlacement;
}): SidebarButtonClickResult {
  if (input.previewPlacement !== "hidden") {
    return {
      action: "exit-workbench",
      nextBrainPlacement: input.brainResourcePlacement === "center" ? "side" : undefined
    };
  }
  if (input.brainResourcePlacement === "center") {
    return { action: "exit-workbench", nextBrainPlacement: "side" };
  }
  return { action: "toggle-sidebar" };
}
