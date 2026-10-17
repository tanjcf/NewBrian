# Redundancy Critique — Planner's PPT Hell

> 以第一性原理审视全部 55 个文件、~94,000 行内容。目标不是"改代码"，而是忠实记录每一处重复、膨胀、多余、可合并的结构。
>
> 批评原则：不删除任何文件，但指出每一个"可以不存在"的冗余。

---

## 1. SKILL.md 与 README.md：80%+ 内容的孪生文件

**症状**：两个文件同时存在于根目录，共享以下完全相同的结构块：

| 区块 | SKILL.md | README.md |
|------|----------|-----------|
| 来源归属（阿祖不看 TVC） | ✅ 第 8 行 | ✅ 第 2 行 |
| 架构总述 (v2 Parent Orchestrator) | ✅ 6-7 行 | ✅ 7-11 行 |
| 完整 workflow 表 (10 steps) | ✅ 86-99 行 | ✅ 22-34 行 |
| 六条核心规则 | ✅ 101-107 行 | ✅ 86-91 行 |
| 脚本列表（几乎相同） | ✅ 127-156 行 | ✅ 65-77 行 |
| 目录结构树 | ❌ | ✅ 38-81 行 |

**判断**：两个文件中至少有一个是多余的。SKILL.md 作为 Skill 加载入口应极致精简（仅 frontmatter + router + 权限边界）。README.md 作为快速入门应只保留最小启动指南。当前状态是同一个内容在两个文件中各写了一遍。

**建议**：SKILL.md 保留 30-50 行（frontmatter + 架构原则 + 入口命令 + 权限边界）。README.md 缩减到 30 行（结构 + 快速开始）。其余内容全部下沉到 references/ 或直接删除。

**浪费量**：~150 行 / ~5% 总文件数（但冗余度按内容面积算约 40%）

---

## 2. references/domain/ 下的四个文件与其消费方之间的重复

### 2.1 `svg_rules.md`（11,782 字）↔ `worker_svg_contract.md`

两者都完整指定了：
- SVG 画布尺寸 `1920x1080`、`viewBox="0 0 1920 1080"`
- `<foreignObject>` 禁止
- 外部资源引用禁止
- `fill` 和 `font-family` 必须显式声明
- Metadata 注释格式

`svg_rules.md` 第 1 节 "硬性契约" 和 `worker_svg_contract.md` 第 3 节 "SVG 技术约束" 是同一件事的两种表述。

**判断**：这两个文件应合并。`svg_rules.md` 应成为唯一的技术规范源，`worker_svg_contract.md` 应只保留 JSON Schema 定义，删除所有的规范性约束文本。

### 2.2 `style_system.md` 中的 "禁止" 与 `svg_rules.md` 重复

`style_system.md` 说"SVG/PPT 兼容、禁用元素、metadata、文本属性和 validator 工程红线看 `04_svg_rules.md`"——但自身第 1 节再次描述了"已批准的信息锚点"等约束。职责边界模糊。

### 2.3 `layout_taxonomy.md` ↔ `03_layout_worker.md` 的 6 问框架

`layout_taxonomy.md` 的 6 个必答问题和 `03_layout_worker.md` 第 6.1 节的 6 个问题完全一致——但表述了两遍。事实上 `layout_taxonomy.md` 的存在意义就是被 `03_layout_worker.md` 引用，而 `03_layout_worker.md` 把引用内容又内联了一遍。

**浪费量**：~300 行技术规范在三处（svg_rules.md / worker_svg_contract.md / 04_svg_worker.md）重复陈述。

---

## 3. agent_result.json 的 8 次独立重复

以下 8 个文件各自包含了一个完整的 `agent_result.json` 字段定义表：

| 文件 | 字段表位置 |
|------|-----------|
| `01_template_intake.md` | 第 7 节 |
| `02_content_worker.md` | 第 7 节 |
| `03_layout_worker.md` | （隐含在工作流描述中） |
| `04_svg_worker.md` | 第 9 节 |
| `05_integrated_review_worker.md` | 第 8 节 |
| `06_repair_loop.md` | 第 9 节 |
| `07_visual_review.md` | （不包括子 agent result，例外） |
| `08_retrospective.md` | （例外） |

每个副本都包含：
- `task_id`（必须与 agent_task.json 一致）
- `step`（必须为 X）
- `status`（completed / partial / failed）
- `completed_at`（ISO 8601）
- `output_files`（路径 + SHA256）
- `input_hashes`（必填，不能为空！）
- `summary`（必填，不能为空！）
- `issues`（可选）
- `decisions`（可选）
- `warnings_accepted`（可选）
- 以及各自 step 的示例 JSON

**判断**：`agent_result.json` 的通用字段应由 `references/contracts/agent_result_contract.md` 统一定义。每个 workflow 文件只应说明该 step 特有的字段差异。当前每个文件都完整重写了一遍通用字段表。

**浪费量**：每个文件约 30-40 行样板，7 个文件 = ~250 行纯重复。

---

## 4. SHA256 计算方式到处内联

以下文件各自包含了一段几乎相同的 SHA256 Python 代码：

- `02_content_worker.md` 第 7.4 节
- `agent_result_contract.md`（`input_hashes` 描述中）
- `template_profile_contract.md`（引用）
- 各 validation 脚本（不同语言的等价实现）

8 个不同的地方在教模型"如何计算 SHA256"。这在任何其他工程场景中都会是一个 shared utility function。

**判断**：写一次在 `references/contracts/agent_result_contract.md` 中，其他地方只引用。

---

## 5. "禁止子 Agent 写入控制文件" 清单的无止境重复

以下文件各自包含了一个几乎一致的文件权限清单：

| 文件 | 位置 |
|------|------|
| `SKILL.md` | "不可由子 Agent 写入的文件" / "子 Agent 可写入范围" |
| `00_parent_orchestrator.md` | 第 6 节 "文件权限" |
| `agent_task_contract.md` | 第 1 节 "禁止行为" |
| `01_template_intake.md` | 第 1 节工作流描述中的隐含约束 |
| `02_content_worker.md` | 第 9 节 "错误 9" |
| `03_layout_worker.md` | 第 10 节 "你的受限视野" |
| `04_svg_worker.md` | 第 6 节 "禁止行为" |
| each workflow file end | "没有写入 forbidden_writes" 自检项 |

**判断**：所有子 Agent 的写入权限应只在 `agent_task_contract.md` 统一定义，并在 `agent_task.json` 中通过 `forbidden_writes` 字段动态下发。workflow 文件中的权限罗列是静态拷贝。

**浪费量**：~150 行纯拷贝。

---

## 6. "Common Errors" 模板的跨文件克隆

7 个 workflow 文件都包含一个 "常见错误与避免方法" 节，格式完全一致：

```markdown
### 错误 N：[标题]

```
错误：...
正确：...
```

**避免方法**：...
```

多个错误出现在多个文件中：

| 错误主题 | 出现的文件数 |
|---------|------------|
| "遗漏 input_hashes" | 6 |
| "写入禁止文件（forbidden_writes）" | 5 |
| "内容溢出不自知" | 4 |
| "使用 style_system 外的颜色" | 2（但应该在更多文件中出现） |
| "action_title 写成标签" | 2 |

**判断**：Common Errors 应该按主题组织成一个共享 reference（如 `references/common-errors.md`），每个 workflow 文件通过链接引用。当前是 N 副本 N 维护，必然出现不一致（某些文件有某个错误而另一个没有）。

**浪费量**：每个文件 8-12 个错误 × 7 文件 ≈ 350-400 行，其中约 40% 跨文件重复。

---

## 7. 语言混用：双语契约的认知成本

契约文件的语言分布（12 个文件）：

| 语言 | 文件 |
|------|------|
| 中文 | agent_task_contract, agent_result_contract, repair_loop_contract, batch_learning_contract, retrospective_contract, template_profile_contract |
| 英文 | layout_plan_contract, worker_svg_contract, integrated_review_contract, self_review_contract, revision_notes_contract, page_manifest_contract |
| 双语 | page_content_contract（Purpose 英文 + Copy Policy 中文） |

**判断**：同一个 Skill、同一级目录、同一套契约，一半英文一半中文。用户的界面语言是中文（从 SKILL.md、README.md 和工作流文件可看出）。英文的一半不是用户的选择，是工程习惯或历史残留。

**浪费量**：双语切换没有增加信息量，但增加了阅读和审查的上下文切换成本。6 个不必要的英文文件 × 可维护性成本。

---

## 8. 被遗忘的批量学习（Batch Learning）

`batch_learning_contract.md` 定义了一个完整的 JSON Schema（80 行）。但：
- 没有任何脚本实现该机制
- `00_parent_orchestrator.md` 第 4.10 节描述了一个模糊的 "Parent 可以保存" 流程，但没有规定操作
- 没有任何 gate 检查 batch_learning_notes 是否存在
- SVG Worker 文件中没有一处提到会读取 batch_learning_notes

**判断**：`batch_learning_contract.md` 是一个未实现的协议。它描述了一个不存在的东西。要么实现它，要么删除文件。

---

## 9. 两条质量检查清单

`references/domain/quality_checklist.md`（7,124 字）和 `06_quality_checklist.md`（如果存在，或 symlink 目标）是同一主题的两份独立文档。

当前 `references/domain/quality_checklist.md` 定义了 P0-P3 严重性分级和 3 种 review mode（script-checkable / model-visual / human-review）。但这个清单的内容应该 `validate_svg_layout.py` 已经实现了大部分——脚本已经有了规范，文档再做一份分级就是双重维护。

**判断**：质量检查清单应作为 `validate_svg_layout.py` 的文档化输出，而不是一个独立的 .md 文件。当脚本规则更新时，文档必然落后。

---

## 10. 脚本层的冗余

| 冗余对 | 说明 |
|--------|------|
| `ppt_parent.py` ↔ `pptflow.py` | 两者都提供 status / next / export。`pptflow.py` 标记为 "保留兼容" 但 README 又说它是唯一导出路径，矛盾 |
| `template_analyzer.py` ↔ `template/analyze_pptx_template.py` | 两个模板分析器，一个根目录一个在子目录。README 说后者是 "v2 升级版" 但旧版未删除 |
| `mece_scan.py` ↔ `mece_scan_v2.py` | 同上，v1 和 v2 并存 |
| `validate_project_contracts.py` ↔ `validate_self_review.py` ↔ `validate_svg_layout.py` | 三个独立的验证脚本，每个检查不同的契约维度。但它们本可以是一个脚本的三个 mode，共享文件存在性和 JSON 解析逻辑 |
| `pipeline_gate.py` 的 role | 既是 gate 又是 manifest 更新器。`_fail_if_future_artifacts()` 是纯检查，但 `visual-approved` 既检查又写 manifest。两个功能应该分离 |

**脚本总数**：21 个 Python 文件。对于一个 Skill 而言，这已经接近一个小型微服务架构的代码量了。

---

## 11. 自检清单 (Self-Checklist) 的跨文件复制

以下文件在末尾包含一个可勾选自检清单：

- `02_content_worker.md`（第 10.4 节，16 项）
- `03_layout_worker.md`（第 13.5 节，16 项）
- `04_svg_worker.md`（非正式，在错误中混入）
- `05_integrated_review_worker.md`（非正式）

**判断**：每个子 Agent 的自检清单是其 workflow 文件的一部分，是合理的。但如果 70% 的检查项是通用的（如 "input_hashes 不空"、"没写入 forbidden_writes"），则应提取到 `agent_result_contract.md`。

---

## 12. 总体数字

| 指标 | 值 |
|------|------|
| 文件总数 | 55 |
| 其中 .md 文档 | ~34 |
| 其中 .py 脚本 | 21 |
| 总行数 | ~94,000 |
| 估算独一无二内容 | ~40,000-50,000 |
| 可合并或删除的冗余百分比 | ~45-57% |
| 明确定义但未实现的机制 | 1（batch learning） |
| 遗留的 v1 脚本（v2 有新版但 v1 还在） | 3+ |
| 语义重复的脚本 | 2 对（template analyzer / mece scan） |
| 中英混用的文件 | 至少 12 个契约文件一半英文一半中文 |

---

## 13. 合并方案（建议，非强制）

最大的结构性改进（不删文件，但未来可考虑）：

1. **SKILL.md → 极简 router**（~50 行），README.md → 快速开始（~30 行），其余内容合并到一篇 `references/complete-guide.md`

2. **契约统一为 contracts/ 下的单一文件**，每个 step 一个节，而不是每个 step 一个文件。12 个 contract 文件可以压缩到 3-4 个（通用契约 + content/layout/svg 专有契约 + 回顾契约）

3. **agent_result.json 样板从 workflow 文件中删除**，只留 step 特有字段说明

4. **Common Errors 提取为 `references/common-pitfalls.md`**，按主题索引，workflow 文件引用章节号

5. **脚本清理**：删除 v1 遗留脚本（`template_analyzer.py`、`mece_scan.py`、`pptflow.py` 如果 ppt_parent.py 已覆盖）

6. **语言统一**：所有文件使用中文（既然用户界面语言是中文）

7. **实现或删除 batch_learning**：要么写对应的 gate 脚本和注入机制，要么删除 contract

8. **quality_checklist.md 合并到 validate_svg_layout.py 的文档字符串**，不再作为独立 .md

---

## 14. 冗余度热力图

```
                       冗余浓度
SKILL.md  ───────────── ████████████   极高（与 README 80% 重复）
README.md ───────────── ████████████   极高（与 SKILL 80% 重复）
00_parent_orchestrator  ██████████     高（与 SKILL 大量重叠）
每个 workflow 文件的
  agent_result.json    ██████████      高（8 份相同字段表）
  Common Errors        ████████        中高（40% 跨文件重复）
  SHA256 代码          ████████        中高（8 处相同）
  forbidden_writes     ███████         中（6 处相同清单）
contracts/ 双语        █████           中（增加认知成本）
scripts/*v1 + *v2      ████            中（遗留文件未清理）
batch_learning         ██              低（有定义无实现）
```

---

## 15. 总结

这个 Skill 的设计质量——workflow 严谨性、gate 机制、contract 驱动的架构——是非常高的。但它的**文档体量**已经膨胀到架构本身开始被重复淹没的程度：

- 一份内容大约被陈述了 **2.5 次**（50k 实际 / 94k 总量）
- 维护者更新时需要在 3-5 个地方做同样的修改
- 新加入者需要判断"我在读的是权威版本还是拷贝"

冗余的根源不是工程师不仔细，而是：
1. 每个子 Agent 需要"自包含"的参考文档（导致样板扩散）
2. v1→v2 迁移时旧文件未标记 deprecated 或删除
3. 中英文双轨制
4. "文档即规范"的过度膨胀——大部分约束应通过脚本（contract validation）而非 .md 文件来强制

一个极简的 Planner's PPT Hell 可以缩减到 25-30 个文件（而不是 55 个），~40,000 行（而不是 94,000 行），而不丢失任何信息。
