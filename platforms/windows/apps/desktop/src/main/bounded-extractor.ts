import { spawn } from "node:child_process";

export function runBoundedExtractor(input: {
  executable: string;
  extractorPath: string;
  filePath: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
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
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      failure = input.signal?.reason instanceof Error
        ? input.signal.reason
        : new Error("Attachment extraction cancelled.");
      child.kill();
    };
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
    if (input.signal?.aborted) abort();
    else input.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => appendBounded(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => appendBounded(stderr, chunk, "stderr"));
    child.once("error", (error) => {
      finish(() => rejectText(error));
    });
    child.once("close", (code) => {
      if (failure) {
        finish(() => rejectText(failure!));
        return;
      }
      if (code === 0) {
        finish(() => resolveText(Buffer.concat(stdout).toString("utf8")));
        return;
      }
      finish(() => rejectText(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Attachment extraction exited with code ${code}.`)));
    });
  });
}
