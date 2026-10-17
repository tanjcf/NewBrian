# 历史问题到持久修复映射

| 历史现象 | 根因 | vNext修复层 | 不再采用的补丁 |
|---|---|---|---|
| Parent 173次exec、170次wait、37次Agent wait，约2小时仍未到SVG | 对话式状态管理，Parent反复轮询外部Agent | 删除常驻Worker与通信协议；Controller只产出当前动作 | 增加更长等待、更多状态提示 |
| Parent上下文从约22k膨胀到194k | 每轮重复读取状态、转述错误、保留多个Worker上下文 | 单主Agent按阶段渐进加载；事件和task传状态 | 再写一份对话摘要registry |
| Template/Content并发产生竞态、空目录初始化冲突 | 并发收益小于协调成本，项目初始化边界不唯一 | Template→Content→Layout串行；纯脚本可内部并行 | 让Parent更频繁检查并发 |
| task/result时间戳、input hash、feedback hash反复返修 | 让生成式模型写确定性元数据 | `finalize-stage`机器生成全部元数据 | 给Worker更长JSON模板 |
| 未来时间戳也被接受 | Collector只做格式/顺序局部校验 | Controller使用本机时钟写事件；模型不写时间 | 在Prompt强调“不要写未来时间” |
| `pages_reviewed`整数/字符串、self-review结构漂移 | schema由模型裸写且逐项报错 | 机器生成骨架，模型只填枚举和判断；一次报全 | 单独开Agent修一个字段 |
| 用户No被解释成返修，实际是删除 | UI动作与工作流状态没有显式映射 | per-layout Yes/No；整体Approve/Revise/Discard三态 | 依靠自然语言猜用户意图 |
| Review图片2–6打不开、旧HTML找不到 | 绝对路径、陈旧server/session和file fallback | 包内相对资源；Server健康/资源200；不存在即明确失败 | 复制旧预览或保留fallback |
| 页面文案像逐行JSON dump，可读性差 | 审阅页直接平铺嵌套结构，没有语义renderer | Layout review为标题、正文、表格/卡片结构化呈现；原始JSON折叠 | 只改CSS字号和行距 |
| 四维反馈阻断提交、压力大 | 旧合同/JS/Server多套实现叠加 | 单一review schema和单一提交函数 | 继续兼容四维旧字段 |
| Template通过技术检查但视觉上只是灰框 | 技术validator被误当视觉判断 | 模板render→视觉自审→visual gate→人工审阅 | 再增加几条几何validator代替看图 |
| 专用模型误入或被错误删除 | 模板身份、内容结构、可选模型边界混乱 | Template只固定身份；Layout精确选择；未选不入task | 最近模型fallback或全量canvas输入 |
| `content_base`只证明被选，未证明遵守wireframe | forward适配器硬编码坐标 | 测试直接断言SVG文字坐标等于Layout wireframe | 只检查文件存在/validator 0 error |
| Validator很多但仍反复 | 检查分散、逐个失败、启发式与hard混用 | 单阶段preflight、全量issue list、hard/warning分层 | 删除所有validator或继续叠加 |
| logs/parent.log为空 | 日志依赖Agent自觉而非控制器 | 事件与命令自动记录，报告机器生成 | Prompt要求“记得详细写日志” |
| 测试全绿但架构仍矛盾 | 测试固化旧合同且扫描范围不完整 | 目标合同先写失败测试；MECE覆盖Prompt/JSON/模板包 | 为通过测试放宽语义断言 |
| 弱模型不断调用错误命令 | 流程依赖模型拼命令、判断下一步和修机器字段 | Controller返回完整argv和一个动作；模型只做语义工作 | 给弱模型更长总体说明 |

## 关键判断

1. JSON不是原罪。保留有唯一owner和下游用途的JSON；删除用于Agent通信和重复状态的JSON。
2. 时间戳有审计价值，但只能由机器生成，不能作为模型工作项。
3. 子Agent不是默认架构。只有互不依赖的SVG batch存在可衡量并发收益时才可一次性使用。
4. Validator不是越少越快。应删除重复和启发式阻断，集中保留能确定性防事故的hard gates。
5. 弱模型稳定性来自减少决策自由度和机器化 bookkeeping，不来自增加解释文字。
