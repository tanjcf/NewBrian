import { createHash } from "node:crypto";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import type { DataImportService } from "./data-import-service.ts";
import { runPythonDatasetStats } from "./data-python-analysis.ts";

export interface DataAnalysisResult { datasetId: string; operation: "summary"; inputHash: string; rowCount: number; columns: Array<{ key: string; count: number; missingCount: number; min: number | null; max: number | null; mean: number | null; median: number | null; standardDeviation: number | null }>; createdAt: string; }

export interface DataAggregateMetric {
  column: string;
  operation: "sum" | "count" | "avg" | "min" | "max";
  as?: string;
}

export interface DataAggregateResult {
  datasetId: string;
  operation: "aggregate";
  groupBy: string[];
  metrics: Array<{ column: string; operation: string; as: string }>;
  rows: Array<Record<string, string | number>>;
  topN?: number;
  shares?: Array<{ keys: Record<string, string>; metric: string; value: number; share: number }>;
  periodComparison?: Array<{ keys: Record<string, string>; periodColumn: string; currentPeriod: string; previousPeriod: string; metric: string; current: number; previous: number; changePercent: number }>;
  inputHash: string;
  rowCount: number;
  createdAt: string;
}

function columnIndex(columns: Array<{ key: string }>, key: string) {
  const index = columns.findIndex((column) => column.key === key);
  if (index < 0) throw new Error(`BRAIN_DATA_COLUMN_NOT_FOUND:${key}`);
  return index;
}

function applyMetric(operation: string, values: number[]) {
  if (!values.length) return null;
  switch (operation) {
    case "sum": return values.reduce((sum, value) => sum + value, 0);
    case "count": return values.length;
    case "avg": return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: throw new Error(`BRAIN_DATA_METRIC_UNSUPPORTED:${operation}`);
  }
}

export function aggregateDataset(input: {
  datasetId: string;
  contentHash: string;
  columns: Array<{ key: string; type: string }>;
  rows: string[][];
  groupBy: string[];
  metrics: DataAggregateMetric[];
  topN?: number;
  orderBy?: { metric: string; direction: "asc" | "desc" };
  periodColumn?: string;
  compareMetric?: string;
  createdAt: string;
}): DataAggregateResult {
  if (!input.groupBy.length) throw new Error("BRAIN_DATA_GROUPBY_REQUIRED");
  if (!input.metrics.length) throw new Error("BRAIN_DATA_METRICS_REQUIRED");
  const groupIndexes = input.groupBy.map((key) => columnIndex(input.columns, key));
  const metricSpecs = input.metrics.map((metric) => ({
    column: metric.column,
    operation: metric.operation,
    as: metric.as?.trim() || `${metric.operation}_${metric.column}`,
    index: columnIndex(input.columns, metric.column)
  }));
  const groups = new Map<string, { keys: Record<string, string>; values: number[][] }>();
  for (const row of input.rows) {
    const keys: Record<string, string> = {};
    const parts: string[] = [];
    for (let index = 0; index < input.groupBy.length; index += 1) {
      keys[input.groupBy[index]] = String(row[groupIndexes[index]] ?? "");
      parts.push(keys[input.groupBy[index]]);
    }
    const groupKey = parts.join("\0");
    if (!groups.has(groupKey)) groups.set(groupKey, { keys, values: metricSpecs.map(() => []) });
    const group = groups.get(groupKey)!;
    metricSpecs.forEach((spec, metricIndex) => {
      const value = Number(row[spec.index]);
      if (Number.isFinite(value)) group.values[metricIndex].push(value);
    });
  }
  let resultRows = [...groups.values()].map((group) => {
    const row: Record<string, string | number> = { ...group.keys };
    metricSpecs.forEach((spec, metricIndex) => {
      const value = applyMetric(spec.operation, group.values[metricIndex]);
      if (value !== null) row[spec.as] = Number(value.toFixed(8));
    });
    return row;
  });
  const orderMetric = input.orderBy
    ? metricSpecs.find((spec) => spec.column === input.orderBy!.metric || spec.as === input.orderBy!.metric)?.as || input.orderBy.metric
    : null;
  if (orderMetric) {
    resultRows.sort((left, right) => {
      const delta = Number(left[orderMetric] ?? 0) - Number(right[orderMetric] ?? 0);
      return input.orderBy!.direction === "asc" ? delta : -delta;
    });
  }
  if (input.topN && input.topN > 0) resultRows = resultRows.slice(0, input.topN);
  const sumMetric = metricSpecs.find((spec) => spec.operation === "sum");
  const shares = sumMetric && resultRows.length
    ? (() => {
      const total = resultRows.reduce((sum, row) => sum + Number(row[sumMetric.as] ?? 0), 0);
      if (!total) return undefined;
      return resultRows.map((row) => ({
        keys: input.groupBy.reduce<Record<string, string>>((result, key) => ({ ...result, [key]: String(row[key] ?? "") }), {}),
        metric: sumMetric.as,
        value: Number(row[sumMetric.as] ?? 0),
        share: Number((Number(row[sumMetric.as] ?? 0) / total * 100).toFixed(4))
      }));
    })()
    : undefined;
  const periodComparison = input.periodColumn && input.compareMetric
    ? (() => {
      const periodIndex = columnIndex(input.columns, input.periodColumn!);
      const metricIndex = columnIndex(input.columns, input.compareMetric!);
      const dimensionKeys = input.groupBy.filter((key) => key !== input.periodColumn);
      const periodGroups = new Map<string, Map<string, number[]>>();
      for (const row of input.rows) {
        const dimensionKey = dimensionKeys.map((key) => String(row[columnIndex(input.columns, key)] ?? "")).join("\0");
        const period = String(row[periodIndex] ?? "");
        const value = Number(row[metricIndex]);
        if (!periodGroups.has(dimensionKey)) periodGroups.set(dimensionKey, new Map());
        const periods = periodGroups.get(dimensionKey)!;
        if (!periods.has(period)) periods.set(period, []);
        if (Number.isFinite(value)) periods.get(period)!.push(value);
      }
      const comparisons: NonNullable<DataAggregateResult["periodComparison"]> = [];
      for (const [dimensionKey, periods] of periodGroups) {
        const ordered = [...periods.keys()].sort();
        if (ordered.length < 2) continue;
        const previousPeriod = ordered[ordered.length - 2];
        const currentPeriod = ordered[ordered.length - 1];
        const previous = periods.get(previousPeriod)!.reduce((sum, value) => sum + value, 0);
        const current = periods.get(currentPeriod)!.reduce((sum, value) => sum + value, 0);
        comparisons.push({
          keys: dimensionKeys.reduce<Record<string, string>>((result, key, index) => ({
            ...result,
            [key]: dimensionKey.split("\0")[index] || ""
          }), {}),
          periodColumn: input.periodColumn!,
          currentPeriod,
          previousPeriod,
          metric: input.compareMetric!,
          current: Number(current.toFixed(8)),
          previous: Number(previous.toFixed(8)),
          changePercent: previous ? Number(((current - previous) / previous * 100).toFixed(4)) : 0
        });
      }
      return comparisons;
    })()
    : undefined;
  const metrics = metricSpecs.map(({ column, operation, as }) => ({ column, operation, as }));
  const inputHash = createHash("sha256").update(JSON.stringify({
    datasetId: input.datasetId,
    contentHash: input.contentHash,
    groupBy: input.groupBy,
    metrics,
    topN: input.topN ?? null,
    orderBy: input.orderBy ?? null,
    periodColumn: input.periodColumn ?? null,
    compareMetric: input.compareMetric ?? null,
    rows: resultRows,
    rowCount: input.rows.length
  })).digest("hex");
  return {
    datasetId: input.datasetId,
    operation: "aggregate",
    groupBy: input.groupBy,
    metrics,
    rows: resultRows,
    ...(input.topN ? { topN: input.topN } : {}),
    ...(shares ? { shares } : {}),
    ...(periodComparison?.length ? { periodComparison } : {}),
    inputHash,
    rowCount: input.rows.length,
    createdAt: input.createdAt
  };
}

export function summarizeNumericColumns(input: { datasetId: string; contentHash: string; columns: Array<{ key: string; type: string }>; rows: string[][]; createdAt: string }): DataAnalysisResult {
  const numeric = input.columns.map((column, index) => ({ column, index })).filter(({ column }) => column.type === "number");
  const columns = numeric.map(({ column, index }) => {
    const values = input.rows.map((row) => Number(row[index])).filter((value) => Number.isFinite(value));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const ordered = [...values].sort((a, b) => a - b);
    const median = ordered.length ? (ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2) : null;
    const variance = mean === null || values.length < 2 ? null : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return { key: column.key, count: values.length, missingCount: input.rows.length - values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, mean: mean === null ? null : Number(mean.toFixed(8)), median: median === null ? null : Number(median.toFixed(8)), standardDeviation: variance === null ? null : Number(Math.sqrt(variance).toFixed(8)) };
  });
  const inputHash = createHash("sha256").update(JSON.stringify({ datasetId: input.datasetId, contentHash: input.contentHash, columns, rowCount: input.rows.length })).digest("hex");
  return { datasetId: input.datasetId, operation: "summary", inputHash, rowCount: input.rows.length, columns, createdAt: input.createdAt };
}

const NODE_FALLBACK_MAX_ROWS = 20_000;

export class DataAnalysisService {
  private readonly storage: BrainWorkspaceStorage;
  private readonly imports: DataImportService;
  constructor(storage: BrainWorkspaceStorage, imports: DataImportService) { this.storage = storage; this.imports = imports; }

  private async analyzeWithPythonOrNode<T extends DataAnalysisResult | DataAggregateResult>(
    ownerId: string,
    projectId: string,
    datasetId: string,
    python: () => Promise<T>,
    node: (rows: string[][]) => T
  ) {
    const dataset = this.storage.listDatasets(ownerId, projectId).find((item) => item.id === datasetId);
    if (!dataset) throw new Error("BRAIN_DATASET_NOT_FOUND");
    const source = await this.imports.resolveDatasetFilePath(ownerId, { projectId, datasetId });
    const isCsv = /\.csv$/iu.test(`${source.file.storageKey} ${source.file.logicalName}`);
    if (isCsv) {
      try {
        return await python();
      } catch (error) {
        if ((dataset.rowCount || 0) > NODE_FALLBACK_MAX_ROWS) throw error;
      }
    }
    if ((dataset.rowCount || 0) > NODE_FALLBACK_MAX_ROWS) {
      throw new Error("BRAIN_DATA_PYTHON_REQUIRED_FOR_LARGE_DATASET");
    }
    const rows = await this.imports.readRows(ownerId, { projectId, datasetId });
    return node(rows);
  }

  async summarize(ownerId: string, projectId: string, datasetId: string) {
    const dataset = this.storage.listDatasets(ownerId, projectId).find((item) => item.id === datasetId);
    if (!dataset) throw new Error("BRAIN_DATASET_NOT_FOUND");
    const result = await this.analyzeWithPythonOrNode(
      ownerId,
      projectId,
      datasetId,
      async () => {
        const source = await this.imports.resolveDatasetFilePath(ownerId, { projectId, datasetId });
        return await runPythonDatasetStats({
          operation: "summary",
          path: source.path,
          datasetId,
          contentHash: dataset.contentHash,
          columns: dataset.columns
        }) as DataAnalysisResult;
      },
      (rows) => summarizeNumericColumns({
        datasetId,
        contentHash: dataset.contentHash,
        columns: dataset.columns,
        rows,
        createdAt: new Date().toISOString()
      })
    );
    return this.storage.saveDataAnalysis({ ownerId, projectId, datasetId, operation: result.operation, inputHash: result.inputHash, result, createdAt: result.createdAt });
  }

  async aggregate(ownerId: string, projectId: string, datasetId: string, input: {
    groupBy: string[];
    metrics: DataAggregateMetric[];
    topN?: number;
    orderBy?: { metric: string; direction: "asc" | "desc" };
    periodColumn?: string;
    compareMetric?: string;
  }) {
    const dataset = this.storage.listDatasets(ownerId, projectId).find((item) => item.id === datasetId);
    if (!dataset) throw new Error("BRAIN_DATASET_NOT_FOUND");
    const result = await this.analyzeWithPythonOrNode(
      ownerId,
      projectId,
      datasetId,
      async () => {
        const source = await this.imports.resolveDatasetFilePath(ownerId, { projectId, datasetId });
        return await runPythonDatasetStats({
          operation: "aggregate",
          path: source.path,
          datasetId,
          contentHash: dataset.contentHash,
          groupBy: input.groupBy,
          metrics: input.metrics,
          ...(typeof input.topN === "number" ? { topN: input.topN } : {}),
          ...(input.orderBy ? { orderBy: input.orderBy } : {}),
          ...(input.periodColumn ? { periodColumn: input.periodColumn } : {}),
          ...(input.compareMetric ? { compareMetric: input.compareMetric } : {})
        }) as DataAggregateResult;
      },
      (rows) => aggregateDataset({
        datasetId,
        contentHash: dataset.contentHash,
        columns: dataset.columns,
        rows,
        groupBy: input.groupBy,
        metrics: input.metrics,
        topN: input.topN,
        orderBy: input.orderBy,
        periodColumn: input.periodColumn,
        compareMetric: input.compareMetric,
        createdAt: new Date().toISOString()
      })
    );
    return this.storage.saveDataAnalysis({
      ownerId,
      projectId,
      datasetId,
      operation: result.operation,
      inputHash: result.inputHash,
      result,
      createdAt: result.createdAt
    });
  }
  list(ownerId: string, projectId: string, datasetId: string) { return this.storage.listDataAnalyses(ownerId, projectId, datasetId); }
}
