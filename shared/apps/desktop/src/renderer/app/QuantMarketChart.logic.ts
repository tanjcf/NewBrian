export type QuantChartBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IntervalLabel = "日线" | "周线" | "月线";

export type QuantChartDrillTarget = {
  interval: IntervalLabel;
  startDate: string;
  endDate: string;
  focusLabel: string;
  /** Daily drill uses known OHLC path only — not minute bars. */
  dayPath?: QuantChartBar;
};

export function movingAverage(bars: QuantChartBar[], period: number): Array<number | null> {
  return bars.map((_bar, index) => {
    if (index + 1 < period) return null;
    const window = bars.slice(index + 1 - period, index + 1);
    return window.reduce((sum, bar) => sum + Number(bar.close), 0) / period;
  });
}

export function isoLocal(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function parseBarDate(timestamp: string): Date {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date(timestamp.slice(0, 10));
}

export function drillTargetForBar(interval: IntervalLabel, bar: QuantChartBar): QuantChartDrillTarget {
  const date = parseBarDate(bar.timestamp);
  if (interval === "月线") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return {
      interval: "周线",
      startDate: isoLocal(start),
      endDate: isoLocal(end),
      focusLabel: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")} 月 · 周量走势`
    };
  }
  if (interval === "周线") {
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(date);
    start.setDate(date.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      interval: "日线",
      startDate: isoLocal(start),
      endDate: isoLocal(end),
      focusLabel: `${isoLocal(start)} ~ ${isoLocal(end)} · 日走势`
    };
  }
  const day = isoLocal(date);
  return {
    interval: "日线",
    startDate: day,
    endDate: day,
    focusLabel: `${day} · 天走势（开高低收路径）`,
    dayPath: bar
  };
}
