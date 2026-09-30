import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("learning IPC exposes bounded actions without transport or identity inputs", async () => {
  const source = await readFile(new URL("./learning-ipc.ts", import.meta.url), "utf8");
  for (const capability of ["listCandidates", "searchPrivateKnowledge", "approveCandidate", "rejectCandidate", "rollbackPrivateSkill"]) {
    assert.match(source, new RegExp(`desktopIpcChannels\\.learning\\.${capability}`));
  }
  assert.doesNotMatch(source, /gatewayOrigin|accessToken|ownerUserId|owner_user_id/);
  assert.match(source, /parseLearningSearchInput/);
  assert.match(source, /parseLearningRollbackInput/);
});
