import { useEffect, useState } from "react";
import { resolveThinkingPanelOpen } from "./assistant-thinking-policy";

export type ThinkingProcessStep = { title: string; detail?: string };

export type AssistantThinkingPanelProps = {
  text: string;
  processSteps?: ThinkingProcessStep[];
  /** Live streaming turn (show progress chrome). */
  live?: boolean;
  /** True when the assistant answer body already has visible content. */
  hasAnswer?: boolean;
  statusLabel?: string;
  elapsedLabel?: string;
  testId?: string;
};

export { resolveThinkingPanelOpen } from "./assistant-thinking-policy";

export function AssistantThinkingPanel({
  text,
  processSteps = [],
  live = false,
  hasAnswer = false,
  statusLabel,
  elapsedLabel,
  testId = "assistant-thinking-panel"
}: AssistantThinkingPanelProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const autoForceOpen = live && !hasAnswer;

  useEffect(() => {
    // While waiting for the first answer token, drop any manual collapse so
    // the panel stays visible and does not look like a hung request.
    if (autoForceOpen) setUserOpen(null);
  }, [autoForceOpen]);

  const open = resolveThinkingPanelOpen({ live, hasAnswer, userOpen });
  const label = statusLabel
    || (live ? (hasAnswer ? "思考过程" : "正在思考") : "思考过程");
  const canToggle = !(live && !hasAnswer);

  return (
    <div
      className={`assistant-thinking-panel${live ? " live" : ""}${open ? " open" : " collapsed"}${hasAnswer ? " has-answer" : ""}`}
      data-testid={testId}
      data-open={open ? "true" : "false"}
      data-live={live ? "true" : "false"}
    >
      <button
        type="button"
        className="assistant-thinking-toggle"
        data-testid={`${testId}-toggle`}
        aria-expanded={open}
        disabled={!canToggle}
        title={canToggle ? (open ? "折叠思考内容" : "展开思考内容") : "输出出现前会保持展开"}
        onClick={() => {
          if (!canToggle) return;
          setUserOpen(!open);
        }}
      >
        <span className="assistant-thinking-label">
          {label}
          {elapsedLabel ? <em>{elapsedLabel}</em> : null}
        </span>
        <span className="assistant-thinking-hint">
          {canToggle ? (open ? "收起" : "展开") : "进行中"}
        </span>
      </button>
      {open ? (
        <div className="assistant-thinking-body" data-testid={`${testId}-body`}>
          <div className="assistant-live-thinking-text" data-testid="reasoning-summary-text">
            {text}
          </div>
          {processSteps.length ? (
            <div className="assistant-live-process-list" data-testid="reasoning-process-list">
              {processSteps.map((step, stepIndex) => (
                <div className="assistant-live-process-item" key={`${step.title}-${stepIndex}`}>
                  <strong>{step.title}</strong>
                  {step.detail ? <span>{step.detail}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
