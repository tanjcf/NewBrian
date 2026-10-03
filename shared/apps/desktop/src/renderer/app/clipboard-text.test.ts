import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard } from "./clipboard-text.ts";

test("copy uses the desktop clipboard bridge when the page is not focused", async () => {
  const calls: string[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    newbrain: {
      writeClipboardText: async (text: string) => {
        calls.push(text);
        return { ok: true };
      }
    }
  };
  try {
    await copyTextToClipboard("巡检结果");
    assert.deepEqual(calls, ["巡检结果"]);
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
});
