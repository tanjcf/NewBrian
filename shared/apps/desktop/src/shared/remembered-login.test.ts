import assert from "node:assert/strict";
import test from "node:test";
import { initialLoginForm } from "../renderer/app/login-form.js";
import { applyRememberedLogin, mergeRememberedLogin, parseRememberedLogin } from "./remembered-login.js";

const saved = {
  version: 1 as const,
  channel: "email" as const,
  email: "user@example.com",
  phone: "13800138000",
  password: "secret"
};

test("parseRememberedLogin keeps a bounded email, phone, and password", () => {
  assert.deepEqual(parseRememberedLogin(saved), saved);
});

test("parseRememberedLogin rejects oversized or malformed credentials", () => {
  assert.equal(parseRememberedLogin({ ...saved, password: "x".repeat(257) }), null);
  assert.equal(parseRememberedLogin({ ...saved, email: "not-an-email" }), null);
  assert.equal(parseRememberedLogin({ ...saved, phone: "123" }), null);
  assert.equal(parseRememberedLogin({ ...saved, channel: "sms" }), null);
  assert.equal(parseRememberedLogin({ ...saved, password: "line\nbreak" }), null);
});

test("mergeRememberedLogin keeps the previous password when the new login has no password", () => {
  const next = mergeRememberedLogin(saved, {
    channel: "phone",
    email: "",
    phone: "13900139000",
    password: ""
  }, false);
  assert.deepEqual(next, {
    version: 1,
    channel: "phone",
    email: "user@example.com",
    phone: "13900139000",
    password: "secret"
  });
});

test("applyRememberedLogin fills an empty form and leaves captcha alone", () => {
  const form = { ...initialLoginForm, captcha: "123456", agreementAccepted: true };
  const next = applyRememberedLogin(form, saved);
  assert.equal(next.channel, "email");
  assert.equal(next.email, "user@example.com");
  assert.equal(next.phone, "13800138000");
  assert.equal(next.password, "secret");
  assert.equal(next.captcha, "123456");
  assert.equal(next.agreementAccepted, true);
});

test("applyRememberedLogin does not overwrite fields the user already typed", () => {
  const next = applyRememberedLogin({
    ...initialLoginForm,
    channel: "phone",
    email: "typed@example.com",
    phone: "13700137000",
    password: "typed"
  }, saved);
  assert.equal(next.channel, "phone");
  assert.equal(next.email, "typed@example.com");
  assert.equal(next.phone, "13700137000");
  assert.equal(next.password, "typed");
});
