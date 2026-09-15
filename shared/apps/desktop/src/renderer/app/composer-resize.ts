export const COMPOSER_TEXTAREA_MIN_HEIGHT = 56;
export const COMPOSER_TEXTAREA_DEFAULT_HEIGHT = 56;
/** Hard cap so the input cannot fill the whole chat column. */
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 360;
export const COMPOSER_TEXTAREA_HEIGHT_STORAGE_KEY = "newbrain.composer.textarea-height";

export function clampComposerTextareaHeight(value: number) {
  if (!Number.isFinite(value)) return COMPOSER_TEXTAREA_DEFAULT_HEIGHT;
  return Math.round(Math.max(
    COMPOSER_TEXTAREA_MIN_HEIGHT,
    Math.min(COMPOSER_TEXTAREA_MAX_HEIGHT, value)
  ));
}

export function readStoredComposerTextareaHeight(storage: Pick<Storage, "getItem"> | null | undefined) {
  try {
    const raw = storage?.getItem(COMPOSER_TEXTAREA_HEIGHT_STORAGE_KEY);
    if (!raw) return COMPOSER_TEXTAREA_DEFAULT_HEIGHT;
    return clampComposerTextareaHeight(Number(raw));
  } catch {
    return COMPOSER_TEXTAREA_DEFAULT_HEIGHT;
  }
}

export function nextComposerTextareaHeight(startHeight: number, startClientY: number, clientY: number) {
  // Dragging the top handle upward grows the box (WorkBuddy-style).
  return clampComposerTextareaHeight(startHeight + (startClientY - clientY));
}
