# Spring 插件仓库与 NewBrain 联调设计

## 背景与目标

`spring-app` 已提供 Codex 兼容插件目录、签名发布包和按用户/设备记录的安装状态。NewBrain 当前只有内置插件和手工登记的本地 manifest；本设计把现有插件页接入 Spring，并在 Electron 主进程实现可信下载、验证、原子安装、状态回报与恢复。

首要验收方式是不依赖远程 MySQL 的确定性测试：NewBrain 测试启动实现 Spring 真实 HTTP 契约的本地服务器，使用真实 ZIP、Ed25519 和临时文件系统验证完整链路。远程环境在数据库凭据恢复后作为额外运行验收。

## 范围

范围内：公开/个人目录、分类和搜索；详情、manifest、下载和设备对账；SHA-256/Ed25519、ZIP 安全、原子安装升级、启停卸载；typed protocol、窄 preload IPC 和现有插件页面；Spring 契约夹具以及成功、失败、重试、撤销测试。

范围外：NewBrain 发布 Spring 插件；renderer 直接访问网络、令牌或文件系统；默认写入用户 `~/.codex/plugins`；首版二进制差分更新。

## 分层与依赖

依赖方向固定为：`renderer -> typed preload API -> Electron main IPC -> PluginRepositoryService -> HTTP/filesystem/crypto`。

- `packages/protocol` 定义插件目录、清单、安装状态、操作结果、查询输入及 IPC channel，跨边界只传数据。
- `plugin-repository-client.ts` 复用现有认证头，只访问配置的 gateway origin 和固定 API 路径。
- `plugin-package-verifier.ts` 验证响应哈希、Ed25519、manifest 和 ZIP 清单，拒绝绝对路径、`..`、重复路径和超限归档。
- `plugin-installation-service.ts` 串行化同一插件操作，在 NewBrain 用户数据目录暂存并原子激活，维护版本化本地状态。
- preload 只暴露 `list/get/install/setEnabled/remove/reconcile`，不暴露原始 IPC、URL 或路径。
- renderer 复用现有插件页面，数据改为 Spring 返回的公开/个人、分类和安装状态；内置插件作为不可卸载来源合并。

本地数据位于 `<userData>/plugins`：`installed.json`、`packages/<plugin-key>/<version>` 和 `staging/<operation-id>`。状态文件使用现有原子文件工具；升级失败必须保留旧版本。

## 数据流与状态机

启动对账：读取本地状态，取得认证、gateway origin、客户端版本和稳定设备 ID，请求设备插件状态，合并服务端建议与本地事实，处理撤销/升级指令并发布规范化快照。服务端不得把下载推断成安装。

安装状态为 `idle -> downloading -> verifying -> staging -> activating -> reporting -> installed`。激活前失败清理 staging；激活后回报失败保留已安装事实，记录 `installed_pending_report` 并有界重试。相同插件操作串行执行，`operationId` 贯穿请求、日志和回报。

安装步骤：获取 manifest 并检查兼容/撤销；限量下载；验证 ZIP SHA-256、响应头和 manifest 一致；用公钥验 Ed25519；校验 ZIP 路径、数量、单文件与总大小；解压 staging 并验证 `.codex-plugin/plugin.json` 与 `skills/`；原子切换目录和状态；向 Spring 回报。

禁用/启用只原子更新本地状态后回报。卸载先原子移动到垃圾目录，再更新状态与回报，后台清理失败可在启动恢复。重复 operation ID 不重复副作用。

## HTTP 契约

使用 Spring 已有接口：

- `GET /api/desktop/v1/plugins`
- `GET /api/desktop/v1/plugins/{pluginKey}`
- `GET /api/desktop/v1/plugins/{pluginKey}/manifest`
- `GET /api/desktop/v1/plugins/{pluginKey}/download?version=`
- `GET /api/desktop/v1/devices/{deviceId}/plugins`
- `PUT /api/desktop/v1/devices/{deviceId}/plugins/{pluginKey}`

认证复用 `createDesktopAuthHeaders`。仅允许同一 gateway origin 的下载 URL，即便服务端返回绝对 URL 也必须校验。所有外部 JSON 在 Electron main 从 `unknown` 校验。

## 错误、安全与恢复

稳定错误码包括 `PLUGIN_AUTH_REQUIRED`、`PLUGIN_REPOSITORY_UNAVAILABLE`、`PLUGIN_NOT_FOUND`、`PLUGIN_CLIENT_INCOMPATIBLE`、`PLUGIN_RELEASE_REVOKED`、`PLUGIN_DOWNLOAD_TOO_LARGE`、`PLUGIN_HASH_MISMATCH`、`PLUGIN_SIGNATURE_INVALID`、`PLUGIN_ARCHIVE_UNSAFE`、`PLUGIN_MANIFEST_INVALID`、`PLUGIN_ACTIVATION_FAILED`、`PLUGIN_REPORT_PENDING`。

日志只记录 request/operation/device/plugin/version、阶段和脱敏错误，不记录令牌、Cookie、私钥、包内容或完整用户路径。取消在下载/验证阶段清理 staging；原子激活开始后先恢复本地一致性。启动清理过期 staging 并重试 pending report，绝不重复已确认的激活副作用。

## 测试与验收

NewBrain 测试覆盖：认证头、查询编码、非 2xx、无效 JSON、跨 origin、超时/取消；正确签名、哈希/签名错误、路径穿越、重复路径、压缩炸弹和 manifest 缺失；首次/重复安装、升级回滚、启停卸载、状态损坏、恢复与回报重试；IPC 未知输入和 renderer 的公开/个人、分类、搜索、空/错状态。

契约联调启动本地 Node HTTP 服务器，返回由 Spring Controller 契约固定的 JSON，动态生成 Ed25519 与真实 Codex ZIP，记录请求头和状态回报，完整执行查询、安装、升级和撤销。Spring 增加 JSON/头部契约测试，防止 mock 漂移。

质量门禁：NewBrain 相关 Node tests、protocol/desktop typecheck、architecture check 和 production build；Spring 插件专项、完整 Maven、package、Javadoc 和 diff 检查；双方执行 UTF-8、秘密和差异范围检查。真实 MySQL/UI 验收未运行时必须明确报告。

## 实施顺序

1. 固化 protocol 类型与 Spring 契约夹具。
2. TDD 实现 repository client。
3. TDD 实现 verifier 与原子安装服务。
4. 注册 IPC/preload。
5. 接入现有 renderer 插件页。
6. 运行契约服务器端到端测试与双方质量门禁。

## 关键决策

采用真实文件与密码学测试而非只 mock 内部函数；不引入 H2 以避免 MySQL 方言造成错误信心；下载、文件和密钥验证只在 Electron main；使用 NewBrain 独立插件目录；激活成功但回报失败时保留本地事实并重试。
