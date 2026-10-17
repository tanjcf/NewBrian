# PPT Hell 模板资产提取升级方案

> 方案 B：位图资产提取 + 装饰模式 SVG 片段提取
> 基于 PPT Master `pptx_template_import.py` + `svg-flat/` 渲染

---

## 1. 背景与目的

### 1.1 现状问题

PPT Hell 当前的模板提取（`01_template_intake.md`）完全依赖**视觉渲染**：
- PPTX → 宿主渲染为 PNG 截图 → Template Worker 看图 → 写文字描述到 `template_profile.json`
- 没有提取源文件中的**图片资产**（背景图、Logo）
- 没有提取重复的**装饰形状模式**（色块、分割线）
- SVG Worker 从零设计页面，无法复现模板中的精确元素

**结果**：最终生成的 PPT 中，背景图、Logo、装饰元素都与源 PPTX 不同，"模板没有真正起作用"。

### 1.2 目标

1. **提取位图资产**：从 PPTX 中提取背景图、Logo 等图片文件，存入 `template_media/`，SVG Worker 引用后嵌入最终 PPT
2. **提取装饰模式**：从 PPTX 的渲染 SVG 中识别重复的装饰形状，提取为参数化 SVG 片段，SVG Worker 可精确复现
3. **保持与现有流程的兼容**：不改变视觉提取流程，新增结构提取层作为可选增强

### 1.3 设计原则

| 原则 | 说明 |
|---|---|
| 不改现有视觉流程 | `visual_manifest.json` + Template Worker 看图判定仍为默认通道 |
| 结构提取是增强不是替代 | `template_media/` 和 `decoration_patterns.json` 仅在有 PPTX 时存在 |
| Workers 自主设计不受限 | 资产引用是"可用"不是"必须"，Workers 仍可自主决定是否使用 |
| 精确坐标记录在片段中 | 装饰模式的 SVG path 精确记录，但 Workers 可调整尺寸/颜色/位置 |
| 画布差异由 Workers 处理 | 源 PPTX 1280×720 → PPT Hell 1920×1080 的缩放由 SVG Worker 在引用时处理 |

---

## 2. 整体架构变化

### 2.1 现有流程（不变的部分）

```
Parent 确认模板 → TEMPLATE 状态
  ├─ (不变) 宿主演染 PPTX 为 PNG
  ├─ (不变) prepare_visual_references.py → template_visuals/
  └─ (不变) Template Worker 看图 → template_profile.json（设计方向参考）
```

### 2.2 新增流程

```
当 source 为 PPTX 时，在 TEMPLATE 状态末尾新增：

  ├─ (新增) extract_template_assets.py ← 本方案核心
  │    ├─ 运行 pptx_template_import.py → manifest.json + assets/ + svg-flat/
  │    ├─ 分析 manifest.json → 识别复用资产（跨页使用的图片）
  │    ├─ 提取资产到 template_media/
  │    ├─ 生成 asset_manifest.json
  │    └─ 输出 extraction_facts.json（补充到 template_profile.json 的扩展字段）
  │
  ├─ (新增) extract_decoration_patterns.py ← 本方案核心
  │    ├─ 分析 svg-flat/ 中每页 SVG
  │    ├─ 识别跨页重复的装饰形状（相同颜色/尺寸/位置的元素）
  │    ├─ 提取 SVG 片段并参数化
  │    └─ 输出 decoration_patterns.json + template_snippets/*.svg
  │
  └─ (修改) template_profile.json 新增字段：
       ├─ reusable_assets[] ← 引用 asset_manifest.json 的信息
       └─ decoration_patterns[] ← 引用 decoration_patterns.json 的信息
```

### 2.3 下游消费（修改的部分）

```
CONTENT → LAYOUT → SVG_BATCH_BUILD
  └─ SVG Worker 读取（新增上下文）：
       ├─ template_media/asset_manifest.json
       ├─ template_media/decoration_patterns.json
       └─ template_media/template_snippets/*.svg
```

---

## 3. 文件清单

### 3.1 新增脚本

| 文件 | 用途 | 依赖 |
|---|---|---|
| `scripts/template/extract_template_assets.py` | 提取位图资产 → template_media/ + asset_manifest.json | python-pptx, PIL, PPT Master 的 `pptx_to_svg/` + `template_import/` |
| `scripts/template/extract_decoration_patterns.py` | 从 svg-flat/ 中识别并提取重复装饰形状 | Python 标准库 + lxml |

### 3.2 新增合约文档

| 文件 | 用途 |
|---|---|
| `references/contracts/asset_manifest_contract.md` | `asset_manifest.json` 的 schema 定义 |
| `references/contracts/decoration_patterns_contract.md` | `decoration_patterns.json` 和 SVG snippet 的 schema 定义 |

### 3.3 新增产物目录

```
_internal/00_project/
├── template_profile.json          ← 修改：新增字段
├── template_visuals/              ← 不变：PNG截图
└── template_media/                ← 新增
    ├── asset_manifest.json        ← 资产映射清单
    ├── decoration_patterns.json   ← 装饰模式清单
    ├── template_snippets/         ← SVG 片段
    │   ├── red_block.svg
    │   ├── blue_divider.svg
    │   └── red_top_bar.svg
    ├── image1.jpeg                ← 原始位图资产
    └── image2.jpeg
```

### 3.4 修改的文件

| 文件 | 修改内容 |
|---|---|
| `references/workflow/01_template_intake.md` | 增加结构提取步骤说明 |
| `references/workflow/04_svg_worker.md` | 增加 Workers 引用 template_media 的指引 |
| `references/contracts/template_profile_contract.md` | 扩展 schema 增加 `reusable_assets`、`decoration_patterns` 字段 |
| `SKILL.md` | 更新唯二工作流描述 |

---

## 4. 数据合约设计

### 4.1 `asset_manifest.json`

```json
{
  "schema": "asset_manifest.v1",
  "source": "劲牌模板.pptx",
  "extraction_method": "pptx_template_import + manifest analysis",
  "canvas": {"width": 1280, "height": 720, "format": "ppt169"},
  "assets": [
    {
      "asset_id": "cover_bg",
      "file": "image1.jpeg",
      "type": "raster",
      "source_pages": [1],
      "usage_pattern": "full_bleed_background",
      "applies_to": {"page_types": ["cover"], "page_indices": []},
      "display_geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
      "fit": "cover",
      "confidence": "high",
      "evidence": "Used as sole background on slide 1, full-canvas image rect"
    },
    {
      "asset_id": "content_bg",
      "file": "image2.jpeg",
      "type": "raster",
      "source_pages": [3, 5, 7],
      "usage_pattern": "full_bleed_background",
      "applies_to": {"page_types": ["content", "ending"], "page_indices": []},
      "display_geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
      "fit": "cover",
      "confidence": "high",
      "evidence": "Used as background on slides 3, 5, 7"
    }
  ]
}
```

### 4.2 `decoration_patterns.json`

```json
{
  "schema": "decoration_patterns.v1",
  "source": "劲牌模板.pptx",
  "extraction_method": "svg_flat_analysis",
  "patterns": [
    {
      "pattern_id": "chapter_red_block",
      "name": "章节红色块",
      "type": "svg_snippet",
      "snippet_file": "template_snippets/red_block.svg",
      "source_pages": [2, 4, 6],
      "role": "chapter_background_block",
      "parameterized": {
        "position_x": 160,
        "position_y": 200,
        "width": 960,
        "height": 200,
        "fill": "#CA172A",
        "rx": 8,
        "shadow": {"dx": 0, "dy": 4, "stdDeviation": 3.33, "opacity": 0.2}
      },
      "applies_to": {"page_types": ["chapter_main"]},
      "confidence": "high"
    },
    {
      "pattern_id": "blue_divider",
      "name": "蓝色分割线",
      "type": "svg_snippet",
      "snippet_file": "template_snippets/blue_divider.svg",
      "source_pages": [2, 4, 6],
      "role": "chapter_separator",
      "parameterized": {
        "x1": 640, "y1": 220, "x2": 640, "y2": 380,
        "stroke": "#4874CB", "stroke_width": 3
      },
      "applies_to": {"page_types": ["chapter_main"]},
      "confidence": "high"
    },
    {
      "pattern_id": "red_top_bar",
      "name": "顶部红色装饰条",
      "type": "svg_snippet",
      "snippet_file": "template_snippets/red_top_bar.svg",
      "source_pages": [2, 3, 4, 5, 6, 7],
      "role": "page_top_accent",
      "parameterized": {
        "position_x": 0, "position_y": 0, "width": 1280, "height": 6,
        "fill": "#CA172A"
      },
      "applies_to": {"page_types": ["all"]},
      "confidence": "high",
      "note": "出现在所有非封面页顶部，源 PPTX 中有 22 个版式中的 6 页使用"
    }
  ]
}
```

### 4.3 SVG Snippet 文件 (`template_snippets/red_block.svg`)

```svg
<!-- red_block.svg — 章节页红色装饰块 -->
<!-- 参数化占位符: {{POSITION_X}}, {{POSITION_Y}}, {{WIDTH}}, {{HEIGHT}}, {{FILL}}, {{RX}} -->
<defs>
  <filter id="block-shadow-snippet">
    <feDropShadow dx="0" dy="4" stdDeviation="3.33" flood-color="#000000" flood-opacity="0.2"/>
  </filter>
</defs>
<rect x="160" y="200" width="960" height="200" fill="#CA172A" rx="8"
      filter="url(#block-shadow-snippet)"/>
<line x1="640" y1="220" x2="640" y2="380" stroke="#4874CB" stroke-width="3"/>
```

### 4.4 `template_profile.json` 扩展字段

在现有 `template_profile_contract.md` 基础上增加：

```json
{
  "reusable_assets": [
    {
      "asset_id": "cover_bg",
      "file": "image1.jpeg",
      "usage_pattern": "full_bleed_background",
      "applies_to": {"page_types": ["cover"]},
      "display_size": {"w": 1280, "h": 720},
      "fit": "cover"
    }
  ],
  "decoration_patterns": [
    {
      "pattern_id": "chapter_red_block",
      "snippet_file": "template_snippets/red_block.svg",
      "parameterized": {"fill": "#CA172A", "rx": 8},
      "applies_to": {"page_types": ["chapter_main"]}
    }
  ]
}
```

这些字段由 `extract_template_assets.py` 和 `extract_decoration_patterns.py` 写入，**不替代**现有的视觉描述字段，而是作为结构化补充。

---

## 5. 执行计划

### Phase 0：备份（15 分钟）

```bash
# 在 backups/ 下创建带时间戳的完整备份
cp -RL planners-ppt-hell backups/planners-ppt-hell-before-asset-extraction-$(date +%F)
```

备份包含：SKILL.md、references/、scripts/、agents/

### Phase 1：新增资产提取脚本（1 天）

**文件**：`scripts/template/extract_template_assets.py`

**职责**：
1. 接收 PPTX 路径 + project 路径
2. 运行 `pptx_template_import.py`（借用 PPT Master 的 `pptx_to_svg/` 和 `template_import/` 模块）
3. 读取 `manifest.json`，遍历 `assets.allAssets`
4. 识别**跨页使用的图片**（在 ≥2 页中出现）→ 标记为 reuse candidate
5. 识别**全画幅使用**（x=0, y=0, width=canvas_w, height=canvas_h）→ 标记为 full_bleed_background
6. 对每个资产：记录使用页码、几何尺寸、fit 方式
7. 将资产文件复制到 `_internal/00_project/template_media/`
8. 写入 `asset_manifest.json`
9. 将摘要写入 `_internal/00_project/extraction_facts.json`

**输出**：
- `_internal/00_project/template_media/asset_manifest.json`
- `_internal/00_project/template_media/image1.jpeg`（等资产文件）

### Phase 2：新增装饰模式提取脚本（1.5 天）

**文件**：`scripts/template/extract_decoration_patterns.py`

**职责**：
1. 接收 `svg-flat/` 目录路径
2. 逐页解析 SVG，提取所有非文本的元素（rect、line、path、circle、ellipse 等）
3. 按**视觉特征聚类**：
   - 相同 fill/stroke 颜色
   - 相同几何类别（水平条、竖线、圆角矩形等）
   - 在画布中相同/相似位置
   - 在跨页中出现 ≥2 次
4. 对每个装饰模式：
   - 提取原始 SVG 元素（保持坐标）
   - 参数化可调整的属性（颜色、尺寸、位置）
   - 输出 `template_snippets/<pattern_id>.svg`
5. 写入 `decoration_patterns.json`

**聚类逻辑**（防误报的关键）：
```
输入：每页 SVG 的元素树
  → 过滤掉 <text>、content-only 元素
  → 按 fill/stroke 颜色分组
  → 在颜色组内按几何形状分组（rect/line/path）
  → 在几何组内按位置和尺寸聚类
  → 出现在 ≥2 页的簇 → 输出为装饰模式

排除规则：
  - 尺寸占画布 >80% 的元素 → 背景，不是装饰
  - fill=white 且占据大部分画布 → 底色，不是装饰
  - 出现在 data-pptx-placeholder 容器内的 → 内容，不是装饰
  - 单页独有的元素 → 不输出
```

**输出**：
- `_internal/00_project/template_media/decoration_patterns.json`
- `_internal/00_project/template_media/template_snippets/*.svg`

### Phase 3：合约文档（0.5 天）

**新增文件**：
- `references/contracts/asset_manifest_contract.md`
- `references/contracts/decoration_patterns_contract.md`

**修改文件**：
- `references/contracts/template_profile_contract.md`: 增加 `reusable_assets` 和 `decoration_patterns` 字段

### Phase 4：工作流文档修改（0.5 天）

**修改 `01_template_intake.md`**：

在现有纯视觉步骤之后新增章节：

```markdown
## 结构提取（仅 PPTX 源）

当源为 PPTX 时，Parent 应额外执行结构提取：

1. 运行 `extract_template_assets.py <source.pptx> --project <project_dir>`
   - 提取位图资产到 `template_media/`
   - 生成 `asset_manifest.json`
2. 运行 `extract_decoration_patterns.py <project_dir>`
   - 分析 SVG 渲染结果
   - 生成 `decoration_patterns.json` + `template_snippets/*.svg`
3. 这些产物作为 Template Worker 的补充上下文

**注意**：结构提取不替代视觉提取。`template_profile.json` 的设计方向描述仍由 Template Worker 看图决定。资产和装饰模式仅提供精确的结构化参考。
```

**修改 `04_svg_worker.md`**：

在"必读上下文"中增加：
```markdown
- `template_profile.json`（存在时）— 设计方向参考
- `template_media/asset_manifest.json`（存在时）— 可复用的位图资产清单
- `template_media/decoration_patterns.json`（存在时）— 可复用的装饰模式清单
```

并新增消费指引章节：

```markdown
## 引用模板资产

当 `template_media/` 存在时：

1. **位图资产**：如需使用模板背景图/Logo，在 SVG 中用 `<image href="../../_internal/00_project/template_media/<file>">` 引用
   - 注意画布尺寸：源为 1280×720，目标为 1920×1080，用 `preserveAspectRatio` 适配
   - `asset_manifest.json` 中有每个资产的 `applies_to.page_types` 标明适用页类型
2. **装饰模式**：`template_snippets/*.svg` 中的片段可直接嵌入 SVG
   - `decoration_patterns.json` 中有参数化属性，可按需调整尺寸/颜色/位置
   - 片段中的 `{{...}}` 占位符是可选替换点，用实际值替换
3. Workers 自主决定是否使用、如何调整。不使用模板资产不违反规范，不触发修复。
```

### Phase 5：集成到 Parent Orchestrator（0.5 天）

**修改 `scripts/orchestrate/ppt_parent.py`**：

在 `TEMPLATE` 状态的 action list 中，在 `prepare_visual_references.py` 之后增加：

```python
# After visual references, attempt structural extraction for PPTX sources
source_files = data.get("template_intake", {}).get("source_files", [])
for src in (source_files or []):
    if src.lower().endswith(".pptx"):
        actions.append({
            "argv": [sys.executable, str(SCRIPTS / "template" / "extract_template_assets.py"),
                     src, "--project", str(root)],
            "description": "Extract bitmap assets and decoration patterns from PPTX",
            "timeout_seconds": 300,
        })
        break
```

### Phase 6：验证方案（1 天）

**6.1 单元测试** — 对每个新脚本用已知 PPTX 运行：

```bash
# 资产提取测试
python3 scripts/template/extract_template_assets.py "Test/劲牌模板.pptx" --project "Test/template-asset-e2e"
# 期望：template_media/ 下有 image1.jpeg、image2.jpeg、asset_manifest.json

# 装饰模式测试  
python3 scripts/template/extract_decoration_patterns.py "Test/template-asset-e2e"
# 期望：decoration_patterns.json 包含 ≥2 个模式，template_snippets/ 有对应的 .svg
```

**6.2 集成测试** — 端到端走完一个含模板引用的项目：

```bash
# 用 Test 目录中的劲牌模板.pptx 跑一次完整流程
# 验证：
#   1. template_media/image1.jpeg 存在
#   2. decoration_patterns.json 中有 red_block、red_top_bar 等模式
#   3. 生成的 PPT 中封面有 image1.jpeg 背景
#   4. 章节页有红色块装饰
```

**6.3 回退测试** — 验证无 PPTX 时流程不变：

```
当 source 为 PDF/图片目录时 → extract_template_assets.py 不应执行
当 source 为 PPTX 但提取失败时 → 不阻塞流程，继续纯视觉路径
```

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `pptx_template_import.py` 的 Python 3.10+ 要求 | 高 | 阻塞资产提取 | PPT Hell 已要求 Python 3.10+（SKILL.md），检查环境 |
| 装饰模式聚类算法误报（把内容当装饰） | 中 | Workers 被误导 | 设计排除规则（>80%画布排除、placeholder内排除、单页排除） |
| 画布尺寸不匹配导致图片变形 | 中 | 最终 PPT 图不对 | 在 snippet 和 asset_manifest 中强制标注 `fit` 模式，Workers 负责正确缩放 |
| 字体缺失（源 PPTX 用罕见字体） | 低 | 文字错位 | 资产提取不涉及字体。Template Worker 看图判断字体倾向，这是现有能力 |
| PPT Master 的 `pptx_to_svg/` 代码过于庞大（200+文件） | 高 | 集成成本高 | 只复制必要的 import 模块，或通过 PYTHONPATH 引用 `ppt-master-skill/scripts/` |

---

## 7. 不在此方案范围内的内容

| 功能 | 原因 |
|---|---|
| 模板 SVG 原型页生成（PPT Master 的 create-template） | 属于方案 C。本方案只提取资产和装饰片段，不生成结构化模板合约 |
| 质检器集成（svg_quality_checker.py） | 装饰片段本身不质检。Workers 生成的完整 SVG 仍然走现有 validate_svg_layout.py |
| 字体嵌入 | PPT Hell 的 native_svg_to_ppt.py 依赖系统字体。字体提取和嵌入不在本方案范围 |
| 模板修改/更新 | 本方案只做提取，不做已有模板的编辑或版本管理 |

---

## 8. 效果验证标准

以下条件全部满足时，本升级方案可视为成功：

| # | 条件 | 验证方式 |
|---|---|---|
| 1 | 对含背景图的 PPTX 运行 extract_template_assets.py，asset_manifest.json 正确识别 full_bleed_background | 查看 JSON 中的 `usage_pattern` 和 `applies_to` |
| 2 | 对含重复装饰的 PPTX 运行 extract_decoration_patterns.py，输出 ≥2 个有效模式 | 查看 decoration_patterns.json 长度和 snippet 文件存在 |
| 3 | 无 PPTX 时（纯 PDF/图片）原有流程不受影响 | `ppt_parent.py next --json` 不触发资产提取动作 |
| 4 | SVG Worker 在 "必读上下文" 中能看到 asset_manifest.json 的指引 | 检查 `04_svg_worker.md` 的内容 |
| 5 | 用劲牌模板生成新 PPT 时，封面包含原始背景图 | 打开最终 PPTX 检查封面 slide 的图片内容 |

---

## 9. 执行时间线

| Phase | 内容 | 预估时间 |
|---|---|---|
| 0 | 备份 | 15 分钟 |
| 1 | 资产提取脚本 | 1 天 |
| 2 | 装饰模式提取脚本 | 1.5 天 |
| 3 | 合约文档 | 0.5 天 |
| 4 | 工作流文档修改 | 0.5 天 |
| 5 | Parent Orchestrator 集成 | 0.5 天 |
| 6 | 验证 | 1 天 |
| **合计** | | **~5 天** |

---

## 10. 文件索引

| 文件 | 动作 | 路径 |
|---|---|---|
| **新增脚本** | | |
| `extract_template_assets.py` | 新增 | `planners-ppt-hell/scripts/template/extract_template_assets.py` |
| `extract_decoration_patterns.py` | 新增 | `planners-ppt-hell/scripts/template/extract_decoration_patterns.py` |
| **新增合约** | | |
| `asset_manifest_contract.md` | 新增 | `planners-ppt-hell/references/contracts/asset_manifest_contract.md` |
| `decoration_patterns_contract.md` | 新增 | `planners-ppt-hell/references/contracts/decoration_patterns_contract.md` |
| **修改工作流** | | |
| `01_template_intake.md` | 修改 | `planners-ppt-hell/references/workflow/01_template_intake.md` |
| `04_svg_worker.md` | 修改 | `planners-ppt-hell/references/workflow/04_svg_worker.md` |
| `template_profile_contract.md` | 修改 | `planners-ppt-hell/references/contracts/template_profile_contract.md` |
| `ppt_parent.py` | 修改 | `planners-ppt-hell/scripts/orchestrate/ppt_parent.py` |
| `SKILL.md` | 修改 | `planners-ppt-hell/SKILL.md` |
| **备份** | | |
| `planners-ppt-hell-before-asset-extraction-YYYY-MM-DD/` | 新增 | `backups/` |

---

## 11. 与 PPT Master 的关系

本方案**不直接依赖** PPT Master 的完整 `ppt-master-skill/` 代码。具体而言：

```
使用的 PPT Master 能力：
  ✅ pptx_template_import.py 的思路（解压 PPTX → 读取 XML → 提取主题/尺寸 → 渲染 SVG）
  ✅ svg-flat/ 双视图渲染 → 提供给 PPT Hell 的装饰模式分析

不使用的 PPT Master 能力：
  ❌ create-template 工作流（7 步流程）
  ❌ Template_Designer 角色（自主写 SVG 模板）
  ❌ 复制模式选择（standard/fidelity/mirror）
  ❌ svg_quality_checker.py --template-mode（模板合约验证）
  ❌ design_spec.md / spec_lock.md 生成
  ❌ 模板索引注册（register_template.py）

实现方式：
  方案不直接调用 ppt-master-skill/ 中的脚本，而是借鉴其思路
  在新脚本中直接使用 python-pptx 操作 PPTX XML，用 lxml 解析 SVG
  这避免了跨项目依赖和 Python 版本兼容问题
```

---

## 12. 备份方案

执行任何改动前，在 `backups/` 下创建完整备份：

```bash
# 从工作区根目录执行
BACKUP_DATE=$(date +%Y-%m-%d)
BACKUP_DIR="backups/planners-ppt-hell-before-asset-extraction-${BACKUP_DATE}"
mkdir -p "$BACKUP_DIR"
cp -RL planners-ppt-hell/SKILL.md "$BACKUP_DIR/"
cp -RL planners-ppt-hell/references "$BACKUP_DIR/"
cp -RL planners-ppt-hell/scripts "$BACKUP_DIR/"
cp -RL planners-ppt-hell/agents "$BACKUP_DIR/"
echo "Backup saved to $BACKUP_DIR"
```
