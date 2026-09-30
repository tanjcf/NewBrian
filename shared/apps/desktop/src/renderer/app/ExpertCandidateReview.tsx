import { useEffect, useState } from "react";

type Candidate = { versionId: string; skillKey: string; contentJson: string; contentHash: string };

export function ExpertCandidateReview() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ item: Candidate; approve: boolean } | null>(null);
  async function refresh() {
    const api = window.newbrain;
    if (!api) { setError("桌面服务尚未就绪"); return; }
    setBusy(true);
    try { setItems(await api.listLearningCandidates({ limit: 100 })); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function decide() {
    if (!confirmation) return;
    const api = window.newbrain;
    if (!api) { setError("桌面服务尚未就绪"); return; }
    setBusy(true);
    try {
      const input = { versionId: confirmation.item.versionId };
      if (confirmation.approve) await api.approveLearningCandidate(input);
      else await api.rejectLearningCandidate(input);
      setConfirmation(null);
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="expert-candidate-review" aria-label="候选审核">
    <button type="button" disabled={busy} onClick={() => void refresh()}>刷新候选</button>
    {error && <p role="alert">{error}</p>}
    {!items.length && !busy && <p>暂无待审核候选</p>}
    {items.map(item => <article key={item.versionId}>
      <h2>{item.skillKey}</h2>
      <p>待审核 · {item.versionId}</p>
      <details><summary>内容、来源与评测报告</summary><pre>{item.contentJson}</pre></details>
      <button type="button" disabled={busy} onClick={() => setConfirmation({ item, approve: false })}>拒绝</button>
      <button type="button" disabled={busy} onClick={() => setConfirmation({ item, approve: true })}>审核发布</button>
    </article>)}
    {confirmation && <div role="alertdialog" aria-label="确认候选审核" className="expert-candidate-confirm">
      <p>{confirmation.approve ? "确认将此候选发布为你的活动版本？请核对来源和报告；作者评分不代表执行评测通过。" : "确认拒绝此候选？"}</p>
      <button type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button>
      <button type="button" disabled={busy} onClick={() => void decide()}>确认</button>
    </div>}
  </section>;
}
