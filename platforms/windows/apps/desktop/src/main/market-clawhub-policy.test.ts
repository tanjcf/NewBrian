import assert from "node:assert/strict";
import test from "node:test";

const { assertDirectClawhubAllowed, resolveDirectClawhubAllowed } = await import(
  new URL("./market-clawhub-policy.ts", import.meta.url).href
);

test("defaults direct ClawHub to closed", () => {
  assert.equal(resolveDirectClawhubAllowed({ preferenceAllowed: false, env: {} }), false);
  assert.equal(resolveDirectClawhubAllowed({ env: {} }), false);
});

test("allows explicit preference or developer env override", () => {
  assert.equal(resolveDirectClawhubAllowed({ preferenceAllowed: true, env: {} }), true);
  assert.equal(
    resolveDirectClawhubAllowed({ preferenceAllowed: false, env: { NEWBRAIN_MARKET_DIRECT_CLAWHUB: "1" } }),
    true
  );
});

test("throws Chinese blocked message when direct path is closed", () => {
  assert.throws(
    () => assertDirectClawhubAllowed(false),
    (error) => {
      assert.match(String(error.message), /市场安装须经服务端，直连已关闭/);
      assert.match(String(error.message), /market\.direct_clawhub_allowed=false/);
      return true;
    }
  );
  assert.doesNotThrow(() => assertDirectClawhubAllowed(true));
});
