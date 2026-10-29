# PPT Hell 模板资产提取升级方案 v2

> **核心变化**：从"模板作为方向参考" → "模板作为绑定合约"
> **设计原则**：最小改动、向前兼容、一条合约链、不打补丁

---

## 1. 方案概要

### 1.1 现有关键结论

```
合约链已存在，只是太弱：

template_profile.json（当前是 reference_only）
  → Layout Worker → layout_plan.json（结构，不含视觉令牌）
  → SVG Worker → 读 template_profile.json + svg_rules.md → 生成 SVG
                 ↑
         这里是实际的视觉决策点，也是合规执行点
```

- Layout Worker 不决定颜色/字体/装饰（工作流已写明）
- SVG Worker 是颜色/字体/装饰的实际实现者
- SVG Worker 已经读取 `template_profile.json`
- `style_system.md` 是领域参考，不是逐项目产物

### 1.2 改动思路

不新增合约文件、不新增产物目录、不改变现有流程结构。只做三件事：

```
1. 提取更多事实 → 填入 template_profile.json（现存的同一个文件）
2. 提高置信度  → usage_policy.mode 从 "reference_only" → "binding"
3. 明确合规性  → SVG Worker "MUST" 使用模板中 binding 的字段
```

### 1.3 改动清单（最小集）

| 动作 | 文件 | 说明 |
|---|---|---|
| **新增脚本** | `scripts/template/extract_template_assets.py` | 提取位图资产 + 装饰模式 + 字号，写入 template_profile.json |
| **修改合约** | `references/contracts/template_profile_contract.md` | 扩展 schema：reusable_assets、decoration_patterns、usage_policy |
| **修改工作流** | `references/workflow/01_template_intake.md` | 新增结构提取步骤 |
| **修改工作流** | `references/workflow/04_svg_worker.md` | 明确 binding 字段的 MUST 合规要求 |
| **修改编排** | `scripts/orchestrate/ppt_parent.py` | TEMPLATE 状态末尾调用提取脚本 |
| **修改入口** | `SKILL.md` | 更新工作流描述 |
| **不变** | layout_worker.md、style_system.md、svg_rules.md | 不改 |

对比 v1：**删除了 2 个新合约文件**（asset_manifest_contract.md、decoration_patterns_contract.md）。

---

## 2. 合约设计（核心）

### 2.1 `template_profile.json` 的完整扩展

原文件保持不变，只在现有 schema 内做**字段扩展**：

```json
{
  "source_files": [],
  "method": "visual_only",
  "pages_reviewed": [],

  "design_direction": {
    "overall_character": {"value": "", "evidence_pages": [], "confidence": "high|medium|low"},
    "color_roles": [
      // 扩展：从 manifest.json 主题色精确提取，不再靠看图估计
      {"role": "primary", "hex": "#CA172A", "source": "xml_parsed", "confidence": "high"},
      {"role": "accent", "hex": "#4874CB", "source": "xml_parsed", "confidence": "high"}
    ],
    "type_hierarchy": [
      // 扩展：从 SVG 中提取精确字号
      {"role": "cover_title", "font_family": "Microsoft YaHei", "font_size_px": 72,
       "font_weight": "bold", "source": "svg_measured", "confidence": "high"},
      {"role": "chapter_heading", "font_family": "Microsoft YaHei", "font_size_px": 40,
       "font_weight": "bold", "source": "svg_measured", "confidence": "high"},
      {"role": "chapter_label", "font_family": "Calibri", "font_size_px": 53,
       "font_weight": "bold", "source": "svg_measured", "confidence": "high"},
      {"role": "body", "font_family": "Microsoft YaHei", "font_size_px": 24,
       "source": "svg_measured", "confidence": "medium"}
    ],
    "title_entry": {},
    "grid_and_alignment": {},
    "spacing_and_density": {},
    "image_language": {},
    "chart_language": {},
    "component_language": {},
    "deck_rhythm": {},
    "reusable_motifs": [],
    "page_exceptions": []
  },

  "reusable_assets": [
    // 新增：从 PPTX 提取的可复用位图资产
    {
      "asset_id": "cover_bg",
      "file": "image1.jpeg",
      "usage": "full_bleed_background",
      "applies_to": {"page_types": ["cover"]},
      "source_pages": [1],
      "display_geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
      "fit": "cover",
      "source_canvas": "1280x720",
      "target_canvas": "1920x1080"
    },
    {
      "asset_id": "content_bg",
      "file": "image2.jpeg",
      "usage": "full_bleed_background",
      "applies_to": {"page_types": ["content", "ending"]},
      "source_pages": [3, 5, 7],
      "display_geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
      "fit": "cover",
      "source_canvas": "1280x720",
      "target_canvas": "1920x1080"
    }
  ],

  "decoration_patterns": [
    // 新增：重复装饰形状的 SVG 描述
    {
      "pattern_id": "chapter_red_block",
      "name": "章节红色块",
      "applies_to": {"page_types": ["chapter_main"]},
      "elements": [
        {"type": "rect", "x": 160, "y": 200, "width": 960, "height": 200,
         "rx": 8, "fill": "#CA172A",
         "filter": "drop-shadow(0 4px 3.33px rgba(0,0,0,0.2))"},
        {"type": "line", "x1": 640, "y1": 220, "x2": 640, "y2": 380,
         "stroke": "#4874CB", "stroke-width": 3}
      ],
      "parameters": {
        "suggested_scale": 1.0,
        "canvas_change_strategy": "scale_y"
      }
    },
    {
      "pattern_id": "red_top_bar",
      "name": "顶部红色装饰条",
      "applies_to": {"page_types": ["chapter", "content", "toc", "ending"]},
      "elements": [
        {"type": "rect", "x": 0, "y": 0, "width": 1280, "height": 6,
         "fill": "#CA172A"}
      ],
      "parameters": {
        "suggested_scale": 1.0,
        "canvas_change_strategy": "stretch_width"
      }
    }
  ],

  "usage_policy": {
    // 修改：从 "reference_only" → "binding"（当提取成功时）
    "mode": "binding",
    "binding_fields": [
      "design_direction.color_roles",
      "design_direction.type_hierarchy",
      "reusable_assets",
      "decoration_patterns"
    ],
    "must_not_override": [
      "style_system.md",
      "svg_rules.md"
    ],
    "note": "本模板的色值、字体、资产、装饰模式为 binding。SVG Worker 必须在匹配页类型中使用。"
  },

  "limitations": [],
  "generated_at": ""
}
```

### 2.2 合规规则（关键变化）

```
usage_policy.mode:
  "reference_only"（默认）— Workers 可参考，不强依赖（现有行为）
  "binding"（提取成功时）— Workers 必须遵守 binding_fields 中的值

binding_fields 含义：
  design_direction.color_roles      → SVG Worker 必须使用这些 HEX 值作为主色/强调色
  design_direction.type_hierarchy   → SVG Worker 必须使用这些字体、字号、字重
  reusable_assets[].applies_to      → SVG Worker 必须在对应页类型的 SVG 中引用该图片
  decoration_patterns[].applies_to  → SVG Worker 必须在对应页类型的 SVG 中绘制该装饰

例外：
  用户 brief 明确覆盖 → 覆盖优先
  画布尺寸差异（1280→1920）→ 按 parameters.canvas_change_strategy 缩放
  技术上不可实现（如某字体未安装）→ 回退到相近值并注明
```

### 2.3 资产文件路径

提取的资产文件存在 `_internal/00_project/template_media/`，在 `reusable_assets[].file` 中记录文件名。SVG Worker 在 SVG 中通过以下方式引用：

```svg
<!-- 相对路径从 SVG 输出目录到 template_media -->
<image href="../../_internal/00_project/template_media/cover_bg.jpeg"
       x="0" y="0" width="1920" height="1080"
       preserveAspectRatio="xMidYMid slice"/>
```

---

## 3. 实现细节

### 3.1 `extract_template_assets.py`

**输入**：PPTX 路径 + project 路径
**输出**：更新 `_internal/00_project/template_profile.json`（写入 reusable_assets、扩展 color_roles、扩展 type_hierarchy）
**副作用**：复制资产文件到 `_internal/00_project/template_media/`

**执行步骤**：

```
1. 解压 PPTX，读取 theme XML 和 slide 信息（使用 python-pptx，不依赖 ppt-master-skill）
   ├─ 遍历所有 slide_masters 提取颜色（现有 analyze_pptx_template.py 只读了第一个）
   │    ├─ accent1-accent6 → design_direction.color_roles
   │    └─ dk1/lt1 → text/background
   ├─ 遍历所有 slide_masters 提取字体
   │    ├─ majorFont → type_hierarchy 中的 heading
   │    └─ minorFont → type_hierarchy 中的 body
   └─ 遍历所有 slides 提取图片引用
        ├─ 识别全画幅图片（x≈0, y≈0, w≈canvas_w, h≈canvas_h）→ full_bleed_background
        ├─ 识别跨页重复使用的图片（同一张图出现在 ≥2 页）→ reuse_candidate
        └─ 写入 reusable_assets[]

2. 如果 ppt-master-skill 的 pptx_template_import.py 可用
   ├─ 运行它获得 svg-flat/（更精确的 SVG 渲染）
   └─ 从中提取字体大小、装饰模式（见 3.2）

3. 更新 template_profile.json
   ├─ 合并现有文件（保留 Template Worker 写的视觉描述）
   ├─ 覆盖 design_direction.color_roles（XML 提取，置信度更高）
   ├─ 覆盖 design_direction.type_hierarchy（SVG 测量，精确到 px）
   ├─ 写入 reusable_assets[]
   ├─ 写入 decoration_patterns[]
   └─ 设置 usage_policy.mode = "binding"

4. 复制资产文件
   ├─ ppt/media/ 下的图片 → _internal/00_project/template_media/<file>
   └─ 不改文件名（用 SHA256 校验防重名）
```

**关键——与现有 `analyze_pptx_template.py` 的关系**：

```
不是替代，而是增强。

analyze_pptx_template.py（现有）
  → 读第一个 Master 的颜色字体 → template_profile.json
  
extract_template_assets.py（新增）
  → 读所有 Masters + 所有 Slides
  → 提取更完整的主题色、字体、图片资产
  → 输出到同一个 template_profile.json（覆盖或补充低置信字段）
  → 当可用时，利用 svg-flat/ 做字号测量

两个脚本在 TEMPLATE 阶段先后运行：
  1. prepare_visual_references.py（现有：PPTX→PNG渲染）
  2. analyze_pptx_template.py（现有：XML→基础token）
  3. extract_template_assets.py（新增：扩展token+资产）
  4. Template Worker 看图（现有：写入视觉描述）
  
第 3 步的输出覆盖第 2 步的低置信字段，
第 4 步保留视觉描述，不覆盖第 3 步的结构化字段。
```

### 3.2 装饰模式提取逻辑

装饰模式提取是 `extract_template_assets.py` 的一个子功能，不是独立脚本。

**入口**：当 `svg-flat/` 可用时

```
输入：svg-flat/slide_*.svg（每页的完整渲染）

分析流程：

1. 遍历每页 SVG，提取所有非文本元素
   ├─ <rect>（非白色，非全画布）
   ├─ <line>
   ├─ <path>（仅装饰性的，非文本轮廓）
   └─ <ellipse>/<circle>（非白色）

2. 按 (fill_color, stroke_color, element_type, rough_position) 聚类
   ├─ position 按画布 1/3 分区（上/中/下/左/右/全宽）
   └─ size 按比例分组

3. 跨页匹配
   ├─ 同一颜色 + 同一类型 + 同一位置 → 簇
   ├─ 出现在 ≥2 页 → decoration_patterns 候选
   └─ 出现在所有/大多数同类型页中 → 高置信度

4. 输出
   ├─ pattern_id, elements[]（SVG 元素的 JSON 描述）
   ├─ applies_to.page_types（推断适用页类型）
   └─ parameters.canvas_change_strategy（拉伸/缩放/等）

排除规则：
  占画布 >80% 的元素 → 背景 → 不算装饰
  fill=white 且 >50% → 底色 → 不算装饰
  在 placeholder 容器内 → 内容 → 不算装饰
  单页独有 → 特例 → 不算重复模式
  <g> 内嵌套 >5 个元素 → 可能是插图 → 跳过（太复杂不可靠）
```

### 3.3 字号提取逻辑

从 `svg-flat/slide_*.svg` 的 `<text>` 元素提取：

```
1. 遍历每页的 <text> 元素
2. 记录 (font-size, font-family, font-weight, x, y, width, height)
3. 按页面类型聚类
4. 识别每页的"显著"文字（最大尺寸 = 标题，次大 = 正文）
5. 跨页取众数（消除内容长度导致的变异）
6. 输出 type_hierarchy[].font_size_px

置信度规则：
  跨 ≥3 页一致 → high
  跨 2 页一致 → medium
  每页不一致 → 不输出（保持原有 reference 方式）
```

---

## 4. 改动详解

### 4.1 `references/contracts/template_profile_contract.md`

在现有必填结构之上增加：

```json
{
  "design_direction": {
    "color_roles": [
      {"role": "", "hex": "", "source": "xml_parsed|visual_estimate|manual",
       "confidence": "high|medium|low", "note": ""}
    ],
    "type_hierarchy": [
      {"role": "", "font_family": "", "font_size_px": 0, "font_weight": "",
       "source": "xml_parsed|svg_measured|visual_estimate|manual",
       "confidence": "high|medium|low"}
    ]
  },

  "reusable_assets": [
    {
      "asset_id": "", "file": "", "usage": "full_bleed_background|logo|texture|icon",
      "applies_to": {"page_types": [], "page_indices": []},
      "source_pages": [],
      "display_geometry": {"x": 0, "y": 0, "width": 0, "height": 0},
      "fit": "cover|contain|stretch|none",
      "source_canvas": "",
      "target_canvas": "",
      "confidence": "high|medium|low"
    }
  ],

  "decoration_patterns": [
    {
      "pattern_id": "", "name": "",
      "applies_to": {"page_types": []},
      "elements": [{"type": "", "...": ""}],
      "parameters": {
        "suggested_scale": 1.0,
        "canvas_change_strategy": "scale_y|stretch_width|preserve|recalculate"
      },
      "confidence": "high|medium|low"
    }
  ],

  "usage_policy": {
    "mode": "binding|reference_only",
    "binding_fields": [],
    "must_not_override": []
  }
}
```

### 4.2 `references/workflow/01_template_intake.md`

在现有 Section 末尾新增：

```markdown
## 结构提取（仅 PPTX 源）

当源为 PPTX 文件时，Parent 应在视觉准备完成后执行结构提取：

1. 运行 `extract_template_assets.py <source.pptx> --project <project_dir>`
   - 从 XML 提取精确色值、字体、字号 → 更新 template_profile.json
   - 提取并复制可复用位图资产 → template_media/
   - 当 svg-flat/ 可用时分析装饰模式和字号
   - 设置 `usage_policy.mode = "binding"`
   
2. 结构提取的产物是 template_profile.json 的字段扩展
   - color_roles、type_hierarchy 获得精确值（来源标记为 xml_parsed / svg_measured）
   - reusable_assets 记录每个资产的用法和适用页类型
   - decoration_patterns 记录装饰形状的 SVG 描述
   - usage_policy.mode = "binding" 标明 SVG Worker 必须遵守

3. Template Worker 仍然看图验证方向，但不再需要重新推断色值/字体
   - 如发现提取值与实际视觉严重不符，可在 `limitations` 中注明
   - 不应覆盖已标记为 `xml_parsed` 或 `svg_measured` 且 `confidence: high` 的值
```

### 4.3 `references/workflow/04_svg_worker.md`

两处修改：

**"必读上下文"中**（已有 `template_profile.json`，无需修改列表，但需要明确强度）：

```markdown
- `template_profile.json`（存在时）— 当 `usage_policy.mode = "binding"` 时，
  `binding_fields` 中列出的字段为 MUST 级别约束：
  - color_roles → SVG 必须使用这些 HEX 值
  - type_hierarchy → SVG 必须使用这些字体、字号、字重
  - reusable_assets → 匹配页类型时必须引用对应图片
  - decoration_patterns → 匹配页类型时必须绘制对应装饰
```

**新增"模板合规"小节**：

```markdown
## 模板合规

当 `template_profile.json.usage_policy.mode = "binding"`：

### 1. 色值合规
- 取 `design_direction.color_roles` 中 `confidence: high` 的值
- 主色/背景色/文字色必须使用清单中的 HEX
- 与现有 `style_system.md` 冲突时，template_profile.json 的 binding 值优先

### 2. 字体字号合规
- 取 `design_direction.type_hierarchy` 中 `confidence ≥ medium` 的值
- 对应角色的文字必须使用指定的 font-family、font-size-px、font-weight
- 画布缩放时按比例调整（源 1280×720 → 目标 1920×1080 = 1.5x）

### 3. 位图资产合规
- `reusable_assets` 中 `applies_to.page_types` 匹配当前页类型的条目
- 必须在 SVG 中用 `<image href="...">` 引用该资产文件
- 路径：`../../_internal/00_project/template_media/<file>`
- 适配方式按 `fit` 字段：`cover` → preserveAspectRatio="xMidYMid slice"

### 4. 装饰模式合规
- `decoration_patterns` 中 `applies_to.page_types` 匹配当前页类型的条目
- 必须在 SVG 中绘制对应的元素（rect/line/path 等）
- 画布适配策略按 `parameters.canvas_change_strategy`：
  - `scale_y` → 保持 x、宽度不变，y 和高度按比例缩放
  - `stretch_width` → 宽度拉伸到目标画布宽度，其他按比例
  - `preserve` → 不做画布适配，原样使用
  - `recalculate` → Workers 自行重算坐标

### 5. 例外处理
- 用户 brief 明确覆盖 → brief 优先
- 技术上不可实现 → 使用最接近的替代，在 SVG 注释中标明偏离
- 第三轮修复后仍无法满足 → 在 self-review 中如实记录
```

### 4.4 `scripts/orchestrate/ppt_parent.py`

在 `TEMPLATE` 状态的动作列表末尾增加（`prepare_visual_references.py` 和 `make-task` 之间）：

```python
# After visual references, attempt structural extraction for PPTX sources
source_files = data.get("template_intake", {}).get("source_files", [])
for src in (source_files or []):
    if isinstance(src, str) and src.lower().endswith(".pptx"):
        actions.insert(-1, {  # insert before make-task
            "argv": [sys.executable, str(SCRIPTS / "template" / "extract_template_assets.py"),
                     src, "--project", str(root)],
            "description": "Extract design tokens, bitmap assets, and decoration patterns from PPTX",
            "timeout_seconds": 300,
            "allowed_writers": ["extract_template_assets → template_profile.json (extension)",
                                "extract_template_assets → template_media/"],
        })
        break
```

---

## 5. 验证方案

### 5.1 单元验证

```bash
# 1. 资产提取 — 对劲牌模板测试
python3 scripts/template/extract_template_assets.py \
  "Test/劲牌模板.pptx" --project "Test/template-e2e"

# 验证点：
#   - template_profile.json.reusable_assets 包含 2 个条目
#   - template_profile.json.decoration_patterns 包含 ≥2 个条目
#   - template_profile.json.usage_policy.mode = "binding"
#   - template_media/ 下有 image1.jpeg、image2.jpeg
#   - design_direction.color_roles 中 primary=#CA172A 且 confidence=high

python3 scripts/template/extract_decoration_patterns.py \
  --project "Test/template-e2e"
```

### 5.2 合约验证

```bash
# 验证 template_profile.json 符合扩展后的 schema
python3 scripts/validate_contracts.py template \
  "Test/template-e2e/_internal/00_project/template_profile.json"
```

### 5.3 端到端验证

```
用劲牌模板跑一次完整 PPT Hell 流程：

1. Parent 初始化
2. confirm-template --status provided --source Test/劲牌模板.pptx
3. TEMPLATE 阶段自动运行提取脚本
4. Content Worker 写内容
5. Layout Worker 设计版式
6. SVG Worker 生成 SVG（必须包含 image1.jpeg 引用 + 红色块装饰 + 正确色值）
7. native_svg_to_ppt.py → 最终 PPTX

验证点（打开最终 PPTX）：
  - 封面：image1.jpeg 作为全幅背景 ✅
  - 章节页：红色色块 + 蓝色分割线 + 正确字体字号 ✅
  - 内容页：image2.jpeg 作为全幅背景 ✅
  - 颜色：品牌红 #CA172A ✅
  - 字体：微软雅黑 Microsoft YaHei ✅
```

### 5.4 回退验证

```
当源不是 PPTX 时（PDF/图片目录）：
  - extract_template_assets.py 不应运行
  - template_profile.json 保持 usage_policy.mode = "reference_only"
  - 现有流程不变

当提取脚本失败时（依赖缺失、文件损坏）：
  - 不阻塞 TEMPLATE 阶段
  - ppt_parent.py 忽略错误继续
  - template_profile.json 保持引用模式
```

---

## 6. 向后兼容分析

| 场景 | 现有行为 | 升级后行为 | 兼容？ |
|---|---|---|---|
| PDF 源 | 纯视觉，reference_only | 不变 | ✅ 完全一致 |
| PPTX 源但提取失败 | 纯视觉，reference_only | 不变（错误不阻塞） | ✅ 完全一致 |
| PPTX 源提取成功 | 纯视觉，reference_only | 结构+视觉，binding | ✅ 合约更强但不冲突 |
| 已有项目跑 SVG Worker | 读 template_profile.json | 读到更多字段 | ✅ 只新增不删除 |
| 已有项目跑 Layout Worker | 读 design_direction | 读到更精确的值 | ✅ 更精确不矛盾 |
| 已有项目导出 PPT | 不变 | 不变 | ✅ |

---

## 7. 执行计划

| Phase | 文件 | 工作量 |
|---|---|---|
| 0\. 备份 | `backups/planners-ppt-hell-before-v2-YYYY-MM-DD/` | 15min |
| 1\. 写 `extract_template_assets.py` | `scripts/template/extract_template_assets.py` | 1.5天 |
| 2\. 改 `template_profile_contract.md` | `references/contracts/template_profile_contract.md` | 0.5天 |
| 3\. 改 `01_template_intake.md` | `references/workflow/01_template_intake.md` | 0.5天 |
| 4\. 改 `04_svg_worker.md` | `references/workflow/04_svg_worker.md` | 0.5天 |
| 5\. 改 `ppt_parent.py` | `scripts/orchestrate/ppt_parent.py` | 0.5天 |
| 6\. 验证 | 见 §5 | 1天 |
| **合计** | | **~4.5天** |

v1 的 5 天 → v2 的 4.5 天（减少 2 个合约文件 + 1 个脚本）

---

## 8. 对比 v1 的变化

| 项目 | v1 | v2 | 理由 |
|---|---|---|---|
| 新增合约文件 | 2 个 | 0 个 | 合约全部内嵌到现有 template_profile_contract.md |
| 新增产物目录 | template_media/ | template_media/（不变） | — |
| usage_policy.mode | reference_only 不变 | → binding | 用户要求模板必须被遵守 |
| SVG Worker 义务 | "可引用" | "MUST 遵守" | 用户要求 Workers 必须调用 |
| Layout Worker 改动 | 无 | 无（不变） | Layout 不负责视觉令牌 |
| 字体字号提取 | 无 | 从 SVG text 测量 | 用户要求字号也纳入合约 |
| 脚本数量 | 2 个 | 1 个 | 装饰提取作为子功能合入 asset 提取脚本 |
| 装饰提取方法 | 独立 Python 脚本 | 合入 extract_template_assets.py | 减少文件数 |
| 备份目录 | 建议 | 已有备份结构 | 沿用 |
