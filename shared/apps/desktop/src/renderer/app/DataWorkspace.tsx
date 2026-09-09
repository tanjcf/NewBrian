import { useEffect, useState } from "react";
import { DataTrendChart, type DataChartType } from "./DataTrendChart";
import { ProjectFilePicker, type ProjectFileOption } from "./ProjectFilePicker";
import { useWorkspaceSceneState } from "./useWorkspaceSceneState";

type DataUiState = {
  selectedDatasetId: string;
  chartType: DataChartType;
  fileId: string;
  xlsxSheet: string;
  query: string;
};

const defaultDataUi: DataUiState = {
  selectedDatasetId: "",
  chartType: "line",
  fileId: "",
  xlsxSheet: "",
  query: ""
};

function buildNumericChart(rows: string[][], columnIndex: number) {
  const values = rows.map((row, index) => ({ index, value: Number(row[columnIndex]) })).filter((item) => Number.isFinite(item.value)).slice(0, 256);
  if (!values.length) return [];
  const min = Math.min(...values.map((item) => item.value));
  const span = Math.max(...values.map((item) => item.value)) - min || 1;
  return values.map((item, index) => ({ ...item, x: values.length < 2 ? 0 : index / (values.length - 1), y: 1 - (item.value - min) / span }));
}

function isDataFile(file: ProjectFileOption): boolean {
  const name = `${file.logicalName || ""} ${file.originalName || ""} ${file.relativePath || ""} ${file.storageKey || ""}`.toLowerCase();
  return name.includes(".csv") || name.includes(".xlsx");
}

export function DataWorkspace({
  projectId,
  files = [],
  selectedFileId = "",
  onSelectFile,
  activeView = "import",
  refreshToken = 0
}: {
  projectId?: string;
  files?: ProjectFileOption[];
  selectedFileId?: string;
  onSelectFile?: (fileId: string) => void;
  activeView?: "import" | "table" | "clean" | "analysis" | "chart";
  refreshToken?: number;
}) {
  const { state: ui, setState: setUi, hydrated } = useWorkspaceSceneState(projectId, "data", defaultDataUi);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [rows, setRows] = useState<Record<string, string[][]>>({});
  const [analysis, setAnalysis] = useState<any>(null);
  const [aggregate, setAggregate] = useState<any>(null);
  const [status, setStatus] = useState("正在加载数据集");
  const [localFileId, setLocalFileId] = useState("");
  const [xlsxSheets, setXlsxSheets] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const fileId = onSelectFile ? selectedFileId : (localFileId || ui.fileId);
  const chartType = ui.chartType;
  const query = ui.query;
  const selectedId = ui.selectedDatasetId;
  const xlsxSheet = ui.xlsxSheet || "";
  const setFileId = (value: string) => {
    if (onSelectFile) onSelectFile(value);
    else setLocalFileId(value);
    setUi((current) => ({ ...current, fileId: value }));
  };

  useEffect(() => {
    const file = files.find((item) => item.id === fileId);
    const isXlsx = `${file?.originalName || ""} ${file?.logicalName || ""} ${file?.storageKey || ""}`.toLowerCase().includes(".xlsx");
    if (!isXlsx || !projectId || !fileId || !window.newbrain?.listDataXlsxSheets) { setXlsxSheets([]); return; }
    void window.newbrain.listDataXlsxSheets({ projectId, fileId }).then((items: string[]) => {
      const safe = Array.isArray(items) ? items : [];
      setXlsxSheets(safe);
      const nextSheet = ui.xlsxSheet && safe.includes(ui.xlsxSheet) ? ui.xlsxSheet : (safe[0] || "");
      if (nextSheet !== ui.xlsxSheet) setUi((current) => ({ ...current, xlsxSheet: nextSheet }));
    }).catch(() => setXlsxSheets([]));
  }, [fileId, files, projectId, ui.xlsxSheet, setUi]);

  useEffect(() => {
    if (!projectId || !window.newbrain?.listDataDatasets) { setStatus("请选择数据项目"); return; }
    void window.newbrain.listDataDatasets({ projectId }).then(async (items: any[]) => {
      const safe = Array.isArray(items) ? items : [];
      setDatasets(safe);
      if (window.newbrain?.readDataRows) {
        const loaded = await Promise.all(safe.map(async (item) => [item.id, await window.newbrain.readDataRows({ projectId, datasetId: item.id })] as const));
        setRows(Object.fromEntries(loaded));
      }
      if (hydrated && ui.selectedDatasetId && safe.some((item) => item.id === ui.selectedDatasetId)) {
        /* keep restored selection */
      } else if (safe[0]?.id) {
        setUi((current) => ({ ...current, selectedDatasetId: current.selectedDatasetId || safe[0].id }));
      }
      setStatus("数据集已加载");
    }).catch(() => setStatus("数据集暂不可用"));
  }, [projectId, hydrated, refreshToken]);

  useEffect(() => {
    if (!projectId || !selectedId || !window.newbrain?.listDataAnalyses) return;
    void window.newbrain.listDataAnalyses({ projectId, datasetId: selectedId }).then((items: any[]) => {
      const latest = Array.isArray(items) ? items : [];
      const summary = latest.find((item) => item?.result?.operation === "summary") || latest[0];
      const grouped = latest.find((item) => item?.result?.operation === "aggregate");
      if (summary?.result?.operation === "summary") setAnalysis(summary.result);
      if (grouped?.result?.operation === "aggregate") setAggregate(grouped.result);
    }).catch(() => undefined);
  }, [projectId, selectedId, refreshToken]);
  useEffect(() => {
    if (onSelectFile) return;
    const fallback = files.find(isDataFile)?.id || files[0]?.id || "";
    if (!localFileId && !ui.fileId && fallback) setFileId(fallback);
    else if (!localFileId && ui.fileId) setLocalFileId(ui.fileId);
  }, [files, localFileId, onSelectFile, ui.fileId]);

  const selected = datasets.find((item) => item.id === selectedId) || datasets.find((item) => item.id === ui.selectedDatasetId) || datasets[0];
  const sourceRows = selected ? rows[selected.id] || [] : [];
  const filtered = sourceRows.filter((row) => !query || row.some((value) => String(value).toLowerCase().includes(query.toLowerCase())));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const numericIndex = selected?.columns.findIndex((column: any) => column.type === "number") ?? -1;
  const points = numericIndex >= 0 ? buildNumericChart(sourceRows, numericIndex) : [];
  const quality = (() => {
    const blankCells = sourceRows.reduce((count, row) => count + (selected?.columns.reduce((sum: number, _column: any, index: number) => sum + (String(row[index] ?? "").trim() ? 0 : 1), 0) ?? 0), 0);
    const rowKeys = sourceRows.map((row) => JSON.stringify(row));
    const duplicateRows = rowKeys.length - new Set(rowKeys).size;
    const invalidNumericCells = selected?.columns.reduce((count: number, column: any, index: number) => column.type !== "number" ? count : count + sourceRows.filter((row) => String(row[index] ?? "").trim() && !Number.isFinite(Number(row[index]))).length, 0) ?? 0;
    return { blankCells, duplicateRows, invalidNumericCells };
  })();

  const importCsv = () => {
    if (!projectId || !fileId) { setStatus("请选择已登记的 CSV/XLSX 文件"); return; }
    const file = files.find((item) => item.id === fileId);
    const isXlsx = `${file?.originalName || ""} ${file?.logicalName || ""} ${file?.storageKey || ""}`.toLowerCase().includes(".xlsx");
    const importer = isXlsx ? window.newbrain?.importDataXlsx : window.newbrain?.importDataCsv;
    if (!importer) { setStatus("当前桌面版本暂不支持该表格格式"); return; }
    void importer({
      projectId, fileId, datasetId: `dataset-${Date.now()}`,
      name: files.find((file) => file.id === fileId)?.originalName || files.find((file) => file.id === fileId)?.logicalName || "CSV 数据集",
      ...(isXlsx && xlsxSheet ? { sheetName: xlsxSheet } : {}),
      updatedAt: new Date().toISOString()
    }).then((result: any) => {
      setDatasets((items) => [result.dataset, ...items]);
      setRows((items) => ({ ...items, [result.dataset.id]: result.rows || [] }));
      setUi((current) => ({ ...current, selectedDatasetId: result.dataset.id }));
      setAnalysis(null);
      setAggregate(null);
      setStatus(`已导入 ${result.rows?.length || 0} 行`);
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "CSV 导入失败"));
  };
  const runAnalysis = () => {
    if (!projectId || !selected || !window.newbrain?.summarizeData) return;
    setStatus("正在生成摘要");
    void window.newbrain.summarizeData({ projectId, datasetId: selected.id }).then((result: any) => {
      setAnalysis(result?.result || null);
      setStatus("分析结果已保存");
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "分析失败"));
  };
  const runAggregate = () => {
    if (!projectId || !selected || !window.newbrain?.aggregateData) return;
    const columnKeys = selected.columns.map((column: any) => column.key);
    const numericKey = columnKeys.find((key: string) => selected.columns.find((column: any) => column.key === key)?.type === "number");
    const dimensionKey = columnKeys.find((key: string) => selected.columns.find((column: any) => column.key === key)?.type !== "number");
    const periodKey = columnKeys.find((key: string) => /quarter|month|date|period|季度|月份|日期/iu.test(key));
    if (!numericKey || !dimensionKey) { setStatus("当前数据集缺少可用于聚合的维度列或数值列"); return; }
    setStatus("正在生成分组聚合");
    void window.newbrain.aggregateData({
      projectId,
      datasetId: selected.id,
      groupBy: [dimensionKey],
      metrics: [{ column: numericKey, operation: "sum" }],
      topN: 10,
      orderBy: { metric: `sum_${numericKey}`, direction: "desc" },
      ...(periodKey ? { periodColumn: periodKey, compareMetric: numericKey } : {})
    }).then((result: any) => {
      setAggregate(result?.result || null);
      setStatus("分组聚合已保存");
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "聚合失败"));
  };

  return (
    <main className="brain-data-module" data-testid="brain-data-workspace">
      <header className="brain-video-header">
        <div><span>数据与决策</span><strong>{activeView === "import" ? "数据导入" : activeView === "table" ? "数据表格" : activeView === "clean" ? "数据清洗" : activeView === "analysis" ? "数据分析" : "数据图表"}</strong></div>
        <small data-testid="brain-data-status">{aggregate?.rows?.length || analysis?.columns?.length ? "分析结果已保存" : status} · 分析结果可复现</small>
      </header>
      {activeView === "import" ? <section className="brain-data-summary">
        <ProjectFilePicker
          testId="brain-data-file-select"
          files={files}
          value={fileId}
          onChange={setFileId}
          emptyLabel="选择 CSV/XLSX 文件"
          accept={isDataFile}
        />
        {xlsxSheets.length > 1 ? <select aria-label="选择工作表" value={xlsxSheet} onChange={(event) => setUi((current) => ({ ...current, xlsxSheet: event.target.value }))}>{xlsxSheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select> : null}
        <button type="button" data-testid="brain-data-import" onClick={importCsv}>导入表格</button>
        {selected ? <button type="button" data-testid="brain-data-analysis" onClick={runAnalysis}>运行摘要</button> : null}
        {selected ? <button type="button" data-testid="brain-data-aggregate" onClick={runAggregate}>分组聚合</button> : null}
        {selected && points.length ? <select aria-label="图表类型" value={chartType} onChange={(event) => setUi((current) => ({ ...current, chartType: event.target.value as DataChartType }))}><option value="line">折线图</option><option value="bar">柱状图</option><option value="scatter">散点图</option></select> : null}
      </section> : null}
      {activeView !== "import" ? <section className="brain-data-summary">
        <select data-testid="brain-data-dataset-select" value={selected?.id || ""} onChange={(event) => { setUi((current) => ({ ...current, selectedDatasetId: event.target.value })); setAnalysis(null); setAggregate(null); setPage(0); }}>
          <option value="">选择数据集</option>
          {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {activeView === "table" ? <input aria-label="筛选数据" placeholder="筛选行内容" value={query} onChange={(event) => { setUi((current) => ({ ...current, query: event.target.value })); setPage(0); }} /> : null}
        {activeView === "analysis" ? <button type="button" data-testid="brain-data-analysis" disabled={!selected} onClick={runAnalysis}>运行摘要</button> : null}
        {activeView === "analysis" ? <button type="button" data-testid="brain-data-aggregate" disabled={!selected} onClick={runAggregate}>分组聚合</button> : null}
        {activeView === "chart" ? <select aria-label="图表类型" value={chartType} onChange={(event) => setUi((current) => ({ ...current, chartType: event.target.value as DataChartType }))}><option value="line">折线图</option><option value="bar">柱状图</option><option value="scatter">散点图</option></select> : null}
      </section> : null}
      {(activeView === "analysis" || activeView === "import") && aggregate?.rows?.length ? (
        <section className="brain-data-summary" data-testid="brain-data-aggregate-result">
          <strong>分组聚合 TopN</strong>
          {aggregate.rows.map((row: any, index: number) => (
            <span key={`${index}-${JSON.stringify(row)}`}>{Object.entries(row).map(([key, value]) => `${key}=${value}`).join(" · ")}</span>
          ))}
          {aggregate.periodComparison?.length ? aggregate.periodComparison.map((item: any, index: number) => (
            <span key={`period-${index}`}>环比 {Object.values(item.keys).join("/")} · {item.changePercent}%</span>
          )) : null}
        </section>
      ) : null}
      {(activeView === "analysis" || activeView === "import") && analysis?.columns?.length ? (
        <section className="brain-data-summary" data-testid="brain-data-analysis-result">
          <strong>数值摘要</strong>
            {analysis.columns.map((item: any) => <span key={item.key}>{item.key} · 有效 {item.count} · 缺失 {item.missingCount ?? 0} · 最小 {item.min} · 最大 {item.max} · 平均 {item.mean} · 中位 {item.median} · 标准差 {item.standardDeviation}</span>)}
        </section>
      ) : null}
      {(activeView === "chart" || activeView === "import") && selected && points.length ? <div data-testid="brain-data-chart"><DataTrendChart points={points} type={chartType} label={selected.columns[numericIndex]?.label || selected.columns[numericIndex]?.key || "数值"} /></div> : null}
      {(activeView === "chart" || activeView === "import") && selected && !points.length ? <div className="brain-resource-empty">当前数据集没有可绘制的数值列。</div> : null}
      {activeView === "clean" ? <section className="brain-data-quality" data-testid="brain-data-quality"><header><strong>数据质量检查</strong><small>基于当前数据集逐行计算，不修改源文件</small></header><div><article><span>空白单元格</span><strong>{quality.blankCells}</strong></article><article><span>重复行</span><strong>{quality.duplicateRows}</strong></article><article><span>无效数值</span><strong>{quality.invalidNumericCells}</strong></article></div>{selected ? <p>{quality.blankCells || quality.duplicateRows || quality.invalidNumericCells ? "发现质量问题。可在对话中要求 BRAIN 生成清洗规则和新版本，原始数据保持不变。" : "未发现空白、重复或无效数值。"}</p> : <p>请先选择数据集。</p>}</section> : null}
      {activeView === "import" || activeView === "table" ? <section className="brain-data-list">
        {datasets.map((dataset) => (
          <article className={`brain-data-card${selected?.id === dataset.id ? " active" : ""}`} key={dataset.id} onClick={() => { setUi((current) => ({ ...current, selectedDatasetId: dataset.id })); setAnalysis(null); setAggregate(null); setPage(0); }}>
            <header><strong>{dataset.name}</strong><small>{dataset.rowCount.toLocaleString()} 行 · {dataset.columns.length} 列</small></header>
            <div className="brain-data-columns">{dataset.columns.map((column: any) => <span key={column.key}>{column.label}<em>{column.type}</em></span>)}</div>
          </article>
        ))}
        {activeView === "table" && selected && visible.length ? (
          <section className="brain-data-table-wrap">
            <table>
              <thead><tr>{selected.columns.map((column: any) => <th key={column.key}>{column.label}</th>)}</tr></thead>
              <tbody>{visible.map((row, index) => <tr key={`${page}-${index}`}>{selected.columns.map((column: any, columnIndex: number) => <td key={column.key}>{row[columnIndex] ?? ""}</td>)}</tr>)}</tbody>
            </table>
            <footer>
              <span>显示 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} / {filtered.length}</span>
              <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button>
              <button type="button" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage((value) => value + 1)}>下一页</button>
            </footer>
          </section>
        ) : null}
        {!datasets.length ? <div className="brain-resource-empty">还没有数据集，请先导入 CSV 或 XLSX。</div> : null}
      </section> : null}
    </main>
  );
}
