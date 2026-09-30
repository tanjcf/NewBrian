import { Menu, Tray } from "electron";
import type { WorkspaceCatalogItem } from "@codex-forge/protocol";

export class DesktopTrayService {
  private tray: Tray | null = null;

  constructor(private readonly dependencies: {
    iconPath: string;
    readWorkspaces: () => Promise<WorkspaceCatalogItem[]>;
    showWindow: () => void;
    openThread: (workspaceId: string, threadId: string) => Promise<void>;
    createTask: () => void;
    quit: () => void;
  }) {}

  create() {
    if (this.tray && !this.tray.isDestroyed()) return this.tray;
    // Prefer a path (especially multi-size .ico on Windows) so the shell can
    // pick 16/20/24/32 bitmaps instead of downscaling a single 256 PNG.
    const tray = new Tray(this.dependencies.iconPath);
    tray.setToolTip("NewBrain — 后台运行中");
    tray.on("double-click", this.dependencies.showWindow);
    tray.on("right-click", () => { void this.buildMenu().then((menu) => tray.popUpContextMenu(menu)); });
    this.tray = tray;
    return tray;
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }

  private async buildMenu() {
    const entries = (await this.dependencies.readWorkspaces())
      .flatMap((workspace) => workspace.threads.map((thread) => ({ workspace, thread })));
    const running = entries.filter(({ thread }) => thread.status === "running").slice(0, 5);
    const recent = entries.filter(({ thread }) => thread.status !== "running")
      .sort((a, b) => new Date(b.thread.updatedAt).getTime() - new Date(a.thread.updatedAt).getTime()).slice(0, 5);
    const items = (values: typeof entries) => values.map(({ workspace, thread }) => ({
      label: thread.title || "未命名任务", sublabel: workspace.name,
      click: () => { void this.dependencies.openThread(workspace.id, thread.id); }
    }));
    return Menu.buildFromTemplate([
      { label: "运行中", enabled: false },
      ...(running.length ? items(running) : [{ label: "暂无运行任务", enabled: false }]),
      { type: "separator" }, { label: "最近任务", enabled: false },
      ...(recent.length ? items(recent) : [{ label: "暂无最近任务", enabled: false }]),
      { type: "separator" }, { label: "新建任务", click: this.dependencies.createTask },
      { label: "打开 NewBrain", click: this.dependencies.showWindow }, { type: "separator" },
      { label: "退出", click: this.dependencies.quit }
    ]);
  }
}
