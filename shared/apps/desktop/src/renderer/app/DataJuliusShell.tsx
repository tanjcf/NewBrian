import { useEffect, useState } from "react";
import type { BrainDataAnalysisState, BrainDataRegionRow } from "@codex-forge/protocol/brain-data-runtime";
import type { ProjectFileOption } from "./ProjectFilePicker";

function buildRegionRows(comparisons: Array<{ keys: Record<string, string>; changePercent: number }>): BrainDataRegionRow[] {
  if (!comparisons.length) return [];
  const maxAbs = Math.max(...comparisons.map((item) => Math.abs(item.changePercent)), 1);
  return comparisons.map((item) => ({
    region: item.keys.region || Object.values(item.keys)[0] || "未知",
    yoy: item.changePercent,
    height: Math.max(12, Math.round(Math.abs(item.changePercent) / maxAbs * 88))
  }));
}

function buildInsight(datasetName: string, regionRows: BrainDataRegionRow[]) {
  if (!regionRows.length) return "等待生成分析洞察。";
  const sorted = [...regionRows].sort((left, right) => left.yoy - right.yoy);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  return `${datasetName}：${worst.region} 环比 ${worst.yoy > 0 ? "+" : ""}${worst.yoy.toFixed(1)}% 为最低，${best.region} ${best.yoy > 0 ? "+" : ""}${best.yoy.toFixed(1)}% 表现最好；建议优先核查 ${worst.region} 的收入与成本结构。`;
}

export function DataJuliusShell({ projectId, files = [], refreshToken = 0 }: { projectId?: string; files?: ProjectFileOption[]; refreshToken?: number }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [fileName, setFileName] = useState("未导入数据集");
  const [rows, setRows] = useState<unknown[]>([]);
  const [regionRows, setRegionRows] = useState<BrainDataRegionRow[]>([]);
  const [insight, setInsight] = useState("等待生成分析洞察。");
  const [status, setStatus] = useState("Julius 数据分析 · 等待数据集");

  useEffect(() => {
    if (!projectId || !window.newbrain?.listDataDatasets) {
      setStatus("Julius 数据分析 · 未绑定工程");
      return;
    }
    let canceled = false;
    const load = async () => {
      setAnalyzing(true);
      setStatus("正在加载真实数据集…");
      try {
        const datasets = await window.newbrain.listDataDatasets({ projectId });
        const latest = Array.isArray(datasets) ? datasets[0] : null;
        if (!latest) {
          if (!canceled) {
            setFileName(files.find((file) => `${file.originalName || ""}${file.logicalName || ""}`.toLowerCase().includes(".csv"))?.originalName || "未导入数据集");
            setRows([]);
            setRegionRows([]);
            setInsight("请先在「数据导入」导入 CSV/XLSX，或在对话中调用 data.dataset.import_csv。");
            setAnalyzing(false);
            setStatus("Julius 数据分析 · 尚无数据集");
          }
          return;
        }
        const datasetRows = window.newbrain.readDataRows
          ? await window.newbrain.readDataRows({ projectId, datasetId: latest.id })
          : [];
        const columnKeys = latest.columns.map((column: { key: string }) => column.key);
        const revenueKey = columnKeys.find((key) => /revenue|收入|amount|value|profit|利润/iu.test(key)) || columnKeys.find((key) => latest.columns.find((column: { key: string; type: string }) => column.key === key)?.type === "number");
        const regionKey = columnKeys.find((key) => /region|区域|area|city|城市/iu.test(key));
        const periodKey = columnKeys.find((key) => /quarter|month|date|period|季度|月份|日期/iu.test(key));
        let nextRegionRows: BrainDataRegionRow[] = [];
        if (revenueKey && regionKey && periodKey && window.newbrain.aggregateData) {
          const saved = await window.newbrain.aggregateData({
            projectId,
            datasetId: latest.id,
            groupBy: [regionKey],
            metrics: [{ column: revenueKey, operation: "sum" }],
            topN: 8,
            orderBy: { metric: `sum_${revenueKey}`, direction: "desc" },
            periodColumn: periodKey,
            compareMetric: revenueKey
          });
          const comparisons = saved?.result?.periodComparison || [];
          nextRegionRows = buildRegionRows(comparisons);
        }
        if (!nextRegionRows.length && window.newbrain.listDataAnalyses) {
          const analyses = await window.newbrain.listDataAnalyses({ projectId, datasetId: latest.id });
          const aggregate = Array.isArray(analyses) ? analyses.find((item) => item?.result?.operation === "aggregate") : null;
          if (aggregate?.result?.periodComparison?.length) nextRegionRows = buildRegionRows(aggregate.result.periodComparison);
        }
        if (!canceled) {
          setFileName(latest.name);
          setRows(Array.isArray(datasetRows) ? datasetRows : []);
          setRegionRows(nextRegionRows);
          setInsight(buildInsight(latest.name, nextRegionRows));
          setAnalyzing(false);
          setStatus(nextRegionRows.length ? `已加载 ${latest.name} · ${latest.rowCount} 行` : `已加载 ${latest.name} · 待运行聚合`);
        }
      } catch (error) {
        if (!canceled) {
          setAnalyzing(false);
          setStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    void load();
    return () => { canceled = true; };
  }, [projectId, files, refreshToken]);

  const persistAnalysis = async (nextAnalyzing = analyzing, cook = false) => {
    if (!projectId || !window.newbrain?.saveBrainDataAnalysis) {
      setStatus(cook ? "分析摘要已保存到本地草稿" : "状态已保存在本地");
      return;
    }
    const state: BrainDataAnalysisState = { fileName, rows, insight, regionRows, analyzing: nextAnalyzing };
    try {
      await window.newbrain.saveBrainDataAnalysis({ projectId, state });
      if (cook && window.newbrain.cookBrainDataAnalysis) await window.newbrain.cookBrainDataAnalysis({ projectId });
      setStatus(cook ? "已保存并生成分析产物" : "分析状态已保存");
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleAnalysis = () => {
    const next = !analyzing;
    setAnalyzing(next);
    setStatus(next ? "Running Python…" : "分析已暂停");
    void persistAnalysis(next);
  };

  return (
    <section
      className="brain-data-julius-shell"
      aria-label="Julius 数据分析"
      data-testid="brain-data-julius-shell"
    >
      <header className="brain-data-julius-head">
        <div>
          <strong>Julius</strong>
          <span className="brain-data-julius-project">{projectId ? "已绑定工程" : "未绑定工程"}</span>
        </div>
        <button
          type="button"
          className={analyzing ? "brain-data-julius-badge-on" : "brain-data-julius-badge"}
          aria-pressed={analyzing}
          onClick={toggleAnalysis}
        >
          {analyzing ? "Analyzing" : "Ready"}
        </button>
      </header>

      <div className="brain-data-julius-body">
        <div className="brain-data-julius-file">
          <span>▦</span>
          <div><strong>{fileName}</strong><small>{rows.length || 0} rows · 真实数据集</small></div>
        </div>

        <div className="brain-data-julius-running" role="status">
          <span className="brain-data-julius-dot" />
          <span className="brain-data-julius-dot" />
          <span className="brain-data-julius-dot" />
          {analyzing ? "Running Python…" : "本地聚合统计已就绪"}
        </div>

        <pre className="brain-data-julius-code">
          <code>{`import pandas as pd
df = pd.read_csv("${fileName}")
grouped = df.groupby(["region"]).agg({"revenue": "sum"})
→ Done in local runtime`}</code>
        </pre>

        <div className="brain-data-julius-result" data-testid="brain-data-julius-result">
          <h3>区域环比结果</h3>
          {regionRows.length ? (
            <table>
              <thead><tr><th>区域</th><th>环比</th></tr></thead>
              <tbody>
                {regionRows.map((row) => (
                  <tr key={row.region}>
                    <td>{row.region}</td>
                    <td className={row.yoy < 0 ? "brain-data-julius-negative" : "brain-data-julius-positive"}>
                      {row.yoy > 0 ? "+" : ""}{row.yoy.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>暂无聚合结果。请导入含区域/周期/数值列的数据集。</p>}
        </div>

        <div className="brain-data-julius-chart-card">
          <header><strong>区域环比</strong><span>单位：%</span></header>
          <div className="brain-data-julius-chart" aria-label="区域环比柱状图" data-testid="brain-data-julius-chart">
            {regionRows.map((row) => (
              <div className="brain-data-julius-bar-wrap" key={row.region}>
                <span>{row.yoy > 0 ? "+" : ""}{row.yoy.toFixed(1)}</span>
                <i
                  className={row.yoy < 0 ? "brain-data-julius-bar-negative" : "brain-data-julius-bar"}
                  style={{ height: `${row.height}%` }}
                />
                <b>{row.region}</b>
              </div>
            ))}
          </div>
        </div>

        <aside className="brain-data-julius-insight">
          <strong>Insight</strong>
          <p data-testid="brain-data-julius-insight">{insight}</p>
        </aside>
      </div>

      <footer className="brain-data-julius-status">
        <span>{status}</span>
        <button type="button" onClick={() => void persistAnalysis(analyzing, true)}>保存摘要</button>
      </footer>
    </section>
  );
}
