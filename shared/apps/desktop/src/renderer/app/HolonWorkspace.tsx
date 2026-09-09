import { useEffect, useRef, useState } from "react";
import type {
  HolonKnowledgeSearchResult,
  HolonKnowledgeSnapshot,
  HolonLearningCandidate,
  HolonSyncStatus,
  HolonWorkItemView
} from "@codex-forge/protocol";

type HolonTab = "tasks" | "snapshot" | "candidates" | "knowledge" | "sync";

export function HolonWorkspace({ threadId }: { threadId?: string }) {
  const api = window.newbrain;
  const [tab, setTab] = useState<HolonTab>("tasks");
  const [workItem, setWorkItem] = useState<HolonWorkItemView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [snapshotId, setSnapshotId] = useState("");
  const [snapshot, setSnapshot] = useState<HolonKnowledgeSnapshot | null>(null);
  const [candidates, setCandidates] = useState<HolonLearningCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [knowledge, setKnowledge] = useState<HolonKnowledgeSearchResult[]>([]);
  const [syncStatus, setSyncStatus] = useState<HolonSyncStatus | null>(null);
  const [rollbackSkillKey, setRollbackSkillKey] = useState("");
  const [rollbackVersionId, setRollbackVersionId] = useState("");
  const [feedbackSkillKey, setFeedbackSkillKey] = useState("");
  const [feedbackVersionId, setFeedbackVersionId] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<-1 | 0 | 1>(0);
  const [feedbackSafetyViolation, setFeedbackSafetyViolation] = useState(false);
  const [feedbackKey, setFeedbackKey] = useState(() => crypto.randomUUID());
  const feedbackSubmittingRef = useRef(false);
  const [governanceConfirmation, setGovernanceConfirmation] = useState<null | { kind: "approve" | "reject"; versionId: string } | { kind: "rollback" }>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setNotice("");
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  };

  useEffect(() => {
    if (tab !== "sync" || !api?.getHolonSyncStatus) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const value = await api.getHolonSyncStatus();
        if (!disposed) setSyncStatus(value);
      } catch (error) {
        if (!disposed) setNotice(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api, tab]);

  useEffect(() => {
    if (!workItem?.workItem.id || !api?.getWorkItemState
      || !["running", "waiting_approval"].includes(workItem.status)) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const value = await api.getWorkItemState({ workItemId: workItem.workItem.id });
        if (!disposed && value) setWorkItem(value);
      } catch {
        // The owning start request reports terminal errors; polling only projects live state.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 250);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api, workItem?.status, workItem?.workItem.id]);

  const claimNext = () => run("claim", async () => {
    if (!api?.getNextWorkItem) throw new Error("Holon 服务尚未就绪。");
    const item = await api.getNextWorkItem();
    setWorkItem(item);
    setConfirming(false);
    setNotice(item ? "任务已领取，等待本机用户确认。" : "当前没有待领取任务。");
  });

  const start = () => run("start", async () => {
    if (!api?.startWorkItem || !workItem || !threadId) throw new Error("请先选择一个本地对话线程。");
    const startingWorkItem = workItem;
    setConfirming(false);
    // startWorkItem remains pending for the whole agent run. Project running now so
    // polling can surface a tool approval while that IPC request is still pending.
    setWorkItem({ ...startingWorkItem, status: "running" });
    try {
      const value = await api.startWorkItem({
        workItemId: startingWorkItem.workItem.id,
        threadId,
        turnId: crypto.randomUUID()
      });
      setWorkItem(value);
      setNotice(value.status === "completed" ? "远程任务已完成。" : `任务状态：${value.status}`);
    } catch (error) {
      const current = api.getWorkItemState
        ? await api.getWorkItemState({ workItemId: startingWorkItem.workItem.id }).catch(() => null)
        : null;
      setWorkItem(current ?? startingWorkItem);
      throw error;
    }
  });

  const cancel = () => run("cancel", async () => {
    if (!api?.cancelWorkItem || !workItem) throw new Error("没有可放弃的远程任务。");
    const value = await api.cancelWorkItem({ workItemId: workItem.workItem.id });
    setWorkItem(value);
    setConfirming(false);
    setNotice(value?.status === "cancelled" ? "远程任务已放弃。" : "已请求停止远程任务。");
  });

  const respondApproval = (approved: boolean) => run("approval", async () => {
    if (!api?.respondApproval || !workItem) throw new Error("Holon 审批服务尚未就绪。");
    await api.respondApproval({ requestId: `holon-${workItem.workItem.id}`, approved });
  });

  const loadCandidates = () => run("candidates", async () => {
    if (!api?.listLearningCandidates) throw new Error("学习服务尚未就绪。");
    setCandidates(await api.listLearningCandidates({ limit: 50 }));
  });

  return <section className="holon-workspace" aria-label="Holon 工作台">
    <header className="holon-header">
      <div><h1>Holon</h1><p>远程任务、本地执行与私有学习控制面</p></div>
      <span className={`holon-connection ${syncStatus?.online ? "online" : ""}`}>{syncStatus?.online ? "已连接" : "本地可用"}</span>
    </header>
    <nav className="holon-tabs" aria-label="Holon 视图">
      {([
        ["tasks", "远程任务"], ["snapshot", "知识快照"], ["candidates", "学习候选"],
        ["knowledge", "私有知识"], ["sync", "同步与反馈"]
      ] as Array<[HolonTab, string]>).map(([id, label]) =>
        <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {notice ? <div className="holon-notice" role="status">{notice}</div> : null}

    {tab === "tasks" ? <div className="holon-pane">
      <div className="holon-toolbar"><button type="button" onClick={() => void claimNext()} disabled={Boolean(busy)}>刷新并领取</button></div>
      {!workItem ? <div className="holon-empty">没有已领取的远程任务</div> : <article className="holon-work-item">
        <div><span>{workItem.workItem.source}</span><strong>{workItem.workItem.objective}</strong><small>{workItem.workItem.id}</small></div>
        <dl>
          <dt>本地状态</dt><dd>{workItem.status}</dd>
          <dt>租约截止</dt><dd>{new Date(workItem.workItem.leaseUntil).toLocaleString()}</dd>
          <dt>知识快照</dt><dd>{workItem.workItem.knowledgeSnapshotId || "未绑定"}</dd>
          <dt>执行策略</dt><dd>{workItem.workItem.executionPolicyVersion}</dd>
          <dt>有效工具</dt><dd>{workItem.effectiveToolNames.length ? workItem.effectiveToolNames.join("、") : "无"}</dd>
        </dl>
        {(workItem.status === "claimed" || workItem.status === "interrupted") && !confirming ? <div className="holon-work-actions">
          <button className="primary" type="button" onClick={() => setConfirming(true)} disabled={!threadId}>
            {workItem.status === "interrupted" ? "恢复执行" : "准备执行"}
          </button>
          <button type="button" onClick={() => void cancel()} disabled={busy === "cancel"}>放弃任务</button>
        </div> : null}
        {(workItem.status === "running" || workItem.status === "waiting_approval") ? (
          <button type="button" onClick={() => void cancel()} disabled={busy === "cancel"}>停止执行</button>
        ) : null}
        {workItem.status === "waiting_approval" ? <div className="holon-confirm holon-approval" role="dialog" aria-label="Holon 工具审批" data-testid="approval-dialog">
          <p>当前远程任务请求执行本地工具，请确认是否继续。</p>
          <button type="button" data-testid="approval-reject-button" onClick={() => void respondApproval(false)} disabled={busy === "approval"}>拒绝</button>
          <button className="primary" type="button" data-testid="approval-approve-button" onClick={() => void respondApproval(true)} disabled={busy === "approval"}>批准并继续</button>
        </div> : null}
        {confirming && (workItem.status === "claimed" || workItem.status === "interrupted") ? <div className="holon-confirm" role="alertdialog" aria-label="确认执行远程任务">
          <p>确认后将在当前线程执行。所有本地工具权限和高风险操作审批仍然生效。</p>
          <button type="button" onClick={() => setConfirming(false)}>取消</button>
          <button className="primary" type="button" onClick={() => void start()} disabled={busy === "start"}>确认执行</button>
        </div> : null}
      </article>}
    </div> : null}

    {tab === "snapshot" ? <div className="holon-pane">
      <form className="holon-search" onSubmit={(event) => { event.preventDefault(); void run("snapshot", async () => {
        if (!api?.getKnowledgeSnapshot) throw new Error("知识服务尚未就绪。");
        setSnapshot(await api.getKnowledgeSnapshot({ snapshotId }));
      }); }}><input value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} placeholder="知识快照 ID" /><button type="submit">加载</button></form>
      {snapshot ? <div className="holon-list"><h2>第 {snapshot.generation} 代 · {snapshot.itemCount} 项</h2>{snapshot.items.map((item) =>
        <article key={`${item.skillKey}:${item.versionId}`}><strong>{item.skillKey}</strong><small>{item.versionId}</small><pre>{item.contentJson}</pre></article>)}</div> : <div className="holon-empty">输入快照 ID 查看不可变知识内容</div>}
    </div> : null}

    {tab === "candidates" ? <div className="holon-pane">
      <div className="holon-toolbar"><button type="button" onClick={() => void loadCandidates()}>刷新候选</button></div>
      {!candidates.length ? <div className="holon-empty">没有待审核的学习候选</div> : <div className="holon-list">{candidates.map((candidate) =>
        <article key={candidate.versionId}>
          <strong>{candidate.skillKey}</strong>
          <small>{candidate.parentVersionId ? `父版本 ${candidate.parentVersionId} → ` : "首个版本 → "}{candidate.versionId}</small>
          <pre className="candidate-diff">{formatCandidateDiff(candidate.contentJson)}</pre>
          <div className="holon-row-actions"><button type="button" onClick={() => setGovernanceConfirmation({ kind: "approve", versionId: candidate.versionId })}>批准</button><button type="button" onClick={() => setGovernanceConfirmation({ kind: "reject", versionId: candidate.versionId })}>拒绝</button></div>
        </article>)}</div>}
      {governanceConfirmation ? <div className="holon-confirm" role="alertdialog" aria-label="确认学习治理操作"><p>确认执行{governanceConfirmation.kind === "approve" ? "批准" : governanceConfirmation.kind === "reject" ? "拒绝" : "版本回滚"}？该操作会改变 Spring 中的私有学习状态。</p><button type="button" onClick={() => setGovernanceConfirmation(null)}>取消</button><button className="primary" type="button" onClick={() => void run("governance", async () => {
        if (governanceConfirmation.kind === "approve") await api?.approveLearningCandidate({ versionId: governanceConfirmation.versionId });
        else if (governanceConfirmation.kind === "reject") await api?.rejectLearningCandidate({ versionId: governanceConfirmation.versionId });
        else {
          if (!api?.rollbackPrivateSkill) throw new Error("版本回滚服务尚未就绪。");
          await api.rollbackPrivateSkill({ skillKey: rollbackSkillKey, targetVersionId: rollbackVersionId });
        }
        setGovernanceConfirmation(null);
        await loadCandidates();
      })}>确认</button></div> : null}
      <form className="holon-governance-form" onSubmit={(event) => { event.preventDefault(); setGovernanceConfirmation({ kind: "rollback" }); }}>
        <h2>回滚私有技能</h2>
        <input value={rollbackSkillKey} onChange={(event) => setRollbackSkillKey(event.target.value)} placeholder="技能标识" />
        <input value={rollbackVersionId} onChange={(event) => setRollbackVersionId(event.target.value)} placeholder="目标版本 ID" />
        <button type="submit">准备回滚</button>
      </form>
    </div> : null}

    {tab === "knowledge" ? <div className="holon-pane">
      <form className="holon-search" onSubmit={(event) => { event.preventDefault(); void run("search", async () => {
        if (!api?.searchPrivateKnowledge) throw new Error("知识搜索尚未就绪。");
        setKnowledge(await api.searchPrivateKnowledge({ query, limit: 20 }));
      }); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索私有知识" /><button type="submit">搜索</button></form>
      {!knowledge.length ? <div className="holon-empty">输入关键词搜索当前账号的私有知识</div> : <div className="holon-list">{knowledge.map((item) =>
        <article key={`${item.skillKey}:${item.versionId}`}><strong>{item.skillKey}</strong><small>{item.versionId} · 相关度 {item.score.toFixed(3)}</small><pre>{item.content}</pre></article>)}</div>}
    </div> : null}

    {tab === "sync" ? <div className="holon-pane holon-sync-pane">
      <dl><dt>连接</dt><dd>{syncStatus?.online ? "在线" : "离线或等待首次同步"}</dd><dt>待发送事件</dt><dd>{syncStatus?.pendingEventCount ?? 0}</dd><dt>隔离事件</dt><dd>{syncStatus?.quarantinedEventCount ?? 0}</dd><dt>最后同步</dt><dd>{syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "尚未同步"}</dd></dl>
      {syncStatus?.lastError ? <code>{syncStatus.lastError}</code> : null}
      <p>任务完成后可在对应结果中提交成功、安全和评分反馈。反馈仅包含受控指标，不上传命令输出或本地路径。</p>
      <form className="holon-feedback-form" onSubmit={(event) => { event.preventDefault();
        if (feedbackSubmittingRef.current) return;
        feedbackSubmittingRef.current = true;
        void run("feedback", async () => {
        if (!api?.submitHolonFeedback || !workItem?.workItem.knowledgeSnapshotId) throw new Error("需要已执行且带知识快照的任务。");
        await api.submitHolonFeedback({
          idempotencyKey: feedbackKey,
          workItemId: workItem.workItem.id,
          knowledgeSnapshotId: workItem.workItem.knowledgeSnapshotId,
          skillKey: feedbackSkillKey,
          versionId: feedbackVersionId,
          success: workItem.status === "completed",
          safetyViolation: feedbackSafetyViolation,
          userRating: feedbackRating,
          metrics: { approvalCount: 0, retryCount: 0 }
        });
        setNotice("反馈已提交。");
        setFeedbackKey(crypto.randomUUID());
      }).finally(() => { feedbackSubmittingRef.current = false; }); }}>
        <h2>提交任务反馈</h2>
        <input value={feedbackSkillKey} onChange={(event) => setFeedbackSkillKey(event.target.value)} placeholder="技能标识" />
        <input value={feedbackVersionId} onChange={(event) => setFeedbackVersionId(event.target.value)} placeholder="版本 ID" />
        <div className="holon-rating" aria-label="评分">
          {([[-1, "无帮助"], [0, "一般"], [1, "有帮助"]] as Array<[-1 | 0 | 1, string]>).map(([value, label]) =>
            <button key={value} type="button" className={feedbackRating === value ? "active" : ""} onClick={() => setFeedbackRating(value)}>{label}</button>)}
        </div>
        <label className="holon-feedback-safety">
          <input type="checkbox" checked={feedbackSafetyViolation}
            onChange={(event) => setFeedbackSafetyViolation(event.target.checked)} />
          本次结果存在安全问题（可能触发版本自动回滚）
        </label>
        <button className="primary" type="submit" disabled={busy === "feedback"}>提交反馈</button>
      </form>
    </div> : null}
  </section>;
}

function formatCandidateDiff(contentJson: string): string {
  let formatted = contentJson;
  try { formatted = JSON.stringify(JSON.parse(contentJson), null, 2); } catch { /* Keep bounded original content. */ }
  return formatted.split(/\r?\n/).slice(0, 200).map((line) => `+ ${line}`).join("\n");
}
