# BRAIN Scene Prototype Alignment v1

> Status: **交付中 — 禁止再把壳当成完成**  
> Parent: [brain-scene-tools-v1.md](./brain-scene-tools-v1.md)  
> Prototypes: `spring-app/docs/prototypes/*-workspace.html`  
> Product rule: **每个场景按钮必须落到真实 IPC / Engine / 持久化；失败要明确失败，禁止本地假成功。**

## 0. 交付原则（对用户）

| 允许 | 禁止 |
|------|------|
| 无工程时禁用操作并说明「请先绑定工程」 | 「本地模拟已生成」「前端演示队列」「本地占位」冒充成功 |
| 网关/Engine 不可用时报错 | 静默 mark ready / 假 PASS |
| 分阶段接通真实链路并附证据 | 文档写 complete / P3 完成却仍是壳 |

```text
交互原型 (HTML) = UI 合同参考
→ Renderer 必须调真实 IPC
→ Main / Rust / Engine
→ 可重启、可验收的产物
```

---

## 1. 七场景诚实台账（2026-08-23）

| 场景 | 可用度 | 已接真实能力 | 仍禁止交付的缺口 |
|------|--------|--------------|------------------|
| **量化** | 中高 | Skill 主路径：`runSkillSimulation` 按真 K 线自动买卖；组合展示 Skill 账本；雷达挂同一 Skill；行情经 spring-app `market-bars`→AKShare | 桌面不得直连 AKShare；对话尚未「编写」自定义量化 Skill（仅内置 `trend-following`/`mean-reversion`）；手动买卖仅为对照盘 |
| **文档** | 高 | `DocumentWorkspace` 文件/锚点/ChangeSet 审校导出 | 已移除假文稿 `DocumentPreviewShell` 入口 |
| **软件** | 高 | `SoftwareWorkspace` 终端/代码/测试/部署 + `FlowWorkspace` | 已移除 `SoftwareExecShell` 假终端/假 PASS |
| **数据** | 高 | 导入/图表/`DataJuliusShell`/Flow | 无数据集时必须空态，不得编造表 |
| **视频** | 中 | FFmpeg render、`generateBrainSceneMedia`、分镜标记 | 无工程禁止假生成；网关失败必须报错不得 mark ready |
| **音乐** | 中 | 生成/渲染 IPC、分区持久化 | 禁止空壳「＋音轨」演示 |
| **游戏** | 中 | Level Editor get/save/spawn、试玩/Cook IPC；默认空关卡、不伪造 Content/.umap、AI 按钮拒绝假 ✓ | 视口仍非 UE 视口；AI 材质/动作等管线未接入须明示失败；完整 UE 资产编辑未交付 |

---

## 2. Chrome

| 区域 | 合同 |
|------|------|
| 左栏 | 场景切换 + 场景过滤项目/对话 |
| 中栏 | 对话 |
| 右栏 | 文件/产物/任务 + **当前场景真实工具**（切场景须收回通用文件侧栏） |

---

## 3. 验收门槛（GO 条件）

每个场景至少一个：创建工程 → 执行主路径 → 磁盘/产物可见 → 重启后仍在。  
任一路径仍返回「演示/占位/模拟成功」= **NO-GO**。

**Version:** `brain-scene-prototype-alignment-v1`
