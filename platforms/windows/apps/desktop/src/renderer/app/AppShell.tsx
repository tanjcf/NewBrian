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
    const dispatchAppCommand = (command: string) => {
      window.dispatchEvent(new CustomEvent("newbrain:app-command", { detail: { command } }));
    };
    const unsubscribe = window.newbrain?.onAppCommand((command) => {
      if (command === "new-chat" || command === "quick-chat" || command === "open-folder" || command === "logout" || command === "toggle-bottom-panel" || command === "toggle-side-panel" || command === "open-browser" || command === "find" || command === "automations" || command === "skills" || command === "mcp") {
        dispatchAppCommand(command);
        return;
      }
      if (command === "settings") {
        window.dispatchEvent(new CustomEvent("newbrain:open-settings", { detail: { section: "account" } }));
      }
      if (command === "toggle-sidebar") setSidebarCollapsed((current) => !current);
      if (command === "toggle-file-tree") dispatchAppCommand(command);
      if (command === "previous-chat" || command === "next-chat") {
        const rows = [...document.querySelectorAll<HTMLElement>(".thread-row:not(.muted)")];
        const activeIndex = rows.findIndex((row) => row.classList.contains("active"));
        const offset = command === "previous-chat" ? -1 : 1;
        rows[Math.max(0, Math.min(rows.length - 1, activeIndex + offset))]?.click();
      }
      if (command === "back") navigateThreadHistory(-1);
      if (command === "forward") navigateThreadHistory(1);
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
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          title={sidebarCollapsed ? "展开侧边栏 (Ctrl+B)" : "收起侧边栏 (Ctrl+B)"}
          aria-pressed={sidebarCollapsed}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <rect x="2.5" y="3" width="15" height="14" rx="2.5" />
            <path d="M7 3v14" />
          </svg>
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
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
              <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" aria-label="最大化或还原" onClick={() => controlWindow("maximize")}>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
              <rect x="4" y="4" width="8" height="8" rx="0.8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <button className="close" type="button" aria-label="关闭" onClick={() => controlWindow("close")}>
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {children}
      {menu}
    </main>
  );
}
