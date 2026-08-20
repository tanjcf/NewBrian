export interface ChartPoint { index: number; value: number; x: number; y: number; }

export function buildNumericChart(rows: string[][], columnIndex: number, maxPoints = 256): ChartPoint[] {
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || !Number.isInteger(maxPoints) || maxPoints < 2) throw new Error("BRAIN_DATA_CHART_INVALID");
  const values = rows.map((row, index) => ({ index, value: Number(row[columnIndex]) })).filter((item) => Number.isFinite(item.value));
  if (!values.length) return [];
  const step = Math.max(1, Math.ceil(values.length / maxPoints));
  const sampled = values.filter((_item, index) => index % step === 0).slice(0, maxPoints);
  const min = Math.min(...sampled.map((item) => item.value)); const max = Math.max(...sampled.map((item) => item.value)); const span = max - min || 1;
  return sampled.map((item, index) => ({ index: item.index, value: item.value, x: sampled.length === 1 ? 0 : index / (sampled.length - 1), y: 1 - (item.value - min) / span }));
}
