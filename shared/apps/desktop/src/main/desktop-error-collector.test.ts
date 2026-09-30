import assert from "node:assert/strict";
import test from "node:test";

const { DesktopErrorCollector, isReportableChildProcessGone } = await import(
  new URL("./desktop-error-collector.ts", import.meta.url).href
);

test("does not report Electron's recoverable Network Service utility restart as an application exception", () => {
  assert.equal(isReportableChildProcessGone({
    type: "Utility",
    reason: "crashed",
    exitCode: -1073741205,
    serviceName: "network.mojom.NetworkService",
    name: "Network Service"
  }), false);
  assert.equal(isReportableChildProcessGone({
    type: "GPU",
    reason: "crashed",
    exitCode: -1,
    name: "GPU Process"
  }), true);
});

test("serializes periodic uploads and keeps collecting after an upload failure", async () => {
  const calls: string[] = [];
  let activeUploads = 0;
  let maxActiveUploads = 0;
  let scheduled: (() => void) | undefined;
  const collector = new DesktopErrorCollector({
    capture: async (failure: { kind: string }) => { calls.push(`capture:${failure.kind}`); },
    flush: async () => {
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      calls.push("flush");
      await Promise.resolve();
      activeUploads -= 1;
      if (calls.filter((item) => item === "flush").length === 1) throw new Error("offline");
    },
    setInterval: (callback: () => void) => { scheduled = callback; return { unref() {} }; },
    clearInterval: () => undefined,
    onDiagnostic: () => undefined
  });

  collector.start();
  await collector.report({ kind: "model_request_failed", message: "local guard failed" });
  scheduled?.();
  scheduled?.();
  await collector.whenIdle();

  assert.deepEqual(calls, ["flush", "capture:model_request_failed", "flush", "flush", "flush"]);
  assert.equal(maxActiveUploads, 1);
});

test("stop clears the background interval", () => {
  let cleared = false;
  const timer = { unref() {} };
  const collector = new DesktopErrorCollector({
    capture: async () => undefined,
    flush: async () => undefined,
    setInterval: () => timer,
    clearInterval: (value: unknown) => { cleared = value === timer; },
    onDiagnostic: () => undefined
  });
  collector.start();
  collector.stop();
  assert.equal(cleared, true);
});

test("report returns the durable capture and delivery results", async () => {
  const collector = new DesktopErrorCollector({
    capture: async () => ({ id: "desktop-error-1" }),
    flush: async () => ({ uploaded: 1, failed: 0 }),
    onDiagnostic: () => undefined
  });

  assert.deepEqual(await collector.reportWithResult({ kind: "user_reported_usage_exception", message: "界面空白" }), {
    capture: { id: "desktop-error-1" },
    flush: { uploaded: 1, failed: 0 }
  });
});
