# Planner's PPT Hell v2 — 结构分析

> 完整阅读了全部 ~50 个文件，理清每一步骤、每个文件的职责、文件间的连接、冗余和缺口。

---

## 1. 整体架构图

```
┌────────────────────────────────────────────────────────────────────────┐
│                            SKILL.md / README.md                        │
│                       (入口路由 / 权限边界 / 脚本索引)                   │
└────────────────────┬───────────────────────────────────────────┬───────┘
                     │                                           │
                     ▼                                           ▼
    ┌──────────────────────────────┐      ┌──────────────────────────────┐
    │    references/workflow/*.md  │      │   references/contracts/*.md  │
    │   (9 个 step worker 参考)     │←────→│     (13 个输出契约)           │
    └──────────────────────────────┘      └──────────────────────────────┘
                     │                                           │
                     ▼                                           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                        scripts/  (18 个 .py)                       │
    │   ppt_parent.py  ──  status / next / make-task / collect-results  │
    │   pipeline_gate.py ── 7 个 gate 门控                                │
    │   其他 16 个辅助脚本                                                  │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 工作流 10 步骤详图

### 步骤 0: 项目初始化
```
输入：source.md (用户提供)
脚本：init_svg_project.py (120 行)
输出：项目骨架文件夹 _internal/00-07
门控：项目结构存在（隐式）
```

### 步骤 1: 模板分析（可选）
```
输入：template.pptx (用户提供)
脚本：analyze_pptx_template.py (370 行)
契约：template_profile_contract.md (80 行)
参考：01_template_intake.md (188 行)
输出：_internal/00_project/template_profile.json
验证：validate_contracts.py template <path>
```

### 步骤 2: 内容加工
```
输入：source.md
契约：page_content_contract.md (78 行)
参考：02_content_worker.md (144 行)
输出：_internal/01_content/page_content.json
验证：validate_contracts.py project --stage content
```

### 步骤 3: 版式规划
```
输入：page_content.json
领域知识：layout_taxonomy.md (412 行) ← PLAN 阶段的版式判断方法
契约：layout_plan_contract.md (127 行)
参考：03_layout_worker.md (275 行)
输出：
  → _internal/01_layout_plan/layout_plan.json
  → _internal/01_layout_plan/layout_capacity_report.json (estimate_layout_capacity.py)
  → 01_layout_direction.html (generate_layout_html.py)
门控：
  → pipeline_gate.py layout-ready
  → review_server.py（审批页面）
  → pipeline_gate.py layout-approved
```

### 步骤 4: SVG 草稿（并行）
```
输入：
  → page_content.json（当前页裁剪）
  → layout_plan.json（当前页裁剪）
领域知识：style_system.md (360 行), svg_rules.md (350 行)
契约：worker_svg_contract.md (66 行)
参考：04_svg_worker.md (147 行)
脚本：make_agent_task.py --step svg --split-pages
输出：_internal/02_svg_source/page_XX.svg
门控：pipeline_gate.py batch-svg-ready
```

### 步骤 5: 校验 + 集成审阅
```
脚本序列：
  → render_svg_png.py (171 行) → PNG
  → validate_svg_layout.py (1275 行) → validation_summary.json
契约：integrated_review_contract.md (48 行), self_review_contract.md (64 行)
参考：05_integrated_review_worker.md (290 行)
输出：_internal/04_validation/integrated_review.json
      _internal/04_validation/self_review.json
门控：pipeline_gate.py validation-passed
      pipeline_gate.py preview-ready
```

### 步骤 6: 修复循环
```
输入：integrated_review.json, SVG 文件
契约：repair_loop_contract.md (64 行)
参考：06_repair_loop.md (309 行)
脚本：archive_page_version.py (76 行)  ← 修复前备份
输出：更新后 SVG, _internal/05_review/revision_notes.json
限制：最多 2 轮；同一 issue 连续失败 → 升级到 Parent
```

### 步骤 7: 视觉审阅（硬人工 Checkpoint）
```
脚本序列：
  → generate_review_html.py (893 行) → 02_visual_review.html
  → review_server.py (299 行) → 审批页面
参考：07_visual_review.md (362 行)
输出：_internal/05_review/batches/<bid>.json（由 review_server 写入）
门控：pipeline_gate.py visual-approved
注意：Parent 不得代用户审批；provenance 验证必须通过
```

### 步骤 8: 批次经验传递
```
契约：batch_learning_contract.md (60 行)
实现状态：⚠️ 有完整 Schema，但没有脚本实现
  → 没有 gate 检查 batch_learning_notes
  → 没有脚本从上一批 feedback 自动生成 notes
  → 完全依赖 Parent Agent 手动构建
```

### 步骤 9: 导出
```
门控：pipeline_gate.py export-ready
导出命令：pptflow.py export（内部调用 native_svg_to_ppt.py）
    或：ppt_parent.py 指示 pptflow.py export
条件：layout_approved + visual_approved + export_allowed + validation=pass
```

### 步骤 10: 回顾
```
脚本：analyze_run.py (383 行)
契约：retrospective_contract.md (98 行)
参考：08_retrospective.md (29 行)
输出：_internal/07_retrospective/run_summary.json
      _internal/07_retrospective/default_suggestions.md
      _internal/07_retrospective/memory_candidates.json
规则：必须用户确认后才写回配置
```

---

## 3. 全局状态文件

| 文件路径 | 写入者 | 读取者 | 用途 |
|---------|--------|--------|------|
| `flow_state.json` | Parent/脚本 | pipeline_gate, ppt_parent | 流程状态机 |
| `flow_events.jsonl` | Parent/脚本 | analyze_run | 状态转换日志 |
| `page_manifest.json` | Parent/gates | pipeline_gate, ppt_parent | 生产台账（每页状态） |
| `layout_feedback.json` | review_server | pipeline_gate | 版式审批记录 |
| `feedback.json` | review_server | pipeline_gate | 视觉审批记录 |
| `batches/<bid>.json` | review_server | pipeline_gate | 批次级视觉审批记录 |

### 子 Agent 产出

| 文件路径 | 写入步骤 | 用途 |
|---------|---------|------|
| `template_profile.json` | 1-模板 | 模板风格参考 |
| `page_content.json` | 2-内容 | 结构化的全量文案 |
| `layout_plan.json` | 3-版式 | 已审批的版式计划 |
| `page_XX.svg` | 4-SVG | 可编辑的 SVG 幻灯片 |
| `integrated_review.json` | 5-校验 | 机器+视觉综合判断 |
| `self_review.json` | 5-校验 | 面向用户的视觉自检 |
| `revision_notes.json` | 6-修复 | 修复记录 |
| `run_summary.json` | 10-回顾 | 运行统计 |

---

## 4. 每个文件精简程度评估

### ✅ 精简到位的文件

| 文件 | 行数 | 评价 |
|------|------|------|
| `02_content_worker.md` | 144 | 极简。任务→输入→输出→规则→停止条件→完成检查，没有一句废话 |
| `04_svg_worker.md` | 147 | 同上结构，干净利落 |
| `03_layout_worker.md` | 275 | 紧凑。决策顺序→page mode→density→layout→wireframe→copy→asset→capacity→checkpoint→stop |
| `01_template_intake.md` | 188 | 稍微偏长但内容密度合理（confidence 标注规则需要这么详细） |
| `08_retrospective.md` | 29 | 极短，因为逻辑主要由脚本实现 |
| `agent_result_contract.md` 等 13 个合同 | ~999 总 | 平均 77 行/文件，紧凑，只定义 Schema + Hard Rules |
| `style_system.md` | ~360 | 内容全面但合理——它是 SVG 阶段的唯一视觉依据 |
| `layout_taxonomy.md` | ~412 | 内容全面但合理——它是 PLAN 阶段的唯一版式依据 |

### ⚠️ 可以再精简的文件

| 文件 | 行数 | 问题 | 目标 |
|------|------|------|------|
| `00_parent_orchestrator.md` | 656 | 见第 5 节分析 | 200-300 |
| `05_integrated_review_worker.md` | 290 | 见第 6 节分析 | 150-180 |
| `06_repair_loop.md` | 309 | 见第 6 节分析 | 150-180 |
| `07_visual_review.md` | 362 | 见第 6 节分析 | 150-200 |
| `svg_rules.md` | ~350 | 与 worker_svg_contract.md 有重叠（画布/metadata） | 280-300 |
| `quality_checklist.md` | ~100 | 与 validate_svg_layout.py + self_review_contract 三地定义质量标准 | 50 或合并 |

### 🔴 需要关注的文件

| 文件 | 行数 | 问题 |
|------|------|------|
| `native_svg_to_ppt.py` | 1381 | 最大脚本，但承担核心转换职责，可以接受 |
| `validate_svg_layout.py` | 1275 | 第二大脚本，也被称之为 validator |
| `pipeline_gate.py` | 965 | 和 ppt_parent.py 都有状态推导逻辑（`BLOCKING_WARNING_CODES` 在两个文件中重复定义） |
| `pptflow.py` | 455 | 保留兼容。但它的 derive() 逻辑和 `ppt_parent.py` 中的 `MIRRORS` 有重复。核心功能已被 ppt_parent.py 覆盖 |

---

## 5. `00_parent_orchestrator.md` 的膨胀分析

此文件 656 行，是其他 8 个 workflow 文件总和的 ~27%。它实际上是一个**二次 SKILL.md**。

### 它包含的内容与 SKILL.md 的重叠

| 内容块 | SKILL.md (行) | 00_parent_orch (行) | 重叠？ |
|--------|--------------|-------------------|--------|
| 唯一入口命令 | 71-82 | 30-57 | ✅ 重复 |
| 状态总览表（state→含义→下一步） | ❌ 无 | 65-79 | 独有 |
| 每步操作流程（含具体命令） | ❌ 只有路由表 | 82-360 | 独有但过长 |
| Gate 表（gate→何时→检查什么→出口码） | ❌ 只有名称清单 | 500-520 | 独有 |
| 文件权限（谁可写什么） | 43-69 | 459-490 | ✅ 重复 |
| 人工 Checkpoint 规则 | 30-41 | 526-550 | ✅ 重复 |
| 检查清单 | ❌ | 554-578 | 独有 |
| 常见错误处理表 | ❌ | 582-593 | 独有 |
| 脚本路径速查 | 127-155 | 599-640 | ✅ 重复 |

### 精简方法

如果按照 02/03/04 的精简模式重构，00_parent_orchestrator.md 可以变为：

```
## 1. 角色定位  (~10 行)
## 2. 唯一入口  (~10 行)
## 3. 状态总览  (~20 行)   ← 保留但压缩
## 4. Gate 速查 (~15 行)   ← 保留但压缩
## 5. 操作流程  (~100 行)  ← 仅保留关键差异，不重述脚本命令
## 6. 停止条件  (~15 行)
## 7. 完成检查  (~15 行)
```

目标：200-250 行。

---

## 6. 三个未精简文件（05/06/07）的对比

已精简的 02/03/04 和未精简的 05/06/07 差距明显：

| 维度 | 02_content ✅ | 05_integrated_review ⚠️ |
|------|-------------|------------------------|
| 结构 | 任务→输入→输出→规则→停止→检查 | 没有清晰的"停止条件"节 |
| 行数 | 144 | 290 |
| agent_result 字段表 | 一行引用合同 | 仍有独立字段表 |
| 示例 JSON | 无 | 有（integrated_review.json 形状） |
| Common Errors | 已删 | 仍有 |

| 维度 | 03_layout ✅ | 06_repair_loop ⚠️ |
|------|------------|------------------|
| 结构 | 顺序决策流 | 轮次规则→修复内容→顺序→升级→输出→禁止→许可 |
| 行数 | 275 | 309 |
| 内容重复 | 和 layout_taxonomy 已分清 | 和 repair_loop_contract.md 有重叠（同样定义了修复轮次限制） |

| 维度 | 04_svg ✅ | 07_visual_review ⚠️ |
|------|---------|--------------------|
| 结构 | 紧凑 9 节 | 9 节但每节过长 |
| 行数 | 147 | 362 |
| 专有内容 | 溢出处理、停止条件 | 大部分规则已在 SKILL.md 和 00_parent 中出现（"
不得代用户审批"在 SKILL.md 出现，在 00_parent 出现，在 07 又出现） |

---

## 7. 文件间连接可靠性

### ✅ 强连接（有脚本或 gate 强制）

| 连接 | 校验方式 |
|------|---------|
| Content 输出 → Layout 输入 | `validate_contracts.py project --stage layout` 检查 page_key 一致性 |
| Layout plan → SVG 生成 | `04_svg_worker.md` 明确指示必须遵守 `layout_plan` |
| SVG → PNG/Validation | `pipeline_gate.py batch-svg-ready` / `validation-passed` |
| Validation → Integrated Review | 05_worker 读取 validation_summary.json |
| Batch 间 | `pipeline_gate.py visual-approved` 通过后才能开始下一批 |
| 导出 | `pipeline_gate.py export-ready` 检查所有状态标志 |
| agent_task.json → agent_result.json | task_id 必须匹配；input_hashes 和 output_files 有 SHA256 校验 |
| 流程推进 | `ppt_parent.py next --json` 是唯一入口，gate 阻断违规推进 |

### ⚠️ 弱连接（依赖模型自觉，无脚本强校验）

| 连接 | 问题 |
|------|------|
| Layout plan → SVG 的布局真实性 | 04_worker 要求遵守 wireframe，但无脚本验证 SVG 坐标与 layout_plan 的 zone 匹配程度。这是 design intent 层面的事，脚本难验证 |
| Copy handling → SVG 文案准确性 | 04_worker 要求用 `final_on_slide`，但无脚本验证 SVG 中的文字是否与 contract 完全一致 |
| Batch learning → 下一批 task | 没有脚本从上一批 feedback 生成 `batch_learning_notes`。只有 contract 定义了格式 |
| Template profile → Layout/SVG 的影响 | `usage_policy: reference_only` 是文档约束，非脚本强制 |

### 🔴 断裂的连接

| 连接 | 问题 |
|------|------|
| **batch_learning_contract.md → 任何脚本** | 有定义零实现。没有 gate 检查它，没有脚本生成它 |

---

## 8. 可合并的文件对

### 高优先级

| 文件 A | 文件 B | 合并理由 | 合并方式 |
|--------|--------|---------|---------|
| `pptflow.py` (455) | `ppt_parent.py` (552) | ppt_parent.py 的 comment 说"mirrors pptflow.py derive"。两个文件都有 `INTERNAL`、`STATE_PATH`、`BLOCKING_WARNING_CODES` 重复定义 | 将 pptflow.py 的导出功能合并到 ppt_parent.py，删除 pptflow.py |
| `00_parent_orchestrator.md` (656) | SKILL.md (164) | ~200 行内容重叠（状态表、gate 表、权限、脚本路径） | 精简 00_parent，删除 SKILL 中的详细 router 内容（或反过来） |
| `integrated_review_contract.md` (48) | `self_review_contract.md` (64) | 两个文件描述了同一阶段的两个产出。integrated_review 是"我们要修什么"，self_review 是"视觉上好不好"。但边界不清晰 | 合并为一个 `review-contract.md`，两个 JSON Schema 在同一文件中 |

### 中优先级

| 文件 A | 文件 B | 合并理由 |
|--------|--------|---------|
| `validate_svg_layout.py` (1275) | `quality_checklist.md` (~100) | quality_checklist 的 P0-P3 script-checkable 项全都应该在 validate_svg_layout.py 中已实现 | 把 quality_checklist 的 review mode 分类作为 validate_svg_layout.py 的文档字符串 |
| `01_template_intake.md` (188) | `template_profile_contract.md` (80) | Template 步骤简单，两个文件的结构可以合并 | 整合为一个 `template_reference.md` |
| `08_retrospective.md` (29) | `retrospective_contract.md` (98) | 08 极短，contract 较长，可以合并 | 整合为一个 `retrospective_reference.md` |

### 低优先级（不建议合并）

| 文件 | 理由 |
|------|------|
| 13 个 contract 文件保持分离 | 每个约 50-80 行，按 step 独立加载——子 Agent 只读自己的 contract，合并反而强制加载不需要的 Schema |
| 4 个 domain 知识文件保持分离 | 各自服务不同阶段（layout_taxonomy→PLAN, style_system/svg_rules→DRAFT, quality_checklist→Review），合并会造成步骤间耦合 |
| workflow/ 和 contracts/ 保持分离 | 两个维度：workflow 是过程指南，contract 是产出契约。虽然每个 step 各有一对，但职责不同 |

---

## 9. 缺口：缺少或需要关注的文件

### 无脚本实现的合同

| 合同 | 需要什么 |
|------|---------|
| `batch_learning_contract.md` | 至少一个脚本（或 pipeline_gate 的 batch-learn mode）来从上一批 feedback 生成 notes 并注入下一批 task |

### 跨文件重复的定义

| 定义 | 出现位置 |
|------|---------|
| `BLOCKING_WARNING_CODES` = `{"TEXT_OVERFLOW_MAJOR", "FOOTER_ZONE_INVASION"}` | `ppt_parent.py:27` 和 `pptflow.py:15` |
| SVG canvas `1920x1080` / `viewBox` | `svg_rules.md`, `worker_svg_contract.md`, `03_layout_worker.md`（wireframe）, `00_parent_orchestrator.md` |
| 最大修复轮次 = 2 | `repair_loop_contract.md`, `06_repair_loop.md`, `04_svg_worker.md`（含）, `worker_svg_contract.md`（不含——它不定义轮次） |

这些少量重复可以接受——它们是显式常量，分散在相关文件中利于阅读时理解。但如果未来修改轮次，需要在 3 个文件中同步。

---

## 10. 精简潜力总结

### 当前状态

| 类别 | 文件数 | 总行数 |
|------|--------|--------|
| workflow 参考 | 9 | 2,400 |
| 合同 | 13 | 999 |
| domain 知识 | 4 | ~1,222 |
| 脚本 | 18 | ~9,800 |
| 入口（SKILL/README） | 2 | 281 |
| 其他（agent config, requirements, ...） | 3 | ~10 |
| **总计** | **~49** | **~14,712** |

### 精简目标

基于当前已证明可行的 02/03/04 精简模式，对 00/05/06/07 四个文件执行相同改造：

| 文件 | 当前 | 目标 | 节省 |
|------|------|------|------|
| 00_parent_orchestrator.md | 656 | 250 | 406 |
| 05_integrated_review_worker.md | 290 | 160 | 130 |
| 06_repair_loop.md | 309 | 180 | 129 |
| 07_visual_review.md | 362 | 180 | 182 |
| **小计** | **1,617** | **770** | **847** |

其他精简项：
- `pptflow.py` → 合并到 `ppt_parent.py`，删除（455 行）
- `quality_checklist.md` → 作为 validate_svg_layout.py 的文档（~100 行）
- `batch_learning_contract.md` → 实现或删除（60 行）

总计可节约：~1,462 行 / ~14,712 总行 ≈ **10% 进一步精简空间**（前提是已完成的 50-80% 精简已非常成功）。

---

## 11. 总结

### 架构质量

整体流程设计非常扎实。10 个步骤的剧本清晰，contract 驱动的 Agent 通信机制比纯 prompt 控制可靠得多，7 个 gate 覆盖了大部分断点。**文件结构的职责分离是正确的：** workflow/ 是过程指导，contracts/ 是产出契约，domain/ 是参考知识，scripts/ 是执行逻辑。

### 冗余残余

上一轮重构已消除最大量的重复（workflow 文件减少 50-80%），剩余冗余集中在：
1. `00_parent_orchestrator.md` 与 SKILL.md 的重叠 (~200 行)
2. `pptflow.py` 与 `ppt_parent.py` 的功能重叠 (~455 行)
3. 三个未精简的 workflow 文件 (05/06/07) — 它们应该应用和 02/03/04 相同的精简模式 (~440 行)
4. `BLOCKING_WARNING_CODES` 在两个脚本中重复定义 (2 行)

### 唯一的真缺口

**batch_learning** 是整个流程中唯一有定义无实现的部分。其他一切都可运行、可验证、有 gate 保护。

### 最值得做的下一步

如果只做一件事：**对 05/06/07 三个文件执行 02/03/04 的精简模式**（任务→输入/输出→独有规则→停止条件→完成检查）。这能再节约 ~440 行，并且让全部 9 个 workflow 文件风格统一。
