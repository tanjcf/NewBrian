# NewBrain 记忆模式与 Agent 逻辑流程

本文基于 BRAIN 当前 `shared/` 源码与平台 overlay 梳理，不以 `.materialized/` 生成目录为源码依据。

## 1. 结论

NewBrain 当前没有真正可切换的“记忆模式”：

- `threads.memory_mode` 字段已经存在，创建线程时默认写入 `enabled`。
- 当前没有发现基于 `memory_mode` 的运行时判断、设置开关或单条记忆管理 UI。
- 实际记忆能力由线程 `MemoryIndex`、`UserShadow`、项目 PM Skill、`companion-memory` 和用户知识同步等多条链路共同组成。
- 线程记忆检索是关键词重叠启发式检索，不是向量检索。

## 2. 每轮记忆闭环

![每轮记忆闭环](newbrain-memory-flow.svg)

```mermaid
flowchart LR
    A[激活线程] --> B[读取 rollout state]
    B --> C[MemoryIndex.hydrate]
    C --> D[接收最新用户请求]
    D --> E[searchMemories<br/>limit = 5]
    E --> F[记录 memory_recalled]
    F --> G[将记忆拼入 system prompt]
    G --> H[Agent 执行]
    H --> I{执行结果}
    I -->|等待审批| J[保留 Runtime<br/>暂不写入回合记忆]
    I -->|取消| K[persistCancellation]
    I -->|异常| L[persistFailure]
    I -->|成功| M[rememberExchangeWithShadow]
    M --> N[更新 Shadow / Companion]
    N --> O{knowledgeStatus<br/>是否为 active}
    O -->|是| P[MemoryIndex.rememberExchange]
    O -->|否| Q[不新增 MemoryRecord]
    P --> R[去重与 prune]
    R --> S[更新 state.memories]
    Q --> S
    S --> T[记录 memory_created]
    T --> U[写入 rollout JSONL]
    U --> V[upsert stage1_outputs]
```

### 2.1 召回阶段

1. 激活线程时，从线程状态读取 `memories[]`。
2. `runtime.setThreadState` 调用 `memoryIndex.hydrate` 恢复运行时索引。
3. 每轮对话开始前，以最新用户请求调用：

   ```text
   runtime.searchMemories(latestUserRequest, { limit: 5 })
   ```

4. 命中结果写入 `memory_recalled` 线程事件。
5. 召回结果以 `[scope] summary` 形式拼入 system prompt。

主要实现：

- `shared/apps/desktop/src/main/model-chat-service.ts`
- `shared/apps/desktop/src/main/model-chat-context-service.ts`
- `shared/apps/desktop/src/main/model-chat-prompt-policy.ts`
- `shared/apps/agentd/src/memory-index.js`
- `platforms/windows/apps/agentd/src/runtime.js`

### 2.2 写入阶段

只有回合成功且没有处于等待审批状态时，才进入回合记忆写入：

```mermaid
flowchart TD
    A[成功回合] --> B[rememberExchangeSafely]
    B --> C[rememberExchangeWithShadow]
    C --> D[UserShadow.absorbExchange]
    D --> E[提取规则、事实和交付偏好]
    E --> F{knowledgeStatus}
    F -->|active| G[MemoryIndex.rememberExchange]
    F -->|noticed| H[不写入线程 MemoryRecord]
    F -->|none| H
    G --> I{摘要是否重复}
    I -->|是| J[复用已有记录]
    I -->|否| K[创建 session scope 记录]
    K --> L[超过上限时 prune]
    J --> M[返回 memories]
    L --> M
    H --> M
    M --> N[持久化线程状态]
```

重要分支：

- `knowledgeStatus === "active"` 时才新增线程 `MemoryRecord`。
- `noticed` 或 `none` 不新增线程记忆，但 Shadow 或 companion 文件仍可能更新。
- 用户消息或助手消息为空时不创建记忆。
- 摘要完全重复时复用已有记录。
- `rememberExchangeSafely` 会吞掉记忆写入异常，记忆失败不会阻断当前对话。
- 等待工具审批时不执行本轮记忆写入。

## 3. 多层记忆结构

```mermaid
flowchart TB
    U[用户请求] --> P[System Prompt]

    subgraph ThreadMemory[线程记忆]
        MI[MemoryIndex]
        TS[Thread state memories]
        MI <--> TS
    end

    subgraph ProjectMemory[项目知识]
        US[UserShadow]
        PM[Project Manager Skill references]
        DP[Delivery preferences]
        US --> PM
        US --> DP
    end

    subgraph UserMemory[用户长期信息]
        CM[companion-memory / memory.md]
        UK[本地用户知识缓存]
        SYNC[用户知识同步服务]
        SYNC --> UK
    end

    subgraph OtherMemory[其他独立记忆]
        AM[Shell 审批记忆]
        GM[Windows Growth personal_memory.json]
    end

    MI --> P
    PM --> P
    DP --> P
    CM --> P
    UK --> P
    P --> MODEL[模型与 AgentLoop]

    AM -.不属于对话 MemoryIndex.-> OtherMemory
    GM -.未见并入主聊天 MemoryIndex.-> OtherMemory
```

### 3.1 线程 MemoryIndex

- 作用域：当前线程。
- 运行位置：Agent Runtime 内存。
- 跨重启来源：线程 rollout 中的 `memories[]`。
- 自动写入使用 `session` scope。
- 类型支持 `user`、`workspace`、`session`，但自动回合路径主要使用 `session`。

### 3.2 UserShadow 与项目 PM Skill

用于学习和保存：

- 用户输出规则；
- 项目知识；
- session digest；
- 待学习问题；
- 交付偏好。

主要文件：

- `shared/apps/agentd/src/user-shadow.js`
- `<project>/.newbrain/skills/<project>-project-manager/references/*.md`
- `<project>/.newbrain/skills/<project>-project-manager/references/delivery-preferences.json`

### 3.3 companion-memory

- 保存称呼、城市等用户级长期信息。
- 存储为 `<userSkillRoot>/companion-memory/references/memory.md`。
- 与线程 `MemoryIndex` 独立。
- 通过 Skill 加载进入模型上下文。

主要实现：

- `shared/apps/agentd/src/companion-memory.js`
- `shared/apps/desktop/src/main/model-chat-skill-policy.ts`

### 3.4 用户知识同步

- 设置页提供“立即同步用户知识”操作。
- 每轮对话从本地知识文件读取并注入模型上下文。
- 该链路不经过 `MemoryIndex.search`。

主要实现：

- `shared/apps/desktop/src/main/user-knowledge-sync.ts`
- `shared/apps/desktop/src/renderer/app/SettingsWorkspace.tsx`

### 3.5 审批记忆

`approval-memory.ts` 保存 Shell 命令批准规则，与对话记忆不是同一系统。

## 4. 记忆召回算法

`MemoryIndex.search` 当前采用词项重叠启发式算法：

1. 对最新用户请求生成 query terms。
2. 对记忆摘要进行词项匹配和打分。
3. 只有 `score >= 10` 的记录才会返回。
4. 默认最多返回 5 条。
5. query terms 为空时，按更新时间返回最近记录。

因此当前能力具有以下特点：

- 不需要向量数据库或 embedding 服务；
- 对字面关键词重复较敏感；
- 对同义表达、跨语言表达和抽象语义的召回能力有限；
- 没有发现模型可主动调用的 `memory.search` 或 `memory.get` 工具实现。

## 5. Agent 主逻辑流程

![Agent 主路径](newbrain-agent-flow.svg)

```mermaid
flowchart TB
    subgraph Renderer
        A[Composer Enter]
        B[submitComposerRequest]
        C[askModel]
        D[乐观插入 user 与 assistant stub]
        E[chatWithModel]
        F[接收 stream / reasoning delta]
        G[syncSnapshot]
    end

    subgraph Preload
        H[contextBridge]
        I[model.chat IPC invoke]
        J[streamDelta / reasoningDelta listener]
    end

    subgraph Main[Electron Main]
        K[registerModelChatIpcHandlers]
        L[ModelChatService.chat]
        M[PreparationService.prepare]
        N[TaskService.start]
        O[创建并配置 Runtime]
        P[hydrate memories]
        Q[Shadow 预学习]
        R[召回记忆与构建 Prompt]
        S[ModelChatAgentLoopService.run]
        T[持久化结果]
    end

    subgraph Host[Agent Host 与 Agent Runtime]
        U[agent.loop.start]
        V[agent.loop.advance]
        W[请求模型]
        X[解析 Tool Calls]
        Y{授权决策}
        Z[执行工具]
        AA[等待审批]
        AB[resume approval]
    end

    subgraph Gateway[模型网关]
        AC[callModelApi]
        AD[鉴权与 Auto 路由]
        AE[流式模型响应]
    end

    A --> B --> C --> D --> E
    E --> H --> I --> K --> L
    L --> M --> N --> O --> P --> Q --> R --> S
    S --> U --> V --> W --> AC --> AD --> AE
    AE --> V
    V --> X --> Y
    Y -->|allow| Z --> V
    Y -->|deny| V
    Y -->|ask| AA
    AA --> AB --> V
    V -->|completed| T
    AE -.文本和思考增量.-> J --> F
    T --> G
```

## 6. Agent 结果分支

```mermaid
stateDiagram-v2
    [*] --> Running
    Running --> Completed: 正常完成
    Running --> AwaitingApproval: 工具需要批准
    Running --> Cancelled: 用户停止
    Running --> Failed: 模型、工具或运行时异常

    AwaitingApproval --> Running: 批准或拒绝后恢复
    AwaitingApproval --> Cancelled: 用户取消

    Completed --> PersistSuccess
    PersistSuccess --> RememberExchange
    RememberExchange --> SyncSnapshot

    Cancelled --> PersistCancellation
    Failed --> PersistFailure
    PersistFailure --> OrphanRepair

    SyncSnapshot --> [*]
    PersistCancellation --> [*]
    OrphanRepair --> [*]
```

### 正常完成

1. `persistSuccess`；
2. `rememberExchangeWithShadow`；
3. 更新 `state.memories`；
4. 同步 UI 快照；
5. 如果同一线程存在排队请求，执行下一条。

### 等待审批

- 保留当前 task 和 runtime；
- 写入运行边界事件和审批状态；
- 暂不写入本轮对话记忆；
- 用户批准或拒绝后调用 `resumeAgentApproval` 继续循环。

### 用户取消

- Abort 当前请求；
- 调用 `cancelAgentLoop`；
- 写入 `persistCancellation`；
- Renderer 将请求标记为用户取消。

### 异常

- 调用 `persistFailure`；
- 尝试修复孤立运行状态；
- Renderer 展示失败卡片，并从后续模型上下文排除失败占位内容。

## 7. 持久化地图

| 数据 | 位置 | 作用 |
| --- | --- | --- |
| 线程状态与事件 | `.newbrain/workspaces/<id>/threads/<threadId>.rollout.jsonl` | 保存 messages、memories、events、timeline，是线程恢复的权威来源 |
| 线程目录 | `.newbrain/state_5.sqlite` | 保存 threads 元数据和 `memory_mode` |
| Memory Stage 1 | `.newbrain/memories_1.sqlite` 的 `stage1_outputs` | 保存 raw memory 和 rollout summary |
| 项目知识 | `<project>/.newbrain/skills/<project>-project-manager/references/*` | 保存项目知识、用户规则和交付偏好 |
| Companion 记忆 | `<userSkillRoot>/companion-memory/references/memory.md` | 保存用户级长期信息 |
| Windows Growth 记忆 | `{userData}/growth/personal_memory.json` | Growth Hub 的独立个人记忆 |

需要注意：

- `MemoryIndex` 本身只存在于 Agent 进程内存中。
- rollout 中的 `memories[]` 是线程记忆的跨重启来源。
- `stage1_outputs` 当前可见写入与删除逻辑，但未发现 phase 2 消费 Worker。
- 删除线程时会清理对应 `stage1_outputs`。
- 没有发现编辑或删除单条线程记忆的 API/UI。

## 8. 关键源码索引

### 记忆

- `shared/apps/agentd/src/memory-index.js`
- `shared/apps/agentd/src/user-shadow.js`
- `shared/apps/agentd/src/companion-memory.js`
- `shared/apps/agentd/src/context-capsule.js`
- `shared/apps/desktop/src/main/remember-exchange-safely.ts`
- `shared/apps/desktop/src/main/model-chat-context-service.ts`
- `shared/apps/desktop/src/main/model-chat-success-service.ts`
- `shared/apps/desktop/src/main/model-chat-prompt-policy.ts`
- `shared/apps/desktop/src/main/thread-state-service.ts`
- `shared/apps/desktop/src/main/user-knowledge-sync.ts`
- `platforms/windows/apps/agentd/src/runtime.js`
- `platforms/windows/apps/desktop/src/main/codex-storage.ts`

### Agent 主流程

- `shared/apps/desktop/src/renderer/app/WorkspaceModules.tsx`
- `platforms/windows/apps/desktop/src/renderer/ui.tsx`
- `platforms/windows/apps/desktop/src/preload/index.ts`
- `shared/apps/desktop/src/main/model-chat-ipc.ts`
- `shared/apps/desktop/src/main/model-chat-service.ts`
- `shared/apps/desktop/src/main/model-chat-preparation-service.ts`
- `shared/apps/desktop/src/main/model-chat-task-service.ts`
- `shared/apps/desktop/src/main/model-chat-agent-loop-service.ts`
- `shared/apps/desktop/src/main/model-chat-run-persistence-service.ts`
- `shared/apps/desktop/src/main/agent-host-loop-bridge.ts`
- `shared/apps/desktop/src/main/agent-host-runtime.ts`
- `shared/apps/desktop/src/main/agent-host-entry.ts`
- `platforms/windows/apps/agentd/src/agent-loop.js`

## 9. 当前缺口

1. `memory_mode` 尚未接入真实运行时控制。
2. 没有线程记忆开关和单条记忆编辑、删除 UI。
3. `memory.search`、`memory.get` 仅发现边界名称，未发现完整工具注册和处理器。
4. `stage1_outputs` 未发现 phase 2 消费实现。
5. 自动回合记忆主要写入 `session` scope，`user` 和 `workspace` scope 使用有限。
6. MemoryIndex 依赖字面词项重叠，缺少语义向量召回。
7. Holon、Growth personal memory 与主聊天 MemoryIndex 没有发现自动合并路径。

