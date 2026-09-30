import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface DesktopSecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class DesktopSecretVaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopSecretVaultError";
    this.code = code;
  }
}

/**
 * Persists only an OS-protected ciphertext envelope. The renderer receives a
 * configured/not-configured flag and can write a replacement secret, but no
 * API can return the plaintext credential to the renderer.
 */
export class DesktopSecretVault {
  private readonly filePath: string;
  private readonly protector: DesktopSecretProtector;

  constructor(
    filePath: string,
    protector: DesktopSecretProtector
  ) {
    this.filePath = filePath;
    this.protector = protector;
  }

  async isConfigured() {
    try {
      const payload = await readFile(this.filePath);
      return payload.length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async replace(secret: string) {
    const normalized = secret.trim();
    if (!normalized) throw new DesktopSecretVaultError("BRAIN_SECRET_EMPTY", "Credential cannot be empty.");
    if (!this.protector.isEncryptionAvailable()) {
      throw new DesktopSecretVaultError(
        "BRAIN_SECRET_PROTECTION_UNAVAILABLE",
        "Operating-system credential protection is unavailable; the credential was not saved."
      );
    }
    const encrypted = this.protector.encryptString(normalized);
    if (!encrypted.length) throw new DesktopSecretVaultError("BRAIN_SECRET_ENCRYPT_FAILED", "Credential encryption failed.");
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, encrypted, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  async readForTrustedRequest() {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
    if (!this.protector.isEncryptionAvailable()) {
      throw new DesktopSecretVaultError(
        "BRAIN_SECRET_PROTECTION_UNAVAILABLE",
        "Operating-system credential protection is unavailable."
      );
    }
    return this.protector.decryptString(encrypted).trim();
  }

  async remove() {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
