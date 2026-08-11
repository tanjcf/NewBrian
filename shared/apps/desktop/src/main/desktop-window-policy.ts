export function createRendererUrlCandidates(value?: string) {
  const url = value?.trim();
  if (!url) return [];
  return [...new Set([
    url,
    url.replace("localhost", "[::1]"),
    url.replace("localhost", "127.0.0.1")
  ])];
}

export function createRendererLoadAttempt(urls: string[], attempt: number) {
  if (!urls.length) return { url: "", nextAttempt: attempt };
  return { url: urls[attempt % urls.length], nextAttempt: attempt + 1 };
}

export function canRetryRendererLoad(urls: string[], attempts: number, maxAttempts = 9) {
  return urls.length > 0 && attempts < maxAttempts;
}

export function controlDesktopWindow(window: ControllableWindow | null | undefined, action: WindowControlAction) {
  if (!window) return { ok: false };
  if (action === "minimize") window.minimize();
  else if (action === "maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
  else window.close();
  return { ok: true };
}

export function shouldHideWindowOnClose(explicitQuit: boolean) {
  // Closing the main window is an explicit user exit. Keeping Electron alive
  // after the window disappears leaves four background processes behind.
  return false;
}

export function computeDesktopWindowBounds(workAreaSize: { width: number; height: number }) {
  const width = Math.max(1, Math.trunc(workAreaSize.width));
  const height = Math.max(1, Math.trunc(workAreaSize.height));
  const horizontalMargin = width >= 1600 ? 120 : width >= 1100 ? 48 : 16;
  const verticalMargin = height >= 1000 ? 96 : height >= 720 ? 48 : 12;
  const initialWidth = Math.max(
    Math.min(720, Math.max(1, width - 16)),
    Math.min(1520, Math.max(1, width - horizontalMargin))
  );
  const initialHeight = Math.max(
    Math.min(560, Math.max(1, height - 16)),
    Math.min(980, Math.max(1, height - verticalMargin))
  );
  // Casting / low-resolution screens often report a short work area; keep the
  // floor low enough that Electron can still open, and let the login page scroll.
  const minWidth = Math.min(initialWidth, Math.max(420, Math.min(720, width - 8)));
  const minHeight = Math.min(initialHeight, Math.max(320, Math.min(560, height - 8)));
  return {
    width: Math.max(1, initialWidth),
    height: Math.max(1, initialHeight),
    minWidth: Math.max(1, minWidth),
    minHeight: Math.max(1, minHeight)
  };
}

export function recordRendererCrash(crashTimes: number[], nowMs: number, windowMs = 60_000, maxRecoveries = 3) {
  const recentCrashTimes = [...crashTimes.filter((time) => nowMs - time <= windowMs), nowMs];
  return {
    crashTimes: recentCrashTimes,
    shouldRecover: recentCrashTimes.length <= maxRecoveries,
    attempt: recentCrashTimes.length
  };
}
import type { WindowControlAction } from "@codex-forge/protocol";

interface ControllableWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  close(): void;
}
