import type { DesktopBootstrapStatus } from "@codex-forge/protocol";
import type {
  BootstrapConfigFile,
  DesktopBootstrapStateFile,
  DesktopBootstrapTaskDefinition,
  DesktopBootstrapTaskState
} from "./bootstrap-config-policy.js";

export interface BootstrapStateDependencies {
  configPath: string;
  bundledConfigPath: string;
  statePath: string;
  defaultConfig: BootstrapConfigFile;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, content: string) => Promise<unknown>;
  ensureStateDirectory: () => Promise<unknown>;
  parseJson: <T>(raw: string) => T;
  normalizeConfig: (input: Partial<BootstrapConfigFile>, defaults: BootstrapConfigFile) => BootstrapConfigFile;
  createTaskDefinitions: (config: BootstrapConfigFile) => DesktopBootstrapTaskDefinition[];
  mergeTaskStates: (
    definitions: DesktopBootstrapTaskDefinition[],
    state?: DesktopBootstrapStateFile | null
  ) => DesktopBootstrapTaskState[];
  createStatusPayload: (
    state: DesktopBootstrapStateFile | null | undefined,
    tasks: DesktopBootstrapTaskState[]
  ) => DesktopBootstrapStatus;
  appendDebugLog: (entry: string) => Promise<unknown>;
  nowIso: () => string;
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Owns bootstrap configuration fallback and durable task-state transitions. */
export class BootstrapStateService {
  private readonly dependencies: BootstrapStateDependencies;

  constructor(dependencies: BootstrapStateDependencies) {
    this.dependencies = dependencies;
  }

  normalizeConfig(input: Partial<BootstrapConfigFile>) {
    return this.dependencies.normalizeConfig(input, this.dependencies.defaultConfig);
  }

  async readBundledConfig(): Promise<BootstrapConfigFile | null> {
    try {
      return this.normalizeConfig(this.dependencies.parseJson(await this.dependencies.readText(this.dependencies.bundledConfigPath)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      await this.dependencies.appendDebugLog(
        `bundled bootstrap config read failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async readConfig() {
    try {
      return this.normalizeConfig(this.dependencies.parseJson(await this.dependencies.readText(this.dependencies.configPath)));
    } catch (error) {
      if (isMissingFile(error)) return (await this.readBundledConfig()) ?? this.dependencies.defaultConfig;
      throw error;
    }
  }

  async getTaskDefinitions() {
    return this.dependencies.createTaskDefinitions(await this.readConfig());
  }

  async readState(): Promise<DesktopBootstrapStateFile> {
    try {
      const parsed = this.dependencies.parseJson<Partial<DesktopBootstrapStateFile>>(
        await this.dependencies.readText(this.dependencies.statePath)
      );
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (error) {
      if (isMissingFile(error)) return {};
      if (error instanceof SyntaxError) {
        await this.dependencies.appendDebugLog(`desktop bootstrap state parse failed, resetting state: ${error.message}`);
        return {};
      }
      throw error;
    }
  }

  async writeState(state: DesktopBootstrapStateFile) {
    await this.dependencies.ensureStateDirectory();
    await this.dependencies.writeText(this.dependencies.statePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  async createTasks(state?: DesktopBootstrapStateFile | null) {
    return this.dependencies.mergeTaskStates(await this.getTaskDefinitions(), state);
  }

  async toStatusPayload(state?: DesktopBootstrapStateFile | null) {
    return this.dependencies.createStatusPayload(state, await this.createTasks(state));
  }

  async updateTaskState(
    state: DesktopBootstrapStateFile,
    taskId: string,
    input: {
      overallStatus: "ready" | "manual_required" | "pending" | "running";
      message: string;
      detail?: string;
    }
  ) {
    const now = this.dependencies.nowIso();
    const tasks = await this.createTasks(state);
    return this.writeState({
      ...state,
      overall: {
        status: input.overallStatus,
        currentTaskId: taskId,
        message: input.message,
        updatedAt: now
      },
      tasks: tasks.map((task) => task.id === taskId ? {
        ...task,
        status: input.overallStatus,
        detail: input.detail ?? input.message,
        startedAt: task.startedAt ?? now,
        completedAt: input.overallStatus === "ready" || input.overallStatus === "manual_required" ? now : undefined
      } : task)
    });
  }
}
