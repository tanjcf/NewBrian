import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_OUTPUT_LIMITS,
  createBoundedStreamCollector,
  formatOutputTruncationNote,
  truncateHeadTail
} from "./command-output.js";

test("truncateHeadTail keeps prefix and suffix with Chinese note", () => {
  const head = "H".repeat(200_000);
  const mid = "M".repeat(100_000);
  const tail = "T".repeat(80_000);
  const result = truncateHeadTail(head + mid + tail);
  assert.equal(result.truncated, true);
  assert.equal(result.originalBytes, 380_000);
  assert.ok(result.text.startsWith("H".repeat(1000)));
  assert.match(result.text, /TTTT/);
  assert.match(result.text, /输出过大，已保留开头与结尾/);
  assert.ok(Buffer.byteLength(result.text, "utf8") > COMMAND_OUTPUT_LIMITS.headBytes);
  assert.doesNotMatch(result.text, /MMMMMMMMMM/);
});

test("truncateHeadTail leaves small payloads untouched", () => {
  const result = truncateHeadTail("hello-world");
  assert.equal(result.truncated, false);
  assert.equal(result.text, "hello-world");
});

test("bounded stream collector never retains more than head+tail windows", () => {
  const collector = createBoundedStreamCollector({
    headBytes: 100,
    tailBytes: 40,
    maxCaptureBytes: 10_000
  });
  collector.write(Buffer.from("A".repeat(100)));
  collector.write(Buffer.from("B".repeat(500)));
  collector.write(Buffer.from("C".repeat(40)));
  const finished = collector.finish((buf) => buf.toString("utf8"));
  assert.equal(finished.truncated, true);
  assert.equal(finished.originalBytes, 640);
  assert.match(finished.text, /^A{100}/);
  assert.match(finished.text, /C{40}/);
  assert.match(finished.text, /输出过大/);
  assert.ok(!finished.text.includes("B".repeat(50)));
});

test("formatOutputTruncationNote is non-security Chinese guidance", () => {
  const note = formatOutputTruncationNote(5_000_000, 256_000);
  assert.match(note, /并非安全策略拦截/);
  assert.match(note, /workspace\.search/);
});
