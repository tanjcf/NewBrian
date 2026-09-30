# Windows packaging (MSI + NSIS)

在 BRAIN 根目录双击 `package-msi.cmd`，按提示选择环境（test / production）并输入版本号，例如 `1.4.10`。
失败时窗口会保留错误信息；完成后显示 MSI / NSIS 路径。无需自行进入 `.materialized`。

也可以在 BRAIN 根目录的 PowerShell 中运行：

```powershell
.\package-msi.cmd
.\package-msi.cmd -Channel test -Version 1.4.10
.\package-msi.cmd -Channel production -Version 1.4.10
```

兼容入口：`package-test-msi.cmd` 固定走 test 环境，只提示版本号。

版本号必须为三段数字：主版本和次版本不超过 255，修订号不超过 65535。
不输入 `v` 前缀或 `-test` 后缀；测试标识由打包器添加到文件名。
版本号通过 electron-builder 的 `extraMetadata.version` 写入应用与安装包，不修改源文件版本。
升级测试应输入比已安装版本更高的版本号。

## 环境与产物

| 渠道 | 网关 | 预览 | 输出 |
|------|------|------|------|
| test | `http://203.0.113.10:8790/v1` | `http://203.0.113.10:3000` | `.materialized/windows/apps/desktop/release/test/` |
| production | `https://api.sinnauze.cn/v1` | `https://www.sinnauze.cn` | `.materialized/windows/apps/desktop/release/production/` |

**应用内自动更新主路径：NSIS** `NewBrain <版本>-setup[-production-unsigned].exe`。
MSI 仍会一并产出，供企业静默/手动安装；客户端默认按 `package_kind=nsis` 或 `.exe` URL 走「下载 → 就绪 → 重启安装」。

打包成功后会写出 `app-update-spring-<version>.json`（含 SHA-256 与本地路径），把 `download_url` 换成公开地址、填好 `notes` 后即可登记到 Spring `/api/desktop/v1/app-update`。

test / production 无签名证书时自动打未签名包（文件名含 `unsigned`）。
production 还要求干净 Git 工作区（`-AllowUnsigned` 时可放宽）。

## 应用内更新（Cockpit 式）

1. 客户端发现新版本 → 弹窗展示 notes（取消 / 跳过此版本 / 立即更新）。
2. 应用内下载并 SHA-256 校验 → 「已就绪，重启后生效」。
3. 用户点「立即重启」→ 退出后静默跑 NSIS `/S`（或 MSI 静默）→ 再启动。
4. 启动后展示「更新成功」与版本对比。

缺少校验值会停止更新；下载支持断点续传；校验不一致不会安装。
用户目录下的 `.newbrain`、登录配置和项目数据不作为升级清理对象。

### Spring 双包登记（兼容旧 MSI 客户端）

同一 Windows 版本只登记一条发布记录，但可同时落盘 MSI + NSIS：

1. 上传 `*.msi`（draft）
2. 再上传同版本 `*-setup.exe`（不会覆盖 MSI）
3. 管理端列表确认 **MSI ✓ · NSIS ✓**
4. 升 canary → stable

行为约定：

- 旧客户端不发偏好头 → 默认领取 **MSI**（`package_kind=full`）
- 新客户端发 `X-Desktop-Package-Preference: nsis` → 领取 **setup.exe**
- 只传一侧时双方都会回退到仅有的那一侧（要兼容就必须双传）

## 更新安装与数据保留

MSI 使用固定的 UpgradeCode，恢复 MajorUpgrade，并允许相同版本的重新打包覆盖升级。
NSIS 一键安装默认当前用户目录，不删除用户数据。

源代码回归测试：`node --test platforms/windows/apps/desktop/build/msi-project-created.test.cjs`。
更新相关：`node --test platforms/windows/apps/desktop/src/main/desktop-app-update-patch.test.ts`。

发布仍需在 Spring 登记安装包和真实校验值；未登记的本地构建不会自动推送给用户。
test / production 无签名证书时自动打未签名包（文件名含 `unsigned`）。