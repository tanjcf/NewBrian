# NewBrian

[English](README.en.md)

官网：<https://www.sinnauze.cn/>

安装包下载：<https://www.sinnauze.cn/app/download>

NewBrian 桌面可以免费使用。在输入框写下内容并发送，就是一次操作。登录后的官方模型由 spring-app 接收并完成这次操作。

![在桌面发送一次操作](docs/guide/send-chat.png)

## 配置自备大模型

官方模型不用自己填钥匙。要改用自己的 OpenAI 兼容接口：

1. 点输入框右侧的模型按钮，例如 `Auto·均衡 中`。
2. 打开模型列表，点 **＋ 添加自备模型**。
3. 填写显示名、Base URL、API Key、模型 ID，然后保存。
4. 选中带「自备」的那一行。之后的文字对话会直接请求这个地址，钥匙只留在本机。

图片、视频和语音仍使用官方模型。

![添加自备模型](docs/guide/custom-model.png)

## 打包

`rust/brain-core` 源码不在这个仓库里。打包前在 `rust-core-release.json` 填好官方程序的 url 和 sha256。脚本会下载并核对，不一致就停止。

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
