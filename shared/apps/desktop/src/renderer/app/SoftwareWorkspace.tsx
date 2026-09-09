import { useEffect, useMemo, useState } from "react";
import type { BrainFileDto, BrainSoftwareScript, BrainSoftwareTaskState } from "@codex-forge/protocol";

type SoftwareView = "files" | "code" | "terminal" | "test" | "deploy";
interface SoftwareWorkspaceProps { projectId?: string; activeView: SoftwareView; files?: BrainFileDto[]; onOpenFiles?: () => void }
type ProjectTerminalSnapshot = { cwd: string; shell: string; prompt: string; isRunning: boolean; lines: string[] };
const terminalStatuses = new Set<BrainSoftwareTaskState["status"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);
const viewTitles: Record<SoftwareView, string> = { files: "项目文件", code: "代码任务", terminal: "项目终端", test: "测试", deploy: "部署" };

export function SoftwareWorkspace({ projectId, activeView, files = [], onOpenFiles }: SoftwareWorkspaceProps) {
  const [scripts, setScripts] = useState<BrainSoftwareScript[]>([]);
  const [status, setStatus] = useState("正在读取脚本");
  const [task, setTask] = useState<BrainSoftwareTaskState>();
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminal, setTerminal] = useState<ProjectTerminalSnapshot>();
  useEffect(() => {
    setTask(undefined);
    if (!projectId || !window.newbrain?.listSoftwareScripts) { setScripts([]); setStatus("请选择软件项目"); return; }
    setStatus("正在读取项目脚本");
    void window.newbrain.listSoftwareScripts({ projectId }).then((items: BrainSoftwareScript[]) => { setScripts(Array.isArray(items) ? items : []); setStatus("项目已就绪"); }).catch(() => { setScripts([]); setStatus("项目脚本读取失败"); });
  }, [projectId]);
  useEffect(() => {
    if (!task?.id || terminalStatuses.has(task.status) || !window.newbrain?.getSoftwareTaskStatus) return;
    let active = true;
    const timer = window.setInterval(() => void window.newbrain?.getSoftwareTaskStatus({ taskId: task.id }).then((next) => { if (active) setTask(next); }).catch(() => undefined), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (activeView !== "terminal" || !window.newbrain?.getTerminalSession) return;
    let active = true;
    void window.newbrain.getTerminalSession().then((snapshot) => { if (active) setTerminal(snapshot); }).catch(() => undefined);
    const unsubscribe = window.newbrain.onTerminalUpdate?.((snapshot) => { if (active) setTerminal(snapshot); });
    return () => { active = false; unsubscribe?.(); };
  }, [activeView, projectId]);
  const visibleScripts = useMemo(() => scripts.filter((script) => activeView === "test" ? script.operation === "test" : activeView === "deploy" ? script.operation === "deploy" : activeView === "code" ? ["build", "lint", "format"].includes(script.operation) : false), [activeView, scripts]);
  async function run(script: BrainSoftwareScript) {
    if (!projectId || !window.newbrain?.startSoftwareTask) return;
    setStatus("等待系统确认");
    try { const next = await window.newbrain.startSoftwareTask({ projectId, scriptId: script.id }); setTask(next); setStatus(next.status === "RUNNING" ? "正在执行" : next.status); }
    catch (error) { setStatus(error instanceof Error ? error.message : "执行失败"); }
  }
  async function openTerminal() {
    if (!projectId || !window.newbrain?.openSoftwareProjectTerminal) return;
    setTerminalBusy(true); setStatus("正在打开项目终端");
    try {
      await window.newbrain.openSoftwareProjectTerminal({ projectId });
      const snapshot = await window.newbrain.getTerminalSession?.();
      if (snapshot) setTerminal(snapshot);
      setStatus("已在授权项目目录打开终端");
    }
    catch { setStatus("项目终端打开失败"); }
    finally { setTerminalBusy(false); }
  }
  async function submitTerminalInput(input: string, inputElement?: HTMLInputElement | null) {
    if (!input || !terminal?.isRunning || !window.newbrain?.writeTerminalInput) return;
    if (inputElement) inputElement.value = "";
    setStatus("正在发送终端命令");
    try {
      const snapshot = await window.newbrain.writeTerminalInput(`${input}\r\n`);
      setTerminal(snapshot);
      setStatus("终端命令已发送");
    } catch (error) {
      setStatus(error instanceof Error ? `终端命令发送失败：${error.message}` : "终端命令发送失败");
    }
  }
  return <main className="brain-software-module" data-testid={`brain-software-${activeView}`}>
    <header className="brain-video-header"><div><span>软件与自动化</span><strong>{viewTitles[activeView]}</strong></div><small>{status}{["code", "test", "deploy"].includes(activeView) ? " · 脚本执行前需要系统确认" : ""}</small></header>
    {activeView === "files" ? <section className="brain-software-overview"><article><span>已登记项目文件</span><strong>{files.length}</strong><small>文件是跨工作台通用能力，不在软件场景重复存储。</small></article><button type="button" onClick={onOpenFiles}>打开通用文件面板</button></section> : null}
    {activeView === "terminal" ? <section className="brain-software-terminal" data-testid="brain-software-project-terminal">
      <header><div><strong>项目终端</strong><small>{terminal?.isRunning ? "运行中" : "未启动"}</small></div><button type="button" onClick={() => void openTerminal()} disabled={!projectId || terminalBusy}>{terminalBusy ? "启动中…" : terminal?.isRunning ? "重新连接" : "启动终端"}</button></header>
      <p>目录由主进程根据当前授权项目解析，界面不能提交其他工作目录。终端持续运行，直到退出、主动重启或关闭应用。</p>
      <div className="brain-software-terminal-meta"><code>{terminal?.cwd || "请选择已绑定本地目录的软件项目"}</code><span>{terminal?.shell || ""}</span></div>
      <pre data-testid="brain-software-terminal-output">{terminal?.lines?.join("\n") || "启动后将在这里显示实时输出。"}</pre>
      <form onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("command");
        if (input instanceof HTMLInputElement) void submitTerminalInput(input.value, input);
      }}>
        <span>{terminal?.prompt || ">"}</span>
        <input name="command" aria-label="项目终端输入" disabled={!terminal?.isRunning} autoComplete="off" spellCheck={false} />
        <button type="button" disabled={!terminal?.isRunning} onClick={(event) => {
          const input = event.currentTarget.form?.elements.namedItem("command");
          if (input instanceof HTMLInputElement) void submitTerminalInput(input.value, input);
        }}>发送</button>
      </form>
    </section> : null}
    {["code", "test", "deploy"].includes(activeView) ? <section className="brain-software-list">
      {activeView === "deploy" ? <div className="brain-software-deploy-notice">部署会产生外部影响。BRAIN 只显示项目明确声明的 deploy 脚本，每次执行都需要单独确认。</div> : null}
      {visibleScripts.map((script) => <article className="brain-software-card" key={script.id}><div><strong>{script.label}</strong><small>{script.operation} · {script.source}</small></div><code>{script.executable} {script.args.join(" ")}</code><button type="button" onClick={() => void run(script)}>请求执行</button></article>)}
      {!visibleScripts.length ? <div className="brain-resource-empty">项目没有声明对应脚本。请在 package.json 中配置{activeView === "test" ? " test" : activeView === "deploy" ? " deploy" : " build、lint 或 format"}。</div> : null}
    </section> : null}
    {task ? <section className="brain-software-task" aria-label="最近软件任务"><header><strong>最近任务：{task.status}</strong><small>{task.errorCode || "受控执行"}</small></header><pre>{task.output || "等待输出"}</pre>{!terminalStatuses.has(task.status) ? <button type="button" onClick={() => void window.newbrain?.cancelSoftwareTask?.({ taskId: task.id })}>取消任务</button> : null}</section> : null}
  </main>;
}
