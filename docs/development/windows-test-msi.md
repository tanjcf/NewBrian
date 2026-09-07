# Windows MSI packaging

在 BRAIN 根目录双击 `package-msi.cmd`，按提示选择环境（test / production）并输入版本号，例如 `1.4.4`。
失败时窗口会保留错误信息；完成后显示 MSI 路径。无需自行进入 `.materialized`。

也可以在 BRAIN 根目录的 PowerShell 中运行：

```powershell
.\package-msi.cmd
.\package-msi.cmd -Channel test -Version 1.4.4
.\package-msi.cmd -Channel production -Version 1.4.4
```

兼容入口：`package-test-msi.cmd` 固定走 test 环境，只提示版本号。

版本号必须为三段数字：主版本和次版本不超过 255，修订号不超过 65535。
不输入 `v` 前缀或 `-test` 后缀；测试标识由打包器添加到文件名。
版本号通过 electron-builder 的 `extraMetadata.version` 写入应用与 MSI，不修改源文件版本。
升级测试应输入比已安装版本更高的版本号。

## 环境与产物

| 渠道 | 网关 | 预览 | 输出 |
|------|------|------|------|
| test | `http://120.48.151.202:8790/v1` | `http://120.48.151.202:3000` | `.materialized/windows/apps/desktop/release/test/` |
| production | `https://api.sinnauze.cn/v1` | `https://api.sinnauze.cn` | `.materialized/windows/apps/desktop/release/production/` |

test 产物：`codeCN <版本号>-test-unsigned.msi`（默认不签名）。
production 有签名证书时产出已签名 MSI；本机未配置 `CSC_LINK` / `WINDOWS_CSC_LINK` 时自动打未签名包：
`codeCN <版本号>-production-unsigned.msi`。正式发布仍需配置 Authenticode。
production 还要求干净 Git 工作区。

此入口会覆盖本次打包进程继承的对应环境地址变量，退出后恢复。
现有打包器写入无凭据的远程配置，替换编译产物中的本地业务网关默认值，
并检查 `app.asar` 主程序不得残留 `127.0.0.1:8790` 或 `localhost:8790`。
Electron 的本地 IPC、文件预览等本机机制不属于 Spring 接口。

需要已安装 Node.js、pnpm、Rust/Cargo 及 Windows Rust 编译工具链。
脚本依次验证仓库分层、生成 Windows 工作区、按锁文件安装依赖、编译 Rust 和桌面程序，最后制作 MSI。
依赖和构建失败会终止，不跳过构建或使用旧的 `out` 目录冒充新包。
首次运行需要下载依赖与打包工具。脚本只打包，不自动安装，也不停止正在运行的应用。

安装后若人为配置了其他网关或保留旧的用户自定义配置，仍需核对实际生效配置。

## 更新安装与数据保留

MSI 使用固定的 UpgradeCode，恢复 MajorUpgrade，并允许相同版本的重新打包覆盖升级。
旧产品在新文件写入前由 Windows Installer 移除注册，保留事务回滚；不再先手动删除安装目录。
默认从当前用户的 CODECN_HOME 注册表记录继承原安装路径，避免安装目录内的聊天产物被切换到新目录。
用户目录下的 `.codecn`、桌面登录配置和项目数据不作为升级清理对象。
历史安装包通过 `UPGRADINGPRODUCTCODE` 区分升级卸载和普通卸载，因此不要先手动卸载旧版本。

源代码回归测试：`node --test platforms/windows/apps/desktop/build/msi-project-created.test.cjs`。
若历史 MSI 缓存缺失，Windows Installer 可能要求原安装源或终止升级；不要通过删除卸载注册表记录绕过。
完整验收需要比较升级前后的聊天、项目、登录状态和安装记录；源码测试不代表已通过真实升级验收。

## 应用内更新

现有更新入口继续从 Spring 的发布信息读取版本、下载地址和 SHA-256。
缺少校验值会停止更新；下载支持断点续传，校验不一致不会运行安装器。
完整 MSI 的后台更新流程在 Electron 退出后执行：

1. 检查 MSI 的产品家族、发布版本与 MajorUpgrade 规则。
2. 复制用户数据和安装目录下的聊天产物，备份失败则停止。
3. 保持当前安装目录和范围，运行 MSI 并记录安装日志。
4. 仅将 0 / 3010 视为成功，记录结果后重新启动应用；失败提示包含备份路径。

备份保存在 `%APPDATA%/codecn-update-backups/<本次更新编号>/`，不自动删除。
更新下载目录不参与备份。结果在桌面用户配置目录的 `updates/last-msi-update.json`，
详细安装日志在备份目录的 `install.log`。
应用退出前显示的是“即将退出并更新”，不再把后台进程启动当作安装完成。

发布仍需在 Spring 登记修复后的安装包和真实校验值；未登记的本地构建不会自动推送给用户。
现有差量补丁通道保留，但差量失败自动改用完整包、签名信任链，以及真实旧版到新版的数据验收仍需单独完成。
