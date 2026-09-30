/**
 * @deprecated Do not mount. Hardcoded fake document UI.
 * Use DocumentWorkspace for real preview/review.
 */

import { useEffect, useState } from "react";

/** @deprecated Kept only to avoid broken imports; UI must not mount this shell. */
export function DocumentPreviewShell({ projectId }: { projectId?: string }) {
  const [status, setStatus] = useState("此面板已停用：请使用真实文档工作台");

  useEffect(() => {
    setStatus(projectId
      ? "DocumentPreviewShell 已退役。请打开「文稿 / 审校」使用 DocumentWorkspace。"
      : "请先绑定文档工程，再使用 DocumentWorkspace。");
  }, [projectId]);

  return (
    <section className="brain-doc-wb" data-testid="brain-document-preview-retired" aria-label="文档预览（已退役）">
      <header>
        <strong>文档预览（已退役）</strong>
        <small>{status}</small>
      </header>
      <p>产品交付禁止展示假文稿。真实文件、标注与 ChangeSet 请走 DocumentWorkspace。</p>
    </section>
  );
}
