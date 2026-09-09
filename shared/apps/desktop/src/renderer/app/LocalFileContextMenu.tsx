import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SystemToolState } from "./desktop-model";
import type { LocalFileReference } from "./local-file-link";

export type LocalFileMenuState = {
  x: number;
  y: number;
  reference: LocalFileReference;
};

export function positionLocalFileMenu(element: HTMLElement, reference: LocalFileReference, point?: { x: number; y: number }): LocalFileMenuState {
  const bounds = element.getBoundingClientRect();
  const menuWidth = 224;
  const menuHeight = 300;
  const gap = 6;
  const x = Math.min(Math.max(8, point?.x ?? bounds.left), Math.max(8, window.innerWidth - menuWidth - 8));
  const belowY = (point?.y ?? bounds.bottom) + gap;
  const y = belowY + menuHeight <= window.innerHeight - 8
    ? belowY
    : Math.max(8, bounds.top - menuHeight - gap);
  return { x, y, reference };
}

export function LocalFileContextMenu({ menu, workspaceId, onClose }: {
  menu: LocalFileMenuState;
  workspaceId: string;
  onClose: () => void;
}) {
  const [systemTools, setSystemTools] = useState<SystemToolState[]>([]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void window.newbrain?.getSystemTools().then((tools) => { if (active) setSystemTools(tools); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const performFileAction = async (action: "open-vscode" | "open-with" | "copy-contents" | "reveal") => {
    if (!window.newbrain) return;
    try {
      const result = await window.newbrain.performWorkspaceFileAction({ workspaceId, filePath: menu.reference.filePath, action });
      if (action === "copy-contents" && result.ok && typeof result.content === "string") await navigator.clipboard.writeText(result.content);
    } catch {
      // Soft-fail: missing files must not crash the renderer ErrorBoundary.
    } finally {
      onClose();
    }
  };

  const openWithSystemTool = async (tool: SystemToolState) => {
    if (!window.newbrain) return;
    try {
      await window.newbrain.performWorkspaceFileAction({ workspaceId, filePath: menu.reference.filePath, action: "open-tool", toolId: tool.id });
    } catch {
      // Soft-fail: missing files must not crash the renderer ErrorBoundary.
    } finally {
      onClose();
    }
  };

  const visualStudio = systemTools.find((tool) => tool.id === "vscode" && tool.available);
  const availableTools = systemTools.filter((tool) => tool.available);

  const menuElement = <div className="markdown-file-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
    {visualStudio ? <button type="button" role="menuitem" onClick={() => void openWithSystemTool(visualStudio)}>在 Visual Studio 中打开</button> : null}
    <div className="markdown-file-context-submenu">
      <button type="button" role="menuitem"><span>打开方式</span><strong>›</strong></button>
      <div className="markdown-file-context-submenu-panel">
        {availableTools.map((tool) => <button type="button" role="menuitem" key={tool.id} onClick={() => void openWithSystemTool(tool)}>
          <i className={`system-tool-menu-icon ${tool.kind}`}>{tool.icon}</i><span>{tool.label}</span>
        </button>)}
        {!availableTools.length ? <span className="system-tool-menu-empty">未检测到可用工具</span> : null}
      </div>
    </div>
    <div className="markdown-file-context-divider" />
    <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.reference.filePath); onClose(); }}>复制路径</button>
    <button type="button" role="menuitem" onClick={() => void performFileAction("copy-contents")}>复制文件内容</button>
    <button type="button" role="menuitem" onClick={() => void performFileAction("reveal")}>在资源管理器中打开</button>
  </div>;
  return typeof document === "undefined" ? menuElement : createPortal(menuElement, document.body);
}
