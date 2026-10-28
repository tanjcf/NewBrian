# 长期标的关注与参考提醒：本地实现

新增 Skill：`shared/apps/desktop/resources/experts/quant-backtest/skills/stock-watch-alerts/`。

通过量化回测专家的 manifest 注册；BRAIN 原生专家目录读取器已确认能列出 `quant-backtest-workflow` 与 `stock-watch-alerts`，支持 quant/data 场景。旧的已启动桌面构建不会自动包含这个新源码目录，需要正常重新构建/更新专家包后在桌面专家中使用。另提供已运行的独立网页管理入口，不依赖重新打包桌面。

## 已实现

- SQLite 保存用户关注列表、A 股/ETF 标的类型、长期备注、规则、渠道和运行状态；重启可恢复。
- 价格大于/小于用户阈值、MA5/MA20 状态交叉；只输出观察、买入参考、卖出参考。
- 定时轮询进程、首次基线、重复行情去重、冷却期、行情新鲜度校验、来源及标的校验。
- 提醒证据、双渠道独立投递状态、暂停、恢复、退订、撤销渠道、失效/反转提醒取消。
- SMTP TLS 邮件发送，兼容原项目 APP_MAIL / SPRING_MAIL 环境变量；短信支持通用网关、阿里云通知模板及百度 SMS v3；有限重试与过期处理。
- 可点击的订阅管理页；用户提供原型响应中新增“长期关注”页签，原文件不变。网页与 CLI 共用同一 SQLite 和规则引擎。
- 监控异常留在 status 中，不生成虚假信号。没有任何订单 API 或交易执行调用。

脚本及真实配置步骤见 Skill 内 `references/operations.md`。单纯安装 Skill 不等于定时进程运行；`run` 需常驻且机器在线，外发还需 `--deliver` 和用户明确启用相应渠道。

## 本地验收（2026-09-21）

- Skill frontmatter 校验通过。
- Python 行为及接口测试覆盖：重启记忆、用户分区、重复/无效/过期行情、并发认领、暂停退订、基线恢复、修改竞态、规则反转、重试次数、ETF 路由、SMTP TLS、短信厂商回执、网页生命周期及跨站请求拦截。最终执行结果见下方记录。
- 本机 HTTP 端到端测试完成“行情 → 条件变化 → SQLite 队列 → 短信网关受理”，仅访问测试服务器 /bars 和 /sms。
- BRAIN 专家目录实际扫描可发现新 Skill；原有专家市场/场景绑定 5 项测试通过。
- 不连接真实账户或券商；不发送真实邮件/短信。SMTP 测试为替身验证，不能声称真实邮件已送达。

## 尚需配置/验收

1. 用户确认的关注代码、规则、频率、邮箱和手机号。
2. 可用的 Spring 行情服务、有效访问身份，以及 ETF 上游支持确认。
3. 已有 SMTP/短信服务的实际运行配置；短信需独立审核的通知模板。服务端数据库加密配置不能从源码直接取得；本机无 APP_MAIL/SPRING_MAIL 相关运行环境变量。
4. 真实服务联调及长期托管运行。当前没有注册 OS 定时任务或启动真实订阅。

已检查 token-system 的 EmailSettingsService、SmsCodeService、SmsProviderManagementService、AliyunSmsProvider、BaiduSmsProvider、ProviderCredentialService。提醒使用独立通知模板，不调用登录验证码发送接口、不改原登录逻辑。配置字段、复用方式及官方接口依据见 Skill 运行说明。当前数据源只观察日线行情，不包含新闻公告抓取与语义分析。

## 交互页面验收

入口：`http://127.0.0.1:8879/`；独立页：`http://127.0.0.1:8879/watch`。本次服务以 `local-user`、`%LOCALAPPDATA%/BRAIN/stock-watch/watch.db` 启动，没有 `--deliver`、没有真实订阅，没有读取登录密码。

浏览器已验证：页面加载、创建暂停的 ETF 测试记录、刷新仍保留、编辑回填、恢复监控、主动检查时明确显示“尚未配置行情服务”、暂停。验收临时记录已清理。修复了表单 reset 按钮名称遮蔽原生 reset() 的问题，并适配窄窗口。原型其他页保留假数据标签；不能据此声称行情联调成功。

启动命令及停止方式见 `references/operations.md`。当前是本地管理和监控运行器，不是已发布的生产服务；真实行情、真实通知、长时间托管及桌面打包尚未验收。

## 最终检查结果

- `python -X utf8 -m unittest discover -s scripts -p 'test_*.py' -v`：28/28 通过（规则引擎 19、通知契约 5、网页接口 4）。
- `node --experimental-strip-types --test shared/apps/desktop/src/main/expert-marketplace.test.ts shared/apps/desktop/src/shared/expert-workspace-policy.test.ts`：5/5 通过。
- `quick_validate.py`：Skill is valid；`node --check assets/watch.js`：通过；`git diff --check`：通过。
- 提交前再次执行上述 33 项测试及 `node scripts/verify-layout.mjs`，全部通过。
- 10 个 Skill 文件通过 UTF-8 无 BOM 检查；原型 HTML 与 ZIP 中原始字节完全一致。
- 浏览器实测只用了显式标注的临时验收记录，未启用外发；当前用户数据库无关注记录。页面已打开并保留。

注意：SQLite 与通知服务不是一个事务。进程在发送后、记录前崩溃可能重发，短信侧应按 event_id 去重。邮件只能提供稳定 Message-ID，无法保证收件端恰好一次。

提交范围仅包含 Skill 实现、网页管理资源、专家注册、测试与运行说明；不包含用户数据库、接收地址、运行日志、发送凭证或解压的教学资料包。
