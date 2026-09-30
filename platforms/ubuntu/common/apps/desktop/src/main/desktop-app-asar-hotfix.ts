import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const MAC_ASAR_HOTFIX_FORMAT = "newbrain-mac-asar-hotfix/v1";

export interface HotfixFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface MacAsarHotfixManifest {
  format: typeof MAC_ASAR_HOTFIX_FORMAT;
  platform: "darwin";
  arch: string;
  version: string;
  minVersion: string;
  appId: string;
  notes?: string;
  files: HotfixFileEntry[];
  asarIntegrity: {
    "Resources/app.asar": {
      algorithm: "SHA256";
      hash: string;
    };
  };
}

export interface ApplyMacAsarHotfixInput {
  archivePath: string;
  resourcesPath: string;
  infoPlistPath: string;
  currentVersion: string;
  currentAppId?: string;
  expectedArch?: string;
}

export interface ApplyMacAsarHotfixResult {
  ok: boolean;
  detail: string;
  version?: string;
  appliedFiles?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionParts(value: string) {
  const normalized = value.trim().replace(/^v/i, "").split("-", 1)[0];
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareHotfixVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function sha256Buffer(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256FileSync(path: string) {
  return sha256Buffer(readFileSync(path));
}

export function isMacAsarHotfixUrl(downloadUrl: string) {
  const normalized = downloadUrl.trim().toLowerCase();
  return normalized.endsWith(".hotfix.zip") || normalized.includes(".hotfix.zip?");
}

export function resolveUpdatePackageKind(payload: unknown, downloadUrl = ""): "full" | "hotfix" {
  if (isRecord(payload)) {
    const kind = String(payload.package_kind ?? payload.update_kind ?? payload.packageKind ?? "").trim().toLowerCase();
    if (kind === "hotfix" || kind === "asar_hotfix" || kind === "asar-hotfix") return "hotfix";
    if (kind === "full" || kind === "installer" || kind === "dmg" || kind === "msi") return "full";
  }
  return isMacAsarHotfixUrl(downloadUrl) ? "hotfix" : "full";
}

export function parseMacAsarHotfixManifest(payload: unknown): MacAsarHotfixManifest | null {
  if (!isRecord(payload)) return null;
  if (String(payload.format ?? "").trim() !== MAC_ASAR_HOTFIX_FORMAT) return null;
  if (String(payload.platform ?? "").trim() !== "darwin") return null;
  const version = String(payload.version ?? "").trim();
  const minVersion = String(payload.minVersion ?? payload.min_version ?? "").trim();
  const appId = String(payload.appId ?? payload.app_id ?? "").trim();
  const arch = String(payload.arch ?? "").trim();
  if (!version || !minVersion || !appId || !arch) return null;
  if (!Array.isArray(payload.files) || payload.files.length === 0) return null;

  const files: HotfixFileEntry[] = [];
  for (const entry of payload.files) {
    if (!isRecord(entry)) return null;
    const path = String(entry.path ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    const sha256 = String(entry.sha256 ?? "").trim().toLowerCase();
    const size = Number(entry.size ?? 0);
    if (!path || !sha256 || !Number.isFinite(size) || size < 0) return null;
    if (path.includes("..") || path.startsWith("/") || !path.startsWith("Resources/")) return null;
    files.push({ path, sha256, size });
  }
  if (!files.some((file) => file.path === "Resources/app.asar")) return null;

  const integrityRoot = isRecord(payload.asarIntegrity)
    ? payload.asarIntegrity
    : isRecord(payload.asar_integrity)
      ? payload.asar_integrity
      : null;
  const asarNode = integrityRoot && isRecord(integrityRoot["Resources/app.asar"])
    ? integrityRoot["Resources/app.asar"]
    : null;
  const hash = String(asarNode?.hash ?? "").trim().toLowerCase();
  if (!hash) return null;

  return {
    format: MAC_ASAR_HOTFIX_FORMAT,
    platform: "darwin",
    arch,
    version,
    minVersion,
    appId,
    notes: String(payload.notes ?? "").trim() || undefined,
    files,
    asarIntegrity: {
      "Resources/app.asar": {
        algorithm: "SHA256",
        hash
      }
    }
  };
}

function extractZipArchive(archivePath: string, destination: string) {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync("unzip", ["-qo", archivePath, "-d", destination], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `unzip failed with code ${result.status}`);
  }
}

function findManifestPath(extractRoot: string) {
  const direct = join(extractRoot, "hotfix-manifest.json");
  if (existsSync(direct)) return direct;
  // Allow a single top-level folder wrapper.
  const entries = spawnSync("find", [extractRoot, "-name", "hotfix-manifest.json", "-maxdepth", "2"], {
    encoding: "utf8"
  });
  const match = String(entries.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return match || "";
}

function updateInfoPlist(input: {
  infoPlistPath: string;
  version: string;
  asarHash: string;
}) {
  const buddy = (command: string, allowFailure = false) => {
    const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", command, input.infoPlistPath], {
      encoding: "utf8"
    });
    if (result.status !== 0 && !allowFailure) {
      throw new Error(result.stderr?.trim() || `PlistBuddy failed: ${command}`);
    }
  };

  // Recreate integrity dict so nested slash keys are reliable.
  buddy("Delete :ElectronAsarIntegrity", true);
  buddy("Add :ElectronAsarIntegrity dict");
  buddy("Add :ElectronAsarIntegrity:Resources/app.asar dict");
  buddy("Add :ElectronAsarIntegrity:Resources/app.asar:algorithm string SHA256");
  buddy(`Add :ElectronAsarIntegrity:Resources/app.asar:hash string ${input.asarHash}`);
  buddy(`Set :CFBundleShortVersionString ${input.version}`, true);
  buddy(`Set :CFBundleVersion ${input.version}`, true);
  // If Set failed because the key was missing, add it.
  const short = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", input.infoPlistPath], {
    encoding: "utf8"
  });
  if (String(short.stdout || "").trim() !== input.version) {
    buddy(`Add :CFBundleShortVersionString string ${input.version}`);
  }
  const bundle = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", input.infoPlistPath], {
    encoding: "utf8"
  });
  if (String(bundle.stdout || "").trim() !== input.version) {
    buddy(`Add :CFBundleVersion string ${input.version}`);
  }
}

function replaceFileAtomically(sourcePath: string, destinationPath: string) {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const stagingPath = `${destinationPath}.newbrain-hotfix-new`;
  const backupPath = `${destinationPath}.newbrain-hotfix-bak`;
  copyFileSync(sourcePath, stagingPath);
  try {
    if (existsSync(destinationPath)) {
      try {
        renameSync(destinationPath, backupPath);
      } catch {
        // Some filesystems reject rename-over-open; fall through to direct replace.
        rmSync(backupPath, { force: true });
      }
    }
    renameSync(stagingPath, destinationPath);
    rmSync(backupPath, { force: true });
  } catch (error) {
    // Best-effort rollback.
    if (existsSync(backupPath) && !existsSync(destinationPath)) {
      try {
        renameSync(backupPath, destinationPath);
      } catch {
        // ignore
      }
    }
    rmSync(stagingPath, { force: true });
    throw error;
  }
}

/** Apply a downloaded Mac asar hotfix zip into the running app bundle Resources. */
export async function applyMacAsarHotfix(input: ApplyMacAsarHotfixInput): Promise<ApplyMacAsarHotfixResult> {
  if (process.platform !== "darwin") {
    return { ok: false, detail: "asar 热修仅支持 macOS。" };
  }
  if (!existsSync(input.archivePath)) {
    return { ok: false, detail: "热修包不存在。" };
  }
  if (!existsSync(input.resourcesPath) || !existsSync(input.infoPlistPath)) {
    return { ok: false, detail: "当前不是可热修的打包应用目录。" };
  }

  const extractRoot = await mkdtemp(join(tmpdir(), "newbrain-hotfix-"));
  try {
    extractZipArchive(input.archivePath, extractRoot);
    const manifestPath = findManifestPath(extractRoot);
    if (!manifestPath) {
      return { ok: false, detail: "热修包缺少 hotfix-manifest.json。" };
    }
    const manifest = parseMacAsarHotfixManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    if (!manifest) {
      return { ok: false, detail: "热修包清单无效。" };
    }
    if (input.expectedArch && manifest.arch !== input.expectedArch) {
      return { ok: false, detail: `热修包架构不匹配（需要 ${input.expectedArch}，实际 ${manifest.arch}）。` };
    }
    if (input.currentAppId && input.currentAppId !== manifest.appId) {
      return { ok: false, detail: `热修包 appId 不匹配（${manifest.appId}）。` };
    }
    if (compareHotfixVersions(input.currentVersion, manifest.minVersion) < 0) {
      return {
        ok: false,
        detail: `当前版本 ${input.currentVersion} 低于热修要求的最低版本 ${manifest.minVersion}，请先安装完整包。`
      };
    }
    if (compareHotfixVersions(input.currentVersion, manifest.version) >= 0) {
      return {
        ok: false,
        detail: `当前版本 ${input.currentVersion} 已不低于热修版本 ${manifest.version}。`
      };
    }

    const packageRoot = dirname(manifestPath);
    const appliedFiles: string[] = [];
    for (const file of manifest.files) {
      const sourcePath = join(packageRoot, ...file.path.split("/"));
      if (!existsSync(sourcePath)) {
        return { ok: false, detail: `热修包缺少文件：${file.path}` };
      }
      const bytes = readFileSync(sourcePath);
      if (bytes.byteLength !== file.size) {
        return { ok: false, detail: `热修文件大小不匹配：${file.path}` };
      }
      const digest = sha256Buffer(bytes);
      if (digest !== file.sha256) {
        return { ok: false, detail: `热修文件校验失败：${file.path}` };
      }
      // Resources/... -> under resourcesPath / Contents
      const relative = file.path.replace(/^Resources\//, "");
      const destinationPath = resolve(input.resourcesPath, relative);
      if (!destinationPath.startsWith(resolve(input.resourcesPath) + sep) && destinationPath !== resolve(input.resourcesPath)) {
        return { ok: false, detail: `非法热修路径：${file.path}` };
      }
      replaceFileAtomically(sourcePath, destinationPath);
      appliedFiles.push(file.path);
    }

    const asarHash = manifest.asarIntegrity["Resources/app.asar"].hash;
    const installedAsar = join(input.resourcesPath, "app.asar");
    if (!existsSync(installedAsar) || sha256FileSync(installedAsar) !== asarHash) {
      return { ok: false, detail: "热修后 app.asar 完整性校验失败。" };
    }
    updateInfoPlist({
      infoPlistPath: input.infoPlistPath,
      version: manifest.version,
      asarHash
    });

    return {
      ok: true,
      detail: `热修 ${manifest.version} 已写入应用，即将重启生效。`,
      version: manifest.version,
      appliedFiles
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await rm(extractRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createMacAsarHotfixArchive(input: {
  appResourcesPath: string;
  outputPath: string;
  version: string;
  minVersion: string;
  appId: string;
  arch: string;
  notes?: string;
  extraResourceFiles?: string[];
}) {
  const staging = join(tmpdir(), `newbrain-hotfix-stage-${Date.now()}`);
  const resourcesStaging = join(staging, "Resources");
  mkdirSync(resourcesStaging, { recursive: true });

  try {
    const resourceNames = ["app.asar", ...(input.extraResourceFiles ?? [])];
    const files: HotfixFileEntry[] = [];
    for (const name of resourceNames) {
      const source = join(input.appResourcesPath, name);
      if (!existsSync(source)) {
        throw new Error(`Missing resource for hotfix: ${name}`);
      }
      const destination = join(resourcesStaging, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      const bytes = readFileSync(destination);
      files.push({
        path: `Resources/${name.replace(/\\/g, "/")}`,
        sha256: sha256Buffer(bytes),
        size: bytes.byteLength
      });
    }

    const asarEntry = files.find((file) => file.path === "Resources/app.asar");
    if (!asarEntry) throw new Error("Hotfix requires Resources/app.asar");

    const manifest: MacAsarHotfixManifest = {
      format: MAC_ASAR_HOTFIX_FORMAT,
      platform: "darwin",
      arch: input.arch,
      version: input.version,
      minVersion: input.minVersion,
      appId: input.appId,
      notes: input.notes,
      files,
      asarIntegrity: {
        "Resources/app.asar": {
          algorithm: "SHA256",
          hash: asarEntry.sha256
        }
      }
    };
    writeFileSync(join(staging, "hotfix-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    mkdirSync(dirname(input.outputPath), { recursive: true });
    rmSync(input.outputPath, { force: true });
    const zip = spawnSync("bash", ["-lc", `cd ${JSON.stringify(staging)} && zip -qry ${JSON.stringify(input.outputPath)} .`], {
      encoding: "utf8"
    });
    if (zip.status !== 0 || !existsSync(input.outputPath)) {
      throw new Error(zip.stderr || "Failed to create hotfix zip");
    }

    return {
      outputPath: input.outputPath,
      sha256: sha256FileSync(input.outputPath),
      size: readFileSync(input.outputPath).byteLength,
      manifest
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
