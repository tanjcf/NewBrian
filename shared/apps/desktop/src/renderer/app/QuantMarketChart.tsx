import { useMemo, useRef, useState, type MouseEvent } from "react";
import {
  drillTargetForBar,
  type IntervalLabel,
  type QuantChartBar,
  type QuantChartDrillTarget
} from "./QuantMarketChart.logic.ts";

export type { QuantChartBar, QuantChartDrillTarget, IntervalLabel };
export { drillTargetForBar };

type Props = {
  symbol: string;
  interval: IntervalLabel;
  adjustment: string;
  bars: QuantChartBar[];
  returnPercent: string;
  onDrill: (target: QuantChartDrillTarget) => void;
  onExitDayPath?: () => void;
  dayPathBar?: QuantChartBar | null;
  drillHint?: string;
};

export function QuantMarketChart({
  symbol,
  interval,
  adjustment,
  bars,
  returnPercent,
  onDrill,
  onExitDayPath,
  dayPathBar,
  drillHint
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [crosshairOn, setCrosshairOn] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number; index: number } | null>(null);

  const chart = useMemo(() => {
    const width = 760;
    const priceHeight = 250;
    const volumeHeight = 70;
    if (!bars.length) {
      return { width, priceHeight, volumeHeight, high: 0, low: 0, maxVolume: 1, step: width, bodyWidth: 3, y: () => 0 };
    }
    const high = Math.max(...bars.map((bar) => bar.high));
    const low = Math.min(...bars.map((bar) => bar.low));
    const span = Math.max(high - low, 1e-9);
    const maxVolume = Math.max(...bars.map((bar) => Number(bar.volume)), 1);
    const step = width / Math.max(bars.length, 1);
    const bodyWidth = Math.max(3, Math.min(12, step * 0.55));
    return {
      width,
      priceHeight,
      volumeHeight,
      high,
      low,
      maxVolume,
      step,
      bodyWidth,
      y: (price: number) => 10 + ((high - price) / span) * (priceHeight - 20)
    };
  }, [bars]);

  const dayPath = useMemo(() => {
    if (!dayPathBar) return null;
    const width = 760;
    const priceHeight = 250;
    const volumeHeight = 70;
    const { open, high, low, close, volume } = dayPathBar;
    const span = Math.max(high - low, 1e-9);
    const y = (price: number) => 10 + ((high - price) / span) * (priceHeight - 20);
    const points = [
      { x: width * 0.12, price: open, label: "开" },
      { x: width * 0.38, price: high, label: "高" },
      { x: width * 0.62, price: low, label: "低" },
      { x: width * 0.88, price: close, label: "收" }
    ];
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${y(point.price)}`).join(" ");
    const volumeHeightPx = Math.max(8, (Number(volume) > 0 ? 0.7 : 0.2) * (volumeHeight - 18));
    return { width, priceHeight, volumeHeight, high, low, points, path, y, volumeHeightPx, up: close >= open };
  }, [dayPathBar]);

  const totalHeight = chart.priceHeight + chart.volumeHeight;
  const hoverBar = pointer && bars[pointer.index] ? bars[pointer.index] : null;

  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * chart.width;
    const y = ((clientY - rect.top) / rect.height) * totalHeight;
    return { x, y };
  };

  const indexAtX = (x: number) => {
    if (!bars.length) return 0;
    return Math.max(0, Math.min(bars.length - 1, Math.floor(x / chart.step)));
  };

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (dayPathBar) return;
    const point = clientToSvg(event.clientX, event.clientY);
    if (!point) return;
    setPointer({ x: point.x, y: point.y, index: indexAtX(point.x) });
  };

  const handleLeave = () => {
    if (!crosshairOn) setPointer(null);
  };

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    if (dayPathBar) return;
    const point = clientToSvg(event.clientX, event.clientY);
    if (!point || !bars.length) return;
    const index = indexAtX(point.x);
    const bar = bars[index];
    if (!bar) return;
    setCrosshairOn(true);
    setPointer({ x: point.x, y: point.y, index });
    onDrill(drillTargetForBar(interval, bar));
  };

  const drillLabel =
    interval === "月线" ? "点击量柱 → 当月周走势"
      : interval === "周线" ? "点击量柱 → 当周日走势"
        : "点击量柱 → 当天开高低收走势";

  return (
    <div className="brain-quant-chart" data-testid="brain-quant-market-chart-panel">
      <div className="brain-quant-chart-head">
        <strong>{symbol}</strong>
        <span>{interval} · {adjustment} · 区间 {returnPercent}%</span>
      </div>
      {!bars.length && !dayPathBar ? (
        <div className="brain-quant-chart-empty">
          <strong>暂无行情数据</strong>
          <span>请确认行情节点已连接，或调整代码、日期、周期和复权方式后重新查询。</span>
        </div>
      ) : dayPath ? (
        <>
          <div className="brain-quant-chart-tools">
            <small data-testid="brain-quant-drill-hint">{drillHint || (dayPathBar && `天走势 · ${String(dayPathBar.timestamp).slice(0, 10)}`)}</small>
            <button type="button" data-testid="brain-quant-exit-day-path" onClick={() => onExitDayPath?.()}>返回日线</button>
          </div>
          <svg
            data-testid="brain-quant-market-chart"
            viewBox={`0 0 ${dayPath.width} ${dayPath.priceHeight + dayPath.volumeHeight}`}
            role="img"
            aria-label={`${symbol} 当日开高低收路径`}
            preserveAspectRatio="none"
          >
            <path d={dayPath.path} fill="none" stroke={dayPath.up ? "#ef4444" : "#16a34a"} strokeWidth="2.5" />
            {dayPath.points.map((point) => (
              <g key={point.label}>
                <circle cx={point.x} cy={dayPath.y(point.price)} r="4" fill={dayPath.up ? "#ef4444" : "#16a34a"} />
                <text x={point.x} y={dayPath.y(point.price) - 10} textAnchor="middle" fontSize="11" fill="currentColor">{point.label} {point.price.toFixed(2)}</text>
              </g>
            ))}
            <rect
              x={dayPath.width * 0.45}
              y={dayPath.priceHeight + dayPath.volumeHeight - dayPath.volumeHeightPx}
              width={dayPath.width * 0.1}
              height={dayPath.volumeHeightPx}
              fill={dayPath.up ? "#ef4444" : "#16a34a"}
              opacity="0.55"
            />
          </svg>
          <div className="brain-quant-chart-axis">
            <span>开 {dayPathBar!.open.toFixed(2)}</span>
            <span>最高 {dayPath.high.toFixed(2)} / 最低 {dayPath.low.toFixed(2)}</span>
            <span>收 {dayPathBar!.close.toFixed(2)}</span>
          </div>
          <small className="brain-quant-chart-note">分钟线行情未接入；此为当日已同步开/高/低/收路径，非分时成交。</small>
        </>
      ) : (
        <>
          <div className="brain-quant-chart-tools">
            <small data-testid="brain-quant-drill-hint">{drillHint || (crosshairOn ? "十字线已开启 · 移动查看高低价 · " : "点击开启十字线 · ") + drillLabel}</small>
            {crosshairOn ? <button type="button" onClick={() => { setCrosshairOn(false); setPointer(null); }}>关闭十字线</button> : null}
          </div>
          <svg
            ref={svgRef}
            data-testid="brain-quant-market-chart"
            viewBox={`0 0 ${chart.width} ${totalHeight}`}
            role="img"
            aria-label={`${symbol} K线和成交量图`}
            preserveAspectRatio="none"
            className="brain-quant-chart-interactive"
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onClick={handleClick}
          >
            {bars.map((bar, index) => {
              const x = chart.step * index + chart.step / 2;
              const up = bar.close >= bar.open;
              const bodyTop = chart.y(Math.max(bar.open, bar.close));
              const bodyHeight = Math.max(1.5, Math.abs(chart.y(bar.open) - chart.y(bar.close)));
              const color = up ? "#ef4444" : "#16a34a";
              const volumeHeight = (Number(bar.volume) / chart.maxVolume) * (chart.volumeHeight - 18);
              const active = pointer?.index === index;
              return (
                <g key={`${bar.timestamp}-${index}`} opacity={active || !pointer ? 1 : 0.45}>
                  <rect
                    x={chart.step * index}
                    y={0}
                    width={chart.step}
                    height={totalHeight}
                    fill={active ? "rgba(37,99,235,0.08)" : "transparent"}
                  />
                  <line x1={x} x2={x} y1={chart.y(bar.high)} y2={chart.y(bar.low)} stroke={color} strokeWidth="1" />
                  <rect x={x - chart.bodyWidth / 2} y={bodyTop} width={chart.bodyWidth} height={bodyHeight} fill={color} />
                  <rect
                    x={x - chart.bodyWidth / 2}
                    y={chart.priceHeight + chart.volumeHeight - volumeHeight}
                    width={chart.bodyWidth}
                    height={volumeHeight}
                    fill={color}
                    opacity="0.55"
                  />
                </g>
              );
            })}
            {crosshairOn && pointer ? (
              <g className="brain-quant-crosshair" pointerEvents="none">
                <line x1={pointer.x} x2={pointer.x} y1={0} y2={totalHeight} stroke="#2563eb" strokeWidth="1" strokeDasharray="4 3" />
                <line x1={0} x2={chart.width} y1={pointer.y} y2={pointer.y} stroke="#2563eb" strokeWidth="1" strokeDasharray="4 3" />
              </g>
            ) : null}
            {hoverBar && pointer ? (
              <g pointerEvents="none">
                <rect
                  x={Math.min(Math.max(pointer.x + 10, 4), chart.width - 168)}
                  y={Math.min(Math.max(pointer.y - 58, 4), chart.priceHeight - 70)}
                  width="160"
                  height="64"
                  rx="6"
                  fill="rgba(15,23,42,0.92)"
                />
                <text
                  x={Math.min(Math.max(pointer.x + 18, 12), chart.width - 160)}
                  y={Math.min(Math.max(pointer.y - 38, 22), chart.priceHeight - 52)}
                  fill="#fff"
                  fontSize="11"
                >
                  {String(hoverBar.timestamp).replace("T", " ").slice(0, 16)}
                </text>
                <text
                  x={Math.min(Math.max(pointer.x + 18, 12), chart.width - 160)}
                  y={Math.min(Math.max(pointer.y - 20, 40), chart.priceHeight - 34)}
                  fill="#fca5a5"
                  fontSize="12"
                  data-testid="brain-quant-hover-high"
                >
                  最高 {Number(hoverBar.high).toFixed(2)}
                </text>
                <text
                  x={Math.min(Math.max(pointer.x + 18, 12), chart.width - 160)}
                  y={Math.min(Math.max(pointer.y - 4, 56), chart.priceHeight - 18)}
                  fill="#86efac"
                  fontSize="12"
                  data-testid="brain-quant-hover-low"
                >
                  最低 {Number(hoverBar.low).toFixed(2)}
                </text>
              </g>
            ) : null}
          </svg>
          <div className="brain-quant-chart-axis">
            <span>{String(bars[0]?.timestamp || "").slice(5, 10)}</span>
            <span>
              {hoverBar
                ? `当前柱 最高 ${Number(hoverBar.high).toFixed(2)} / 最低 ${Number(hoverBar.low).toFixed(2)}`
                : `最高 ${chart.high.toFixed(2)} / 最低 ${chart.low.toFixed(2)}`}
            </span>
            <span>{String(bars.at(-1)?.timestamp || "").slice(5, 10)}</span>
          </div>
        </>
      )}
    </div>
  );
}
