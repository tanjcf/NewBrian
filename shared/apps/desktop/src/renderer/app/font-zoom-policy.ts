export const UI_FONT_SIZE_MIN = 11;
export const UI_FONT_SIZE_MAX = 28;
export const CODE_FONT_SIZE_MIN = 10;
export const CODE_FONT_SIZE_MAX = 24;

export type AppearanceFontSizes = {
  uiFontSize: number;
  codeFontSize: number;
};

/** Ctrl/Meta + wheel: negative deltaY zooms in (larger fonts). */
export function resolveFontZoomDirection(deltaY: number): -1 | 0 | 1 {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY < 0 ? 1 : -1;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Scale UI font by one step and keep code font proportional to the previous ratio.
 */
export function scaleAppearanceFontSizes(
  current: AppearanceFontSizes,
  direction: -1 | 0 | 1
): AppearanceFontSizes {
  if (direction === 0) {
    return {
      uiFontSize: clamp(Math.round(Number(current.uiFontSize) || 14), UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX),
      codeFontSize: clamp(Math.round(Number(current.codeFontSize) || 12), CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX)
    };
  }
  const ui = clamp(Math.round(Number(current.uiFontSize) || 14), UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX);
  const code = clamp(Math.round(Number(current.codeFontSize) || 12), CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX);
  const ratio = ui > 0 ? code / ui : 12 / 14;
  const nextUi = clamp(ui + direction, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX);
  const nextCode = clamp(Math.round(nextUi * ratio), CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX);
  return { uiFontSize: nextUi, codeFontSize: nextCode };
}

export function shouldHandleFontZoomWheel(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  deltaY?: number;
}): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && Number(event.deltaY));
}
