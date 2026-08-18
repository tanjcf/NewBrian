import { join } from "node:path";
import { spawn } from "node:child_process";
import type {
  OpenLogLocationResult,
  OpenSkillLocationInput,
  OpenSystemToolInput,
  SystemOpenResult,
  SystemToolEntry
} from "@codex-forge/protocol";

interface WorkspaceEntry {
  id: string;
  path: string;
}

interface SkillEntry {
  id?: string;
  name: string;
}

interface DetachedProcessOptions {
  cwd?: string;
  windowsHide?: boolean;
}

export async function spawnDetachedAndConfirm(
  command: string,
  args: string[],
  options: DetachedProcessOptions = {}
) {
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: options.windowsHide ?? true
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectLaunch(error);
      else {
        child.unref();
        resolveLaunch();
      }
    };
    const timer = setTimeout(() => finish(), 350);
    child.once("error", finish);
    child.once("spawn", () => setTimeout(() => finish(), 100));
  });
}

export interface DesktopNativeCapabilityDependencies {
  platform: NodeJS.Platform;
  userSkillRoot: string;
  projectSkillRoot: string;
  logRoot: string;
  logFiles: OpenLogLocationResult["files"];
  getDefaultWorkspacePath: () => string;
  getActiveWorkspaceId: () => string;
  readWorkspaces: () => Promise<WorkspaceEntry[]>;
  readSkills: () => Promise<SkillEntry[]>;
  normalizeSkillName: (name: string) => string;
  skillManifestExists: (path: string) => boolean;
  ensureDirectory: (path: string) => Promise<unknown>;
  openPath: (path: string) => Promise<string>;
  getTools: () => SystemToolEntry[];
  resolveToolCommand: (tool: SystemToolEntry) => string;
  commandAvailable: (command: string) => boolean;
  spawnDetached: (command: string, args: string[], options?: DetachedProcessOptions) => Promise<void>;
}

/** Owns finite native application, directory, and managed-skill opening capabilities. */
export class DesktopNativeCapabilityService {
  private readonly dependencies: DesktopNativeCapabilityDependencies;

  constructor(dependencies: DesktopNativeCapabilityDependencies) {
    this.dependencies = dependencies;
  }

  async openWorkspace(input: { workspaceId: string; target: "explorer" | "vscode" }): Promise<SystemOpenResult> {
    const workspace = (await this.dependencies.readWorkspaces()).find((item) => item.id === input.workspaceId);
    if (!workspace) throw new Error("Project not found.");
    if (input.target === "vscode") {
      if (!this.dependencies.commandAvailable("code")) {
        return { ok: false, detail: "未检测到 Visual Studio Code 命令。" };
      }
      try {
        await this.dependencies.spawnDetached("code", [workspace.path]);
        return { ok: true, detail: "已在 Visual Studio Code 中打开。" };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    }
    const detail = await this.dependencies.openPath(workspace.path);
    return { ok: !detail, detail: detail || "已在资源管理器中打开。" };
  }

  async openSkill(input: OpenSkillLocationInput): Promise<SystemOpenResult> {
    const skill = (await this.dependencies.readSkills()).find((item) => item.id === input.id || item.name === input.name);
    const skillName = this.dependencies.normalizeSkillName(skill?.name || input.name || "");
    if (!skillName) throw new Error("Skill not found.");
    const skillPath = [
      join(this.dependencies.userSkillRoot, skillName),
      join(this.dependencies.projectSkillRoot, skillName)
    ].find((candidate) => this.dependencies.skillManifestExists(join(candidate, "SKILL.md")));
    if (!skillPath) throw new Error(`Skill directory was not found: ${skillName}`);
    const detail = await this.dependencies.openPath(skillPath);
    return { ok: !detail, detail: detail || "Skill directory opened." };
  }

  async openLogs(): Promise<OpenLogLocationResult> {
    await this.dependencies.ensureDirectory(this.dependencies.logRoot);
    const detail = await this.dependencies.openPath(this.dependencies.logRoot);
    return {
      ok: !detail,
      detail: detail || "Log directory opened.",
      path: this.dependencies.logRoot,
      files: this.dependencies.logFiles
    };
  }

  async openTool(input: OpenSystemToolInput): Promise<SystemOpenResult> {
    const tool = this.dependencies.getTools().find((item) => item.id === input.toolId);
    if (!tool?.available) return { ok: false, detail: "未找到可用应用。" };
    const workspaces = await this.dependencies.readWorkspaces();
    const workspace = input.workspaceId
      ? workspaces.find((item) => item.id === input.workspaceId)
      : workspaces.find((item) => item.id === this.dependencies.getActiveWorkspaceId());
    const targetPath = workspace?.path || this.dependencies.getDefaultWorkspacePath();
    try {
      if (tool.id === "finder") {
        const detail = await this.dependencies.openPath(targetPath);
        return { ok: !detail, detail: detail || `已在${tool.label}中打开。` };
      }
      if (this.dependencies.platform === "darwin") {
        await this.dependencies.spawnDetached("open", ["-a", tool.appName, targetPath]);
        return { ok: true, detail: `已在 ${tool.label} 中打开当前项目。` };
      }
      const command = this.dependencies.resolveToolCommand(tool);
      if (!command) return { ok: false, detail: `未检测到 ${tool.label} 命令。` };
      let args = [targetPath];
      let windowsHide = true;
      if (tool.id === "terminal" && this.dependencies.platform === "win32") {
        windowsHide = false;
        if (/^wt(?:\.exe)?$/i.test(command)) args = ["-d", targetPath];
        else if (/powershell/i.test(command)) {
          args = ["-NoExit", "-Command", `Set-Location -LiteralPath '${targetPath.replace(/'/g, "''")}'`];
        } else {
          args = ["/K", `cd /d "${targetPath.replace(/"/g, '""')}"`];
        }
      } else if (tool.id === "terminal") {
        args = [];
      }
      await this.dependencies.spawnDetached(command, args, { cwd: targetPath, windowsHide });
      return { ok: true, detail: `已在 ${tool.label} 中打开当前项目。` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
