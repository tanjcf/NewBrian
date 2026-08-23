import type { ChartPoint } from "../../main/data-chart";

export type DataChartType = "line" | "bar" | "scatter";

export function DataTrendChart({ points, label, type = "line" }: { points: ChartPoint[]; label: string; type?: DataChartType }) {
  if (!points.length) return <div className="brain-resource-empty">暂无可绘制的数值列。</div>;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(point.x * 100).toFixed(2)},${(point.y * 100).toFixed(2)}`).join(" ");
  return <section className="brain-data-chart" aria-label={`${label}${type === "line" ? "趋势" : type === "bar" ? "柱状" : "散点"}图`}><header><strong>{label}{type === "line" ? "趋势" : type === "bar" ? "柱状" : "散点"}</strong><small>{points.length} 个采样点</small></header><svg viewBox="0 0 100 100" role="img" preserveAspectRatio="none"><path d="M0,100 L0,0 M0,100 L100,100" className="brain-data-chart-axis" />{type === "line" ? <path d={path} className="brain-data-chart-line" vectorEffect="non-scaling-stroke" /> : null}{type === "bar" ? points.map((point) => <rect key={point.index} x={Math.max(0, point.x * 100 - 1.5)} y={point.y * 100} width="3" height={(1 - point.y) * 100} className="brain-data-chart-bar" />) : null}{type === "scatter" ? points.map((point) => <circle key={point.index} cx={point.x * 100} cy={point.y * 100} r="1.6" className="brain-data-chart-dot" />) : null}</svg></section>;
}
