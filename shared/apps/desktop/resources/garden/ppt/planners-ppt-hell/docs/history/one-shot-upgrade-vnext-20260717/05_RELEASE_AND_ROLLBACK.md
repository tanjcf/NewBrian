# 发布、迁移与回滚

## 候选创建

1. 从RC1生成机器基线manifest。
2. 复制到`releases/2026-07-17-vnext-candidate/planners-ppt-hell`。
3. 验证初始逐文件hash一致。
4. 所有实现和测试只在candidate进行。

candidate是新版本工作区，不是备份目录。正式Skill和RC1是既有可回滚版本，不再额外创建`backup/old/bak`。

## 旧项目迁移

vNext不在生产路径保留legacy fallback。确需继续的旧项目使用一次性离线migration：

- 保留有效manifest、语义产物、SVG、review feedback和provenance；
- 验证当前hash；
- 删除agent result与affinity状态；
- 为已验证阶段生成机器`stage_completed`事件；
- 任何不新鲜人审都必须重新审阅。

迁移脚本运行后输出报告，不修改Skill。无法证明新鲜性的项目从最近一个可证明阶段继续。

## 晋级门禁

只有以下条件全部满足才可替换正式Skill：

- `04_ACCEPTANCE_PLAN.md`全部自动门禁通过；
- 弱模型forward完成；
- 新模板全流程完成到PPTX；
- 用户完成当前模板、Layout和Visual审阅；
- 无自动审批；
- diff中每个新增/修改/删除文件都有对应原因；
- candidate无运行缓存、测试产物和项目绝对路径。

## 原子晋级

晋级前再次比较正式Skill、RC1与candidate。替换采用一次目录级操作，并立即在正式路径重跑quick_validate、smoke、MECE和一个最小forward。任一失败立即恢复原正式目录；不在失败的正式目录上现场打补丁。

## 停止条件

以下情况必须停止晋级，但不阻止继续在candidate修复：

- hard validator被迫放宽才能通过；
- 人工审批无法绑定当前证据；
- 为兼容旧项目需要恢复第二状态机/registry；
- 弱模型仍需手工修机器元数据；
- Layout或SVG需要完整profile/evidence才能完成；
- Review资源仍出现陈旧路径或打不开。

## 回滚验证

回滚后确认：

- 正式Skill hash回到晋级前manifest；
- 旧项目仍可使用原版本；
- candidate和其测试项目保留用于诊断，但不会被Skill发现；
- 不把失败candidate的memory、模板或审批证据写入正式Skill。
