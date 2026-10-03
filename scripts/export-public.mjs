import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".materialized", "release", "target", "tmp", "dist", "out", "coverage"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".ps1", ".yml", ".yaml", ".html", ".css", ".txt", ".toml", ".xml", ".svg"]);
const FORBIDDEN_TEXT = ["203.0.113.10", "203.0.113.11", "example.invalid"];
const REAL_PRIVATE_KEY = /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----[\t\r\n ]*[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |OPENSSH )?PRIVATE KEY-----/u;

export function scrubPublicText(text) {
  return String(text)
    .replaceAll("203.0.113.10", "203.0.113.10")
    .replaceAll("203.0.113.11", "203.0.113.11")
    .replaceAll("example.invalid", "example.invalid");
}

export function isDeniedPublicPath(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized === ".") return false;
  const parts = normalized.split("/");
  if (parts.some((part) => SKIP_DIRECTORIES.has(part))) return true;
  if (normalized === "rust" || normalized.startsWith("rust/")) return true;
  if (normalized.includes("resources/experts")) return true;
  if (normalized.includes("build/plugins/figma")) return true;
  if (normalized.includes("tutorial-screenshots") || normalized.includes("tutorial-videos")) return true;
  const base = parts.at(-1) || "";
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|pfx|p12)$/iu.test(base)) return true;
  return false;
}

const PUBLIC_README_ZH = "<p align=\"center\">\n  <a href=\"README.en.md\"><b>English</b></a>\n  &nbsp;·&nbsp;\n  简体中文\n</p>\n\n<p align=\"center\">\n  <img alt=\"MIT\" src=\"https://img.shields.io/badge/license-MIT-111827?style=flat-square\">\n  <img alt=\"Windows\" src=\"https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=flat-square&logo=windows&logoColor=white\">\n  <img alt=\"macOS\" src=\"https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111111?style=flat-square&logo=apple&logoColor=white\">\n  <img alt=\"Ubuntu\" src=\"https://img.shields.io/badge/Ubuntu-x64%20%2F%20arm64-E95420?style=flat-square&logo=ubuntu&logoColor=white\">\n</p>\n\n<h1 align=\"center\">NewBrian</h1>\n\n<p align=\"center\">\n  <b>免费的本地 AI 工作台。</b><br>\n  在输入框写下内容并发送，就是一次操作。\n</p>\n\n<p align=\"center\">\n  <a href=\"https://www.sinnauze.cn/\"><img alt=\"官网\" src=\"https://img.shields.io/badge/%E5%AE%98%E7%BD%91-sinnauze.cn-111827?style=for-the-badge\"></a>\n  &nbsp;\n  <a href=\"https://www.sinnauze.cn/app/download\"><img alt=\"下载安装包\" src=\"https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD%E5%AE%89%E8%A3%85%E5%8C%85-%E5%85%8D%E8%B4%B9%E4%BD%BF%E7%94%A8-15803d?style=for-the-badge\"></a>\n</p>\n\n<p align=\"center\">\n  <img src=\"docs/guide/send-chat.png\" width=\"880\" alt=\"在桌面发送一次操作\">\n</p>\n\n<p align=\"center\">\n  <sub>登录后的官方模型由 sinnauze 接收并完成这次操作。</sub>\n</p>\n\n---\n\n## 一眼看完\n\n<table>\n  <tr>\n    <td width=\"50%\" valign=\"top\">\n      <h3>免费使用</h3>\n      桌面可以免费使用。打开、写下、发送，安装包不单独收费。\n    </td>\n    <td width=\"50%\" valign=\"top\">\n      <h3>官方模型走 sinnauze</h3>\n      登录之后，官方模型由 sinnauze 接收并完成这次操作。\n    </td>\n  </tr>\n  <tr>\n    <td width=\"50%\" valign=\"top\">\n      <h3>一把钥匙，四件工具</h3>\n      配置 API Key 后，同一把钥匙接到 Codex、Claude Code、Cursor、OpenClaw。\n    </td>\n    <td width=\"50%\" valign=\"top\">\n      <h3>自备模型留在本机</h3>\n      自己的 OpenAI 兼容接口直接请求你填写的地址，钥匙只留在本机。\n    </td>\n  </tr>\n</table>\n\n## 基本功能\n\n同一套桌面完成这些事。左上角切换场景后，项目、对话和右侧工具一起换。\n\n| 功能 | 做什么 |\n| --- | --- |\n| 发送 | 在输入框写下内容并发送，就是一次操作。 |\n| 项目 | 一个持续目标，下面挂着文件、对话、产物和任务。 |\n| 右侧面板 | 文件、产物、任务始终在。进入场景后，再出现这个场景自己的工具。 |\n| 官方模型 | 登录后，由 sinnauze 接收并完成这次操作。 |\n| 自备模型 | 文字对话直接请求你填写的地址，钥匙只留在本机。图片、视频和语音仍走官方模型。 |\n\n还没进入专业场景时，用的是场景学习探索：右侧只保留文件、产物和任务。\n\n## 七个场景\n\n| 场景 | 用来做什么 |\n| --- | --- |\n| 量化交易 | 查询行情、看 K 线和成交量、做模拟组合、写研究笔记。不连接真实券商，不执行真实下单。 |\n| 游戏制作 | 管理关卡、角色、世界观、战斗设计和项目资产，并做试玩。 |\n| 视频制作 | 写脚本、排分镜、生成单镜、编辑音视频轨，再合成导出。 |\n| 音乐创作 | 写歌词、定风格、生成整曲、编排音轨，再导出音频。 |\n| 数据与决策 | 导入 CSV 或 Excel，看表格、做摘要和图表，再写出分析结论。 |\n| 软件与自动化 | 查看项目文件、改代码、跑受控终端、执行测试和部署，并编排自动化 Flow。 |\n| 文档创作 | 写文稿、审校批注、排大纲和 PPT，再导出文档。 |\n\n## 配置 API Key\n\nsinnauze 用户配置 API Key 后，可以把同一把钥匙接到下面这些工具。\n\n<p align=\"center\">\n  <img alt=\"Codex\" src=\"https://img.shields.io/badge/Codex-111827?style=for-the-badge\">\n  <img alt=\"Claude Code\" src=\"https://img.shields.io/badge/Claude%20Code-111827?style=for-the-badge\">\n  <img alt=\"Cursor\" src=\"https://img.shields.io/badge/Cursor-111827?style=for-the-badge\">\n  <img alt=\"OpenClaw\" src=\"https://img.shields.io/badge/OpenClaw-111827?style=for-the-badge\">\n</p>\n\n## 配置自备大模型\n\n官方模型不用自己填钥匙。要改用自己的 OpenAI 兼容接口：\n\n1. 点输入框右侧的模型按钮，例如 `Auto·均衡 中`。\n2. 打开模型列表，点 **＋ 添加自备模型**。\n3. 填写显示名、Base URL、API Key、模型 ID，然后保存。\n4. 选中带「自备」的那一行。之后的文字对话会直接请求这个地址，钥匙只留在本机。\n\n图片、视频和语音仍使用官方模型。\n\n<p align=\"center\">\n  <img src=\"docs/guide/custom-model.png\" width=\"420\" alt=\"添加自备模型\">\n</p>\n\n## 后期：国外大模型额度\n\n> 后期会加入国外大模型。看广告可以获得赠送金额，再用这笔金额兑换国外大模型的使用额度。这项还没开放。现在可以配置自备模型，也可以在登录后使用官方模型。\n\n## 从源码打包\n\n`rust/brain-core` 源码不在这个仓库里。打包前在 `rust-core-release.json` 填好官方程序的 url 和 sha256。脚本会下载并核对，不一致就停止。\n\n先安装依赖：\n\n```bash\npnpm install\n```\n\n| 系统 | 命令 |\n| --- | --- |\n| Windows | `pnpm package:windows:production` |\n| macOS Apple Silicon | `pnpm package:macos-arm64` |\n| macOS Intel | `pnpm package:macos-x64` |\n| Ubuntu x64 | `pnpm package:ubuntu-x64` |\n| Ubuntu arm64 | `pnpm package:ubuntu-arm64` |\n\n这些命令会生成对应系统的工程，下载官方 brain-core，再打安装包。公开源码使用 MIT 许可。brain-core 程序只允许原样随安装包分发。\n";

const PUBLIC_README_EN = "<p align=\"center\">\n  <a href=\"README.zh-CN.md\"><b>简体中文</b></a>\n  &nbsp;·&nbsp;\n  English\n</p>\n\n<p align=\"center\">\n  <img alt=\"MIT\" src=\"https://img.shields.io/badge/license-MIT-111827?style=flat-square\">\n  <img alt=\"Windows\" src=\"https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=flat-square&logo=windows&logoColor=white\">\n  <img alt=\"macOS\" src=\"https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-111111?style=flat-square&logo=apple&logoColor=white\">\n  <img alt=\"Ubuntu\" src=\"https://img.shields.io/badge/Ubuntu-x64%20%2F%20arm64-E95420?style=flat-square&logo=ubuntu&logoColor=white\">\n</p>\n\n<h1 align=\"center\">NewBrian</h1>\n\n<p align=\"center\">\n  <b>A free local AI workbench.</b><br>\n  Type in the composer and send. That send is one operation.\n</p>\n\n<p align=\"center\">\n  <a href=\"https://www.sinnauze.cn/\"><img alt=\"Website\" src=\"https://img.shields.io/badge/Website-sinnauze.cn-111827?style=for-the-badge\"></a>\n  &nbsp;\n  <a href=\"https://www.sinnauze.cn/app/download\"><img alt=\"Download\" src=\"https://img.shields.io/badge/Download-free%20to%20use-15803d?style=for-the-badge\"></a>\n</p>\n\n<p align=\"center\">\n  <img src=\"docs/guide/send-chat.png\" width=\"880\" alt=\"Send an operation from the desktop\">\n</p>\n\n<p align=\"center\">\n  <sub>When you are logged in, an official model is handled by sinnauze.</sub>\n</p>\n\n---\n\n## At a glance\n\n<table>\n  <tr>\n    <td width=\"50%\" valign=\"top\">\n      <h3>Free to use</h3>\n      The desktop is free to use. Open it, write, and send. The installer is not a separate purchase.\n    </td>\n    <td width=\"50%\" valign=\"top\">\n      <h3>Official models use sinnauze</h3>\n      After login, an official model is handled by sinnauze.\n    </td>\n  </tr>\n  <tr>\n    <td width=\"50%\" valign=\"top\">\n      <h3>One key, four tools</h3>\n      Set an API key and use that same key in Codex, Claude Code, Cursor, and OpenClaw.\n    </td>\n    <td width=\"50%\" valign=\"top\">\n      <h3>Your model stays local</h3>\n      An OpenAI-compatible API that you provide is called directly. The key stays on this computer.\n    </td>\n  </tr>\n</table>\n\n## Basic functions\n\nOne desktop does these things. Switching the scene at the top left also switches the project list, the conversation, and the tools on the right.\n\n| Function | What it does |\n| --- | --- |\n| Send | Type in the composer and send. That send is one operation. |\n| Project | One ongoing goal, with files, conversations, outputs, and tasks under it. |\n| Right panel | Files, outputs, and tasks stay put. A scene adds its own tools. |\n| Official model | After login, sinnauze receives the operation and completes it. |\n| Your own model | Text chat calls the address you entered. The key stays on this computer. Image, video, and voice stay on official models. |\n\nBefore you enter a specialty scene, NewBrian stays in scene exploration: the right side keeps only files, outputs, and tasks.\n\n## Seven scenes\n\n| Scene | What you use it for |\n| --- | --- |\n| Quant trading | Look up quotes, read candlesticks and volume, run a simulated portfolio, and write research notes. It does not connect to a real broker and does not place real orders. |\n| Game production | Manage levels, characters, world building, combat design, and project assets, then try the build. |\n| Video production | Write a script, lay out shots, generate a shot, edit its audio and video, then composite and export. |\n| Music | Write lyrics, set a style, generate a full piece, arrange tracks, and export audio. |\n| Data and decisions | Import CSV or Excel, read the table, summarize, chart, and write the conclusion. |\n| Software and automation | Read project files, change code, run an approved terminal, test, deploy, and arrange an automation flow. |\n| Document writing | Write a document, review annotations, outline, build slides, and export. |\n\n## Set an API key\n\nA sinnauze user can set an API key and use that same key in these tools:\n\n<p align=\"center\">\n  <img alt=\"Codex\" src=\"https://img.shields.io/badge/Codex-111827?style=for-the-badge\">\n  <img alt=\"Claude Code\" src=\"https://img.shields.io/badge/Claude%20Code-111827?style=for-the-badge\">\n  <img alt=\"Cursor\" src=\"https://img.shields.io/badge/Cursor-111827?style=for-the-badge\">\n  <img alt=\"OpenClaw\" src=\"https://img.shields.io/badge/OpenClaw-111827?style=for-the-badge\">\n</p>\n\n## Use your own model\n\nOfficial models do not need your own key. To call an OpenAI-compatible API that you provide:\n\n1. Click the model button at the right of the composer, for example `Auto·均衡 中`.\n2. Open the model list and click **＋ 添加自备模型**.\n3. Enter a display name, Base URL, API Key, and model ID, then save.\n4. Select the row marked 自备. Later text chats call that address directly. The key stays on this computer.\n\nImage, video, and voice stay on official models.\n\n<p align=\"center\">\n  <img src=\"docs/guide/custom-model.png\" width=\"420\" alt=\"Add your own model\">\n</p>\n\n## Later: quota for models outside China\n\n> Foreign models will be added later. Watching an advertisement grants account credit, and that credit can be spent as quota on those models. This is not open yet. Today you can add your own model, or use an official model after login.\n\n## Package from source\n\nThe `rust/brain-core` source is not in this repository. Before packaging, set the official binary url and sha256 in `rust-core-release.json`. The script downloads that binary and checks the hash. A mismatch stops the build.\n\nInstall dependencies:\n\n```bash\npnpm install\n```\n\n| System | Command |\n| --- | --- |\n| Windows | `pnpm package:windows:production` |\n| macOS Apple Silicon | `pnpm package:macos-arm64` |\n| macOS Intel | `pnpm package:macos-x64` |\n| Ubuntu x64 | `pnpm package:ubuntu-x64` |\n| Ubuntu arm64 | `pnpm package:ubuntu-arm64` |\n\nEach command materializes that platform, downloads the official brain-core binary, and builds the installer. The public source is MIT. The brain-core program may be redistributed only unchanged, inside the installer.\n";

const MIT_LICENSE = `MIT License

Copyright (c) 2026 NewBrian contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

async function copyAllowed(sourceRoot, current, outputRoot) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(current, entry.name);
    const relativePath = relative(sourceRoot, sourcePath);
    if (isDeniedPublicPath(relativePath)) continue;
    const outputPath = join(outputRoot, relativePath);
    if (entry.isDirectory()) {
      await mkdir(outputPath, { recursive: true });
      await copyAllowed(sourceRoot, sourcePath, outputRoot);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      const scrubbed = scrubPublicText(await readFile(sourcePath, "utf8"));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, scrubbed);
      continue;
    }
    const bytes = await readFile(sourcePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
}

async function assertNoForbiddenText(outputRoot, current = outputRoot) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      await assertNoForbiddenText(outputRoot, fullPath);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const text = await readFile(fullPath, "utf8");
    for (const token of FORBIDDEN_TEXT) {
      if (text.includes(token)) {
        throw new Error(`Public export still contains ${token} in ${relative(outputRoot, fullPath)}`);
      }
    }
    if (REAL_PRIVATE_KEY.test(text)) {
      throw new Error(`Public export still contains a private key in ${relative(outputRoot, fullPath)}`);
    }
  }
}

export async function exportPublicTree(sourceRoot, outputRoot) {
  const source = resolve(sourceRoot);
  const output = resolve(outputRoot);
  if (output === source || output.startsWith(source + sep)) {
    throw new Error("Public export must be written outside the private repository.");
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await copyAllowed(source, source, output);
  await mkdir(join(output, "shared", "apps", "desktop", "resources", "experts"), { recursive: true });
  await writeFile(join(output, "shared", "apps", "desktop", "resources", "experts", "README.md"), "专有专家提示词留在私有仓库。\n");
  await writeFile(join(output, "README.md"), PUBLIC_README_ZH);
  await writeFile(join(output, "README.zh-CN.md"), PUBLIC_README_ZH);
  await writeFile(join(output, "README.en.md"), PUBLIC_README_EN);
  await writeFile(join(output, "LICENSE"), MIT_LICENSE);
  await assertNoForbiddenText(output);
  await stat(join(output, "rust-core-release.json"));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outputRoot = resolve(process.argv[2] || join(sourceRoot, "..", "NewBrian-public"));
  await exportPublicTree(sourceRoot, outputRoot);
  console.log(`Public tree exported: ${outputRoot}`);
}
