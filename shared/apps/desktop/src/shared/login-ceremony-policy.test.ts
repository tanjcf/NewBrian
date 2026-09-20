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

test("packaged builds require Asia/Shanghai October 1 from server_time", () => {
  // 2026-09-30 23:30 UTC => 2026-10-01 07:30 Asia/Shanghai
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-09-30T23:30:00.000Z"
    }),
    true
  );
  // 2026-10-01 15:30 UTC => 2026-10-01 23:30 Asia/Shanghai
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-10-01T15:30:00.000Z"
    }),
    true
  );
  // 2026-10-01 16:30 UTC => 2026-10-02 00:30 Asia/Shanghai
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-10-01T16:30:00.000Z"
    }),
    false
  );
  assert.equal(
    policy.shouldEnableLoginCeremony({
      isPackaged: true,
      serverTime: "2026-09-20T07:00:00.000Z"
    }),
    false
  );
  assert.equal(policy.shouldEnableLoginCeremony({ isPackaged: true, serverTime: null }), false);
});

test("explicit server_date wins over server_time", () => {
  assert.equal(
    policy.isNationalDayFromServerClock({
      serverDate: "2026-10-01",
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

test("resolveLoginCeremonyAuthFields mirrors packaged Oct 1 gate", () => {
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
