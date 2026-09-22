import type { ThreadContextMenuState } from "./desktop-model";
import { SidebarIcon } from "./SidebarIcon";

interface ThreadContextMenuProps {
  menu: ThreadContextMenuState | null;
  pinnedThreadIds: Set<string>;
  unreadThreadIds: Set<string>;
  onAction: (action: string, workspace: ThreadContextMenuState["workspace"], thread: ThreadContextMenuState["thread"]) => void;
}

export function ThreadContextMenu({ menu, pinnedThreadIds, unreadThreadIds, onAction }: ThreadContextMenuProps) {
  if (!menu) {
    return null;
  }

  const trigger = (action: string) => () => onAction(action, menu.workspace, menu.thread);

  return (
    <div
      className="thread-context-menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 238),
        top: Math.min(menu.y, window.innerHeight - 510)
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={trigger("pin")}>
        <SidebarIcon name="pin" /><span>{pinnedThreadIds.has(menu.thread.id) ? "取消置顶对话" : "置顶对话"}</span><kbd>Ctrl+Alt+P</kbd>
      </button>
      <button type="button" onClick={trigger("rename")}>
        <SidebarIcon name="edit" /><span>重命名对话</span><kbd>Ctrl+Alt+R</kbd>
      </button>
      <button type="button" onClick={trigger("archive")}>
        <SidebarIcon name="archive" /><span>归档对话</span><kbd>Ctrl+Shift+A</kbd>
      </button>
      <div className="thread-context-divider" />
      <button type="button" onClick={trigger("side-chat")}>
        <SidebarIcon name="chat" /><span>打开侧边聊天</span><kbd>Ctrl+Alt+S</kbd>
      </button>
      <button type="button" onClick={trigger("copy-link")}>
        <SidebarIcon name="copy" /><span>复制</span><strong>›</strong>
      </button>
      <button type="button" onClick={trigger("fork-local")}>
        <SidebarIcon name="branch" /><span>分支</span><strong>›</strong>
      </button>
      <button type="button" onClick={trigger("schedule-task")}>
        <SidebarIcon name="automation" /><span>添加计划任务...</span>
      </button>
      <button type="button" onClick={trigger("export-html")}>
        <SidebarIcon name="download" /><span>导出为 HTML</span>
      </button>
      <div className="thread-context-divider" />
      <button type="button" onClick={trigger("new-window")}>
        <SidebarIcon name="copy" /><span>在新窗口中打开</span>
      </button>
    </div>
  );
}
