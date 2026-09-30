<p align="center">
  <a href="README.zh-CN.md"><b>简体中文</b></a>
  &nbsp;·&nbsp;
  English
</p>

<p align="center">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=flat-square&logo=windows&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111111?style=flat-square&logo=apple&logoColor=white">
  <img alt="Ubuntu" src="https://img.shields.io/badge/Ubuntu-x64%20%2F%20arm64-E95420?style=flat-square&logo=ubuntu&logoColor=white">
</p>

<h1 align="center">NewBrian</h1>

<p align="center">
  <b>A free local AI workbench.</b><br>
  Type in the composer and send. That send is one operation.
</p>

<p align="center">
  <a href="https://www.sinnauze.cn/"><img alt="Website" src="https://img.shields.io/badge/Website-sinnauze.cn-111827?style=for-the-badge"></a>
  &nbsp;
  <a href="https://www.sinnauze.cn/app/download"><img alt="Download" src="https://img.shields.io/badge/Download-free%20to%20use-15803d?style=for-the-badge"></a>
</p>

<p align="center">
  <img src="docs/guide/send-chat.png" width="880" alt="Send an operation from the desktop">
</p>

<p align="center">
  <sub>When you are logged in, an official model is handled by spring-app.</sub>
</p>

---

## At a glance

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Free to use</h3>
      The desktop is free to use. Open it, write, and send. The installer is not a separate purchase.
    </td>
    <td width="50%" valign="top">
      <h3>Official models use spring-app</h3>
      After login, an official model is handled by spring-app.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>One key, four tools</h3>
      Set an API key and use that same key in Codex, Claude Code, Cursor, and OpenClaw.
    </td>
    <td width="50%" valign="top">
      <h3>Your model stays local</h3>
      An OpenAI-compatible API that you provide is called directly. The key stays on this computer.
    </td>
  </tr>
</table>

## Basic functions

One desktop does these things. Switching the scene at the top left also switches the project list, the conversation, and the tools on the right.

| Function | What it does |
| --- | --- |
| Send | Type in the composer and send. That send is one operation. |
| Project | One ongoing goal, with files, conversations, outputs, and tasks under it. |
| Right panel | Files, outputs, and tasks stay put. A scene adds its own tools. |
| Official model | After login, spring-app receives the operation and completes it. |
| Your own model | Text chat calls the address you entered. The key stays on this computer. Image, video, and voice stay on official models. |

Before you enter a specialty scene, NewBrian stays in scene exploration: the right side keeps only files, outputs, and tasks.

## Seven scenes

| Scene | What you use it for |
| --- | --- |
| Quant trading | Look up quotes, read candlesticks and volume, run a simulated portfolio, and write research notes. It does not connect to a real broker and does not place real orders. |
| Game production | Manage levels, characters, world building, combat design, and project assets, then try the build. |
| Video production | Write a script, lay out shots, generate a shot, edit its audio and video, then composite and export. |
| Music | Write lyrics, set a style, generate a full piece, arrange tracks, and export audio. |
| Data and decisions | Import CSV or Excel, read the table, summarize, chart, and write the conclusion. |
| Software and automation | Read project files, change code, run an approved terminal, test, deploy, and arrange an automation flow. |
| Document writing | Write a document, review annotations, outline, build slides, and export. |

## Set an API key

A spring-app user can set an API key and use that same key in these tools:

<p align="center">
  <img alt="Codex" src="https://img.shields.io/badge/Codex-111827?style=for-the-badge">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-111827?style=for-the-badge">
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-111827?style=for-the-badge">
  <img alt="OpenClaw" src="https://img.shields.io/badge/OpenClaw-111827?style=for-the-badge">
</p>

## Use your own model

Official models do not need your own key. To call an OpenAI-compatible API that you provide:

1. Click the model button at the right of the composer, for example `Auto·均衡 中`.
2. Open the model list and click **＋ 添加自备模型**.
3. Enter a display name, Base URL, API Key, and model ID, then save.
4. Select the row marked 自备. Later text chats call that address directly. The key stays on this computer.

Image, video, and voice stay on official models.

<p align="center">
  <img src="docs/guide/custom-model.png" width="420" alt="Add your own model">
</p>

## Later: quota for models outside China

> Foreign models will be added later. Watching an advertisement grants account credit, and that credit can be spent as quota on those models. This is not open yet. Today you can add your own model, or use an official model after login.

## Package from source

The `rust/brain-core` source is not in this repository. Before packaging, set the official binary url and sha256 in `rust-core-release.json`. The script downloads that binary and checks the hash. A mismatch stops the build.

Install dependencies:

```bash
pnpm install
```

| System | Command |
| --- | --- |
| Windows | `pnpm package:windows:production` |
| macOS Apple Silicon | `pnpm package:macos-arm64` |
| macOS Intel | `pnpm package:macos-x64` |
| Ubuntu x64 | `pnpm package:ubuntu-x64` |
| Ubuntu arm64 | `pnpm package:ubuntu-arm64` |

Each command materializes that platform, downloads the official brain-core binary, and builds the installer. The public source is MIT. The brain-core program may be redistributed only unchanged, inside the installer.
