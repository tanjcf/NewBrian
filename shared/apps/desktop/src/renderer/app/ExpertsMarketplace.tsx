// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";

export type ExpertCatalogCard = {
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

/** Catalog / install only. Summoning is exclusively via global/project Skill → expert.summon. */
export function ExpertsMarketplace() {
  const [experts, setExperts] = useState<ExpertCatalogCard[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const refresh = useCallback(async () => {
    if (!window.codecn?.listExperts) {
      setError("当前桌面版本尚未暴露专家市场 API。");
      return;
    }
    try {
      const list = await window.codecn.listExperts();
      setExperts(Array.isArray(list) ? list as ExpertCatalogCard[] : []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => {
    const ids = [...new Set(experts.map((item) => item.categoryId).filter(Boolean))];
    return ids.sort();
  }, [experts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return experts.filter((item) => {
      if (category !== "all" && item.categoryId !== category) return false;
      if (!q) return true;
      return [item.displayName, item.profession, item.description, ...(item.tags || [])]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [experts, query, category]);

  const selected = visible.find((item) => item.id === selectedId) || experts.find((item) => item.id === selectedId) || visible[0] || null;

  const install = async (expert: ExpertCatalogCard) => {
    if (!window.codecn?.installExpert) return;
    setBusyId(expert.id);
    try {
      await window.codecn.installExpert({ expertId: expert.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const toggleEnabled = async (expert: ExpertCatalogCard) => {
    if (!window.codecn?.setExpertEnabled) return;
    setBusyId(expert.id);
    try {
      if (!expert.installed) {
        await window.codecn.installExpert({ expertId: expert.id });
      }
      await window.codecn.setExpertEnabled({ expertId: expert.id, enabled: !expert.enabled });
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
          <p>
            仅用于浏览与安装专家包。召唤只有一种方式：启用全局/项目 Skill 后，由 Skill 按任务自行调用
            <code> expert.summon </code>。
          </p>
        </div>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </header>
      {error ? <div className="experts-marketplace-error" role="alert">{error}</div> : null}
      <div className="experts-marketplace-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索专家、标签或能力"
          aria-label="搜索专家"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="专家分类">
          <option value="all">全部分类</option>
          {categories.map((id) => (
            <option key={id} value={id}>{CATEGORY_LABELS[id] || id}</option>
          ))}
        </select>
      </div>
      <div className="experts-marketplace-layout">
        <div className="experts-marketplace-grid">
          {visible.length ? visible.map((expert) => (
            <article
              key={expert.id}
              className={`experts-card${selected?.id === expert.id ? " active" : ""}`}
              onClick={() => setSelectedId(expert.id)}
            >
              <div className="experts-card-top">
                <strong>{expert.profession || expert.displayName}</strong>
                <span>{expert.expertType === "team" ? "专家团" : "单专家"}</span>
              </div>
              <p>{expert.description || "暂无简介"}</p>
              <div className="experts-card-tags">
                {(expert.tags || []).slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
              </div>
              <div className="experts-card-actions">
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
                <button
                  type="button"
                  disabled={busyId === expert.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleEnabled(expert);
                  }}
                >
                  {expert.enabled === false ? "启用" : "禁用"}
                </button>
              </div>
            </article>
          )) : (
            <div className="experts-empty">没有匹配的专家。请检查内置种子包是否已打包。</div>
          )}
        </div>
        {selected ? (
          <aside className="experts-detail">
            <h2>{selected.profession}</h2>
            <p>{selected.description}</p>
            <dl>
              <div><dt>类型</dt><dd>{selected.expertType === "team" ? "专家团" : "单专家"}</dd></div>
              <div><dt>分类</dt><dd>{CATEGORY_LABELS[selected.categoryId] || selected.categoryId}</dd></div>
              <div><dt>成员</dt><dd>{selected.memberAgentIds?.length ? selected.memberAgentIds.join(", ") : "—"}</dd></div>
              <div><dt>Skills</dt><dd>{selected.skillNames?.length ? selected.skillNames.join(", ") : "—"}</dd></div>
              <div><dt>建议场景</dt><dd>{selected.preferredWorkspaceKey || "不强制"}</dd></div>
              <div><dt>召唤方式</dt><dd>仅全局/项目 Skill → expert.summon</dd></div>
            </dl>
            {selected.quickPrompts?.length ? (
              <>
                <h3>示例问题（需在对话中由 Skill 决定是否召唤）</h3>
                <div className="experts-quick-prompts">
                  {selected.quickPrompts.map((prompt) => (
                    <div key={prompt} className="experts-prompt-sample">{prompt}</div>
                  ))}
                </div>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
