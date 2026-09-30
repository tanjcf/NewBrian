const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const { preparePackageResources, resolveChannelEndpoints } = require("./prepare-package-resources.cjs");

const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const desktopPackage = require(join(desktopRoot, "package.json"));
const rustCoreBinary = join(desktopRoot, "build", "rust-core", "brain-core");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function parseArgs(argv) {
  const args = { channel: "test", arch: process.arch === "x64" ? "x64" : "arm64" };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--channel" && next) {
      args.channel = next;
      index += 1;
    } else if (current === "--arch" && next) {
      args.arch = next === "intel" ? "x64" : next;
      index += 1;
    }
  }
  if (args.channel !== "test" && args.channel !== "production") {
    throw new Error(`Unsupported channel: ${args.channel}`);
  }
  if (args.arch !== "arm64" && args.arch !== "x64") {
    throw new Error(`Unsupported arch: ${args.arch}`);
  }
  return args;
}

function rewriteCompiledEndpoints(gatewayBaseUrl, previewUrl) {
  const gatewayOrigin = gatewayBaseUrl.replace(/\/v1\/?$/u, "");
  const outRoot = join(desktopRoot, "out");
  if (!existsSync(outRoot)) return 0;
  const pending = [outRoot];
  let rewritten = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!/\.(js|cjs|mjs|html|json|css|map)$/u.test(entry.name)) continue;
      const original = readFileSync(target, "utf8");
      if (!original.includes("127.0.0.1") && !original.includes("203.0.113.10") && !original.includes("wangjietech.com")) {
        continue;
      }
      const updated = original
        .replaceAll("http://127.0.0.1:8790/v1", gatewayBaseUrl)
        .replaceAll("http://203.0.113.10:8790/v1", gatewayBaseUrl)
        .replaceAll("https://test.wangjietech.com/v1", gatewayBaseUrl)
        .replaceAll("https://api.wangjietech.com/v1", gatewayBaseUrl)
        .replaceAll("http://test.wangjietech.com/v1", gatewayBaseUrl)
        .replaceAll("http://api.wangjietech.com/v1", gatewayBaseUrl)
        .replaceAll("http://127.0.0.1:8790", gatewayOrigin)
        .replaceAll("http://localhost:8790", gatewayOrigin)
        .replaceAll("http://127.0.0.1:3000", previewUrl)
        .replaceAll("http://203.0.113.10:3000", previewUrl)
        .replaceAll("https://test.wangjietech.com", previewUrl)
        .replaceAll("https://api.wangjietech.com", previewUrl);
      if (updated !== original) {
        writeFileSync(target, updated, "utf8");
        rewritten += 1;
      }
    }
  }
  return rewritten;
}

function ensureRustCore() {
  if (existsSync(rustCoreBinary) && statSync(rustCoreBinary).size > 0) {
    console.log(`Reusing staged Rust Core: ${rustCoreBinary}`);
    return;
  }
  run(process.execPath, [join(repoRoot, "scripts", "build-rust-core.mjs")], {
    env: {
      ...process.env,
      CARGO_TARGET_DIR: join(repoRoot, "rust", "brain-core", "target")
    }
  });
}

function resolveElectronDist(arch) {
  const extracted = "/tmp/newbrain-electron-35.7.5-arm64";
  if (arch === process.arch && existsSync(join(extracted, "Electron.app", "Contents", "Info.plist"))) {
    return extracted;
  }
  const electronPackagePath = require.resolve("electron/package.json", { paths: [desktopRoot] });
  const localDist = join(electronPackagePath, "..", "dist");
  if (existsSync(join(localDist, "Electron.app", "Contents", "Info.plist"))) return localDist;
  return "";
}

function moveTestArtifacts(releaseDir, version, arch) {
  const suffix = `-${arch}-test-unsigned.`;
  for (const fileName of readdirSync(releaseDir)) {
    if (!fileName.startsWith("NewBrain Mac-")) continue;
    if (!(fileName.endsWith(".dmg") || fileName.endsWith(".zip") || fileName.endsWith(".blockmap"))) continue;
    if (fileName.includes("-test-unsigned")) continue;
    const nextName = fileName
      .replace(`${version}-${arch}.`, `${version}${suffix}`)
      .replace(`${version}-${arch}-mac.zip`, `${version}-${arch}-mac-test-unsigned.zip`)
      .replace(`${version}-${arch}-mac.zip.blockmap`, `${version}-${arch}-mac-test-unsigned.zip.blockmap`);
    if (nextName === fileName) continue;
    const from = join(releaseDir, fileName);
    const to = join(releaseDir, nextName);
    if (existsSync(to)) rmSync(to, { force: true });
    renameSync(from, to);
    console.log(`Renamed artifact: ${fileName} -> ${nextName}`);
  }
}

const { channel, arch } = parseArgs(process.argv.slice(2));
const isProduction = channel === "production";
const { gatewayBaseUrl, previewUrl } = resolveChannelEndpoints(channel);
const channelSlug = channel;
const version = desktopPackage.version;
const releaseDir = join(desktopRoot, "release", channelSlug);
const builderArchFlag = arch === "x64" ? "--x64" : "--arm64";

console.log(`Packaging mac ${channel} ${arch} ${version}`);
console.log(`Gateway endpoint: ${gatewayBaseUrl}`);
console.log(`Preview endpoint: ${previewUrl}`);

process.env.NEWBRAIN_PACKAGE_CHANNEL = channel;
preparePackageResources(channel);
ensureRustCore();
run("pnpm", ["run", "build"]);
const rewritten = rewriteCompiledEndpoints(gatewayBaseUrl, previewUrl);
console.log(`Rewrote local defaults for the ${channel} channel in ${rewritten} out/ file(s)`);

mkdirSync(releaseDir, { recursive: true });
const builderArgs = [
  require.resolve("electron-builder/cli.js", { paths: [desktopRoot] }),
  "--mac",
  "dmg",
  "zip",
  builderArchFlag,
  `--config.directories.output=release/${channelSlug}`,
  `--config.extraMetadata.version=${version}`,
  `--config.artifactName=NewBrain Mac-\${version}-\${arch}.\${ext}`
];
const electronDist = resolveElectronDist(arch);
if (electronDist) builderArgs.push(`--config.electronDist=${electronDist}`);
if (!isProduction) {
  builderArgs.push("-c.mac.notarize=false", "-c.mac.identity=null");
}

run(process.execPath, builderArgs, {
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: isProduction ? process.env.CSC_IDENTITY_AUTO_DISCOVERY : "false"
  }
});

if (!isProduction) moveTestArtifacts(releaseDir, version, arch);
console.log(`Mac ${channel} artifacts: ${releaseDir}`);
