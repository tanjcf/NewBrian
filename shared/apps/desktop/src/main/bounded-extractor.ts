import { spawn } from "node:child_process";

export function runBoundedExtractor(input: {
  executable: string;
  extractorPath: string;
  filePath: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes: number;
}) {
  return new Promise<string>((resolveText, rejectText) => {
    const child = spawn(input.executable, ["--max-old-space-size=256", input.extractorPath, input.filePath], {
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | null = null;
    const appendBounded = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      const nextSize = (stream === "stdout" ? stdoutBytes : stderrBytes) + chunk.length;
      if (nextSize > input.maxOutputBytes) {
        failure = new Error(`Attachment extractor ${stream} exceeded ${input.maxOutputBytes} bytes.`);
        child.kill();
        return;
      }
      if (stream === "stdout") stdoutBytes = nextSize;
      else stderrBytes = nextSize;
      chunks.push(chunk);
    };
    const timeoutMs = input.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => {
      failure = new Error(`Attachment extraction timed out after ${timeoutMs} milliseconds.`);
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => appendBounded(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => appendBounded(stderr, chunk, "stderr"));
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectText(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (failure) {
        rejectText(failure);
        return;
      }
      if (code === 0) {
        resolveText(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      rejectText(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Attachment extraction exited with code ${code}.`));
    });
  });
}
