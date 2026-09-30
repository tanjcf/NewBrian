import assert from "node:assert/strict";
import test from "node:test";

const { MediaGenerationHttpError } = await import(
  new URL("./media-generation-gateway.ts", import.meta.url).href
);
const { executeWithMediaAuthenticationRetry } = await import(
  new URL("./media-auth-retry.ts", import.meta.url).href
);

test("refreshes once after media 401 and resumes the same operation", async () => {
  const tokens: string[] = [];
  let refreshes = 0;
  const result = await executeWithMediaAuthenticationRetry({
    initialToken: "expired",
    refreshAccessToken: async () => {
      refreshes += 1;
      return "fresh";
    },
    execute: async (token: string) => {
      tokens.push(token);
      if (token === "expired") {
        throw new MediaGenerationHttpError(401, "Unauthorized", null);
      }
      return "generated";
    }
  });
  assert.equal(result, "generated");
  assert.equal(refreshes, 1);
  assert.deepEqual(tokens, ["expired", "fresh"]);
});

test("does not refresh or retry provider failures", async () => {
  let attempts = 0;
  let refreshes = 0;
  await assert.rejects(() => executeWithMediaAuthenticationRetry({
    initialToken: "valid",
    refreshAccessToken: async () => {
      refreshes += 1;
      return "fresh";
    },
    execute: async () => {
      attempts += 1;
      throw new MediaGenerationHttpError(503, "provider unavailable", null);
    }
  }), /provider unavailable/);
  assert.equal(attempts, 1);
  assert.equal(refreshes, 0);
});

test("never refreshes a 403 permission denial", async () => {
  let refreshes = 0;
  await assert.rejects(() => executeWithMediaAuthenticationRetry({
    initialToken: "valid",
    refreshAccessToken: async () => { refreshes += 1; return "fresh"; },
    execute: async () => { throw new MediaGenerationHttpError(403, "Forbidden", { code: "MODEL_NOT_ALLOWED" }); }
  }), /Forbidden/);
  assert.equal(refreshes, 0);
});

test("shares one refresh across concurrent expired requests", async () => {
  let refreshes = 0;
  let release!: (token: string) => void;
  const refresh = () => new Promise<string>((resolve) => { refreshes += 1; release = resolve; });
  const execute = async (token: string) => {
    if (token === "expired") throw new MediaGenerationHttpError(401, "Unauthorized", {});
    return "ok";
  };
  const a = executeWithMediaAuthenticationRetry({ initialToken: "expired", refreshAccessToken: refresh, execute });
  const b = executeWithMediaAuthenticationRetry({ initialToken: "expired", refreshAccessToken: refresh, execute });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshes, 1);
  release("fresh");
  assert.deepEqual(await Promise.all([a, b]), ["ok", "ok"]);
});

test("preserves the original 401 when refresh is unavailable", async () => {
  let attempts = 0;
  await assert.rejects(() => executeWithMediaAuthenticationRetry({
    initialToken: "expired",
    refreshAccessToken: async () => "",
    execute: async () => {
      attempts += 1;
      throw new MediaGenerationHttpError(401, "Unauthorized", null);
    }
  }), /Unauthorized/);
  assert.equal(attempts, 1);
});
