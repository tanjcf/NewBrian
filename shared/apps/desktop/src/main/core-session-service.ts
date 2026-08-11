import { resolve } from "node:path";

interface CoreRuntime {
  workspacePath: string;
  sessionMachine: { events: unknown[] };
  getSnapshot: () => any;
  queueWorkspaceScan: () => Promise<any>;
  queueShellCommand: (command: string, options: { permissionMode: "approval" | "full" }) => Promise<any>;
  generatePatch: (input: { filePath: string; searchText: string; replaceText: string }) => Promise<any>;
  applyPatch: () => Promise<any>;
}

interface CoreSessionServiceOptions {
  appName: string;
  platform: string;
  phase: string;
  shell: string;
  getRuntime: () => CoreRuntime;
  getActiveThread: () => Promise<{ workspace?: any; thread?: any }>;
  readThreadState: (workspace: any, thread: any) => Promise<any>;
  refreshWorkspaceTree: (runtime: CoreRuntime) => Promise<unknown>;
  mergeSnapshot: (snapshot: any, threadState: any) => any;
  getPreferences: () => Promise<any>;
  saveActiveThreadState: (summary: string) => Promise<unknown>;
  appendRuntimeEventsSince: (offset: number) => Promise<unknown>;
}

/** Coordinates core runtime operations with active-thread persistence outside IPC wiring. */
export class CoreSessionService {
  private readonly options: CoreSessionServiceOptions;

  constructor(options: CoreSessionServiceOptions) {
    this.options = options;
  }

  async bootstrap() {
    const runtime = this.options.getRuntime();
    return {
      appName: this.options.appName,
      platform: this.options.platform,
      phase: this.options.phase,
      shell: this.options.shell,
      workspacePath: runtime.workspacePath
    };
  }

  async snapshot() {
    const runtime = this.options.getRuntime();
    const { workspace, thread } = await this.options.getActiveThread();
    if (!workspace || !thread) return runtime.getSnapshot();
    const threadState = await this.options.readThreadState(workspace, thread);
    if (runtime.workspacePath === resolve(workspace.path)) {
      await this.options.refreshWorkspaceTree(runtime);
    }
    return this.options.mergeSnapshot(runtime.getSnapshot(), threadState);
  }

  async queueWorkspaceScan() {
    const runtime = this.options.getRuntime();
    const eventOffset = runtime.sessionMachine.events.length;
    const snapshot = await runtime.queueWorkspaceScan();
    await this.options.saveActiveThreadState("已刷新工作区文件树");
    await this.options.appendRuntimeEventsSince(eventOffset);
    return snapshot;
  }

  async queueGitStatus() {
    const runtime = this.options.getRuntime();
    const preferences = await this.options.getPreferences();
    const eventOffset = runtime.sessionMachine.events.length;
    const permissionMode = preferences.configuration.requireApprovalForShell ? "approval" : "full";
    const snapshot = await runtime.queueShellCommand(preferences.git.statusCommand, { permissionMode });
    await this.options.saveActiveThreadState("已记录 Git 状态");
    await this.options.appendRuntimeEventsSince(eventOffset);
    return snapshot;
  }

  async generatePatch(input: { filePath: string; searchText: string; replaceText: string }) {
    const snapshot = await this.options.getRuntime().generatePatch(input);
    await this.options.saveActiveThreadState(`已生成补丁: ${input.filePath}`);
    return snapshot;
  }

  async applyPatch() {
    const snapshot = await this.options.getRuntime().applyPatch();
    await this.options.saveActiveThreadState("已应用补丁");
    return snapshot;
  }
}
