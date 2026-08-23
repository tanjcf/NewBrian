# BRAIN Data Runtime v1 — 数据与决策场景 Tools 子架构

> Status: **approved baseline** for **data 场景 Tools 子架构**  
> Parent: [brain-scene-tools-v1.md](./brain-scene-tools-v1.md)  
> Related: [brain-quant-runtime-v1.md](./brain-quant-runtime-v1.md)（同级「对话优先」模板）

## 0. 在 BRAIN 中的位置

```text
BRAIN 主框架
└─ 七场景 Tools 子架构
   └─ data（数据与决策, workspaceKey = "data"）   ← 本文档
      ├─ 继承：项目 / 对话 / Composer / Rust Core / 能力运行时
      ├─ 扩展：上传表格 · 对话分析 · 图表卡片 · 决策摘要
      └─ 外部 Engine：Agent 数据分析（pandas/Python）· 未来 Rust 聚合 · 可选 NL→SQL 网关
```

| 层 | 路径 | 说明 |
|----|------|------|
| 主框架 | `WorkspaceModules.tsx` + **Composer** | **主入口是对话**，不是 Jupyter 单元格 |
| data UI | `DataWorkspace.tsx`（compact 侧栏） | **结果面板**：表格预览、统计、图表 |
| data IPC | `brain:data:*` | ingest / query / analyze |
| AI 分析 | Agent + `instruction` + **process**（pandas 脚本） | 对话驱动 ETL/统计/作图 |
| 规划 Rust 模块 | `rust/brain-core/src/data/`（待建） | `data.*` 大表聚合、Cook |

**对标关系（AI 数据分析框架，非传统 BI 工作台）：**

| 主流 AI 数据产品 / 框架 | 借鉴什么 | BRAIN 不做什么 |
|-------------------------|----------|----------------|
| **ChatGPT Advanced Data Analysis**（Code Interpreter） | 上传 CSV → **自然语言提问** → 自动清洗/统计/出图 | 不做完整 Jupyter Lab UI |
| **Julius AI** | 对话式探索数据集、一键图表 | 不做独立 SaaS 数据集托管 |
| **Excel Copilot / WPS AI 表格** | 「这列什么意思」「算同比」类 **NL 洞察** | 不做 Excel 公式编辑器克隆 |
| **Metabase AI / ThoughtSpot Sage** | NL → 查询/图表（轻量 BI） | 不做企业级权限建模台 |
| **PandasAI / LangChain pandas agent** | Agent 代写 **pandas 变换** 并执行 | 不让用户手写 SQL 为主路径 |

BRAIN data = **对话即分析 + 侧栏结果镜像 + Cook 导出报告**；Excel/Jupyter/Metabase 仅可选 `launch_external` 或导入源，不是主对标。

---

## 1. 参考模型（AI 数据分析管线抽象）

| 用户动作 | data 子架构 | 谁执行 |
|----------|--------------|--------|
| 「分析这份销售表」 | 选文件/附件 → ingest | Agent + `DataWorkspace` 联动 |
| 「算各区域同比」 | pandas 脚本 + 统计 | Agent process（审批） |
| 「画折线图」 | `DataTrendChart` 更新 | Agent 写 query + 侧栏渲染 |
| 「清洗空值后导出」 | transform + Cook | Agent + `data.cook` |
| 「给决策建议」 | instruction + 分析 context | Composer 摘要 |

| 后台概念（用户不直接操作） | 实现 | 持久化 |
|----------------------------|------|--------|
| Dataset ingest | CSV/XLSX ingest IPC | 项目 `data/` + SQLite 索引 |
| Transform / clean | Agent pandas | run 日志 + 衍生 dataset |
| Chart spec | `DataWorkspace` state | SQLite scene state |
| Decision memo | section | Cook → `Docs/BRAIN/decision.md` |

---

## 2. 磁盘工程布局（Cook 后）

```text
{ProjectRoot}/
├── .brain-data/
│   ├── manifest.json
│   └── pipeline.json
├── data/
│   ├── raw/                   # 原始 CSV/XLSX
│   └── derived/               # Agent 清洗结果
└── Docs/
    └── BRAIN/
        ├── analysis-summary.md
        ├── chart-specs.json
        └── decision.md
```

---

## 3. Rust `data.*` 操作目录（目标态）

| Operation | 审批 | 现状 | 说明 |
|-----------|------|------|------|
| `data.inspect` | 否 | 无 | 扫描 data/、dataset 完整性 |
| `data.cook` | 是 | 无 | 分析摘要 + chart spec → `Docs/BRAIN` |
| `data.aggregate` | 是 | 无 | 大表 Rust 聚合（未来） |

今日 CSV/XLSX ingest 与表格预览已在 Main；**P1** 强化 Composer → analyze 闭环。

---

## 4. 与能力运行时

| 意图 | Provider |
|------|----------|
| 上传/选表 | file ingest + `DataWorkspace` |
| NL 分析/清洗 | Agent + process（pandas，审批） |
| 出图 | builtin 侧栏 chart + Agent 写 spec |
| 决策摘要 | instruction + 分析 context |
| 导出报告 | `data.cook` |

---

## 5. 实施阶段

| Phase | 交付 |
|-------|------|
| P0 ✅ | 本文 + 对标 AI 数据分析框架 |
| P1 | Composer「分析这份表」→ ingest + 统计 + 图表（零 Jupyter） |
| P2 | `data.cook` + 决策 memo Export |
| P3 | `data.*` Rust 大表聚合 |
| P4 | 可选 NL→SQL 网关（Metabase AI 式） |

---

**Version:** `brain-data-runtime-v1`
