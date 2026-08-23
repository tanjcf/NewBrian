/**
 * OpenClaw-style background shell session registry for agent tool calls.
 * Sessions survive across tool invocations in the same agentd/tool-host process.
 */
import { spawn } from "node:child_process";
import { createBoundedStreamCollector, COMMAND_OUTPUT_LIMITS, truncateHeadTail } from "./command-output.js";
import { decodeChildOutputBuffer } from "./windows-encoding.js";

const DEFAULT_YIELD_MS = 10_000;
const MAX_POLL_WAIT_MS = 30_000;
const DEFAULT_LOG_TAIL_LINES = 200;
const MAX_LOG_CHARS = COMMAND_OUTPUT_LIMITS.maxVisibleBytes ?? 256 * 1024;

/** @type {Map<string, import('./shell-process-registry.js').ShellProcessSession>} */
const sessions = new Map();
let sessionSeq = 0;

function nextSessionId() {
  sessionSeq += 1;
  return `proc_${Date.now().toString(36)}_${sessionSeq}`;
}

function decodeChunk(chunk) {
  return decodeChildOutputBuffer(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.unref();
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already exited
  }
}

function appendLog(session, text) {
  if (!text) return;
  session.logText += text;
  if (session.logText.length > MAX_LOG_CHARS * 4) {
    session.logText = session.logText.slice(-MAX_LOG_CHARS * 2);
  }
  session.lastOutputAt = Date.now();
}

function sliceLogLines(text, offset, limit) {
  const lines = String(text || "").split(/\r?\n/);
  // Drop trailing empty from final newline for paging UX.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  const usingDefaultTail = offset === undefined && limit === undefined;
  let start;
  let end;
  if (usingDefaultTail) {
    start = Math.max(0, total - DEFAULT_LOG_TAIL_LINES);
    end = total;
  } else {
    start = Math.max(0, Number(offset) || 0);
    const take = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : total - start;
    end = Math.min(total, start + take);
  }
  const sliced = lines.slice(start, end).join("\n");
  const note = usingDefaultTail && total > DEFAULT_LOG_TAIL_LINES
    ? `\n\n[showing last ${DEFAULT_LOG_TAIL_LINES} of ${total} lines; pass offset/limit to page]`
    : "";
  return { text: sliced + note, totalLines: total, offset: start, limit: end - start };
}

function sessionSnapshot(session) {
  return {
    sessionId: session.id,
    status: session.status,
    command: session.command,
    pid: session.pid,
    exitCode: session.exitCode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    background: session.background,
    cwd: session.cwd
  };
}

function attachChildHandlers(session, child) {
  session.pid = child.pid ?? null;
  session.child = child;
  session.stdin = child.stdin;

  child.stdout?.on("data", (chunk) => {
    const text = decodeChunk(chunk);
    appendLog(session, text);
    session.stdoutCollector?.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    const text = decodeChunk(chunk);
    appendLog(session, text);
    session.stderrCollector?.write(chunk);
  });
  child.on("error", (error) => {
    appendLog(session, `\n[process error] ${error instanceof Error ? error.message : String(error)}\n`);
    session.status = "exited";
    session.exitCode = 1;
    session.endedAt = Date.now();
    session.exitWaiters.forEach((resolve) => resolve());
    session.exitWaiters.clear();
  });
  child.on("close", (code, signal) => {
    session.status = "exited";
    session.exitCode = typeof code === "number" ? code : (signal ? 1 : 0);
    session.endedAt = Date.now();
    if (signal) appendLog(session, `\n[killed by ${signal}]\n`);
    session.exitWaiters.forEach((resolve) => resolve());
    session.exitWaiters.clear();
  });
}

function waitForExitOrTimeout(session, timeoutMs) {
  if (session.status === "exited") return Promise.resolve("exited");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.exitWaiters.delete(onExit);
      resolve("timeout");
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve("exited");
    };
    session.exitWaiters.add(onExit);
  });
}

function waitForOutputOrExit(session, timeoutMs, since) {
  if (session.status === "exited") return Promise.resolve("exited");
  if (session.lastOutputAt > since) return Promise.resolve("output");
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (session.status === "exited") {
        clearInterval(timer);
        clearTimeout(maxTimer);
        session.exitWaiters.delete(onExit);
        resolve("exited");
        return;
      }
      if (session.lastOutputAt > since) {
        clearInterval(timer);
        clearTimeout(maxTimer);
        session.exitWaiters.delete(onExit);
        resolve("output");
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        clearTimeout(maxTimer);
        session.exitWaiters.delete(onExit);
        resolve("timeout");
      }
    }, 50);
    const maxTimer = setTimeout(() => {
      clearInterval(timer);
      session.exitWaiters.delete(onExit);
      resolve("timeout");
    }, timeoutMs + 5);
    const onExit = () => {
      clearInterval(timer);
      clearTimeout(maxTimer);
      resolve("exited");
    };
    session.exitWaiters.add(onExit);
  });
}

/**
 * Start a shell session. When background=false and yieldMs>0, waits up to yieldMs
 * then returns a still-running sessionId if the process has not exited.
 */
export async function startShellProcess(options) {
  const {
    command,
    args,
    cwd,
    env,
    displayCommand,
    background = false,
    yieldMs = DEFAULT_YIELD_MS,
    signal
  } = options;

  const id = nextSessionId();
  const session = {
    id,
    command: displayCommand || (Array.isArray(args) ? `${command} ${args.join(" ")}` : String(command)),
    cwd,
    status: "running",
    pid: null,
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    background: Boolean(background),
    logText: "",
    lastOutputAt: Date.now(),
    child: null,
    stdin: null,
    exitWaiters: new Set(),
    stdoutCollector: createBoundedStreamCollector({ ...COMMAND_OUTPUT_LIMITS }),
    stderrCollector: createBoundedStreamCollector({ ...COMMAND_OUTPUT_LIMITS })
  };
  sessions.set(id, session);

  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  attachChildHandlers(session, child);

  const onAbort = () => {
    killProcessTree(session.pid);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const finishCollectors = () => {
    const stdout = session.stdoutCollector?.finish(decodeChildOutputBuffer) || { text: "", truncated: false, originalBytes: 0 };
    const stderr = session.stderrCollector?.finish(decodeChildOutputBuffer) || { text: "", truncated: false, originalBytes: 0 };
    return { stdout, stderr };
  };

  if (background) {
    return {
      ok: true,
      exitCode: 0,
      background: true,
      sessionId: id,
      status: session.status,
      pid: session.pid,
      output: `Started background session ${id} (pid ${session.pid ?? "?"}). Use shell.process to poll/log/kill.`,
      command: session.command
    };
  }

  const waitMs = Math.max(0, Number.isFinite(Number(yieldMs)) ? Number(yieldMs) : DEFAULT_YIELD_MS);
  const waitResult = await waitForExitOrTimeout(session, waitMs);
  if (waitResult === "exited") {
    const { stdout, stderr } = finishCollectors();
    const output = [stdout.text, stderr.text].filter(Boolean).join("\n") || session.logText;
    const capped = truncateHeadTail(output, COMMAND_OUTPUT_LIMITS);
    return {
      ok: session.exitCode === 0,
      exitCode: session.exitCode ?? 1,
      background: false,
      sessionId: id,
      status: "exited",
      pid: session.pid,
      stdout: capped.text,
      stderr: stderr.text,
      output: capped.text,
      outputTruncated: capped.truncated || stdout.truncated || stderr.truncated,
      originalOutputBytes: stdout.originalBytes + stderr.originalBytes,
      command: session.command
    };
  }

  session.background = true;
  return {
    ok: true,
    exitCode: 0,
    background: true,
    yielded: true,
    sessionId: id,
    status: "running",
    pid: session.pid,
    output: [
      `Command still running after ${waitMs}ms; moved to background session ${id} (pid ${session.pid ?? "?"}).`,
      "Use shell.process action=poll|log|kill with this sessionId.",
      sliceLogLines(session.logText).text
    ].filter(Boolean).join("\n\n"),
    command: session.command
  };
}

export function listShellProcesses() {
  return [...sessions.values()].map(sessionSnapshot);
}

export async function handleShellProcessAction(input = {}) {
  const action = String(input.action ?? "").trim().toLowerCase();
  if (!action) throw new Error("action is required (list|poll|log|write|kill|remove).");

  if (action === "list") {
    const items = listShellProcesses();
    return {
      ok: true,
      exitCode: 0,
      sessions: items,
      output: items.length
        ? items.map((s) => `${s.sessionId} ${s.status} pid=${s.pid ?? "-"} ${s.command}`).join("\n")
        : "No shell process sessions."
    };
  }

  const sessionId = String(input.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required for this action.");
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown sessionId: ${sessionId}`);

  if (action === "log") {
    const sliced = sliceLogLines(session.logText, input.offset, input.limit);
    return {
      ok: true,
      exitCode: 0,
      sessionId,
      status: session.status,
      exitCodeProcess: session.exitCode,
      totalLines: sliced.totalLines,
      output: sliced.text || "(no output yet)"
    };
  }

  if (action === "poll") {
    const timeout = Math.min(MAX_POLL_WAIT_MS, Math.max(0, Number(input.timeout) || 0));
    const since = session.lastOutputAt;
    if (timeout > 0 && session.status === "running") {
      await waitForOutputOrExit(session, timeout, since);
    }
    const sliced = sliceLogLines(session.logText, input.offset, input.limit);
    return {
      ok: true,
      exitCode: 0,
      sessionId,
      status: session.status,
      exitCodeProcess: session.exitCode,
      pid: session.pid,
      output: [
        `status=${session.status} exitCode=${session.exitCode ?? "null"}`,
        sliced.text || "(no output yet)"
      ].join("\n")
    };
  }

  if (action === "write") {
    const data = String(input.data ?? "");
    if (session.status !== "running") throw new Error(`Session ${sessionId} is not running.`);
    if (!session.stdin || session.stdin.destroyed || session.stdin.writableEnded) {
      throw new Error(`Session ${sessionId} stdin is not writable.`);
    }
    session.stdin.write(data);
    return {
      ok: true,
      exitCode: 0,
      sessionId,
      output: `Wrote ${Buffer.byteLength(data, "utf8")} bytes to session ${sessionId} stdin.`
    };
  }

  if (action === "kill") {
    if (session.status === "running") {
      killProcessTree(session.pid);
      await waitForExitOrTimeout(session, 3000);
    }
    return {
      ok: true,
      exitCode: 0,
      sessionId,
      status: session.status,
      exitCodeProcess: session.exitCode,
      output: `Killed session ${sessionId} (status=${session.status}).`
    };
  }

  if (action === "remove") {
    if (session.status === "running") {
      killProcessTree(session.pid);
      await waitForExitOrTimeout(session, 3000);
    }
    sessions.delete(sessionId);
    return {
      ok: true,
      exitCode: 0,
      sessionId,
      output: `Removed session ${sessionId}.`
    };
  }

  throw new Error(`Unsupported shell.process action: ${action}`);
}

/** Kill and clear all sessions (app shutdown / run cancel). */
export async function killAllShellProcesses() {
  const ids = [...sessions.keys()];
  for (const id of ids) {
    const session = sessions.get(id);
    if (!session) continue;
    if (session.status === "running") killProcessTree(session.pid);
  }
  for (const id of ids) {
    const session = sessions.get(id);
    if (session?.status === "running") await waitForExitOrTimeout(session, 2000);
    sessions.delete(id);
  }
  return ids.length;
}

/** Test helper */
export function _resetShellProcessRegistryForTests() {
  for (const session of sessions.values()) {
    if (session.status === "running") killProcessTree(session.pid);
  }
  sessions.clear();
  sessionSeq = 0;
}
