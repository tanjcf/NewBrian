# vNext 目标架构

## 1. 核心原则

vNext 是 L6 脚本编排系统，不是多个 Agent 组成的聊天组织。模型负责非确定性判断，脚本负责确定性事实，人类负责主观批准。

```text
用户与输入
  ↓
Pipeline Controller（唯一状态机、唯一机器元数据写者）
  ↓
主执行 Agent
  ├─ Template：视觉身份、页面边界、canvas
  ├─ Content：事实和完整内容
  ├─ Layout：结构、final copy、wireframe、canvas 选择
  └─ SVG：按已批准任务执行
       └─ 可选：互不依赖的一次性 batch Worker 并发
  ↓
Validator / Renderer / Review Server / Exporter
  ↓
人工模板、Layout、Visual 三道门禁
```

## 2. 删除“Parent Agent”概念

当前 Codex 对话中的主 Agent直接执行 Controller返回的当前动作。Controller不生成“派发给谁、如何恢复谁”的建议，只返回一个可执行 action packet：

```json
{
  "state": "LAYOUT",
  "action": "execute_stage",
  "task_file": "_internal/00_project/tasks/layout_task.json",
  "instruction": "Read the task, write only declared semantic outputs, then run finalize-stage.",
  "finalize_argv": ["...", "finalize-stage", "--step", "layout"]
}
```

删除以下控制语义：

- Parent/Worker自然语言协商；
- `spawn_agent` 作为必需流程；
- `worker_agent_affinity`；
- `bind-agent`；
- `resume_then_send`、`spawn_then_bind`；
- “保留原 Agent 等待返修”；
- Template/Content parallel execution mode；
- 子 Agent不可用时要求用户决定是否降级。

返修只依赖冻结的 task、当前反馈快照和产物，不依赖某个 Agent的对话记忆。

## 3. Ownership

| 事实 | 唯一写者 | 模型可写 |
|---|---|---|
| 项目状态、事件、开始/结束时间 | Controller | 否 |
| task/input/output/feedback hashes | Controller | 否 |
| task 允许输入、输出和命令 | Controller | 否 |
| Template视觉语义与 canvas | 主 Agent | 是 |
| 页面完整内容 | 主 Agent | 是 |
| Layout结构、上屏文案、wireframe、canvas选择 | 主 Agent | 是 |
| SVG内容层与视觉自审判断 | 主 Agent或一次性 SVG Worker | 是 |
| schema/hash/locked/required/capacity/SVG检查 | Validator | 否 |
| 人工反馈与批准 | Review Server | 否 |
| PPTX导出 | Controller | 否 |

## 4. 最小持久状态

保留：

- `page_manifest.json`：稳定项目索引和用户配置。
- `flow_events.jsonl`：Controller/Server追加的机器事件与耗时。
- `tasks/<stage>_task.json`：当前阶段不可变输入快照。
- 各阶段语义产物：profile、content、layout、SVG、自审判断。
- validator/render/review/export 证据。
- 三类人工 feedback JSON。

删除：

- `*_agent_result.json`；
- `worker_run_id`、`agent_id`、affinity事件；
- Worker手写 input/output hashes、timestamp和task identity；
- execution `parallel/serial` 状态；
- 空的 `parent.log` 依赖。

阶段完成由 `finalize-stage` 在同一次命令中完成：检查 task、新鲜输入、精确输出集合、schema、阶段 validator和视觉证据，然后向 `flow_events.jsonl` 追加带 hash 的 `stage_completed`。失败时一次返回全部问题，不写完成事件。

## 5. Prompt 分层

每个阶段只有三层信息：

1. 固定短指令：职责、禁止事项、完成命令。
2. task：精确文件 allow-list、输出、命令和当前反馈快照。
3. 单个阶段 workflow/contract：方法与语义 schema。

Controller不复制 architecture、历史日志、完整 profile或其他阶段说明到 Prompt。Prompt lint 必须证明：

- Template看不到 Content/Layout/SVG方法；
- Content看不到模板 canvas和SVG规则；
- Layout看不到提取证据、asset registry和SVG施工；
- SVG看不到完整 profile、完整 registry、components.svg、未选canvas和跨 batch文件。

## 6. 阶段工作流

### 6.1 初始化与模板选择

Controller原子初始化并列出模板库。用户只选择：默认模板、已有模板、新提取或无模板。选择前不开始模型生产。

### 6.2 Template

仅新模板触发。主 Agent查看有序源页，建立视觉身份、核心功能页和可选专用 canvas；replace layer 为空。机器完成 builder、render、hash绑定与visual gate。人工页面中：

- 每个 Layout：Yes/No框选 + 独立反馈框；
- 整体：Approve / Revise / Discard；
- 模板命名保留；
- Revise时反馈必填；Approve要求所有 Layout Yes和模板名；Discard不要求四维说明。

### 6.3 Content

主 Agent从源文案生成完整、可追溯的页面内容。只做内容拆分与事实保留，不做模板选择、wireframe或SVG。

### 6.4 Layout

主 Agent拥有上屏文案、内容关系、wireframe、素材角色、容量与`template_layout_id`。专用 canvas只有精确语义匹配时才能选，否则为`content_base`。一次 preflight返回全部 schema、capacity、canvas和copy问题；修完后才生成 Layout Review。

### 6.5 SVG

默认主 Agent按 batch执行。大于一个 batch且宿主并发能力可用时，Controller可生成互不相交的一次性任务；宿主可以并发执行，但这只是性能优化，不改变合同。每个执行者：

```text
selected canvas + approved final_on_slide + approved wireframe
→ 保留 locked layers
→ 在空 replace layer 内绘制
→ validator
→ render
→ 视觉检查与最多一次集中返修
→ finalize-stage
```

返修可由任意合格执行者读取 revision task完成，不恢复旧会话。

### 6.6 Review与Export

Review Server是唯一反馈写者。任何HTML/PNG/SVG/registry变化都会使旧批准失效。只有三道批准新鲜且所有hard gate通过，Controller才能严格缺图导出PPTX。

## 7. Validator策略

保留hard validators：schema、路径/写入范围、hash、locked layer、required components、SVG技术合法性、capacity overfull、review provenance、严格缺图和PPTX存在性。

调整：

- 将分散的同阶段检查聚合成一次 preflight；
- 一次报告全部错误；
- 启发式视觉提示只作为warning，不伪装成技术真理；
- validator不要求模型手写机器字段；
- 同一断言只有一个实现与一个测试权威。

## 8. 日志

Controller自动记录：stage started/completed/failed、命令argv、exit code、duration、issue codes、输入输出hash、人审等待区间和可选SVG并发信息。`analyze_run.py`从事件生成报告；不要求Agent另写聊天摘要或空日志文件。

## 9. 持续迭代

运行后只把通用、重复出现的问题升级进Skill。项目反馈留在项目。新机制替代旧机制时删除旧字段、旧测试、旧Prompt和旧产物，不保留兼容分支。
