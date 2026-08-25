#!/usr/bin/env python3
"""BRAIN data stats runner — chunked pandas → compact JSON (no full row dump)."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    import pandas as pd
except ImportError as exc:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"PANDAS_REQUIRED:{exc}"}), flush=True)
    sys.exit(2)


def _num(series: "pd.Series") -> "pd.Series":
    return pd.to_numeric(series, errors="coerce")


def summarize(path: Path, columns: list[dict[str, str]], chunksize: int) -> dict[str, Any]:
    numeric_keys = [c["key"] for c in columns if c.get("type") == "number"]
    if not numeric_keys:
        return {"rowCount": 0, "columns": [], "engine": "pandas-chunked"}

    totals = {
        key: {"count": 0, "missing": 0, "sum": 0.0, "sumsq": 0.0, "min": None, "max": None, "samples": []}
        for key in numeric_keys
    }
    row_count = 0
    header = pd.read_csv(path, nrows=0).columns.tolist()
    usecols = [k for k in numeric_keys if k in header] or None

    for chunk in pd.read_csv(path, usecols=usecols, chunksize=max(1, chunksize)):
        row_count += len(chunk)
        for key in numeric_keys:
            if key not in chunk.columns:
                totals[key]["missing"] += len(chunk)
                continue
            values = _num(chunk[key])
            missing = int(values.isna().sum())
            finite = values.dropna()
            totals[key]["missing"] += missing
            if finite.empty:
                continue
            totals[key]["count"] += int(finite.shape[0])
            arr = finite.astype(float)
            totals[key]["sum"] += float(arr.sum())
            totals[key]["sumsq"] += float((arr ** 2).sum())
            lo = float(arr.min())
            hi = float(arr.max())
            totals[key]["min"] = lo if totals[key]["min"] is None else min(totals[key]["min"], lo)
            totals[key]["max"] = hi if totals[key]["max"] is None else max(totals[key]["max"], hi)
            if len(totals[key]["samples"]) < 5000:
                totals[key]["samples"].extend(arr.head(200).tolist())

    out_cols = []
    for key in numeric_keys:
        t = totals[key]
        count = t["count"]
        mean = (t["sum"] / count) if count else None
        variance = None
        if count >= 2 and mean is not None:
            variance = max(0.0, (t["sumsq"] - (t["sum"] ** 2) / count) / (count - 1))
        samples = sorted(t["samples"])
        median = None
        if samples:
            mid = len(samples) // 2
            median = samples[mid] if len(samples) % 2 else (samples[mid - 1] + samples[mid]) / 2
        out_cols.append(
            {
                "key": key,
                "count": count,
                "missingCount": t["missing"],
                "min": t["min"],
                "max": t["max"],
                "mean": None if mean is None else round(mean, 8),
                "median": None if median is None else round(float(median), 8),
                "standardDeviation": None if variance is None else round(math.sqrt(variance), 8),
            }
        )
    return {"rowCount": row_count, "columns": out_cols, "engine": "pandas-chunked"}


def aggregate(
    path: Path,
    group_by: list[str],
    metrics: list[dict[str, str]],
    top_n: int | None,
    order_by: dict[str, str] | None,
    period_column: str | None,
    compare_metric: str | None,
    chunksize: int,
) -> dict[str, Any]:
    if not group_by or not metrics:
        raise ValueError("GROUPBY_OR_METRICS_REQUIRED")

    metric_specs = [(m["column"], m["operation"], m.get("as") or f"{m['operation']}_{m['column']}") for m in metrics]
    header = pd.read_csv(path, nrows=0).columns.tolist()
    usecols = list(
        dict.fromkeys(
            [
                *[g for g in group_by if g in header],
                *([period_column] if period_column and period_column in header else []),
                *[col for col, _, _ in metric_specs if col in header],
            ]
        )
    )
    if len(usecols) < len(group_by):
        raise ValueError("GROUPBY_COLUMNS_MISSING")

    # Accumulator: key_tuple -> {alias: reduced value helpers}
    acc: dict[tuple, dict[str, Any]] = {}
    period_acc: dict[tuple, dict[str, float]] = {}
    row_count = 0

    for chunk in pd.read_csv(path, usecols=usecols, chunksize=max(1, chunksize)):
        row_count += len(chunk)
        for col, _, _ in metric_specs:
            if col in chunk.columns:
                chunk[col] = _num(chunk[col])
        if compare_metric and compare_metric in chunk.columns:
            chunk[compare_metric] = _num(chunk[compare_metric])

        for key_vals, part in chunk.groupby(group_by, dropna=False):
            key = key_vals if isinstance(key_vals, tuple) else (key_vals,)
            key = tuple("" if pd.isna(v) else str(v) for v in key)
            bucket = acc.setdefault(
                key,
                {
                    "keys": {g: key[i] for i, g in enumerate(group_by)},
                    "sum": {},
                    "count": {},
                    "min": {},
                    "max": {},
                },
            )
            for col, op, alias in metric_specs:
                series = part[col].dropna() if col in part.columns else pd.Series(dtype=float)
                if op == "sum":
                    bucket["sum"][alias] = bucket["sum"].get(alias, 0.0) + float(series.sum() if len(series) else 0.0)
                elif op == "count":
                    bucket["count"][alias] = bucket["count"].get(alias, 0) + int(len(series))
                elif op == "avg":
                    bucket["sum"][alias] = bucket["sum"].get(alias, 0.0) + float(series.sum() if len(series) else 0.0)
                    bucket["count"][alias] = bucket["count"].get(alias, 0) + int(len(series))
                elif op == "min":
                    if len(series):
                        value = float(series.min())
                        bucket["min"][alias] = value if alias not in bucket["min"] else min(bucket["min"][alias], value)
                elif op == "max":
                    if len(series):
                        value = float(series.max())
                        bucket["max"][alias] = value if alias not in bucket["max"] else max(bucket["max"][alias], value)
                else:
                    raise ValueError(f"METRIC_UNSUPPORTED:{op}")

            if period_column and compare_metric and period_column in part.columns and compare_metric in part.columns:
                periods = period_acc.setdefault(key, {})
                for period, ppart in part.groupby(period_column, dropna=False):
                    period_key = "" if pd.isna(period) else str(period)
                    periods[period_key] = periods.get(period_key, 0.0) + float(ppart[compare_metric].dropna().sum())

    rows = []
    for bucket in acc.values():
        item = dict(bucket["keys"])
        for col, op, alias in metric_specs:
            if op == "sum":
                item[alias] = bucket["sum"].get(alias, 0.0)
            elif op == "count":
                item[alias] = float(bucket["count"].get(alias, 0))
            elif op == "avg":
                count = bucket["count"].get(alias, 0)
                item[alias] = (bucket["sum"].get(alias, 0.0) / count) if count else None
            elif op == "min":
                item[alias] = bucket["min"].get(alias)
            elif op == "max":
                item[alias] = bucket["max"].get(alias)
        rows.append(item)

    if order_by:
        metric = order_by.get("metric") or ""
        direction = order_by.get("direction") or "desc"
        rows.sort(
            key=lambda r: (r.get(metric) is None, float(r[metric]) if isinstance(r.get(metric), (int, float)) else 0.0),
            reverse=(direction != "asc"),
        )
    if top_n and top_n > 0:
        rows = rows[: int(top_n)]

    shares = []
    if rows and metric_specs:
        primary = metric_specs[0][2]
        total = sum(float(r[primary]) for r in rows if isinstance(r.get(primary), (int, float)))
        if total:
            for r in rows:
                value = r.get(primary)
                if isinstance(value, (int, float)):
                    shares.append({"keys": {g: r[g] for g in group_by}, "metric": primary, "value": value, "share": value / total})

    period_comparison = []
    if period_column and compare_metric:
        for key, periods in period_acc.items():
            ordered = sorted(periods.keys())
            if len(ordered) < 2:
                continue
            previous, current = ordered[-2], ordered[-1]
            prev_v, cur_v = periods[previous], periods[current]
            change = ((cur_v - prev_v) / prev_v * 100.0) if prev_v else 0.0
            period_comparison.append(
                {
                    "keys": {g: key[i] for i, g in enumerate(group_by)},
                    "periodColumn": period_column,
                    "currentPeriod": current,
                    "previousPeriod": previous,
                    "metric": compare_metric,
                    "current": cur_v,
                    "previous": prev_v,
                    "changePercent": round(change, 8),
                }
            )

    return {
        "rowCount": row_count,
        "rows": rows,
        "shares": shares,
        "periodComparison": period_comparison,
        "engine": "pandas-chunked",
    }


def main() -> int:
    req = json.loads(sys.stdin.read())
    path = Path(req["path"])
    if not path.is_file():
        print(json.dumps({"ok": False, "error": "SOURCE_FILE_MISSING"}), flush=True)
        return 3
    chunksize = int(req.get("chunksize") or 100_000)
    op = req.get("operation")
    try:
        if op == "summary":
            result = summarize(path, req.get("columns") or [], chunksize)
        elif op == "aggregate":
            result = aggregate(
                path,
                req.get("groupBy") or [],
                req.get("metrics") or [],
                req.get("topN"),
                req.get("orderBy"),
                req.get("periodColumn"),
                req.get("compareMetric"),
                chunksize,
            )
        else:
            raise ValueError(f"OPERATION_UNSUPPORTED:{op}")
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
