# Auto Model Routing（一期）

## 模式

| Composer `model` | 行为 |
|------------------|------|
| `auto` | 约束求解选模；异常步长可 cascade |
| 具体模型 id | 固定模型；无求解、无换模 |

## 网关 `/v1/models` 契约

每个模型 item 除既有 `id` / `name` / `owned_by` / `capabilities` 外，增加：

```json
{
  "routing": {
    "schema_version": 1,
    "status": "probing | active | failed | disabled",
    "tier": 1,
    "cost_weight": 10,
    "quality_weight": 55,
    "quality_by_task": { "chat": 70, "code": 40 },
    "roles": ["chat", "code"],
    "capabilities": ["tools"],
    "max_context": 128000,
    "probed_at": "ISO-8601",
    "probe_version": "v1"
  }
}
```

### 探针状态机

```
上架/变更 → probing → (成功) active
                    → (失败) failed  （可人工重跑）
下架 → 从目录删除
disabled → 不进 Auto 池（仍可 pin，若仍下发）
```

### Auto 候选硬规则

- 仅 `routing.schema_version === 1 && status === "active"` 可进入 Auto 池。
- 池空 → 客户端报错：请稍后再试或手动选择模型。
- `probing` / `failed` / 无 routing：可出现在固定模型列表，不可进 Auto。

联调 fixture：[`../../apps/desktop/src/main/fixtures/models-with-routing.json`](../../apps/desktop/src/main/fixtures/models-with-routing.json)

## Skill 约束

- 路径：`{skillDir}/routing.json`
- 合并：project > user > central；`min_tier` 取 max，roles/capabilities 取并集
- 无文件时按 skill 名推断（政务写作等）

## Optimize For

- `cost` / `balanced` / `intelligence`（默认 `balanced`）
- 仅 Auto 模式生效；固定模型忽略

## 冲突摘要

- Pin 不满足 skill：警告继续，不换模
- Pin 不在目录：阻断
- Auto 无候选或不满足约束：阻断
- Pin + 网关错误：不 cascade
- reviewModel：独立，主模式不改写
