# 场景知识描述

这些文档定义 NewBrain 场景聊天与右侧 Tools 子架构的共同契约。运行时会按当前场景和用户问题检索，并把结果注入模型上下文；模型必须通过右侧工具取得真实结果，不能把 Skill 文件变更当作场景执行结果。

**例外：** 场景学习探索 — 无业务 Tools 面板，仅文件/产物/任务 + 原生对话。

场景：量化交易、游戏制作、视频制作、音乐创作、数据与决策、软件与自动化、文档创作。

## 项目初始化

新建/打开业务场景项目时，`project-init` + `*-project-manager` 会把对应 `docs/scene-knowledge/<scene>.md` 基线写入：

- `.newbrain/skills/<project>-project-manager/references/scene-knowledge.md`
- `.newbrain/skills/<project>-project-manager/references/scene-tools-routing.md`
- `.newbrain/skills/project-init/SKILL.md`
- `Docs/BRAIN/scene-knowledge-<scene>.md`（便于人读）

全局/项目 Skill 模板也要求：除探索场景外，AI 必须走右侧 Tools 子架构（与视频流水线同级）。

运行中发现的新知识由 `scene-knowledge-maintainer` Skill 维护：已验证内容写入当前项目的
`project-knowledge.md`，不确定内容写入 `learning-open-questions.md`。内置场景文档是版本化
产品基线，普通对话不得直接改写；知识远端同步保持用户手动触发。
