import assert from "node:assert/strict";
import test from "node:test";
import { RememberedLoginStore, type RememberedLoginSecretFile } from "./remembered-login-store.js";

function memoryVault(): RememberedLoginSecretFile & { raw: string } {
  const state = { raw: "" };
  return {
    get raw() {
      return state.raw;
    },
    async replace(secret: string) {
      state.raw = secret;
    },
    async readForTrustedRequest() {
      return state.raw;
    },
    async remove() {
      state.raw = "";
    }
  };
}

test("remembered login store round-trips and clears the secret", async () => {
  const vault = memoryVault();
  const store = new RememberedLoginStore(vault);
  const saved = {
    version: 1 as const,
    channel: "email" as const,
    email: "user@example.com",
    phone: "13800138000",
    password: "secret"
  };
  await store.save(saved);
  assert.equal(vault.raw.includes("secret"), true);
  assert.deepEqual(await store.load(), saved);
  await store.clear();
  assert.equal(await store.load(), null);
});

test("remembered login store rejects invalid input without writing it", async () => {
  const vault = memoryVault();
  const store = new RememberedLoginStore(vault);
  await assert.rejects(() => store.save({ channel: "email", email: "bad", phone: "", password: "secret" }), /REMEMBERED_LOGIN_INVALID/);
  assert.equal(vault.raw, "");
});
