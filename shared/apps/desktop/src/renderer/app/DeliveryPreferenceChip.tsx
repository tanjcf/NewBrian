import { EMPTY_DELIVERY_PREFERENCE_CHIP, type DeliveryPreferenceChipState } from "./delivery-preference-chip.ts";

type Props = {
  state: DeliveryPreferenceChipState;
  busy?: boolean;
  onClear?: () => void;
  onPin?: () => void;
};

/** Compact composer banner for typed document.style preferences. */
export function DeliveryPreferenceChip(props: Props) {
  const state = props.state ?? EMPTY_DELIVERY_PREFERENCE_CHIP;
  if (!state.visible || !state.hasStyle) return null;
  return (
    <div className="delivery-preference-chip" data-testid="delivery-preference-chip" role="status">
      <div className="delivery-preference-chip__row">
          <span className="delivery-preference-chip__label">交付版式</span>
          {state.scopeLabel ? <em className="delivery-preference-chip__scope">{state.scopeLabel}</em> : null}
          <strong className="delivery-preference-chip__summary">{state.summary}</strong>
          <span className="delivery-preference-chip__actions">
            {state.canPin ? (
              <button
                type="button"
                className="delivery-preference-chip__button"
                data-testid="delivery-preference-pin"
                disabled={props.busy}
                title="钉为项目默认，之后新对话也会使用"
                onClick={() => props.onPin?.()}
              >
                钉到项目
              </button>
            ) : null}
            {state.canClear ? (
              <button
                type="button"
                className="delivery-preference-chip__button danger"
                data-testid="delivery-preference-clear"
                disabled={props.busy}
                title="清除本对话与项目默认版式"
                onClick={() => props.onClear?.()}
              >
                清除
              </button>
            ) : null}
          </span>
      </div>
    </div>
  );
}
