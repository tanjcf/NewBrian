# 验收与Forward Test方案

## P0 静态与合同门禁

- Skill `quick_validate.py`通过。
- `mece_scan_v2.py`覆盖SKILL、workflows、contracts、Controller、review、tests和模板包。
- 全仓扫描无Parent Agent、affinity、bind/resume/send/wait、agent_result、execution parallel/serial生产引用。
- 只有一个registry、`layout_id`和`template_layout_id`语义保持唯一。
- 模板包无绝对项目路径、pyc、backup、未引用媒体和陈旧preview。
- 所有task input恰好等于input hash集合；模型不被要求写hash或timestamp。

## P1 自动行为门禁

`smoke_v2.py`至少覆盖：

1. 初始化与模板选择阻断。
2. Template→Content→Layout严格串行。
3. `next --json`每次只给一个动作。
4. finalize成功一次完成；失败一次返回全部issues。
5. 不存在任何Agent affinity或恢复要求。
6. Template/Content/Layout语义输出由模型写，机器字段由Controller写。
7. Layout无精确匹配时选择`content_base`。
8. 未选专用canvas不进入SVG task。
9. SVG task无完整profile/registry/evidence/asset registry/components/unselected canvas。
10. locked hash、required component、unknown layout、overfull、stale feedback和缺图均正确阻断。
11. partial/failed不能推进状态。
12. Review的Approve/Revise/Discard路由正确且不自动发布。
13. 自动日志包含命令、duration、失败和修复轮次。

## P2 真实Forward Tests

### A. 默认模板应用

从空项目使用`planner-simple-default`完成Content→Layout→一个SVG batch→render→validator。证明：

- 模板无需提取；
- `content_base`可用；
- wireframe坐标进入SVG；
- locked/required通过；
- review provenance新鲜。

### B. 非专用真实`content_base`

使用不匹配流程、漏斗、对比或数据表的真实策略页。断言：

- Layout明确记录“不精确匹配”；
- `template_layout_id=content_base`；
- task只携带`content_base.svg`；
- SVG文字坐标与wireframe一致；
- PNG可读且无技术错误。

### C. 新模板全流程

从PPTX逐页图片开始：Template视觉提取→人工模板审阅→Content→Layout review→SVG→Visual review→PPTX。不得读取旧项目产物，不自动批准。

### D. 弱模型全流程

使用一个较弱模型和干净上下文，仅给`06_EXECUTION_PROMPT.md`所定义的用户Prompt。成功标准不是审美等同最强模型，而是：

- 零机器元数据返修；
- 零错误Agent恢复/替换；
- 零跨阶段越权写入；
- 零重复初始化；
- 每次能按Controller的单一动作推进；
- 在人工门禁准确停下；
- hard validator和人审不被绕过。

### E. SVG并发对照

同一份已批准Layout分别运行串行和可选并发。比较输出hash规则、validator、视觉review与耗时；并发不能改变合同或质量。

## P3 UI与视觉门禁

- Template页面所有源图和canvas图HTTP 200，无broken image/console error。
- 每个Layout有Yes/No、独立反馈；整体有Approve/Revise/Discard、整体反馈和模板名。
- Layout页面按页面语义展示标题、正文、表格、指标、卡片和说明，不出现裸`table`标签或逐字段单列倾倒。
- Visual页面能逐页反馈并提交整体决定。
- 页面可滚动、控件不被卡片裁剪；10页以上仍能操作。
- 当前模板visual gate通过；人工视觉审阅仍由用户完成。

## 性能与稳定性指标

| 指标 | vNext目标 |
|---|---|
| Parent/Worker wait/send/resume调用 | 0 |
| Template/Content/Layout子Agent数量 | 0 |
| 机器元数据返修 | 0 |
| 同一错误逐项返修 | 0；一次报告完整集合 |
| 非故意失败命令率 | <5% |
| 重复初始化 | 0 |
| 人工等待以外的空转 | 0 |
| 弱模型到Layout Review合同错误 | 0 |
| 每阶段自动修复预算 | 最多1轮集中返修 |
| SVG并发 | 可选、一次性、仅batch级 |

运行时间预算应分开报告，不把人工等待混入：模板宿主渲染、模型视觉生产、脚本/validator、SVG生产、人工等待、导出。首个真实全流程后再以实测p50/p90设绝对分钟SLO，避免凭空承诺。

## 五种失败模式扫描

- Premature Completion：每阶段只有finalize成功事件才能推进。
- Duplication：一个状态机、一个registry、一个review schema、一个issue模型。
- Sediment：旧Agent机制和缓存直接删除。
- Sprawl：SKILL只保留核心流程；阶段细节按需读取。
- No-op：所有关键指令都对应task字段、命令或测试断言。

## 最终通过清单

- smoke_v2.py
- mece_scan_v2.py
- quick_validate.py
- 当前模板visual gate
- 默认模板应用
- 真实content_base forward
- Review Server health与关键资源200
- 新模板人工review页面
- 弱模型完整衔接测试
- 新模板完整全流程PPTX
- 候选vs基线diff与删除清单
