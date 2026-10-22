/**
 * LOGIN-CODE-COOLDOWN-SMOKE-001
 * Email and phone verification-code resend timers must stay isolated.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  clearLoginCodeCooldowns,
  hasActiveLoginCodeCooldown,
  initialLoginCodeCooldownByChannel,
  loginCodeCooldownForChannel,
  setChannelLoginCodeCooldown,
  tickLoginCodeCooldowns
} from "./login-code-cooldown.ts";

export const CASE_ID = "LOGIN-CODE-COOLDOWN-SMOKE-001";

function readIfPresent(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  return "";
}

test(`${CASE_ID} phone and email cooldowns do not overwrite each other`, () => {
  let cooldowns = initialLoginCodeCooldownByChannel;
  cooldowns = setChannelLoginCodeCooldown(cooldowns, "phone", 47);
  cooldowns = setChannelLoginCodeCooldown(cooldowns, "email", 60);
  assert.equal(loginCodeCooldownForChannel(cooldowns, "phone"), 47);
  assert.equal(loginCodeCooldownForChannel(cooldowns, "email"), 60);
  cooldowns = tickLoginCodeCooldowns(cooldowns);
  assert.equal(loginCodeCooldownForChannel(cooldowns, "phone"), 46);
  assert.equal(loginCodeCooldownForChannel(cooldowns, "email"), 59);
  cooldowns = clearLoginCodeCooldowns();
  assert.deepEqual(cooldowns, { email: 0, phone: 0 });
  assert.equal(hasActiveLoginCodeCooldown(cooldowns), false);
});

test(`${CASE_ID} desktop login UI keeps per-channel cooldown state`, () => {
  // Materialized desktop keeps ui next to this folder; source tree uses platforms overlays.
  const sources = [
    readIfPresent([
      new URL("../ui.tsx", import.meta.url),
      new URL("../../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/macos/common/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../../platforms/ubuntu/common/apps/desktop/src/renderer/ui.tsx", import.meta.url)
    ])
  ].filter(Boolean);
  assert.ok(sources.length > 0, "login UI source must be present");
  for (const source of sources) {
    assert.match(source, /loginCodeCooldownByChannel/);
    assert.match(source, /setChannelLoginCodeCooldown/);
    assert.match(source, /loginCodeCooldownForChannel\(loginCodeCooldownByChannel,\s*loginCodeChannel\)/);
    assert.doesNotMatch(
      source,
      /const\s*\[\s*loginCodeCooldownSeconds\s*,\s*setLoginCodeCooldownSeconds\s*\]\s*=\s*useState/
    );
  }
});
