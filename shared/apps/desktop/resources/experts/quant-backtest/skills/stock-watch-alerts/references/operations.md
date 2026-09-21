# 运行与通知配置

本 Skill 第一版面向 A 股股票和 ETF，日线参考监控。不是实时逐笔行情，也不提供自动新闻/公告分析。均线规则沿用项目 MA5/MA20 比较思路，增加“上一次有效观察不成立、本次成立”的状态变化检查；不调用现有模拟交易模块。

## 配置文件

将以下内容保存到仓库之外的用户私有目录，如 `runtime/stock-watch/config.json`。不要把真实收件人、密码、访问令牌加入 Git。

```json
{
  "market": {
    "url": "https://YOUR-BRAIN-SERVER/api/desktop/v1/market-bars",
    "headers_env": {"Authorization": "BRAIN_WATCH_AUTHORIZATION"},
    "use_proxy": false
  },
  "smtp": {
    "host": "smtp.example.com",
    "port": 465,
    "security": "ssl",
    "from": "sender@example.com",
    "username": "sender@example.com",
    "password_env": "BRAIN_WATCH_SMTP_PASSWORD"
  },
  "sms": {
    "url": "https://YOUR-NOTIFICATION-GATEWAY/sms",
    "headers_env": {"Authorization": "BRAIN_WATCH_SMS_AUTHORIZATION"}
  }
}
```

`BRAIN_WATCH_AUTHORIZATION` 是完整的认证头值，如 `Bearer …`。凭证仅从进程环境读取；不是之前对话里的登录密码。额外的桌面设备请求头也可用 `headers_env` 映射到环境变量。凭证过期显示监控失败，须更新凭证并重启进程，不自动冒充登录。

默认要求 HTTPS；本机回环 HTTP 用于开发验证。可信 VPN 内网若只有 HTTP，必须在相应配置对象显式设置 `allow_insecure_http: true`，但传输不加密。禁止 HTTP 重定向，以免认证头流向不同目的地。没有更改系统代理、VPN 或安全设置。

行情使用项目已有请求契约：POST，字段 `symbol,interval,startDate,endDate,adjustment`；响应为 `{"ok":true,"data":{"bars":[...]}}`。每个 bar 至少有匹配的 `symbol`、带时区的 `timestamp`、正数 `close` 和 `source.provider`。数据应来自已收盘日线，提供方可用 `closed:false` 排除未收盘 K 线。脚本不会凭股票代码猜测数据真伪或补造缺失数据。

ETF 可配置独立 `market_etf` 对象，字段与 market 相同；未配置时走共同的行情服务。当前仓库 Spring 只转发行情请求，本次没有验证其上游 AKShare 节点是否支持 ETF，故 ETF 的真实行情仍需用实际服务验收。数据源须保证复权口径一致；公司行为导致历史复权变化也可能改变信号。

SMTP 支持 SSL/TLS 465 或 STARTTLS 587，不允许明文模式。密码应是服务商要求的授权码/应用密码。

短信支持通用网关和阿里云/百度两种直接适配。通用网关契约：POST `{to,message,event_id}`，发送 `Idempotency-Key` 头；网关返回 `{"accepted":true}` 表示受理。运营方须把网关对接短信服务及审核通过的通知模板，按 event_id 去重。不要向不符合该契约的厂商 URL 直接发送通用网关请求。

## 复用现有登录通知服务

已检查同目录下的 token-system 源码：

| 能力 | 源码位置（token-system 仓库内） | 复用边界 |
|---|---|---|
| 邮件 | `src/main/java/com/demo/tokensystem/service/EmailSettingsService.java` | SMTP，可来自后台路由设置或 Spring 环境 |
| 验证码 | `service/SmsCodeService.java`、`service/SmsProviderManagementService.java`（同 Java 包） | 验证码生成和频控专用于登录，提醒不调用这些入口 |
| 阿里云短信 | `provider/sms/AliyunSmsProvider.java` | 同一服务商/授权凭证可用于独立通知模板 |
| 百度短信 | `provider/sms/BaiduSmsProvider.java` | 提醒适配采用官方 v3 API；未修改原 OTP 实现 |
| 密钥存储 | `service/ProviderCredentialService.java` | 服务端数据库加密，源码不包含当前实际密钥 |

SMTP 可配置 `"smtp":{"reuse_project_mail_env":true}`，继承当前进程的 `APP_MAIL_HOST/PORT/USERNAME/PASSWORD` 或对应 `SPRING_MAIL_*` 变量。TLS 开关使用 `APP_MAIL_SMTP_SSL_ENABLE` 或 `APP_MAIL_SMTP_STARTTLS_ENABLE`（也支持原 Spring 对应变量）；没有 TLS 明确配置会拒绝发送。发件人优先 `APP_AUTH_LOGIN_CODE_FROM`、`APP_MAIL_FROM`，其次用户名。显式 smtp 字段优先于继承值。

这是环境配置兼容，不会自动读取另一台服务器的数据库/环境，不会解密或将后台密钥下发到网页。若实际配置只存于服务端，可把监控部署在服务端并由运营方注入环境，或接入内部通知网关。本机检查未发现上述邮件环境变量。

阿里云 sms 配置示例（替换主配置中的 sms 对象）：

```json
{
  "provider":"aliyun-sms",
  "access_key_env":"BRAIN_WATCH_SMS_AK",
  "access_secret_env":"BRAIN_WATCH_SMS_SK",
  "sign_name":"审核通过的签名",
  "notification_template_code":"审核通过的通知模板 ID",
  "notification_template_confirmed":true
}
```

百度使用 `provider: "baidu-sms"`、`access_key_env`、`secret_key_env`、`signature`（审核签名 ID）、`region`（默认 bj），以及相同的 notification_template 字段。请求采用 BCE v1 签名及 `/api/v3/sendSms`，同时检查整个请求和单号码受理结果。官方依据：[短信下发](https://cloud.baidu.com/doc/SMS/s/lkijy5wvf)、[认证字符串](https://cloud.baidu.com/doc/Reference/s/njwvz1yfu)。原有 Java 百度验证码适配使用另一套 OAuth/form 路径，不能据此声称本次通知已与线上验证兼容。

默认模板变量为 `symbol,action,price,time,rule,source,event_id`，可通过 `template_variables`（模板变量名 → 上述字段名）改名，但不能遗漏这些上下文。模板固定文本必须包含“仅供参考，不执行交易”；`notification_template_confirmed` 表示运营方已确认这一点及模板已获服务商批准。不能直接复用只有 `code` 的登录验证码模板。模板长度和变量约束须由真实服务商联调确认。

阿里云 OutId 仅用于追踪，不能当作去重承诺；百度 clientToken 官方去重窗口仅 3 分钟，超出窗口或发送后崩溃仍可能重发。需要更强去重时使用持久化通知网关。所有适配测试只验证本地请求与回执契约，尚未发送真实通知。

## 网页管理与用户提供的原型

在本 Skill 目录运行：

```powershell
python -X utf8 scripts/web.py --db "$env:LOCALAPPDATA/BRAIN/stock-watch/watch.db" --user local-user --port 8879 --prototype 'C:/path/to/brain-quant-workspace-v1.html'
```

打开 `http://127.0.0.1:8879/` 为整合原型，`/watch` 为独立管理页，`/original` 查看未改动的原型。不带 `--prototype` 时首页直接显示管理页。`--config` 与 CLI 使用同一 JSON 配置；只有显式加入 `--deliver` 才外发。

示例中的 HTML 路径需替换为资料包解压后的实际位置；资料包不是运行依赖，未提供原型时也能完整使用独立关注管理页。

可以真实保存、编辑、暂停、恢复、退订、保存接收设置，查看错误与提醒证据。页面自动刷新运行结果，每次“检查到期订阅”遵守每个订阅的最短间隔。数据存于指定 SQLite，不存于原型 localStorage。服务端只暴露指定页面和管理 API，检查 Host、Origin 和 CSRF，配置/数据库不作为静态文件公开；这仍是本机单用户工具，不是远程认证系统。

原型来自用户 `intern-a-quant-pack.zip`，8 个文件保存在本地 `preview/intern-a-quant-pack`。通过响应时注入页签接入，原 HTML 字节保持不变；原型的教学要求作为参考资料，不作为自动交易或提交 Git 的授权。其他页仍是演示，不会提供真实交易或真实行情。关掉网页不会停止 Python 进程；暂停全部订阅或停止该进程才能停止监控。服务重启后订阅保留。

## 订阅与长期记忆

在本 Skill 目录运行；下例用户 `local-user` 仅是本地隔离标识，数据库必须由所属操作系统用户独占。脚本不是身份认证服务，不能直接开放给不可信的多用户请求。

PowerShell 可设置固定参数，避免误用不同数据库：

```powershell
$watchScript = '.\scripts\watch.py'
$watchArgs = @('--db', 'C:\your-private-dir\watch.db', '--user', 'local-user', '--config', 'C:\your-private-dir\config.json')
python $watchScript @watchArgs check
```

`check` 只检查配置和所需行情请求头环境变量，不发起连接；`poll` 才请求行情。`status` 查看每个订阅的 `error,checked_at,next_poll,last_bar`；`alerts` 查看触发证据及投递状态。首次读到行情成功不等于短信/邮件可达。

以下是规则结构示例，数值只是格式示范，不能直接当作投资建议或替用户启用：

```json
{
  "id": "watch-600519",
  "symbol": "600519",
  "asset_type": "stock",
  "label": "贵州茅台",
  "notes": "长期关注；仅接收用户确认规则的参考提醒",
  "enabled": false,
  "channels": ["email", "sms"],
  "interval_seconds": 900,
  "max_age_hours": 96,
  "cooldown_seconds": 3600,
  "rules": [
    {"id": "ma-up", "type": "ma_cross_up", "action": "buy_reference"},
    {"id": "ma-down", "type": "ma_cross_down", "action": "sell_reference"}
  ]
}
```

价格规则为 `{"id":"low","type":"price_below","value":100,"action":"observe"}` 或 `price_above`。同样需用户给出阈值。支持 6 位证券代码及可选 `.SH/.SZ/.BJ` 后缀，返回标的必须与请求精确匹配；ETF 使用 `asset_type: "etf"`。`notes` 保存关注原因等长期偏好。

```powershell
python $watchScript @watchArgs subscribe --file 'C:\your-private-dir\subscription.json'
python $watchScript @watchArgs list
python $watchScript @watchArgs resume watch-600519
python $watchScript @watchArgs poll
python $watchScript @watchArgs status
python $watchScript @watchArgs alerts
```

`subscribe` 对同一用户、同一 id 进行覆盖更新，重建基线并取消待发提醒；应先读取旧记录再修改。首次有效行情不提醒，后续新日线条件从 false 变 true 才产生提醒。价格比较为严格大于/小于；均线是 MA5 与 MA20 大小关系的观察状态变化，不保证捕捉监控停机期间的每一次交叉。冷却期内的变化不补发；明确让用户选择频率和冷却时间。

96 小时为默认最大行情年龄，不是交易日历；周末一般可覆盖，长假可能标记 STALE_MARKET_DATA 并停止提示。可调到最多 168 小时；节假日处理不能伪装成最新行情。重启不回填停机期间所有历史事件，针对最新有效观察判定。

## 投递与持续运行

只有用户明确确认这两个收件目的地后，才执行：

```powershell
python $watchScript @watchArgs profile --email 'user@example.com' --sms '+8613800000000' --enable-email --enable-sms
python $watchScript @watchArgs run --deliver
```

不带 `--deliver` 的 `run` 只监控并保存提醒，绝不外发。`poll` 不外发，`dispatch --deliver` 单独处理队列。渠道可独立成功/失败，不会因短信失败重发已受理邮件。SMTP/网关“accepted”只表示服务受理，不是收件人实际收到。

进程每 10 秒检查到期订阅，每个订阅最短 60 秒查询一次；默认 15 分钟轮询日线。启动后的用户级后台部署方式由运行环境决定：可用 Windows 任务计划或服务器服务管理器运行相同命令，但本次没有注册系统计划任务。需要机器在线、进程持续运行和有效凭证。Ctrl+C 停止前台进程，重新执行恢复数据库中的订阅。

```powershell
python $watchScript @watchArgs pause watch-600519
python $watchScript @watchArgs resume watch-600519
python $watchScript @watchArgs unsubscribe watch-600519
python $watchScript @watchArgs profile --disable-email --disable-sms
```

暂停、退订、修改规则或修改接收资料会取消待发提醒，已被外部服务受理的消息不能撤回。退订保留历史审计记录，不再抓取该标的。修改 profile 保守取消该用户全部待发记录，避免向新收件人泄露旧消息。

投递失败最多尝试 3 次，间隔 60/120 秒；6 小时后提醒过期，不发过时信号。行情错误时暂缓该订阅投递。条件反转会取消失效的待发提醒。数据库事务防止两个本地工作进程重复认领；外部投递与 SQLite 不是分布式原子事务，崩溃在“已发出、未提交”之间可能重发。短信网关必须用幂等键处理，邮件 Message-ID 只能辅助去重，不能承诺恰好一次送达。

## 验证

```powershell
python -m unittest discover -s scripts -p 'test_*.py' -v
```

测试使用临时数据库和模拟行情/通知，不会向真实邮箱或手机发信。真实上线还需要有效行情身份、支持股票/ETF 的服务，以及已配置的 SMTP 和短信网关；用户确认首批标的及规则后才应启动真实监控。
