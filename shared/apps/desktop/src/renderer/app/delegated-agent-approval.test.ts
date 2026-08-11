import assert from "node:assert/strict";
import test from "node:test";

const { respondToDelegatedAgentApproval } = await import(
  new URL("./delegated-agent-approval.ts", import.meta.url).href
);

test("absorbs a stale delegated approval rejection from an older main process", async () => {
  let refreshed = 0;
  const result = await respondToDelegatedAgentApproval({
    respond: async () => {
      throw new Error(
        "Error invoking remote method 'phase1:respond-delegated-agent-approval': Error: Delegated task is not awaiting approval and cannot be resumed."
      );
    },
    refresh: async () => {
      refreshed += 1;
    }
  });

  assert.deepEqual(result, { ok: false, stale: true });
  assert.equal(refreshed, 1);
});

test("treats a resolved stale approval result as stale and refreshes", async () => {
  let refreshed = 0;
  const result = await respondToDelegatedAgentApproval({
    respond: async () => ({ ok: false, stale: true }),
    refresh: async () => {
      refreshed += 1;
    }
  });

  assert.deepEqual(result, { ok: false, stale: true });
  assert.equal(refreshed, 1);
});

test("returns an unexpected approval failure after refreshing delegated state", async () => {
  const failure = new Error("approval service unavailable");
  let refreshed = 0;
  const result = await respondToDelegatedAgentApproval({
    respond: async () => {
      throw failure;
    },
    refresh: async () => {
      refreshed += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.stale, false);
  assert.equal(result.error, failure);
  assert.equal(refreshed, 1);
});
