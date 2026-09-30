# NewBrian

[English](README.en.md)

官网：<https://www.sinnauze.cn/>

安装包下载：<https://www.sinnauze.cn/app/download>

NewBrian 是可以安装使用的桌面程序。这个公开仓库可以在 macOS、Windows 和 Ubuntu 上打包。`rust/brain-core` 源码不在这里。打包前在 `rust-core-release.json` 填好官方程序的 url 和 sha256。脚本会下载并核对，不一致就停止，也不会打出没有核心的安装包。

先安装依赖：

```bash
pnpm install
```

Windows：

```powershell
pnpm package:windows:production
```

macOS Apple Silicon：

```bash
pnpm package:macos-arm64
```

macOS Intel：

```bash
pnpm package:macos-x64
```

Ubuntu x64：

```bash
pnpm package:ubuntu-x64
```

Ubuntu arm64：

```bash
pnpm package:ubuntu-arm64
```

这些命令会生成对应系统的工程，下载官方 brain-core，再打安装包。公开源码使用 MIT 许可。brain-core 程序只允许原样随安装包分发。
