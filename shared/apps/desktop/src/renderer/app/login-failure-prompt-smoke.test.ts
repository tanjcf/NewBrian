/**
 * LOGIN-FAILURE-PROMPT-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Login failures must always surface a visible error banner — never silent.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LOGIN_FAILURE_FALLBACK,
  normalizeLoginErrorMessage,
  resolveLoginFailureBannerMessage
} from "./login-error-message.ts";

export const CASE_ID = "LOGIN-FAILURE-PROMPT-SMOKE-001";

function readIfPresent(urls: URL[]): string {
  for (const url of urls) {
    try {
      return readFileSync(fileURLToPath(url), "utf8");
    } catch {
      // try next
    }
  }
  return "";
}

function sliceUntil(source: string, start: string, stops: string[]): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  let end = source.length;
  for (const stop of stops) {
    const at = source.indexOf(stop, from + start.length);
    if (at >= 0 && at < end) end = at;
  }
  return source.slice(from, end);
}

test(`${CASE_ID} strips IPC wrappers but never returns an empty banner message`, () => {
  assert.equal(
    normalizeLoginErrorMessage(
      new Error("Error invoking remote method 'phase1:login-auth': Error: 邮箱或密码不正确，请检查后重试。")
    ),
    "邮箱或密码不正确，请检查后重试。"
  );
  assert.equal(
    normalizeLoginErrorMessage(new Error("Error invoking remote method 'phase1:login-auth': Error: ")),
    LOGIN_FAILURE_FALLBACK
  );
  assert.equal(normalizeLoginErrorMessage(""), LOGIN_FAILURE_FALLBACK);
  assert.equal(normalizeLoginErrorMessage({ message: "验证码已过期，请重新获取。" }), "验证码已过期，请重新获取。");
});

test(`${CASE_ID} prefers errorMessage then last_error for the banner`, () => {
  assert.equal(resolveLoginFailureBannerMessage("密码错误", "旧错误"), "密码错误");
  assert.equal(resolveLoginFailureBannerMessage("", "账号已在其他设备登录"), "账号已在其他设备登录");
  assert.equal(resolveLoginFailureBannerMessage("  ", null), "");
});

test(`${CASE_ID} LoginScreen renders a role=alert banner from errorMessage or last_error`, () => {
  const source = readFileSync(fileURLToPath(new URL("./LoginScreen.tsx", import.meta.url)), "utf8");
  assert.match(source, /resolveLoginFailureBannerMessage/);
  assert.match(source, /data-testid="login-error-banner"/);
  assert.match(source, /role="alert"/);
});

test(`${CASE_ID} login submit treats unauthenticated responses as visible failures`, () => {
  // Materialized / platform tree: .../renderer/app → ../ui.tsx
  // Source tree from shared/.../renderer/app → repo root is ../../../../../..
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
    const login = sliceUntil(source, "async function handleLoginSubmit", [
      "async function handleSendLoginCode",
      "async function handleAlipayQrLogin"
    ]);
    assert.match(login, /!nextAuthStatus\.authenticated/);
    assert.match(login, /LOGIN_FAILURE_FALLBACK|登录失败，请检查账号/);
    assert.match(login, /normalizeLoginErrorMessage/);
  }
});
