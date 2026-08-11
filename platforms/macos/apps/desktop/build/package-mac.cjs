const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { homedir, tmpdir } = require("node:os");
const { basename, dirname, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = resolve(__dirname, "..");
const desktopPackage = require(join(desktopRoot, "package.json"));
const electronPackagePath = require.resolve("electron/package.json", { paths: [desktopRoot] });
const electronPackage = require(electronPackagePath);
const electronDist = join(dirname(electronPackagePath), "dist");
const appName = "Electron.app";
const productName = desktopPackage.build.productName;
const version = desktopPackage.version;
const releaseDir = join(desktopRoot, "release");

function isCompleteElectronDist(candidate) {
  return (
    existsSync(join(candidate, appName, "Contents", "Info.plist")) &&
    existsSync(join(candidate, appName, "Contents", "Frameworks"))
  );
}

function findFiles(root, fileName) {
  if (!existsSync(root)) return [];
  const pending = [root];
  const matches = [];
  while (pending.length) {
    const directory = pending.shift();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name === fileName) matches.push(target);
    }
  }
  return matches;
}

function isValidZip(archive) {
  const result = spawnSync("unzip", ["-tq", archive], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveElectronDist(arch) {
  const targetArch = arch || process.arch;
  if (targetArch === process.arch && isCompleteElectronDist(electronDist)) return electronDist;

  const archiveName = `electron-v${electronPackage.version}-darwin-${targetArch}.zip`;
  const archive = findFiles(join(homedir(), "Library", "Caches", "electron"), archiveName).find(isValidZip);
  if (!archive) {
    console.warn(`No complete local Electron runtime or cache archive found for ${archiveName}; electron-builder will download it.`);
    return "";
  }

  const extracted = join(tmpdir(), `codecn-electron-${electronPackage.version}-${targetArch}`);
  if (!isCompleteElectronDist(extracted)) {
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    run("unzip", ["-q", archive, "-d", extracted]);
  }
  if (!isCompleteElectronDist(extracted)) {
    throw new Error(`Electron cache archive is incomplete: ${basename(archive)}`);
  }
  return extracted;
}

/** Public distribution label: Intel Macs use "intel", Apple Silicon keeps "arm64". */
function distributionArchLabel(builderArch) {
  if (builderArch === "x64" || builderArch === "intel") return "intel";
  if (builderArch === "arm64") return "arm64";
  if (builderArch === "universal") return "universal";
  return process.arch === "x64" ? "intel" : process.arch;
}

function builderArchFromFlags(selectedArches) {
  if (selectedArches.includes("--x64")) return "x64";
  if (selectedArches.includes("--arm64")) return "arm64";
  if (selectedArches.includes("--universal")) return "universal";
  return process.arch;
}

function renameToDistributionLabel(releaseDirectory, builderArch, label) {
  if (builderArch === label) return;
  const prefix = `${productName}-${version}`;
  for (const fileName of readdirSync(releaseDirectory)) {
    if (!fileName.startsWith(prefix)) continue;
    if (!(fileName.endsWith(".dmg") || fileName.endsWith(".zip") || fileName.endsWith(".blockmap"))) continue;

    let nextName = fileName;
    // electron-builder x64 often omits arch, or uses x64 / -mac.zip
    if (builderArch === "x64") {
      nextName = nextName
        .replace(`${prefix}-x64.`, `${prefix}-intel.`)
        .replace(`${prefix}-x64-`, `${prefix}-intel-`)
        .replace(`${prefix}-mac.zip`, `${prefix}-intel-mac.zip`)
        .replace(`${prefix}.dmg`, `${prefix}-intel.dmg`)
        .replace(`${prefix}.dmg.blockmap`, `${prefix}-intel.dmg.blockmap`);
      // Already renamed copies from a previous run
      nextName = nextName.replace(`${prefix}-x64.`, `${prefix}-intel.`);
    }

    if (nextName === fileName) continue;
    const from = join(releaseDirectory, fileName);
    const to = join(releaseDirectory, nextName);
    if (existsSync(to)) rmSync(to, { force: true });
    renameSync(from, to);
    console.log(`Renamed artifact: ${fileName} -> ${nextName}`);
  }
}

function writeChecksumsAndManifest(releaseDirectory, label) {
  const packagePrefix = `${productName}-${version}-`;
  const archives = readdirSync(releaseDirectory)
    .filter((fileName) =>
      fileName.startsWith(packagePrefix)
      && (fileName.endsWith(".dmg") || fileName.endsWith(".zip"))
      && !fileName.includes(".hotfix.")
      && (fileName.includes(`-${label}.`) || fileName.includes(`-${label}-`))
    )
    .sort();
  if (!archives.length) {
    console.warn(`No ${label} dmg/zip artifacts found under ${releaseDirectory}`);
    return;
  }

  const checksumEntries = archives.map((fileName) => {
    const bytes = readFileSync(join(releaseDirectory, fileName));
    return {
      fileName,
      digest: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength
    };
  });
  const sumsName = `SHA256SUMS-${label}.txt`;
  writeFileSync(
    join(releaseDirectory, sumsName),
    `${checksumEntries.map((entry) => `${entry.digest}  ${entry.fileName}`).join("\n")}\n`,
    "utf8"
  );
  console.log(`Wrote ${sumsName} for ${checksumEntries.length} package artifact(s).`);

  const dmg = checksumEntries.find((entry) => entry.fileName.endsWith(".dmg"));
  const zip = checksumEntries.find((entry) => entry.fileName.endsWith(".zip"));
  const primary = dmg || zip;
  if (!primary) return;

  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: desktopRoot,
    encoding: "utf8"
  });
  const manifest = {
    platform: "darwin",
    arch: label === "intel" ? "x64" : label,
    arch_label: label,
    version,
    productName,
    path: primary.fileName,
    size: primary.size,
    sha256: primary.digest,
    artifacts: checksumEntries.map((entry) => ({
      path: entry.fileName,
      size: entry.size,
      sha256: entry.digest
    })),
    zipPath: zip?.fileName || null,
    zipSha256: zip?.digest || null,
    signature: "NotSigned",
    built_at: new Date().toISOString(),
    commit: commit.status === 0 ? String(commit.stdout || "").trim() : "",
    notes: `codeCN Mac ${version} (${label}) — supports macOS 11+ / Monterey and newer`,
    latest_version: version,
    download_url: "",
    channel: "canary",
    mandatory: false,
    minimum_system_version: "11.0"
  };
  const manifestName = `mac-update-manifest-${version}-${label}.json`;
  writeFileSync(join(releaseDirectory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${manifestName}`);
}

function packageOneArch(selectedArches, targets) {
  const builderArch = builderArchFromFlags(selectedArches);
  const label = distributionArchLabel(builderArch);
  const builderArgs = [
    require.resolve("electron-builder/cli.js", { paths: [desktopRoot] }),
    "--mac",
    ...targets,
    ...selectedArches
  ];

  const resolvedDist = resolveElectronDist(builderArch === "universal" ? "" : builderArch);
  if (resolvedDist) builderArgs.push(`--config.electronDist=${resolvedDist}`);
  // Keep Info.plist + Electron minos aligned for Monterey (12.x) and newer.
  builderArgs.push("--config.mac.minimumSystemVersion=11.0");
  // Force arch into the filename so we can rename x64 -> intel reliably.
  builderArgs.push(`--config.artifactName=${productName}-\${version}-\${arch}.\${ext}`);

  console.log(`Packaging mac (${label} / builder arch=${builderArch})…`);
  run(process.execPath, builderArgs);
  renameToDistributionLabel(releaseDir, builderArch, label);
  if (targets.some((target) => target === "dmg" || target === "zip")) {
    writeChecksumsAndManifest(releaseDir, label);
  }
}

run(process.execPath, [join(__dirname, "prepare-package-resources.cjs")]);

const archFlags = new Set(["--x64", "--arm64", "--universal", "--all"]);
const requestedArgs = process.argv.slice(2).filter(Boolean);
const selectedArches = requestedArgs.filter((arg) => archFlags.has(arg) && arg !== "--all");
const wantAll = requestedArgs.includes("--all");
const packageTargets = requestedArgs.filter((arg) => !archFlags.has(arg));
const targets = packageTargets.length ? packageTargets : ["dmg", "zip"];

if (wantAll) {
  // Host Apple Silicon: build arm64 + intel so Monterey/Intel and Apple Silicon are both covered.
  packageOneArch(["--arm64"], targets);
  packageOneArch(["--x64"], targets);
} else if (selectedArches.length) {
  packageOneArch(selectedArches, targets);
} else {
  // Default: current host arch, labeled intel when host is x64.
  packageOneArch([`--${process.arch}`], targets);
}
