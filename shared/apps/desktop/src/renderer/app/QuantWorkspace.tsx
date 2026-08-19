import { useEffect, useMemo, useState } from "react";

export function QuantWorkspace({ projectId, compact = false }: { projectId?: string; compact?: boolean }) {
  const [symbol, setSymbol] = useState("600519");
  const [interval, setInterval] = useState("日线");
  const [adjustment, setAdjustment] = useState("前复权");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bars, setBars] = useState<any[]>([]);
  const [queryVersion, setQueryVersion] = useState(0);
  const [quantity, setQuantity] = useState(100);
  const [orderStatus, setOrderStatus] = useState("");
  const [portfolio, setPortfolio] = useState<any>({ cash: 100_000, marketValue: 0, totalValue: 100_000, totalReturnPercent: 0, positions: [] });
  const [status, setStatus] = useState("尚未查询行情");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [skillId, setSkillId] = useState("trend-following");
  const [scheduleTime, setScheduleTime] = useState("15:10");
  const [scheduleExchange, setScheduleExchange] = useState<"SSE" | "SZSE" | "BSE">("SSE");
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [skillPerformance, setSkillPerformance] = useState<Record<string, any>>({});
  const [strategyTasks, setStrategyTasks] = useState<any[]>([]);

  useEffect(() => {
    if (!projectId || !window.codecn?.createQuantSession || !window.codecn?.queryQuantBars) return;
    let active = true;
    const intervalValue = interval === "周线" ? "1w" : interval === "月线" ? "1mo" : "1d";
    const adjustmentValue = adjustment === "后复权" ? "backward" : adjustment === "不复权" ? "none" : "forward";
    void window.codecn.createQuantSession({ projectId, initialCash: 100_000 })
      .then(() => window.codecn.queryQuantBars({ projectId, query: { symbol, interval: intervalValue, adjustment: adjustmentValue, startDate: startDate || undefined, endDate: endDate || undefined } }))
      .then((result: any[]) => {
        if (!active) return;
        const valid = result.filter((bar) => ["open", "high", "low", "close", "volume"].every((key) => typeof bar?.[key] === "number"));
        if (valid.length) { setBars(valid.slice(-60)); setStatus(`已加载 ${valid.length} 条真实行情 · ${valid[0].source?.provider || "已配置数据源"}`); }
        else { setBars([]); setStatus("该条件下暂无已同步行情"); }
      })
      .catch(() => { if (active) { setBars([]); setStatus("行情服务暂不可用，未使用演示数据"); } });
    return () => { active = false; };
  }, [projectId, symbol, interval, adjustment, startDate, endDate, queryVersion]);

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
      const entries = await Promise.all(schedules.map(async (item) => {
        try { return [item.skillId, await window.codecn?.getQuantSkillPerformance?.({ projectId, skillId: item.skillId })] as const; }
        catch { return [item.skillId, null] as const; }
      }));
      if (active) setSkillPerformance(Object.fromEntries(entries.filter((entry) => entry[1])));
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, schedules]);

  const latest = bars.at(-1);
  const returnPercent = useMemo(() => bars.length && latest ? ((latest.close - bars[0].close) / bars[0].close * 100).toFixed(2) : "0.00", [bars, latest]);
  const chart = useMemo(() => {
    const width = 760; const priceHeight = 250; const volumeHeight = 70;
    if (!bars.length) return { width, priceHeight, volumeHeight, high: 0, low: 0, maxVolume: 1, step: width, bodyWidth: 3, y: () => 0 };
    const high = Math.max(...bars.map((bar) => bar.high)); const low = Math.min(...bars.map((bar) => bar.low));
    const span = Math.max(high - low, 1); const maxVolume = Math.max(...bars.map((bar) => Number(bar.volume)), 1);
    const step = width / Math.max(bars.length, 1); const bodyWidth = Math.max(3, Math.min(12, step * 0.55));
    return { width, priceHeight, volumeHeight, high, low, maxVolume, step, bodyWidth, y: (price: number) => 10 + ((high - price) / span) * (priceHeight - 20) };
  }, [bars]);

  const executeOrder = (side: "buy" | "sell") => {
    if (!latest) { setOrderStatus("暂无真实行情，不能生成模拟成交"); return; }
    if (!projectId || !window.codecn?.executeQuantOrder) { setOrderStatus("模拟会话尚未连接"); return; }
    void window.codecn.executeQuantOrder({ projectId, order: { id: `order-${Date.now()}`, symbol, side, quantity, price: latest.close, feeRate: 0.0003, createdAt: new Date().toISOString() } })
      .then(() => window.codecn.getQuantSnapshot?.({ projectId, prices: { [symbol]: latest.close } }))
      .then((snapshot: any) => { if (snapshot) setPortfolio(snapshot); setOrderStatus(`已模拟${side === "buy" ? "买入" : "卖出"} ${symbol} ${quantity} 股`); })
      .catch((error: unknown) => setOrderStatus(error instanceof Error ? error.message : "模拟下单失败"));
  };

  const createSchedule = () => {
    if (!projectId || !window.codecn?.createQuantStrategySchedule) { setScheduleStatus("模拟项目尚未连接"); return; }
    void window.codecn.createQuantStrategySchedule({ projectId, skillId, exchange: scheduleExchange, runAt: scheduleTime, symbol, quantity })
      .then((created: any) => { setSchedules((items) => [...items, created]); setScheduleStatus("策略计划已保存，仅进入模拟任务队列"); })
      .catch((error: unknown) => setScheduleStatus(error instanceof Error ? error.message : "策略计划保存失败"));
  };

  return <main className={`brain-quant-module${compact ? " compact" : ""}`}>
    <header className="brain-quant-header"><div><span>量化交易</span><strong>行情与模拟盘</strong></div><small>{status} · 不连接真实券商</small></header>
    <section className="brain-quant-toolbar">
      <label>代码<input value={symbol} onChange={(event) => setSymbol(event.target.value)} /></label>
      <label>周期<select value={interval} onChange={(event) => setInterval(event.target.value)}><option>日线</option><option>周线</option><option>月线</option></select></label>
      <label>复权<select value={adjustment} onChange={(event) => setAdjustment(event.target.value)}><option>前复权</option><option>后复权</option><option>不复权</option></select></label>
      <label>开始日期<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>结束日期<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <button type="button" onClick={() => setQueryVersion((value) => value + 1)}>查询行情</button>
    </section>
    <section className="brain-quant-grid">
      <div className="brain-quant-chart"><div className="brain-quant-chart-head"><strong>{symbol}</strong><span>{interval} · {adjustment} · 区间 {returnPercent}%</span></div>
        {!bars.length ? <div className="brain-quant-chart-empty"><strong>暂无行情数据</strong><span>请确认行情节点已连接，或调整代码、日期、周期和复权方式后重新查询。</span></div> : <>
        <svg viewBox={`0 0 ${chart.width} ${chart.priceHeight + chart.volumeHeight}`} role="img" aria-label={`${symbol} K线和成交量图`} preserveAspectRatio="none">{bars.map((bar, index) => { const x = chart.step * index + chart.step / 2; const up = bar.close >= bar.open; const bodyTop = chart.y(Math.max(bar.open, bar.close)); const bodyHeight = Math.max(1.5, Math.abs(chart.y(bar.open) - chart.y(bar.close))); const color = up ? "#ef4444" : "#16a34a"; const volumeHeight = (Number(bar.volume) / chart.maxVolume) * (chart.volumeHeight - 18); return <g key={`${bar.timestamp}-${index}`}><line x1={x} x2={x} y1={chart.y(bar.high)} y2={chart.y(bar.low)} stroke={color} strokeWidth="1"/><rect x={x - chart.bodyWidth / 2} y={bodyTop} width={chart.bodyWidth} height={bodyHeight} fill={color}/><rect x={x - chart.bodyWidth / 2} y={chart.priceHeight + chart.volumeHeight - volumeHeight} width={chart.bodyWidth} height={volumeHeight} fill={color} opacity="0.55"/></g>; })}</svg>
        <div className="brain-quant-chart-axis"><span>{String(bars[0].timestamp).slice(5, 10)}</span><span>最高 {chart.high.toFixed(2)} / 最低 {chart.low.toFixed(2)}</span><span>{String(latest?.timestamp).slice(5, 10)}</span></div>
        </>}
      </div>
      <aside className="brain-quant-side"><h3>模拟持仓</h3><div className="brain-quant-total"><small>总资产</small><strong>¥{portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><em>{portfolio.totalReturnPercent >= 0 ? "+" : ""}{portfolio.totalReturnPercent.toFixed(2)}%</em></div>
        <dl><div><dt>可用现金</dt><dd>¥{portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>持仓市值</dt><dd>¥{portfolio.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>累计收益</dt><dd className={portfolio.totalValue >= 100_000 ? "positive" : "negative"}>{portfolio.totalValue >= 100_000 ? "+" : ""}¥{(portfolio.totalValue - 100_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div></dl>
        <div className="brain-quant-order-controls"><label>数量<input type="number" min="1" step="100" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}/></label><button type="button" className="primary" onClick={() => executeOrder("buy")}>模拟买入</button><button type="button" onClick={() => executeOrder("sell")}>模拟卖出</button></div>
        {portfolio.positions?.length ? <ul className="brain-quant-position-list">{portfolio.positions.map((position: any) => <li key={position.symbol}><strong>{position.symbol}</strong><span>{position.quantity} 股</span><em className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{position.unrealizedPnl >= 0 ? "+" : ""}¥{position.unrealizedPnl.toFixed(2)}</em></li>)}</ul> : <small>暂无模拟持仓</small>}
        {orderStatus ? <small className="brain-quant-order-status">{orderStatus}</small> : null}
      </aside>
    </section>
    <section className="brain-quant-skills"><header><h3>Skill 自动模拟</h3><span>每个 Skill 使用独立的同额初始资金，不连接真实券商</span></header>
      <div className="brain-quant-schedule-form">
        <label>Skill 标识<input value={skillId} onChange={(event) => setSkillId(event.target.value)} /></label>
        <label>交易所<select value={scheduleExchange} onChange={(event) => setScheduleExchange(event.target.value as "SSE" | "SZSE" | "BSE")}><option value="SSE">上交所</option><option value="SZSE">深交所</option><option value="BSE">北交所</option></select></label>
        <label>交易日执行时间<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label>
        <button type="button" disabled={!skillId.trim()} onClick={createSchedule}>创建模拟计划</button>
      </div>
      {schedules.length ? <div className="brain-quant-schedule-list">{schedules.map((item) => <article key={item.id}><strong>{item.skillId}</strong><span>{item.symbol} · {item.quantity} 股 · {item.exchange} · 交易日 {item.runAt}</span><em>{item.enabled ? "已启用" : "已停用"}</em></article>)}</div> : <div className="brain-quant-empty">尚未创建量化 Skill 计划。计划只会生成模拟任务，并以“计划 + 交易日期”防止重复运行。</div>}
      {Object.keys(skillPerformance).length ? <div className="brain-quant-schedule-list">{Object.values(skillPerformance).map((item: any) => <article key={`performance-${item.skillId}`}><strong>{item.skillId} 收益</strong><span>累计 {Number(item.totalReturnPercent).toFixed(2)}% · 最大回撤 {Number(item.maxDrawdownPercent).toFixed(2)}% · {item.tradeCount} 笔</span><em>胜率 {Number(item.winRatePercent).toFixed(1)}%</em></article>)}</div> : null}
      {strategyTasks.slice(0, 5).map((task) => <small key={task.id} className="brain-quant-order-status">{String(task.taskType).replace("quant.strategy.", "")} · {task.status}{task.errorCode ? ` · ${task.errorCode}` : ""}</small>)}
      {scheduleStatus ? <small className="brain-quant-order-status">{scheduleStatus}</small> : null}
    </section>
  </main>;
}
