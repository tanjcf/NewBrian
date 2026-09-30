import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  menu: ReactNode;
  activeThread?: { workspaceId: string; threadId: string };
  onNavigateThread: (workspaceId: string, threadId: string) => void;
}

interface ThreadHistoryState {
  entries: Array<{ workspaceId: string; threadId: string }>;
  index: number;
}

export function AppShell({ children, menu, activeThread, onNavigateThread }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [threadHistory, setThreadHistory] = useState<ThreadHistoryState>({ entries: [], index: -1 });
  const pendingNavigationKey = useRef<string | null>(null);

  useEffect(() => {
    const onAppCommand = (event: Event) => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (command === "expand-sidebar") setSidebarCollapsed(false);
      if (command === "collapse-sidebar") setSidebarCollapsed(true);
    };
    window.addEventListener("newbrain:app-command", onAppCommand as EventListener);
    return () => window.removeEventListener("newbrain:app-command", onAppCommand as EventListener);
  }, []);

  useEffect(() => {
    if (!activeThread) return;
    const activeKey = `${activeThread.workspaceId}:${activeThread.threadId}`;
    setThreadHistory((current) => {
      if (pendingNavigationKey.current === activeKey) {
        pendingNavigationKey.current = null;
        return current;
      }
      const currentEntry = current.entries[current.index];
      if (currentEntry && `${currentEntry.workspaceId}:${currentEntry.threadId}` === activeKey) return current;
      const entries = [...current.entries.slice(0, current.index + 1), activeThread];
      return { entries, index: entries.length - 1 };
    });
  }, [activeThread?.workspaceId, activeThread?.threadId]);

  const navigateThreadHistory = (offset: -1 | 1) => {
    const nextIndex = threadHistory.index + offset;
    const target = threadHistory.entries[nextIndex];
    if (!target) return;
    pendingNavigationKey.current = `${target.workspaceId}:${target.threadId}`;
    setThreadHistory((current) => ({ ...current, index: nextIndex }));
    onNavigateThread(target.workspaceId, target.threadId);
  };

  const canGoBack = threadHistory.index > 0;
  const canGoForward = threadHistory.index >= 0 && threadHistory.index < threadHistory.entries.length - 1;

  useEffect(() => {
    const clickSelector = (selector: string) => {
      (document.querySelector(selector) as HTMLElement | null)?.click();
    };
    const clickText = (selector: string, text: string) => {
      const target = [...document.querySelectorAll<HTMLElement>(selector)].find((item) => item.innerText.includes(text));
      target?.click();
    };
    const unsubscribe = window.newbrain?.onAppCommand((command) => {
      if (command === "new-chat" || command === "quick-chat") clickSelector(".feature-nav-item.primary");
      if (command === "open-folder") {
        clickSelector('button[aria-label="添加项目"]');
        window.setTimeout(() => clickText(".project-create-menu button", "使用现有文件夹"), 0);
      }
      if (command === "settings") {
        window.dispatchEvent(new CustomEvent("newbrain:open-settings", { detail: { section: "account" } }));
      }
      if (command === "logout") {
        clickSelector(".sidebar-account-settings");
        window.setTimeout(
          () => clickText(".sidebar-account-menu button", "退出登录"),
          0
        );
      }
      if (command === "toggle-sidebar") setSidebarCollapsed((current) => !current);
      if (command === "toggle-bottom-panel" || command === "toggle-side-panel") clickSelector(".preview-panel-toggle");
      if (command === "toggle-file-tree") clickSelector(".fold-trigger");
      if (command === "open-browser") clickText(".preview-launcher button", "浏览器");
      if (command === "find") clickSelector(".global-search-entry");
      if (command === "previous-chat" || command === "next-chat") {
        const rows = [...document.querySelectorAll<HTMLElement>(".thread-row:not(.muted)")];
        const activeIndex = rows.findIndex((row) => row.classList.contains("active"));
        const offset = command === "previous-chat" ? -1 : 1;
        rows[Math.max(0, Math.min(rows.length - 1, activeIndex + offset))]?.click();
      }
      if (command === "back") navigateThreadHistory(-1);
      if (command === "forward") navigateThreadHistory(1);
      if (command === "automations") clickText(".feature-nav-item", "自动化");
      if (command === "skills") clickText(".feature-nav-item", "技能");
      if (command === "mcp") clickText(".feature-nav-item", "MCP");
      if (command === "worktrees" || command === "local-environments" || command === "shortcuts") {
        const section = command === "worktrees" ? "worktree" : command === "local-environments" ? "environment" : "shortcuts";
        window.dispatchEvent(new CustomEvent("newbrain:open-settings", { detail: { section } }));
      }
    });
    return unsubscribe;
  }, [threadHistory, onNavigateThread]);

  function controlWindow(action: "minimize" | "maximize" | "close") {
    void window.newbrain?.controlWindow(action);
  }

  function showMenu(event: MouseEvent<HTMLButtonElement>, menu: "file" | "edit" | "view" | "window" | "help") {
    const rect = event.currentTarget.getBoundingClientRect();
    void window.newbrain?.showAppMenu({
      menu,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom)
    });
  }

  return (
    <main className={`codex-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <header className="desktop-menu">
        <button
          className="window-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "展开左侧功能栏" : "收起左侧功能栏"}
          title={sidebarCollapsed ? "展开左侧功能栏 (Ctrl+B)" : "收起左侧功能栏 (Ctrl+B)"}
          aria-pressed={sidebarCollapsed}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <rect x="2.5" y="3" width="15" height="14" rx="2.5" />
            <path d="M7 3v14" />
          </svg>
        </button>
        <button
          className={`menu-arrow${canGoBack ? "" : " disabled"}`}
          type="button"
          aria-label="返回上一次点击的线程"
          title="返回上一次点击的线程"
          disabled={!canGoBack}
          onClick={() => navigateThreadHistory(-1)}
        >
          ←
        </button>
        <button
          className={`menu-arrow${canGoForward ? "" : " disabled"}`}
          type="button"
          aria-label="前往下一次点击的线程"
          title="前往下一次点击的线程"
          disabled={!canGoForward}
          onClick={() => navigateThreadHistory(1)}
        >
          →
        </button>
        <nav className="menu-labels" aria-label="Desktop menu">
          <button type="button" onClick={(event) => showMenu(event, "file")}>文件</button>
          <button type="button" onClick={(event) => showMenu(event, "edit")}>编辑</button>
          <button type="button" onClick={(event) => showMenu(event, "view")}>查看</button>
          <button type="button" onClick={(event) => showMenu(event, "window")}>窗口</button>
          <button type="button" onClick={(event) => showMenu(event, "help")}>帮助</button>
        </nav>
        <div className="window-controls" aria-label="窗口控制">
          <button type="button" aria-label="最小化" onClick={() => controlWindow("minimize")}>
            <span aria-hidden="true">−</span>
          </button>
          <button type="button" aria-label="最大化或还原" onClick={() => controlWindow("maximize")}>
            <span aria-hidden="true">□</span>
          </button>
          <button className="close" type="button" aria-label="关闭" onClick={() => controlWindow("close")}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      {children}
      {menu}
    </main>
  );
}
