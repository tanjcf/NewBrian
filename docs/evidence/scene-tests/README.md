# 七场景百级操作验收

## 原则

- **禁止**只写「×12 条」汇总而不展开；每条操作必须有独立 `opId`、前置、步骤、预期。
- 每场景目标 **≥150 条**（software 基准：**193 条**）。
- 执行结果写入 `docs/evidence/scene-tests/{scene}/ledger.jsonl` 与 `report.json`。

## Catalog 文件（已全部生成，每条独立列出）

| 场景 | YAML | JSON | 总条数 | L0 | L1 | L2 | L3 |
|------|------|------|--------|----|----|----|-----|
| quant | `catalog/quant.yaml` | `catalog/quant.json` | **180** | 83 | 65 | 12 | 20 |
| game | `catalog/game.yaml` | `catalog/game.json` | **171** | 84 | 55 | 12 | 20 |
| video | `catalog/video.yaml` | `catalog/video.json` | **180** | 84 | 64 | 12 | 20 |
| music | `catalog/music.yaml` | `catalog/music.json` | **153** | 84 | 37 | 12 | 20 |
| data | `catalog/data.yaml` | `catalog/data.json` | **170** | 85 | 53 | 12 | 20 |
| software | `catalog/software.yaml` | `catalog/software.json` | **172** | 84 | 56 | 12 | 20 |
| document | `catalog/document.yaml` | `catalog/document.json` | **198** | 84 | 82 | 12 | 20 |
| **合计** | | | **1224** | | | | |

## 生成

```bash
node scripts/generate-scene-test-catalog.mjs software
```

## 单条字段

- `opId` — 唯一编号，如 `software.L1.flow.057`
- `title` — 操作名称
- `precondition` — 前置状态
- `steps` — 可执行步骤数组
- `expected` — 断言
- `automation` — `CDP` | `IPC` | `NATIVE` | `MANUAL`
- `blocking` — 失败是否阻断该场景 GO
