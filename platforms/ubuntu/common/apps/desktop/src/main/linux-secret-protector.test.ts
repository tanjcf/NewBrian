import assert from "node:assert/strict";
import test from "node:test";
import { createLinuxSecretProtector } from "./linux-secret-protector.ts";

function storage(backend: string, available = true) {
  return {
    getSelectedStorageBackend: () => backend,
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice("encrypted:".length)
  };
}

test("rejects Electron basic_text because it is not OS-protected credential storage", () => {
  const protector = createLinuxSecretProtector(storage("basic_text"));
  assert.equal(protector.isEncryptionAvailable(), false);
  assert.throws(() => protector.encryptString("secret"), /Secret Service/u);
});

test("allows Secret Service and KWallet backends", () => {
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    const protector = createLinuxSecretProtector(storage(backend));
    assert.equal(protector.isEncryptionAvailable(), true);
    assert.equal(protector.decryptString(protector.encryptString("secret")), "secret");
  }
});

test("fails closed when Electron reports encryption unavailable", () => {
  assert.equal(createLinuxSecretProtector(storage("gnome_libsecret", false)).isEncryptionAvailable(), false);
});
