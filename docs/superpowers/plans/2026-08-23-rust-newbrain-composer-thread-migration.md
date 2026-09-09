# Rust NewBrain Composer/Thread 增量迁移计划

## 目标

保持 NewBrain 原生 Composer、Thread、Agent Loop 和 Spring 意图路由为唯一运行时事实源；Rust 只逐步承接可验证的状态与本地能力，不复制聊天链路、不承担模型路由或密钥管理。

## 阶段

1. 盘点并冻结兼容合同：确认 Thread/turn/event 的现有类型、IPC 和 rollout 持久化格式。
2. Rust 实现最小 Thread/Turn 状态机（create/activate/archive、begin/append/finish/cancel），使用协议 v1 的新增 operation，先做单元测试。
3. Electron Main 增加 typed Rust bridge，采用影子双写和等价性校验；Node/NewBrain 仍是权威，失败不得影响对话。
4. 将 BRAIN conversation 改为原生 NewBrain Thread 的投影，移除独立 sendBrainMessage 的第二条模型消息链路。
5. 迁移 checkpoint、tool-call identity、approval 和恢复；完成后再评估 Rust 是否成为对应状态的权威。

## 约束

- Rust 不做意图识别、模型/搜索/行情路由，不接收 API key、Authorization 或其他公司密钥。
- 普通对话不注册或暴露 Web Search；仅由 Spring/明确的研究能力按策略提供。
- 不直接编辑 `.materialized` 生成目录；每阶段运行类型检查、Rust 测试和桌面构建。

## 验收

- “你好”不会产生 web search tool call。
- BRAIN 与原生 Thread 只有一个 user turn 和一个 assistant turn。
- 重启后 Thread/turn 状态可恢复，重复 request_id 幂等，尾部损坏事件可安全截断。
