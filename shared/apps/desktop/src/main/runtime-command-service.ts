import { spawn, type ChildProcess } from "node:child_process";
import type { DesktopPreferences } from "@codex-forge/protocol";

interface CommandRuntime {
  workspacePath: string;
  sessionMachine: { events: unknown[] };
  queueShellCommand: (command: string, options: { permissionMode: "full" | "approval" }) => Promise<any>;
}

interface ModelTask {
  abortController: AbortController;
  runtime?: { cancelAgentLoop: (reason: string) => unknown };
  workspaceId?: string;
  threadId?: string;
  springTurnId?: string;
  springSessionId?: string;
  springApprovalId?: string;
  springToolCallId?: string;
  gatewayRequestId?: string;
}

interface CanceledThreadMetadata {
  workspaceId: string;
  threadId: string;
  status: "failed";
  statusLabel: string;
  lastEventSummary: string;
}

interface RuntimeCommandServiceOptions {
  getRuntime: () => CommandRuntime;
  getPreferences: () => Promise<DesktopPreferences>;
  runHook: (label: string, script: string) => Promise<unknown>;
  saveActiveThreadState: (summary: string) => Promise<unknown>;
  appendRuntimeEventsSince: (offset: number) => Promise<unknown>;
  getActiveModelRequestId: () => string;
  getModelTask: (requestId: string) => ModelTask | undefined;
  markModelRequestCanceled: (requestId: string) => void;
  /** Force-clear the concurrent task slot so a new turn is not blocked. */
  removeModelTask?: (requestId: string) => void;
  clearCanceledModelRequest?: (requestId: string) => void;
  updateThreadMetadata: (input: CanceledThreadMetadata) => Promise<unknown>;
  getShellEnv: () => NodeJS.ProcessEnv;
  spawnProcess?: typeof spawn;
  /** Best-effort spring turn.cancel after local stop (Hybrid). */
  cancelSpringTurn?: (input: {
    sessionId: string;
    turnId: string;
    reason: string;
  }) => Promise<unknown>;
}

/** Coordinates command policy, cancellation, hooks, persistence, and system-terminal launch. */
export class RuntimeCommandService {
  private readonly options: RuntimeCommandServiceOptions;
  private readonly spawnProcess: typeof spawn;

  constructor(options: RuntimeCommandServiceOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async cancelModelRequest(input: { requestId?: string }) {
    const requestId = input.requestId || this.options.getActiveModelRequestId();
    const task = requestId ? this.options.getModelTask(requestId) : undefined;
    if (!requestId || !task) return { ok: false, detail: "当前没有正在执行的模型任务。" };
    // Local stop first — 停止必停; spring coordination is best-effort after.
    this.options.markModelRequestCanceled(requestId);
    task.abortController.abort();
    task.runtime?.cancelAgentLoop("User requested cancellation.");
    if (task.workspaceId && task.threadId) {
      await this.options.updateThreadMetadata({
        workspaceId: task.workspaceId,
        threadId: task.threadId,
        status: "failed",
        statusLabel: "Cancelled",
        lastEventSummary: "用户已请求停止当前任务"
      });
    }
    const springTurnId = typeof task.springTurnId === "string" ? task.springTurnId.trim() : "";
    const springSessionId = typeof task.springSessionId === "string" && task.springSessionId.trim()
      ? task.springSessionId.trim()
      : (task.threadId || "");
    if (springTurnId && springSessionId && this.options.cancelSpringTurn) {
      try {
        await this.options.cancelSpringTurn({
          sessionId: springSessionId,
          turnId: springTurnId,
          reason: "user_stop"
        });
      } catch {
        // degrade offline / spring unavailable
      }
    }
    // Approval-retained or orphaned tasks never hit finishTask; clear the slot now.
    this.options.removeModelTask?.(requestId);
    this.options.clearCanceledModelRequest?.(requestId);
    return { ok: true, detail: "已请求停止当前任务。" };
  }

  async queueShellCommand(command: string) {
    const runtime = this.options.getRuntime();
    const preferences = await this.options.getPreferences();
    const eventOffset = runtime.sessionMachine.events.length;
    if (preferences.hooks.beforeCommand) {
      await this.options.saveActiveThreadState(`钩子 beforeCommand: ${command}`);
      await this.options.runHook("beforeCommand", preferences.hooks.beforeCommandScript);
    }
    const rawCommand = command.trim();
    const rawLowered = rawCommand.toLowerCase();
    const effectiveCommand = preferences.git.forcePushWithLease
      && /^git\s+push\b/.test(rawLowered)
      && !/\s--force(?:-with-lease)?\b/.test(rawLowered)
        ? rawCommand.replace(/^git\s+push\b/i, "git push --force-with-lease")
        : command;
    const lowered = effectiveCommand.trim().toLowerCase();
    const forceApproval = preferences.git.confirmBeforePush && /^git\s+push\b/.test(lowered);
    const permissionMode = !preferences.configuration.requireApprovalForShell && !forceApproval ? "full" : "approval";
    if (preferences.git.showDiffBeforeCommit && /^git\s+commit\b/.test(lowered)) {
      await runtime.queueShellCommand("git diff --cached --stat", { permissionMode: "full" });
      if (preferences.hooks.beforeCommit) {
        await this.options.runHook("beforeCommit", preferences.hooks.beforeCommitScript);
      }
      await this.options.saveActiveThreadState("提交前钩子：已生成 staged diff 摘要");
    }
    const snapshot = await runtime.queueShellCommand(effectiveCommand, { permissionMode });
    if (preferences.git.confirmBeforePush && /^git\s+push\b/.test(lowered)) {
      await this.options.saveActiveThreadState("推送前确认已启用：命令将保留审批请求");
    }
    if (preferences.hooks.afterCommand) {
      await this.options.runHook("afterCommand", preferences.hooks.afterCommandScript);
      await this.options.saveActiveThreadState(`钩子 afterCommand: ${command}`);
    }
    if (preferences.hooks.afterTask) await this.options.runHook("afterTask", preferences.hooks.afterTaskScript);
    await this.options.saveActiveThreadState(`已提交命令: ${command}`);
    await this.options.appendRuntimeEventsSince(eventOffset);
    return snapshot;
  }

  async openSystemTerminal(cwd: string) {
    const runtime = this.options.getRuntime();
    const safeCwd = typeof cwd === "string" && cwd.trim() ? cwd.trim() : runtime.workspacePath;
    const child: ChildProcess = this.spawnProcess("powershell.exe", [
      "-NoProfile", "-NoExit", "-Command",
      `Set-Location -LiteralPath '${safeCwd.replace(/'/g, "''")}'`
    ], { detached: true, stdio: "ignore", env: this.options.getShellEnv() });
    child.unref();
    await this.options.saveActiveThreadState(`已打开系统终端: ${safeCwd}`);
    return { ok: true };
  }
}
