# 数据与决策场景

能力：CSV/Excel 导入、数据集、摘要分析、图表和决策 Flow。

**右侧 Tools 子架构（必走）：** Julius / 数据导入 / 数据表格 / 数据清洗 / 图表 / 决策 Flow。

必须使用 `data.file.import_local`、`data.analysis.summarize` / `aggregate`、`data.analysis.save` / `cook` 等场景工具；禁止用 shell 手写分析脚本绕过 `data.*`。分析必须说明数据集、筛选条件和实际工具结果。
