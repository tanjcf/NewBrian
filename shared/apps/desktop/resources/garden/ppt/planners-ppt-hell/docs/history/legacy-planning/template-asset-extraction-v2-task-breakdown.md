# PPT Hell 模板资产提取 — 实施任务书

> 本文件用于指导子 Agent 实施。每个任务包含：目标、输入、输出、验收标准。
> 工作区根目录：`/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/02 - skills-library/03-design-delivery/PlannerPPTSolution`

---

## 任务 0：备份

**目标**：实施前创建完整备份

**命令**：
```bash
cd /Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/02 - skills-library/03-design-delivery/PlannerPPTSolution
BACKUP_DATE=$(date +%Y-%m-%d)
BACKUP_DIR="backups/planners-ppt-hell-before-v2-${BACKUP_DATE}"
mkdir -p "$BACKUP_DIR"
cp -RL planners-ppt-hell/SKILL.md "$BACKUP_DIR/"
cp -RL planners-ppt-hell/references "$BACKUP_DIR/"
cp -RL planners-ppt-hell/scripts "$BACKUP_DIR/"
cp -RL planners-ppt-hell/agents "$BACKUP_DIR/"
echo "Backup: $BACKUP_DIR"
```

**验收标准**：
- [ ] `$BACKUP_DIR/SKILL.md` 存在
- [ ] `$BACKUP_DIR/references/` 包含全部子目录
- [ ] `$BACKUP_DIR/scripts/` 包含全部子目录

---

## 任务 1：编写 `extract_template_assets.py`

**目标**：从 PPTX 提取精确颜色、字体、字号、位图资产、装饰模式，写入 template_profile.json

**输入**：
- `--source <path/to/pptx>`
- `--project <project_dir>`

**输出**：
- 更新 `_internal/00_project/template_profile.json`
- 创建 `_internal/00_project/template_media/` + 资产文件

**文件路径**：`planners-ppt-hell/scripts/template/extract_template_assets.py`

### 1.1 功能模块

```
主入口：main()
  1. parse_args()
  2. 读取现有 template_profile.json（如存在）
  3. extract_theme_colors_all_masters(prs) → color_roles[]
  4. extract_theme_fonts_all_masters(prs) → type_hierarchy 基础
  5. extract_assets_from_slides(prs) → reusable_assets[] + 复制文件
  6. extract_font_sizes_from_svg(project_dir) → type_hierarchy 字号补充
  7. extract_decoration_patterns_from_svg(project_dir) → decoration_patterns[]
  8. 合并到 template_profile.json
  9. 写入
```

### 1.2 各函数详情

#### `extract_theme_colors_all_masters(prs) → list`

```python
def extract_theme_colors_all_masters(prs):
    """
    遍历所有 slide_masters，提取主题色。
    返回 [{"role": "primary", "hex": "#CA172A", "source": "xml_parsed", "confidence": "high", "note": ""}]
    
    映射规则：
      accent1 → primary
      accent2 → accent
      dk1 → text-primary
      lt1 → background
      accent3-6 → accent-tertiary 等
      hlink → link
    
    如果有多个 Master，取第一个 Master 的值（通常主母版最完整）。
    记录每个颜色的 source="xml_parsed"，confidence="high"。
    """
```

**验收标准**：
- [ ] 正确提取 accent1=primary
- [ ] 正确提取 dk1=text-primary
- [ ] 正确提取 lt1=background
- [ ] 每个条目 source="xml_parsed", confidence="high"

#### `extract_theme_fonts_all_masters(prs) → list`

```python
def extract_theme_fonts_all_masters(prs):
    """
    从 fontScheme 提取字体。
    返回 [{"role": "heading", "font_family": "Microsoft YaHei", "source": "xml_parsed", "confidence": "high"},
           {"role": "body", "font_family": "Microsoft YaHei", ...}]
    
    majorFont → heading
    minorFont → body
    EA (East Asian) 优先于 Latin（在中文内容下）
    """
```

**验收标准**：
- [ ] 正确提取 majorFont 作为 heading
- [ ] 正确提取 minorFont 作为 body
- [ ] CJK 环境优先取 EA 字体

#### `extract_assets_from_slides(prs, project_dir) → list`

```python
def extract_assets_from_slides(prs, project_dir):
    """
    遍历所有 slides，提取图片信息。
    返回 reusable_assets[]，其中每个条目：
    {
      "asset_id": str,          # 自动生成：bg_01, logo_01, img_01...
      "file": str,              # 复制后的文件名
      "usage": str,             # "full_bleed_background" | "logo" | "decorative" | "content"
      "applies_to": {"page_types": [...], "page_indices": [...]},
      "source_pages": [int],    # 在源PPTX中出现的页码
      "display_geometry": {"x": float, "y": float, "width": float, "height": float},
      "fit": str,               # "cover" | "contain" | "stretch" | "tile" | "none"
      "source_canvas": str,     # e.g. "1280x720"
      "target_canvas": str,     # e.g. "1920x1080"
      "confidence": "high" | "medium" | "low"
    }
    
    识别逻辑：
    1. 遍历 slides 中的所有 shape
    2. shape_type == 13 (Picture) → 找到图片
    3. 通过 blipFill 获取图片 rId → 解析出原文件路径
    4. 记录该图片在 slide 中的几何 (x, y, w, h)
    5. 判断是否为 full_bleed_background:
       - x ≈ 0, y ≈ 0, w ≈ canvas_w, h ≈ canvas_h
    6. 判断是否为 logo:
       - 尺寸较小 (< 15% canvas area)
       - 出现在每页相同位置
    7. 跨页匹配：相同图片出现在 ≥2 页 → 标记为可复用
    8. 将图片文件复制到 template_media/<asset_id>.<ext>
    
    canvas_w = prs.slide_width / 914400 * 96 (convert to px at 96dpi)
    canvas_h = prs.slide_height / 914400 * 96
    """
```

**验收标准**：
- [ ] 正确识别全画幅背景图片（usage="full_bleed_background"）
- [ ] 正确识别跨页重复图片（出现在 ≥2 页）
- [ ] 图片文件复制到 template_media/
- [ ] display_geometry 中的坐标单位与 ppt_px 一致

#### `extract_font_sizes_from_svg(project_dir) → list`

```python
def extract_font_sizes_from_svg(project_dir):
    """
    从 svg-flat/ 中提取字体大小（如果存在）。
    返回 type_hierarchy 中 font_size_px 的补充信息。
    
    依赖：svg-flat/ 目录存在（由 pptx_template_import.py 生成）
    如果目录不存在 → 返回空列表
    
    逻辑：
    1. 查找 _internal/00_project/template_visuals/svg-flat/ 或类似路径
    2. 逐页解析 SVG，提取所有 <text> 元素的 font-size
    3. 按角色聚类（最大的 → 标题, 次大 → 正文, 最小 → 辅助）
    4. 跨页取众数
    
    返回 [{"role": "cover_title", "font_family": "...", "font_size_px": 72,
            "font_weight": "bold", "source": "svg_measured", "confidence": "high"}]
    """
```

**验收标准**：
- [ ] SVG 可用时正确测量字号
- [ ] SVG 不可用时优雅降级（返回空列表，不崩溃）

#### `extract_decoration_patterns_from_svg(project_dir) → list`

```python
def extract_decoration_patterns_from_svg(project_dir):
    """
    从 svg-flat/ 中识别重复装饰形状。
    返回 decoration_patterns[]。
    
    依赖：svg-flat/ 目录存在
    如果目录不存在 → 返回空列表
    
    逻辑见 v2 方案 §3.2
    
    返回示例：
    [{
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
      },
      "confidence": "high"
    }]
    
    注意：svg-flat/ 需要先运行 pptx_template_import.py 生成。
    extract_template_assets.py 应尝试调用它，如果失败则降级。
    """
```

**验收标准**：
- [ ] 正确识别跨页重复的 rect/line 元素
- [ ] 正确过滤掉白色底色和全画布元素
- [ ] 正确过滤掉内容区元素
- [ ] 装饰元素坐标保留 SVG 原始值
- [ ] canvas_change_strategy 合理推断

#### 主流程 `main()`

```python
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="PPTX file path")
    parser.add_argument("--project", required=True, help="Project root directory")
    args = parser.parse_args()
    
    project_dir = Path(args.project).resolve()
    internal_dir = project_dir / "_internal" / "00_project"
    media_dir = internal_dir / "template_media"
    media_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. 读取现有 template_profile.json
    profile_path = internal_dir / "template_profile.json"
    existing = {}
    if profile_path.exists():
        existing = json.loads(profile_path.read_text(encoding="utf-8"))
    
    # 2. 提取
    prs = Presentation(str(source))
    colors = extract_theme_colors_all_masters(prs)
    fonts = extract_theme_fonts_all_masters(prs)
    assets = extract_assets_from_slides(prs, project_dir)
    
    # 3. 尝试调用 pptx_template_import.py 获取 svg-flat/
    svg_dir = internal_dir / "svg-flat"
    if not svg_dir.exists():
        try:
            _run_pptx_import(source, project_dir)
        except Exception as e:
            print(f"Warning: SVG import failed ({e}), skipping font size and pattern extraction")
    
    # 4. 从 SVG 提取额外信息
    font_sizes = extract_font_sizes_from_svg(project_dir)
    patterns = extract_decoration_patterns_from_svg(project_dir)
    
    # 5. 更新 template_profile.json
    # 保留现有字段，增强新字段
    enhanced = merge_into_profile(existing, colors, fonts, assets, font_sizes, patterns)
    
    # 6. 写入
    profile_path.write_text(json.dumps(enhanced, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Template profile enhanced: {profile_path}")
```

### 1.3 完整验收标准

- [ ] 脚本接受 `--source` 和 `--project` 参数
- [ ] PPTX 存在时提取颜色（≥8 个）
- [ ] PPTX 存在时提取字体（≥2 个）
- [ ] PPTX 有图片时提取 reusable_assets（≥1 个）
- [ ] SVG 可用时提取 decoration_patterns（≥1 个）
- [ ] SVG 可用时提取 font_size_px
- [ ] 输出写入 `_internal/00_project/template_profile.json`
- [ ] 资产文件复制到 `_internal/00_project/template_media/`
- [ ] `usage_policy.mode` 设为 `"binding"`
- [ ] `usage_policy.binding_fields` 列出所有 binding 字段
- [ ] 与现有 `template_profile.json` 合并，不丢失已有字段

---

## 任务 2：更新 `template_profile_contract.md`

**文件**：`planners-ppt-hell/references/contracts/template_profile_contract.md`

**改动**：在现有必填结构中新增以下字段

### 2.1 `design_direction.color_roles` 增强

```json
// 每个条目新增 source 和 confidence 字段
{"role": "primary", "hex": "#CA172A", "source": "xml_parsed|visual_estimate|manual",
 "confidence": "high|medium|low", "note": ""}
```

### 2.2 `design_direction.type_hierarchy` 增强

```json
// 每个条目新增 font_size_px、font_weight、source、confidence
{"role": "heading", "font_family": "Microsoft YaHei", "font_size_px": 36,
 "font_weight": "bold", "source": "xml_parsed|svg_measured|visual_estimate|manual",
 "confidence": "high|medium|low"}
```

### 2.3 新增 `reusable_assets`

```json
{
  "asset_id": "str",
  "file": "str",
  "usage": "full_bleed_background|logo|decorative|content",
  "applies_to": {"page_types": ["str"], "page_indices": [int]},
  "source_pages": [int],
  "display_geometry": {"x": float, "y": float, "width": float, "height": float},
  "fit": "cover|contain|stretch|tile|none",
  "source_canvas": "str",
  "target_canvas": "str",
  "confidence": "high|medium|low"
}
```

### 2.4 新增 `decoration_patterns`

```json
{
  "pattern_id": "str",
  "name": "str",
  "applies_to": {"page_types": ["str"]},
  "elements": [{"type": "rect|line|circle|ellipse|path", "...": ""}],
  "parameters": {
    "suggested_scale": float,
    "canvas_change_strategy": "scale_y|stretch_width|preserve|recalculate"
  },
  "confidence": "high|medium|low"
}
```

### 2.5 新增 `usage_policy` 字段

```json
// 现有 usage_policy 扩展：
{
  "mode": "binding|reference_only",
  "binding_fields": ["design_direction.color_roles", ...],
  "must_not_override": ["style_system.md", "svg_rules.md"],
  "note": "str"
}
```

**验收标准**：
- [ ] 新增字段的 schema 定义完整
- [ ] source/confidence 枚举值明确
- [ ] usage_policy.mode 的两种模式说明清晰
- [ ] 不删除现有字段

---

## 任务 3：更新 `01_template_intake.md`

**文件**：`planners-ppt-hell/references/workflow/01_template_intake.md`

**改动位置**：文件末尾新增 "结构提取" 章节

**新增内容**：
```markdown
## 结构提取（仅 PPTX 源）

当源为 PPTX 文件时，Parent 应在视觉准备完成后执行结构提取：

1. 运行 `extract_template_assets.py <source.pptx> --project <project_dir>`
   - 从 XML 提取精确色值、字体 → 更新 template_profile.json
   - 提取可复用位图资产 → template_media/
   - 当 svg-flat/ 可用时提取字号和装饰模式
   - 设置 usage_policy.mode = "binding"
   
2. 结构提取产物：
   - design_direction.color_roles：从主题色 XML 提取，confidence=high
   - design_direction.type_hierarchy：字体从 XML 提取，字号从 SVG 提取
   - reusable_assets[]：可复用图片资产及适用页类型
   - decoration_patterns[]：跨页重复装饰形状的 SVG 描述

3. Template Worker 仍然看图验证视觉方向
   - 不覆盖标记为 xml_parsed/svg_measured 且 confidence=high 的值
   - 如发现值与视觉严重不符，在 limitations 中注明
```

**验收标准**：
- [ ] 新增章节位置合理（末尾）
- [ ] 步骤描述清晰可执行
- [ ] 明确 Template Worker 与结构提取的分工

---

## 任务 4：更新 `04_svg_worker.md`

**文件**：`planners-ppt-hell/references/workflow/04_svg_worker.md`

**改动位置**：
1. "必读上下文"小节（增强 `template_profile.json` 读取说明）
2. 文件末尾新增 "模板合规" 小节

### 4.1 必读上下文修改

```markdown
- `template_profile.json`（存在时）— 设计令牌与资产清单。
  当 usage_policy.mode = "binding" 时，binding_fields 中的字段为 MUST 级别约束，
  SVG Worker 必须在匹配页类型中使用这些值（详见「模板合规」章节）。
```

### 4.2 新增 "模板合规" 小节

```markdown
## 模板合规

当 `template_profile.json.usage_policy.mode = "binding"` 时，以下规则适用：

### 色值合规
- 取 `design_direction.color_roles` 中 `confidence ≥ medium` 的值
- 主色、背景色、文字色必须使用清单中的 HEX 值
- 与 style_system.md 冲突时，template_profile.json 的 binding 值优先

### 字体字号合规
- 取 `design_direction.type_hierarchy` 中 `confidence ≥ medium` 的值
- 对应角色的文字必须使用指定的 font-family、font_size_px、font_weight
- 画布缩放时按比例调整（源→目标）。

### 位图资产合规
- `reusable_assets` 中 `applies_to.page_types` 匹配当前页类型的条目
- 必须在 SVG 中用 `<image>` 引用该资产文件
- 路径：`../../_internal/00_project/template_media/<file>`
- 适配方式按 `fit` 字段：`cover` → preserveAspectRatio="xMidYMid slice"
- 画布适配：源画布 → 目标画布的缩放因子自行计算

### 装饰模式合规
- `decoration_patterns` 中 `applies_to.page_types` 匹配当前页类型的条目
- 必须在 SVG 中绘制对应的 elements
- 画布适配策略按 `parameters.canvas_change_strategy`：
  - `scale_y`：保持 x、宽度，y 和高度按比例缩放
  - `stretch_width`：宽度拉伸到目标画布宽
  - `preserve`：原样使用
  - `recalculate`：自行重算坐标

### 例外处理
- 用户 brief 明确覆盖 → brief 优先
- 技术上不可实现（如字体未安装）→ 使用最接近的值，在 SVG 注释中标明
- 第三轮修复后仍无法满足 → 在 self-review 中如实记录
```

**验收标准**：
- [ ] 必读上下文中 template_profile.json 的说明更新
- [ ] 模板合规章节完整覆盖色值/字体/资产/装饰
- [ ] 例外处理路径明确
- [ ] 不删除或修改现有内容

---

## 任务 5：更新 `ppt_parent.py`

**文件**：`planners-ppt-hell/scripts/orchestrate/ppt_parent.py`

**改动位置**：TEMPLATE 状态的 action list

**改动内容**：
```python
# 在 TEMPLATE 状态的 actions 列表中，在 prepare_visual_references 之后、
# make-task 之前，插入：

source_files = data.get("template_intake", {}).get("source_files", [])
for src in (source_files or []):
    if isinstance(src, str) and src.lower().endswith(".pptx"):
        actions.insert(-1, {
            "argv": [sys.executable, str(SCRIPTS / "template" / "extract_template_assets.py"),
                     src, "--project", str(root)],
            "description": "Extract design tokens, assets, and decoration patterns from PPTX",
            "timeout_seconds": 300,
            "allowed_writers": [
                "extract_template_assets → _internal/00_project/template_profile.json",
                "extract_template_assets → _internal/00_project/template_media/"
            ],
        })
        break
```

**验收标准**：
- [ ] PPTX 源时 script 被正确插入到 action list
- [ ] 非 PPTX 源时（PDF/图片）不插入
- [ ] timeout_seconds 合理
- [ ] allowed_writers 路径正确
- [ ] 不破坏现有 flow

---

## 任务 6：测试与验证

### 6.1 测试准备

```bash
cd /Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/02 - skills-library/03-design-delivery/PlannerPPTSolution

# 创建测试项目目录
TEST1="Test/template-e2e-jindun"
TEST2="Test/template-e2e-boliya"
rm -rf "$TEST1" "$TEST2"
```

### 6.2 测试用例

#### TC-01：资产提取 — 金敦奖（多图 PPTX）

```bash
python3 planners-ppt-hell/scripts/template/extract_template_assets.py \
  "Test/金敦奖-决赛PPT-3C数码-小红书-学而思学习机 - 副本.pptx" \
  --project "$TEST1"
```

**预期输出**：
- [ ] 脚本正常退出（exit 0）
- [ ] `$TEST1/_internal/00_project/template_media/` 下有图片文件
- [ ] `$TEST1/_internal/00_project/template_profile.json` 新增了 reusable_assets
- [ ] reusable_assets 中至少有一个 full_bleed_background（如适用）
- [ ] color_roles 有 8 个以上条目，confidence=high
- [ ] type_hierarchy 有 2 个以上条目
- [ ] usage_policy.mode = "binding"

#### TC-02：资产提取 — 铂丽雅（干净 PPTX）

```bash
python3 planners-ppt-hell/scripts/template/extract_template_assets.py \
  "Test/铂丽雅.pptx" \
  --project "$TEST2"
```

**预期输出**：
- [ ] 脚本正常退出（exit 0）
- [ ] template_media/ 下有图片文件（8 slides 中可能有多张图片）
- [ ] reusable_assets 存在
- [ ] usage_policy.mode = "binding"

#### TC-03：无 template_profile.json 初始化

测试脚本在无现成 profile 时是否正常工作（从空白开始构建）：

```bash
rm -rf "$TEST1"
python3 planners-ppt-hell/scripts/template/extract_template_assets.py \
  "Test/金敦奖-决赛PPT-3C数码-小红书-学而思学习机 - 副本.pptx" \
  --project "$TEST1"
```

**预期**：创建新的 template_profile.json，包含所有提取字段。

#### TC-04：合约验证

```bash
python3 planners-ppt-hell/scripts/validate_contracts.py template \
  "$TEST1/_internal/00_project/template_profile.json"
```

**预期**：合约验证通过。

#### TC-05：非 PPTX 不触发

验证 `ppt_parent.py` 在 PDF/图片源时不会插入提取动作：

- 检查代码逻辑：只有 `source.endswith(".pptx")` 时插入

#### TC-06：提取失败不阻塞

验证脚本在出错时优雅降级：

- 给一个损坏的 PPTX → 脚本返回非 0 但不崩溃
- 给一个没有图片的 PPTX → reusable_assets 为空数组

### 6.3 端到端测试

安装完成后，用劲牌模板跑一次完整流程（可选，如时间允许）：

```bash
# 1. 初始化项目
python3 planners-ppt-hell/scripts/orchestrate/ppt_parent.py "$TEST3" init

# 2. 确认模板
python3 planners-ppt-hell/scripts/orchestrate/ppt_parent.py "$TEST3" confirm-template \
  --status provided --source "Test/劲牌模板.pptx"

# 3. 检查 TEMPLATE 状态的 actions 是否包含 extract_template_assets
python3 planners-ppt-hell/scripts/orchestrate/ppt_parent.py "$TEST3" next --json
```

---

## 任务 7：验收报告

子 Agent 完成所有任务后，输出验收报告包含：

```markdown
# 验收报告

## 任务完成情况
- [ ] 任务 0：备份
- [ ] 任务 1：extract_template_assets.py
- [ ] 任务 2：template_profile_contract.md
- [ ] 任务 3：01_template_intake.md
- [ ] 任务 4：04_svg_worker.md
- [ ] 任务 5：ppt_parent.py

## 测试结果
- TC-01 金敦奖：通过/失败
- TC-02 铂丽雅：通过/失败
- TC-03 无 profile 初始化：通过/失败
- TC-04 合约验证：通过/失败
- TC-05 非PPTX不触发：通过/失败
- TC-06 降级处理：通过/失败

## 关键文件变更
- planners-ppt-hell/scripts/template/extract_template_assets.py（新增）
- planners-ppt-hell/references/contracts/template_profile_contract.md（修改）
- planners-ppt-hell/references/workflow/01_template_intake.md（修改）
- planners-ppt-hell/references/workflow/04_svg_worker.md（修改）
- planners-ppt-hell/scripts/orchestrate/ppt_parent.py（修改）

## 已知问题
- （如无则写"无"）
```
