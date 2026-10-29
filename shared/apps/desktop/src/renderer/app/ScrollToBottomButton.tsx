/**
 * Codex-style scroll-to-bottom control above the composer.
 * Idle: downward arrow. While the agent is working: three vertical wave dots.
 * Mirrors Codex `ScrollToBottomButton` (`showWorkingDots`).
 */
export type ScrollToBottomButtonProps = {
  show: boolean;
  showWorkingDots?: boolean;
  label?: string;
  onClick: () => void;
  className?: string;
  testId?: string;
};

export function ScrollToBottomButton({
  show,
  showWorkingDots = false,
  label = "回到底部",
  onClick,
  className = "",
  testId = "chat-jump-latest"
}: ScrollToBottomButtonProps) {
  if (!show) return null;
  const working = Boolean(showWorkingDots);
  return (
    <button
      type="button"
      className={`chat-jump-latest${working ? " chat-jump-latest--working" : ""}${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-working={working ? "true" : "false"}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {working ? (
        <span className="chat-jump-latest-dots" aria-hidden="true">
          <span className="chat-jump-latest-dot" />
          <span className="chat-jump-latest-dot" />
          <span className="chat-jump-latest-dot" />
        </span>
      ) : (
        <svg className="chat-jump-latest-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6.75 9.75L12 15l5.25-5.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
