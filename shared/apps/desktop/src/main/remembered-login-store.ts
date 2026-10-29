import { DesktopSecretVault } from "./desktop-secret-vault.js";
import { parseRememberedLogin, type RememberedLogin } from "../shared/remembered-login.js";

export interface RememberedLoginSecretFile {
  replace(secret: string): Promise<void>;
  readForTrustedRequest(): Promise<string>;
  remove(): Promise<void>;
}

/** OS-protected copy of the last login email, phone, and password. */
export class RememberedLoginStore {
  private readonly vault: RememberedLoginSecretFile;

  constructor(vault: RememberedLoginSecretFile) {
    this.vault = vault;
  }

  async load(): Promise<RememberedLogin | null> {
    try {
      const raw = await this.vault.readForTrustedRequest();
      if (!raw) return null;
      return parseRememberedLogin(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  async save(input: unknown): Promise<{ ok: true }> {
    const parsed = parseRememberedLogin(input);
    if (!parsed) throw new Error("REMEMBERED_LOGIN_INVALID");
    await this.vault.replace(JSON.stringify(parsed));
    return { ok: true };
  }

  async clear(): Promise<{ ok: true }> {
    await this.vault.remove();
    return { ok: true };
  }
}

export function createRememberedLoginStore(filePath: string, protector: ConstructorParameters<typeof DesktopSecretVault>[1]) {
  return new RememberedLoginStore(new DesktopSecretVault(filePath, protector));
}
