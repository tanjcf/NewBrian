import { useEffect, useMemo, useState } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
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
  notes: Array<{ id: string; title: string; content: string; symbol?: string; createdAt: string }>;
  watchlistGroups: Array<{ id: string; name: string; symbols: string[] }>;
  activeWatchlistGroupId: string;
};

const DATE_RANGE_PRESET = "end-today-start-12m";
const MARKET_OVERVIEW_VIEWS = [
  { id: "indices", label: "大盘指数" },
  { id: "industries", label: "行业板块" },
  { id: "concepts", label: "概念板块" },
  { id: "fundFlows", label: "资金流向" },
  { id: "limitUps", label: "涨停池" }
] as const;
type MarketOverviewView = typeof MARKET_OVERVIEW_VIEWS[number]["id"];

const defaultQuantUi: QuantUiState = {
  symbol: "600519",
  interval: "日线",
  adjustment: "前复权",
  startDate: "",
  endDate: "",
  quantity: 100,
  notes: [],
  watchlistGroups: [{ id: "default", name: "默认自选", symbols: ["600519"] }],
  activeWatchlistGroupId: "default",
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
  activeView?: "market" | "portfolio" | "strategy" | "radar" | "research";
}) {
  const { state: ui, setState: setUi, hydrated } = useWorkspaceSceneState(projectId || workspaceId, "quant", defaultQuantUi);
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
  const [projectSkills, setProjectSkills] = useState<Array<{ id: string; label: string; detail: string; strategyId?: string }>>([]);
  const [strategyTasks, setStrategyTasks] = useState<any[]>([]);
  const [strategyRuns, setStrategyRuns] = useState<any[]>([]);
  const [expandedRadarId, setExpandedRadarId] = useState("");
  const [skillRunStatus, setSkillRunStatus] = useState("");
  const [skillRunBusy, setSkillRunBusy] = useState(false);
  const [dayPathBar, setDayPathBar] = useState<any | null>(null);
  const [drillHint, setDrillHint] = useState("");
  const [watchlistQuotes, setWatchlistQuotes] = useState<Record<string, any>>({});
  const [watchlistStatus, setWatchlistStatus] = useState("");
  const [creatingWatchlistGroup, setCreatingWatchlistGroup] = useState(false);
  const [newWatchlistGroupName, setNewWatchlistGroupName] = useState("新分组");
  const [marketOverview, setMarketOverview] = useState<Record<string, any> | null>(null);
  const [marketOverviewView, setMarketOverviewView] = useState<MarketOverviewView>("indices");
  const [marketOverviewStatus, setMarketOverviewStatus] = useState("点击刷新后读取真实大盘数据");
  const [marketOverviewBusy, setMarketOverviewBusy] = useState(false);
  const [screenerCriteria, setScreenerCriteria] = useState({ minPrice: "", maxPrice: "", minChangePercent: "0", minTurnoverRate: "", maxPe: "", maxPb: "" });
  const [screenerResult, setScreenerResult] = useState<any>(null);
  const [screenerStatus, setScreenerStatus] = useState("尚未运行选股");
  const [screenerBusy, setScreenerBusy] = useState(false);
  const latest = bars.at(-1);
  const watchlistGroups = Array.isArray(ui.watchlistGroups) && ui.watchlistGroups.length
    ? ui.watchlistGroups
    : defaultQuantUi.watchlistGroups;
  const activeWatchlistGroup = watchlistGroups.find((group) => group.id === ui.activeWatchlistGroupId)
    || watchlistGroups[0];
  const isSymbolWatched = Boolean(activeWatchlistGroup?.symbols.includes(symbol));

  const refreshWatchlistQuotes = async () => {
    if (!window.newbrain?.queryQuantBars || !activeWatchlistGroup?.symbols.length) {
      setWatchlistQuotes({});
      return;
    }
    setWatchlistStatus("正在读取真实行情…");
    const entries = await Promise.all(activeWatchlistGroup.symbols.map(async (item) => {
      try {
        const result = await window.newbrain.queryQuantBars({
          query: { symbol: item, interval: "1d", adjustment: "none", startDate: startDate || undefined, endDate: endDate || undefined }
        });
        const bars = Array.isArray(result) ? result.filter((bar) => typeof bar?.close === "number") : [];
        const latestBar = bars.at(-1);
        const previousBar = bars.at(-2);
        if (!latestBar) return [item, null] as const;
        return [item, {
          symbol: item,
          timestamp: latestBar.timestamp,
          price: latestBar.close,
          changePercent: typeof latestBar.changePercent === "number"
            ? latestBar.changePercent
            : previousBar?.close ? ((latestBar.close - previousBar.close) / previousBar.close) * 100 : 0,
          volume: latestBar.volume,
          high: latestBar.high,
          low: latestBar.low,
          source: latestBar.source?.provider || "行情网关"
        }] as const;
      } catch {
        return [item, null] as const;
      }
    }));
    const next = Object.fromEntries(entries.filter((entry) => entry[1]));
    setWatchlistQuotes(next);
    setWatchlistStatus(Object.keys(next).length ? `已更新 ${Object.keys(next).length} 只 · 真实行情` : "暂无可用行情");
  };

  const refreshMarketOverview = async () => {
    if (!window.newbrain?.queryQuantMarketOverview) {
      setMarketOverviewStatus("大盘服务不可用");
      return;
    }
    setMarketOverviewBusy(true);
    setMarketOverviewStatus("正在通过 Spring 读取 AKShare…");
    try {
      const result = await window.newbrain.queryQuantMarketOverview({ limit: 20 });
      setMarketOverview(result && typeof result === "object" ? result as Record<string, any> : null);
      setMarketOverviewStatus("已读取真实大盘数据");
    } catch (error) {
      setMarketOverview(null);
      setMarketOverviewStatus(`大盘服务暂不可用：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMarketOverviewBusy(false);
    }
  };

  const marketSection = marketOverview?.[marketOverviewView] as any;
  const marketItems = Array.isArray(marketSection?.items) ? marketSection.items : [];
  const formatMarketNumber = (value: unknown, digits = 2) => typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "--";
  const chooseTradableMarketSymbol = (value: unknown) => {
    const code = String(value || "").trim();
    if (!/^\d{6}$/u.test(code)) return;
    setUi((current) => ({ ...current, symbol: code }));
  };
  const runScreener = async () => {
    if (!window.newbrain?.queryQuantMarketScreener) { setScreenerStatus("选股服务不可用"); return; }
    const criteria = Object.fromEntries(Object.entries(screenerCriteria).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
    setScreenerBusy(true); setScreenerStatus("正在读取 AKShare A 股快照…");
    try { const result = await window.newbrain.queryQuantMarketScreener({ criteria: { ...criteria, limit: 30 } }); setScreenerResult(result); setScreenerStatus(`已筛选 ${Array.isArray(result?.items) ? result.items.length : 0} 只真实股票`); }
    catch (error) { setScreenerResult(null); setScreenerStatus(`选股失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setScreenerBusy(false); }
  };
  useEffect(() => {
    if (!window.newbrain?.onQuantScreenerUpdated) return;
    return window.newbrain.onQuantScreenerUpdated((payload: any) => { if (!payload?.result) return; setScreenerResult(payload.result); setScreenerStatus(`AI 已筛选 ${Array.isArray(payload.result.items) ? payload.result.items.length : 0} 只真实股票`); });
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshWatchlistQuotes();
  }, [hydrated, projectId, activeWatchlistGroup?.id, activeWatchlistGroup?.symbols.join(","), startDate, endDate]);

  const updateWatchlistGroups = (update: (groups: Array<{ id: string; name: string; symbols: string[] }>) => Array<{ id: string; name: string; symbols: string[] }>) => {
    setUi((current) => {
      const currentGroups = Array.isArray(current.watchlistGroups) && current.watchlistGroups.length
        ? current.watchlistGroups
        : defaultQuantUi.watchlistGroups;
      return { ...current, watchlistGroups: update(currentGroups) };
    });
  };

  const addCurrentToWatchlist = () => {
    const normalized = symbol.trim();
    if (!normalized || !activeWatchlistGroup) return;
    updateWatchlistGroups((groups) => groups.map((group) => group.id === activeWatchlistGroup.id && !group.symbols.includes(normalized)
      ? { ...group, symbols: [...group.symbols, normalized] }
      : group));
  };

  const removeCurrentFromWatchlist = () => {
    if (!activeWatchlistGroup) return;
    updateWatchlistGroups((groups) => groups.map((group) => group.id === activeWatchlistGroup.id
      ? { ...group, symbols: group.symbols.filter((item) => item !== symbol) }
      : group));
  };

  const createWatchlistGroup = () => {
    // Electron renderer does not support window.prompt; an inline form is required.
    setNewWatchlistGroupName("新分组");
    setCreatingWatchlistGroup(true);
  };

  const confirmCreateWatchlistGroup = () => {
    const name = newWatchlistGroupName.trim() || "新分组";
    const id = `watchlist-${Date.now()}`;
    setUi((current) => {
      const currentGroups = Array.isArray(current.watchlistGroups) && current.watchlistGroups.length
        ? current.watchlistGroups
        : defaultQuantUi.watchlistGroups;
      return {
        ...current,
        watchlistGroups: [...currentGroups, { id, name, symbols: [] }],
        activeWatchlistGroupId: id
      };
    });
    setCreatingWatchlistGroup(false);
    setNewWatchlistGroupName("新分组");
  };

  const cancelCreateWatchlistGroup = () => {
    setCreatingWatchlistGroup(false);
    setNewWatchlistGroupName("新分组");
  };

  useEffect(() => {
    setDayPathBar(null);
  }, [symbol, interval, startDate, endDate, queryVersion]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.onQuantMarketUpdated) return;
    return window.newbrain.onQuantMarketUpdated((payload) => {
      // The model runtime uses the local workspace id, while the Brain panel
      // may be keyed by a Brain project id. This panel is the active quant
      // surface, so a completed quant tool result must be applied here even
      // when those two identifiers differ.
      if (!Array.isArray(payload.bars)) return;
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
    if (!projectId || !window.newbrain?.onQuantPortfolioUpdated) return;
    return window.newbrain.onQuantPortfolioUpdated((payload: any) => {
      if (payload?.note?.id) {
        setUi((current) => ({
          ...current,
          notes: [payload.note, ...(Array.isArray(current.notes) ? current.notes : []).filter((note) => note.id !== payload.note.id)]
        }));
      }
      if (!payload?.skillId) return;
      const id = String(payload.skillId);
      if (payload.schedule?.id) {
        setSchedules((current) => {
          const index = current.findIndex((item) => item.id === payload.schedule.id);
          if (index < 0) return [...current, payload.schedule];
          return current.map((item, itemIndex) => itemIndex === index ? payload.schedule : item);
        });
      }
      if (payload.deleted === true) {
        setSkillPortfolios((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setSkillActivities((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setSkillTitles((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        setSkillPerformance((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        return;
      }
      if (!payload?.activity?.snapshot) return;
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
    if (!projectId || !window.newbrain?.createQuantSession || !window.newbrain?.getQuantActivity) return;
    let active = true;
    void window.newbrain.createQuantSession({ projectId, initialCash: 100_000 })
      .then(() => window.newbrain.getQuantActivity?.({ projectId, prices: {} }))
      .then((activity: any) => {
        if (!active || !activity) return;
        setPortfolio(activity.snapshot);
        setPortfolioActivity(activity);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    if (!hydrated || !window.newbrain?.queryQuantBars) return;
    let active = true;
    const intervalValue = interval === "周线" ? "1w" : interval === "月线" ? "1mo" : "1d";
    const adjustmentValue = adjustment === "后复权" ? "backward" : adjustment === "不复权" ? "none" : "forward";
    void window.newbrain.queryQuantBars({ query: { symbol, interval: intervalValue, adjustment: adjustmentValue, startDate: startDate || undefined, endDate: endDate || undefined } })
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
  }, [projectId, workspaceId, symbol, interval, adjustment, startDate, endDate, queryVersion, hydrated]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.getQuantActivity) return;
    const prices = latest ? { [symbol]: latest.close } : {};
    void window.newbrain.getQuantActivity({ projectId, prices }).then((activity: any) => {
      if (!activity) return;
      setPortfolio(activity.snapshot);
      setPortfolioActivity(activity);
    }).catch(() => undefined);
  }, [projectId, symbol, latest?.close]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.listQuantStrategySchedules) { setSchedules([]); return; }
    void window.newbrain.listQuantStrategySchedules({ projectId })
      .then((items: any[]) => setSchedules(Array.isArray(items) ? items : []))
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "策略计划读取失败"));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const refresh = async () => {
      try {
        const items = await window.newbrain?.listBrainTasks?.({ projectId });
        if (active) setStrategyTasks((Array.isArray(items) ? items : []).filter((item) => String(item.taskType || "").startsWith("quant.strategy.")));
      } catch { if (active) setStrategyTasks([]); }
      try {
        const runs = await window.newbrain?.listQuantStrategyRuns?.({ projectId });
        if (active) setStrategyRuns(Array.isArray(runs) ? runs : []);
      } catch { if (active) setStrategyRuns([]); }
      const skillIds = Array.from(new Set([
        ...schedules.map((item) => String(item.skillId || "")).filter(Boolean)
      ]));
      const prices = latest ? { [symbol]: latest.close } : {};
      const entries = await Promise.all(skillIds.map(async (id) => {
        try {
          const performance = await window.newbrain?.getQuantSkillPerformance?.({ projectId, skillId: id });
          return [id, performance] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (active) setSkillPerformance(Object.fromEntries(entries.filter((entry) => entry[1])));
      const portfolios = await Promise.all(skillIds.map(async (id) => {
        try {
          const activity = await window.newbrain?.getQuantSkillActivity?.({ projectId, skillId: id, prices });
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

  useEffect(() => {
    if (!projectId || !window.newbrain?.listQuantProjectSkills) {
      setProjectSkills([]);
      return;
    }
    let active = true;
    void window.newbrain.listQuantProjectSkills({ projectId }).then((items: Array<{ id: string; label: string; detail: string; strategyId?: string }>) => {
      if (!active) return;
      const next = Array.isArray(items) ? items.filter((item) => item?.id) : [];
      setProjectSkills(next);
      setSkillTitles((current) => {
        const titles = { ...current };
        for (const item of next) titles[item.id] = item.label || item.id;
        return titles;
      });
    }).catch(() => {
      if (active) setProjectSkills([]);
    });
    return () => { active = false; };
  }, [projectId]);

  const skillOptions = useMemo(() => {
    const builtin = BUILTIN_QUANT_SKILLS.map((skill) => ({ id: skill.id, label: skill.label, detail: skill.detail, strategyId: skill.id }));
    const extra = projectSkills.filter((skill) => !builtin.some((item) => item.id === skill.id));
    return [...builtin, ...extra];
  }, [projectSkills]);

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
    if (!projectId || !window.newbrain?.executeQuantOrder) { setOrderStatus("模拟会话尚未连接"); return; }
    void window.newbrain.executeQuantOrder({ projectId, order: { id: `order-${Date.now()}`, symbol, side, quantity, price: latest.close, feeRate: 0.0003, createdAt: new Date().toISOString() } })
      .then(() => window.newbrain.getQuantActivity?.({ projectId, prices: { [symbol]: latest.close } }))
      .then((activity: any) => { if (activity) { setPortfolio(activity.snapshot); setPortfolioActivity(activity); } setOrderStatus(`已手动模拟${side === "buy" ? "买入" : "卖出"} ${symbol} ${quantity} 股（对照盘，不含 Skill）`); })
      .catch((error: unknown) => setOrderStatus(error instanceof Error ? error.message : "模拟下单失败"));
  };

  const setScheduleEnabled = (scheduleId: string, enabled: boolean) => {
    if (!projectId || !window.newbrain?.setQuantStrategyScheduleEnabled) return;
    void window.newbrain.setQuantStrategyScheduleEnabled({ projectId, scheduleId, enabled })
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
    if (!projectId || !window.newbrain?.createQuantStrategySchedule) { setScheduleStatus("模拟项目尚未连接"); return; }
    if (!skillId.trim()) { setScheduleStatus("请选择量化 Skill"); return; }
    void window.newbrain.createQuantStrategySchedule({ projectId, skillId, exchange: scheduleExchange, runAt: scheduleTime, symbol, quantity })
      .then((created: any) => { setSchedules((items) => [...items, created]); setScheduleStatus(`已绑定 Skill「${skillId}」到雷达计划，交易日将自动模拟买卖`); })
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "策略计划保存失败"));
  };

  const runSkillNow = () => {
    if (!projectId || !window.newbrain?.runQuantSkillSimulation) {
      setSkillRunStatus("当前构建未接入 Skill 模拟 IPC");
      return;
    }
    if (!skillId.trim()) {
      setSkillRunStatus("请选择量化 Skill");
      return;
    }
    const selectedSkill = skillOptions.find((item) => item.id === skillId);
    const builtinSignal = BUILTIN_QUANT_SKILLS.some((item) => item.id === skillId);
    if (selectedSkill && !builtinSignal && !selectedSkill.strategyId) {
      setSkillRunStatus(`「${selectedSkill.label}」是项目规则包，没有买卖信号，不能直接自动模拟。请改选趋势跟踪、均值回归，或带策略的组合 Skill。`);
      return;
    }
    setSkillRunBusy(true);
    setSkillRunStatus(`正在用 Skill「${selectedSkill?.label || skillId}」按真实行情自动模拟买卖…`);
    void window.newbrain.runQuantSkillSimulation({
      projectId,
      skillId,
      title: selectedSkill?.label || skillId,
      strategyId: builtinSignal ? skillId : selectedSkill?.strategyId,
      symbol,
      quantity,
      query: marketQuery,
      reset: true
    }).then(async (result: any) => {
      setSkillPerformance((current) => ({ ...current, [skillId]: result.performance }));
      setSkillPortfolios((current) => ({ ...current, [skillId]: result.snapshot }));
      try {
        const activity = await window.newbrain.getQuantSkillActivity?.({
          projectId,
          skillId,
          prices: latest ? { [symbol]: latest.close } : {}
        });
        if (activity) setSkillActivities((current) => ({ ...current, [skillId]: activity }));
      } catch { /* performance already set */ }
      setSkillRunStatus(`Skill「${skillId}」完成：${result.tradeCount} 笔自动成交 · 收益 ${Number(result.performance.totalReturnPercent).toFixed(2)}% · 基于 ${result.barCount} 根真 K 线 · 已写入 .newbrain/skills/${skillId}/`);
      try {
        const listed = await window.newbrain.listQuantProjectSkills?.({ projectId });
        if (Array.isArray(listed)) {
          setProjectSkills(listed.filter((item: { id?: string }) => item?.id));
        }
      } catch { /* dropdown refresh is best-effort */ }
    }).catch((error: unknown) => {
      setSkillRunStatus(error instanceof Error ? error.message : "Skill 模拟失败");
    }).finally(() => setSkillRunBusy(false));
  };

  const skillLabel = (id: string) => skillOptions.find((item) => item.id === id)?.label || skillTitles[id] || id;

  const portfolioPanel = <aside className="brain-quant-side"><h3>手动对照盘</h3><p className="brain-quant-side-note">仅用于人工试单对照。正式量化请用 Skill 自动模拟。</p><div className="brain-quant-total"><small>总资产</small><strong>¥{portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><em>{portfolio.totalReturnPercent >= 0 ? "+" : ""}{portfolio.totalReturnPercent.toFixed(2)}%</em></div>
    <dl><div><dt>可用现金</dt><dd>¥{portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>持仓市值</dt><dd>¥{portfolio.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>累计收益</dt><dd className={portfolio.totalValue >= 100_000 ? "positive" : "negative"}>{portfolio.totalValue >= 100_000 ? "+" : ""}¥{(portfolio.totalValue - 100_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div></dl>
    <div className="brain-quant-order-controls"><label>数量<input data-testid="brain-quant-order-quantity" type="number" min="1" step="100" value={quantity} onChange={(event) => setUi((current) => ({ ...current, quantity: Math.max(1, Number(event.target.value) || 1) }))}/></label><button data-testid="brain-quant-buy" type="button" className="primary" onClick={() => executeOrder("buy")}>手动买入</button><button data-testid="brain-quant-sell" type="button" onClick={() => executeOrder("sell")}>手动卖出</button></div>
    {portfolio.positions?.length ? <ul className="brain-quant-position-list" data-testid="brain-quant-positions">{portfolio.positions.map((position: any) => <li key={position.symbol}><strong>{position.symbol}</strong><span>{position.quantity} 股</span><em className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{position.unrealizedPnl >= 0 ? "+" : ""}¥{position.unrealizedPnl.toFixed(2)}</em></li>)}</ul> : <small>暂无手动持仓</small>}
    {orderStatus ? <small className="brain-quant-order-status">{orderStatus}</small> : null}
  </aside>;

  const skillPicker = (
    <label className="brain-quant-skill-picker">Skill
      <select data-testid="brain-quant-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
        {skillOptions.map((skill) => <option key={skill.id} value={skill.id}>{skill.label}（{skill.id}）</option>)}
      </select>
      <small>{skillOptions.find((item) => item.id === skillId)?.detail}</small>
    </label>
  );

  return <main className={`brain-quant-module${compact ? " compact" : ""}`} data-testid="brain-quant-workspace" data-active-view={activeView}>
    <header className="brain-quant-header"><div><span>量化交易</span><strong>{activeView === "market" ? "行情分析" : activeView === "portfolio" ? "模拟组合" : activeView === "strategy" ? "Skill 策略" : activeView === "research" ? "研究笔记" : "股市雷达"}</strong></div><small data-testid="brain-quant-market-status">{status} · 不连接真实券商</small></header>
    {activeView === "market" ? <><section className="brain-quant-toolbar">
      <label>代码<input value={symbol} onChange={(event) => setUi((current) => ({ ...current, symbol: event.target.value }))} /></label>
      <label>周期<select value={interval} onChange={(event) => setUi((current) => ({ ...current, interval: event.target.value }))}><option>日线</option><option>周线</option><option>月线</option></select></label>
      <label>复权<select value={adjustment} onChange={(event) => setUi((current) => ({ ...current, adjustment: event.target.value }))}><option>前复权</option><option>后复权</option><option>不复权</option></select></label>
      <label>开始日期<input type="date" value={startDate} onChange={(event) => setUi((current) => ({ ...current, startDate: event.target.value }))} /></label>
      <label>结束日期<input type="date" value={endDate} onChange={(event) => setUi((current) => ({ ...current, endDate: event.target.value }))} /></label>
      <button type="button" onClick={() => setQueryVersion((value) => value + 1)}>查询行情</button>
    </section>
    <section className="brain-quant-watchlist" data-testid="brain-quant-watchlist">
      <div className="brain-quant-section-title">
        <h3>自选股</h3>
        <button type="button" className="brain-quant-section-action" onClick={createWatchlistGroup} disabled={creatingWatchlistGroup}>新建分组</button>
      </div>
      {creatingWatchlistGroup ? (
        <div className="brain-quant-watchlist-create" data-testid="brain-quant-watchlist-create">
          <input
            autoFocus
            aria-label="自选股分组名称"
            value={newWatchlistGroupName}
            onChange={(event) => setNewWatchlistGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmCreateWatchlistGroup();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelCreateWatchlistGroup();
              }
            }}
            placeholder="输入分组名称"
          />
          <button type="button" className="brain-quant-watchlist-action primary" onClick={confirmCreateWatchlistGroup}>创建</button>
          <button type="button" className="brain-quant-watchlist-action" onClick={cancelCreateWatchlistGroup}>取消</button>
        </div>
      ) : null}
      <div className="brain-quant-watchlist-groups" role="tablist" aria-label="自选分组">
        {watchlistGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={group.id === activeWatchlistGroup?.id}
            className={group.id === activeWatchlistGroup?.id ? "active" : ""}
            onClick={() => setUi((current) => ({ ...current, activeWatchlistGroupId: group.id, symbol: group.symbols[0] || current.symbol }))}
          >
            <span>{group.name}</span>
            <em>{group.symbols.length}</em>
          </button>
        ))}
      </div>
      <div className="brain-quant-watchlist-symbols">
        {activeWatchlistGroup?.symbols.length ? activeWatchlistGroup.symbols.map((item) => (
          <button key={item} type="button" className={item === symbol ? "active" : ""} onClick={() => setUi((current) => ({ ...current, symbol: item }))}>{item}</button>
        )) : <small className="brain-quant-watchlist-empty">当前分组暂无股票</small>}
        {isSymbolWatched
          ? <button type="button" className="brain-quant-watchlist-action" onClick={removeCurrentFromWatchlist}>移出当前分组</button>
          : <button type="button" className="brain-quant-watchlist-action primary" onClick={addCurrentToWatchlist}>加入当前分组</button>}
      </div>
      <div className="brain-quant-watchlist-monitor-head">
        <div>
          <strong>分组监控</strong>
          {watchlistStatus ? <span>{watchlistStatus}</span> : null}
        </div>
        <button type="button" className="brain-quant-section-action" onClick={() => void refreshWatchlistQuotes()}>刷新监控</button>
      </div>
      <div className="brain-quant-watchlist-monitor">
        {activeWatchlistGroup?.symbols.length ? activeWatchlistGroup.symbols.map((item) => {
          const quote = watchlistQuotes[item];
          return (
            <button key={item} type="button" className={item === symbol ? "active" : ""} onClick={() => setUi((current) => ({ ...current, symbol: item }))}>
              <span className="brain-quant-watchlist-quote-main">
                <strong>{item}</strong>
                {quote ? <em className={quote.changePercent >= 0 ? "positive" : "negative"}>{quote.changePercent >= 0 ? "+" : ""}{Number(quote.changePercent).toFixed(2)}%</em> : null}
              </span>
              {quote
                ? <span className="brain-quant-watchlist-quote-meta"><b>¥{Number(quote.price).toFixed(2)}</b><small>量 {Number(quote.volume).toLocaleString()}</small></span>
                : <small className="brain-quant-watchlist-quote-empty">暂无真实数据</small>}
            </button>
          );
        }) : <div className="brain-quant-watchlist-empty">添加股票后，这里会显示分组内行情</div>}
      </div>
    </section>
    <section className="brain-quant-market-overview" data-testid="brain-quant-market-overview">
      <div className="brain-quant-section-title"><h3>大盘与板块</h3><button type="button" className="brain-quant-section-action" disabled={marketOverviewBusy} onClick={() => void refreshMarketOverview()}>{marketOverviewBusy ? "刷新中…" : "刷新大盘"}</button></div>
      <div className="brain-quant-watchlist-groups">
        {MARKET_OVERVIEW_VIEWS.map((view) => <button key={view.id} type="button" className={marketOverviewView === view.id ? "active" : ""} onClick={() => setMarketOverviewView(view.id)}>{view.label}</button>)}
      </div>
      <small className="brain-quant-market-overview-status">{marketOverviewStatus}{marketSection?.dataset ? ` · ${marketSection.dataset}` : ""}{marketSection?.fetchedAt ? ` · ${String(marketSection.fetchedAt).replace("T", " ").slice(0, 19)}` : ""}</small>
      {marketSection?.error ? <div className="brain-quant-empty">该数据集读取失败：{String(marketSection.error)}</div> : null}
      {!marketSection?.error && marketItems.length ? <div className="brain-quant-market-overview-list">
        {marketItems.map((item: any, index: number) => <button key={`${marketOverviewView}-${item.code || item.name || index}`} type="button" onClick={() => chooseTradableMarketSymbol(item.code)} disabled={marketOverviewView !== "limitUps" || !/^\d{6}$/u.test(String(item.code || ""))}>
          <span><strong>{item.name || item.code || "--"}</strong><small>{item.code || ""}</small></span>
          {marketOverviewView === "fundFlows" ? <><em className={Number(item.mainNetInflow) >= 0 ? "positive" : "negative"}>{formatMarketNumber(item.mainNetInflow, 0)}</em><small>主力净流入 · {formatMarketNumber(item.mainNetInflowPercent)}%</small></> : <><em className={Number(item.changePercent) >= 0 ? "positive" : "negative"}>{typeof item.changePercent === "number" ? `${item.changePercent >= 0 ? "+" : ""}${formatMarketNumber(item.changePercent)}%` : "--"}</em><small>{marketOverviewView === "limitUps" ? `${item.industry || "未分类"}${item.limitUpCount ? ` · ${item.limitUpCount}连板` : ""}` : item.leadingStock ? `领涨 ${item.leadingStock}` : typeof item.price === "number" ? `最新 ${formatMarketNumber(item.price)}` : ""}</small></>}
        </button>)}
      </div> : !marketSection?.error ? <div className="brain-quant-empty">{marketOverview ? "该数据集暂无记录" : "尚未请求大盘数据"}</div> : null}
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
      <header><h3>Skill 选股器</h3><span>Spring → AKShare 全 A 股快照，与对话 quant.screener.run 共用数据源</span></header>
      <div className="brain-quant-screener-form">
        {([['minPrice','最低价'],['maxPrice','最高价'],['minChangePercent','最低涨幅%'],['minTurnoverRate','最低换手%'],['maxPe','最高PE'],['maxPb','最高PB']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" value={screenerCriteria[key]} onChange={(event) => setScreenerCriteria((current) => ({ ...current, [key]: event.target.value }))}/></label>)}
        <button type="button" className="primary" disabled={screenerBusy} onClick={() => void runScreener()}>{screenerBusy ? "选股中…" : "运行真实选股"}</button>
      </div>
      <small className="brain-quant-order-status">{screenerStatus}{screenerResult?.dataset ? ` · ${screenerResult.dataset}` : ""}</small>
      {Array.isArray(screenerResult?.items) && screenerResult.items.length ? <div className="brain-quant-screener-results">{screenerResult.items.map((item: any) => <button key={item.code} type="button" onClick={() => setUi((current) => ({ ...current, symbol: item.code }))}><strong>{item.name} <small>{item.code}</small></strong><span>¥{formatMarketNumber(item.price)} <em className={item.changePercent >= 0 ? "positive" : "negative"}>{item.changePercent >= 0 ? "+" : ""}{formatMarketNumber(item.changePercent)}%</em></span><small>换手 {formatMarketNumber(item.turnoverRate)}% · PE {formatMarketNumber(item.pe)} · PB {formatMarketNumber(item.pb)}</small></button>)}</div> : null}
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
    {activeView === "research" ? <section className="brain-quant-skills" data-testid="brain-quant-research-notes"><header><h3>研究笔记</h3><span>由 AI 基于真实行情、组合和雷达结果总结并写入当前项目</span></header>
      {Array.isArray(ui.notes) && ui.notes.length ? <div className="brain-quant-research-list">{ui.notes.map((note) => <article className="brain-quant-research-note" key={note.id}><header><strong>{note.title}</strong><em>{note.symbol ? `${note.symbol} · ` : ""}{String(note.createdAt).replace("T", " ").slice(0, 19)}</em></header><MarkdownMessage content={String(note.content || "")} workspaceId={workspaceId} /></article>)}</div> : <div className="brain-quant-empty">尚无研究笔记。可在对话中要求 AI 总结当前行情或模拟结果并添加笔记。</div>}
    </section> : null}
  </main>;
}
