# BRAIN Document Runtime v1 — 文档创作场景 Tools 子架构

> Status: **approved baseline** for **document 场景 Tools 子架构**  
> Parent: [brain-scene-tools-v1.md](./brain-scene-tools-v1.md)  
> Related: [brain-product-architecture.md](./brain-product-architecture.md)（document worker 边界）

## 0. 在 BRAIN 中的位置

```text
BRAIN 主框架
└─ 七场景 Tools 子架构
   └─ document（文档创作, workspaceKey = "document"）   ← 本文档
      ├─ 继承：项目 / 对话 / Composer / Rust Core / 能力运行时
      ├─ 扩展：多格式导入 · **对话读文档** · 锚点修订 · 审校 · 原格式导出
      └─ 外部 Engine：**document worker**（Rust `document.ingest` / 渲染）
```

| 层 | 路径 | 说明 |
|----|------|------|
| 主框架 | **Composer + @文档引用** | 主入口；不是 Word 菜单栏 |
| document UI | 预览 / 结构树 / 修订面板 | 锚点选中 → 喂给模型 |
| document IPC | `brain:document:*` | ingest / revision / export |
| 修订服务 | `BrainDocumentRevisionService` | **已有** 结构化锚点 accept/export |
| Engine | Rust document worker | `document.ingest`、未来 render/export |

**对标关系（AI 文档理解 / 协作框架，非传统 Office 克隆）：**

| 主流 AI 文档产品 / 框架 | 借鉴什么 | BRAIN 不做什么 |
|-------------------------|----------|----------------|
| **WorkBuddy / 腾讯文档 Agent** | **文稿预览为主** + 编辑工具栏（样式/对齐/颜色）+ **标记画笔 / 备注** → 定点重生成 | 不嵌入 WorkBuddy 客户端 |
| **NotebookLM / ChatPDF / Humata** | 上传 PDF/DOCX → **对话问答**、摘要、引用段落 | 不做只读聊天 SaaS |
| **Word Copilot / Google Docs Gemini** | 选中段落 → **AI 改写/扩写** | 不做完整排版引擎 |
| **Adobe Acrobat AI Assistant** | PDF 摘要、跨页问答 | 不做 Acrobat 全功能 |
| **Cursor @docs** | 仓库/文档 **结构化锚点** 进上下文 | 已用 structural revision 实现 |
| **Redline / Track Changes 工作流** | 提议修订 → **用户 accept/reject** → 导出 | 不做 OOXML 级 WYSIWYG 编辑器 |

BRAIN document = **ingest + 对话读文档 + 锚点修订 + Cook 导出**；Word/Acrobat 仅可选 `launch_external` 打开源文件。

---

## 1. 参考模型（AI 文档修订管线抽象）

| 用户动作 | document 子架构 | 谁执行 |
|----------|-----------------|--------|
| 导入 PDF/DOCX/MD | `document.ingest` | Rust worker |
| 「总结第三章」 | Composer + 文档 context | instruction |
| 选中 / 画笔标记段落 | structural anchor + mark | 用户 |
| 备注锚定位置 | note → anchor | UI |
| 「按标记位置重生成」 | anchor → revision proposal | Agent + revision service |
| Accept / Reject | revision IPC | 用户确认 |
| 导出带修订 MD/DOCX | export IPC | worker / Main |

| 后台概念 | 实现 | 持久化 |
|----------|------|--------|
| Parsed structure | ingest 输出 anchors | 项目内 parsed JSON |
| Revision draft | `BrainDocumentRevisionService` | SQLite + 文件 |
| Cook bundle | `document.cook`（规划） | `Docs/BRAIN/` |

---

## 2. 磁盘工程布局（Cook 后）

```text
{ProjectRoot}/
├── .brain-document/
│   ├── manifest.json
│   └── pipeline.json
├── documents/
│   ├── source/                # 原始 PDF/DOCX/…
│   └── parsed/                # ingest 结构化输出
└── Docs/
    └── BRAIN/
        ├── revision-export.md
        └── manifest.json
```

---

## 3. Rust `document.*` 操作目录

| Operation | 审批 | 现状 | 说明 |
|-----------|------|------|------|
| `document.ingest` | 是 | **已有** | worker 解析 |
| `document.revision.apply` | 是 | **已有** TS service | accept → 写盘 |
| `document.cook` | 是 | 部分 | 修订 bundle + manifest |
| `document.export` | 是 | 部分 E2E | 原格式/MD 导出 |

---

## 4. 与能力运行时

| 意图 | Provider |
|------|----------|
| 导入/解析 | Rust worker `document.ingest` |
| 对话读文档 | instruction + ingest anchors |
| 提议修订 | Agent + revision service |
| 接受/导出 | builtin revision IPC |
| 审校 bundle | `document.cook` |

---

## 5. 实施阶段

| Phase | 交付 |
|-------|------|
| P0 ✅ | 本文 + `test-electron-brain-document-revision.mjs` 基线 |
| P1 | Composer @文档 引用 + 摘要/问答默认路径 |
| P2 | 多格式 export hardened + `document.cook` |
| P3 | PDF/DOCX 原格式 redline（worker） |
| P4 | 可选 `document.launch_external`（Word/Acrobat） |

---

**Version:** `brain-document-runtime-v1`
