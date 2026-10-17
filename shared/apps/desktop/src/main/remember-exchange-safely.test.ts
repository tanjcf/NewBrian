import assert from "node:assert/strict";
import test from "node:test";

const { rememberExchangeSafely } = await import(
  new URL("./remember-exchange-safely.ts", import.meta.url).href
);

test("rememberExchange failure returns an empty shadow instead of throwing", async () => {
  const notes: string[] = [];
  const result = await rememberExchangeSafely(
    async () => {
      throw new Error("shadow failed");
    },
    (detail: string) => {
      notes.push(detail);
    }
  );
  assert.equal(result.memory, null);
  assert.deepEqual(result.shadow.changed, []);
  assert.deepEqual(notes, ["shadow failed"]);
});

test("rememberExchange success is returned unchanged", async () => {
  const result = await rememberExchangeSafely(
    async () => ({ memory: { id: "m1" }, shadow: { changed: ["user-output-rules"], skillName: "demo" } }),
    () => {
      throw new Error("should not report");
    }
  );
  assert.equal(result.memory.id, "m1");
  assert.deepEqual(result.shadow.changed, ["user-output-rules"]);
});
