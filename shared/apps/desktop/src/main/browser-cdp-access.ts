/**
 * Full CDP access gate for Browser Use (Codex-aligned developer mode).
 * Default off; enabling raises risk and requires an explicit preference.
 */

export interface BrowserCdpAccessState {
  enabled: boolean;
  partition: string;
  detail: string;
}

export function resolveBrowserCdpAccess(input: {
  fullCdpAccess: boolean;
  partition?: string;
}): BrowserCdpAccessState {
  const partition = input.partition || "persist:newbrain-browser";
  if (!input.fullCdpAccess) {
    return {
      enabled: false,
      partition,
      detail: "完整 CDP 已关闭。在设置 → 浏览器 → 开发者模式中开启（风险升高）。"
    };
  }
  return {
    enabled: true,
    partition,
    detail: "完整 CDP 已启用。调试管道仅限本机已批准会话，勿向模型暴露原始 DevTools 通道。"
  };
}

/**
 * Attach Electron debugger only when full CDP is enabled.
 * Returns a narrow status object — never a raw CDP endpoint URL for model tools.
 */
export async function attachBrowserCdpIfAllowed(input: {
  fullCdpAccess: boolean;
  webContents: { debugger: { isAttached: () => boolean; attach: (protocolVersion?: string) => void } };
  partition?: string;
}): Promise<BrowserCdpAccessState> {
  const state = resolveBrowserCdpAccess({
    fullCdpAccess: input.fullCdpAccess,
    partition: input.partition
  });
  if (!state.enabled) return state;
  try {
    if (!input.webContents.debugger.isAttached()) {
      input.webContents.debugger.attach("1.3");
    }
    return { ...state, detail: `${state.detail} Debugger attached.` };
  } catch (error) {
    return {
      ...state,
      enabled: false,
      detail: `CDP attach failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
