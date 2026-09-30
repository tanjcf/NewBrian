import { createHash, randomBytes } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { DATA_PYTHON_STATS_SOURCE } from "./data-python-stats-source.js";
import type { DataAggregateMetric, DataAggregateResult, DataAnalysisResult } from "./data-analysis-service.js";

const SCRIPT_URL = new URL("./data_python_stats.py", import.meta.url);

export type PythonStatsRequest =
  | {
      operation: "summary";
      path: string;
      datasetId: string;
      contentHash: string;
      columns: Array<{ key: string; type: string }>;
      chunksize?: number;
    }
  | {
      operation: "aggregate";
      path: string;
      datasetId: string;
      contentHash: string;
      groupBy: string[];
      metrics: DataAggregateMetric[];
      topN?: number;
      orderBy?: { metric: string; direction: "asc" | "desc" };
      periodColumn?: string;
      compareMetric?: string;
      chunksize?: number;
    };

let cachedPython: string | null | undefined;

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolvePythonExecutable(): Promise<string | null> {
  if (cachedPython !== undefined) return cachedPython;
  const candidates = process.platform === "win32"
    ? [
        { cmd: "py", args: ["-3", "-c", "import sys; print(sys.executable)"] },
        { cmd: "python", args: ["-c", "import sys; print(sys.executable)"] },
        { cmd: "python3", args: ["-c", "import sys; print(sys.executable)"] }
      ]
    : [
        { cmd: "python3", args: ["-c", "import sys; print(sys.executable)"] },
        { cmd: "python", args: ["-c", "import sys; print(sys.executable)"] }
      ];
  for (const candidate of candidates) {
    try {
      const stdout = await runProcess(candidate.cmd, candidate.args, "", 15_000);
      const exe = stdout.trim().split(/\r?\n/).pop()?.trim();
      if (exe && await fileExists(exe)) {
        cachedPython = exe;
        return exe;
      }
    } catch {
      // try next
    }
  }
  cachedPython = null;
  return null;
}

function runProcess(command: string, args: string[], stdin: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`BRAIN_DATA_PYTHON_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`BRAIN_DATA_PYTHON_EXIT:${code}:${stderr || stdout}`));
    });
    if (stdin) child.stdin.end(stdin, "utf8");
    else child.stdin.end();
  });
}

async function resolveStatsScriptPath() {
  const fromUrl = fileURLToPath(SCRIPT_URL);
  if (await fileExists(fromUrl)) return fromUrl;
  const temp = join(tmpdir(), `brain-data-python-stats-${randomBytes(6).toString("hex")}.py`);
  await writeFile(temp, DATA_PYTHON_STATS_SOURCE, "utf8");
  return temp;
}

export async function runPythonDatasetStats(request: PythonStatsRequest): Promise<DataAnalysisResult | DataAggregateResult> {
  const python = await resolvePythonExecutable();
  if (!python) throw new Error("BRAIN_DATA_PYTHON_UNAVAILABLE");
  const script = await resolveStatsScriptPath();
  const payload = {
    ...request,
    chunksize: request.chunksize ?? 100_000
  };
  const stdout = await runProcess(python, [script], JSON.stringify(payload), 10 * 60_000);
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
  const parsed = JSON.parse(line) as { ok?: boolean; error?: string; result?: Record<string, unknown> };
  if (!parsed.ok || !parsed.result) throw new Error(`BRAIN_DATA_PYTHON_FAILED:${parsed.error || "unknown"}`);
  const createdAt = new Date().toISOString();
  if (request.operation === "summary") {
    const columns = Array.isArray(parsed.result.columns) ? parsed.result.columns as DataAnalysisResult["columns"] : [];
    const rowCount = Number(parsed.result.rowCount) || 0;
    const inputHash = createHash("sha256")
      .update(JSON.stringify({ datasetId: request.datasetId, contentHash: request.contentHash, columns, rowCount, engine: "python" }))
      .digest("hex");
    return {
      datasetId: request.datasetId,
      operation: "summary",
      inputHash,
      rowCount,
      columns,
      createdAt
    };
  }
  const metrics = request.metrics.map((metric) => ({
    column: metric.column,
    operation: metric.operation,
    as: metric.as?.trim() || `${metric.operation}_${metric.column}`
  }));
  const rows = Array.isArray(parsed.result.rows) ? parsed.result.rows as DataAggregateResult["rows"] : [];
  const inputHash = createHash("sha256")
    .update(JSON.stringify({
      datasetId: request.datasetId,
      contentHash: request.contentHash,
      groupBy: request.groupBy,
      metrics,
      topN: request.topN,
      orderBy: request.orderBy,
      periodColumn: request.periodColumn,
      compareMetric: request.compareMetric,
      rowCount: parsed.result.rowCount,
      engine: "python"
    }))
    .digest("hex");
  return {
    datasetId: request.datasetId,
    operation: "aggregate",
    groupBy: request.groupBy,
    metrics,
    rows,
    ...(typeof request.topN === "number" ? { topN: request.topN } : {}),
    ...(Array.isArray(parsed.result.shares) ? { shares: parsed.result.shares as DataAggregateResult["shares"] } : {}),
    ...(Array.isArray(parsed.result.periodComparison)
      ? { periodComparison: parsed.result.periodComparison as DataAggregateResult["periodComparison"] }
      : {}),
    inputHash,
    rowCount: Number(parsed.result.rowCount) || 0,
    createdAt
  };
}
