import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  shell,
  type MenuItemConstructorOptions,
  type WebContents
} from "electron";
import { desktopIpcChannels, type DesktopPreferences, type ShowAppMenuInput } from "@codex-forge/protocol";
import { createAppMenuTemplate } from "./app-menu-policy.js";
import { resolveElectronAppVersion } from "./resolve-app-version.js";

export interface AppMenuServiceDependencies {
  getMainWindow: () => BrowserWindow | null;
  createWindow: () => void;
  getPreferences: () => Promise<DesktopPreferences>;
}

/** Owns native popup menus so IPC assembly never carries Electron menu behavior. */
export class AppMenuService {
  constructor(private readonly dependencies: AppMenuServiceDependencies) {}

  showInputContextMenu(sender: WebContents) {
    const window = BrowserWindow.fromWebContents(sender) ?? this.dependencies.getMainWindow();
    if (!window) return { ok: false };
    const menu = Menu.buildFromTemplate([
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" }
    ]);
    menu.popup({ window });
    return { ok: true };
  }

  async showAppMenu(sender: WebContents, input: ShowAppMenuInput) {
    const window = BrowserWindow.fromWebContents(sender) ?? this.dependencies.getMainWindow();
    if (!window) return { ok: false };

    const sendCommand = (id: string) => {
      const mainWindow = this.dependencies.getMainWindow();
      const targetWindow = window.isDestroyed() ? mainWindow : window;
      const targetContents = targetWindow && !targetWindow.isDestroyed() ? targetWindow.webContents : sender;
      if (!targetContents.isDestroyed()) targetContents.send(desktopIpcChannels.window.appCommand, id);
    };
    const shortcuts = (await this.dependencies.getPreferences()).shortcuts;
    const template = createAppMenuTemplate(input.menu, shortcuts, {
      sendCommand,
      createWindow: this.dependencies.createWindow,
      openExternal: (url) => { void shell.openExternal(url); },
      showAbout: () => {
        void dialog.showMessageBox(window, {
          type: "info",
          title: "关于 NewBrain",
          message: "NewBrain",
          detail: `版本 ${resolveElectronAppVersion(app)}\n面向 Windows 的智能编程协作桌面应用。`
        });
      },
      controlWindow: (action) => {
        if (window.isDestroyed()) return;
        if (action === "minimize") {
          window.minimize();
          return;
        }
        if (action === "maximize") {
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          return;
        }
        window.close();
      }
    });
    const popup = Menu.buildFromTemplate(template);
    return new Promise<{ ok: boolean }>((resolve) => {
      popup.popup({
        window,
        x: Math.round(input.x),
        y: Math.round(input.y),
        callback: () => resolve({ ok: true })
      });
    });
  }
}

export function setupAppMenu(window: BrowserWindow) {
  const template: Array<MenuItemConstructorOptions> = [
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出" }]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "查看",
      submenu: [
        {
          label: "后退",
          accelerator: "Alt+Left",
          enabled: window.webContents.canGoBack(),
          click: () => {
            if (window.webContents.canGoBack()) window.webContents.goBack();
          }
        },
        {
          label: "前进",
          accelerator: "Alt+Right",
          enabled: window.webContents.canGoForward(),
          click: () => {
            if (window.webContents.canGoForward()) window.webContents.goForward();
          }
        },
        { type: "separator" },
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "toggleDevTools", label: "开发者工具" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭" }
      ]
    },
    {
      label: "帮助",
      submenu: [{ role: "about", label: "关于 NewBrain" }]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(menu);
  } else {
    // Renderer already renders a custom menu bar; avoid duplicating it on Windows/Linux.
    Menu.setApplicationMenu(null);
    window.setMenuBarVisibility(false);
    window.setAutoHideMenuBar(true);
  }

  const refreshNavItems = () => {
    const currentMenu = Menu.getApplicationMenu();
    if (!currentMenu) return;
    const viewMenu = currentMenu.items.find((item) => item.label === "查看");
    if (!viewMenu?.submenu) return;
    const backItem = viewMenu.submenu.items.find((item) => item.label === "后退");
    const forwardItem = viewMenu.submenu.items.find((item) => item.label === "前进");
    if (backItem) backItem.enabled = window.webContents.canGoBack();
    if (forwardItem) forwardItem.enabled = window.webContents.canGoForward();
  };

  window.webContents.on("did-navigate", refreshNavItems);
  window.webContents.on("did-navigate-in-page", refreshNavItems);
}
