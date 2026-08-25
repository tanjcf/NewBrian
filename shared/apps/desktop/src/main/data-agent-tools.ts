import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import type { BrainDataAnalysisState, BrainDataRegionRow } from "@codex-forge/protocol/brain-data-runtime";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { DataAnalysisService } from "./data-analysis-service.js";
import type { DataImportService } from "./data-import-service.js";
import type { DataRuntimeService } from "./data-runtime-service.js";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(definition: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>): unknown;
};

export type DataAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  imports: DataImportService;
  analysis: DataAnalysisService;
  dataRuntime?: DataRuntimeService;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => String(value ?? "").trim();

function parseMetrics(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new TypeError("metrics must be a non-empty array.");
  return value.map((item) => {
    const metric = record(item);
    const operation = text(metric.operation);
    if (!["sum", "count", "avg", "min", "max"].includes(operation)) throw new TypeError("metric.operation is unsupported.");
    const column = text(metric.column);
    if (!column) throw new TypeError("metric.column is required.");
    return { column, operation: operation as "sum" | "count" | "avg" | "min" | "max", ...(text(metric.as) ? { as: text(metric.as) } : {}) };
  });
}

function mimeForName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function regionRowsFromAggregate(result: { periodComparison?: Array<{ keys: Record<string, string>; changePercent: number }> }): BrainDataRegionRow[] {
  const comparisons = result.periodComparison || [];
  if (!comparisons.length) return [];
  const maxAbs = Math.max(...comparisons.map((item) => Math.abs(item.changePercent)), 1);
  return comparisons.map((item) => ({
    region: item.keys.region || Object.values(item.keys)[0] || "未知",
    yoy: item.changePercent,
    height: Math.max(12, Math.round(Math.abs(item.changePercent) / maxAbs * 88))
  }));
}

async function persistLocalFile(deps: DataAgentToolDependencies, absolutePath: string) {
  const source = await realpath(text(absolutePath));
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error("BRAIN_DATA_SOURCE_NOT_FILE");
  if (sourceStat.size <= 0 || sourceStat.size > 256 * 1024 * 1024) throw new Error("BRAIN_DATA_SOURCE_SIZE_INVALID");
  const root = await realpath(deps.projectRoot);
  const logicalName = basename(source);
  if (!/\.(csv|xlsx)$/iu.test(logicalName)) throw new Error("BRAIN_DATA_SOURCE_TYPE_UNSUPPORTED");
  const relativePath = `data/raw/${logicalName}`;
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary)) throw new Error("BRAIN_DATA_TARGET_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  const bytes = await readFile(target);
  const ownerId = await deps.ownerId();
  const existing = deps.storage.listFiles(ownerId, deps.projectId).find((file) => file.storageKey === relativePath);
  const file = existing || deps.storage.registerFile({
    ownerId,
    projectId: deps.projectId,
    logicalName,
    mimeType: mimeForName(logicalName),
    sizeBytes: bytes.length,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    storageKey: relativePath
  });
  return { file, relativePath, bytes: bytes.length };
}

function notify(deps: DataAgentToolDependencies, reason: string) {
  deps.notifyUi?.({ projectId: deps.projectId, reason });
}

/** Register data-scene tools on the project-scoped Agent runtime. */
export function registerDataAgentTools(runtime: ToolRuntime, deps: DataAgentToolDependencies) {
  if (!deps.projectId.trim() || !deps.projectRoot.trim()) return;
  runtime.unregisterExternalTools("data");

  runtime.registerExternalTool({
    name: "data.project.inspect",
    title: "读取数据项目",
    description: "读取右侧数据与决策工程的数据集、文件登记和分析记录。",
    namespace: "data",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const ownerId = await deps.ownerId();
    return {
      ok: true,
      output: JSON.stringify({
        projectId: deps.projectId,
        projectRoot: deps.projectRoot,
        datasets: deps.storage.listDatasets(ownerId, deps.projectId),
        files: deps.storage.listFiles(ownerId, deps.projectId)
      })
    };
  });

  runtime.registerExternalTool({
    name: "data.file.import_local",
    title: "导入本地 CSV/XLSX 到工程",
    description: "把本机真实 CSV/XLSX 复制到当前数据项目 data/raw/，登记为 brain_file，供右侧「数据导入」选择。必须提供绝对路径。",
    namespace: "data",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        absolutePath: { type: "string" },
        autoImportDataset: { type: "boolean" },
        datasetName: { type: "string" }
      },
      required: ["absolutePath"],
      additionalProperties: false
    }
  }, async (input) => {
    const persisted = await persistLocalFile(deps, text(input.absolutePath));
    let datasetResult: unknown = null;
    if (input.autoImportDataset !== false && /\.csv$/iu.test(persisted.file.logicalName)) {
      const ownerId = await deps.ownerId();
      datasetResult = await deps.imports.importCsv(ownerId, {
        projectId: deps.projectId,
        fileId: persisted.file.id,
        datasetId: `dataset-${Date.now()}`,
        name: text(input.datasetName) || persisted.file.logicalName,
        updatedAt: new Date().toISOString()
      });
    }
    notify(deps, "file.import_local");
    return { ok: true, output: JSON.stringify({ ...persisted, dataset: datasetResult }) };
  });

  runtime.registerExternalTool({
    name: "data.file.list",
    title: "列出工程数据文件",
    description: "列出当前数据项目已登记的文件（含 data/raw 下的 CSV/XLSX）。",
    namespace: "data",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const ownerId = await deps.ownerId();
    return { ok: true, output: JSON.stringify({ files: deps.storage.listFiles(ownerId, deps.projectId) }) };
  });

  runtime.registerExternalTool({
    name: "data.dataset.import_csv",
    title: "导入 CSV 数据集",
    description: "将项目内已登记的 CSV 文件导入为右侧真实数据集，并返回字段、行数与采样行。",
    namespace: "data",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        datasetId: { type: "string" },
        name: { type: "string" }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const result = await deps.imports.importCsv(ownerId, {
      projectId: deps.projectId,
      fileId: text(input.fileId),
      datasetId: text(input.datasetId) || `dataset-${Date.now()}`,
      name: text(input.name) || "CSV 数据集",
      updatedAt: new Date().toISOString()
    });
    notify(deps, "dataset.import_csv");
    return { ok: true, output: JSON.stringify({ dataset: result.dataset, sampleRows: (result.rows || []).slice(0, 5), rowCount: result.rows?.length || 0 }) };
  });

  runtime.registerExternalTool({
    name: "data.dataset.import_xlsx",
    title: "导入 XLSX 数据集",
    description: "将项目内已登记的 XLSX 文件导入为右侧真实数据集，可选工作表。",
    namespace: "data",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        datasetId: { type: "string" },
        name: { type: "string" },
        sheetName: { type: "string" }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const result = await deps.imports.importXlsx(ownerId, {
      projectId: deps.projectId,
      fileId: text(input.fileId),
      datasetId: text(input.datasetId) || `dataset-${Date.now()}`,
      name: text(input.name) || "XLSX 数据集",
      updatedAt: new Date().toISOString(),
      ...(text(input.sheetName) ? { sheetName: text(input.sheetName) } : {})
    });
    notify(deps, "dataset.import_xlsx");
    return { ok: true, output: JSON.stringify({ dataset: result.dataset, sampleRows: (result.rows || []).slice(0, 5), rowCount: result.rows?.length || 0 }) };
  });

  runtime.registerExternalTool({
    name: "data.dataset.list",
    title: "列出数据集",
    description: "列出右侧已导入的真实数据集及字段、行数。",
    namespace: "data",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const ownerId = await deps.ownerId();
    return { ok: true, output: JSON.stringify({ datasets: deps.storage.listDatasets(ownerId, deps.projectId) }) };
  });

  runtime.registerExternalTool({
    name: "data.analysis.summarize",
    title: "运行数值摘要",
    description: "对指定数据集用本机 Python/pandas 分块做数值摘要（min/max/mean/median/stddev）。只返回统计结果，不回传全表；适合十万～千万行。大模型只负责把工具 JSON 封装成洞察文案。",
    namespace: "data",
    kind: "write",
    risk: "low",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: { datasetId: { type: "string" } },
      required: ["datasetId"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const saved = await deps.analysis.summarize(ownerId, deps.projectId, text(input.datasetId));
    notify(deps, "analysis.summarize");
    return { ok: true, output: JSON.stringify(saved) };
  });

  runtime.registerExternalTool({
    name: "data.analysis.aggregate",
    title: "分组聚合统计",
    description: "用本机 Python/pandas 分块做分组聚合（sum/count/avg/min/max），支持 TopN、占比与周期环比。只返回聚合结果表，不加载全量行到模型上下文。",
    namespace: "data",
    kind: "write",
    risk: "low",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        groupBy: { type: "array", items: { type: "string" } },
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              operation: { type: "string", enum: ["sum", "count", "avg", "min", "max"] },
              as: { type: "string" }
            },
            required: ["column", "operation"],
            additionalProperties: false
          }
        },
        topN: { type: "integer", minimum: 1, maximum: 256 },
        orderBy: {
          type: "object",
          properties: {
            metric: { type: "string" },
            direction: { type: "string", enum: ["asc", "desc"] }
          },
          required: ["metric", "direction"],
          additionalProperties: false
        },
        periodColumn: { type: "string" },
        compareMetric: { type: "string" }
      },
      required: ["datasetId", "groupBy", "metrics"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const orderBy = input.orderBy === undefined ? undefined : (() => {
      const ordering = record(input.orderBy);
      return { metric: text(ordering.metric), direction: text(ordering.direction) as "asc" | "desc" };
    })();
    const saved = await deps.analysis.aggregate(ownerId, deps.projectId, text(input.datasetId), {
      groupBy: Array.isArray(input.groupBy) ? input.groupBy.map((item) => text(item)).filter(Boolean) : [],
      metrics: parseMetrics(input.metrics),
      ...(typeof input.topN === "number" ? { topN: input.topN } : {}),
      ...(orderBy ? { orderBy } : {}),
      ...(text(input.periodColumn) ? { periodColumn: text(input.periodColumn) } : {}),
      ...(text(input.compareMetric) ? { compareMetric: text(input.compareMetric) } : {})
    });
    notify(deps, "analysis.aggregate");
    return { ok: true, output: JSON.stringify(saved) };
  });

  runtime.registerExternalTool({
    name: "data.dataset.read_rows",
    title: "读取数据集行",
    description: "抽样读取数据集行（默认最多 50 行，上限 200），仅用于预览核对；大表分析请用 data.analysis.summarize / aggregate（Python）。",
    namespace: "data",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      required: ["datasetId"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const rows = await deps.imports.readRows(ownerId, { projectId: deps.projectId, datasetId: text(input.datasetId) });
    const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 200) : 50;
    return { ok: true, output: JSON.stringify({ rowCount: rows.length, rows: rows.slice(0, limit) }) };
  });

  runtime.registerExternalTool({
    name: "data.analysis.save",
    title: "保存 Julius 分析状态",
    description: "把洞察文案与聚合摘要写入 Julius（只存聚合/抽样，不存全表）。洞察应由模型根据 summarize/aggregate 的 JSON 封装生成。",
    namespace: "data",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        insight: { type: "string" },
        datasetId: { type: "string" },
        analyzing: { type: "boolean" }
      },
      required: ["fileName", "insight"],
      additionalProperties: false
    }
  }, async (input) => {
    if (!deps.dataRuntime) throw new Error("BRAIN_DATA_RUNTIME_UNAVAILABLE");
    const ownerId = await deps.ownerId();
    let regionRows: BrainDataRegionRow[] = [];
    let rows: unknown[] = [];
    const datasetId = text(input.datasetId);
    if (datasetId) {
      const analyses = deps.storage.listDataAnalyses(ownerId, deps.projectId, datasetId);
      const aggregate = Array.isArray(analyses)
        ? analyses.find((item: { result?: { operation?: string; periodComparison?: unknown[]; rows?: unknown[] } }) => item?.result?.operation === "aggregate")
        : null;
      if (aggregate?.result) {
        regionRows = regionRowsFromAggregate(aggregate.result as { periodComparison?: Array<{ keys: Record<string, string>; changePercent: number }> });
        rows = Array.isArray(aggregate.result.rows) ? aggregate.result.rows.slice(0, 64) : [];
      }
    }
    const state: BrainDataAnalysisState = {
      fileName: text(input.fileName),
      rows,
      insight: text(input.insight),
      regionRows,
      analyzing: input.analyzing === true
    };
    const saved = await deps.dataRuntime.analysisSave({ projectId: deps.projectId, projectRoot: deps.projectRoot }, state);
    notify(deps, "analysis.save");
    return { ok: true, output: JSON.stringify({ saved, state }) };
  });

  runtime.registerExternalTool({
    name: "data.analysis.cook",
    title: "导出分析报告",
    description: "将 Julius 分析状态 Cook 到 .brain-data/ 与 Docs/BRAIN/analysis.json，供验收真实导出文件。",
    namespace: "data",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        insight: { type: "string" },
        datasetId: { type: "string" }
      },
      additionalProperties: false
    }
  }, async (input) => {
    if (!deps.dataRuntime) throw new Error("BRAIN_DATA_RUNTIME_UNAVAILABLE");
    const ownerId = await deps.ownerId();
    let state: BrainDataAnalysisState | undefined;
    if (text(input.fileName) || text(input.insight) || text(input.datasetId)) {
      let regionRows: BrainDataRegionRow[] = [];
      let rows: unknown[] = [];
      const datasetId = text(input.datasetId);
      if (datasetId) {
        const analyses = deps.storage.listDataAnalyses(ownerId, deps.projectId, datasetId);
        const aggregate = Array.isArray(analyses)
          ? analyses.find((item: { result?: { operation?: string; rows?: unknown[]; periodComparison?: unknown[] } }) => item?.result?.operation === "aggregate")
          : null;
        if (aggregate?.result) {
          regionRows = regionRowsFromAggregate(aggregate.result as { periodComparison?: Array<{ keys: Record<string, string>; changePercent: number }> });
          rows = Array.isArray(aggregate.result.rows) ? aggregate.result.rows.slice(0, 64) : [];
        }
      }
      state = {
        fileName: text(input.fileName) || "dataset",
        rows,
        insight: text(input.insight) || "已完成区域经营分析。",
        regionRows,
        analyzing: false
      };
      await deps.dataRuntime.analysisSave({ projectId: deps.projectId, projectRoot: deps.projectRoot }, state);
    }
    const cooked = await deps.dataRuntime.cook({ projectId: deps.projectId, projectRoot: deps.projectRoot }, state);
    notify(deps, "analysis.cook");
    return { ok: true, output: JSON.stringify({ cooked, projectRoot: deps.projectRoot }) };
  });
}
