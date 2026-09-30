import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/** Hard cap on a single JSON response line from the worker (not shell stdout). */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const RETRYABLE_HOST_FAILURES = new Set(["exit", "protocol"]);

export function formatToolHostFailure(hostFailure, detail = "") {
  const suffix = detail ? ` ${detail}`.trimEnd() : "";
  switch (hostFailure) {
    case "output_limit":
      return `工具宿主返回载荷过大已中止，并非安全策略拦截。请改用 workspace.glob / workspace.grep，或缩小 Select-String/递归检索范围后重试。${suffix}`.trim();
    case "exit":
      return `工具宿主进程异常退出，并非安全策略拦截。常见于超大递归检索或构建日志撑爆内存；请改用 workspace.glob / workspace.grep / 限制输出后重试（系统已尝试自动重启宿主一次）。${suffix}`.trim();
    case "aborted":
      return `工具宿主执行已取消。${suffix}`.trim();
    case "spawn":
      return `无法启动工具宿主进程：${detail || "spawn failed"}`;
    case "protocol":
      return `工具宿主返回了无效响应，并非安全策略拦截。若持续出现请缩小命令输出后重试。${suffix}`.trim();
    case "worker_error":
      return detail || "工具宿主内部执行失败。";
    default:
      return detail || "工具宿主执行失败。";
  }
}

function isRetryableHostFailure(result) {
  return Boolean(result?.hostFailure) && RETRYABLE_HOST_FAILURES.has(result.hostFailure);
}

export class ToolHostClient {
  constructor(input = {}) {
    this.workerUrl = input.workerUrl ?? new URL("./tool-host-worker.js", import.meta.url);
    this.maxRetries = Math.max(0, input.maxRetries ?? 1);
  }

  invoke(name, input, context) {
    return this.invokeWithRetry(name, input, context, 0);
  }

  async invokeWithRetry(name, input, context, attempt) {
    const result = await this.invokeOnce(name, input, context);
    if (
      attempt < this.maxRetries
      && isRetryableHostFailure(result)
      && !context.abortSignal?.aborted
    ) {
      const retry = await this.invokeOnce(name, input, context);
      if (retry.ok) {
        return { ...retry, hostRestarted: true };
      }
      return {
        ...retry,
        hostRestarted: true,
        output: [
          String(retry.output || "").trim(),
          "（工具宿主已自动重启一次仍失败。）"
        ].filter(Boolean).join("\n")
      };
    }
    return result;
  }

  invokeOnce(name, input, context) {
    const id = `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      const workerPath = this.workerUrl instanceof URL ? fileURLToPath(this.workerUrl) : String(this.workerUrl);
      const child = spawn(process.execPath, [workerPath], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
      });
      let settled = false;
      let responseBytes = 0;
      let stderr = "";
      const terminate = () => {
        if (!child.pid) return;
        if (process.platform === "win32") {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.unref();
        } else {
          child.kill("SIGKILL");
        }
      };
      const abort = () => finish({
        ok: false,
        toolName: name,
        exitCode: 1,
        output: formatToolHostFailure("aborted"),
        durationMs: 0,
        hostFailure: "aborted"
      }, true);
      const finish = (result, forceTerminate = false) => {
        if (settled) return;
        settled = true;
        context.abortSignal?.removeEventListener("abort", abort);
        if (forceTerminate) terminate();
        resolve(result);
      };
      const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      output.on("line", (line) => {
        responseBytes += Buffer.byteLength(line, "utf8");
        if (responseBytes > MAX_RESPONSE_BYTES) {
          finish({
            ok: false,
            toolName: name,
            exitCode: 1,
            output: formatToolHostFailure("output_limit"),
            durationMs: 0,
            hostFailure: "output_limit"
          }, true);
          return;
        }
        try {
          const response = JSON.parse(line);
          if (response.id !== id) return;
          finish(response.error
            ? {
              ok: false,
              toolName: name,
              exitCode: 1,
              output: formatToolHostFailure("worker_error", response.error),
              durationMs: 0,
              hostFailure: "worker_error"
            }
            : response.result);
        } catch {
          finish({
            ok: false,
            toolName: name,
            exitCode: 1,
            output: formatToolHostFailure("protocol"),
            durationMs: 0,
            hostFailure: "protocol"
          }, true);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
      });
      child.on("error", (error) => finish({
        ok: false,
        toolName: name,
        exitCode: 1,
        output: formatToolHostFailure("spawn", error.message),
        durationMs: 0,
        hostFailure: "spawn"
      }));
      child.on("exit", (code) => {
        if (!settled) {
          finish({
            ok: false,
            toolName: name,
            exitCode: code ?? 1,
            output: formatToolHostFailure("exit", stderr.trim()),
            durationMs: 0,
            hostFailure: "exit"
          });
        }
      });
      if (context.abortSignal?.aborted) {
        abort();
        return;
      }
      context.abortSignal?.addEventListener("abort", abort, { once: true });
      child.stdin.end(`${JSON.stringify({ id, name, input, context: { workspacePath: context.workspacePath, shellEnv: context.shellEnv ?? {} } })}\n`);
    });
  }
}
