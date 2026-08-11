/** Viewport-fixed placement for composer picker menus that must escape overflow clipping. */

export type ComposerPickerMenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
};

export function positionComposerPickerMenu(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  options?: {
    menuWidth?: number;
    estimatedHeight?: number;
    gap?: number;
    padding?: number;
    preferBelow?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  }
): ComposerPickerMenuPosition {
  const menuWidth = options?.menuWidth ?? 214;
  const estimatedHeight = options?.estimatedHeight ?? 360;
  const gap = options?.gap ?? 10;
  const padding = options?.padding ?? 8;
  const viewportWidth = options?.viewportWidth ?? 1280;
  const viewportHeight = options?.viewportHeight ?? 720;
  const preferBelow = options?.preferBelow ?? false;

  const spaceAbove = Math.max(0, anchor.top - padding - gap);
  const spaceBelow = Math.max(0, viewportHeight - anchor.bottom - padding - gap);
  const placeBelow = preferBelow
    ? spaceBelow >= Math.min(180, estimatedHeight) || spaceBelow >= spaceAbove
    : spaceAbove < Math.min(estimatedHeight, 240) && spaceBelow > spaceAbove;

  const maxHeight = Math.max(
    160,
    Math.min(estimatedHeight, placeBelow ? spaceBelow : spaceAbove, viewportHeight - padding * 2)
  );
  const top = placeBelow
    ? anchor.bottom + gap
    : Math.max(padding, anchor.top - gap - maxHeight);
  const left = Math.min(
    Math.max(padding, anchor.right - menuWidth),
    Math.max(padding, viewportWidth - menuWidth - padding)
  );

  return {
    left,
    top,
    width: menuWidth,
    maxHeight,
    placement: placeBelow ? "below" : "above"
  };
}
