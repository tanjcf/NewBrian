/**
 * Composer chip for Delivery Preference OS: show current document.style,
 * clear, and pin thread style to project defaults.
 */
export type DeliveryPreferenceChipState = {
  visible: boolean;
  hasStyle: boolean;
  scope: "thread" | "project" | null;
  scopeLabel: string;
  summary: string;
  canClear: boolean;
  canPin: boolean;
  styleGapQuestion: string;
};

export const EMPTY_DELIVERY_PREFERENCE_CHIP: DeliveryPreferenceChipState = {
  visible: false,
  hasStyle: false,
  scope: null,
  scopeLabel: "",
  summary: "",
  canClear: false,
  canPin: false,
  styleGapQuestion: ""
};

export function normalizeDeliveryPreferenceChip(input: unknown): DeliveryPreferenceChipState {
  if (!input || typeof input !== "object") return { ...EMPTY_DELIVERY_PREFERENCE_CHIP };
  const source = input as Record<string, unknown>;
  const scope = source.scope === "thread" || source.scope === "project" ? source.scope : null;
  return {
    visible: Boolean(source.visible),
    hasStyle: Boolean(source.hasStyle),
    scope,
    scopeLabel: String(source.scopeLabel || ""),
    summary: String(source.summary || ""),
    canClear: Boolean(source.canClear),
    canPin: Boolean(source.canPin),
    styleGapQuestion: String(source.styleGapQuestion || "")
  };
}
