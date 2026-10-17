# 一次性升级执行Prompt

```text
请执行 Planner's PPT Hell vNext 一次性架构升级。

基线 Skill：
/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/PPT-Skill-around/releases/2026-07-17-rc1/planners-ppt-hell

升级包：
/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/PPT-Skill-around/V2PPTTest2/one-shot-upgrade-vnext-20260717

候选输出：
/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/PPT-Skill-around/releases/2026-07-17-vnext-candidate/planners-ppt-hell

先完整读取升级包中的00–05和evals/evals.json，再执行03_IMPLEMENTATION_PLAN.md的Phase 0–8。不要修改正式Skill。

核心目标：删除Parent与常驻子Agent的对话式编排。Pipeline Controller负责状态、task、hash、时间、验证、日志、review和export；当前主Agent串行完成Template、Content、Layout和默认SVG生产。只有多个互不依赖SVG batch且宿主确实支持并发时，才允许使用一次性batch Worker；不得resume、send、wait轮询或维护agent affinity。

模型只写语义产物和视觉判断，不写timestamp、input/output/task/feedback hash、运行身份或结果文件清单。阶段由机器finalize，一次返回全部问题。不要通过增加JSON字段、延长Prompt、增加第二套合同或放宽validator解决问题。

保留并验证：content_base fallback、最小SVG task、empty replace layer、locked layer hash、required components、capacity、SVG validator、模板视觉自检、三道人审、严格缺图导出。不得自动批准。

每个Phase完成后立即运行对应测试，失败先修复再继续。旧机制被替代后直接删除，不保留legacy fallback、backup目录、第二registry、第二layout分类、旧Prompt或旧测试断言。

完成时必须给出：实际修改/新增/删除文件；自动测试；弱模型forward；默认模板与真实content_base forward；新模板完整PPTX流程；运行时间分解；失败、返工和浪费日志；人工审阅入口；残余风险；是否满足晋级门禁。
```

## 独立弱模型全流程测试Prompt

```text
请使用下面的Skill从空目录完成一次完整PPT流程：
[CANDIDATE_SKILL_PATH]

输入文案：[MARKDOWN_PATH]
输入模板：[PPTX_PATH]
输出目录：[EMPTY_OUTPUT_DIR]

严格执行Skill中Pipeline Controller每次返回的唯一动作。不要读取旧项目，不要修改Skill或输入。到Template、Layout、Visual人工审阅时启动健康Server并给出URL，然后等待用户反馈；不要代替用户批准。持续执行到PPTX导出，并报告自动日志路径、失败命令、返修次数和各阶段有效耗时。
```
