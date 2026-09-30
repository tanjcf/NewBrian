# NewBrian

[中文](README.zh-CN.md)

Website: <https://www.sinnauze.cn/>

Downloads: <https://www.sinnauze.cn/app/download>

NewBrian is a desktop app you can install and use. This public repository can build packages for macOS, Windows, and Ubuntu. The `rust/brain-core` source is not included. Before packaging, set the official binary url and sha256 in `rust-core-release.json`. The script downloads that binary and checks the hash. A mismatch stops the build, and the installer is not produced without the core.

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
