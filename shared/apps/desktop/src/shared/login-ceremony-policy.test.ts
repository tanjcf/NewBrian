import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./login-ceremony-policy.ts", import.meta.url).href);

test("unpackaged builds always enable the login ceremony", () => {
  assert.equal(policy.shouldEnableLoginCeremony({ isPackaged: false, serverTime: null }), true);
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: false,
      serverTime: "2026-09-20T08:00:00.000Z"
    }),
    true
  );
});

test("packaged builds enable Sep 29–Oct 15 Asia/Shanghai tribute window", () => {
  // 2026-09-28 16:00 UTC => 2026-09-29 00:00 Asia/Shanghai (window start)
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-09-28T16:00:00.000Z"
    }),
    true
  );
  // Mid-window Oct 1
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-09-30T23:30:00.000Z"
    }),
    true
  );
  // 2026-10-15 15:59 UTC => still Oct 15 Asia/Shanghai
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-10-15T15:59:00.000Z"
    }),
    true
  );
  // 2026-10-15 16:00 UTC => 2026-10-16 00:00 Asia/Shanghai (after window)
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-10-15T16:00:00.000Z"
    }),
    false
  );
  // Day before window: Sep 28 Shanghai
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverDate: "2026-09-28"
    }),
    false
  );
  assert.equal(policy.shouldEnableLoginCeremony({ isPackaged: true, serverTime: null }), false);
});

test("explicit server_date wins over server_time for tribute window", () => {
  assert.equal(
    policy.isNationalDayFromServerClock({
      serverDate: "2026-09-29",
      serverTime: "2026-09-20T00:00:00.000Z"
    }),
    true
  );
  assert.equal(
    policy.isNationalDayFromServerClock({
      serverDate: "2026-10-15",
      serverTime: "2026-09-20T00:00:00.000Z"
    }),
    true
  );
  assert.equal(
    policy.isNationalDayFromServerClock({
      serverDate: "2026-09-20",
      serverTime: "2026-09-30T23:30:00.000Z"
    }),
    false
  );
});

test("isWithinNationalDayTributeWindow covers inclusive bounds", () => {
  assert.equal(policy.isWithinNationalDayTributeWindow(9, 28), false);
  assert.equal(policy.isWithinNationalDayTributeWindow(9, 29), true);
  assert.equal(policy.isWithinNationalDayTributeWindow(10, 1), true);
  assert.equal(policy.isWithinNationalDayTributeWindow(10, 15), true);
  assert.equal(policy.isWithinNationalDayTributeWindow(10, 16), false);
});

test("resolveLoginCeremonyAuthFields mirrors packaged tribute window gate", () => {
  const enabled = policy.resolveLoginCeremonyAuthFields({
    isPackaged: true,
    serverDate: "2026-10-01",
    serverTime: "2026-09-20T00:00:00.000Z"
  });
  assert.equal(enabled.login_ceremony_enabled, true);
  assert.equal(enabled.server_date, "2026-10-01");

  const disabled = policy.resolveLoginCeremonyAuthFields({
    isPackaged: true,
    serverTime: "2026-09-20T07:00:00.000Z"
  });
  assert.equal(disabled.login_ceremony_enabled, false);
  assert.equal(disabled.server_time, "2026-09-20T07:00:00.000Z");
});

test("shouldInvalidateLocalAuthForLoginCeremony clears only pre-window packaged sessions", () => {
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: false,
      serverDate: "2026-09-29",
      lastSyncedAt: "2026-09-20T00:00:00.000Z"
    }),
    false
  );
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: true,
      serverDate: "2026-09-28",
      lastSyncedAt: "2026-09-20T00:00:00.000Z"
    }),
    false
  );
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: true,
      serverDate: "2026-09-29",
      lastSyncedAt: "2026-09-28T15:59:00.000Z"
    }),
    true
  );
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: true,
      serverDate: "2026-09-29",
      lastSyncedAt: "2026-09-28T16:00:00.000Z"
    }),
    false
  );
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: true,
      serverDate: "2026-10-01",
      lastSyncedAt: null
    }),
    true
  );
  assert.equal(
    policy.shouldInvalidateLocalAuthForLoginCeremony({
      isPackaged: true,
      serverTime: "2026-09-28T16:00:00.000Z",
      lastSyncedAt: "2026-09-01T00:00:00.000Z"
    }),
    true
  );
});

test("resolveLoginCeremonyWindowStartMs is Shanghai midnight on Sep 29", () => {
  assert.equal(policy.resolveLoginCeremonyWindowStartMs(2026), Date.parse("2026-09-29T00:00:00+08:00"));
});
