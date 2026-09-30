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

const PUBLIC_README = `# NewBrian

公开仓库用于打包一个能安装、能打开、能用自备模型进行文字对话的桌面程序。

\`rust/brain-core\` 源码不在这个仓库里。打包时从 \`rust-core-release.json\` 下载官方程序，核对 sha256 后放进安装包。校验不一致就停止打包。桌面启动官方程序前会再次核对。

\`\`\`powershell
node scripts/materialize.mjs windows
\`\`\`

然后在生成的 Windows 工程里执行现有的打包命令。\`rust-core-release.json\` 还没有官方下载地址时，打包会停在下载步骤，不会编出一份没有核心的安装包。

公开源码使用 MIT 许可。\`brain-core\` 程序只允许原样随安装包分发。专有专家提示词、公司密钥、测试环境和签名证书不在这个仓库里。
`;

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
  await writeFile(join(output, "README.md"), PUBLIC_README);
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
