import type { BrowserHistoryAccessMode } from "./browser-agent-policy.ts";

export type BrowserHistoryAccessAsk = () => Promise<boolean>;

/**
 * Enforce settings → 浏览器 → 历史记录访问.
 * - deny: reject
 * - allow: pass
 * - always_ask: prompt via ask()
 */
export async function assertBrowserHistoryAccess(
  mode: BrowserHistoryAccessMode | undefined,
  ask: BrowserHistoryAccessAsk,
  actionLabel = "访问浏览历史"
): Promise<void> {
  const resolved = mode === "allow" || mode === "deny" || mode === "always_ask" ? mode : "always_ask";
  if (resolved === "allow") return;
  if (resolved === "deny") {
    throw new Error(`已拒绝${actionLabel}。请在设置 → 浏览器中调整「历史记录访问」。`);
  }
  const approved = await ask();
  if (!approved) {
    throw new Error(`用户取消了${actionLabel}。`);
  }
}
