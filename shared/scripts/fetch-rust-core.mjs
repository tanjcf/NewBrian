import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function writeRustCoreReleaseManifest(binaryPath, signer = "") {
  const bytes = await readFile(binaryPath);
  const manifest = {
    schemaVersion: 1,
    fileName: binaryPath.endsWith(".exe") ? "brain-core.exe" : "brain-core",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signer: String(signer || "")
  };
  await writeFile(join(dirname(binaryPath), "brain-core-release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function fetchOfficialRustCore(options) {
  const sourceRoot = options.sourceRoot;
  const outputPath = options.outputPath;
  const catalog = JSON.parse(await readFile(join(sourceRoot, "rust-core-release.json"), "utf8"));
  const platform = process.platform === "win32" ? catalog.windows : catalog.unix;
  const url = String(platform?.url || "").trim();
  const sha256 = String(platform?.sha256 || "").trim().toLowerCase();
  if (!url || !/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("官方 brain-core 尚未发布。请在 rust-core-release.json 写入对应平台的 url 和 sha256 后再打包。公开仓库不包含 Rust 源码。");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`官方 brain-core 下载失败：${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error("BRAIN_CORE_RELEASE_MISMATCH: 下载的 brain-core 与公布的 sha256 不一致。");
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.download`;
  await writeFile(temporary, bytes);
  await rename(temporary, outputPath);
  if (process.platform !== "win32") await chmod(outputPath, 0o755);
  if ((await stat(outputPath)).size <= 0) throw new Error(`Rust Core download is empty: ${outputPath}`);
  await writeRustCoreReleaseManifest(outputPath, platform.signer || "");
  console.log(`Official Rust Core staged: ${outputPath}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const sourceRoot = process.env.NEWBRAIN_SOURCE_ROOT;
  const outputPath = process.env.BRAIN_CORE_OUTPUT;
  if (!sourceRoot || !outputPath) {
    throw new Error("NEWBRAIN_SOURCE_ROOT and BRAIN_CORE_OUTPUT are required.");
  }
  await fetchOfficialRustCore({ sourceRoot, outputPath });
}
