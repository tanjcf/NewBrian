import type { DesktopSecretProtector } from "./desktop-secret-vault.js";

interface LinuxSafeStorage {
  getSelectedStorageBackend(): string;
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const protectedBackends = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

export function createLinuxSecretProtector(storage: LinuxSafeStorage): DesktopSecretProtector {
  const isProtected = () => storage.isEncryptionAvailable()
    && protectedBackends.has(storage.getSelectedStorageBackend().trim().toLowerCase());
  const requireProtectedBackend = () => {
    if (!isProtected()) {
      throw new Error("Linux Secret Service or KWallet credential protection is unavailable.");
    }
  };

  return {
    isEncryptionAvailable: isProtected,
    encryptString(value) {
      requireProtectedBackend();
      return storage.encryptString(value);
    },
    decryptString(value) {
      requireProtectedBackend();
      return storage.decryptString(value);
    }
  };
}
