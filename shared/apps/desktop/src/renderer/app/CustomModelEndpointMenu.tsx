import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomModelEndpointPublic } from "../../shared/custom-model-endpoint";

const CUSTOM_MODEL_CARD_WIDTH = 280;
const CUSTOM_MODEL_CARD_HEIGHT = 360;

function placeCustomModelCard(anchor: DOMRect): { left: number; top: number } {
  const gap = 8;
  const padding = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = anchor.left - CUSTOM_MODEL_CARD_WIDTH - gap;
  if (left < padding) left = anchor.right + gap;
  if (left + CUSTOM_MODEL_CARD_WIDTH > viewportWidth - padding) {
    left = Math.max(padding, viewportWidth - CUSTOM_MODEL_CARD_WIDTH - padding);
  }
  let top = anchor.top;
  if (top + CUSTOM_MODEL_CARD_HEIGHT > viewportHeight - padding) {
    top = Math.max(padding, viewportHeight - CUSTOM_MODEL_CARD_HEIGHT - padding);
  }
  return { left, top };
}

export function CustomModelEndpointMenu(props: {
  endpoints: CustomModelEndpointPublic[];
  selectedModelId: string;
  formOpen: boolean;
  showForm?: boolean;
  draft: { label: string; baseUrl: string; apiKey: string; model: string };
  error: string;
  saving: boolean;
  onDraftChange: (draft: { label: string; baseUrl: string; apiKey: string; model: string }) => void;
  onOpenForm: () => void;
  onCancel: () => void;
  onSave: () => void;
  onSelect: (endpoint: CustomModelEndpointPublic) => void;
  onDelete: (id: string) => void;
}) {
  const selectedId = props.selectedModelId.trim().toLowerCase();
  const showForm = props.showForm !== false && props.formOpen;
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!showForm) {
      setCardPosition(null);
      return;
    }
    const place = () => {
      const anchors = document.querySelectorAll("[data-testid='composer-custom-model-add']");
      let anchor: HTMLElement | null = null;
      for (const node of anchors) {
        if (!(node instanceof HTMLElement)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) anchor = node;
      }
      if (!anchor) return;
      setCardPosition(placeCustomModelCard(anchor.getBoundingClientRect()));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showForm]);
  return (
    <>
      <div className="composer-reasoning-divider" />
      {props.endpoints.map((endpoint) => {
        const selected = selectedId === endpoint.id.toLowerCase();
        return (
          <div className="composer-custom-model-row" key={endpoint.id}>
            <button type="button" onClick={() => props.onSelect(endpoint)}>
              <strong>{endpoint.label}</strong>
              <span>{selected ? "自备 ✓" : "自备"}</span>
            </button>
            <button type="button" onClick={() => props.onDelete(endpoint.id)}>删除</button>
          </div>
        );
      })}
      <button
        type="button"
        className="composer-custom-model-add"
        data-testid="composer-custom-model-add"
        onClick={props.onOpenForm}
      >
        <strong>＋ 添加自备模型</strong>
      </button>
      {showForm && cardPosition && typeof document !== "undefined" ? createPortal(
        <form
          className="composer-custom-model-card composer-custom-model-card-fixed"
          data-testid="composer-custom-model-card"
          style={{ left: cardPosition.left, top: cardPosition.top, width: CUSTOM_MODEL_CARD_WIDTH }}
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label>
            <span>显示名</span>
            <input
              value={props.draft.label}
              placeholder="DeepSeek"
              onChange={(event) => props.onDraftChange({ ...props.draft, label: event.target.value })}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={props.draft.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={(event) => props.onDraftChange({ ...props.draft, baseUrl: event.target.value })}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              autoComplete="new-password"
              value={props.draft.apiKey}
              placeholder="sk-..."
              onChange={(event) => props.onDraftChange({ ...props.draft, apiKey: event.target.value })}
            />
          </label>
          <label>
            <span>模型 ID</span>
            <input
              value={props.draft.model}
              placeholder="deepseek-chat"
              onChange={(event) => props.onDraftChange({ ...props.draft, model: event.target.value })}
            />
          </label>
          <p>文字对话会直接请求这个地址。图片、视频和语音仍使用官方模型。</p>
          {props.error ? <p className="composer-custom-model-error">{props.error}</p> : null}
          <div className="composer-custom-model-actions">
            <button type="button" onClick={props.onCancel}>取消</button>
            <button type="submit" disabled={props.saving}>{props.saving ? "保存中" : "保存"}</button>
          </div>
        </form>,
        document.body
      ) : null}
    </>
  );
}
