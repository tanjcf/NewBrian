import assert from "node:assert/strict";
import test from "node:test";

const { mainRollupOutput } = await import(
  new URL("../../build-output-policy.ts", import.meta.url).href
);

test("keeps shared main chunks beside the tool host worker", () => {
  assert.equal(mainRollupOutput.chunkFileNames, "[name]-[hash].js");
});
