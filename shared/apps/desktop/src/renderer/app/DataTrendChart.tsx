import type { ChartPoint } from "../../main/data-chart";

export function DataTrendChart({ points, label }: { points: ChartPoint[]; label: string }) {
  if (!points.length) return <div className="brain-resource-empty">暂无可绘制的数值列。</div>;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(point.x * 100).toFixed(2)},${(point.y * 100).toFixed(2)}`).join(" ");
  return <section className="brain-data-chart" aria-label={`${label}趋势图`}><header><strong>{label}趋势</strong><small>{points.length} 个采样点</small></header><svg viewBox="0 0 100 100" role="img" preserveAspectRatio="none"><path d="M0,100 L0,0 M0,100 L100,100" className="brain-data-chart-axis" /><path d={path} className="brain-data-chart-line" vectorEffect="non-scaling-stroke" /></svg></section>;
}
