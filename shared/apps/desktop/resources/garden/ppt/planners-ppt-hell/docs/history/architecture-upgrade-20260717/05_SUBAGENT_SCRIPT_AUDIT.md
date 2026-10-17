# 子 Agent 脚本审计日志（Russell）

- Agent：`019f6bf2-d988-7d22-9c09-0eaa0c6f7970`
- 模式：只读 explorer
- 范围：23 个 `scripts/**/*.py`，约 12,318 行
- 写入：无

## 真实调用链

```text
ppt_parent.derive
  → make_agent_task
  → 宿主启动外部 Worker
  → Worker写 task outputs + agent_result
  → collect_agent_results
  → Parent阶段后处理
     Layout: contracts → capacity → review HTML
     Template: contracts → builder/visual gate → review HTML
     SVG: validation/self-review merge → PNG
  → review_server写人工证据
  → Parent export → native_svg_to_ppt
```

## 已确认缺陷

1. Collector把 `partial/failed` 当作合法状态，但未加入 issues；可能返回 `all_complete=true`。
2. Task result模板缺 `input_hashes`，Collector却强制要求。
3. Collector不要求 result output path 集合精确覆盖 task outputs；漏报输出可能通过。
4. 模板 HTML 三次覆盖同一提交函数，Server计算四维 valid 但不使用。处理决定：删除四维旧合同，而不是重新强制。
5. Capacity report 只展示，不阻断 `overfull` 进入人工审阅和 SVG。
6. 模板人工批准只绑定 HTML与源PNG，没有绑定 registry、canvas SVG/PNG；批准后 canvas变化不会使旧批准失效。
7. 审阅 HTML 生成器调用 `ensure_layout_canvases()` 并可能覆写 registry，越过 Builder唯一写者边界。
8. Parent export没启用 `--strict-missing-images`；缺图可能用占位后仍 COMPLETE。
9. Converter支持 notes，但 Parent未传，Content/Layout移入 notes 的内容可能不进 PPTX。
10. SKILL写“Parent不得直接调用 converter”，实际 Parent直接调用；最小修复应为“只有 Parent 可以调用”。
11. Retrospective workflow声称导出后自动触发，Parent实际直接 COMPLETE。
12. Layout/Visual feedback POST缺少精确 page-set结构验证；静态文件前缀路由缺少 resolve 后 root containment；无 body size limit。
13. `review_server.safe_batch_id()` 零调用。
14. `generate_review_html.py` docstring声称支持 `--batch`，parser无此参数。

## 重复实现

- `load_json/read_json` 至少十套，异常策略不一致。
- SHA-256 至少五套。
- 原子 JSON 写至少三套。
- SVG选择逻辑在 renderer/validator重复。
- 视觉闭环判断在 Parent/Collector/contracts/template gate重复，已有字段漂移。

本轮决定：只统一 result metadata 与 approval provenance 的直接权威，不做大范围 shared-utils 重构，避免扩大风险。

## 性能风险（记录但不在本轮大改）

- Validator文本重叠 O(T²)，并有 T×I、R×T；重复计算 boxes/transforms。
- contact sheet 随页数横向线性增长，长 deck 内存与宽度失控。
- Renderer每页固定等待约 300ms且串行。
- Template extractor接近 slides×(masters+layouts) 扫描。
- Template visual gate在 derive/Collector/Server/Library中重复读取并hash全部视觉文件。

## 采纳的实施顺序

1. Collector/result模板与精确输出集合。
2. 新模板反馈UX单实现 + canvas审批hash绑定。
3. Capacity overfull门禁。
4. Export严格缺图；notes可稳定接入则补齐。
5. Server路径与payload收紧。
6. Retrospective合同与真实状态机对齐。

## 未采纳项

- Agent建议恢复四维强反馈；与用户已明确的简化UX冲突，因此拒绝。机器 visual gate、逐 layout批准和整体反馈继续保留，不能把四维表单当作安全门禁。
