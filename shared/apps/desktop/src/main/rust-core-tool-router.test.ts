import assert from "node:assert/strict";
import test from "node:test";
import { RustCoreToolRouter } from "./rust-core-tool-router.ts";

function completed(requestId: string, result: unknown) {
  return { protocol_version: "1" as const, request_id: requestId, status: "completed" as const, error_code: "", artifacts: [], result };
}

test("routes a compatible workspace read through Rust and preserves tool result shape", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const router = new RustCoreToolRouter({
    mode: () => "read",
    acquire: async () => ({
      request: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return completed(String(input.request_id), {
          path: "notes.txt", size_bytes: 12, data_base64: Buffer.from("hello\nworld\n").toString("base64")
        });
      },
      requestWithApproval: async () => { throw new Error("unused"); }
    }),
    shellCommand: (command) => ({ executable: "powershell.exe", args: ["-Command", command] })
  });
  const result = await router.invoke({
    projectId: "project-1", projectRoot: "C:/work", workspaceType: "software",
    toolName: "workspace.read", arguments: { path: "notes.txt" }, fallback: async () => ({ fallback: true })
  });
  assert.deepEqual(result, {
    ok: true, exitCode: 0, kind: "text", path: "notes.txt", content: "1|hello\n2|world",
    output: "1|hello\n2|world", offset: 1, limit: 2, totalLines: 2, totalBytes: 12,
    truncation: undefined, command: "read notes.txt"
  });
  assert.equal(calls[0]?.operation, "file.read");
});

test("routes only approved foreground shell execution and falls back safely", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let fallbacks = 0;
  const fallback = async () => { fallbacks += 1; return { fallback: true }; };
  const router = new RustCoreToolRouter({
    mode: () => "read-write",
    acquire: async () => ({
      request: async () => { throw new Error("unused"); },
      requestWithApproval: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return completed(String(input.request_id), {
          exit_code: 0, success: true,
          stdout_base64: Buffer.from("done\n").toString("base64"), stderr_base64: ""
        });
      }
    }),
    shellCommand: (command) => ({ executable: "powershell.exe", args: ["-Command", command] })
  });
  const result = await router.invoke({
    projectId: "project-1", projectRoot: "C:/work", workspaceType: "software",
    toolName: "shell.exec", arguments: { command: "echo done" }, fallback
  });
  assert.deepEqual(result, {
    ok: true, exitCode: 0, stdout: "done\n", stderr: "", output: "done",
    command: "echo done", requestedCommand: "echo done"
  });
  assert.equal(calls[0]?.operation, "process.run");
  assert.equal((calls[0]?.payload as { cwd?: string }).cwd, ".");
  assert.deepEqual(await router.invoke({
    projectId: "project-1", projectRoot: "C:/work", workspaceType: "software",
    toolName: "shell.exec", arguments: { command: "watch", background: true }, fallback
  }), { fallback: true });
  assert.equal(fallbacks, 1);
});

test("uses the existing tool path when disabled, unsupported, or Rust fails", async () => {
  let mode: "disabled" | "read" = "disabled";
  let fallbacks = 0;
  const router = new RustCoreToolRouter({
    mode: () => mode,
    acquire: async () => { throw new Error("BRAIN_CORE_UNAVAILABLE"); },
    shellCommand: (command) => ({ executable: "shell", args: [command] })
  });
  const input = {
    projectId: "project-1", projectRoot: "C:/work", workspaceType: "software",
    toolName: "workspace.read", arguments: { path: "notes.txt" },
    fallback: async () => { fallbacks += 1; return { fallback: true }; }
  };
  assert.deepEqual(await router.invoke(input), { fallback: true });
  mode = "read";
  assert.deepEqual(await router.invoke(input), { fallback: true });
  assert.equal(fallbacks, 2);
});
