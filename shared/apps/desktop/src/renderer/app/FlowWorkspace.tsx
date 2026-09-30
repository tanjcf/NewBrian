import { useEffect, useMemo, useState } from "react";

const starterDefinition = {
  schemaVersion: 1 as const,
  nodes: [
    { id: "start", type: "start" as const, next: "inspect" },
    { id: "inspect", type: "tool" as const, tool: "software.inspect-scripts", input: {}, next: "approval" },
    { id: "approval", type: "approval" as const, message: "允许继续执行此 Flow？", next: "end" },
    { id: "end", type: "end" as const }
  ],
  maxSteps: 20
};

export function FlowWorkspace({ projectId }: { projectId?: string }) {
  const [name, setName] = useState("项目检查 Flow");
  const [definitionText, setDefinitionText] = useState(() => JSON.stringify(starterDefinition, null, 2));
  const [flow, setFlow] = useState<any>(null);
  const [run, setRun] = useState<any>(null);
  const [status, setStatus] = useState("准备就绪");
  const [busy, setBusy] = useState(false);
  const [runAt, setRunAt] = useState("09:00");
  const [schedules, setSchedules] = useState<any[]>([]);
  const parsedDefinition = useMemo(() => {
    try { return JSON.parse(definitionText); } catch { return null; }
  }, [definitionText]);

  useEffect(() => {
    setFlow(null);
    setRun(null);
    setSchedules([]);
    setStatus(projectId ? "可创建 Flow" : "请选择软件项目");
    if (!projectId || !window.newbrain?.listBrainFlows) return;
    let active = true;
    void (async () => {
      try {
        const flows = await window.newbrain.listBrainFlows({ projectId });
        if (!active || !Array.isArray(flows) || !flows.length) return;
        const latest = flows[0];
        setFlow(latest);
        setName(latest.name);
        setDefinitionText(JSON.stringify(latest.definition, null, 2));
        setStatus("已恢复最近保存的 Flow");
        if (window.newbrain.getLatestBrainFlowRun) {
          const lastRun = await window.newbrain.getLatestBrainFlowRun({ projectId });
          if (active && lastRun) setRun(lastRun);
        }
        if (window.newbrain.listBrainFlowSchedules) {
          const items = await window.newbrain.listBrainFlowSchedules({ projectId });
          if (active) setSchedules(Array.isArray(items) ? items : []);
        }
      } catch {
        if (active) setStatus("Flow 读取失败");
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  async function save() {
    if (!projectId || !window.newbrain?.saveBrainFlow) return;
    if (!parsedDefinition) { setStatus("定义 JSON 无法解析"); return; }
    setBusy(true); setStatus("保存中");
    try {
      const saved = await window.newbrain.saveBrainFlow({ projectId, id: flow?.id, name, definition: parsedDefinition });
      setFlow(saved); setStatus("已保存");
    } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!flow || !window.newbrain?.startBrainFlow) { setStatus("请先保存 Flow"); return; }
    setBusy(true); setStatus("执行中");
    try {
      const result = await window.newbrain.startBrainFlow({ flowId: flow.id });
      setRun(result);
      if (result.status === "SUCCEEDED") setStatus("执行成功");
      else if (result.status === "DECLINED") setStatus("审批已拒绝");
      else if (result.status === "FAILED") setStatus(`执行失败：${result.errorCode || "未知错误"}`);
      else setStatus(`执行结束：${result.status}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "执行失败"); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!run?.id || !window.newbrain?.cancelBrainFlow) return;
    try { setRun(await window.newbrain.cancelBrainFlow({ runId: run.id })); setStatus("已请求取消"); } catch (error) { setStatus(error instanceof Error ? error.message : "取消失败"); }
  }

  async function refreshRun() {
    if (!run?.id || !window.newbrain?.getBrainFlowRun) return;
    try { setRun(await window.newbrain.getBrainFlowRun({ runId: run.id })); } catch { setStatus("运行记录读取失败"); }
  }

  async function createSchedule() {
    if (!projectId || !flow || !window.newbrain?.createBrainFlowSchedule) { setStatus("请先保存 Flow"); return; }
    try {
      await window.newbrain.createBrainFlowSchedule({ projectId, flowId: flow.id, timezone: "Asia/Shanghai", runAt });
      if (window.newbrain.listBrainFlowSchedules) setSchedules(await window.newbrain.listBrainFlowSchedules({ projectId }));
      setStatus("定时调度已保存");
    } catch (error) { setStatus(error instanceof Error ? error.message : "调度保存失败"); }
  }

  const canRetry = run && ["FAILED", "DECLINED", "INTERRUPTED"].includes(run.status);

  return <main className="brain-software-module" data-testid="flow-workspace">
    <header className="brain-video-header"><div><span>软件与自动化</span><strong>Flow 编排</strong></div><small>{status} · 仅执行已注册工具</small></header>
    <section className="brain-flow-editor">
      <label>Flow 名称<input data-testid="flow-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
      <label>节点定义（JSON）<textarea data-testid="flow-definition" value={definitionText} onChange={(event) => setDefinitionText(event.target.value)} spellCheck={false} /></label>
      <label>每日执行时间<input data-testid="flow-schedule-time" type="time" value={runAt} onChange={(event) => setRunAt(event.target.value)} /></label>
      <div className="brain-flow-actions">
        <button type="button" data-testid="flow-save" disabled={busy || !projectId} onClick={() => void save()}>保存 Flow</button>
        <button type="button" data-testid="flow-start" disabled={busy || !flow} onClick={() => void start()}>启动执行</button>
        {canRetry ? <button type="button" data-testid="flow-retry" disabled={busy || !flow} onClick={() => void start()}>重试执行</button> : null}
        <button type="button" data-testid="flow-schedule-create" disabled={!flow} onClick={() => void createSchedule()}>保存每日调度</button>
        {run ? <button type="button" onClick={() => void refreshRun()}>刷新运行</button> : null}
        {run && ["RUNNING", "WAITING_APPROVAL"].includes(run.status) ? <button type="button" data-testid="flow-cancel" onClick={() => void cancel()}>取消运行</button> : null}
      </div>
    </section>
    {flow ? <article className="brain-software-card"><div><strong>{flow.name}</strong><small>Flow ID：{flow.id}</small></div><code>{flow.definition.nodes.length} 个节点 · 有界步数 {flow.definition.maxSteps ?? 100}</code></article> : null}
    {run ? <article className="brain-software-card" data-testid="flow-run"><div><strong>最近运行：{run.status}</strong><small>{run.errorCode || (run.status === "WAITING_APPROVAL" ? "等待主进程审批对话框" : "逐事件检查点已落库")}</small></div><pre>{JSON.stringify(run.audit || [], null, 2)}</pre></article> : null}
    {schedules.length ? <article className="brain-software-card" data-testid="flow-schedules"><strong>已保存调度</strong>{schedules.map((schedule) => <small key={schedule.id}>{schedule.runAt} · {schedule.timezone} · {schedule.enabled ? "启用" : "停用"}</small>)}</article> : null}
  </main>;
}
