# Failure Mode Scan v2

> 扫描日期：2026-07-09
> 对应升级：Planner's PPT Hell v2 (upgrade-plan-v2.md)

---

## 1. Premature Completion（提前完成）

### 旧版风险
子 Agent 可能声称完成但缺文件。

### v2 修复
- ✅ 每个 worker 必须输出 `agent_result.json`（agent_result_contract.md）
- ✅ parent 只认脚本 validation（collect_agent_results.py + validate_agent_result.py）
- ✅ 子 Agent 不得推进 flow state（agent_task_contract.md 明确 forbidden_writes）
- ✅ output_files 必须含 SHA256 哈希，可校验文件完整性
- ✅ input_hashes 必填，确保子 Agent 确实读取了输入文件

### 残余风险
- 子 Agent 可能写入空文件但填写正确的 SHA256（哈希计算无法区分内容质量）
- 缓解：contract validation 检查 JSON 结构完整性；pipeline gate 检查必填字段

---

## 2. Duplication（重复）

### 旧版风险
旧 contract 和新 contract 并存造成冲突。

### v2 修复
- ✅ SKILL.md 不再重复 schema 细节，只做路由
- ✅ 每个字段只有一个权威 contract（references/contracts/ 下）
- ✅ 旧 reference 保留但新 SKILL.md 指向新路径
- ✅ Milestone 7 做 active route cleanup，标记每个旧文件 keep/remove/compatibility_hold

### 残余风险
- 旧 references/ 文件仍存在（第一阶段兼容），可能被误读
- 缓解：SKILL.md 路由表明确指定每个 step 读取的文件；子 Agent 受限于 input_files 列表

---

## 3. Sediment（沉积）

### 旧版风险
旧强流程规则沉积在活跃路径里。

### v2 修复
- ✅ 新 SKILL.md 短版（~300行 vs 旧版 ~450行），不再堆砌流程细节
- ✅ 流程细节迁移到 references/workflow/ 按阶段分文件
- ✅ 未被路由引用的 reference 可在 M7 标为 cleanup candidate
- ✅ retrospective 包含删除候选

### 残余风险
- 旧版 references/ 文件（03_style_system.md 等）需要手动迁移到 references/domain/
- 缓解：Milestone 7 cleanup 表将逐项标注

---

## 4. Sprawl（蔓延）

### 旧版风险
v2 新增文件太多，变成另一种蔓延。

### v2 修复
- ✅ SKILL.md 只保留总控（路由表 + 权限边界 + 脚本列表）
- ✅ workflow reference 按阶段读（子 Agent 只读当前 step 的 reference）
- ✅ domain reference 按 worker 读（SVG worker 读 style_system + svg_rules，content worker 不读）
- ✅ agent_task.json 的 input_files 精确控制子 Agent 视野

### 残余风险
- 新增 ~30 个文件（workflow references + contracts + scripts），目录结构变复杂
- 缓解：所有文件有明确路由关系；未被路由到的文件在 cleanup 时标记

---

## 5. No-op（无效规则）

### 旧版风险
继续写"认真""不要偷懒"式规则。

### v2 修复
- ✅ 弱指令转为 contract 字段（如 `anti_laziness_check` 是必填字段，不是建议）
- ✅ 脚本检查替代 prompt 纪律（如 `collect_agent_results.py` 拒绝缺 input_hashes）
- ✅ gate 阻止违规推进（pipeline_gate.py 的 `_fail_if_future_artifacts`）
- ✅ 用户确认点保存到结构化文件（layout_feedback.json, feedback.json, batch learning notes）
- ✅ repair loop 有 attempt 上限（max_repair_rounds: 2），不再无限循环

### 残余风险
- workflow reference 中仍有文字性指导（如"认真检查"），但已搭配可执行的脚本约束
- 缓解：所有关键行为都有对应的脚本 gate 或 contract 字段强制

---

## 总结

| 失败模式 | 旧版风险等级 | v2 风险等级 | 关键修复 |
|----------|------------|-----------|---------|
| Premature Completion | 高 | 低 | agent_result.json + SHA256 + input_hashes |
| Duplication | 高 | 中 | 单一权威 contract + route table |
| Sediment | 中 | 低 | 短版 SKILL.md + cleanup milestone |
| Sprawl | 中 | 中 | 按阶段路由 + input_files 视野控制 |
| No-op | 高 | 低 | Contract 字段 + 脚本 gate + repair limit |
