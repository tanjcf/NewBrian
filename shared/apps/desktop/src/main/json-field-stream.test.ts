import assert from "node:assert/strict";
import test from "node:test";

const modulePromise = import(new URL("./json-field-stream.ts", import.meta.url).href) as Promise<typeof import("./json-field-stream.js")>;

test("streams only the requested JSON string field", async () => {
  const { JsonStringFieldStream } = await modulePromise;
  const stream = new JsonStringFieldStream("outline");
  assert.equal(stream.push('{"analysis":"hidden","out'), "");
  assert.equal(stream.push('line":"一、开场'), "一、开场");
  assert.equal(stream.push('\\n二、部署","prompt":"确认"}'), "\n二、部署");
});

test("handles split unicode escapes without emitting malformed text", async () => {
  const { JsonStringFieldStream } = await modulePromise;
  const stream = new JsonStringFieldStream("finalDraft");
  assert.equal(stream.push('{"finalDraft":"\\u540'), "");
  assert.equal(stream.push('c\\u5fd7'), "同志");
  assert.equal(stream.push('\\u4eec"}'), "们");
});
