import type {
  FeatureConfigPayload,
  OpenClawSkillExportZipResult,
  SkillSpec,
  UninstallWritingSkillsResult
} from "@codex-forge/protocol";
import {
  downloadResolvedClawHubInstall,
  resolveClawHubSkillInstall,
  searchClawHubSkills,
  type ClawHubSkillSearchHit
} from "./clawhub-client.js";
import {
  assertDirectClawhubAllowed,
  resolveDirectClawhubAllowed
} from "./market-clawhub-policy.js";
import {
  exportOpenClawSkillPackageZip,
  installOpenClawSkillPackage,
  type OpenClawSkillInstallResult
} from "./openclaw-skill-installer.js";
import { detectOpenClawSkillPackage } from "./openclaw-skill-package.js";
import {
  isWritingSkillIdentity,
  WRITING_SKILL_NAMES
} from "./writing-skills.js";
import { join, resolve, sep } from "node:path";
import fs from "node:fs/promises";

export interface OpenClawSkillServiceDeps {
  userSkillRoot: string;
  readFeatureConfig: () => Promise<FeatureConfigPayload>;
  writeFeatureConfig: (config: FeatureConfigPayload) => Promise<FeatureConfigPayload>;
  addSkillRoots: (roots: string[]) => Promise<unknown> | unknown;
  deleteSkill?: (id: string) => Promise<FeatureConfigPayload>;
  selectPackagePath?: () => Promise<string | null>;
  selectExportPath?: (defaultName: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /**
   * Local preference / env gate for ClawHub network installs. Default true on desktop.
   * When false, ClawHub network search/install is blocked; local zip/folder still works.
   */
  isDirectClawhubAllowed?: () => boolean | Promise<boolean>;
}

export class OpenClawSkillService {
  private readonly deps: OpenClawSkillServiceDeps;

  constructor(deps: OpenClawSkillServiceDeps) {
    this.deps = deps;
  }

  private async ensureDirectClawhubAllowed() {
    const allowed = this.deps.isDirectClawhubAllowed
      ? await this.deps.isDirectClawhubAllowed()
      : resolveDirectClawhubAllowed({ preferenceAllowed: false });
    assertDirectClawhubAllowed(allowed);
  }

  async search(query: string, limit = 20): Promise<ClawHubSkillSearchHit[]> {
    await this.ensureDirectClawhubAllowed();
    return searchClawHubSkills({
      query,
      limit,
      baseUrl: this.deps.baseUrl,
      fetchImpl: this.deps.fetchImpl
    });
  }

  async inspectLocal(path: string) {
    return detectOpenClawSkillPackage(path);
  }

  async installFromPath(input: {
    path: string;
    force?: boolean;
    acknowledgeRisk?: boolean;
  }): Promise<OpenClawSkillInstallResult> {
    const lower = input.path.toLowerCase();
    const isZip = lower.endsWith(".zip");
    const result = await installOpenClawSkillPackage({
      userSkillRoot: this.deps.userSkillRoot,
      sourceDir: isZip ? undefined : input.path,
      zipPath: isZip ? input.path : undefined,
      force: input.force,
      acknowledgeRisk: input.acknowledgeRisk,
      origin: { source: isZip ? "zip" : "folder" }
    });
    await this.persistInstalledSkill(result.skill);
    return result;
  }

  async installFromClawHub(input: {
    ref: string;
    force?: boolean;
    acknowledgeRisk?: boolean;
    forceInstall?: boolean;
  }): Promise<OpenClawSkillInstallResult> {
    await this.ensureDirectClawhubAllowed();
    const resolved = await resolveClawHubSkillInstall({
      ref: input.ref,
      forceInstall: input.forceInstall,
      baseUrl: this.deps.baseUrl,
      fetchImpl: this.deps.fetchImpl
    });
    if (!resolved.ok) {
      throw new Error(`ClawHub install refused (${resolved.reason}): ${resolved.message}`);
    }
    const downloaded = await downloadResolvedClawHubInstall(resolved, {
      baseUrl: this.deps.baseUrl,
      fetchImpl: this.deps.fetchImpl
    });
    const result = await installOpenClawSkillPackage({
      userSkillRoot: this.deps.userSkillRoot,
      zipBytes: downloaded.bytes,
      force: input.force,
      acknowledgeRisk: input.acknowledgeRisk,
      preferredName: resolved.slug,
      origin: {
        source: "clawhub",
        slug: resolved.slug,
        ownerHandle: resolved.ownerHandle,
        version: resolved.installKind === "archive" ? resolved.version : resolved.commit,
        downloadUrl: downloaded.downloadUrl
      }
    });
    await this.persistInstalledSkill(result.skill);
    return result;
  }

  async selectAndInstall(input: { force?: boolean; acknowledgeRisk?: boolean } = {}) {
    if (!this.deps.selectPackagePath) throw new Error("Package file picker is unavailable.");
    const selected = await this.deps.selectPackagePath();
    if (!selected) return null;
    return this.installFromPath({
      path: selected,
      force: input.force,
      acknowledgeRisk: input.acknowledgeRisk
    });
  }

  async selectAndInstallIntoProject(input: {
    workspacePath: string;
    force?: boolean;
    acknowledgeRisk?: boolean;
  }) {
    if (!this.deps.selectPackagePath) throw new Error("Package file picker is unavailable.");
    const selected = await this.deps.selectPackagePath();
    if (!selected) return null;
    return this.installZipIntoProject({
      workspacePath: input.workspacePath,
      zipPath: selected,
      force: input.force,
      acknowledgeRisk: input.acknowledgeRisk
    });
  }

  /**
   * Install a skill zip into the selected project's `.newbrain/skills` directory.
   * The package stays with that project and is not written to the global skill root.
   */
  async installZipIntoProject(input: {
    workspacePath: string;
    zipPath: string;
    force?: boolean;
    acknowledgeRisk?: boolean;
  }): Promise<OpenClawSkillInstallResult> {
    const workspacePath = resolve(String(input.workspacePath || ""));
    const directory = await fs.stat(workspacePath).catch(() => null);
    if (!directory?.isDirectory()) throw new Error("请先打开一个本地项目，再导入技能压缩包。");
    const zipPath = String(input.zipPath || "").trim();
    if (!zipPath.toLowerCase().endsWith(".zip")) throw new Error("请选择 .zip 技能压缩包。");
    const skillRoot = join(workspacePath, ".newbrain", "skills");
    const result = await installOpenClawSkillPackage({
      userSkillRoot: skillRoot,
      zipPath,
      force: input.force,
      acknowledgeRisk: input.acknowledgeRisk,
      origin: { source: "zip" }
    });
    const skill = { ...result.skill, scope: "project", path: result.targetDir };
    await this.deps.addSkillRoots([skillRoot]);
    const config = await this.deps.readFeatureConfig();
    const skills = [
      skill,
      ...config.skills.filter((item) => item.name !== skill.name && item.id !== skill.id)
    ];
    await this.deps.writeFeatureConfig({ ...config, skills });
    return { ...result, skill };
  }

  /**
   * Export an installed managed skill as a portable `.zip` (SKILL.md package).
   * Prefer this over copying loose skill folders for backup/reinstall.
   */
  async exportAsZip(input: {
    skillId?: string;
    skillName?: string;
    destinationPath?: string;
  }): Promise<OpenClawSkillExportZipResult> {
    const config = await this.deps.readFeatureConfig();
    const skill = this.resolveSkill(config.skills, input);
    if (!skill) {
      throw new Error(
        `Skill was not found for zip export: ${input.skillId || input.skillName || "(missing id/name)"}`
      );
    }
    const skillName = String(skill.name || "").trim();
    const skillDir = this.assertManagedSkillDir(skillName);
    await fs.access(join(skillDir, "SKILL.md"));
    let destinationPath = input.destinationPath?.trim() || "";
    if (!destinationPath) {
      if (!this.deps.selectExportPath) {
        throw new Error("Skill zip export path picker is unavailable.");
      }
      const selected = await this.deps.selectExportPath(`${skillName}.zip`);
      if (!selected) {
        return { ok: false, skillName, zipPath: "", fileCount: 0 };
      }
      destinationPath = selected;
    }
    if (!destinationPath.toLowerCase().endsWith(".zip")) {
      destinationPath = `${destinationPath}.zip`;
    }
    const exported = await exportOpenClawSkillPackageZip({
      skillDir,
      destinationPath,
      skillName
    });
    return {
      ok: true,
      skillName: exported.skillName,
      zipPath: exported.zipPath,
      fileCount: exported.fileCount
    };
  }

  /**
   * Uninstall writing-oriented skills from the local managed catalog first.
   * Zip backup/export remains available for remaining (and future) skills.
   */
  async uninstallWritingSkills(input: { extraNames?: string[] } = {}): Promise<UninstallWritingSkillsResult> {
    const config = await this.deps.readFeatureConfig();
    const extraSet = new Set(
      (input.extraNames || []).map((name) => normalizeLoose(name)).filter(Boolean)
    );
    const targets = config.skills.filter((skill) =>
      isWritingSkillIdentity(String(skill.name || ""))
      || isWritingSkillIdentity(String(skill.id || ""))
      || extraSet.has(normalizeLoose(String(skill.name || "")))
      || extraSet.has(normalizeLoose(String(skill.id || "")))
    );
    const removed: Array<{ id: string; name: string }> = [];
    const skipped: string[] = [];
    if (!this.deps.deleteSkill) {
      for (const name of WRITING_SKILL_NAMES) skipped.push(name);
      return {
        ok: false,
        removed,
        skipped,
        detail: "Skill delete handler is unavailable."
      };
    }
    for (const skill of targets) {
      await this.deps.deleteSkill(skill.id);
      removed.push({ id: skill.id, name: skill.name });
    }
    for (const name of WRITING_SKILL_NAMES) {
      if (!removed.some((item) => normalizeLoose(item.name) === name)) skipped.push(name);
    }
    return {
      ok: true,
      removed,
      skipped,
      detail: removed.length
        ? `Uninstalled ${removed.length} writing skill(s).`
        : "No installed writing skills were found in the local catalog."
    };
  }

  private resolveSkill(skills: SkillSpec[], input: { skillId?: string; skillName?: string }) {
    const skillId = String(input.skillId || "").trim();
    const skillName = String(input.skillName || "").trim();
    return skills.find((skill) =>
      (skillId && (skill.id === skillId || skill.name === skillId || skill.id === `skill-${skillId}`))
      || (skillName && (skill.name === skillName || skill.id === skillName || skill.id === `skill-${skillName}`))
    ) || null;
  }

  private assertManagedSkillDir(skillName: string) {
    const root = resolve(this.deps.userSkillRoot);
    const target = resolve(join(root, skillName));
    if (target === root || !target.startsWith(`${root}${sep}`)) {
      throw new Error(`Refusing to export skill outside managed root: ${skillName}`);
    }
    return target;
  }

  private async persistInstalledSkill(skill: SkillSpec) {
    await this.deps.addSkillRoots([this.deps.userSkillRoot]);
    const config = await this.deps.readFeatureConfig();
    const skills = [
      skill,
      ...config.skills.filter((item) => item.name !== skill.name && item.id !== skill.id)
    ];
    await this.deps.writeFeatureConfig({ ...config, skills });
  }
}

function normalizeLoose(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^skill-/, "");
}
