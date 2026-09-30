# NewBrian

[中文](README.zh-CN.md)

Website: <https://www.sinnauze.cn/>

Downloads: <https://www.sinnauze.cn/app/download>

The NewBrian desktop is free to use. Type in the composer and send. That send is one operation. When you are logged in, an official model is handled by spring-app.

![Send an operation from the desktop](docs/guide/send-chat.png)

## Use your own model

Official models do not need your own key. To call an OpenAI-compatible API that you provide:

1. Click the model button at the right of the composer, for example `Auto·均衡 中`.
2. Open the model list and click **＋ 添加自备模型**.
3. Enter a display name, Base URL, API Key, and model ID, then save.
4. Select the row marked 自备. Later text chats call that address directly. The key stays on this computer.

Image, video, and voice stay on official models.

![Add your own model](docs/guide/custom-model.png)

## Package

The `rust/brain-core` source is not in this repository. Before packaging, set the official binary url and sha256 in `rust-core-release.json`. The script downloads that binary and checks the hash. A mismatch stops the build.

Install dependencies:

```bash
pnpm install
```

Windows:

```powershell
pnpm package:windows:production
```

macOS Apple Silicon:

```bash
pnpm package:macos-arm64
```

macOS Intel:

```bash
pnpm package:macos-x64
```

Ubuntu x64:

```bash
pnpm package:ubuntu-x64
```

Ubuntu arm64:

```bash
pnpm package:ubuntu-arm64
```

Each command materializes that platform, downloads the official brain-core binary, and builds the installer. The public source is MIT. The brain-core program may be redistributed only unchanged, inside the installer.
