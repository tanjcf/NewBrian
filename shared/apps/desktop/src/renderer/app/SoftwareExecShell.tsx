/**
 * @deprecated Do not mount in WorkspaceModules.
 * Fake terminal / Flow UI that printed "前端演示" instead of executing.
 * Use SoftwareWorkspace (terminal/code/test/deploy) and FlowWorkspace.
 */
import { useEffect, useRef, useState } from "react";

type SoftwarePane = "diff" | "term" | "flow";
type ExecSnapshot = { accepted: boolean; flowApproved: boolean; terminalLines: string[] };

function parseExecSnapshot(content: string): ExecSnapshot | undefined {
  try {
    const value = JSON.parse(content) as Partial<ExecSnapshot>;
    if (typeof value.accepted !== "boolean" || typeof value.flowApproved !== "boolean") return undefined;
    if (!Array.isArray(value.terminalLines) || !value.terminalLines.every((line) => typeof line === "string")) return undefined;
    return {
      accepted: value.accepted,
      flowApproved: value.flowApproved,
      terminalLines: value.terminalLines
    };
  } catch {
    return undefined;
  }
}

const paneLabels: Record<SoftwarePane, string> = {
  diff: "Diff",
  term: "终端",
  flow: "Flow"
};

/** @deprecated Kept only to avoid broken imports; UI must not mount this shell. */
export function SoftwareExecShell({
  projectId,
  activePane = "diff"
}: {
  projectId?: string;
  activePane?: SoftwarePane;
}) {
  const pane = activePane;
  const [status, setStatus] = useState("此面板已停用：请使用真实软件终端 / Flow");
  const revisionRef = useRef(0);

  useEffect(() => {
    revisionRef.current = 0;
    setStatus("SoftwareExecShell 已退役。终端请用 SoftwareWorkspace，Flow 请用 FlowWorkspace。");
  }, [projectId, pane]);

  return (
    <section className="brain-sw-exec" data-testid="brain-software-exec-retired" aria-label={paneLabels[pane]}>
      <header>
        <strong>{paneLabels[pane]}（已退役）</strong>
        <small>{status}</small>
      </header>
      <p>产品交付禁止使用演示终端。请从场景 Tab 打开「终端 / 代码 / 测试 / 部署 / Flow」。</p>
    </section>
  );
}

// Retain parse helper for any persisted snapshot readers in tests.
export const __testOnlyParseExecSnapshot = parseExecSnapshot;
