# BRAIN docs

按用途分目录。日常从这里找入口，不要再在根目录堆长文件名。

## 怎么找

| 你想看什么 | 去哪 |
|---|---|
| 产品目标、七工作台、路线图 | [product/workspace-architecture.md](./product/workspace-architecture.md) |
| 怎么落地（表、接口、阶段步骤） | [product/implementation-playbook.md](./product/implementation-playbook.md) |
| 新手教学视频剧本（分场景） | [product/brain-newbie-tutorial-scripts.md](./product/brain-newbie-tutorial-scripts.md) |
| 桌面架构、安全边界、Rust Core | [architecture/brain-product-architecture.md](./architecture/brain-product-architecture.md) |
| 仓库分层 / materialize | [architecture/repository-layout.md](./architecture/repository-layout.md) |
| 统一能力运行时 | [architecture/unified-capability-runtime-v1.md](./architecture/unified-capability-runtime-v1.md) |
| 七场景 Tools 子架构 | [architecture/brain-scene-tools-v1.md](./architecture/brain-scene-tools-v1.md) |
| 原型对齐 · 前端先行 / Rust 后置 | [architecture/brain-scene-prototype-alignment-v1.md](./architecture/brain-scene-prototype-alignment-v1.md) |
| game 场景 / UE5 | [architecture/brain-game-runtime-v1.md](./architecture/brain-game-runtime-v1.md) |
| video 场景 / AI 视频生成 | [architecture/brain-video-runtime-v1.md](./architecture/brain-video-runtime-v1.md) |
| music 场景 / AI 音乐生成 | [architecture/brain-music-runtime-v1.md](./architecture/brain-music-runtime-v1.md) |
| quant 场景 / 极简模拟盘（对话优先） | [architecture/brain-quant-runtime-v1.md](./architecture/brain-quant-runtime-v1.md) |
| data 场景 / AI 数据分析 | [architecture/brain-data-runtime-v1.md](./architecture/brain-data-runtime-v1.md) |
| software 场景 / AI Agent 开发 | [architecture/brain-software-runtime-v1.md](./architecture/brain-software-runtime-v1.md) |
| document 场景 / AI 文档修订 | [architecture/brain-document-runtime-v1.md](./architecture/brain-document-runtime-v1.md) |
| 行情数据合同 | [architecture/quant-market-data-contract.md](./architecture/quant-market-data-contract.md) |
| 当前实施 checklist | [plans/2026-08-19-product-platform.md](./plans/2026-08-19-product-platform.md) |
| 验收规则摘要 | [plans/2026-08-19-product-platform-design.md](./plans/2026-08-19-product-platform-design.md) |
| 打包 / E2E / 探测证据 | [evidence/](./evidence/) |

## 目录约定

```text
docs/
  product/         产品设计（做什么、为什么、路线）
  architecture/    技术合同（边界、分层、协议）
  plans/           正在执行的实施计划与验收规则
  evidence/        带日期的测试与发布证据（只追加，不当设计正文）
```

- `product/` 与 spring-app 联合设计的权威正文。
- `architecture/` 约束本仓库实现；改行为先改这里。
- `plans/` 跟踪任务勾选状态；完成后勾选，不复制成第二份架构文。
- `evidence/` 只放可复现的运行记录；结论写进对应 plan，不在这里扩写设计。

公司控制面（账号、网关、搜索策略）文档仍在 `spring-app/docs/`。  
Windows 平台历史原型与旧计划仍在 `platforms/windows/docs/`，不与本目录混放。
