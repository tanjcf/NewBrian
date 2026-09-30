import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuName } from "@codex-forge/protocol";

export interface AppMenuActions {
  sendCommand: (id: string) => void;
  createWindow: () => void;
  openExternal: (url: string) => void;
  showAbout: () => void;
  controlWindow: (action: "minimize" | "maximize" | "close") => void;
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
      { label: "新建窗口", accelerator: "Ctrl+Shift+N", click: actions.createWindow },
      command("新建对话", "new-chat", accelerator("new-chat", "Ctrl+N")),
      command("快速对话", "quick-chat", "Ctrl+Alt+N"),
      command("打开文件夹...", "open-folder", accelerator("open-folder", "Ctrl+O")),
      { role: "close", label: "关闭", accelerator: "Ctrl+W" },
      separator,
      command("设置...", "settings", accelerator("open-settings", "Ctrl+,")),
      separator,
      command("退出登录", "logout"),
      { role: "quit", label: "退出", accelerator: "Ctrl+Q" }
    ],
    edit: [
      { role: "undo", label: "撤销", accelerator: "Ctrl+Z" },
      { role: "redo", label: "重做", accelerator: "Ctrl+Y" },
      separator,
      { role: "cut", label: "剪切", accelerator: "Ctrl+X" },
      { role: "copy", label: "复制", accelerator: "Ctrl+C" },
      { role: "paste", label: "粘贴", accelerator: "Ctrl+V" },
      { role: "delete", label: "删除" },
      separator,
      { role: "selectAll", label: "全选", accelerator: "Ctrl+A" }
    ],
    view: [
      command("切换侧边栏", "toggle-sidebar", accelerator("toggle-sidebar", "Ctrl+B")),
      command("切换底部面板", "toggle-bottom-panel", accelerator("toggle-bottom-panel", "Ctrl+J")),
      command("切换文件树", "toggle-file-tree", accelerator("toggle-file-tree", "Ctrl+Shift+E")),
      command("打开浏览器标签", "open-browser", accelerator("open-browser-tab", "Ctrl+T")),
      { role: "reload", label: "重新加载页面", accelerator: "Ctrl+R" },
      command("切换右侧面板", "toggle-side-panel", "Ctrl+Alt+B"),
      command("查找", "find", accelerator("find-in-page", "Ctrl+F")),
      separator,
      command("上一个对话", "previous-chat", accelerator("previous-thread", "Ctrl+Shift+[")),
      command("下一个对话", "next-chat", accelerator("next-thread", "Ctrl+Shift+]")),
      command("后退", "back", accelerator("back", "Ctrl+[")),
      command("前进", "forward", accelerator("forward", "Ctrl+]")),
      separator,
      { role: "zoomIn", label: "放大", accelerator: "Ctrl+Shift+=" },
      { role: "zoomOut", label: "缩小", accelerator: "Ctrl+-" },
      { role: "resetZoom", label: "实际大小", accelerator: accelerator("actual-size", "Ctrl+0") },
      separator,
      { role: "togglefullscreen", label: "切换全屏", accelerator: accelerator("toggle-fullscreen", "F11") }
    ],
    window: [
      { label: "最小化", click: () => actions.controlWindow("minimize") },
      { label: "最大化或还原", click: () => actions.controlWindow("maximize") },
      { label: "关闭", click: () => actions.controlWindow("close") }
    ],
    help: [
      { label: "NewBrain 文档", click: () => actions.openExternal("https://developers.openai.com/codex/") },
      { label: "新增功能", click: () => actions.openExternal("https://developers.openai.com/codex/changelog/") },
      separator,
      command("自动化", "automations"),
      command("本地环境", "local-environments"),
      command("工作树", "worktrees"),
      command("技能", "skills"),
      command("模型上下文协议", "mcp"),
      { label: "故障排除", click: () => actions.openExternal("https://developers.openai.com/codex/troubleshooting/") },
      separator,
      { label: "发送反馈", click: () => actions.openExternal("https://github.com/openai/codex/issues") },
      command("键盘快捷键", "shortcuts", "Ctrl+Shift+/"),
      separator,
      { label: "关于 NewBrain", click: actions.showAbout }
    ]
  };
  return templates[menu];
}
