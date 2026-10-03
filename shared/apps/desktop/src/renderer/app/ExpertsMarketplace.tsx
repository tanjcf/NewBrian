// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarIcon } from "./SidebarIcon";
import { EXPERT_WORKSPACE_LABELS, expertWorkspaceKeys, isExpertAvailableInWorkspace } from "../../shared/expert-workspace-policy";
import { ExpertCandidateReview } from "./ExpertCandidateReview";

export type ExpertCatalogCard = {
  workspaceKeys?: string[];
  id: string;
  expertType: "agent" | "team";
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  tags: string[];
  quickPrompts: string[];
  defaultInitPrompt: string;
  preferredWorkspaceKey?: string;
  installed: boolean;
  enabled: boolean;
  memberAgentIds: string[];
  skillNames: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  "01-ProductDesign": "产品设计",
  "02-Engineering": "技术工程",
  "04-DataAI": "数据智能",
  "06-ContentCreative": "内容创作",
  "08-FinanceInvestment": "金融投资",
  "12-IndustryConsultant": "行业顾问"
};

/** Catalog, install, and an explicit "使用" handoff. Model-side expert.summon still requires a confirmed plan. */
export function ExpertsMarketplace({
  workspaceKey = "explore",
  onUseExpert
}: {
  workspaceKey?: string;
  onUseExpert?: (expert: ExpertCatalogCard) => Promise<void> | void;
}) {
  const [experts, setExperts] = useState<ExpertCatalogCard[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState("catalog");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selectedId) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selectedId]);

  const refresh = useCallback(async () => {
    if (!window.newbrain?.listExperts) {
      setError("当前桌面版本尚未暴露专家市场 API。");
      return;
    }
    try {
      const list = await window.newbrain.listExperts();
      setExperts(Array.isArray(list) ? list as ExpertCatalogCard[] : []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const available = useMemo(() => experts.filter(item => isExpertAvailableInWorkspace(item, workspaceKey)), [experts, workspaceKey]);
  const categories = useMemo(() => {
    const ids = [...new Set(available.map((item) => item.categoryId).filter(Boolean))];
    return ids.sort();
  }, [available]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available.filter((item) => {
      if (view === "installed" && !item.installed) return false;
      if (category !== "all" && item.categoryId !== category) return false;
      if (!q) return true;
      return [item.displayName, item.profession, item.description, ...(item.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [available, query, category, view]);

  const selected = available.find((item) => item.id === selectedId) || null;
  const source = (item: ExpertCatalogCard) => item.id.startsWith("nuwa-") ? "女娲 Nuwa" : item.id.startsWith("agency-") ? "Agency Agents" : item.id.startsWith("game-studios") ? "Game Studios" : "BRAIN";

  const install = async (expert: ExpertCatalogCard) => {
    if (!window.newbrain?.installExpert) return;
    setBusyId(expert.id);
    try {
      await window.newbrain.installExpert({ expertId: expert.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const useExpert = async (expert: ExpertCatalogCard) => {
    if (!onUseExpert) {
      setError("当前桌面版本还不能在对话中使用专家。");
      return;
    }
    setBusyId(expert.id);
    try {
      await onUseExpert(expert);
      setSelectedId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const toggleEnabled = async (expert: ExpertCatalogCard) => {
    if (!window.newbrain?.setExpertEnabled) return;
    setBusyId(expert.id);
    try {
      if (!expert.installed) {
        await window.newbrain.installExpert({ expertId: expert.id });
      }
      await window.newbrain.setExpertEnabled({ expertId: expert.id, enabled: !expert.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="experts-marketplace" data-testid="experts-marketplace">
      <header className="experts-marketplace-header">
        <div>
          <h1>专家市场</h1>
          <p>{EXPERT_WORKSPACE_LABELS[workspaceKey]} · {available.length} 位专家</p>
        </div>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </header>
      {error ? <div className="experts-marketplace-error" role="alert">{error}</div> : null}
      <div className="experts-view-tabs" role="tablist" aria-label="专家视图">
        <button role="tab" aria-selected={view === "catalog"} onClick={() => setView("catalog")}>发现专家</button>
        <button role="tab" aria-selected={view === "installed"} onClick={() => setView("installed")}>我的专家 <small>{available.filter(item => item.installed).length}</small></button>
        {workspaceKey === "explore" && <button role="tab" aria-selected={view === "candidates"} onClick={() => setView("candidates")}>候选审核</button>}
      </div>
      {view === "candidates" ? <ExpertCandidateReview /> : <>
      <div className="experts-marketplace-toolbar">
        <label className="experts-search"><SidebarIcon name="search" /><input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索专家、标签或能力"
          aria-label="搜索专家"
        /></label>
        <span className="experts-result-count">{visible.length} 位{view === "installed" ? "已安装" : "可用"}专家</span>
      </div>
      <nav className="experts-categories" aria-label="专家分类">
          <button aria-pressed={category === "all"} onClick={() => setCategory("all")}>全部领域</button>
          {categories.map((id) => (
            <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{CATEGORY_LABELS[id] || id}</button>
          ))}
      </nav>
      <div className="experts-marketplace-layout">
        <div className="experts-marketplace-grid">
          {visible.length ? visible.map((expert) => (
            <article
              key={expert.id}
              className={`experts-card${selected?.id === expert.id ? " active" : ""}`}
              onClick={() => setSelectedId(expert.id)}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedId(expert.id); } }}
              tabIndex={0}
              aria-label={`${expert.displayName}，查看详情`}
            >
              <div className="experts-card-top">
                <div className="experts-avatar" data-category={expert.categoryId}><SidebarIcon name={expert.expertType === "team" ? "plugins" : "experts"} /></div>
                <div className="experts-card-identity"><strong title={expert.displayName}>{expert.displayName}</strong><span title={expert.profession}>{expert.profession || CATEGORY_LABELS[expert.categoryId]}</span></div>
              </div>
              <p>{expert.description || "暂无简介"}</p>
              <div className="experts-card-tags">
                {(expert.tags || []).slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
              </div>
              <div className="experts-card-actions">
                <span className="experts-source">{source(expert)}</span>
                <button
                  type="button"
                  className="experts-use"
                  disabled={busyId === expert.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void useExpert(expert);
                  }}
                >
                  {busyId === expert.id ? "请稍候…" : "使用"}
                </button>
                <button
                  type="button"
                  disabled={busyId === expert.id || expert.installed}
                  onClick={(event) => {
                    event.stopPropagation();
                    void install(expert);
                  }}
                >
                  {expert.installed ? "已安装" : busyId === expert.id ? "安装中…" : "安装"}
                </button>
                {expert.installed && <button
                  type="button"
                  role="switch"
                  aria-checked={expert.enabled !== false}
                  aria-label={`${expert.enabled === false ? "启用" : "停用"}${expert.displayName}`}
                  className="experts-enable-switch"
                  disabled={busyId === expert.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleEnabled(expert);
                  }}
                >
                  <span />
                </button>}
              </div>
            </article>
          )) : (
            <div className="experts-empty">当前场景没有匹配的专家。</div>
          )}
        </div>
        <dialog ref={dialog} className="experts-detail" onClose={() => setSelectedId("")} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        {selected ? <div className="experts-detail-content">
            <button className="experts-detail-close" aria-label="关闭专家详情" onClick={() => setSelectedId("")}>关闭</button>
            <div className="experts-detail-source">{source(selected)} · {selected.expertType === "team" ? "专家团" : "专家"}</div>
            <h2>{selected.displayName}</h2>
            <p>{selected.description}</p>
            <dl>
              <div><dt>类型</dt><dd>{selected.expertType === "team" ? "专家团" : "单专家"}</dd></div>
              <div><dt>分类</dt><dd>{CATEGORY_LABELS[selected.categoryId] || selected.categoryId}</dd></div>
              <div><dt>成员</dt><dd>{selected.memberAgentIds?.length ? selected.memberAgentIds.join(", ") : "—"}</dd></div>
              <div><dt>Skills</dt><dd>{selected.skillNames?.length ? selected.skillNames.join(", ") : "—"}</dd></div>
              <div><dt>适用场景</dt><dd>{[...expertWorkspaceKeys(selected), "explore"].map(key => EXPERT_WORKSPACE_LABELS[key]).join("、")}</dd></div>
            </dl>
            {selected.quickPrompts?.length ? (
              <>
                <h3>擅长的任务</h3>
                <div className="experts-quick-prompts">
                  {selected.quickPrompts.map((prompt) => (
                    <div key={prompt} className="experts-prompt-sample">{prompt}</div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="experts-detail-actions">
              <button type="button" className="experts-use" disabled={busyId === selected.id} onClick={() => void useExpert(selected)}>{busyId === selected.id ? "请稍候…" : "使用此专家"}</button>
              <button type="button" disabled={busyId === selected.id} onClick={() => void (selected.installed ? toggleEnabled(selected) : install(selected))}>{selected.installed ? selected.enabled === false ? "启用专家" : "停用专家" : "安装专家"}</button>
            </div>
          </div> : null}
        </dialog>
      </div>
      </>}
    </section>
  );
}
