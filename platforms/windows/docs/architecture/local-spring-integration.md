# NewBrain + spring-app 本地联调

## 边界

- `spring-app` 提供账号认证、订阅、模型网关、用量和在线 Skill 控制面。
- NewBrain 保留 Shell、文件系统、Git、Patch、审批、rollout、SQLite 和子 Agent 的本地执行权。
- NewBrain 登录成功后调用 `/api/desktop/v1/bootstrap`、`model-config` 和 `capabilities`。
- 同步结果写入 `windows/.newbrain/desktop-control-plane.json`，不写入访问令牌或刷新令牌。

## 启动

从 NewBrain 仓库根目录运行：

```powershell
.\start-local-integration.ps1
```

脚本会在需要时构建 `G:\workrpase\spring-app`，将服务绑定到
`203.0.113.10:8790`，健康检查通过后，以
`NEWBRAIN_MODEL_BASE_URL=http://203.0.113.10:8790/v1` 启动 NewBrain。

只启动并检查 spring-app：

```powershell
.\start-local-integration.ps1 -SkipDesktop
```

## 验证点

1. `GET /api/health` 返回 HTTP 200。
2. 未认证访问 `/api/desktop/v1/bootstrap` 返回 HTTP 401。
3. 已登录 NewBrain 生成 `desktop-control-plane.json`，其中协议为 `1.0`。
4. 控制面同步状态不包含 `Authorization`、`access_token` 或 `refresh_token`。
5. NewBrain 模型请求发送到本地 `/v1/responses`，再由 spring-app 选择上游路由。

上游模型返回 5xx 时，本地链路仍可通过 spring-app 的
`logs/v1_responses.request.log` 和 `logs/v1_responses.response.log` 定位；这类响应不应改写为本地认证失败。
