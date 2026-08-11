import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { runBoundedExtractor } = await import(new URL("./bounded-extractor.ts", import.meta.url).href) as typeof import("./bounded-extractor.js");

test("kills an extractor that exceeds its output budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-extractor-"));
  try {
    const script = join(root, "output.mjs");
    writeFileSync(script, "process.stdout.write('x'.repeat(8192));", "utf8");
    await assert.rejects(runBoundedExtractor({
      executable: process.execPath,
      extractorPath: script,
      filePath: "unused",
      maxOutputBytes: 1024,
      timeoutMs: 2_000
    }), /stdout exceeded 1024 bytes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("kills a long-running extractor at the deadline", async () => {
  const root = mkdtempSync(join(tmpdir(), "codecn-extractor-"));
  try {
    const script = join(root, "hang.mjs");
    writeFileSync(script, "setInterval(() => {}, 1000);", "utf8");
    const startedAt = Date.now();
    await assert.rejects(runBoundedExtractor({
      executable: process.execPath,
      extractorPath: script,
      filePath: "unused",
      maxOutputBytes: 1024,
      timeoutMs: 100
    }), /timed out after 100 milliseconds/);
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
