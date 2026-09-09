# BRAIN 工程落地执行手册

> 产品架构与路线图：[workspace-architecture.md](./workspace-architecture.md)  
> 桌面实现以本仓库 `shared/` + `platforms/*` 为准；公司控制面仍在 spring-app。

## 1. 使用方法

本文回答“具体怎么做”。每个阶段都必须按以下顺序交付：

```text
需求合同
  → 数据迁移
  → 后端接口
  → 前端状态与界面
  → Worker/Rust 能力
  → 自动化测试
  → 灰度开关
  → 监控与回滚
```

不得先堆页面再补数据模型，也不得先把模型接入页面而绕过权限、任务和审计。

本手册的强制边界：

- 公司托管模型与用户私有模型/BYOK 是两条完全分离的密钥链路，不得共用字段、存储或调用 Adapter。
- 公司上游密钥只位于公司服务端，客户端只持有 BRAIN 短期登录凭证，绝不得获取公司密钥。
- 用户可在 BRAIN 设置中添加私有模型和自己购买的 API Key，但密钥只写入本机操作系统安全凭证库，不进入 SQLite、文件或公司服务器。
- spring-app 业务进程也不读取上游密钥；只有独立 AI/Search Gateway 进程能从服务器密钥管理层解析密钥。
- 项目、对话、附件和产物默认仅本地保存，第一阶段不建设云同步。
- 公司服务端可以无状态转发当前模型上下文，但不将提示词、回复和附件写入 MySQL、对象存储或日志。

### 1.1 当前真实实施状态（2026-08-22）

以下内容已经进入 `I:\G盘迁移备份\workrpase\BRAIN` 的本地 `main` 分支，不再是交互原型：

| 能力 | 当前状态 | 代码/验证证据 |
|---|---|---|
| **七场景 L2 聚合验收** | **Windows 10/10 PASS（2026-08-22）** | `test-electron-seven-workspace-l2.mjs`、`pnpm test:seven-workspace-l2`、caseId `BRAIN-SEVEN-WORKSPACE-L2-E2E`；证据 [`docs/evidence/2026-08-22-seven-workspace-l2.md`](../evidence/2026-08-22-seven-workspace-l2.md)、[`2026-08-22-seven-workspace-l2-run.json`](../evidence/2026-08-22-seven-workspace-l2-run.json) |
| 公司密钥隔离 | 已完成第一道客户端边界 | BRAIN `cbe919f`；spring-app `98879f8`，客户端响应不再包含 `gateway_credential` |
| 七工作台本地库 | 已完成 | BRAIN `721a234`，SQLite migration、七工作台、项目、对话、消息、草稿 |
| 所有者隔离 IPC | 已完成 | BRAIN `cd9afe1`，owner 由主进程注入，渲染层不能伪造 |
| 左上工作台切换 | 已完成 | BRAIN `02c2af5`，沿用 BRAIN 线性图标；场景切换过滤左侧目录并切换右侧专业工具 |
| 场景绑定侧栏（Claude Code 目录） | 已完成 | 左侧主目录为 NewBrain `projects-section`（`WorkspaceCatalogItem` 本地文件夹 + 线程）；`brainWorkspaceKey` 场景过滤，缺省归入 `document`；跨场景「最近」；「新对话」绑定当前场景项目；`brain_project` 仅作工具元数据桥 |
| 本地对话闭环 | 已完成基础闭环 | BRAIN `359ed44`，本地消息、模型回复、来源、草稿和重启恢复 |
| 用户私有模型密钥 | Windows 已完成 | BRAIN `f64b058`，只写 OS 保护保险库，配置和界面不回读；macOS/Linux 仍需平台验收 |
| 文件/产物/任务 | 已完成基础数据与面板 | BRAIN `01f126d`，owner 校验、幂等任务、右侧真实资源面板 |
| 本地库恢复 | 已完成 | BRAIN `253bf67`，完整性检查、最近 5 份快照、损坏自动恢复测试 |
| Rust Core | 已完成 Windows 可运行核心，跨平台仍需验收 | `c02fc79`、`1e45226`；协议、路径策略、审批、文件/命令执行、文档 Worker 监管和真实进程测试已实现；macOS/Linux 打包与运行仍待验收 |
| 文档结构化读写/标注 | **L2 已通过（ingest 持久化 + 六格式合同）** | `recordFileIngestResult`、`document-worker-formats.test.ts`、document/PDF E2E 子套件；OCR/版本恢复 UI 仍 Phase 2+ |
| 量化交易工作台 | **L2 已通过（模拟账本守恒 + 网关合同）** | `simulation-ledger.test.ts`、`quant-market-contract.test.ts`、`test-electron-quant-workspace.mjs` |
| 数据工作台 | **L2 已通过** | `test-electron-data-workspace.mjs` caseId `BRAIN-DATA-WORKSPACE-E2E` |
| 软件与自动化工作台 | **L2 已通过（审批 + FAILED 重试）** | `test-electron-flow-workspace.mjs` caseId `BRAIN-FLOW-WORKSPACE-E2E` |
| 游戏制作工作台 | **L2 已通过（资产摘要 + sourceWorkspaceKey + Web 模板）** | `BrainArtifactDto.sourceWorkspaceKey`、`GameWorkspace.tsx`、`test-electron-game-workspace.mjs`、`test-electron-game-template.mjs` |
| 视频/音乐工作台 | **L2+ 已通过（ffprobe + music-media + 结构化 Tab）** | `test-electron-media-workspace.mjs`、`MusicCompositionPanel`、`VideoStoryboardPanel`、托管 FFmpeg 发现/安装 |
| 联网搜索 | 已完成 Spring ↔ BRAIN 免费优先编排 | spring-app `d6e2154`、BRAIN `53ce1d6`；免费新闻、付费兜底、引用校验、策略和审计已实现；真实生产密钥、UI 全链路和故障演练仍待验收 |

已通过的当前门禁：

- BRAIN 本地存储与恢复测试：8/8；新增文档、媒体、Rust、软件、游戏和搜索专项测试，具体以各平台脚本输出为准。
- 私有密钥保险库和模型配置返回边界测试：6/6。
- `pnpm verify:layout`：通过；Windows 下四个 byte-identical E2E mirror 已纳入显式归属白名单，其余 shared/overlay 冲突仍会阻断。
- Windows Electron/Vite 生产构建：通过。

全仓 TypeScript 检查仍存在历史遗留错误和入口文件体积门禁，不能把“生产构建通过”等同于“全仓质量门禁全部通过”。后续阶段必须持续清理，但不得借此回退已经完成的数据与安全边界。

## 2. 代码落点与运行边界

### 2.1 Java 公司服务端

保持当前 Spring Boot 分层，但只承担账号、策略、额度与网关编排，不持久化本地项目正文，不解析上游密钥：

```text
src/main/java/com/demo/tokensystem/
├─ controller/brain/
│  ├─ BrainWorkspaceController.java
│  ├─ BrainCapabilityController.java
│  ├─ BrainAiGatewayController.java
│  └─ BrainUsageController.java
├─ service/brain/
│  ├─ BrainWorkspaceService.java
│  ├─ BrainRoutingService.java
│  ├─ BrainGatewayClient.java
│  ├─ BrainQuotaService.java
│  └─ BrainUsageService.java
├─ mapper/brain/
├─ entity/brain/
├─ dto/brain/
├─ vo/brain/
└─ common/brain/
   ├─ BrainErrorCode.java
   ├─ BrainWorkspaceType.java
   └─ BrainTaskStatus.java
```

规则：

- Controller 只做鉴权、参数校验和协议转换。
- Service 负责业务状态机，不直接拼 SQL。
- Mapper 负责数据库访问。
- Entity 不直接作为接口响应。
- DTO 接收请求，VO 返回页面需要的数据。
- Spring 通过 `BrainGatewayClient` 使用内网服务身份调用独立 AI/Search Gateway，不构造上游 Authorization 头；本地文档与 Rust 调用属于客户端运行层。
- 独立网关内的供应商 Adapter 才可从服务器密钥管理层解析上游密钥，禁止经过响应 DTO、SSE 事件、错误信息或管理接口返回。
- 网关日志在写入前删除 Authorization、Cookie、提示词、回复正文和附件内容。

### 2.2 Vue 前端

```text
frontend/src/
├─ views/
│  └─ BrainWorkspaceView.vue
├─ components/brain/
│  ├─ BrainSidebar.vue
│  ├─ WorkspaceSwitcher.vue
│  ├─ ProjectList.vue
│  ├─ ConversationList.vue
│  ├─ BrainChat.vue
│  ├─ BrainRightPanel.vue
│  ├─ GlobalFilePanel.vue
│  ├─ ArtifactPanel.vue
│  ├─ TaskPanel.vue
│  └─ workspaces/
│     ├─ QuantWorkspace.vue
│     ├─ GameWorkspace.vue
│     ├─ VideoWorkspace.vue
│     ├─ MusicWorkspace.vue
│     ├─ DataWorkspace.vue
│     ├─ SoftwareWorkspace.vue
│     └─ DocumentWorkspace.vue
├─ components/brain/document/
│  ├─ DocumentViewer.vue
│  ├─ AnnotationLayer.vue
│  ├─ AnnotationToolbar.vue
│  └─ ChangeSetReview.vue
└─ utils/brain/
   ├─ brainApi.js
   ├─ brainState.js
   └─ brainEvents.js
```

第一版不引入新的全局状态库也可以，但必须把持久状态和临时界面状态分离：

- 持久状态：当前工作台、当前项目、当前对话、文件、任务。
- 临时状态：菜单开关、面板宽度、画笔工具、当前选区、未发送草稿。

前端的“私有模型”设置允许一次性输入用户自有 API Key，但不得提供查看、回填、复制或导出。公司密钥不得出现在该页面。渲染层只向特权 IPC 提交新值，不存储原值；Rust Core、SQLite、Skill、插件和 MCP 均不得获取密钥。

### 2.3 私有模型凭证代理

```text
Vue 设置页（仅一次性输入）
  → 受限 IPC: privateModelCredential.store
  → BRAIN 桌面宿主
  → Windows Credential Manager / macOS Keychain / Linux Secret Service

发起私有模型请求
  → PrivateModelConnector（受信任本地模块）
  → 即时取得密钥并构造 Authorization
  → 用户配置的 Endpoint
```

特权 IPC 只允许：

- `privateModelCredential.store(profileId, secret)`
- `privateModelCredential.replace(profileId, secret)`
- `privateModelCredential.delete(profileId)`
- `privateModelCredential.status(profileId)`

禁止 `get/read/export/listValues`。`status` 只返回 `configured` 和 `updatedAt`。受信任 Connector 内的原始密钥只在单次请求构造期存在，不进入错误对象、调试日志、网络追踪和崩溃报告。

对于严格零接触模式，增加 `external_proxy` 认证类型：BRAIN 仅记录 Endpoint，API Key 由用户自建的本地代理管理。

### 2.4 桌面本地数据服务

项目与对话不通过公司 Spring API 做 CRUD。客户端建立本地数据服务：

```text
BRAIN 用户数据目录/
├─ brain.db
├─ projects/{project-id}/
│  ├─ source/
│  ├─ artifacts/
│  ├─ annotations/
│  └─ workspace/
├─ cache/
├─ exports/
└─ logs/
```

- SQLite 开启 WAL、foreign keys 和 busy timeout，所有写入经单一数据服务串行化。
- 流式回复边接收边写入本地消息草稿，完成后原子标记，崩溃后可恢复。
- 大文件只存目录，数据库保存相对路径和哈希，禁止存 BLOB。
- 用户原文件默认采用路径引用；只在用户选择“纳入项目”时复制。
- 缓存、日志、预览和中间版本按策略清理，永不自动删除原文件和用户确认的正式产物。
- 跨平台相同的数据模型、Repository 合同和清理策略放入 BRAIN `shared/`；Windows/macOS/Linux 的用户目录、安全凭证库和打包差异放入对应 `platforms/<os>/` 覆盖层。

### 2.5 数据库迁移

公司服务端 MySQL 表结构同时维护在：

- `src/main/resources/init.sql`
- 当前项目使用的幂等迁移服务 `SchemaMaintenanceService`

禁止只改生产数据库而不提交迁移。

本地 SQLite 使用独立的版本化 migration，不复用 MySQL DDL。客户端升级前自动备份 `brain.db`，迁移失败必须回滚并保留旧库。

## 3. 第一批本地 SQLite 表与关键字段

### 3.1 工作台与项目

`brain_workspace`

- `workspace_key`：`quant/game/video/music/data/software/document`
- `display_name`
- `enabled`
- `capabilities_json`
- `default_model_route`
- `sort_order`
- `created_at/updated_at`

`brain_project`

- `id`
- `owner_id`
- `name`
- `primary_workspace_key`
- `status`
- `last_conversation_id`
- `created_at/updated_at/last_opened_at`

`brain_project_workspace`

- `project_id`
- `workspace_key`
- `enabled`
- 唯一键：`project_id + workspace_key`

`brain_private_model_profile`（只存非敏感元数据）

- `id/display_name/provider_type/model_name/endpoint`
- `auth_mode`：`os_vault/external_proxy/none`
- `credential_ref`：不含密钥的本地凭证引用 ID
- `enabled/created_at/updated_at`

该表禁止出现 `api_key/secret/token/authorization` 原值列。

索引至少覆盖：

- `brain_project(owner_id, primary_workspace_key, last_opened_at)`
- `brain_project(owner_id, status, updated_at)`

### 3.2 对话与草稿

`brain_conversation`

- `id/project_id/owner_id/title`
- `workspace_snapshot`
- `status`
- `created_at/updated_at/last_message_at`

`brain_message`

- `conversation_id`
- `role`
- `content`
- `tool_calls_json`
- `source_refs_json`
- `request_id`
- `created_at`

`brain_draft`

- `owner_id/project_id/conversation_id`
- `content`
- `updated_at`
- 唯一键：`owner_id + conversation_id`

切换工作台、项目或窗口关闭前保存草稿；恢复对话时加载草稿。

以上表全部属于客户端 `brain.db`，不在公司 MySQL 建镜像表。

### 3.3 文件、产物和任务

`brain_file`

- `project_id/owner_id`
- `logical_name/mime_type/size_bytes/content_hash`
- `storage_key/version_no`
- `parse_status/validation_status`：`PENDING/PARSING/READY/UNSUPPORTED/CORRUPT/ENCRYPTED/TOO_LARGE/TIMED_OUT`
- `extractor_name/extractor_version`
- `page_slide_sheet_count`
- `extracted_text_size/structure_index_key/preview_manifest_key`
- `created_at`

`brain_file_extract`

- `file_id/file_version`
- `unit_type/unit_index`：页、幻灯片、工作表或文本块
- `plain_text`：有上限的本地提取文本
- `structure_json`：标题、段落、表格、图片、形状、单元格等索引
- `source_anchor_json`
- `content_hash/created_at`

提取结果仅保存在本地。超长文档分页/分块存储，不把全文一次装入内存或模型上下文。

`brain_artifact`

- `project_id/task_id/source_file_id`
- `artifact_type/storage_key/content_hash`
- `validation_status`
- `created_at`

`brain_task`

- `project_id/conversation_id/workspace_key`
- `task_type/status/progress`
- `request_id/idempotency_key`
- `attempt/max_attempts`
- `resource_limits_json`
- `error_code/error_detail`
- `started_at/finished_at/heartbeat_at`

任务状态固定为：

```text
QUEUED → RUNNING → SUCCEEDED
                 → FAILED
                 → CANCELLED
                 → TIMED_OUT
```

### 3.4 文档标记

`brain_annotation`

- `file_id/file_version`
- `page_or_sheet`
- `annotation_type`
- `geometry_json`
- `structural_anchor_json`
- `selected_text`
- `created_by/created_at`

`brain_change_set`

- `annotation_id/task_id`
- `base_file_version/result_file_version`
- `change_summary/diff_json`
- `status`：`PROPOSED/ACCEPTED/REJECTED/REVERTED`
- `created_at/reviewed_at`

## 4. 第一批接口

本地项目接口与公司服务接口必须分开，不得用同一个 Repository 或数据库实现。

### 4.1 客户端本地数据操作

```text
workspace.list / workspace.route
project.list / project.create / project.get / project.update
project.workspace.enable
conversation.list / conversation.create / message.list
draft.save / file.register / artifact.list / task.list
file.parse / file.parseStatus / file.units / file.extract
file.previewManifest / file.annotation.create / file.changeSet.create
```

### 4.2 公司服务接口

```text
GET    /api/brain/capabilities
POST   /api/brain/route
POST   /api/brain/chat/stream
POST   /api/brain/search
GET    /api/brain/usage
```

- 这些接口只接受 BRAIN 短期登录凭证，不接受上游 API Key。
- `/chat/stream` 请求中的当前对话上下文仅用于本次转发，不持久化。
- 响应仅返回能力标识，不返回供应商密钥、真实路由凭证和内部成本底线。

消息接口返回流式事件：

```text
message.started
message.delta
tool.requested
tool.approval_required
tool.running
tool.completed
artifact.created
message.completed
message.failed
```

### 4.3 流式事件

服务端返回上述流式事件，客户端按 `request_id + sequence` 去重并写入本地 SQLite。断线后用最后序号续传；无法续传时，把已收到内容保留为“未完成回复”，不伪造成功状态。

### 4.4 登录凭证与密钥

- Access Token 只留在运行内存，退出后清除。
- 可撤销 Refresh Token 仅保存到操作系统安全凭证库，不写入 `brain.db`、`.env` 或项目目录。
- 公司上游密钥在独立网关信任域中使用密钥引用 ID。管理员配置接口只写不读；管理端仅显示“已配置/未配置”和最后更新时间，不显示尾号、片段或完整值。
- 用户私有密钥只写入本机操作系统凭证库，只能由受信任 `PrivateModelConnector` 在单次私有模型请求内使用，不上传公司服务器。
- Nginx/网关 access log、APM、错误聚合和开发调试日志必须关闭请求/响应 body 采集。

禁止提供 `GET secret`、`export secret`、前端回填密钥或任何通用配置下载能力。可以提供“测试连接”，但必须在对应受信任网关/Connector 内部执行，只返回成功、脱敏错误码和耗时，绝不返回或记录密钥。密钥轮换通过覆盖式只写接口完成，旧密钥由密钥管理层废弃。

## 5. 阶段 0 如何落地

### 开发任务

1. 建立上述 Java 包目录和接口空合同，不先写复杂实现。
2. 建立枚举：工作台类型、任务状态、文件状态、错误码。
3. 为工作台、项目、对话、文件、任务编写本地 SQLite DDL 和幂等迁移。
4. 编写 DTO/VO 和 OpenAPI 示例。
5. 建立前端 `brainApi.js` 和事件类型，不直接散落 `fetch`。
6. 为原型确认的图标、布局和状态编写界面合同测试。
7. 定义 Rust 协议 JSON Schema 或 Protobuf，但此阶段不实现 Rust 业务。
8. 在 Spring 端建立能力路由、额度校验、计量表和 `BrainGatewayClient`；在独立 AI/Search Gateway 信任域建立供应商 Adapter 与密钥解析。
9. 禁止客户端的公司 API Key 字段与读取路径；实现用户私有模型的只写凭证代理，并建立源码、安装包、日志与本地数据库泄漏扫描。

### 测试先行

- 数据迁移重复执行两次不报错。
- 非所有者访问项目返回统一的 `BRAIN_PROJECT_FORBIDDEN`。
- 未知工作台返回 `BRAIN_WORKSPACE_UNSUPPORTED`。
- 枚举序列化与前端类型一致。
- 协议版本不兼容时明确拒绝。
- 断网时项目、对话、文件和草稿仍可读写，仅 AI/联网能力降级。
- 服务端 MySQL、日志和对象存储中均找不到测试提示词、回复和附件正文。
- 对客户端源码、打包产物、网络响应和日志扫描，不存在公司上游密钥，也不存在用户私有密钥的明文泄漏。
- 尝试从 BRAIN 界面、普通 IPC、SQLite、日志、崩溃报告和网络响应读取公司或用户私有密钥，全部必须无读取路径。受信任 `PrivateModelConnector` 只能使用用户私有密钥发起请求，不得返回原值。
- 直接访问独立 AI/Search Gateway 公网端口必须失败；只允许 Spring 服务的内网身份调用。

### 阶段门禁

只有数据库、接口合同、状态机和权限测试全部通过，才能进入阶段 1。

### 阶段 0 的实际开发顺序

1. 先由客户端负责人提交《本地数据与服务边界》合同，把每个字段标记为 `LOCAL_ONLY/TRANSIT_ONLY/SERVER_METADATA`。
2. 实现本地 SQLite migration 和 `ProjectRepository`，用临时用户目录跑创建、关闭、重开、升级、回滚测试。
3. 实现 `ConversationRepository` 和流式草稿落盘，在生成途中强杀客户端，验证重启可恢复。
4. 再实现 Spring `BrainAiGatewayController` 和 `BrainGatewayClient`，由 Spring 使用内网服务身份调用独立 AI/Search Gateway；初期只打通一个管理员配置的低成本模型能力。
5. 加入用户、设备、日/月额度与并发限制，超额返回稳定错误码，不将失败请求无限重试。
6. 最后打通 SSE 流，让客户端本地保存回复，同时执行“密钥不出服务器、正文不落服务端”端到端检查。

阶段 0 建议交付为四个独立合并单元：本地数据层、公司 AI 网关、客户端流式接入、用户私有模型凭证代理。四者分别可回滚，不做一次性大合并。

## 6. 阶段 1 如何落地：七工作台骨架

### 后端

1. 启动时幂等写入七个 `brain_workspace` 基线记录。
2. 实现项目 CRUD、工作台筛选、最近项目和上次对话恢复。
3. 实现对话、消息和草稿在本地 SQLite 的持久化。
4. 实现本地文件引用/纳入项目、元数据、大小限制和格式签名检查，默认不上传公司服务器。
5. 实现任务列表和统一空任务状态。

### 前端

1. 左侧主目录沿用 NewBrain / Claude Code 本地工程目录（`projects-section`：`WorkspaceCatalogItem { id, name, path }` + `threads`），文件树继续对 `path` 做 `workspace.scan`；不用 `brain_project` SQLite 列表替换该目录。
2. 左上工作台切换按 `brainWorkspaceKey` 过滤项目与聊天，并切换右侧专业工具；未绑定历史默认 `document`；不清空未发送草稿。
3. 「新对话」在当前场景选中本地项目下创建 thread（`newThreadScope: "project"`），不创建未绑定全局 chat；「最近」跨场景列出本地项目并可一键切场景。
4. `brain_project` / `localWorkspaceId` 仅桥接场景工具上下文（量化/文档 Worker 等）。
5. 未完成专业模块显示“基础能力可用/专业能力建设中”，不显示假数据。

### 验收脚本

对七个工作台逐一执行：

```text
创建项目
→ 上传一个文件
→ 创建对话并发送消息
→ 生成一个文本产物
→ 切换其他工作台
→ 返回并恢复项目、对话和草稿
→ 重启应用再次恢复
```

## 7. 阶段 2 如何落地：量化交易

### 数据适配

1. 在管理端保存 AKShare/行情源地址、超时和启停状态。
2. Java 通过 Adapter 调用 WireGuard 内网行情节点。
3. 建立统一行情 DTO，禁止页面直接依赖 AKShare 原始字段。
4. 按股票、周期、复权和日期区间缓存，设置交易日失效策略。

### 业务模块

1. 历史行情接口返回 OHLC、成交量、成交额和涨跌幅。
2. 模拟交易使用数据库事务，同时写订单、成交、持仓和资金流水。
3. 回测任务进入 `brain_task`，异步执行并保存输入快照、手续费和滑点。
4. Skill 保存版本，回测结果关联明确的 Skill 版本。
5. 雷达使用幂等触发键，避免同一信号重复通知。

### 搜索

1. 先查免费新闻/公告源。
2. 结果不足或属于开放网络时调用搜索网关。
3. 保存查询时间、来源 URL、标题和摘要哈希。
4. 没有可靠结果时返回明确失败，不让模型补写。

### 验收

- 真实 K 线与数据源抽样一致。
- 买入后现金、持仓和总资产守恒。
- 同一回测快照重复运行结果一致。
- 搜索回答每条时效结论都能定位来源。

## 8. 阶段 3 如何落地：数据、软件与自动化

### 数据与决策

1. CSV/XLSX 上传后创建解析任务。
2. 保存字段、类型、行数和采样数据，不把全表塞入模型上下文。
3. 统计和图表由确定性工具计算，模型只选择和解释。
4. 决策 Flow 先实现开始、工具、条件、审批、结束节点。

### 软件与自动化

1. 文件访问限制在项目根目录。
2. 命令执行必须经过审批、超时和输出上限。
3. 任务日志按块持久化，页面支持断线重连。
4. 自动化运行使用幂等键和租约，防止多实例重复执行。

### 验收

- 十万行测试表不会被一次载入 JVM 或模型。
- 越界路径、危险命令和过期审批被拒绝。
- 断开页面后任务继续，重新打开可恢复日志。

## 9. 阶段 4 如何落地：文档读取、标记与修改

### 9.1 先完成输入读取链路

6 种格式都要实现：图片、PDF、DOCX、PPTX、XLSX、TXT/Markdown。按以下顺序开发：

1. 文件选择器返回本地路径，进行项目边界、扩展名、MIME、magic bytes、大小和可读性检查。
2. 为每种格式实现 `DocumentExtractor` Adapter，输出统一的文本单元、结构对象、来源锚点和预览清单。
3. 将提取结果分页/分块写入 `brain_file_extract`，更新 `brain_file.parse_status`。
4. Viewer 只按当前页、幻灯片、工作表或文本块加载预览，不一次解析全文档。
5. 用户询问文档时，先用本地索引定位相关单元，只把带来源锚点的必要片段发给 AI 网关。
6. 损坏、加密、超限或超时必须显示可理解的失败状态，不将文件名当成文件内容。

### 9.2 各格式提取合同

- 图片：解码图像与方向，按需 OCR，保留归一化坐标。
- PDF：提取每页文本、图片、尺寸和目录；扫描页使用 OCR 文本框与原页坐标双锚点。
- DOCX：读取标题、段落/run、列表、表格单元格、页眉页脚、图片和样式引用。
- PPTX：读取 slide ID、shape ID、文本、图片、表格、备注和层级顺序。
- XLSX：读取 sheet、cell value/type、cell range、合并区域、公式和图表对象；不执行宏和外部链接。
- TXT/Markdown：检测编码，读取文本、标题、列表、代码块和链接，保留行列锚点。

### 9.3 再完成标记与修改链路

1. `AnnotationLayer` 保存归一化坐标和结构锚点。
2. 点击“在对话中引用”生成 annotation ID，不把整页截图重复发送。
3. BRAIN 生成 change set，不直接覆盖文件。
4. Worker 生成新版本并用不同实现的解析器独立解析、渲染验证。
5. 用户接受后更新当前版本，拒绝则保留历史。

### 9.4 Worker 隔离

Office 转换、OCR 和 PDF 渲染运行在独立容器/进程：

- 单任务内存上限
- 总执行时间上限
- 临时目录隔离
- 禁止宏和外部链接执行
- 完成后清理临时文件

### 9.5 验收

- 为每种格式准备真实 fixture，覆盖文字、表格、图片、多页/幻灯片/工作表、中文和空白内容。
- 提取结果必须匹配 fixture 清单中的必须文字、顺序、对象数与页/幻灯片/工作表数。
- 在真实 BRAIN 界面中完成选择文件、附件卡片、读取状态、分页导航、选文引用与重启重开。
- 缩放、翻页、关闭和重启后标记位置不漂移。
- 修改失败不改变当前文件版本。
- DOCX/PPTX/XLSX 的输入可被 BRAIN 读取，输出可被另一套解析器读取。
- PDF 逐页截图不存在空白、截断和乱码。
- 损坏、加密、超大和伪装扩展名 fixture 全部明确失败，不进入模型上下文。

## 10. 阶段 5 如何落地：Rust Core

### 目录

```text
BRAIN/rust/
├─ Cargo.toml
├─ crates/
│  ├─ brain-protocol/
│  ├─ brain-executor/
│  ├─ brain-files/
│  ├─ brain-process/
│  └─ brain-observability/
└─ apps/
   └─ brain-core/
```

### 第一版只做五件事

1. 读取项目白名单内文件。
2. 列举目录并计算增量哈希。
3. 运行审批后的子进程。
4. 支持超时、取消、输出大小限制。
5. 返回结构化状态、错误码和产物列表。

### BRAIN 桌面宿主接入（不是 Spring/Java 接入）

跨平台相同的 TypeScript 协议和调度放在 BRAIN `shared/`，建议新增：

```text
shared/apps/desktop/src/runtime/BrainRuntimeAdapter.ts
shared/apps/desktop/src/runtime/RustBrainRuntimeAdapter.ts
shared/apps/desktop/src/runtime/LegacyBrainRuntimeAdapter.ts
shared/packages/brain-protocol/
```

Windows/macOS/Linux 上 Rust 可执行文件的定位、签名校验、启动参数和进程守护放到对应 `platforms/<os>/`。Spring Boot 工程不增加 `RustBrainRuntimeAdapter`。

功能开关：

```text
brain.runtime.rust.enabled=false
brain.runtime.rust.protocol-version=1
brain.runtime.rust.transport=stdio-jsonl
```

先在 BRAIN 开发版使用影子模式：桌面端原有本地实现正常执行，只把无副作用请求同时发给 Rust 比较结果；一致后才逐项切换。这个影子流量发生在用户本机，不经过 Spring 服务器。

### Rust 安全要求

- 默认拒绝所有路径和命令。
- BRAIN 桌面宿主传入项目根目录、允许操作、审批令牌和资源限制。
- Rust 再次校验路径规范化，禁止符号链接逃逸。
- 不接收数据库密码和模型密钥。
- 每次调用携带 request ID 并写审计日志。
- 进程崩溃由 BRAIN 桌面宿主按限频策略拉起，Rust 不嵌入 Spring JVM，也不部署到 spring-app 服务器。

### 验收

- 路径穿越、符号链接逃逸和过期 Token 全部失败。
- 强杀 Rust Core 后 BRAIN 桌面宿主返回稳定错误且仍能继续对话。
- 取消、超时和输出上限均有自动化测试。
- BRAIN 旧本地实现/禁用降级可通过配置一键恢复，不依赖 Java 后端 fallback。

## 11. 阶段 6 至 8 如何落地

### 视频制作

1. 建立媒体素材和时间线 JSON 合同。
2. 先做脚本、分镜、字幕和预览，后做复杂时间线。
3. 导出进入 Worker 队列，产物完成后由独立播放器验证。
4. Rust Core 只负责启动、限制和取消媒体进程。

### 音乐创作

1. 建立音频素材、版本、曲风、速度和时长模型。
2. 先做歌词、生成、试听和导出。
3. 再加入 MIDI、多音轨、混音和母带。
4. 使用解码器验证输出时长、采样率和声道，不能只看扩展名。

### 游戏制作

1. 建立游戏项目清单和资产依赖表。
2. 第一批交付策划、角色、世界观、关卡和资产引用。
3. 通过辅助工作台调用文档、图片、音乐、视频和代码能力。
4. 每个跨工作台产物保存来源任务、模型和输入版本。
5. 最后增加可运行原型打包和自动测试。

## 12. 发布、灰度和回滚

### 功能开关

每个工作台和专业模块单独开关：

```text
brain.workspace.quant.enabled
brain.workspace.document.enabled
brain.feature.document-annotation.enabled
brain.feature.rust-runtime.enabled
brain.feature.video-export.enabled
```

开关由管理员控制，不写死在前端。

管理员同时维护服务端能力路由，例如 `fast_reasoning/deep_reasoning/code/document/search`。客户端只提交能力标识，不知道密钥，也不需要因为管理员更换百度、DeepSeek 或其他供应商而更新。

### 灰度顺序

```text
开发账号
→ 内部管理员
→ 5% 用户
→ 20% 用户
→ 全量
```

每级观察：错误率、P95延迟、Worker内存、任务失败率、模型成本和用户撤销率。

### 回滚

- 前端保持上一版本静态资源。
- 数据库迁移优先采用向后兼容的加字段/加表方式。
- 新字段发布时先双读，再切换写入，不立即删除旧字段。
- Rust、文档和媒体本地能力均提供 BRAIN 旧实现或禁用降级路径，不要求 Spring 后端接管本地执行。
- 产物版本不可物理覆盖，回滚只切换当前版本指针。

## 13. 每个开发任务的完成标准

一个任务只有同时满足以下条件才算完成：

1. 用户可见行为与交互合同一致。
2. 数据已持久化，重启后可以恢复。
3. 权限和越权测试通过。
4. 成功、失败、超时、取消和重试状态均可见。
5. 有结构化日志、request ID 和稳定错误码。
6. 单元、接口、合同和关键界面测试通过。
7. 构建产物完成，部署步骤可重复。
8. 功能可由管理员灰度启停。
9. 有明确回滚方案并实际演练。
10. 文档、媒体或文件产物经过独立解析和渲染验证。
11. 客户端和安装包无上游密钥，服务端无用户工作正文持久化。
12. 本地数据可导出、导入、备份和崩溃恢复，不依赖云同步。

## 14. 第一轮可直接创建的开发任务

建议立即建立以下任务，不同时开工全部专业编辑器：

1. `BRAIN-001`：存储与密钥威胁模型，固化本地数据/服务控制面边界。
2. `BRAIN-002`：本地 SQLite 迁移框架、项目表、Repository 和 CRUD。
3. `BRAIN-003`：本地对话、消息、流式草稿落盘和崩溃恢复。
4. `BRAIN-004`：文件、产物和任务统一数据模型。
5. `BRAIN-005`：Vue 左侧工作台/项目/对话真实数据接入。
6. `BRAIN-006`：右侧全局面板与专业面板注册机制。
7. `BRAIN-007`：七工作台基础页面与能力开关。
8. `BRAIN-008`：量化行情统一 DTO 和 AKShare Adapter。
9. `BRAIN-009`：模拟账户、订单、成交、持仓和资金流水。
10. `BRAIN-010`：公司 AI 网关、短期登录凭证、管理员能力路由、限额与无正文日志。
11. `BRAIN-011`：公司密钥零客户端暴露、用户私有密钥只写凭证代理、密钥泄漏扫描与服务端正文不落库合同测试。
12. `BRAIN-012`：私有模型 Profile、只写特权 IPC、操作系统凭证库、`PrivateModelConnector` 和外部本地代理模式。
13. `BRAIN-013`：Rust 协议 v1 草案与兼容测试，不实现执行器。

完成 `BRAIN-001` 至 `BRAIN-013` 后，才能认定基础架构已落地；其中 `BRAIN-010`、`BRAIN-011` 和 `BRAIN-012` 是上线阻断项，不得以“后续安全加固”为由跳过。随后集中完成量化交易，不并行建设七套未成熟的专业编辑器。
