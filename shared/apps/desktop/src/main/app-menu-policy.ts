import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuName } from "@codex-forge/protocol";

export interface AppMenuActions {
  sendCommand: (id: string) => void;
  createWindow: () => void;
  openExternal: (url: string) => void;
  showAbout: () => void;
}

export function resolveAppMenuAccelerator(
  shortcuts: Record<string, string>,
  id: string,
  fallback: string
) {
  return shortcuts[id] || fallback;
}

export function createAppMenuCommand(
  label: string,
  id: string,
  sendCommand: (id: string) => void,
  accelerator?: string
): MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(id) };
}

export function createAppMenuTemplate(
  menu: AppMenuName,
  shortcuts: Record<string, string>,
  actions: AppMenuActions
): MenuItemConstructorOptions[] {
  const accelerator = (id: string, fallback: string) => resolveAppMenuAccelerator(shortcuts, id, fallback);
  const command = (label: string, id: string, shortcut?: string) =>
    createAppMenuCommand(label, id, actions.sendCommand, shortcut);
  const separator: MenuItemConstructorOptions = { type: "separator" };
  const templates: Record<AppMenuName, MenuItemConstructorOptions[]> = {
    file: [
      { label: "New Window", accelerator: "Ctrl+Shift+N", click: actions.createWindow },
      command("New Chat", "new-chat", accelerator("new-chat", "Ctrl+N")),
      command("Quick Chat", "quick-chat", "Ctrl+Alt+N"),
      command("Open Folder...", "open-folder", accelerator("open-folder", "Ctrl+O")),
      { role: "close", label: "Close", accelerator: "Ctrl+W" },
      separator,
      command("Settings...", "settings", accelerator("open-settings", "Ctrl+,")),
      separator,
      command("Log Out", "logout"),
      { role: "quit", label: "Quit", accelerator: "Ctrl+Q" }
    ],
    edit: [
      { role: "undo", label: "Undo", accelerator: "Ctrl+Z" },
      { role: "redo", label: "Redo", accelerator: "Ctrl+Y" },
      separator,
      { role: "cut", label: "Cut", accelerator: "Ctrl+X" },
      { role: "copy", label: "Copy", accelerator: "Ctrl+C" },
      { role: "paste", label: "Paste", accelerator: "Ctrl+V" },
      { role: "delete", label: "Delete" },
      separator,
      { role: "selectAll", label: "Select All", accelerator: "Ctrl+A" }
    ],
    view: [
      command("Toggle Sidebar", "toggle-sidebar", accelerator("toggle-sidebar", "Ctrl+B")),
      command("Toggle Bottom Panel", "toggle-bottom-panel", accelerator("toggle-bottom-panel", "Ctrl+J")),
      command("Toggle File Tree", "toggle-file-tree", accelerator("toggle-file-tree", "Ctrl+Shift+E")),
      command("Open Browser Tab", "open-browser", accelerator("open-browser-tab", "Ctrl+T")),
      { role: "reload", label: "Reload", accelerator: "Ctrl+R" },
      command("Toggle Side Panel", "toggle-side-panel", "Ctrl+Alt+B"),
      command("Find", "find", accelerator("find-in-page", "Ctrl+F")),
      separator,
      command("Previous Chat", "previous-chat", accelerator("previous-thread", "Ctrl+Shift+[")),
      command("Next Chat", "next-chat", accelerator("next-thread", "Ctrl+Shift+]")),
      command("Back", "back", accelerator("back", "Ctrl+[")),
      command("Forward", "forward", accelerator("forward", "Ctrl+]")),
      separator,
      { role: "zoomIn", label: "Zoom In", accelerator: "Ctrl+Shift+=" },
      { role: "zoomOut", label: "Zoom Out", accelerator: "Ctrl+-" },
      { role: "resetZoom", label: "Actual Size", accelerator: accelerator("actual-size", "Ctrl+0") },
      separator,
      { role: "togglefullscreen", label: "Toggle Full Screen", accelerator: accelerator("toggle-fullscreen", "F11") }
    ],
    window: [
      { role: "minimize", label: "Minimize" },
      { role: "zoom", label: "Maximize or Restore" },
      { role: "close", label: "Close" }
    ],
    help: [
      { label: "codeCN Docs", click: () => actions.openExternal("https://developers.openai.com/codex/") },
      { label: "What's New", click: () => actions.openExternal("https://developers.openai.com/codex/changelog/") },
      separator,
      command("Automations", "automations"),
      command("Local Environments", "local-environments"),
      command("Worktrees", "worktrees"),
      command("Skills", "skills"),
      command("Model Context Protocol", "mcp"),
      { label: "Troubleshooting", click: () => actions.openExternal("https://developers.openai.com/codex/troubleshooting/") },
      separator,
      { label: "Send Feedback", click: () => actions.openExternal("https://github.com/openai/codex/issues") },
      command("Keyboard Shortcuts", "shortcuts", "Ctrl+Shift+/"),
      separator,
      { label: "About codeCN", click: actions.showAbout }
    ]
  };
  return templates[menu];
}
