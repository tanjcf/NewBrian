import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Holon IPC registers only named business capabilities behind parsers", async () => {
  const source = await readFile(new URL("./holon-ipc.ts", import.meta.url), "utf8");
  for (const capability of ["getNextWorkItem", "startWorkItem", "cancelWorkItem", "getWorkItemState", "getKnowledgeSnapshot", "getSyncStatus", "submitFeedback"]) {
    assert.match(source, new RegExp(`desktopIpcChannels\\.holon\\.${capability}`));
  }
  assert.doesNotMatch(source, /gatewayOrigin|accessToken|ownerUserId|owner_user_id/);
  assert.match(source, /parseStartHolonWorkItemInput/);
  assert.match(source, /parseHolonFeedbackInput/);
});
