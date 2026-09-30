import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  downloadResumableToFile,
  parseContentRange,
  readPartialByteLength,
  sha256FileStreaming
} = await import(new URL("./desktop-app-update-download.ts", import.meta.url).href);

test("parseContentRange reads start/end/total", () => {
  assert.deepEqual(parseContentRange("bytes 100-199/200"), {
    start: 100,
    end: 199,
    total: 200
  });
  assert.equal(parseContentRange("invalid"), null);
});

test("sha256FileStreaming matches full-buffer digest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "newbrain-hash-"));
  const path = join(dir, "blob.bin");
  const payload = Buffer.alloc(64 * 1024, 7);
  await writeFile(path, payload);
  try {
    const streamed = await sha256FileStreaming(path);
    const expected = createHash("sha256").update(payload).digest("hex");
    assert.equal(streamed, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloadResumableToFile resumes with Range and appends on 206", async () => {
  const full = Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
  const dir = await mkdtemp(join(tmpdir(), "newbrain-resume-"));
  const partialPath = join(dir, "NewBrain-1.3.6.msi.partial");
  const firstHalf = full.subarray(0, 10);
  await writeFile(partialPath, firstHalf);
  const rangeHeaders: string[] = [];
  const server = createServer((request, response) => {
    const range = String(request.headers.range || "");
    rangeHeaders.push(range);
    if (range.startsWith("bytes=")) {
      const start = Number(range.slice("bytes=".length).split("-")[0] || 0);
      const slice = full.subarray(start);
      response.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${full.length - 1}/${full.length}`,
        "Content-Length": String(slice.length)
      });
      response.end(slice);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Length": String(full.length)
    });
    response.end(full);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const url = `http://127.0.0.1:${address.port}/pkg.msi`;
  try {
    assert.equal(await readPartialByteLength(partialPath), 10);
    const progress: Array<{ receivedBytes: number; resumedFrom: number }> = [];
    const result = await downloadResumableToFile({
      url,
      partialPath,
      onProgress: (item) => progress.push({
        receivedBytes: item.receivedBytes,
        resumedFrom: item.resumedFrom
      })
    });
    assert.equal(result.httpStatus, 206);
    assert.equal(result.resumedFrom, 10);
    assert.equal(result.bytesOnDisk, full.length);
    assert.deepEqual(await readFile(partialPath), full);
    assert.ok(rangeHeaders.some((item) => item === "bytes=10-"));
    assert.ok(progress.some((item) => item.resumedFrom === 10));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloadResumableToFile rewrites when server returns 200 for Range", async () => {
  const full = Buffer.from("full-package-bytes-for-restart");
  const dir = await mkdtemp(join(tmpdir(), "newbrain-restart-"));
  const partialPath = join(dir, "NewBrain-1.3.6.msi.partial");
  await writeFile(partialPath, Buffer.from("stale-partial"));
  const server = createServer((request, response) => {
    // Ignore Range and always send full body (common CDN / proxy behavior).
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(full.length)
    });
    response.end(full);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const url = `http://127.0.0.1:${address.port}/pkg.msi`;
  try {
    const result = await downloadResumableToFile({ url, partialPath });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.resumedFrom, 0);
    assert.deepEqual(await readFile(partialPath), full);
    assert.equal((await stat(partialPath)).size, full.length);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
