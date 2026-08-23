import { useEffect, useMemo, useState } from "react";
import { useWorkspaceSceneState } from "./useWorkspaceSceneState";
import { QuantMarketChart, type QuantChartDrillTarget } from "./QuantMarketChart";

const BUILTIN_QUANT_SKILLS = [
  { id: "trend-following", label: "趋势跟踪", detail: "5 日均线上穿 20 日均线买入，下穿卖出" },
  { id: "mean-reversion", label: "均值回归", detail: "跌破 20 日均线买入，回到均线上方卖出" }
] as const;

type QuantUiState = {
  symbol: string;
  interval: string;
  adjustment: string;
  startDate: string;
  endDate: string;
  quantity: number;
  /** One-time migration tag so legacy short ranges pick up the 12-month default once. */
  dateRangePreset?: string;
};

const DATE_RANGE_PRESET = "end-today-start-12m";

const defaultQuantUi: QuantUiState = {
  symbol: "600519",
  interval: "日线",
  adjustment: "前复权",
  startDate: "",
  endDate: "",
  quantity: 100,
  dateRangePreset: DATE_RANGE_PRESET
};

function formatLocalIsoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** End = today; start = same calendar day 12 months earlier. */
function defaultMarketDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setFullYear(start.getFullYear() - 1);
  return { startDate: formatLocalIsoDate(start), endDate: formatLocalIsoDate(end) };
}

export function QuantWorkspace({
  projectId,
  workspaceId,
  compact = false,
  activeView = "market"
}: {
  projectId?: string;
  /** Local workspace id used by model tools before a Brain project id is known to main. */
  workspaceId?: string;
  compact?: boolean;
  activeView?: "market" | "portfolio" | "strategy" | "radar";
}) {
  const { state: ui, setState: setUi, hydrated } = useWorkspaceSceneState(projectId, "quant", defaultQuantUi);
  const symbol = ui.symbol;
  const interval = ui.interval;
  const adjustment = ui.adjustment;
  const startDate = ui.startDate;
  const endDate = ui.endDate;
  const quantity = ui.quantity;

  useEffect(() => {
    if (!hydrated) return;
    setUi((current) => {
      if (current.dateRangePreset === DATE_RANGE_PRESET && current.startDate && current.endDate) {
        return current;
      }
      const range = defaultMarketDateRange();
      return {
        ...current,
        startDate: range.startDate,
        endDate: range.endDate,
        dateRangePreset: DATE_RANGE_PRESET
      };
    });
  }, [hydrated, setUi]);
  const [bars, setBars] = useState<any[]>([]);
  const [queryVersion, setQueryVersion] = useState(0);
  const [orderStatus, setOrderStatus] = useState("");
  const [portfolio, setPortfolio] = useState<any>({ cash: 100_000, marketValue: 0, totalValue: 100_000, totalReturnPercent: 0, positions: [] });
  const [portfolioActivity, setPortfolioActivity] = useState<any>({ fills: [], equityCurve: [] });
  const [status, setStatus] = useState("尚未查询行情");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [skillId, setSkillId] = useState<string>(BUILTIN_QUANT_SKILLS[0].id);
  const [scheduleTime, setScheduleTime] = useState("15:10");
  const [scheduleExchange, setScheduleExchange] = useState<"SSE" | "SZSE" | "BSE">("SSE");
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [skillPerformance, setSkillPerformance] = useState<Record<string, any>>({});
  const [skillPortfolios, setSkillPortfolios] = useState<Record<string, any>>({});
  const [skillActivities, setSkillActivities] = useState<Record<string, any>>({});
  const [skillTitles, setSkillTitles] = useState<Record<string, string>>({});
  const [strategyTasks, setStrategyTasks] = useState<any[]>([]);
  const [strategyRuns, setStrategyRuns] = useState<any[]>([]);
  const [expandedRadarId, setExpandedRadarId] = useState("");
  const [skillRunStatus, setSkillRunStatus] = useState("");
  const [skillRunBusy, setSkillRunBusy] = useState(false);
  const [dayPathBar, setDayPathBar] = useState<any | null>(null);
  const [drillHint, setDrillHint] = useState("");
  const latest = bars.at(-1);

  useEffect(() => {
    setDayPathBar(null);
  }, [symbol, interval, startDate, endDate, queryVersion]);

  useEffect(() => {
    if (!projectId || !window.codecn?.onQuantMarketUpdated) return;
    return window.codecn.onQuantMarketUpdated((payload) => {
      if (payload?.projectId !== projectId && payload?.projectId !== workspaceId || !Array.isArray(payload.bars)) return;
      const query = (payload.query || {}) as any;
      const nextInterval = query.interval === "1w" ? "周线" : query.interval === "1mo" ? "月线" : "日线";
      const nextAdjustment = query.adjustment === "backward" ? "后复权" : query.adjustment === "none" ? "不复权" : "前复权";
      setUi((current) => ({ ...current, symbol: String(query.symbol || current.symbol), interval: nextInterval, adjustment: nextAdjustment, startDate: typeof query.startDate === "string" ? query.startDate : current.startDate, endDate: typeof query.endDate === "string" ? query.endDate : current.endDate, dateRangePreset: DATE_RANGE_PRESET }));
      const valid = payload.bars.filter((bar: any) => ["open", "high", "low", "close", "volume"].every((key) => typeof bar?.[key] === "number"));
      setBars(valid.slice(-400));
      setStatus(valid.length ? `已加载 ${valid.length} 条真实行情 · ${valid[0]?.source?.provider || "行情网关"}` : "该条件下暂无已同步行情");
      setQueryVersion((value) => value + 1);
    });
  }, [projectId, workspaceId, setUi]);

  useEffect(() => {
    if (!projectId || !window.codecn?.onQuantPortfolioUpdated) return;
    return window.codecn.onQuantPortfolioUpdated((payload: any) => {
      if ((payload?.projectId !== projectId && payload?.projectId !== workspaceId) || !payload?.skillId || !payload?.activity?.snapshot) return;
      const id = String(payload.skillId);
      setSkillPortfolios((current) => ({ ...current, [id]: payload.activity.snapshot }));
      setSkillActivities((current) => ({ ...current, [id]: payload.activity }));
      if (payload.title) setSkillTitles((current) => ({ ...current, [id]: String(payload.title) }));
    });
  }, [projectId, workspaceId]);

  const marketQuery = useMemo(() => {
    const intervalValue = interval === "周线" ? "1w" : interval === "月线" ? "1mo" : "1d";
    const adjustmentValue = adjustment === "后复权" ? "backward" : adjustment === "不复权" ? "none" : "forward";
    return {
      symbol,
      interval: intervalValue as "1d" | "1w" | "1mo",
      adjustment: adjustmentValue as "forward" | "backward" | "none",
      startDate: startDate || undefined,
      endDate: endDate || undefined
    };
  }, [symbol, interval, adjustment, startDate, endDate]);

  useEffect(() => {
    if (!projectId || !window.codecn?.createQuantSession || !window.codecn?.getQuantActivity) return;
    let active = true;
    void window.codecn.createQuantSession({ projectId, initialCash: 100_000 })
      .then(() => window.codecn.getQuantActivity?.({ projectId, prices: {} }))
      .then((activity: any) => {
        if (!active || !activity) return;
        setPortfolio(activity.snapshot);
        setPortfolioActivity(activity);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!hydrated || !projectId || !window.codecn?.createQuantSession || !window.codecn?.queryQuantBars) return;
    let active = true;
    const intervalValue = interval === "周线" ? "1w" : interval === "月线" ? "1mo" : "1d";
    const adjustmentValue = adjustment === "后复权" ? "backward" : adjustment === "不复权" ? "none" : "forward";
    void window.codecn.createQuantSession({ projectId, initialCash: 100_000 })
      .then(() => window.codecn.queryQuantBars({ projectId, query: { symbol, interval: intervalValue, adjustment: adjustmentValue, startDate: startDate || undefined, endDate: endDate || undefined } }))
      .then((result: any[]) => {
        if (!active) return;
        const valid = result.filter((bar) => ["open", "high", "low", "close", "volume"].every((key) => typeof bar?.[key] === "number"));
        if (valid.length) {
          // Keep up to ~1.5y of daily sessions so the 12-month default is visible.
          setBars(valid.slice(-400));
          setStatus(`已加载 ${valid.length} 条真实行情 · ${valid[0].source?.provider || "行情网关"}`);
        } else { setBars([]); setStatus("该条件下暂无已同步行情"); }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBars([]);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("BRAIN_MARKET_DATA_URL_REQUIRED")) {
          setStatus("未配置行情网关 BRAIN_MARKET_DATA_URL，无法查询真实行情");
        } else if (message.includes("MARKET_DATA_HTTP_")) {
          setStatus(`行情网关请求失败：${message}`);
        } else {
          setStatus(`行情服务暂不可用：${message}`);
        }
      });
    return () => { active = false; };
  }, [projectId, symbol, interval, adjustment, startDate, endDate, queryVersion, hydrated]);

  useEffect(() => {
    if (!projectId || !window.codecn?.getQuantActivity) return;
    const prices = latest ? { [symbol]: latest.close } : {};
    void window.codecn.getQuantActivity({ projectId, prices }).then((activity: any) => {
      if (!activity) return;
      setPortfolio(activity.snapshot);
      setPortfolioActivity(activity);
    }).catch(() => undefined);
  }, [projectId, symbol, latest?.close]);

  useEffect(() => {
    if (!projectId || !window.codecn?.listQuantStrategySchedules) { setSchedules([]); return; }
    void window.codecn.listQuantStrategySchedules({ projectId })
      .then((items: any[]) => setSchedules(Array.isArray(items) ? items : []))
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "策略计划读取失败"));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const refresh = async () => {
      try {
        const items = await window.codecn?.listBrainTasks?.({ projectId });
        if (active) setStrategyTasks((Array.isArray(items) ? items : []).filter((item) => String(item.taskType || "").startsWith("quant.strategy.")));
      } catch { if (active) setStrategyTasks([]); }
      try {
        const runs = await window.codecn?.listQuantStrategyRuns?.({ projectId });
        if (active) setStrategyRuns(Array.isArray(runs) ? runs : []);
      } catch { if (active) setStrategyRuns([]); }
      const skillIds = Array.from(new Set([
        ...schedules.map((item) => String(item.skillId || "")).filter(Boolean)
      ]));
      const prices = latest ? { [symbol]: latest.close } : {};
      const entries = await Promise.all(skillIds.map(async (id) => {
        try {
          const performance = await window.codecn?.getQuantSkillPerformance?.({ projectId, skillId: id });
          return [id, performance] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (active) setSkillPerformance(Object.fromEntries(entries.filter((entry) => entry[1])));
      const portfolios = await Promise.all(skillIds.map(async (id) => {
        try {
          const activity = await window.codecn?.getQuantSkillActivity?.({ projectId, skillId: id, prices });
          return [id, activity] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (!active) return;
      const nextPortfolios: Record<string, any> = {};
      const nextActivities: Record<string, any> = {};
      for (const [id, activity] of portfolios) {
        if (!activity) continue;
        nextActivities[id] = activity;
        if (activity.snapshot) nextPortfolios[id] = activity.snapshot;
      }
      setSkillPortfolios((current) => ({ ...current, ...nextPortfolios }));
      setSkillActivities((current) => ({ ...current, ...nextActivities }));
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, schedules, symbol, latest?.close]);

  const returnPercent = useMemo(() => bars.length && latest ? ((latest.close - bars[0].close) / bars[0].close * 100).toFixed(2) : "0.00", [bars, latest]);

  const applyDrill = (target: QuantChartDrillTarget) => {
    setDrillHint(target.focusLabel);
    if (target.dayPath) {
      setDayPathBar(target.dayPath);
      return;
    }
    setDayPathBar(null);
    setUi((current) => ({
      ...current,
      interval: target.interval,
      startDate: target.startDate,
      endDate: target.endDate,
      dateRangePreset: DATE_RANGE_PRESET
    }));
    setQueryVersion((value) => value + 1);
  };

  const exitDayPath = () => {
    setDayPathBar(null);
    setDrillHint("");
  };

  const executeOrder = (side: "buy" | "sell") => {
    if (!latest) { setOrderStatus("暂无真实行情，不能生成模拟成交"); return; }
    if (!projectId || !window.codecn?.executeQuantOrder) { setOrderStatus("模拟会话尚未连接"); return; }
    void window.codecn.executeQuantOrder({ projectId, order: { id: `order-${Date.now()}`, symbol, side, quantity, price: latest.close, feeRate: 0.0003, createdAt: new Date().toISOString() } })
      .then(() => window.codecn.getQuantActivity?.({ projectId, prices: { [symbol]: latest.close } }))
      .then((activity: any) => { if (activity) { setPortfolio(activity.snapshot); setPortfolioActivity(activity); } setOrderStatus(`已手动模拟${side === "buy" ? "买入" : "卖出"} ${symbol} ${quantity} 股（对照盘，不含 Skill）`); })
      .catch((error: unknown) => setOrderStatus(error instanceof Error ? error.message : "模拟下单失败"));
  };

  const setScheduleEnabled = (scheduleId: string, enabled: boolean) => {
    if (!projectId || !window.codecn?.setQuantStrategyScheduleEnabled) return;
    void window.codecn.setQuantStrategyScheduleEnabled({ projectId, scheduleId, enabled })
      .then((updated: any) => { setSchedules((items) => items.map((item) => item.id === scheduleId ? updated : item)); setScheduleStatus(enabled ? "雷达任务已启用" : "雷达任务已暂停"); })
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "雷达状态更新失败"));
  };

  const equityPath = useMemo(() => {
    const points = portfolioActivity.equityCurve ?? [];
    if (points.length < 2) return "";
    const values = points.map((point: any) => Number(point.totalValue));
    const low = Math.min(...values); const high = Math.max(...values); const span = Math.max(high - low, 1);
    return points.map((point: any, index: number) => `${index ? "L" : "M"}${(index / (points.length - 1)) * 420},${130 - ((Number(point.totalValue) - low) / span) * 110}`).join(" ");
  }, [portfolioActivity.equityCurve]);

  const createSchedule = () => {
    if (!projectId || !window.codecn?.createQuantStrategySchedule) { setScheduleStatus("模拟项目尚未连接"); return; }
    if (!skillId.trim()) { setScheduleStatus("请选择量化 Skill"); return; }
    void window.codecn.createQuantStrategySchedule({ projectId, skillId, exchange: scheduleExchange, runAt: scheduleTime, symbol, quantity })
      .then((created: any) => { setSchedules((items) => [...items, created]); setScheduleStatus(`已绑定 Skill「${skillId}」到雷达计划，交易日将自动模拟买卖`); })
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "策略计划保存失败"));
  };

  const runSkillNow = () => {
    if (!projectId || !window.codecn?.runQuantSkillSimulation) {
      setSkillRunStatus("当前构建未接入 Skill 模拟 IPC");
      return;
    }
    if (!skillId.trim()) {
      setSkillRunStatus("请选择量化 Skill");
      return;
    }
    setSkillRunBusy(true);
    setSkillRunStatus(`正在用 Skill「${skillId}」按真实行情自动模拟买卖…`);
    void window.codecn.runQuantSkillSimulation({
      projectId,
      skillId,
      symbol,
      quantity,
      query: marketQuery,
      reset: true
    }).then(async (result: any) => {
      setSkillPerformance((current) => ({ ...current, [skillId]: result.performance }));
      setSkillPortfolios((current) => ({ ...current, [skillId]: result.snapshot }));
      try {
        const activity = await window.codecn.getQuantSkillActivity?.({
          projectId,
          skillId,
          prices: latest ? { [symbol]: latest.close } : {}
        });
        if (activity) setSkillActivities((current) => ({ ...current, [skillId]: activity }));
      } catch { /* performance already set */ }
      setSkillRunStatus(`Skill「${skillId}」完成：${result.tradeCount} 笔自动成交 · 收益 ${Number(result.performance.totalReturnPercent).toFixed(2)}% · 基于 ${result.barCount} 根真 K 线`);
    }).catch((error: unknown) => {
      setSkillRunStatus(error instanceof Error ? error.message : "Skill 模拟失败");
    }).finally(() => setSkillRunBusy(false));
  };

  const skillLabel = (id: string) => BUILTIN_QUANT_SKILLS.find((item) => item.id === id)?.label || id;

  const portfolioPanel = <aside className="brain-quant-side"><h3>手动对照盘</h3><p className="brain-quant-side-note">仅用于人工试单对照。正式量化请用 Skill 自动模拟。</p><div className="brain-quant-total"><small>总资产</small><strong>¥{portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><em>{portfolio.totalReturnPercent >= 0 ? "+" : ""}{portfolio.totalReturnPercent.toFixed(2)}%</em></div>
    <dl><div><dt>可用现金</dt><dd>¥{portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>持仓市值</dt><dd>¥{portfolio.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>累计收益</dt><dd className={portfolio.totalValue >= 100_000 ? "positive" : "negative"}>{portfolio.totalValue >= 100_000 ? "+" : ""}¥{(portfolio.totalValue - 100_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div></dl>
    <div className="brain-quant-order-controls"><label>数量<input data-testid="brain-quant-order-quantity" type="number" min="1" step="100" value={quantity} onChange={(event) => setUi((current) => ({ ...current, quantity: Math.max(1, Number(event.target.value) || 1) }))}/></label><button data-testid="brain-quant-buy" type="button" className="primary" onClick={() => executeOrder("buy")}>手动买入</button><button data-testid="brain-quant-sell" type="button" onClick={() => executeOrder("sell")}>手动卖出</button></div>
    {portfolio.positions?.length ? <ul className="brain-quant-position-list" data-testid="brain-quant-positions">{portfolio.positions.map((position: any) => <li key={position.symbol}><strong>{position.symbol}</strong><span>{position.quantity} 股</span><em className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{position.unrealizedPnl >= 0 ? "+" : ""}¥{position.unrealizedPnl.toFixed(2)}</em></li>)}</ul> : <small>暂无手动持仓</small>}
    {orderStatus ? <small className="brain-quant-order-status">{orderStatus}</small> : null}
  </aside>;

  const skillPicker = (
    <label className="brain-quant-skill-picker">Skill
      <select data-testid="brain-quant-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
        {BUILTIN_QUANT_SKILLS.map((skill) => <option key={skill.id} value={skill.id}>{skill.label}（{skill.id}）</option>)}
      </select>
      <small>{BUILTIN_QUANT_SKILLS.find((item) => item.id === skillId)?.detail}</small>
    </label>
  );

  return <main className={`brain-quant-module${compact ? " compact" : ""}`} data-testid="brain-quant-workspace" data-active-view={activeView}>
    <header className="brain-quant-header"><div><span>量化交易</span><strong>{activeView === "market" ? "行情分析" : activeView === "portfolio" ? "模拟组合" : activeView === "strategy" ? "Skill 策略" : "股市雷达"}</strong></div><small data-testid="brain-quant-market-status">{status} · 不连接真实券商</small></header>
    {activeView === "market" ? <><section className="brain-quant-toolbar">
      <label>代码<input value={symbol} onChange={(event) => setUi((current) => ({ ...current, symbol: event.target.value }))} /></label>
      <label>周期<select value={interval} onChange={(event) => setUi((current) => ({ ...current, interval: event.target.value }))}><option>日线</option><option>周线</option><option>月线</option></select></label>
      <label>复权<select value={adjustment} onChange={(event) => setUi((current) => ({ ...current, adjustment: event.target.value }))}><option>前复权</option><option>后复权</option><option>不复权</option></select></label>
      <label>开始日期<input type="date" value={startDate} onChange={(event) => setUi((current) => ({ ...current, startDate: event.target.value }))} /></label>
      <label>结束日期<input type="date" value={endDate} onChange={(event) => setUi((current) => ({ ...current, endDate: event.target.value }))} /></label>
      <button type="button" onClick={() => setQueryVersion((value) => value + 1)}>查询行情</button>
    </section>
    <section className="brain-quant-grid">
      <QuantMarketChart
        symbol={symbol}
        interval={(interval === "周线" || interval === "月线" ? interval : "日线") as "日线" | "周线" | "月线"}
        adjustment={adjustment}
        bars={bars}
        returnPercent={returnPercent}
        dayPathBar={dayPathBar}
        drillHint={drillHint}
        onDrill={applyDrill}
        onExitDayPath={exitDayPath}
      />
    </section></> : null}
    {activeView === "portfolio" ? <section className="brain-quant-portfolio-view">
      <div className="brain-quant-section-title"><h3>Skill 自动模拟组合</h3><small>主路径：Skill 按真实行情自动买卖</small></div>
      {Object.keys(skillPortfolios).length ? <div className="brain-quant-schedule-list" data-testid="brain-quant-skill-portfolios">
        {Object.entries(skillPortfolios).map(([id, snapshot]: [string, any]) => {
          const activity = skillActivities[id];
          const fills = activity?.fills?.length ?? 0;
          return <article key={id}>
            <strong>{skillTitles[id] || skillLabel(id)}</strong>
            <span>总资产 ¥{Number(snapshot.totalValue || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} · 收益 {Number(snapshot.totalReturnPercent || 0).toFixed(2)}% · {fills} 笔自动成交</span>
            <em>{(snapshot.positions || []).map((position: any) => `${position.symbol} ${position.quantity}股`).join(" · ") || "空仓"}</em>
          </article>;
        })}
      </div> : <div className="brain-quant-empty">尚无 Skill 持仓。请到「策略」选择 Skill 并点击「立即用 Skill 自动模拟」。</div>}
      <div className="brain-quant-section-title"><h3>手动对照盘</h3><small>可选，不是量化主路径</small></div>
      <div className="brain-quant-account-grid"><article><span>总资产</span><strong>¥{portfolio.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article><article><span>累计收益率</span><strong className={portfolio.totalReturnPercent >= 0 ? "positive" : "negative"}>{portfolio.totalReturnPercent >= 0 ? "+" : ""}{portfolio.totalReturnPercent.toFixed(2)}%</strong></article><article><span>持仓市值</span><strong>¥{portfolio.marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article><article><span>可用资金</span><strong>¥{portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article></div>
      <div className="brain-quant-equity-chart">{equityPath ? <svg viewBox="0 0 420 140" preserveAspectRatio="none" aria-label="手动对照盘资金曲线"><g stroke="currentColor" opacity=".08"><path d="M0 30H420M0 70H420M0 110H420"/></g><path d={equityPath} fill="none" stroke="currentColor" strokeWidth="3"/></svg> : <small>手动成交后显示对照曲线</small>}</div>
      {portfolioPanel}
      <div className="brain-quant-section-title"><h3>手动成交记录</h3><small>{portfolioActivity.fills?.length ?? 0} 笔</small></div>
      <div className="brain-quant-fill-list">{portfolioActivity.fills?.length ? [...portfolioActivity.fills].reverse().map((fill: any) => <article key={fill.id}><strong>{fill.side === "buy" ? "买入" : "卖出"} {fill.symbol}</strong><span>{fill.quantity} 股 × ¥{Number(fill.price).toFixed(2)}</span><em>{String(fill.createdAt).replace("T", " ").slice(0, 19)}</em></article>) : <small>暂无手动成交</small>}</div>
    </section> : null}
    {activeView === "strategy" ? <section className="brain-quant-skills" data-testid="brain-quant-strategy">
      <header><h3>Skill 量化模拟</h3><span>对话/工作台选择 Skill → 按真 K 线自动买卖 → 这里比较收益</span></header>
      <div className="brain-quant-schedule-form">
        {skillPicker}
        <label>标的<code>{symbol}</code></label>
        <label>每笔数量<input type="number" min="1" step="100" value={quantity} onChange={(event) => setUi((current) => ({ ...current, quantity: Math.max(1, Number(event.target.value) || 1) }))} /></label>
        <button type="button" className="primary" data-testid="brain-quant-run-skill" disabled={skillRunBusy || !projectId} onClick={runSkillNow}>
          {skillRunBusy ? "Skill 模拟中…" : "立即用 Skill 自动模拟"}
        </button>
      </div>
      {skillRunStatus ? <small className="brain-quant-order-status" data-testid="brain-quant-skill-run-status">{skillRunStatus}</small> : null}
      {Object.keys(skillPerformance).length ? <div className="brain-quant-schedule-list">{Object.values(skillPerformance).sort((a: any, b: any) => Number(b.totalReturnPercent) - Number(a.totalReturnPercent)).map((item: any, index) => <article key={`performance-${item.skillId}`}><b className="brain-quant-rank">{index + 1}</b><strong>{skillLabel(item.skillId)}</strong><span>累计收益 {Number(item.totalReturnPercent).toFixed(2)}% · 最大回撤 {Number(item.maxDrawdownPercent).toFixed(2)}% · 波动率 {Number(item.volatilityPercent).toFixed(2)}%</span><em>{item.tradeCount} 笔 · 胜率 {Number(item.winRatePercent).toFixed(1)}%</em></article>)}</div> : <div className="brain-quant-empty">尚无 Skill 模拟收益。选择 Skill 后点击「立即用 Skill 自动模拟」，系统会按已加载真实行情自动买卖。</div>}
      {strategyTasks.slice(0, 5).map((task) => <small key={task.id} className="brain-quant-order-status">{String(task.taskType).replace("quant.strategy.", "")} · {task.status}{task.errorCode ? ` · ${task.errorCode}` : ""}</small>)}
    </section> : null}
    {activeView === "radar" ? <section className="brain-quant-skills"><header><h3>股市雷达</h3><span>把 Skill 挂到交易日定时自动模拟</span></header>
      <div className="brain-quant-schedule-form">
        {skillPicker}
        <label>交易所<select value={scheduleExchange} onChange={(event) => setScheduleExchange(event.target.value as "SSE" | "SZSE" | "BSE")}><option value="SSE">上交所</option><option value="SZSE">深交所</option><option value="BSE">北交所</option></select></label>
        <label>交易日执行时间<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label>
        <button type="button" disabled={!skillId.trim()} onClick={createSchedule}>创建 Skill 雷达计划</button>
        <button type="button" className="primary" disabled={skillRunBusy || !projectId} onClick={runSkillNow}>立即跑一轮 Skill</button>
      </div>
      {schedules.length ? <div className="brain-quant-schedule-list">{schedules.map((item) => { const runs = strategyRuns.filter((run) => run.scheduleId === item.id); return <article key={item.id}><strong>{skillLabel(item.skillId)}</strong><span>{item.symbol} · {item.quantity} 股 · {item.exchange} · 交易日 {item.runAt}</span><em>{item.enabled ? "运行中" : "已暂停"}</em><div className="brain-quant-radar-actions"><button type="button" onClick={() => setExpandedRadarId(expandedRadarId === item.id ? "" : item.id)}>{expandedRadarId === item.id ? "收起记录" : "查看记录"}</button><button type="button" onClick={() => setScheduleEnabled(item.id, !item.enabled)}>{item.enabled ? "暂停" : "启用"}</button></div>{expandedRadarId === item.id ? <div className="brain-quant-run-list">{runs.length ? runs.map((run) => <small key={run.idempotencyKey}>{run.tradingDate} · {run.status}{run.errorCode ? ` · ${run.errorCode}` : ""}</small>) : <small>尚无运行记录</small>}</div> : null}</article>; })}</div> : <div className="brain-quant-empty">尚未创建 Skill 雷达计划。计划只会生成模拟任务，不会连接真实券商。</div>}
      {scheduleStatus ? <small className="brain-quant-order-status">{scheduleStatus}</small> : null}
      {skillRunStatus ? <small className="brain-quant-order-status">{skillRunStatus}</small> : null}
    </section> : null}
  </main>;
}
