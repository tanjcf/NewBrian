export const desktopWindowControlIpcChannels = {
  list: "desktop-window-control:list",
  activate: "desktop-window-control:activate",
  click: "desktop-window-control:click",
  typeText: "desktop-window-control:type-text",
  screenshot: "desktop-window-control:screenshot"
} as const;

export interface DesktopWindowTarget {
  processId?: number;
  processName?: string;
  windowTitle?: string;
}

export interface DesktopWindowInfo {
  processId: number;
  processName: string;
  title: string;
  handle: number;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface DesktopWindowClickInput extends DesktopWindowTarget {
  name?: string;
  automationId?: string;
  x?: number;
  y?: number;
}

export interface DesktopWindowTypeTextInput extends DesktopWindowClickInput {
  text: string;
}

export interface DesktopWindowControlApi {
  list: () => Promise<DesktopWindowInfo[]>;
  activate: (input: DesktopWindowTarget) => Promise<{ activated: true; targetWindow: number }>;
  click: (input: DesktopWindowClickInput) => Promise<Record<string, unknown>>;
  typeText: (input: DesktopWindowTypeTextInput) => Promise<Record<string, unknown>>;
  screenshot: (input: DesktopWindowTarget) => Promise<{ outputPath: string }>;
}
