import assert from "node:assert/strict";
import test from "node:test";
const { MobilePairingGuard } = await import(
  new URL("./mobile-bridge-service.ts", import.meta.url).href
);

test("requires both the pairing token and six-digit code", () => {
  const guard = new MobilePairingGuard();
  guard.configure({ token: "secret", code: "123456", expiresAt: new Date(2_000).toISOString() });
  assert.equal(guard.authorize({ token: "secret", code: "000000", clientAddress: "10.0.0.2", now: 1_000 }), false);
  assert.equal(guard.authorize({ token: "wrong", code: "123456", clientAddress: "10.0.0.2", now: 1_000 }), false);
  assert.equal(guard.authorize({ token: "secret", code: "123456", clientAddress: "10.0.0.2", now: 1_000 }), true);
});

test("page access needs only the token but data access still needs the code", () => {
  const guard = new MobilePairingGuard();
  guard.configure({ token: "secret", code: "123456", expiresAt: new Date(2_000).toISOString() });
  assert.equal(guard.authorizePage({ token: "secret", clientAddress: "10.0.0.2", now: 1_000 }), true);
  assert.equal(guard.authorizePage({ token: "wrong", clientAddress: "10.0.0.2", now: 1_000 }), false);
  assert.equal(guard.authorizePage({ token: "secret", clientAddress: "10.0.0.2", now: 3_000 }), false);
  assert.equal(guard.authorize({ token: "secret", code: "wrong", clientAddress: "10.0.0.2", now: 1_000 }), false);
  assert.equal(guard.authorize({ token: "secret", code: "123456", clientAddress: "10.0.0.2", now: 1_000 }), true);
});

test("binds a session to the first client and rejects expired credentials", () => {
  const guard = new MobilePairingGuard();
  guard.configure({ token: "secret", code: "123456", expiresAt: new Date(2_000).toISOString() });
  assert.equal(guard.authorize({ token: "secret", code: "123456", clientAddress: "10.0.0.2", now: 1_000 }), true);
  assert.equal(guard.authorize({ token: "secret", code: "123456", clientAddress: "10.0.0.3", now: 1_000 }), false);
  assert.equal(guard.authorize({ token: "secret", code: "123456", clientAddress: "10.0.0.2", now: 3_000 }), false);
});
