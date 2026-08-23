import { useEffect, useState } from "react";
import type { BrainDataAnalysisState, BrainDataRegionRow } from "@codex-forge/protocol/brain-data-runtime";

const seedRegionRows: BrainDataRegionRow[] = [
  { region: "华东", yoy: 12.4, height: 72 },
  { region: "华北", yoy: -3.2, height: 28 },
  { region: "西南", yoy: 15.6, height: 88 },
  { region: "华南", yoy: 9.8, height: 58 }
];

export function DataJuliusShell({ projectId }: { projectId?: string }) {
  const [analyzing, setAnalyzing] = useState(true);
  const [fileName, setFileName] = useState("sales_q3.csv");
  const [rows, setRows] = useState<unknown[]>([]);
  const [regionRows, setRegionRows] = useState(seedRegionRows);
  const [insight, setInsight] = useState("华北是唯一负增长区域，其中家居品类同比 -11%；建议优先核查渠道与库存结构。");
  const [status, setStatus] = useState("Julius 数据分析 · 本地草稿");

  useEffect(() => {
    if (!projectId || !window.codecn?.getBrainDataAnalysis) return;
    void window.codecn.getBrainDataAnalysis({ projectId }).then((result: { state?: BrainDataAnalysisState }) => {
      if (!result.state) return;
      setFileName(result.state.fileName || "sales_q3.csv");
      setRows(result.state.rows);
      setRegionRows(result.state.regionRows);
      setInsight(result.state.insight);
      setAnalyzing(result.state.analyzing);
      setStatus("已从 Rust 工程加载");
    }).catch((error: unknown) => setStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`));
  }, [projectId]);

  const persistAnalysis = async (nextAnalyzing = analyzing, cook = false) => {
    if (!projectId || !window.codecn?.saveBrainDataAnalysis) {
      setStatus(cook ? "分析摘要已保存到本地草稿" : "状态已保存在本地");
      return;
    }
    const state: BrainDataAnalysisState = { fileName, rows, insight, regionRows, analyzing: nextAnalyzing };
    try {
      await window.codecn.saveBrainDataAnalysis({ projectId, state });
      if (cook && window.codecn.cookBrainDataAnalysis) await window.codecn.cookBrainDataAnalysis({ projectId });
      setStatus(cook ? "已保存并生成 Rust 分析产物" : "分析状态已保存");
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
          {analyzing ? "Analyzing" : "Paused"}
        </button>
      </header>

      <div className="brain-data-julius-body">
        <div className="brain-data-julius-file">
          <span>▦</span>
          <div><strong>{fileName}</strong><small>{rows.length || 1_248} rows · 248 KB</small></div>
        </div>

        <div className="brain-data-julius-running" role="status">
          <span className="brain-data-julius-dot" />
          <span className="brain-data-julius-dot" />
          <span className="brain-data-julius-dot" />
          {analyzing ? "Running Python…" : "Python 已暂停"}
        </div>

        <pre className="brain-data-julius-code">
          <code>{`import pandas as pd
df = pd.read_csv("sales_q3.csv")
yoy = df.groupby("region").apply(...)
→ Done in 1.2s`}</code>
        </pre>

        <div className="brain-data-julius-result">
          <h3>Q3 区域同比结果</h3>
          <table>
            <thead><tr><th>区域</th><th>同比</th></tr></thead>
            <tbody>
              {regionRows.map((row) => (
                <tr key={row.region}>
                  <td>{row.region}</td>
                  <td className={row.yoy < 0 ? "brain-data-julius-negative" : "brain-data-julius-positive"}>
                    {row.yoy > 0 ? "+" : ""}{row.yoy}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="brain-data-julius-chart-card">
          <header><strong>区域同比</strong><span>单位：%</span></header>
          <div className="brain-data-julius-chart" aria-label="区域同比柱状图">
            {regionRows.map((row) => (
              <div className="brain-data-julius-bar-wrap" key={row.region}>
                <span>{row.yoy > 0 ? "+" : ""}{row.yoy}</span>
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
          <p>{insight || "等待生成分析洞察。"}</p>
        </aside>
      </div>

      <footer className="brain-data-julius-status">
        <span>{status}</span>
        <button type="button" onClick={() => void persistAnalysis(analyzing, true)}>保存摘要</button>
      </footer>
    </section>
  );
}
