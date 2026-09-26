import assert from "node:assert/strict";
import test from "node:test";

const loginForm = await import(new URL("./login-form.ts", import.meta.url).href);

const baseEmailForm = {
  channel: "email" as const,
  email: "user@example.com",
  phone: "",
  password: "secret",
  captcha: "",
  agreementAccepted: true
};

test("password mode uses password even when email code login is enabled server-side", () => {
  assert.equal(
    loginForm.shouldUseLoginCode(baseEmailForm, "password", { passwordLoginEnabled: true }),
    false
  );
});

test("code mode uses captcha when user switches to email verification", () => {
  assert.equal(
    loginForm.shouldUseLoginCode(
      { ...baseEmailForm, password: "", captcha: "123456" },
      "code",
      { passwordLoginEnabled: true }
    ),
    true
  );
});

test("forces code when password login is disabled", () => {
  assert.equal(
    loginForm.shouldUseLoginCode(baseEmailForm, "password", { passwordLoginEnabled: false }),
    true
  );
});

test("phone channel always uses code", () => {
  assert.equal(
    loginForm.shouldUseLoginCode(
      { ...baseEmailForm, channel: "phone", phone: "13800138000", password: "", captcha: "123456" },
      "password",
      { passwordLoginEnabled: true }
    ),
    true
  );
});

test("canSubmitLoginForm accepts email+password without captcha", () => {
  assert.equal(
    loginForm.canSubmitLoginForm(baseEmailForm, {
      emailAuthMode: "password",
      isSubmitting: false,
      agreementEnabled: true
    }),
    true
  );
});
