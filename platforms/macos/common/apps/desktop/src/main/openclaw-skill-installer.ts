import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import type { SkillSpec } from "@codex-forge/protocol";
import { assertUserSkillWriteAllowed } from "./user-skill-write-guard.js";
import type {
  OpenClawSkillPackageInfo,
  OpenClawSkillSecurityScan
} from "./openclaw-skill-package.js";

type PackageModule = typeof import("./openclaw-skill-package.js");
const loadPackageModule = () =>
  import(new URL("./openclaw-skill-package.ts", import.meta.url).href) as Promise<PackageModule>;

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface OpenClawSkillInstallOrigin {
  schemaVersion: 1;
  source: "clawhub" | "zip" | "folder" | "url";
  installedAt: string;
  skillName: string;
  slug?: string;
  ownerHandle?: string;
  version?: string;
  downloadUrl?: string;
  archiveSha256?: string;
  skillFileSha256?: string;
  layout: OpenClawSkillPackageInfo["layout"];
  warnings: string[];
  acknowledgedRisk: boolean;
}

export interface OpenClawSkillInstallResult {
  skill: SkillSpec;
  targetDir: string;
  origin: OpenClawSkillInstallOrigin;
  security: OpenClawSkillSecurityScan;
}

export interface InstallOpenClawSkillOptions {
  userSkillRoot: string;
  sourceDir?: string;
  zipPath?: string;
  zipBytes?: Uint8Array;
  preferredName?: string;
  force?: boolean;
  acknowledgeRisk?: boolean;
  origin?: Partial<OpenClawSkillInstallOrigin>;
  stagingRoot?: string;
}

async function ensureEmptyDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyDirectory(source: string, destination: string) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".clawhub" || entry.name === ".newbrain") continue;
      await copyDirectory(from, to);
    } else if (entry.isFile()) {
      await fs.mkdir(dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
  }
}

async function extractZipToDirectory(bytes: Uint8Array, stagingRoot: string) {
  const { assertZipEntrySafe } = await loadPackageModule();
  const zip = await JSZip.loadAsync(bytes, { createFolders: true });
  await ensureEmptyDir(stagingRoot);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const destination = assertZipEntrySafe(stagingRoot, entry.name);
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.writeFile(destination, await entry.async("nodebuffer"));
  }
  return stagingRoot;
}

async function remapSpringLayout(packageInfo: OpenClawSkillPackageInfo, stagingSkillDir: string) {
  if (packageInfo.layout !== "spring-nested") return;
  const skillMarkdown = await fs.readFile(packageInfo.skillMarkdownPath);
  await fs.writeFile(join(stagingSkillDir, "SKILL.md"), skillMarkdown);
  const knowledgeDir = join(packageInfo.rootDir, "knowledge");
  const referencesDir = join(stagingSkillDir, "references");
  try {
    const entries = await fs.readdir(knowledgeDir, { withFileTypes: true });
    await fs.mkdir(referencesDir, { recursive: true });
    for (const entry of entries.filter((item) => item.isFile())) {
      await fs.copyFile(join(knowledgeDir, entry.name), join(referencesDir, entry.name));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Remove nested skill/ after promoting SKILL.md to root when it was copied wholesale.
  try {
    await fs.rm(join(stagingSkillDir, "skill"), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function assertManagedTarget(userSkillRoot: string, targetDir: string) {
  const root = resolve(userSkillRoot);
  const target = resolve(targetDir);
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Refusing to install skill outside managed root: ${targetDir}`);
  }
}

/**
 * Install an OpenClaw-compatible skill package into NewBrain's managed user skill root.
 * Scripts are copied but never executed.
 */
export async function installOpenClawSkillPackage(
  options: InstallOpenClawSkillOptions
): Promise<OpenClawSkillInstallResult> {
  const userSkillRoot = resolve(options.userSkillRoot);
  await fs.mkdir(userSkillRoot, { recursive: true });

  const stagingRoot = options.stagingRoot
    ? resolve(options.stagingRoot)
    : join(userSkillRoot, ".staging", `openclaw-${Date.now()}`);
  let workingDir = "";
  let archiveSha256 = options.origin?.archiveSha256;

  try {
    if (options.zipBytes || options.zipPath) {
      const bytes = options.zipBytes
        ? Uint8Array.from(options.zipBytes)
        : new Uint8Array(await fs.readFile(options.zipPath!));
      archiveSha256 = archiveSha256 || sha256Bytes(bytes);
      workingDir = await extractZipToDirectory(bytes, join(stagingRoot, "extract"));
    } else if (options.sourceDir) {
      workingDir = join(stagingRoot, "extract");
      await ensureEmptyDir(workingDir);
      await copyDirectory(resolve(options.sourceDir), workingDir);
    } else {
      throw new Error("Provide sourceDir, zipPath, or zipBytes to install an OpenClaw skill.");
    }

    const {
      detectOpenClawSkillPackage,
      normalizeOpenClawSkillName,
      scanOpenClawSkillPackage,
      sha256Text
    } = await loadPackageModule();
    const packageInfo = await detectOpenClawSkillPackage(workingDir);
    const security = await scanOpenClawSkillPackage(packageInfo);
    const sourceKind = options.origin?.source || (options.zipPath || options.zipBytes ? "zip" : "folder");
    if (sourceKind === "clawhub" && !options.acknowledgeRisk) {
      throw new Error(
        "ClawHub community skills require acknowledgeRisk=true. Skills are instruction packs; scripts are never auto-executed."
      );
    }
    if (security.blocked && !options.acknowledgeRisk) {
      throw new Error(
        `OpenClaw skill install blocked by security scan. Review and pass acknowledgeRisk=true if you accept the risk. ${security.reasons.join("; ")}`
      );
    }

    const skillName = normalizeOpenClawSkillName(options.preferredName || packageInfo.name);
    if (!skillName) throw new Error("Installed skill name is empty after normalization.");

    const preparedDir = join(stagingRoot, "prepared", skillName);
    await ensureEmptyDir(preparedDir);
    await copyDirectory(packageInfo.rootDir, preparedDir);
    await remapSpringLayout(packageInfo, preparedDir);

    // Ensure root SKILL.md exists after remapping.
    try {
      await fs.access(join(preparedDir, "SKILL.md"));
    } catch {
      await fs.copyFile(packageInfo.skillMarkdownPath, join(preparedDir, "SKILL.md"));
    }

    const skillMarkdown = await fs.readFile(join(preparedDir, "SKILL.md"), "utf8");
    const skillFileSha256 = await sha256Text(skillMarkdown);
    const targetDir = join(userSkillRoot, skillName);
    assertManagedTarget(userSkillRoot, targetDir);

    let targetExists = false;
    try {
      await fs.access(targetDir);
      targetExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assertUserSkillWriteAllowed({
      targetPath: targetDir,
      exists: targetExists,
      force: options.force,
      policy: "install"
    });

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(dirname(targetDir), { recursive: true });
    await fs.rename(preparedDir, targetDir);

    const origin: OpenClawSkillInstallOrigin = {
      schemaVersion: 1,
      source: sourceKind,
      installedAt: new Date().toISOString(),
      skillName,
      slug: options.origin?.slug,
      ownerHandle: options.origin?.ownerHandle,
      version: options.origin?.version,
      downloadUrl: options.origin?.downloadUrl,
      archiveSha256,
      skillFileSha256,
      layout: packageInfo.layout,
      warnings: [...new Set([...packageInfo.warnings, ...security.warnings])],
      acknowledgedRisk: Boolean(options.acknowledgeRisk)
    };
    await fs.mkdir(join(targetDir, ".clawhub"), { recursive: true });
    await fs.writeFile(join(targetDir, ".clawhub", "origin.json"), `${JSON.stringify(origin, null, 2)}\n`, "utf8");

    const skill: SkillSpec = {
      id: `skill-${skillName}`,
      name: skillName,
      summary: packageInfo.description,
      status: "enabled",
      source: origin.source === "clawhub" ? "clawhub" : "openclaw",
      scope: "workspace",
      path: "SKILL.md",
      executionKind: packageInfo.hasScripts ? "script-assisted" : "instructions",
      executionEvidence: packageInfo.hasScripts
        ? ["SKILL.md", "scripts/（不会自动执行）"]
        : ["SKILL.md"]
    };

    return { skill, targetDir, origin, security };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function collectRelativeFiles(rootDir: string, current = rootDir, collected: string[] = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) await collectRelativeFiles(rootDir, absolute, collected);
    else collected.push(relative(rootDir, absolute).split(/[/\\]/).join("/"));
  }
  return collected.sort();
}

/**
 * Pack an installed OpenClaw/NewBrain skill directory into a portable zip
 * containing SKILL.md and sibling assets (references/, agents/, etc.).
 */
export async function exportOpenClawSkillPackageZip(input: {
  skillDir: string;
  destinationPath: string;
  skillName?: string;
}) {
  const skillDir = resolve(input.skillDir);
  const destinationPath = resolve(input.destinationPath);
  await fs.access(join(skillDir, "SKILL.md")).catch(() => {
    throw new Error(`Skill package is missing SKILL.md: ${skillDir}`);
  });
  const files = (await collectRelativeFiles(skillDir)).filter((relativePath) => {
    const top = relativePath.split("/")[0]?.toLowerCase() || "";
    return top !== ".clawhub" && top !== ".newbrain" && top !== ".staging";
  });
  if (!files.some((item) => item.toLowerCase() === "skill.md")) {
    throw new Error(`Skill package is missing SKILL.md: ${skillDir}`);
  }
  const zip = new JSZip();
  const folderName = String(input.skillName || basename(skillDir)).trim() || basename(skillDir);
  for (const relativePath of files) {
    const bytes = await fs.readFile(join(skillDir, relativePath));
    zip.file(`${folderName}/${relativePath}`, bytes);
  }
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.mkdir(dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, archive);
  return {
    zipPath: destinationPath,
    fileCount: files.length,
    skillName: folderName
  };
}

export async function readArchiveSha256(zipPath: string) {
  const { sha256File } = await loadPackageModule();
  return sha256File(zipPath);
}
