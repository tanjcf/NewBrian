import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopSecretVault, DesktopSecretVaultError } from "./desktop-secret-vault.ts";

function fakeProtector(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`protected:${Buffer.from(value).toString("base64")}`),
    decryptString: (value: Buffer) => Buffer.from(value.toString().slice("protected:".length), "base64").toString()
  };
}

test("stores ciphertext and exposes plaintext only to the trusted request path", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-vault-"));
  try {
    const path = join(root, "private-model.credential");
    const vault = new DesktopSecretVault(path, fakeProtector());
    await vault.replace("sk-private-user-value");
    assert.equal(await vault.isConfigured(), true);
    assert.equal(readFileSync(path, "utf8").includes("sk-private-user-value"), false);
    assert.equal(await vault.readForTrustedRequest(), "sk-private-user-value");
    await vault.remove();
    assert.equal(await vault.isConfigured(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed instead of writing plaintext when OS protection is unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-vault-"));
  try {
    const vault = new DesktopSecretVault(join(root, "private-model.credential"), fakeProtector(false));
    await assert.rejects(
      vault.replace("must-not-be-written"),
      (error: unknown) => error instanceof DesktopSecretVaultError && error.code === "BRAIN_SECRET_PROTECTION_UNAVAILABLE"
    );
    assert.equal(await vault.isConfigured(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
