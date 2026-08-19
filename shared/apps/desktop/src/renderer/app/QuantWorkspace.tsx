import { useEffect, useMemo, useState } from "react";

const fallbackBars = [
  { date: "08-15", open: 1682, high: 1708, low: 1674, close: 1698, volume: "2.1M" },
  { date: "08-16", open: 1698, high: 1721, low: 1691, close: 1714, volume: "2.4M" },
  { date: "08-17", open: 1714, high: 1730, low: 1702, close: 1722, volume: "1.8M" },
  { date: "08-18", open: 1722, high: 1744, low: 1710, close: 1738, volume: "2.7M" },
  { date: "08-19", open: 1738, high: 1752, low: 1728, close: 1746, volume: "2.3M" }
];

export function QuantWorkspace({ projectId }: { projectId?: string }) {
  const [symbol, setSymbol] = useState("600519");
  const [interval, setInterval] = useState("日线");
  const [adjustment, setAdjustment] = useState("前复权");
  const [bars, setBars] = useState(fallbackBars);
  const [orderStatus, setOrderStatus] = useState("");
  const [portfolio, setPortfolio] = useState({ cash: 84986.2, marketValue: 17500, totalValue: 102486.2, totalReturnPercent: 2.49 });
  const [status, setStatus] = useState("本地演示数据");
  useEffect(() => {
    if (!projectId || !window.codecn?.createQuantSession || !window.codecn?.queryQuantBars) return;
    let active = true;
    void window.codecn.createQuantSession({ projectId, initialCash: 100_000 }).then(() => window.codecn.queryQuantBars({ projectId, query: { symbol, interval: "1d", adjustment: "forward" } })).then((result: any[]) => {
      if (!active) return;
      const valid = result.filter((bar) => ["open", "high", "low", "close", "volume"].every((key) => typeof bar?.[key] === "number"));
      if (valid.length) { setBars(valid.slice(-30)); setStatus(`已加载 ${valid.length} 条真实行情`); }
      else { setBars(fallbackBars); setStatus("暂无已同步行情，显示演示数据"); }
    }).catch(() => { if (active) { setBars(fallbackBars); setStatus("行情服务暂不可用，显示演示数据"); } });
    return () => { active = false; };
  }, [projectId, symbol]);
  const latest = bars.at(-1)!;
  const returnPercent = useMemo(() => ((latest.close - bars[0].close) / bars[0].close * 100).toFixed(2), [latest.close]);
  return <main className="brain-quant-module">
    <header className="brain-quant-header"><div><span>量化交易</span><strong>行情与模拟盘</strong></div><small>{status} · 不连接真实券商</small></header>
    <section className="brain-quant-toolbar">
      <label>代码<input value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label>
      <label>周期<select value={interval} onChange={(e) => setInterval(e.target.value)}><option>日线</option><option>周线</option><option>月线</option></select></label>
      <label>复权<select value={adjustment} onChange={(e) => setAdjustment(e.target.value)}><option>前复权</option><option>后复权</option><option>不复权</option></select></label>
      <button type="button">查询行情</button>
    </section>
    <section className="brain-quant-grid">
      <div className="brain-quant-chart"><div className="brain-quant-chart-head"><strong>{symbol} 贵州茅台</strong><span>{interval} · {adjustment}</span></div><div className="brain-quant-candles" aria-label="K线图">{bars.map((bar) => <div className="brain-quant-candle" key={bar.date}><i style={{ height: `${Math.max(18, bar.high - bar.low)}px`, marginTop: `${Math.max(4, 70 - bar.high + 1720)}px` }} /><b className={bar.close >= bar.open ? "up" : "down"} style={{ height: `${Math.max(8, Math.abs(bar.close - bar.open))}px` }} /><small>{bar.date}</small></div>)}</div><div className="brain-quant-volume">{bars.map((bar) => <i key={bar.date} style={{ height: `${20 + Number.parseFloat(bar.volume) * 8}px` }} />)}</div></div>
      <aside className="brain-quant-side"><h3>模拟持仓</h3><div className="brain-quant-total"><small>总资产</small><strong>¥{portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong><em>+{portfolio.totalReturnPercent.toFixed(2)}%</em></div><dl><div><dt>可用现金</dt><dd>¥{portfolio.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>持仓市值</dt><dd>¥{portfolio.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div><div><dt>累计收益</dt><dd className="positive">+¥{(portfolio.totalValue - 100000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd></div></dl><button type="button" className="primary" onClick={() => {
        if (!projectId || !window.codecn?.executeQuantOrder) { setOrderStatus("模拟会话尚未连接"); return; }
        void window.codecn.executeQuantOrder({ projectId, order: { id: `order-${Date.now()}`, symbol, side: "buy", quantity: 100, price: latest.close, feeRate: 0.0003, createdAt: new Date().toISOString() } })
          .then(() => window.codecn.getQuantSnapshot?.({ projectId, prices: { [symbol]: latest.close } }))
          .then((snapshot: any) => { if (snapshot) setPortfolio(snapshot); setOrderStatus(`已模拟买入 ${symbol} 100 股`); }).catch((error: unknown) => setOrderStatus(error instanceof Error ? error.message : "模拟下单失败"));
      }}>模拟买入 100 股</button>{orderStatus ? <small className="brain-quant-order-status">{orderStatus}</small> : null}</aside>
    </section>
    <section className="brain-quant-skills"><header><h3>Skill 模拟表现</h3><span>按同一初始资金比较</span></header><table><thead><tr><th>Skill</th><th>收益率</th><th>最大回撤</th><th>交易次数</th><th>胜率</th></tr></thead><tbody><tr><td>趋势跟踪</td><td className="positive">+12.40%</td><td>-4.81%</td><td>28</td><td>57.1%</td></tr><tr><td>均值回归</td><td className="positive">+8.16%</td><td>-6.20%</td><td>41</td><td>53.7%</td></tr></tbody></table></section>
  </main>;
}
