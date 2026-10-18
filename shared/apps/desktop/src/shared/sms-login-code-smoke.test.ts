/**
 * SMS-LOGIN-CODE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Phone login must request an SMS code. It must not send that code by email.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { isCnMobileIdentifier, loginCodeSendRequest, loginCodeVerifyFields } from "./login-code-channel.ts";

export const CASE_ID = "SMS-LOGIN-CODE-SMOKE-001";

function readIfPresent(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  return "";
}

test(`${CASE_ID} a phone login asks for SMS and an email login asks for mail`, () => {
  const sms = loginCodeSendRequest({
    phone: "13800138000",
    deviceId: "device-1",
    deviceName: "desk"
  });
  assert.equal(sms.path, "/api/auth/login/sms-code");
  assert.equal(sms.body.phone, "13800138000");
  assert.equal("identifier" in sms.body, false);

  const mail = loginCodeSendRequest({
    email: "user@example.com",
    deviceId: "device-1",
    deviceName: "desk"
  });
  assert.equal(mail.path, "/api/desktop/auth/login-code/send");
  assert.equal(mail.body.identifier, "user@example.com");
  assert.equal("phone" in mail.body, false);

  assert.deepEqual(loginCodeVerifyFields({
    identifier: "13800138000",
    captcha: "246810",
    loginWithCode: true
  }), { phone: "13800138000", sms_code: "246810" });
  assert.deepEqual(loginCodeVerifyFields({
    identifier: "user@example.com",
    captcha: "246810",
    loginWithCode: true
  }), {});
  assert.equal(isCnMobileIdentifier("13800138000"), true);
  assert.equal(isCnMobileIdentifier("user@example.com"), false);
  assert.throws(() => loginCodeSendRequest({ phone: "12345", deviceId: "d", deviceName: "n" }), /11 位手机号/);
});

function sliceUntil(source: string, start: string, ends: string[]) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  let to = source.length;
  for (const end of ends) {
    const at = source.indexOf(end, from + start.length);
    if (at >= 0 && at < to) to = at;
  }
  return source.slice(from, to);
}

test(`${CASE_ID} desktop login code send uses the SMS channel for a phone`, () => {
  const sources = [
    readIfPresent([
      new URL("../main/index.ts", import.meta.url),
      new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../platforms/macos/common/apps/desktop/src/main/index.ts", import.meta.url)
    ]),
    readIfPresent([
      new URL("../../../../../platforms/ubuntu/common/apps/desktop/src/main/index.ts", import.meta.url)
    ])
  ].filter(Boolean);
  assert.ok(sources.length > 0, "desktop login source must be present");
  for (const source of sources) {
    const send = sliceUntil(source, "async function sendDesktopLoginCode", [
      "async function changeDesktopAuthPassword",
      "async function logoutDesktopAuth"
    ]);
    assert.match(send, /loginCodeSendRequest/);
    assert.match(send, /\$\{gatewayOrigin\}\$\{request\.path\}/);
    const loginStart = source.includes("async function attemptDesktopAuthLogin")
      ? "async function attemptDesktopAuthLogin"
      : "async function loginDesktopAuth";
    const login = sliceUntil(source, loginStart, [
      "function desktopAuthLoginNeedsEmailCode",
      "function normalizeDesktopLoginError"
    ]);
    assert.match(login, /loginCodeVerifyFields/);
  }
});

test(`${CASE_ID} the auth service sends SMS when the login identifier is a phone`, () => {
  const service = readIfPresent([
    new URL("../../../../../../spring-app/src/main/java/com/demo/tokensystem/service/AuthFlowService.java", import.meta.url)
  ]);
  if (!service) return;
  const send = service.slice(service.indexOf("public void sendLoginCode"), service.indexOf("public Map<String, Object> loginStatus"));
  assert.match(send, /sendLoginSmsCode\(smsPayload\)/);
  assert.match(send, /normalizePhone\(identifier\)/);
  const login = service.slice(service.indexOf("public Map<String, Object> loginUser"), service.indexOf("public void sendAdminLoginCode"));
  assert.match(login, /smsCodeService\.consume\(phone, code\.trim\(\), "login"\)/);
});
