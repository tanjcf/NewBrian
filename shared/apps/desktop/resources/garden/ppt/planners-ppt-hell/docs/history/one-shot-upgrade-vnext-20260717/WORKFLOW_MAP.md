# vNext Workflow Map

## 目的

稳定地把Markdown和可选模板转换为经过模板、Layout、Visual三道人审的可编辑PPTX，同时消除Parent/子Agent通信、机器元数据返修和无效轮询。

## 工作流

### Step 1：初始化与模板选择

- 管控：L6脚本编排 + 人工方向介入。
- 输入：source Markdown、可选PPTX/PDF/图片、空项目目录。
- 输出：manifest、flow events、模板选择。
- 完成：Controller确认输入hash和用户模板选择；没有选择不得继续。

### Step 2：Template（仅新模板）

- 管控：L2文件关隘 + L3技术门禁 + L5视觉/人工合同。
- 输入：有序源页视觉证据和阶段workflow。
- 输出：profile、单一registry、空replace canvas、视觉自审。
- 完成：builder/render/visual gate通过，用户Approve；Revise回到同一阶段，Discard退出模板路径。

### Step 3：Content

- 管控：L2语义产物 + L3 schema preflight。
- 输入：source Markdown。
- 输出：完整可追溯`page_content.json`。
- 完成：所有内容页、来源和非上屏信息闭合；Controller finalize成功。

### Step 4：Layout

- 管控：L2语义产物 + L3 capacity/contract + 人工质量介入。
- 输入：Content、可信模板方向和单一registry。
- 输出：final_on_slide、wireframe、素材角色、canvas选择。
- 完成：无overfull、无未知canvas、无缺失wireframe；非精确匹配均为content_base；用户Approve。

### Step 5：SVG batches

- 管控：L2 batch写入边界 + L3 validator/render + L5视觉自审。
- 输入：当前batch内容、Layout、已选canvas、最小style和SVG规则。
- 输出：SVG、PNG、validation、自审判断。
- 完成：locked/required/技术validator通过，视觉must-fix为空。默认主Agent串行；可选一次性batch并发。

### Step 6：Visual Review与Export

- 管控：人工批准 + L3 provenance/strict export。
- 输入：全deck当前PNG、SVG和验证证据。
- 输出：feedback、最终PPTX和转换报告。
- 完成：用户Approve，所有证据新鲜，严格缺图导出成功。

### Step 7：Retrospective

- 管控：机器日志分析；不自动改Skill或memory。
- 输入：flow events、命令结果、人审等待和最终产物。
- 输出：时间分解、失败/返修/浪费和Skill改进候选。
- 完成：项目问题、通用Skill问题和环境问题被分开记录。

## 人机介入点

| 介入点 | 用户看到 | 用户提供 | 保存位置 |
|---|---|---|---|
| 模板选择 | 默认/已有/新提取/无模板 | 单一选择 | manifest |
| Template Review | 源图、canvas、每Layout Yes/No | Approve/Revise/Discard、反馈、名称 | template_feedback.json |
| Layout Review | 语义化页面预览与容量 | 页面与整体反馈、决定 | layout_feedback.json |
| Visual Review | 全deck PNG | 页面与整体反馈、决定 | feedback.json |

## 资源路由

- Core：SKILL只声明顺序、边界和必读reference。
- Workflow：每阶段只读取自己的workflow。
- Contracts：只描述语义产物，不要求模型写机器元数据。
- Scripts：Controller、task builder、finalize、validators、render、review、export。
- Assets：人工批准的模板运行时包；提取证据不进入SVG task。

## 已确认

该Map吸收了用户关于删除Parent/常驻子Agent通信、保留视觉门禁、简化反馈、content_base与最小SVG task的连续反馈；本轮不再重复要求用户确认同一方向。实施后的人工确认只发生在真实Review和正式Skill晋级。
