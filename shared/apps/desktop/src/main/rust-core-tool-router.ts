import { randomUUID } from "node:crypto";

export type RustCoreToolMode = "disabled" | "read" | "read-write";

interface RustCoreResponse {
  status: string;
  error_code: string;
  result?: unknown;
}

interface RustCoreToolClient {
  request(input: Record<string, unknown>): Promise<RustCoreResponse>;
  requestWithApproval(input: Record<string, unknown>): Promise<RustCoreResponse>;
}

interface RustCoreToolRouterOptions {
  mode: () => RustCoreToolMode | Promise<RustCoreToolMode>;
  acquire(binding: {
    projectId: string;
    projectRoot: string;
    workspaceType: string;
  }): Promise<RustCoreToolClient>;
  shellCommand(command: string): { executable: string; args: string[] };
}

interface RustCoreToolInvocation {
  projectId: string;
  projectRoot: string;
  workspaceType: string;
  toolName: string;
  arguments: Record<string, unknown>;
  fallback(): Promise<unknown>;
}

const FILE_READ_MAX_BYTES = 512 * 1024;
const FILE_READ_MAX_LINES = 2_000;
const PROCESS_OUTPUT_MAX_BYTES = 4 * 1024 * 1024;

function resultRecord(response: RustCoreResponse) {
  return response.result && typeof response.result === "object" && !Array.isArray(response.result)
    ? response.result as Record<string, unknown>
    : null;
}

function decodeBase64(value: unknown) {
  if (typeof value !== "string") throw new Error("BRAIN_CORE_RESULT_INVALID: base64 output is missing.");
  return Buffer.from(value, "base64");
}

function formatReadResult(path: string, bytes: Buffer, lineNumbers: boolean) {
  const text = bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines = text.split("\n");
  if (allLines.at(-1) === "" && text.endsWith("\n")) allLines.pop();
  const lines = allLines.slice(0, FILE_READ_MAX_LINES);
  const width = String(Math.max(1, lines.length)).length;
  let content = lineNumbers
    ? lines.map((line, index) => `${String(index + 1).padStart(width, " ")}|${line}`).join("\n")
    : lines.join("\n");
  const truncated = allLines.length > lines.length;
  const truncation = truncated ? {
    truncated: true,
    truncatedBy: "lines",
    totalLines: allLines.length,
    totalBytes: bytes.length,
    outputLines: lines.length,
    outputBytes: Buffer.byteLength(lines.join("\n")),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines: FILE_READ_MAX_LINES,
    maxBytes: FILE_READ_MAX_BYTES
  } : undefined;
  if (truncation) {
    content += `\n\n[truncated by lines: showing ${truncation.outputLines} lines / ${truncation.outputBytes} bytes of ${truncation.totalLines} lines / ${truncation.totalBytes} bytes. Use offset/limit or workspace.grep for a smaller window.]`;
  }
  return {
    ok: true,
    exitCode: 0,
    kind: truncated ? "truncated" : "text",
    path,
    content,
    output: content,
    offset: 1,
    limit: lines.length,
    totalLines: allLines.length,
    totalBytes: bytes.length,
    truncation,
    command: `read ${path}`
  };
}

export class RustCoreToolRouter {
  private readonly options: RustCoreToolRouterOptions;

  constructor(options: RustCoreToolRouterOptions) {
    this.options = options;
  }

  async invoke(input: RustCoreToolInvocation) {
    const mode = await this.options.mode();
    if (mode === "disabled") return input.fallback();
    if (input.toolName === "workspace.read") return this.read(input);
    if (mode === "read-write" && input.toolName === "shell.exec") return this.shell(input);
    return input.fallback();
  }

  private async read(input: RustCoreToolInvocation) {
    const path = typeof input.arguments.path === "string" ? input.arguments.path.trim() : "";
    if (!path || input.arguments.offset !== undefined || input.arguments.limit !== undefined) {
      return input.fallback();
    }
    try {
      const client = await this.options.acquire(input);
      const response = await client.request({
        request_id: `rust-file-${randomUUID()}`,
        project_id: input.projectId,
        workspace_type: input.workspaceType,
        operation: "file.read",
        approval_token: "",
        resource_limits: { timeout_ms: 0, max_output_bytes: FILE_READ_MAX_BYTES },
        payload: { path }
      });
      if (response.status !== "completed") return input.fallback();
      const result = resultRecord(response);
      if (!result) return input.fallback();
      return formatReadResult(path, decodeBase64(result.data_base64), input.arguments.lineNumbers !== false);
    } catch {
      return input.fallback();
    }
  }

  private async shell(input: RustCoreToolInvocation) {
    const command = typeof input.arguments.command === "string" ? input.arguments.command.trim() : "";
    if (!command || input.arguments.background === true || input.arguments.yieldMs !== undefined) {
      return input.fallback();
    }
    const workdir = typeof input.arguments.workdir === "string" && input.arguments.workdir.trim()
      ? input.arguments.workdir.trim()
      : ".";
    try {
      const client = await this.options.acquire(input);
      const shell = this.options.shellCommand(command);
      const response = await client.requestWithApproval({
        request_id: `rust-process-${randomUUID()}`,
        project_id: input.projectId,
        workspace_type: input.workspaceType,
        operation: "process.run",
        resource_limits: { timeout_ms: 0, max_output_bytes: PROCESS_OUTPUT_MAX_BYTES },
        payload: { executable: shell.executable, args: shell.args, cwd: workdir }
      });
      if (response.status !== "completed") return input.fallback();
      const result = resultRecord(response);
      if (!result) return input.fallback();
      const stdout = decodeBase64(result.stdout_base64).toString("utf8");
      const stderr = decodeBase64(result.stderr_base64).toString("utf8");
      const exitCode = typeof result.exit_code === "number" ? result.exit_code : 1;
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      return {
        ok: result.success === true && exitCode === 0,
        exitCode,
        stdout,
        stderr,
        output,
        command,
        requestedCommand: command
      };
    } catch {
      return input.fallback();
    }
  }
}
